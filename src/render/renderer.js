// render/ — Babylon Lite view layer.
//
// Military units are thin-instanced GLB meshes (one draw call per type).
// Selection rings and picking still use analytic spheres from sim sizes.

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
  loadGltf,
  cloneTransformNode,
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
import { getUnitDef } from '../sim/unitTypes.js';
import { kothMaxUnitsOfType } from '../sim/worldSetup.js';
import { UNIT_MODEL_URLS, findFirstMesh, hasUnitModel, prepareLegacyModel } from './unitModels.js';

/** Change active instance count without shrinking GPU buffer capacity. */
function setThinInstanceCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  if (count > ti._capacity) {
    throw new Error(`thin-instance count ${count} exceeds capacity ${ti._capacity}`);
  }
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
}

// Column-major mat4 * vec4.
function matVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

function setupRtsCameraControls(camera, canvas) {
  const angularSensibility = 1000;
  const panningSensibility = 50;
  let mode = 0;
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

function initThinInstances(mesh, activeCount, gpuCapacity) {
  const cap = Math.max(activeCount, gpuCapacity, 1);
  const matrices = new Float32Array(cap * 16);
  setThinInstances(mesh, matrices, cap);
  if (activeCount < cap) setThinInstanceCount(mesh, activeCount);
  const colors = new Float32Array(cap * 4);
  for (let s = 0; s < cap; s++) {
    colors[s * 4] = 1;
    colors[s * 4 + 1] = 1;
    colors[s * 4 + 2] = 1;
    colors[s * 4 + 3] = 1;
  }
  setThinInstanceColors(mesh, colors);
  return { matrices, colors, gpuCapacity: cap };
}

function writeUnitMatrix(matrices, slot, x, z, uniformScale, yaw, moving) {
  const o = slot * 16;
  if (uniformScale <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const stretch = moving ? 1.08 : 1;
  const narrow = moving ? 0.94 : 1;
  const sx = uniformScale * narrow;
  const sy = uniformScale;
  const sz = uniformScale * stretch;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
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
  matrices[o + 13] = 0;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function writeFlatRing(matrices, i, x, z, diameter, ringDiam, ringH) {
  const o = i * 16;
  if (diameter <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const s = diameter / ringDiam;
  const y = ringH * 0.5;
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

function resizeTypeBatch(batch, entityIds) {
  const newSize = entityIds.length;
  if (newSize > batch.gpuCapacity) {
    throw new Error(`type batch overflow: ${newSize} > ${batch.gpuCapacity}`);
  }
  setThinInstanceCount(batch.mesh, newSize);
  batch.entityIds = entityIds;
}

async function loadUnitMeshTemplate(engine, url) {
  const container = await loadGltf(engine, url);
  const root = container.entities[0];
  const src = findFirstMesh(root);
  if (!src) throw new Error(`no mesh in ${url}`);
  const mesh = cloneTransformNode(src);
  mesh.pickable = false;
  prepareLegacyModel(mesh);
  return mesh;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} capacity
 * @param {{ types?: Int8Array | Uint8Array | number[], gpuCapacity?: number }} [opts]
 */
export async function createRenderer(canvas, capacity, opts = {}) {
  const types = opts.types;
  const gpuCapacity = opts.gpuCapacity ?? capacity;
  const preallocKoth = gpuCapacity > capacity;
  const engine = await createEngine(canvas, { msaaSamples: 1 });
  const scene = createSceneContext(engine);

  const camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, 620, { x: 0, y: 0, z: 0 });
  scene.camera = camera;
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

  const hillMat = createStandardMaterial();
  hillMat.diffuseColor = [0.45, 0.38, 0.22];
  hillMat.emissiveColor = [0.15, 0.12, 0.05];
  const hill = createCylinder(engine, { diameter: 48, height: 8, tessellation: 32 });
  hill.position = [0, 4, 0];
  hill.material = hillMat;
  addToScene(scene, hill);

  const hillRingMat = createStandardMaterial();
  hillRingMat.diffuseColor = [0.9, 0.75, 0.2];
  hillRingMat.emissiveColor = [0.5, 0.4, 0.05];
  hillRingMat.alpha = 0.35;
  const hillRing = createCylinder(engine, { diameter: 80, height: 0.5, tessellation: 48 });
  hillRing.position = [0, 0.3, 0];
  hillRing.material = hillRingMat;
  addToScene(scene, hillRing);

  const entitySlot = new Int32Array(Math.max(capacity, gpuCapacity));
  entitySlot.fill(-1);
  const typeEntities = new Map();

  if (types) {
    for (let i = 0; i < capacity; i++) {
      const type = types[i];
      if (!typeEntities.has(type)) typeEntities.set(type, []);
      typeEntities.get(type).push(i);
    }
    for (const ids of typeEntities.values()) {
      for (let s = 0; s < ids.length; s++) entitySlot[ids[s]] = s;
    }
  }

  /** @type {Map<number, { mesh: object, matrices: Float32Array, colors: Float32Array, baseSize: number, entityIds: number[] }>} */
  const typeBatches = new Map();
  const fallbackEntities = [];

  for (const [typeId, entityIds] of typeEntities) {
    const def = getUnitDef(typeId);
    const batchSize = entityIds.length;
    if (batchSize === 0) continue;

    if (hasUnitModel(typeId)) {
      const mesh = await loadUnitMeshTemplate(engine, UNIT_MODEL_URLS[typeId]);
      const typeGpuCap = Math.max(batchSize, preallocKoth ? kothMaxUnitsOfType(typeId) : batchSize, 1);
      const { matrices, colors, gpuCapacity: cap } = initThinInstances(mesh, batchSize, typeGpuCap);
      addToScene(scene, mesh);
      typeBatches.set(typeId, { mesh, matrices, colors, baseSize: def.size, entityIds, gpuCapacity: cap });
    } else {
      fallbackEntities.push(...entityIds);
    }
  }

  const BASE_DIAMETER = 6;
  let fallback = null;
  if (fallbackEntities.length > 0) {
    const mesh = createSphere(engine, { diameter: BASE_DIAMETER, segments: capacity > 500 ? 6 : 10 });
    const material = createStandardMaterial();
    material.diffuseColor = [1, 1, 1];
    mesh.material = material;
    const fbCap = Math.max(fallbackEntities.length, gpuCapacity, 1);
    const { matrices, colors, gpuCapacity: cap } = initThinInstances(mesh, fallbackEntities.length, fbCap);
    addToScene(scene, mesh);
    for (let s = 0; s < fallbackEntities.length; s++) entitySlot[fallbackEntities[s]] = s;
    fallback = { mesh, matrices, colors, baseSize: BASE_DIAMETER, entityIds: fallbackEntities, gpuCapacity: cap };
  }

  const RING_DIAM = 1;
  const RING_H = 0.12;
  const selRing = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 24 });
  const ringMat = createStandardMaterial();
  ringMat.diffuseColor = [1, 0.92, 0.15];
  ringMat.emissiveColor = [1, 0.85, 0.1];
  ringMat.alpha = 0.9;
  selRing.material = ringMat;
  const ringCap = Math.max(capacity, gpuCapacity, 1);
  const ringInit = initThinInstances(selRing, capacity, ringCap);
  const ringMatrices = ringInit.matrices;
  const ringColors = ringInit.colors;
  for (let i = 0; i < capacity; i++) {
    ringColors[i * 4] = 1;
    ringColors[i * 4 + 1] = 0.92;
    ringColors[i * 4 + 2] = 0.15;
    ringColors[i * 4 + 3] = 0.85;
  }
  setThinInstanceColors(selRing, ringColors);
  addToScene(scene, selRing);

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

  function writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, useSphereY) {
    const scale = diameter / batch.baseSize;
    if (useSphereY) {
      const o = slot * 16;
      if (scale <= 0) {
        for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
        return;
      }
      const stretch = moving ? 1.14 : 1;
      const narrow = moving ? 0.9 : 1;
      const sx = scale * narrow;
      const sy = scale;
      const sz = scale * stretch;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const y = diameter * 0.5;
      batch.matrices[o] = c * sx;
      batch.matrices[o + 1] = 0;
      batch.matrices[o + 2] = s * sz;
      batch.matrices[o + 3] = 0;
      batch.matrices[o + 4] = 0;
      batch.matrices[o + 5] = sy;
      batch.matrices[o + 6] = 0;
      batch.matrices[o + 7] = 0;
      batch.matrices[o + 8] = -s * sx;
      batch.matrices[o + 9] = 0;
      batch.matrices[o + 10] = c * sz;
      batch.matrices[o + 11] = 0;
      batch.matrices[o + 12] = x;
      batch.matrices[o + 13] = y;
      batch.matrices[o + 14] = z;
      batch.matrices[o + 15] = 1;
    } else {
      writeUnitMatrix(batch.matrices, slot, x, z, scale, yaw, moving);
    }
  }

  return {
    engine,
    scene,
    camera,

    setCount(n) {
      setThinInstanceCount(selRing, n);
    },

    /** Rebuild type-batch mapping when entity count/types change (e.g. sandbox → live). */
    rebuildFromTypes(count, typesArr) {
      setThinInstanceCount(selRing, count);

      entitySlot.fill(-1);
      const nextByType = new Map();
      for (let i = 0; i < count; i++) {
        const type = typesArr[i];
        if (!nextByType.has(type)) nextByType.set(type, []);
        nextByType.get(type).push(i);
      }

      for (const [typeId, entityIds] of nextByType) {
        const batch = typeBatches.get(typeId);
        if (batch) {
          resizeTypeBatch(batch, entityIds);
          for (let s = 0; s < entityIds.length; s++) entitySlot[entityIds[s]] = s;
        }
      }

      for (const [typeId, batch] of typeBatches) {
        if (!nextByType.has(typeId)) {
          setThinInstanceCount(batch.mesh, 0);
          batch.entityIds = [];
        }
      }

      if (fallback) {
        const fbIds = [];
        for (let i = 0; i < count; i++) {
          if (!typeBatches.has(typesArr[i])) fbIds.push(i);
        }
        if (fbIds.length > 0) {
          resizeTypeBatch(fallback, fbIds);
          for (let s = 0; s < fbIds.length; s++) entitySlot[fbIds[s]] = s;
        } else {
          setThinInstanceCount(fallback.mesh, 0);
          fallback.entityIds = [];
        }
      }
    },

    setColors(allColors) {
      for (const batch of typeBatches.values()) {
        for (let s = 0; s < batch.entityIds.length; s++) {
          const i = batch.entityIds[s];
          batch.colors[s * 4] = allColors[i * 4];
          batch.colors[s * 4 + 1] = allColors[i * 4 + 1];
          batch.colors[s * 4 + 2] = allColors[i * 4 + 2];
          batch.colors[s * 4 + 3] = allColors[i * 4 + 3];
        }
        setThinInstanceColors(batch.mesh, batch.colors);
      }
      if (fallback) {
        for (let s = 0; s < fallback.entityIds.length; s++) {
          const i = fallback.entityIds[s];
          fallback.colors[s * 4] = allColors[i * 4];
          fallback.colors[s * 4 + 1] = allColors[i * 4 + 1];
          fallback.colors[s * 4 + 2] = allColors[i * 4 + 2];
          fallback.colors[s * 4 + 3] = allColors[i * 4 + 3];
        }
        setThinInstanceColors(fallback.mesh, fallback.colors);
      }
    },

    writeInstance(i, typeId, x, z, diameter, yaw = 0, moving = false) {
      const slot = entitySlot[i];
      if (slot < 0) return;
      const batch = typeBatches.get(typeId) ?? fallback;
      if (!batch) return;
      writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, batch === fallback);
    },

    commit() {
      for (const batch of typeBatches.values()) flushThinInstances(batch.mesh);
      if (fallback) flushThinInstances(fallback.mesh);
      flushThinInstances(selRing);
      flushThinInstances(orderRing);
    },

    writeSelectionRing(i, x, z, diameter) {
      writeFlatRing(ringMatrices, i, x, z, diameter, RING_DIAM, RING_H);
    },

    showOrderMarker(x, z, diameter, alpha) {
      writeFlatRing(orderMatrices, 0, x, z, alpha > 0 ? diameter : 0, RING_DIAM, RING_H);
      setThinInstanceColor(orderRing, 0, 0.35, 0.75, 1, alpha);
    },

    onFrame(cb) {
      frameCb = cb;
    },

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

    screenToGround(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      return ray ? rayHitGround(ray) : null;
    },

    canvasCoords,

    start() {
      return startEngine(engine);
    },
  };
}
