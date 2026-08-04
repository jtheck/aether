// World-oriented comic air streaks for arrow-like projectiles.
// Same 3D travel basis as the arrow mesh so dashes pitch up/down with the lob.

import {
  addToScene,
  createMeshFromData,
  createStandardMaterial,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';

const CAPACITY = 32768;
const LIFETIME_MS = 240;
// Arrow render length is ~3 — keep streaks readable and clear of the shaft.
const BASE_WIDTH = 0.18;
const BASE_LENGTH = 3.4;
const BEHIND_GAP = 1.9;

function createStreakMesh(engine) {
  // Tapered dashes: point at local -Z (behind), wide at +Z (toward the arrow).
  const positions = new Float32Array([
    // Horizontal
    0, 0, -0.5,
    -0.5, 0, 0.5,
    0.5, 0, 0.5,
    // Vertical
    0, 0, -0.5,
    0, -0.5, 0.5,
    0, 0.5, 0.5,
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return createMeshFromData(engine, 'arrow-air-streak', positions, normals, indices);
}

function writeOriented(matrices, slot, x, y, z, fx, fy, fz, width, length) {
  const offset = slot * 16;
  // right = normalize(worldUp × forward); fall back if nearly vertical.
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rLen = Math.hypot(rx, ry, rz);
  if (rLen > 1e-6) {
    rx /= rLen;
    ry /= rLen;
    rz /= rLen;
  } else {
    rx = 1;
    ry = 0;
    rz = 0;
  }
  // up = forward × right
  let ux = fy * rz - fz * ry;
  let uy = fz * rx - fx * rz;
  let uz = fx * ry - fy * rx;
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;
  matrices[offset] = rx * width;
  matrices[offset + 1] = ry * width;
  matrices[offset + 2] = rz * width;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = ux * width;
  matrices[offset + 5] = uy * width;
  matrices[offset + 6] = uz * width;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = fx * length;
  matrices[offset + 9] = fy * length;
  matrices[offset + 10] = fz * length;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = x;
  matrices[offset + 13] = y;
  matrices[offset + 14] = z;
  matrices[offset + 15] = 1;
}

function setCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
  mesh.visible = count > 0;
}

/**
 * @param {object} engine
 * @param {object} scene
 */
export function createArrowTrails(engine, scene) {
  const mesh = createStreakMesh(engine);
  mesh.pickable = false;
  const material = createStandardMaterial();
  material.diffuseColor = [0.88, 0.94, 1];
  material.emissiveColor = [0.55, 0.65, 0.85];
  material.specularColor = [0, 0, 0];
  material.disableLighting = true;
  material.alpha = 0.99;
  material.backFaceCulling = false;
  mesh.material = material;

  const matrices = new Float32Array(CAPACITY * 16);
  const colors = new Float32Array(CAPACITY * 4);
  const birthMs = new Float64Array(CAPACITY);
  const dirX = new Float32Array(CAPACITY);
  const dirY = new Float32Array(CAPACITY);
  const dirZ = new Float32Array(CAPACITY);
  const posX = new Float32Array(CAPACITY);
  const posY = new Float32Array(CAPACITY);
  const posZ = new Float32Array(CAPACITY);
  const length0 = new Float32Array(CAPACITY);

  setThinInstances(mesh, matrices, CAPACITY);
  setThinInstanceColors(mesh, colors);
  setCount(mesh, 0);
  addToScene(scene, mesh);

  let count = 0;
  let clockMs = 0;
  let dropped = 0;

  function emit(x, y, z, vx, vy, vz) {
    const speed = Math.hypot(vx, vy, vz);
    if (speed < 1e-6) return;
    if (count >= CAPACITY) {
      dropped++;
      return;
    }
    const fx = vx / speed;
    const fy = vy / speed;
    const fz = vz / speed;
    const length = BASE_LENGTH;
    // Center sits behind the arrow tail so the dash isn't buried in the shaft.
    const back = BEHIND_GAP + length * 0.5;
    const slot = count++;
    posX[slot] = x - fx * back;
    posY[slot] = y - fy * back;
    posZ[slot] = z - fz * back;
    dirX[slot] = fx;
    dirY[slot] = fy;
    dirZ[slot] = fz;
    length0[slot] = length;
    birthMs[slot] = clockMs;
    writeOriented(
      matrices,
      slot,
      posX[slot],
      posY[slot],
      posZ[slot],
      fx,
      fy,
      fz,
      BASE_WIDTH,
      length,
    );
    colors[slot * 4] = 0.88;
    colors[slot * 4 + 1] = 0.94;
    colors[slot * 4 + 2] = 1;
    colors[slot * 4 + 3] = 0.78;
  }

  function release(slot) {
    const last = count - 1;
    if (slot < last) {
      posX[slot] = posX[last];
      posY[slot] = posY[last];
      posZ[slot] = posZ[last];
      dirX[slot] = dirX[last];
      dirY[slot] = dirY[last];
      dirZ[slot] = dirZ[last];
      length0[slot] = length0[last];
      birthMs[slot] = birthMs[last];
      matrices.copyWithin(slot * 16, last * 16, last * 16 + 16);
      colors.copyWithin(slot * 4, last * 4, last * 4 + 4);
    }
    count = last;
  }

  function update(deltaMs) {
    clockMs += Math.min(100, Math.max(0, deltaMs));
    for (let i = count - 1; i >= 0; i--) {
      const age = clockMs - birthMs[i];
      if (age >= LIFETIME_MS) {
        release(i);
        continue;
      }
      const t = age / LIFETIME_MS;
      const fade = 1 - t;
      const width = BASE_WIDTH * (0.85 + 0.15 * fade);
      const length = length0[i] * (0.55 + 0.45 * fade);
      // Shrink toward the rear so the gap behind the arrow stays clear.
      const fx = dirX[i];
      const fy = dirY[i];
      const fz = dirZ[i];
      const shrink = (length0[i] - length) * 0.5;
      writeOriented(
        matrices,
        i,
        posX[i] - fx * shrink,
        posY[i] - fy * shrink,
        posZ[i] - fz * shrink,
        fx,
        fy,
        fz,
        width,
        length,
      );
      colors[i * 4 + 3] = 0.78 * fade * fade;
    }
  }

  function clear() {
    count = 0;
    setCount(mesh, 0);
  }

  return {
    emit,
    update,
    clear,
    commit() {
      setCount(mesh, count);
      setThinInstanceColors(mesh, colors);
      flushThinInstances(mesh);
    },
    stats() {
      return { active: count, capacity: CAPACITY, dropped };
    },
  };
}
