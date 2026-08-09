/**
 * Babylon.js 9 thin-instance render backend for axiom.
 * Expects global BABYLON from UMD script tags.
 */
import { WAVE_SOURCES } from '../sim/behaviors.js';

/**
 * @returns {import('./backend.js').AxiomRenderer & { getEngine: () => any }}
 */
export function createBabylonBackend() {
  /** @type {any} */
  let engine = null;
  /** @type {any} */
  let scene = null;
  /** @type {any} */
  let camera = null;
  /** @type {HTMLCanvasElement | null} */
  let canvas = null;

  /** @type {Map<string, { mesh: any, capacity: number, bound: boolean }>} */
  const species = new Map();

  /** Classic bobbing tetra field (scenery, not sim particles). */
  /** @type {{ mesh: any, xs: Float32Array, zs: Float32Array, matrices: Float32Array, phase: number } | null} */
  let tetras = null;

  /** Debug wireframes for streamed chunk cubes (shared-edge line grid). */
  /** @type {any} */
  let chunkLineGrid = null;
  /** @type {any} */
  let chunkLineFocus = null;
  let chunkLineSignature = '';
  let showChunkWireframes = true;

  /** Shared hard-circle mask for alphatest billboards (created lazily). */
  let hardCircleTex = null;

  function assertReady() {
    if (!engine || !scene) throw new Error('BabylonBackend: call init() first');
  }

  function getHardCircleTexture(B) {
    if (hardCircleTex) return hardCircleTex;
    const size = 64;
    const tex = new B.DynamicTexture('hardCircle', { width: size, height: size }, scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.fill();
    tex.hasAlpha = true;
    tex.update();
    tex.updateSamplingMode(B.Texture.NEAREST_SAMPLINGMODE);
    hardCircleTex = tex;
    return tex;
  }

  function createTetraField(B) {
    const mesh = B.MeshBuilder.CreatePolyhedron(
      'tetrahedron',
      { type: 0, size: 0.03 },
      scene,
    );
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;

    const xs = [];
    const zs = [];
    for (let ix = -10; ix < 10; ix += 0.75) {
      for (let iz = -10; iz < 10; iz += 0.75) {
        xs.push(ix);
        zs.push(iz);
      }
    }
    const n = xs.length;
    const xsArr = new Float32Array(xs);
    const zsArr = new Float32Array(zs);
    // Angle-add bake: y = cos(x+φ)+sin(z+φ) = a·cosφ + b·sinφ
    const waveA = new Float32Array(n);
    const waveB = new Float32Array(n);
    const matrices = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const x = xsArr[i];
      const z = zsArr[i];
      waveA[i] = Math.cos(x) + Math.sin(z);
      waveB[i] = Math.cos(z) - Math.sin(x);
      const o = i * 16;
      matrices[o] = 1;
      matrices[o + 5] = 1;
      matrices[o + 10] = 1;
      matrices[o + 12] = x;
      matrices[o + 13] = waveA[i]; // phase 0
      matrices[o + 14] = z;
      matrices[o + 15] = 1;
    }
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceCount = n;

    tetras = { mesh, waveA, waveB, matrices, phase: 0 };
  }

  return {
    async init(canvasEl) {
      canvas = canvasEl;
      const B = globalThis.BABYLON;
      if (!B) throw new Error('BABYLON global missing — load vendor/babylon9.js first');

      engine = new B.Engine(canvas, true, {
        preserveDrawingBuffer: false,
        stencil: false,
        adaptToDeviceRatio: true,
      });
      // Timer-query GPU cost — CPU/RAF stay vsync-pinned at ~60 even with headroom.
      try {
        engine.captureGPUFrameTime?.(true);
      } catch {
        /* optional */
      }
      scene = new B.Scene(engine);
      scene.clearColor = new B.Color3(0.1, 0.1, 0.1);
      scene.shadowsEnabled = false;

      camera = new B.FreeCamera('camera', new B.Vector3(0, 5, -5), scene);
      camera.setTarget(B.Vector3.Zero());
      camera.speed = 5.5;
      // Canvas must be focusable for FreeCamera keyboard input
      canvas.tabIndex = 0;
      canvas.style.outline = 'none';
      canvas.addEventListener('pointerdown', () => canvas.focus());
      camera.attachControl(canvas, true);
      // ESDF (not WASD) — keyCode: E=69 S=83 D=68 F=70; arrows as fallback
      camera.keysUp = [69, 38]; // E, ↑
      camera.keysDown = [68, 40]; // D, ↓
      camera.keysLeft = [83, 37]; // S, ←
      camera.keysRight = [70, 39]; // F, →
      // Vertical: R up, C down (keep hand on ESDF row)
      camera.keysUpward = [82]; // R
      camera.keysDownward = [67]; // C
      canvas.focus();

      const light = new B.DirectionalLight(
        'DirectionalLight',
        new B.Vector3(-0.5, -1, -1.25),
        scene,
      );
      light.intensity = 0.8;

      const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
      hemi.intensity = 0.35;

      const matGrass = new B.StandardMaterial('matGrass', scene);
      matGrass.diffuseColor = new B.Color3(0.4, 0.4, 0.4);
      const grass = './assets/untitled-q.png';
      matGrass.emissiveTexture = new B.Texture(grass, scene);
      matGrass.ambientTexture = new B.Texture(grass, scene);

      const grounds = [];
      {
        const g = B.MeshBuilder.CreateGround('ground', { height: 42, width: 42, subdivisions: 2 }, scene);
        g.position.y = -2;
        grounds.push(g);
      }
      {
        const g = B.MeshBuilder.CreateGround('roof', { height: 16, width: 16, subdivisions: 2 }, scene);
        g.position.y = 16;
        g.rotation.x = Math.PI;
        grounds.push(g);
      }
      for (const g of grounds) {
        g.material = matGrass;
        g.receiveShadows = false;
      }

      const matChaos = new B.StandardMaterial('matChaos', scene);
      matChaos.diffuseColor = new B.Color3(0.4, 0.4, 0.4);
      matChaos.emissiveTexture = new B.Texture('./assets/sphere-q.jpg', scene);
      matChaos.ambientTexture = matChaos.emissiveTexture;
      matChaos.wireframe = true;
      const s0 = B.MeshBuilder.CreateIcoSphere('icosphere', { radius: 1, subdivisions: 3 }, scene);
      s0.position.set(WAVE_SOURCES[0].x, WAVE_SOURCES[0].y, WAVE_SOURCES[0].z);
      s0.material = matChaos;
      const s1 = B.MeshBuilder.CreateIcoSphere('icosphere2', { radius: 1, subdivisions: 3 }, scene);
      s1.position.set(WAVE_SOURCES[1].x, WAVE_SOURCES[1].y, WAVE_SOURCES[1].z);
      s1.material = matChaos;

      createTetraField(B);
    },

    /** Bob the classic tetra grid — call once per frame. */
    tickScenery() {
      if (!tetras) return;
      // Match original gY += 0.00314 per frame (not dt-scaled)
      tetras.phase += 0.00314;
      const { waveA, waveB, matrices, mesh, phase } = tetras;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const n = waveA.length;
      for (let i = 0; i < n; i++) {
        matrices[i * 16 + 13] = waveA[i] * c + waveB[i] * s;
      }
      mesh.thinInstanceBufferUpdated('matrix');
    },

    resize() {
      engine?.resize();
    },

    /**
     * @param {{ id: string, meshKind?: string, capacity: number, size?: number, tint?: { r: number, g: number, b: number }, hardCircle?: boolean }} spec
     */
    registerSpecies(spec) {
      assertReady();
      const B = globalThis.BABYLON;
      if (species.has(spec.id)) return;

      const kind = spec.meshKind || 'plane';
      const size = spec.size ?? 0.05;
      const cap = Math.max(1, spec.capacity | 0);
      const tint = spec.tint || { r: 1, g: 1, b: 1 };
      const hardCircle = !!spec.hardCircle || kind === 'plane';

      const mat = new B.StandardMaterial(`mat_${spec.id}`, scene);
      mat.emissiveColor = new B.Color3(tint.r, tint.g, tint.b);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.useVertexColor = true;
      mat.transparencyMode = B.Material.MATERIAL_OPAQUE;
      mat.alpha = 1;

      /** @type {any} */
      let mesh;
      let mode = 'thin'; // 'thin' | 'points'

      if (kind === 'point') {
        // True GL points (1×1 device pixel). Note: GL_POINTS are square pixels, not circles.
        mode = 'points';
        mesh = new B.Mesh(`species_${spec.id}`, scene);
        const positions = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i++) positions[i * 3 + 1] = -9999;
        const vd = new B.VertexData();
        vd.positions = positions;
        vd.applyToMesh(mesh, true);
        mat.pointsCloud = true;
        mat.fillMode = B.Material.PointFillMode;
        mat.pointSize = 1;
        mat.useVertexColor = false;
        mat.transparencyMode = B.Material.MATERIAL_OPAQUE;
        mat.alpha = 1;
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.doNotSyncBoundingInfo = true;
        // All slots start parked; upload only rewrites live + newly freed tails.
        species.set(spec.id, {
          mesh,
          capacity: cap,
          bound: false,
          mode,
          positions,
          liveCount: 0,
        });
        return;
      }

      if (kind === 'triangle') {
        mesh = new B.Mesh(`species_${spec.id}`, scene);
        const h = size;
        const vd = new B.VertexData();
        vd.positions = [0, h, 0, -h * 0.86, -h * 0.5, 0, h * 0.86, -h * 0.5, 0];
        vd.indices = [0, 1, 2];
        vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
        vd.applyToMesh(mesh);
        // Facing baked into thin-instance matrices (mesh billboardMode fights thin instances)
      } else if (kind === 'tetra') {
        mesh = B.MeshBuilder.CreatePolyhedron(
          `species_${spec.id}`,
          { type: 0, size: size },
          scene,
        );
        // True 3D volume — no billboard
      } else {
        // plane / quad — hard-edge circle via alphatest (discard), not soft blend
        mesh = B.MeshBuilder.CreatePlane(
          `species_${spec.id}`,
          { width: size, height: size },
          scene,
        );
        // Facing baked into thin-instance matrices (mesh billboardMode fights thin instances)
        if (hardCircle) {
          const circle = getHardCircleTexture(B);
          mat.opacityTexture = circle;
          mat.emissiveTexture = circle;
          // Cutout only — discard corners. Not soft alphablend.
          mat.transparencyMode = B.Material.MATERIAL_ALPHATEST;
          mat.alphaCutOff = 0.5;
          mat.useAlphaFromDiffuseTexture = false;
          mat.alpha = 1;
        }
      }

      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.thinInstanceEnablePicking = false;

      species.set(spec.id, { mesh, capacity: cap, bound: false, mode });
    },

    /**
     * @param {{ id: string, count: number, matrices?: Float32Array, colors?: Float32Array, positions?: Float32Array }} upload
     */
    uploadSpecies(upload) {
      const entry = species.get(upload.id);
      if (!entry) return;
      const { mesh, capacity, mode } = entry;
      const count = Math.max(0, Math.min(capacity, upload.count | 0));

      if (mode === 'points') {
        if (!upload.positions) return;
        const dst = entry.positions;
        const prev = entry.liveCount | 0;
        dst.set(upload.positions.subarray(0, count * 3));
        // Only park the shrink gap — old path looped count→capacity (~200k) every frame.
        if (count < prev) {
          for (let i = count; i < prev; i++) {
            const p = i * 3;
            dst[p] = 0;
            dst[p + 1] = -9999;
            dst[p + 2] = 0;
          }
        }
        entry.liveCount = count;
        mesh.updateVerticesData(globalThis.BABYLON.VertexBuffer.PositionKind, dst);
        mesh.setEnabled(count > 0);
        return;
      }

      if (!upload.matrices) return;
      if (!entry.bound) {
        mesh.thinInstanceSetBuffer('matrix', upload.matrices, 16, false);
        if (upload.colors) {
          mesh.thinInstanceSetBuffer('color', upload.colors, 4, false);
        }
        entry.bound = true;
      } else {
        mesh.thinInstanceBufferUpdated('matrix');
        if (upload.colors) mesh.thinInstanceBufferUpdated('color');
      }
      mesh.thinInstanceCount = count;
    },

    render() {
      scene?.render();
    },

    getDeltaTime() {
      return engine ? engine.getDeltaTime() / 1000 : 0;
    },

    /**
     * GPU frame cost in ms (last-sec average). 0 if timer queries unavailable.
     * This is what throttle should use — not RAF/CPU dt under vsync.
     */
    getGpuFrameMs() {
      if (!engine?.getGPUFrameTimeCounter) return 0;
      try {
        const c = engine.getGPUFrameTimeCounter();
        // Babylon PerfCounter stores GPU time in nanoseconds
        const ns = c?.lastSecAverage || c?.average || 0;
        return ns > 0 ? ns / 1e6 : 0;
      } catch {
        return 0;
      }
    },

    getScene() {
      return scene;
    },

    getEngine() {
      return engine;
    },

    getCamera() {
      return camera;
    },

    /**
     * Camera pose for chunk streaming + CPU billboards (thin-instance safe).
     * @returns {{ x: number, y: number, z: number, billboard: { rx: number, ry: number, rz: number, ux: number, uy: number, uz: number } }}
     */
    getCameraPose() {
      if (!camera) {
        return {
          x: 0,
          y: 0,
          z: 0,
          billboard: { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 },
        };
      }
      const B = globalThis.BABYLON;
      const right = camera.getDirection(B.Axis.X);
      const up = camera.getDirection(B.Axis.Y);
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        billboard: {
          rx: right.x,
          ry: right.y,
          rz: right.z,
          ux: up.x,
          uy: up.y,
          uz: up.z,
        },
      };
    },

    /** @deprecated use getCameraPose */
    getCameraPosition() {
      const p = this.getCameraPose();
      return { x: p.x, y: p.y, z: p.z };
    },

    setChunkWireframesVisible(on) {
      showChunkWireframes = !!on;
      if (chunkLineGrid) chunkLineGrid.setEnabled(showChunkWireframes);
      if (chunkLineFocus) chunkLineFocus.setEnabled(showChunkWireframes);
    },

    toggleChunkWireframes() {
      this.setChunkWireframesVisible(!showChunkWireframes);
      return showChunkWireframes;
    },

    /**
     * Sync chunk outlines for the furthest shell only (no near-field cages).
     * True box edges, deduped; exterior faces of the active volume.
     * @param {{ key: string, cx?: number, cy?: number, cz?: number, minX: number, minY: number, minZ: number, size: number, shell?: boolean }[]} chunks
     */
    syncChunkWireframes(chunks) {
      assertReady();
      const B = globalThis.BABYLON;

      // Only the outermost Chebyshev layer. Caller should skip when chunksVersion unchanged;
      // keep a cheap focus+count sig as a backstop (no sort/join of hundreds of keys).
      const shell = chunks.filter((c) => c.shell);
      const focus = chunks.find((c) => c.focus);
      const sig = `${showChunkWireframes}|${shell.length}|${focus?.key ?? ''}`;
      if (sig === chunkLineSignature) {
        if (chunkLineGrid) chunkLineGrid.setEnabled(showChunkWireframes);
        return;
      }
      chunkLineSignature = sig;

      chunkLineGrid?.dispose();
      chunkLineFocus?.dispose();
      chunkLineGrid = null;
      chunkLineFocus = null;

      if (!shell.length) return;

      // Neighbor tests among shell cubes only (so we still see the far layer's grid)
      const shellKeys = new Set(shell.map((c) => c.key));
      /** @type {any[][]} */
      const gridLines = [];

      const V = (x, y, z) => new B.Vector3(x, y, z);
      const edge = (list, a, b) => list.push([a, b]);

      const faceX = (list, x, y0, y1, z0, z1) => {
        edge(list, V(x, y0, z0), V(x, y1, z0));
        edge(list, V(x, y1, z0), V(x, y1, z1));
        edge(list, V(x, y1, z1), V(x, y0, z1));
        edge(list, V(x, y0, z1), V(x, y0, z0));
      };
      const faceY = (list, y, x0, x1, z0, z1) => {
        edge(list, V(x0, y, z0), V(x1, y, z0));
        edge(list, V(x1, y, z0), V(x1, y, z1));
        edge(list, V(x1, y, z1), V(x0, y, z1));
        edge(list, V(x0, y, z1), V(x0, y, z0));
      };
      const faceZ = (list, z, x0, x1, y0, y1) => {
        edge(list, V(x0, y0, z), V(x1, y0, z));
        edge(list, V(x1, y0, z), V(x1, y1, z));
        edge(list, V(x1, y1, z), V(x0, y1, z));
        edge(list, V(x0, y1, z), V(x0, y0, z));
      };

      for (const ch of shell) {
        const { minX, minY, minZ, size: s } = ch;
        const maxX = minX + s;
        const maxY = minY + s;
        const maxZ = minZ + s;
        const cx = ch.cx ?? Number(ch.key.split(',')[0]);
        const cy = ch.cy ?? Number(ch.key.split(',')[1]);
        const cz = ch.cz ?? Number(ch.key.split(',')[2]);

        // Full cube on the far layer: own -faces; +faces if no shell neighbor
        faceX(gridLines, minX, minY, maxY, minZ, maxZ);
        faceY(gridLines, minY, minX, maxX, minZ, maxZ);
        faceZ(gridLines, minZ, minX, maxX, minY, maxY);
        if (!shellKeys.has(`${cx + 1},${cy},${cz}`)) faceX(gridLines, maxX, minY, maxY, minZ, maxZ);
        if (!shellKeys.has(`${cx},${cy + 1},${cz}`)) faceY(gridLines, maxY, minX, maxX, minZ, maxZ);
        if (!shellKeys.has(`${cx},${cy},${cz + 1}`)) faceZ(gridLines, maxZ, minX, maxX, minY, maxY);
      }

      const dedupe = (lines) => {
        const seen = new Set();
        const out = [];
        const q = (v) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
        for (const [a, b] of lines) {
          const ka = q(a);
          const kb = q(b);
          const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([a, b]);
        }
        return out;
      };

      const g = dedupe(gridLines);
      if (g.length) {
        chunkLineGrid = B.MeshBuilder.CreateLineSystem(
          'chunkGrid',
          { lines: g, updatable: false },
          scene,
        );
        chunkLineGrid.color = new B.Color3(0.21, 0.21, 0.21);
        chunkLineGrid.isPickable = false;
        chunkLineGrid.setEnabled(showChunkWireframes);
      }
    },

    dispose() {
      for (const { mesh } of species.values()) mesh.dispose();
      species.clear();
      chunkLineGrid?.dispose();
      chunkLineFocus?.dispose();
      chunkLineGrid = null;
      chunkLineFocus = null;
      tetras?.mesh.dispose();
      tetras = null;
      scene?.dispose();
      engine?.dispose();
      scene = null;
      engine = null;
    },
  };
}
