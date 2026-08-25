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
  PROJECTILE,
  PROJECTILE_DEFS,
  PROJECTILE_MESH,
  getProjectileDef,
} from '../sim/projectileTypes.js';
import { MAX_PROJECTILES } from '../sim/projectiles.js';

// Kept modest — was 5 while debugging visibility and arrows looked gigantic.
const PROJECTILE_VISIBILITY_SCALE = 5 / 3;

/** Peak loft scales with throw range so long shots stay arched, not flat skims. */
function lobPeakHeight(def, rangeApprox) {
  const base = def.arcHeight ?? 8;
  const factor = def.lobRangeFactor ?? 0.28;
  // Cap so map-spanners aren't orbital.
  return Math.min(def.lobPeakCap ?? 52, Math.max(base, rangeApprox * factor));
}

/** World-Y for a projectile. Lobs throw up from the hand and crash down. */
function projectileWorldY(def, groundY, originGroundY, progress, loftPeak) {
  if (def.lob) {
    // Baseline drops from hand → impact; 4t(1-t) is a unit-peak throw parabola.
    const impact = def.impactHeight ?? 1;
    const clearance = def.launchHeight + (impact - def.launchHeight) * progress;
    const loft = 4 * progress * (1 - progress) * loftPeak;
    // Only meet local ground in the last slice — earlier blend made long shots swim.
    const landT = progress < 0.9 ? 0 : (progress - 0.9) / 0.1;
    const base = originGroundY + (groundY - originGroundY) * landT * landT;
    return base + clearance + loft;
  }
  return groundY + def.launchHeight + Math.sin(progress * Math.PI) * def.arcHeight;
}

/** Vertical speed along a lob arc (world units per lifetime), for trails. */
function projectileArcVy(def, progress, life, loftPeak) {
  if (!def.lob) return 0;
  const impact = def.impactHeight ?? 1;
  const dClear = impact - def.launchHeight;
  const dLoft = loftPeak * 4 * (1 - 2 * progress);
  return (dClear + dLoft) / Math.max(1, life);
}

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
  const segments =
    def.id === PROJECTILE.FIREBALL ? 14 :
    def.mesh === PROJECTILE_MESH.ROCK ? 6 :
    8;
  return createSphere(engine, {
    diameter: 1,
    segments,
  });
}

function hideMatrix(matrices, slot) {
  const offset = slot * 16;
  for (let i = 0; i < 16; i++) matrices[offset + i] = 0;
}

function writeMatrix(matrices, slot, x, y, z, vx, vy, vz, scale) {
  const offset = slot * 16;
  const len = Math.hypot(vx, vy, vz);
  let fx = 0;
  let fy = 0;
  let fz = 1;
  if (len > 1e-6) {
    fx = vx / len;
    fy = vy / len;
    fz = vz / len;
  }
  // right = normalize(worldUp × forward); fall back to XZ if nearly vertical.
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
  const sx = scale[0] * PROJECTILE_VISIBILITY_SCALE;
  const sy = scale[1] * PROJECTILE_VISIBILITY_SCALE;
  const sz = scale[2] * PROJECTILE_VISIBILITY_SCALE;
  matrices[offset] = rx * sx;
  matrices[offset + 1] = ry * sx;
  matrices[offset + 2] = rz * sx;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = ux * sy;
  matrices[offset + 5] = uy * sy;
  matrices[offset + 6] = uz * sy;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = fx * sz;
  matrices[offset + 9] = fy * sz;
  matrices[offset + 10] = fz * sz;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = x;
  matrices[offset + 13] = y;
  matrices[offset + 14] = z;
  matrices[offset + 15] = 1;
}

/**
 * Draw only the live slots. Pools are allocated at full renderCapacity, and
 * `flushThinInstances` marks 0..ti.count dirty — leaving count at capacity
 * re-uploads and re-draws the whole pool every frame for a handful of shots.
 */
function setPoolDrawCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti || ti.count === count) return;
  ti.count = count;
  mesh.visible = count > 0;
}

export function createProjectileRenderer(engine, scene, groundYAt, onProjectile, opts = {}) {
  const batches = new Map();
  const counts = new Uint32Array(PROJECTILE_DEFS.length);
  // Frozen spawn ground so lobbed shots don't porpoise over terrain.
  const lobOriginGround = new Float32Array(MAX_PROJECTILES);
  const lobOriginGen = new Uint32Array(MAX_PROJECTILES);
  for (const def of PROJECTILE_DEFS) {
    const mesh = createArchetypeMesh(engine, def);
    mesh.pickable = false;
    const material = createStandardMaterial();
    const isFireball = def.id === PROJECTILE.FIREBALL;
    const isShadow = def.id === PROJECTILE.SHADOW_BOLT;
    const isHoly = def.id === PROJECTILE.HOLY_SLASH;
    const isIce = def.id === PROJECTILE.ICE_BOLT;
    material.diffuseColor = isFireball ? [1, 0.55, 0.12] : def.color;
    material.emissiveColor = isFireball
      ? [1, 0.38, 0.04]
      : isShadow
        ? [0.12, 0.04, 0.22]
        : isHoly
          ? [1, 0.95, 0.75]
          : isIce
            ? [0.35, 0.65, 0.95]
            : def.color.map((v) => v * 0.3);
    material.specularColor = [0, 0, 0];
    if (isFireball || isShadow || isHoly || isIce) material.disableLighting = true;
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
      if (opts.shouldDraw && !opts.shouldDraw(x, z, cur.owner[i])) continue;
      const slot = counts[type]++;
      if (slot >= batch.capacity) {
        dropped++;
        continue;
      }
      const age = Math.max(0, cur.age[i] - (1 - alpha));
      // Lifetime includes +2 travel padding; lobs should finish the dive when
      // gameplay reaches the aim point (typically lifetime - 2).
      const lifePad = def.lob ? 2 : 0;
      const life = Math.max(1, cur.lifetime[i] - lifePad);
      const progress = Math.min(1, age / life);
      const localGround = groundYAt(x, z);
      if (def.lob && lobOriginGen[i] !== cur.generation[i]) {
        lobOriginGen[i] = cur.generation[i];
        lobOriginGround[i] = localGround;
      }
      const rangeApprox = Math.hypot(cur.vx[i], cur.vz[i]) * Math.max(1, cur.lifetime[i]);
      const loftPeak = def.lob ? lobPeakHeight(def, rangeApprox) : def.arcHeight;
      const y = projectileWorldY(
        def,
        localGround,
        def.lob ? lobOriginGround[i] : localGround,
        progress,
        loftPeak,
      );
      const vy = projectileArcVy(def, progress, life, loftPeak);
      writeMatrix(batch.matrices, slot, x, y, z, cur.vx[i], vy, cur.vz[i], def.scale);
      onProjectile?.(i, cur.generation[i], x, y, z, cur.vx[i], cur.vz[i], def, vy);
      active++;
    }

    for (const def of PROJECTILE_DEFS) {
      const batch = batches.get(def.id);
      const count = Math.min(counts[def.id], batch.capacity);
      for (let slot = count; slot < batch.previousCount; slot++) {
        hideMatrix(batch.matrices, slot);
      }
      batch.previousCount = count;
      setPoolDrawCount(batch.mesh, count);
    }
    return { active, dropped };
  }

  function clear() {
    for (const batch of batches.values()) {
      for (let slot = 0; slot < batch.previousCount; slot++) {
        hideMatrix(batch.matrices, slot);
      }
      batch.previousCount = 0;
      setPoolDrawCount(batch.mesh, 0);
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
