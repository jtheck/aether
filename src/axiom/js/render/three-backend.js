/**
 * Three.js render backend for axiom (ES module vendor).
 * Same de-facto port as babylon-backend — sim stays engine-agnostic.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { WAVE_SOURCES } from '../sim/behaviors.js';

/**
 * @returns {import('./backend.js').AxiomRenderer & {
 *   getEngine: () => { runRenderLoop: (cb: () => void) => void },
 *   getCamera: () => any,
 *   getCameraPose: () => any,
 *   tickScenery: () => void,
 *   syncChunkWireframes: (chunks: any[]) => void,
 *   toggleChunkWireframes: () => boolean,
 * }}
 */
export function createThreeBackend() {
  /** @type {THREE.WebGLRenderer | null} */
  let renderer = null;
  /** @type {THREE.Scene | null} */
  let scene = null;
  /** @type {THREE.PerspectiveCamera | null} */
  let camera = null;
  /** @type {HTMLCanvasElement | null} */
  let canvas = null;
  /** @type {THREE.Clock | null} */
  let clock = null;

  /** @type {Map<string, any>} */
  const species = new Map();

  /** @type {{ mesh: THREE.InstancedMesh, waveA: Float32Array, waveB: Float32Array, matrices: Float32Array, phase: number } | null} */
  let tetras = null;

  /** @type {THREE.LineSegments | null} */
  let chunkLineGrid = null;
  let chunkLineSignature = '';
  let showChunkWireframes = true;

  /** @type {THREE.CanvasTexture | null} */
  let hardCircleTex = null;

  // Fly controls (ESDF + R/C, pointer-drag look) — Babylon FreeCamera equivalent
  const keys = new Set();
  let yaw = 0;
  let pitch = -0.7;
  let dragging = false;
  let lastPtrX = 0;
  let lastPtrY = 0;
  const lookSens = 0.0022;
  // Match BABYLON.FreeCamera defaults (speed + inertia) so ESDF feels the same.
  const moveSpeed = 5.5;
  const moveInertia = 0.9;
  const velocity = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  let stickX = 0;
  let stickZ = 0;
  let rafId = 0;

  function assertReady() {
    if (!renderer || !scene || !camera) throw new Error('ThreeBackend: call init() first');
  }

  function getHardCircleTexture() {
    if (hardCircleTex) return hardCircleTex;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    hardCircleTex = tex;
    return tex;
  }

  function applyCameraOrientation() {
    if (!camera) return;
    const maxPitch = Math.PI / 2 - 0.01;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function tickFly(dt) {
    if (!camera) return;
    // FreeCamera._computeLocalCameraSpeed: speed * sqrt(dtMs / (100 * fps))
    const dtMs = Math.max(0, dt) * 1000;
    const fps = dt > 1e-6 ? 1 / dt : 60;
    const localSpeed = moveSpeed * Math.sqrt(dtMs / (100 * fps));

    camera.getWorldDirection(forward);
    right.crossVectors(forward, camera.up).normalize();

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
      mx /= len;
      my /= len;
      mz /= len;
      wish
        .copy(forward)
        .multiplyScalar(mz)
        .addScaledVector(right, mx);
      wish.y += my;
      if (wish.lengthSq() > 1e-8) wish.normalize().multiplyScalar(localSpeed);
      else wish.set(0, 0, 0);
      velocity.add(wish);
    }

    camera.position.add(velocity);
    velocity.multiplyScalar(moveInertia);
  }

  function createTetraField() {
    const geo = new THREE.TetrahedronGeometry(0.03);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.7,
      metalness: 0.05,
    });
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
    const waveA = new Float32Array(n);
    const waveB = new Float32Array(n);
    const matrices = new Float32Array(n * 16);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const x = xsArr[i];
      const z = zsArr[i];
      waveA[i] = Math.cos(x) + Math.sin(z);
      waveB[i] = Math.cos(z) - Math.sin(x);
      m.makeTranslation(x, waveA[i], z);
      m.toArray(matrices, i * 16);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = n;
    scene.add(mesh);
    tetras = { mesh, waveA, waveB, matrices, phase: 0 };
  }

  function makeSpeciesMaterial(tint, hardCircle) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tint.r, tint.g, tint.b),
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexColors: false,
    });
    if (hardCircle) {
      const circle = getHardCircleTexture();
      mat.map = circle;
      mat.alphaMap = circle;
      mat.alphaTest = 0.5;
      mat.transparent = false;
      mat.depthWrite = true;
    }
    return mat;
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

  function copyColorsRgb(dst, src, count) {
    for (let i = 0; i < count; i++) {
      const s = i * 4;
      const d = i * 3;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
    }
  }

  return {
    async init(canvasEl) {
      canvas = canvasEl;
      canvas.tabIndex = 0;
      canvas.style.outline = 'none';
      canvas.addEventListener('pointerdown', () => canvas.focus());

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
      renderer.setClearColor(0x1a1a1a, 1);

      scene = new THREE.Scene();
      clock = new THREE.Clock();

      camera = new THREE.PerspectiveCamera(
        60,
        (canvas.clientWidth || window.innerWidth) / Math.max(1, canvas.clientHeight || window.innerHeight),
        0.1,
        2000,
      );
      camera.position.set(0, 5, -5);
      yaw = 0;
      pitch = -0.7;
      applyCameraOrientation();

      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(-0.5, 1, -1.25);
      scene.add(dir);
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));

      const texLoader = new THREE.TextureLoader();
      const grassTex = texLoader.load('./assets/untitled-q.png');
      grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
      const matGrass = new THREE.MeshStandardMaterial({
        color: 0x666666,
        map: grassTex,
        emissiveMap: grassTex,
        emissive: 0x444444,
        roughness: 1,
      });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(42, 42, 2, 2), matGrass);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -2;
      scene.add(ground);
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(16, 16, 2, 2), matGrass);
      roof.rotation.x = Math.PI / 2;
      roof.position.y = 16;
      scene.add(roof);

      const chaosTex = texLoader.load('./assets/sphere-q.jpg');
      const matChaos = new THREE.MeshBasicMaterial({
        color: 0x666666,
        map: chaosTex,
        wireframe: true,
      });
      const s0 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), matChaos);
      s0.position.set(WAVE_SOURCES[0].x, WAVE_SOURCES[0].y, WAVE_SOURCES[0].z);
      scene.add(s0);
      const s1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), matChaos);
      s1.position.set(WAVE_SOURCES[1].x, WAVE_SOURCES[1].y, WAVE_SOURCES[1].z);
      scene.add(s1);

      createTetraField();

      window.addEventListener('keydown', (e) => {
        keys.add(e.code);
      });
      window.addEventListener('keyup', (e) => {
        keys.delete(e.code);
      });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        lastPtrX = e.clientX;
        lastPtrY = e.clientY;
        canvas.setPointerCapture?.(e.pointerId);
        canvas.focus();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastPtrX;
        const dy = e.clientY - lastPtrY;
        lastPtrX = e.clientX;
        lastPtrY = e.clientY;
        yaw -= dx * lookSens;
        pitch -= dy * lookSens;
        applyCameraOrientation();
      });
      const endDrag = (e) => {
        dragging = false;
        canvas.releasePointerCapture?.(e.pointerId);
      };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);

      attachMobileStick();
      canvas.focus();
    },

    tickScenery() {
      if (!tetras) return;
      tetras.phase += 0.00314;
      const { waveA, waveB, matrices, mesh, phase } = tetras;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const n = waveA.length;
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        matrices[o + 13] = waveA[i] * c + waveB[i] * s;
        m.fromArray(matrices, o);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },

    resize() {
      if (!renderer || !camera || !canvas) return;
      const w = canvas.clientWidth || window.innerWidth;
      const h = Math.max(1, canvas.clientHeight || window.innerHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
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

      if (kind === 'point') {
        const positions = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i++) positions[i * 3 + 1] = -9999;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.PointsMaterial({
          color: new THREE.Color(tint.r, tint.g, tint.b),
          size: 1,
          sizeAttenuation: false,
          toneMapped: false,
        });
        const mesh = new THREE.Points(geo, mat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        species.set(spec.id, {
          mesh,
          capacity: cap,
          bound: false,
          mode: 'points',
          positions,
          liveCount: 0,
        });
        return;
      }

      /** @type {THREE.BufferGeometry} */
      let geo;
      if (kind === 'triangle') {
        const h = size;
        geo = new THREE.BufferGeometry();
        const verts = new Float32Array([0, h, 0, -h * 0.86, -h * 0.5, 0, h * 0.86, -h * 0.5, 0]);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.setIndex([0, 1, 2]);
        geo.computeVertexNormals();
      } else if (kind === 'tetra') {
        geo = new THREE.TetrahedronGeometry(size);
      } else {
        geo = new THREE.PlaneGeometry(size, size);
      }

      const mat = makeSpeciesMaterial(tint, hardCircle && kind !== 'triangle' && kind !== 'tetra');
      // Instance colors override base tint when provided
      mat.vertexColors = false;

      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.frustumCulled = false;
      mesh.count = 0;
      // Identity park (unused slots not drawn via count)
      scene.add(mesh);

      const colorArr = new Float32Array(cap * 3);
      species.set(spec.id, {
        mesh,
        capacity: cap,
        bound: false,
        mode: 'instanced',
        colorArr,
        tmpMatrix: new THREE.Matrix4(),
      });
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
        if (count < prev) {
          for (let i = count; i < prev; i++) {
            const p = i * 3;
            dst[p] = 0;
            dst[p + 1] = -9999;
            dst[p + 2] = 0;
          }
        }
        entry.liveCount = count;
        const attr = mesh.geometry.getAttribute('position');
        attr.needsUpdate = true;
        mesh.geometry.setDrawRange(0, count);
        mesh.visible = count > 0;
        return;
      }

      if (!upload.matrices) return;
      // Column-major 4×4 matches Three.Matrix4 / InstancedMesh.instanceMatrix
      mesh.instanceMatrix.array.set(upload.matrices.subarray(0, count * 16));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.count = count;

      if (upload.colors) {
        if (!mesh.instanceColor) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(entry.colorArr, 3);
        }
        copyColorsRgb(entry.colorArr, upload.colors, count);
        mesh.instanceColor.needsUpdate = true;
        if (mesh.material && !mesh.material.vertexColors) {
          // InstancedMesh uses instanceColor when present; keep material ready
          mesh.material.needsUpdate = true;
        }
      }
      entry.bound = true;
    },

    render() {
      if (!renderer || !scene || !camera) return;
      // app.js samples getDeltaTime() before render — fly with that cached dt
      tickFly(this._lastDt ?? 1 / 60);
      renderer.render(scene, camera);
    },

    getDeltaTime() {
      // Clock.getDelta advances; app calls this once per frame before render()
      this._lastDt = clock ? clock.getDelta() : 1 / 60;
      return this._lastDt;
    },

    getScene() {
      return scene;
    },

    getEngine() {
      const self = this;
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
        // unused — keeps parity for callers poking engine
        getDeltaTime: () => (self._lastDt ?? 0) * 1000,
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
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        billboard: {
          rx: e[0],
          ry: e[1],
          rz: e[2],
          ux: e[4],
          uy: e[5],
          uz: e[6],
        },
      };
    },

    getCameraPosition() {
      const p = this.getCameraPose();
      return { x: p.x, y: p.y, z: p.z };
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
        scene.remove(chunkLineGrid);
        chunkLineGrid.geometry.dispose();
        chunkLineGrid.material.dispose();
        chunkLineGrid = null;
      }
      if (!shell.length) return;

      const shellKeys = new Set(shell.map((c) => c.key));
      /** @type {number[]} */
      const positions = [];
      const seen = new Set();
      const q = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      const edge = (ax, ay, az, bx, by, bz) => {
        const ka = q(ax, ay, az);
        const kb = q(bx, by, bz);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(key)) return;
        seen.add(key);
        positions.push(ax, ay, az, bx, by, bz);
      };
      const faceX = (x, y0, y1, z0, z1) => {
        edge(x, y0, z0, x, y1, z0);
        edge(x, y1, z0, x, y1, z1);
        edge(x, y1, z1, x, y0, z1);
        edge(x, y0, z1, x, y0, z0);
      };
      const faceY = (y, x0, x1, z0, z1) => {
        edge(x0, y, z0, x1, y, z0);
        edge(x1, y, z0, x1, y, z1);
        edge(x1, y, z1, x0, y, z1);
        edge(x0, y, z1, x0, y, z0);
      };
      const faceZ = (z, x0, x1, y0, y1) => {
        edge(x0, y0, z, x1, y0, z);
        edge(x1, y0, z, x1, y1, z);
        edge(x1, y1, z, x0, y1, z);
        edge(x0, y1, z, x0, y0, z);
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

      if (!positions.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x363636 });
      chunkLineGrid = new THREE.LineSegments(geo, mat);
      chunkLineGrid.frustumCulled = false;
      chunkLineGrid.visible = showChunkWireframes;
      scene.add(chunkLineGrid);
    },

    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      for (const entry of species.values()) {
        scene?.remove(entry.mesh);
        entry.mesh.geometry?.dispose?.();
        entry.mesh.material?.dispose?.();
      }
      species.clear();
      if (chunkLineGrid) {
        scene?.remove(chunkLineGrid);
        chunkLineGrid.geometry.dispose();
        chunkLineGrid.material.dispose();
        chunkLineGrid = null;
      }
      if (tetras) {
        scene?.remove(tetras.mesh);
        tetras.mesh.geometry.dispose();
        tetras.mesh.material.dispose();
        tetras = null;
      }
      hardCircleTex?.dispose();
      hardCircleTex = null;
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
      clock = null;
    },

    _lastDt: 1 / 60,
  };
}
