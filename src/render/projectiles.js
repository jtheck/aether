// Thin-instanced projectile archetype renderer. Gameplay remains in sim/.

import {
  addToScene,
  createMeshFromData,
  createSphere,
  createStandardMaterial,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import {
  PROJECTILE_DEFS,
  PROJECTILE_MESH,
  getProjectileDef,
} from '../sim/projectileTypes.js';

const PROJECTILE_VISIBILITY_SCALE = 5;

function createArrowMesh(engine, name) {
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
    0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5,
  ]);
  const normals = new Float32Array([
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ]);
  return createMeshFromData(engine, name, positions, normals, indices);
}

function createArchetypeMesh(engine, def) {
  if (def.mesh === PROJECTILE_MESH.ARROW) {
    return createArrowMesh(engine, `projectile-${def.name.toLowerCase()}`);
  }
  return createSphere(engine, {
    diameter: 1,
    segments: def.mesh === PROJECTILE_MESH.ROCK ? 6 : 8,
  });
}

function hideMatrix(matrices, slot) {
  const offset = slot * 16;
  for (let i = 0; i < 16; i++) matrices[offset + i] = 0;
}

function writeMatrix(matrices, slot, x, y, z, vx, vz, scale) {
  const offset = slot * 16;
  const len = Math.hypot(vx, vz);
  const fx = len > 1e-6 ? vx / len : 0;
  const fz = len > 1e-6 ? vz / len : 1;
  const rx = fz;
  const rz = -fx;
  matrices[offset] = rx * scale[0] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset + 1] = 0;
  matrices[offset + 2] = rz * scale[0] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = 0;
  matrices[offset + 5] = scale[1] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset + 6] = 0;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = fx * scale[2] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset + 9] = 0;
  matrices[offset + 10] = fz * scale[2] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = x;
  matrices[offset + 13] = y;
  matrices[offset + 14] = z;
  matrices[offset + 15] = 1;
}

export function createProjectileRenderer(engine, scene, groundYAt, onProjectile) {
  const batches = new Map();
  const counts = new Uint32Array(PROJECTILE_DEFS.length);
  for (const def of PROJECTILE_DEFS) {
    const mesh = createArchetypeMesh(engine, def);
    mesh.pickable = false;
    const material = createStandardMaterial();
    material.diffuseColor = def.color;
    material.emissiveColor = def.color.map((v) => v * 0.3);
    material.specularColor = [0, 0, 0];
    // Lite caches opaque draws in a render bundle before dynamic projectile
    // instances exist. Keep these on its per-frame path so matrices upload.
    material.alpha = 0.99;
    material.backFaceCulling = false;
    mesh.material = material;

    const capacity = def.renderCapacity;
    const matrices = new Float32Array(capacity * 16);
    const colors = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) {
      colors[i * 4] = def.color[0];
      colors[i * 4 + 1] = def.color[1];
      colors[i * 4 + 2] = def.color[2];
      colors[i * 4 + 3] = 1;
    }
    setThinInstances(mesh, matrices, capacity);
    setThinInstanceColors(mesh, colors);
    addToScene(scene, mesh);
    batches.set(def.id, { mesh, matrices, capacity, previousCount: 0 });
  }

  function sync(prev, cur, alpha) {
    if (!cur) {
      clear();
      return { active: 0, dropped: 0 };
    }
    counts.fill(0);
    let active = 0;
    let dropped = 0;
    for (let i = 0; i < cur.highWater; i++) {
      if (!cur.alive[i]) continue;
      const type = cur.type[i];
      const def = getProjectileDef(type);
      const batch = batches.get(type);
      if (!batch) continue;
      const slot = counts[type]++;
      if (slot >= batch.capacity) {
        dropped++;
        continue;
      }
      const samePrevious =
        prev &&
        i < prev.highWater &&
        prev.alive[i] &&
        prev.generation[i] === cur.generation[i];
      const x = samePrevious
        ? prev.x[i] + (cur.x[i] - prev.x[i]) * alpha
        : cur.x[i] - cur.vx[i] * (1 - alpha);
      const z = samePrevious
        ? prev.z[i] + (cur.z[i] - prev.z[i]) * alpha
        : cur.z[i] - cur.vz[i] * (1 - alpha);
      const age = Math.max(0, cur.age[i] - (1 - alpha));
      const life = Math.max(1, cur.lifetime[i]);
      const progress = Math.min(1, age / life);
      const y =
        groundYAt(x, z) +
        def.launchHeight +
        Math.sin(progress * Math.PI) * def.arcHeight;
      writeMatrix(batch.matrices, slot, x, y, z, cur.vx[i], cur.vz[i], def.scale);
      onProjectile?.(i, cur.generation[i], x, y, z, cur.vx[i], cur.vz[i], def);
      active++;
    }

    for (const def of PROJECTILE_DEFS) {
      const batch = batches.get(def.id);
      const count = Math.min(counts[def.id], batch.capacity);
      for (let slot = count; slot < batch.previousCount; slot++) {
        hideMatrix(batch.matrices, slot);
      }
      batch.previousCount = count;
    }
    return { active, dropped };
  }

  function clear() {
    for (const batch of batches.values()) {
      for (let slot = 0; slot < batch.previousCount; slot++) {
        hideMatrix(batch.matrices, slot);
      }
      batch.previousCount = 0;
    }
  }

  return {
    sync,
    clear,
    commit() {
      for (const batch of batches.values()) flushThinInstances(batch.mesh);
    },
  };
}
