/**
 * Babylon Lite (WebGPU) render backend for axiom.
 * Same port as babylon-backend / three-backend — sim stays engine-agnostic.
 */
import {
  addToScene,
  createEngine,
  createFreeCamera,
  createGround,
  createHemisphericLight,
  createDirectionalLight,
  createLineSystem,
  createMeshFromData,
  createPlane,
  createPolyhedron,
  createSceneContext,
  createShaderMaterial,
  createStandardMaterial,
  invalidateRenderBundles,
  updateMeshPositions,
  createTexture2DFromPixels,
  disposeEngine,
  disposeScene,
  flushThinInstances,
  loadTexture2D,
  registerScene,
  removeFromScene,
  renderFrame,
  resizeEngine,
  setGpuTimingEnabled,
  setStandardAmbientTexture,
  setStandardEmissiveTexture,
  setStandardOpacityTexture,
  setThinInstanceColors,
  setThinInstanceCount,
  setThinInstances,
} from '@babylonjs/lite';
import { WAVE_SOURCES } from '../sim/behaviors.js';

function identityPark(count) {
  const m = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    m[o] = 1;
    m[o + 5] = 1;
    m[o + 10] = 1;
    m[o + 15] = 1;
  }
  return m;
}

function makeTriangleData(size) {
  const h = size;
  const positions = new Float32Array([
    0, h, 0,
    -h * 0.86, -h * 0.5, 0,
    h * 0.86, -h * 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  return { positions, normals, indices };
}

/** Identity-indexed point cloud (one vertex per particle — same path as Three). */
function makePointCloudData(capacity) {
  const cap = Math.max(1, capacity | 0);
  const positions = new Float32Array(cap * 3);
  const normals = new Float32Array(cap * 3);
  const indices = new Uint32Array(cap);
  for (let i = 0; i < cap; i++) {
    positions[i * 3 + 1] = -9999;
    indices[i] = i;
  }
  return { positions, normals, indices };
}

/**
 * Unlit point-list material. Standard/PBR hardcode triangle-list; Lite only
 * exposes topology on ShaderMaterial (`_topology`, same hook as LineMaterial).
 * @param {{ r: number, g: number, b: number }} tint
 */
function makePointMaterial(tint) {
  const mat = createShaderMaterial({
    name: 'axiom-points',
    attributes: ['position'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'pointColor', type: 'vec4<f32>', defaultValue: [tint.r, tint.g, tint.b, 1] },
    ],
    vertexSource: `struct VertexOutput { @builtin(position) position: vec4<f32> };
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(input.position, 1.0);
  return out;
}`,
    fragmentSource: `struct VertexOutput { @builtin(position) position: vec4<f32> };
@fragment fn mainFragment(_input: VertexOutput) -> @location(0) vec4<f32> {
  return shaderUniforms.pointColor;
}`,
    backFaceCulling: false,
    depthWrite: true,
  });
  mat._topology = 'point-list';
  return mat;
}

/**
 * @returns {import('./backend.js').AxiomRenderer & { getEngine: () => any }}
 */
export function createLiteBackend() {
  /** @type {any} */
  let engine = null;
  /** @type {any} */
  let scene = null;
  /** @type {any} */
  let camera = null;
  /** @type {HTMLCanvasElement | null} */
  let canvas = null;

  /** @type {Map<string, any>} */
  const species = new Map();

  /** @type {{ mesh: any, waveA: Float32Array, waveB: Float32Array, matrices: Float32Array, phase: number } | null} */
  let tetras = null;

  /** @type {any} */
  let chunkLineGrid = null;
  let chunkLineSignature = '';
  let showChunkWireframes = true;

  /** @type {any} */
  let hardCircleTex = null;

  const keys = new Set();
  let pointerDragging = false;
  let lastPtrX = 0;
  let lastPtrY = 0;
  let cdX = 0;
  let cdY = 0;
  let cdZ = 0;
  let stickX = 0;
  let stickZ = 0;
  let lastNow = 0;
  let lastDt = 1 / 60;
  let rafId = 0;
  /** @type {{ toggle: () => Promise<void>, dispose: () => void } | null} */
  let explorer = null;

  const lookSens = 0.0022;
  const moveSpeed = 5.5;
  const moveInertia = 0.9;

  function assertReady() {
    if (!engine || !scene) throw new Error('LiteBackend: call init() first');
  }

  function getHardCircleTexture() {
    if (hardCircleTex) return hardCircleTex;
    const size = 64;
    const px = new Uint8Array(size * size * 4);
    const cx = size * 0.5;
    const r = size * 0.5 - 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const on = Math.hypot(x + 0.5 - cx, y + 0.5 - cx) <= r;
        const i = (y * size + x) * 4;
        const v = on ? 255 : 0;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = v;
      }
    }
    hardCircleTex = createTexture2DFromPixels(engine, px, size, size, {
      minFilter: 'nearest',
      magFilter: 'nearest',
    });
    return hardCircleTex;
  }

  function makeSpeciesMaterial(tint, hardCircle) {
    const mat = createStandardMaterial();
    mat.diffuseColor = [1, 1, 1];
    mat.emissiveColor = [tint.r, tint.g, tint.b];
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.specularColor = [0, 0, 0];
    if (hardCircle) {
      const circle = getHardCircleTexture();
      mat.diffuseTexture = circle;
      setStandardOpacityTexture(mat, circle);
      mat.alphaCutOff = 0.5;
    }
    return mat;
  }

  function applyLook() {
    const maxPitch = Math.PI / 2 - 0.01;
    camera._pitch = Math.max(-maxPitch, Math.min(maxPitch, camera._pitch));
    const cy = Math.cos(camera._yaw);
    const sy = Math.sin(camera._yaw);
    const cp = Math.cos(camera._pitch);
    const sp = Math.sin(camera._pitch);
    camera.target.set(
      camera.position.x + sy * cp,
      camera.position.y + sp,
      camera.position.z + cy * cp,
    );
  }

  function tickFly(dt) {
    if (!camera) return;
    const dtMs = Math.max(1, dt * 1000);
    const step = moveSpeed * Math.sqrt((dtMs * dtMs) / 1e5);

    let mx = 0;
    let my = 0;
    let mz = 0;
    if (keys.has('KeyE') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyD') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyF') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyR')) my += 1;
    if (keys.has('KeyC')) my -= 1;
    mx += stickX;
    mz += stickZ;

    if (mx || my || mz) {
      const len = Math.hypot(mx, my, mz) || 1;
      cdX += (mx / len) * step;
      cdY += (my / len) * step;
      cdZ += (mz / len) * step;
    }

    if (cdX || cdY || cdZ) {
      const cy = Math.cos(camera._yaw);
      const sy = Math.sin(camera._yaw);
      const cp = Math.cos(camera._pitch);
      const sp = Math.sin(camera._pitch);
      camera.position.x += sy * cp * cdZ + cy * cdX;
      camera.position.y += sp * cdZ + cdY;
      camera.position.z += cy * cp * cdZ - sy * cdX;
      applyLook();
    }

    cdX *= moveInertia;
    cdY *= moveInertia;
    cdZ *= moveInertia;
    const eps = moveSpeed * 1e-3;
    if (Math.abs(cdX) < eps) cdX = 0;
    if (Math.abs(cdY) < eps) cdY = 0;
    if (Math.abs(cdZ) < eps) cdZ = 0;
  }

  function attachFly(canvasEl) {
    canvasEl.tabIndex = 0;
    canvasEl.style.outline = 'none';
    const onKeyDown = (e) => keys.add(e.code);
    const onKeyUp = (e) => keys.delete(e.code);
    const onPtrDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      canvasEl.setPointerCapture?.(e.pointerId);
      pointerDragging = true;
      lastPtrX = e.clientX;
      lastPtrY = e.clientY;
      canvasEl.focus();
    };
    const onPtrMove = (e) => {
      if (!pointerDragging) return;
      // Lite is LH / look +Z — yaw must increase on drag-right (Three is RH / look -Z).
      camera._yaw += (e.clientX - lastPtrX) * lookSens;
      camera._pitch -= (e.clientY - lastPtrY) * lookSens;
      lastPtrX = e.clientX;
      lastPtrY = e.clientY;
      applyLook();
    };
    const onPtrUp = (e) => {
      pointerDragging = false;
      canvasEl.releasePointerCapture?.(e.pointerId);
    };
    canvasEl.addEventListener('pointerdown', onPtrDown);
    canvasEl.addEventListener('pointermove', onPtrMove);
    canvasEl.addEventListener('pointerup', onPtrUp);
    canvasEl.addEventListener('pointercancel', onPtrUp);
    canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvasEl.addEventListener('pointerdown', () => canvasEl.focus());
    canvasEl.focus();
  }

  function attachMobileStick() {
    const want =
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!want) return;
    const root = document.createElement('div');
    root.id = 'mobi_move';
    root.innerHTML = `
      <div class="mobi-stick" id="mobi_stick">
        <div class="mobi-stick-knob" id="mobi_knob"></div>
      </div>
    `;
    document.body.appendChild(root);
    root.style.display = 'flex';
    const stickEl = root.querySelector('#mobi_stick');
    const knobEl = root.querySelector('#mobi_knob');
    let stickId = -1;
    const maxR = 48;
    const onDown = (e) => {
      if (stickId !== -1) return;
      stickId = e.pointerId;
      stickEl.setPointerCapture?.(e.pointerId);
      onMove(e);
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e) => {
      if (e.pointerId !== stickId) return;
      const rect = stickEl.getBoundingClientRect();
      let dx = e.clientX - (rect.left + rect.width * 0.5);
      let dy = e.clientY - (rect.top + rect.height * 0.5);
      const len = Math.hypot(dx, dy) || 1;
      if (len > maxR) {
        dx = (dx / len) * maxR;
        dy = (dy / len) * maxR;
      }
      stickX = dx / maxR;
      stickZ = -dy / maxR;
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      e.preventDefault();
      e.stopPropagation();
    };
    const onUp = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = -1;
      stickX = 0;
      stickZ = 0;
      knobEl.style.transform = 'translate(0px, 0px)';
      e.preventDefault();
      e.stopPropagation();
    };
    stickEl.addEventListener('pointerdown', onDown);
    stickEl.addEventListener('pointermove', onMove);
    stickEl.addEventListener('pointerup', onUp);
    stickEl.addEventListener('pointercancel', onUp);
  }

  function createTetraField() {
    const mesh = createPolyhedron(engine, { type: 0, size: 0.03 });
    mesh.name = 'tetrahedron';
    mesh.pickable = false;
    const mat = createStandardMaterial();
    mat.diffuseColor = [0.75, 0.75, 0.75];
    mesh.material = mat;

    const xs = [];
    const zs = [];
    for (let ix = -10; ix < 10; ix += 0.75) {
      for (let iz = -10; iz < 10; iz += 0.75) {
        xs.push(ix);
        zs.push(iz);
      }
    }
    const n = xs.length;
    const waveA = new Float32Array(n);
    const waveB = new Float32Array(n);
    const matrices = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const z = zs[i];
      waveA[i] = Math.cos(x) + Math.sin(z);
      waveB[i] = Math.cos(z) - Math.sin(x);
      const o = i * 16;
      matrices[o] = 1;
      matrices[o + 5] = 1;
      matrices[o + 10] = 1;
      matrices[o + 12] = x;
      matrices[o + 13] = waveA[i];
      matrices[o + 14] = z;
      matrices[o + 15] = 1;
    }
    setThinInstances(mesh, matrices, n);
    addToScene(scene, mesh);
    tetras = { mesh, waveA, waveB, matrices, phase: 0 };
  }

  return {
    async init(canvasEl) {
      canvas = canvasEl;
      engine = await createEngine(canvas, { msaaSamples: 1 });
      setGpuTimingEnabled(engine, true);
      scene = createSceneContext(engine);
      scene.clearColor = { r: 0.1, g: 0.1, b: 0.1, a: 1 };

      camera = createFreeCamera({ x: 0, y: 5, z: -5 }, { x: 0, y: 0, z: 0 });
      camera.speed = moveSpeed;
      camera.inertia = moveInertia;
      camera.nearPlane = 0.1;
      camera.farPlane = 4000;
      scene.camera = camera;
      attachFly(canvas);
      attachMobileStick();

      const sun = createDirectionalLight([-0.5, -1, -1.25], 0.8);
      addToScene(scene, sun);
      const hemi = createHemisphericLight([0, 1, 0], 0.35);
      addToScene(scene, hemi);

      const grassTex = await loadTexture2D(engine, './assets/untitled-q.png', {
        srgb: true,
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      });
      const matGrass = createStandardMaterial();
      matGrass.diffuseColor = [0.4, 0.4, 0.4];
      matGrass.diffuseTexture = grassTex;
      setStandardEmissiveTexture(matGrass, grassTex);
      setStandardAmbientTexture(matGrass, grassTex);

      const ground = createGround(engine, { width: 42, height: 42, subdivisions: 2 });
      ground.name = 'ground';
      ground.position.y = -2;
      ground.material = matGrass;
      addToScene(scene, ground);

      const roof = createGround(engine, { width: 16, height: 16, subdivisions: 2 });
      roof.name = 'roof';
      roof.position.y = 16;
      roof.rotation.x = Math.PI;
      roof.material = matGrass;
      addToScene(scene, roof);

      const chaosTex = await loadTexture2D(engine, './assets/sphere-q.jpg', {
        srgb: true,
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      });
      const matChaos = createStandardMaterial();
      matChaos.diffuseColor = [0.4, 0.4, 0.4];
      matChaos.diffuseTexture = chaosTex;
      setStandardEmissiveTexture(matChaos, chaosTex);

      for (let i = 0; i < WAVE_SOURCES.length; i++) {
        const src = WAVE_SOURCES[i];
        const ball = createPolyhedron(engine, { type: 3, size: 1 });
        ball.name = i === 0 ? 'icosphere' : 'icosphere2';
        ball.position.set(src.x, src.y, src.z);
        ball.material = matChaos;
        addToScene(scene, ball);
      }

      createTetraField();
      // Opacity is opt-in in Lite 1.23 — register the ext before the first build
      // so later hard-circle species (added after registerScene) pick it up.
      {
        const boot = createStandardMaterial();
        setStandardOpacityTexture(boot, getHardCircleTexture());
      }
      await registerScene(scene);
    },

    tickScenery() {
      if (!tetras) return;
      tetras.phase += 0.00314;
      const { waveA, waveB, matrices, mesh, phase } = tetras;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      for (let i = 0; i < waveA.length; i++) {
        matrices[i * 16 + 13] = waveA[i] * c + waveB[i] * s;
      }
      flushThinInstances(mesh);
    },

    resize() {
      if (engine) resizeEngine(engine);
    },

    /**
     * @param {{ id: string, meshKind?: string, capacity: number, size?: number, tint?: { r: number, g: number, b: number }, hardCircle?: boolean }} spec
     */
    registerSpecies(spec) {
      assertReady();
      if (species.has(spec.id)) return;

      const kind = spec.meshKind || 'plane';
      const size = spec.size ?? 0.05;
      const cap = Math.max(1, spec.capacity | 0);
      const tint = spec.tint || { r: 1, g: 1, b: 1 };
      const hardCircle = !!spec.hardCircle || kind === 'plane';

      /** @type {any} */
      let mesh;
      if (kind === 'point') {
        const pt = makePointCloudData(cap);
        mesh = createMeshFromData(
          engine,
          `species_${spec.id}`,
          pt.positions,
          pt.normals,
          pt.indices,
        );
        mesh.boundMin = [-1e5, -1e5, -1e5];
        mesh.boundMax = [1e5, 1e5, 1e5];
        mesh.material = makePointMaterial(tint);
        mesh.pickable = false;
        mesh.visible = false;
        mesh._gpu.indexCount = 0;
        addToScene(scene, mesh);
        species.set(spec.id, { mesh, capacity: cap, bound: false, mode: 'points' });
        return;
      } else if (kind === 'triangle') {
        const tri = makeTriangleData(size);
        mesh = createMeshFromData(
          engine,
          `species_${spec.id}`,
          tri.positions,
          tri.normals,
          tri.indices,
        );
      } else if (kind === 'tetra') {
        mesh = createPolyhedron(engine, { type: 0, size });
        mesh.name = `species_${spec.id}`;
      } else {
        mesh = createPlane(engine, { width: size, height: size });
        mesh.name = `species_${spec.id}`;
      }

      mesh.material = makeSpeciesMaterial(tint, hardCircle && kind !== 'triangle' && kind !== 'tetra');
      mesh.pickable = false;
      mesh.visible = false;
      // Park with a dummy color so the first pipeline includes instance colors.
      // Adding colors after the first build does not rebuild the shader.
      const park = identityPark(1);
      setThinInstances(mesh, park, 1);
      setThinInstanceColors(mesh, new Float32Array([1, 1, 1, 1]));
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      species.set(spec.id, { mesh, capacity: cap, bound: false });
    },

    /**
     * @param {{ id: string, count: number, matrices?: Float32Array, colors?: Float32Array, positions?: Float32Array }} upload
     */
    uploadSpecies(upload) {
      const entry = species.get(upload.id);
      if (!entry) return;
      const { mesh, capacity } = entry;
      const count = Math.max(0, Math.min(capacity, upload.count | 0));

      if (entry.mode === 'points') {
        if (!upload.positions) return;
        if (count > 0) updateMeshPositions(engine, mesh, upload.positions, 0, count);
        if (mesh._gpu.indexCount !== count) {
          mesh._gpu.indexCount = count;
          // Opaque draws are recorded into a render bundle — refresh when the
          // live count changes (Three's setDrawRange equivalent).
          invalidateRenderBundles(engine);
        }
        mesh.visible = count > 0;
        return;
      }

      if (!upload.matrices) return;
      if (!entry.bound) {
        setThinInstances(mesh, upload.matrices, capacity);
        if (upload.colors) setThinInstanceColors(mesh, upload.colors);
        entry.bound = true;
      } else if (upload.colors) {
        setThinInstanceColors(mesh, upload.colors);
      }
      setThinInstanceCount(mesh, count);
      mesh.visible = count > 0;
    },

    render() {
      if (!engine) return;
      tickFly(lastDt);
      resizeEngine(engine);
      renderFrame(engine, lastDt * 1000);
    },

    getDeltaTime() {
      const now = performance.now();
      lastDt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 1 / 60;
      lastNow = now;
      return lastDt;
    },

    getGpuFrameMs() {
      return engine?.gpuFrameTimeMs || 0;
    },

    getScene() {
      return scene;
    },

    getEngine() {
      return {
        runRenderLoop(cb) {
          const loop = () => {
            rafId = requestAnimationFrame(loop);
            cb();
          };
          rafId = requestAnimationFrame(loop);
        },
        stopRenderLoop() {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = 0;
        },
      };
    },

    getCamera() {
      return camera;
    },

    getCameraPose() {
      if (!camera) {
        return {
          x: 0,
          y: 0,
          z: 0,
          billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
        };
      }
      const w = camera.worldMatrix;
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        billboard: {
          rx: w[0],
          ry: w[1],
          rz: w[2],
          ux: w[4],
          uy: w[5],
          uz: w[6],
        },
      };
    },

    getCameraPosition() {
      const p = this.getCameraPose();
      return { x: p.x, y: p.y, z: p.z };
    },

    async toggleInspector() {
      if (!engine || !scene || !canvas) return;
      if (!explorer) {
        const [{ showLiteExplorer }, lite] = await Promise.all([
          import('/vendor/lite-explorer/explorer.js'),
          import('@babylonjs/lite'),
        ]);
        const handle = showLiteExplorer(
          {
            engine,
            scene,
            canvas,
            lite: {
              addToScene: lite.addToScene,
              removeFromScene: lite.removeFromScene,
              setSubtreeVisible: lite.setSubtreeVisible,
              loadGltf: lite.loadGltf,
              playAnimation: lite.playAnimation,
              stopAnimation: lite.stopAnimation,
              createGpuPicker: lite.createGpuPicker,
              disposePicker: lite.disposePicker,
              pickAsync: lite.pickAsync,
              setFog: lite.setFog,
              setSceneImageProcessing: lite.setSceneImageProcessing,
              markMaterialUboDirty: lite.markMaterialUboDirty,
              StandardToneMapping: lite.StandardToneMapping,
              AcesToneMapping: lite.AcesToneMapping,
              NeutralToneMapping: lite.NeutralToneMapping,
            },
          },
          {
            mode: 'overlay',
            layout: 'single',
            theme: 'dark',
            initiallyOpen: false,
            keyboardShortcutsEnabled: false,
            features: { focusSelected: false, canvasPicking: false },
          },
        );
        await handle.ready;
        explorer = {
          open: false,
          async toggle() {
            if (this.open) {
              handle.hide();
              this.open = false;
            } else {
              handle.show();
              this.open = true;
              await handle.refresh();
            }
          },
          dispose() {
            handle.dispose();
          },
        };
      }
      await explorer.toggle();
    },

    setChunkWireframesVisible(on) {
      showChunkWireframes = !!on;
      if (chunkLineGrid) chunkLineGrid.visible = showChunkWireframes;
    },

    toggleChunkWireframes() {
      this.setChunkWireframesVisible(!showChunkWireframes);
      return showChunkWireframes;
    },

    /**
     * @param {{ key: string, cx?: number, cy?: number, cz?: number, minX: number, minY: number, minZ: number, size: number, shell?: boolean, focus?: boolean }[]} chunks
     */
    syncChunkWireframes(chunks) {
      assertReady();
      const shell = chunks.filter((c) => c.shell);
      const focus = chunks.find((c) => c.focus);
      const sig = `${showChunkWireframes}|${shell.length}|${focus?.key ?? ''}`;
      if (sig === chunkLineSignature) {
        if (chunkLineGrid) chunkLineGrid.visible = showChunkWireframes;
        return;
      }
      chunkLineSignature = sig;

      if (chunkLineGrid) {
        removeFromScene(scene, chunkLineGrid);
        chunkLineGrid = null;
      }
      if (!shell.length) return;

      const shellKeys = new Set(shell.map((c) => c.key));
      /** @type {{ x: number, y: number, z: number }[][]} */
      const lines = [];
      const seen = new Set();
      const q = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
      const V = (x, y, z) => ({ x, y, z });
      const edge = (a, b) => {
        const ka = q(a);
        const kb = q(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(key)) return;
        seen.add(key);
        lines.push([a, b]);
      };
      const faceX = (x, y0, y1, z0, z1) => {
        edge(V(x, y0, z0), V(x, y1, z0));
        edge(V(x, y1, z0), V(x, y1, z1));
        edge(V(x, y1, z1), V(x, y0, z1));
        edge(V(x, y0, z1), V(x, y0, z0));
      };
      const faceY = (y, x0, x1, z0, z1) => {
        edge(V(x0, y, z0), V(x1, y, z0));
        edge(V(x1, y, z0), V(x1, y, z1));
        edge(V(x1, y, z1), V(x0, y, z1));
        edge(V(x0, y, z1), V(x0, y, z0));
      };
      const faceZ = (z, x0, x1, y0, y1) => {
        edge(V(x0, y0, z), V(x1, y0, z));
        edge(V(x1, y0, z), V(x1, y1, z));
        edge(V(x1, y1, z), V(x0, y1, z));
        edge(V(x0, y1, z), V(x0, y0, z));
      };

      for (const ch of shell) {
        const { minX, minY, minZ, size: s } = ch;
        const maxX = minX + s;
        const maxY = minY + s;
        const maxZ = minZ + s;
        const cx = ch.cx ?? Number(ch.key.split(',')[0]);
        const cy = ch.cy ?? Number(ch.key.split(',')[1]);
        const cz = ch.cz ?? Number(ch.key.split(',')[2]);
        faceX(minX, minY, maxY, minZ, maxZ);
        faceY(minY, minX, maxX, minZ, maxZ);
        faceZ(minZ, minX, maxX, minY, maxY);
        if (!shellKeys.has(`${cx + 1},${cy},${cz}`)) faceX(maxX, minY, maxY, minZ, maxZ);
        if (!shellKeys.has(`${cx},${cy + 1},${cz}`)) faceY(maxY, minX, maxX, minZ, maxZ);
        if (!shellKeys.has(`${cx},${cy},${cz + 1}`)) faceZ(maxZ, minX, maxX, minY, maxY);
      }

      if (!lines.length) return;
      chunkLineGrid = createLineSystem(engine, {
        name: 'chunkGrid',
        lines,
        color: { r: 0.21, g: 0.21, b: 0.21, a: 1 },
      });
      chunkLineGrid.pickable = false;
      chunkLineGrid.visible = showChunkWireframes;
      addToScene(scene, chunkLineGrid);
    },

    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      explorer?.dispose?.();
      explorer = null;
      for (const { mesh } of species.values()) removeFromScene(scene, mesh);
      species.clear();
      if (chunkLineGrid) removeFromScene(scene, chunkLineGrid);
      chunkLineGrid = null;
      tetras = null;
      if (scene) disposeScene(scene);
      if (engine) disposeEngine(engine);
      scene = null;
      engine = null;
      camera = null;
    },
  };
}
