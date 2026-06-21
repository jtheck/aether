// render/ — Babylon Lite view layer.
//
// PARTITION: render/ READS simulation state and never mutates it. It knows
// nothing about gameplay rules; it just draws whatever positions it is handed.
// The sim could be swapped, re-seeded, or run in a worker and this file wouldn't
// care.
//
// Entities are drawn as a single thin-instanced mesh — one draw call for the
// whole army. The instance matrix slab is filled straight from interpolated
// SoA positions by the caller (app/), which is why the sim's Structure-of-Arrays
// layout matters here too.

import {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  attachControl,
  createHemisphericLight,
  createDirectionalLight,
  createSphere,
  createGround,
  createCylinder,
  createStandardMaterial,
  addToScene,
  setThinInstances,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceColor,
  onBeforeRender,
  registerScene,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
} from '../vendor/lite/liteVendor.js';

// Column-major mat4 * vec4.
function matVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// MMB pans, Alt+LMB orbits. Inertia is applied by attachControl's beforeRender hook.
function setupRtsCameraControls(camera, canvas) {
  const angularSensibility = 1000;
  const panningSensibility = 50;
  let mode = 0; // 0 none, 1 pan, 2 orbit
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1) {
      mode = 1;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (e.button === 0 && e.altKey) {
      mode = 2;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mode === 0) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 1) {
      camera.inertialPanningX += -dx / panningSensibility;
      camera.inertialPanningY += dy / panningSensibility;
    } else if (mode === 2) {
      camera.inertialAlphaOffset -= dx / angularSensibility;
      camera.inertialBetaOffset -= dy / angularSensibility;
    }
  });

  const endDrag = (e) => {
    if (mode === 0) return;
    if (e.button === 1 && mode === 1) mode = 0;
    if (e.button === 0 && mode === 2) mode = 0;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
}

// Picking helpers — copied from Lite's createPickingRay (not exported from the package).
function pickingRay(canvasX, canvasY, vp, width, height) {
  const inv = mat4Invert(vp);
  if (!inv) return null;
  const ndcX = (2 * canvasX) / width - 1;
  const ndcY = 1 - (2 * canvasY) / height;
  const near = unproject(inv, ndcX, ndcY, 1);
  const far = unproject(inv, ndcX, ndcY, 0);
  const dx = far[0] - near[0];
  const dy = far[1] - near[1];
  const dz = far[2] - near[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-10) return null;
  return {
    ox: near[0],
    oy: near[1],
    oz: near[2],
    dx: dx / len,
    dy: dy / len,
    dz: dz / len,
  };
}

function unproject(inv, ndcX, ndcY, depth) {
  const x = inv[0] * ndcX + inv[4] * ndcY + inv[8] * depth + inv[12];
  const y = inv[1] * ndcX + inv[5] * ndcY + inv[9] * depth + inv[13];
  const z = inv[2] * ndcX + inv[6] * ndcY + inv[10] * depth + inv[14];
  const w = inv[3] * ndcX + inv[7] * ndcY + inv[11] * depth + inv[15];
  const iw = 1 / w;
  return [x * iw, y * iw, z * iw];
}

function rayHitSphere(ray, cx, cy, cz, radius) {
  const lx = ray.ox - cx;
  const ly = ray.oy - cy;
  const lz = ray.oz - cz;
  const b = 2 * (ray.dx * lx + ray.dy * ly + ray.dz * lz);
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  let t = (-b - root) * 0.5;
  if (t < 0) t = (-b + root) * 0.5;
  return t >= 0 ? t : null;
}

function rayHitGround(ray) {
  if (Math.abs(ray.dy) < 1e-8) return null;
  const t = -ray.oy / ray.dy;
  if (t < 0) return null;
  return { x: ray.ox + ray.dx * t, z: ray.oz + ray.dz * t };
}

// Upload thin-instance CPU slabs to GPU before the cached opaque bundle replays.
function uploadThinInstanceGpu(engine, ti, hasColor) {
  if (!ti) return;
  const BU = globalThis.GPUBufferUsage;
  const device = engine._device;
  const needsStorage = ti._gpuCullingEnabled;

  if (ti._version !== ti._gpuVersion || ti._gpuBufferStorage !== needsStorage) {
    const byteSize = ti.count * 64;
    let bufferRecreated = false;
    if (!ti._gpuBuffer || ti._gpuBuffer.size < byteSize || ti._gpuBufferStorage !== needsStorage) {
      ti._gpuBuffer?.destroy();
      ti._gpuBuffer = device.createBuffer({
        size: Math.max(ti._capacity * 64, 4),
        usage: BU.VERTEX | BU.COPY_DST | BU.STORAGE,
      });
      ti._gpuBufferStorage = needsStorage;
      bufferRecreated = true;
    }
    const dirtyMin = bufferRecreated ? 0 : ti._dirtyMin;
    const dirtyMax = bufferRecreated ? ti.count : Math.min(ti._dirtyMax, ti.count);
    if (dirtyMax > dirtyMin) {
      const minByte = dirtyMin * 64;
      device.queue.writeBuffer(
        ti._gpuBuffer,
        minByte,
        ti.matrices.buffer,
        ti.matrices.byteOffset + minByte,
        (dirtyMax - dirtyMin) * 64,
      );
    }
    ti._dirtyMin = ti.count;
    ti._dirtyMax = 0;
    ti._gpuVersion = ti._version;
  }

  if (hasColor && ti.colors) {
    if (ti._colorVersion !== ti._colorGpuVersion || ti._colorGpuBufferStorage !== needsStorage) {
      const colorByteSize = ti.count * 16;
      let colorRecreated = false;
      if (!ti._colorGpuBuffer || ti._colorGpuBuffer.size < colorByteSize || ti._colorGpuBufferStorage !== needsStorage) {
        ti._colorGpuBuffer?.destroy();
        ti._colorGpuBuffer = device.createBuffer({
          size: Math.max(ti._capacity * 16, 4),
          usage: BU.VERTEX | BU.COPY_DST | (needsStorage ? BU.STORAGE : 0),
        });
        ti._colorGpuBufferStorage = needsStorage;
        colorRecreated = true;
      }
      const cMin = colorRecreated ? 0 : ti._colorDirtyMin;
      const cMax = colorRecreated ? ti.count : Math.min(ti._colorDirtyMax, ti.count);
      if (cMax > cMin) {
        device.queue.writeBuffer(
          ti._colorGpuBuffer,
          cMin * 16,
          ti.colors.buffer,
          ti.colors.byteOffset + cMin * 16,
          (cMax - cMin) * 16,
        );
      }
      ti._colorDirtyMin = ti.count;
      ti._colorDirtyMax = 0;
      ti._colorGpuVersion = ti._colorVersion;
    }
  }
}

export async function createRenderer(canvas, capacity) {
  const engine = await createEngine(canvas, { msaaSamples: 1 });
  const scene = createSceneContext(engine);

  const camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, 620, { x: 0, y: 0, z: 0 });
  scene.camera = camera;
  // Wheel zoom only — LMB/RMB belong to RTS selection/orders (see setupRtsCameraControls).
  attachControl(camera, canvas, scene, { shouldHandlePointerDown: () => false });
  setupRtsCameraControls(camera, canvas);

  addToScene(scene, createHemisphericLight([0, 1, 0], 0.55));
  const sun = createDirectionalLight([-0.4, -1, -0.3], 1.0);
  sun.diffuse = [1, 0.96, 0.88];
  addToScene(scene, sun);

  const groundMat = createStandardMaterial();
  groundMat.diffuseColor = [0.18, 0.28, 0.16];
  const ground = createGround(engine, { width: 800, height: 800 });
  ground.material = groundMat;
  addToScene(scene, ground);

  const marker = createSphere(engine, { diameter: 6, segments: capacity > 500 ? 6 : 10 });
  const material = createStandardMaterial();
  material.diffuseColor = [1, 1, 1];
  marker.material = material;

  const BASE_DIAMETER = 6;

  // 16 floats (a 4x4 world matrix) per instance.
  const matrices = new Float32Array(16 * capacity);
  setThinInstances(marker, matrices, capacity);
  // Pipeline must see instance colors before registerScene or tints never compile in.
  const instanceColors = new Float32Array(4 * capacity);
  for (let i = 0; i < capacity; i++) {
    instanceColors[i * 4] = 1;
    instanceColors[i * 4 + 1] = 1;
    instanceColors[i * 4 + 2] = 1;
    instanceColors[i * 4 + 3] = 1;
  }
  setThinInstanceColors(marker, instanceColors);
  addToScene(scene, marker);

  // Flat selection rings (thin-instanced cylinders on the ground).
  const RING_DIAM = 1;
  const RING_H = 0.12;
  const selRing = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 24 });
  const ringMat = createStandardMaterial();
  ringMat.diffuseColor = [1, 0.92, 0.15];
  ringMat.emissiveColor = [1, 0.85, 0.1];
  ringMat.alpha = 0.9;
  selRing.material = ringMat;
  const ringMatrices = new Float32Array(16 * capacity);
  setThinInstances(selRing, ringMatrices, capacity);
  const ringColors = new Float32Array(4 * capacity);
  for (let i = 0; i < capacity; i++) {
    ringColors[i * 4] = 1;
    ringColors[i * 4 + 1] = 0.92;
    ringColors[i * 4 + 2] = 0.15;
    ringColors[i * 4 + 3] = 0.85;
  }
  setThinInstanceColors(selRing, ringColors);
  addToScene(scene, selRing);

  // Move-order ping (single instance).
  const orderRing = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 32 });
  const orderMat = createStandardMaterial();
  orderMat.diffuseColor = [0.35, 0.75, 1];
  orderMat.emissiveColor = [0.2, 0.55, 1];
  orderMat.alpha = 0.75;
  orderRing.material = orderMat;
  const orderMatrices = new Float32Array(16);
  setThinInstances(orderRing, orderMatrices, 1);
  setThinInstanceColors(orderRing, new Float32Array([0.35, 0.75, 1, 0]));
  addToScene(scene, orderRing);

  function writeFlatRing(matrices, i, x, z, diameter) {
    const o = i * 16;
    if (diameter <= 0) {
      for (let k = 0; k < 16; k++) matrices[o + k] = 0;
      return;
    }
    const s = diameter / RING_DIAM;
    const y = RING_H * 0.5;
    matrices[o] = s;
    matrices[o + 1] = 0;
    matrices[o + 2] = 0;
    matrices[o + 3] = 0;
    matrices[o + 4] = 0;
    matrices[o + 5] = 1;
    matrices[o + 6] = 0;
    matrices[o + 7] = 0;
    matrices[o + 8] = 0;
    matrices[o + 9] = 0;
    matrices[o + 10] = s;
    matrices[o + 11] = 0;
    matrices[o + 12] = x;
    matrices[o + 13] = y;
    matrices[o + 14] = z;
    matrices[o + 15] = 1;
  }

  let frameCb = null;
  onBeforeRender(scene, (deltaMs) => {
    if (frameCb) frameCb(deltaMs);
  });

  await registerScene(scene);

  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth;
    const height = rect.height || canvas.clientHeight;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      width,
      height,
      aspect: width / height,
    };
  }

  function viewProjection() {
    const { aspect } = canvasCoords(0, 0);
    return getViewProjectionMatrix(camera, aspect);
  }

  return {
    engine,
    scene,
    camera,
    matrices,

    // Limit the active instance count to the live entity count.
    setCount(n) {
      setThinInstances(marker, matrices, n);
      setThinInstances(selRing, ringMatrices, n);
    },

    // Per-instance RGBA tint (team colors).
    setColors(colors) {
      setThinInstanceColors(marker, colors);
    },

    // scale is world diameter; yaw = facing on XZ; moving stretches forward.
    writeInstance(i, x, z, diameter = BASE_DIAMETER, yaw = 0, moving = false) {
      const base = diameter / BASE_DIAMETER;
      const stretch = moving ? 1.14 : 1;
      const narrow = moving ? 0.9 : 1;
      const sx = base * narrow;
      const sy = base;
      const sz = base * stretch;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const y = diameter * 0.5;
      const o = i * 16;
      matrices[o] = c * sx;
      matrices[o + 1] = 0;
      matrices[o + 2] = s * sz;
      matrices[o + 3] = 0;
      matrices[o + 4] = 0;
      matrices[o + 5] = sy;
      matrices[o + 6] = 0;
      matrices[o + 7] = 0;
      matrices[o + 8] = -s * sx;
      matrices[o + 9] = 0;
      matrices[o + 10] = c * sz;
      matrices[o + 11] = 0;
      matrices[o + 12] = x;
      matrices[o + 13] = y;
      matrices[o + 14] = z;
      matrices[o + 15] = 1;
    },

    commit() {
      flushThinInstances(marker);
      flushThinInstances(selRing);
      flushThinInstances(orderRing);
      uploadThinInstanceGpu(engine, marker.thinInstances, true);
      uploadThinInstanceGpu(engine, selRing.thinInstances, true);
      uploadThinInstanceGpu(engine, orderRing.thinInstances, true);
    },

    /** Ground ring under a selected unit. diameter 0 hides it. */
    writeSelectionRing(i, x, z, diameter) {
      writeFlatRing(ringMatrices, i, x, z, diameter);
    },

    /** Blue ping where a move order was issued. alpha 0 hides it. */
    showOrderMarker(x, z, diameter, alpha) {
      writeFlatRing(orderMatrices, 0, x, z, alpha > 0 ? diameter : 0);
      setThinInstanceColor(orderRing, 0, 0.35, 0.75, 1, alpha);
    },

    // Register the per-frame callback (driven by Lite's render loop).
    onFrame(cb) {
      frameCb = cb;
    },

    // Project a world point to canvas-local CSS pixel coordinates.
    worldToScreen(x, y, z) {
      const { width, height } = canvasCoords(0, 0);
      const c = matVec4(viewProjection(), x, y, z, 1);
      if (Math.abs(c[3]) < 1e-8) return null;
      const iw = 1 / c[3];
      const ndcX = c[0] * iw;
      const ndcY = c[1] * iw;
      return {
        x: (ndcX * 0.5 + 0.5) * width,
        y: (1 - ndcY) * 0.5 * height,
      };
    },

    /** Ray-sphere pick — returns closest sphere id, or -1. */
    rayPickSpheres(clientX, clientY, spheres) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      if (!ray) return -1;
      let best = -1;
      let bestT = Infinity;
      for (let s = 0; s < spheres.length; s++) {
        const sp = spheres[s];
        const t = rayHitSphere(ray, sp.x, sp.y, sp.z, sp.r);
        if (t !== null && t < bestT) {
          bestT = t;
          best = sp.id;
        }
      }
      return best;
    },

    // Unproject a viewport client coordinate onto the y=0 ground plane.
    screenToGround(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      return ray ? rayHitGround(ray) : null;
    },

    /** Canvas-local x/y from a pointer event's clientX/clientY. */
    canvasCoords,

    start() {
      return startEngine(engine);
    },
  };
}
