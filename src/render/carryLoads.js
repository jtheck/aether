// Overhead haul props — v1's comically large log / rock on the villager's head.
// Units are thin-instanced, so these are a matching overlay (not parented).

import {
  addToScene,
  createCylinder,
  createMeshFromData,
  createStandardMaterial,
  flushThinInstances,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { RESOURCE_INDEX } from '../sim/resources.js';

const WOOD = RESOURCE_INDEX.wood + 1;
const STONE = RESOURCE_INDEX.stone + 1;
const MINERAL = RESOURCE_INDEX.mineral + 1;

/** Above the crown — renderY is chest (pickHeight). */
const HEAD_LIFT = 1.85;
const INITIAL_CAP = 256;

const KIND = {
  wood: {
    code: WOOD,
    // Horizontal log (cylinder along X after Rz 90°).
    sx: 0.95,
    sy: 3.2,
    sz: 0.95,
    rx: 0,
    rz: Math.PI / 2,
    yLift: 0.55,
    color: [0.42, 0.22, 0.1],
    emissive: [0.1, 0.05, 0.02],
    mesh: 'log',
  },
  stone: {
    code: STONE,
    sx: 2.2,
    sy: 1.7,
    sz: 2.0,
    rx: Math.PI * 0.15,
    rz: Math.PI * 0.1,
    yLift: 1.05,
    color: [0.5, 0.5, 0.5],
    emissive: [0.1, 0.1, 0.1],
    mesh: 'box',
  },
  mineral: {
    code: MINERAL,
    sx: 2.0,
    sy: 1.6,
    sz: 1.9,
    rx: Math.PI * 0.12,
    rz: Math.PI * -0.08,
    yLift: 0.95,
    color: [0.7, 0.6, 0.8],
    emissive: [0.2, 0.15, 0.2],
    mesh: 'box',
  },
};

function setPoolDrawCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti || ti.count === count) return;
  ti.count = count;
  mesh.visible = count > 0;
}

/** T * Ry(yaw) * Rx * Rz * S, column-major. */
function writeLoad(matrices, slot, x, y, z, yaw, def) {
  const o = slot * 16;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(def.rx);
  const sx = Math.sin(def.rx);
  const cz = Math.cos(def.rz);
  const sz = Math.sin(def.rz);

  // Ry * Rx
  const r00 = cy;
  const r01 = sy * sx;
  const r02 = sy * cx;
  const r10 = 0;
  const r11 = cx;
  const r12 = -sx;
  const r20 = -sy;
  const r21 = cy * sx;
  const r22 = cy * cx;

  // (Ry*Rx) * Rz
  const m00 = r00 * cz + r01 * sz;
  const m01 = r01 * cz - r00 * sz;
  const m02 = r02;
  const m10 = r10 * cz + r11 * sz;
  const m11 = r11 * cz - r10 * sz;
  const m12 = r12;
  const m20 = r20 * cz + r21 * sz;
  const m21 = r21 * cz - r20 * sz;
  const m22 = r22;

  matrices[o] = m00 * def.sx;
  matrices[o + 1] = m10 * def.sx;
  matrices[o + 2] = m20 * def.sx;
  matrices[o + 3] = 0;
  matrices[o + 4] = m01 * def.sy;
  matrices[o + 5] = m11 * def.sy;
  matrices[o + 6] = m21 * def.sy;
  matrices[o + 7] = 0;
  matrices[o + 8] = m02 * def.sz;
  matrices[o + 9] = m12 * def.sz;
  matrices[o + 10] = m22 * def.sz;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function createUnitBox(engine, name) {
  const p = 0.5;
  const positions = new Float32Array([
    -p, -p, p, p, -p, p, p, p, p, -p, p, p,
    -p, -p, -p, -p, p, -p, p, p, -p, p, -p, -p,
    -p, p, -p, -p, p, p, p, p, p, p, p, -p,
    -p, -p, -p, p, -p, -p, p, -p, p, -p, -p, p,
    p, -p, -p, p, p, -p, p, p, p, p, -p, p,
    -p, -p, -p, -p, -p, p, -p, p, p, -p, p, -p,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);
  return createMeshFromData(engine, name, positions, normals, indices);
}

function makeBatch(engine, scene, def, name) {
  const mesh = def.mesh === 'log'
    ? createCylinder(engine, { diameter: 1, height: 1, tessellation: 10 })
    : createUnitBox(engine, name);
  mesh.pickable = false;
  const material = createStandardMaterial();
  material.diffuseColor = def.color;
  material.emissiveColor = def.emissive;
  material.specularColor = [0, 0, 0];
  // 0.99 keeps Lite off the opaque render-bundle path (same as projectiles).
  // Cull so that alpha doesn't let the inner walls show through.
  material.alpha = 0.99;
  material.backFaceCulling = true;
  mesh.material = material;
  const matrices = new Float32Array(INITIAL_CAP * 16);
  setThinInstances(mesh, matrices, INITIAL_CAP);
  addToScene(scene, mesh);
  mesh.visible = false;
  return { mesh, matrices, capacity: INITIAL_CAP, def, count: 0 };
}

/**
 * @param {object} engine
 * @param {object} scene
 */
export function createCarryLoads(engine, scene) {
  const batches = {
    wood: makeBatch(engine, scene, KIND.wood, 'carry-wood'),
    stone: makeBatch(engine, scene, KIND.stone, 'carry-stone'),
    mineral: makeBatch(engine, scene, KIND.mineral, 'carry-mineral'),
  };
  let unitsOn = true;

  function batchForKind(code) {
    if (code === STONE) return batches.stone;
    if (code === MINERAL) return batches.mineral;
    if (code === WOOD) return batches.wood;
    return null;
  }

  function grow(batch, need) {
    let cap = batch.capacity;
    while (cap < need) cap <<= 1;
    const matrices = new Float32Array(cap * 16);
    matrices.set(batch.matrices);
    batch.matrices = matrices;
    batch.capacity = cap;
    setThinInstances(batch.mesh, matrices, cap);
  }

  function sync(count, opts) {
    const amt = opts.amt;
    const kind = opts.kind;
    const x = opts.x;
    const y = opts.y;
    const z = opts.z;
    const yaw = opts.yaw;
    const alive = opts.alive;
    const skip = opts.skip;
    for (const key of Object.keys(batches)) batches[key].count = 0;
    if (!amt) {
      commit();
      return;
    }
    const n = count | 0;
    for (let i = 0; i < n; i++) {
      if ((amt[i] | 0) <= 0) continue;
      if (alive && !alive[i]) continue;
      if (skip && skip[i]) continue;
      const code = kind ? (kind[i] | 0) : WOOD;
      const batch = batchForKind(code) ?? batches.wood;
      const slot = batch.count++;
      if (slot >= batch.capacity) grow(batch, slot + 1);
      writeLoad(
        batch.matrices,
        slot,
        x[i],
        y[i] + HEAD_LIFT + (batch.def.yLift || 0),
        z[i],
        yaw ? yaw[i] : 0,
        batch.def,
      );
    }
    commit();
  }

  function commit() {
    for (const key of Object.keys(batches)) {
      const batch = batches[key];
      const live = batch.count;
      setPoolDrawCount(batch.mesh, live);
      if (live > 0) flushThinInstances(batch.mesh);
      batch.mesh.visible = unitsOn && live > 0;
    }
  }

  function clear() {
    for (const key of Object.keys(batches)) batches[key].count = 0;
    commit();
  }

  function setVisible(on) {
    unitsOn = !!on;
    for (const key of Object.keys(batches)) {
      const batch = batches[key];
      batch.mesh.visible = unitsOn && batch.count > 0;
    }
  }

  return { sync, commit, clear, setVisible };
}
