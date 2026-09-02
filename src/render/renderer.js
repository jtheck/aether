// render/ — Babylon Lite view layer.
//
// Units are thin-instanced GLB meshes (one draw call per type × owner in KOTH).
// Villagers use Lite VAT (baked idle/walk/carry) on the same thin-instance path.

import {
  createEngine,
  createSceneContext,
  createArcRotateCamera,
  createSphere,
  createGround,
  createCylinder,
  createStandardMaterial,
  createPbrMaterial,
  createTexture2DFromPixels,
  addToScene,
  setThinInstances,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceColor,
  onBeforeRender,
  onSceneDispose,
  registerSceneWithShadowSupport,
  startEngine,
  getViewProjectionMatrix,
  mat4Invert,
  loadFont,
  createCsmDirectionalShadowGenerator,
  setShadowTaskCasterMeshes,
  createGpuPicker,
  pickAsync,
  setPbrUnlit,
} from '../vendor/lite/liteVendor.js';
import { USE_GPU_PICK } from './pickMode.js';
import { getUnitDef } from '../sim/unitTypes.js';
import { GATHER_ACT } from '../sim/gather.js';
import { MAX_PROJECTILES, PROJECTILE_DESPAWN } from '../sim/projectiles.js';
import { PROJECTILE, PROJECTILE_MESH } from '../sim/projectileTypes.js';
import { HEIGHT_AMPLITUDE, TILE_SIZE_F, WORLD_HALF_F, worldHalfFFromField } from '../sim/field.js';
import { createCameraController, resolveCameraHalfF } from './cameraController.js';
import { capacityFor } from '../sim/capacity.js';
import {
  UNIT_MODEL_URLS,
  hasUnitModel,
  loadBakedUnitMeshParts,
  prefetchBakedMesh,
} from './unitModels.js';
import { spawnSeatsFromSockets } from './transportSeats.js';
import { isTeamColorMaterial, prepareTeamColorMaterial } from './teamColor.js';
import {
  clipForVatState,
  fillVatInstanceParams,
  isVatUnitType,
  loadVatUnitTemplate,
  maxVatInstancesPerBatch,
  vatWant,
  vatWalkFps,
  VAT_CLIP,
  VAT_FROZEN,
  VAT_UNIT_DEFS,
  writeVatSlotParams,
} from './vatUnits.js';
import { createCelestialRig } from './celestial.js';
import { createTerrainFromField, createTileGridOverlay, createPlacementGridOverlay, surfaceHeightAt } from './terrain.js';
import { createProjectileRenderer } from './projectiles.js';
import { createPickHitboxRenderer } from './pickHitboxes.js';
import { createHolyShieldMaterial } from './holyShields.js';
import { createWorkRadiusRings } from './workRadiusRings.js';
import { createFrogRenderer } from './frogs.js';
import { createArrowTrails } from './arrowTrails.js';
import { createLightningBolts } from './lightningBolts.js';
import { createParticleSystem } from './particleSystem.js';
import { createUnitAuras, AURA } from './unitAuras.js';
import { createMonkLobFx } from './monkLobFx.js';
import { createSporeBloomFx } from './sporeBloomFx.js';
import { createLocustFx } from './locustFx.js';
import { createFireballFx } from './fireballFx.js';
import { createMushroomPreviews } from './mushrooms.js';
import { createCarryLoads } from './carryLoads.js';
import { createAgoraProps } from './agoras.js';
import { createBuildingProps } from './buildings.js';
import { createBuildingRadialMenu } from './buildingRadial.js';
import { createBuildingActionRadial } from './buildingActionRadial.js';
import { createSelectionHud } from './selectionHud.js';
import { createControlGroupHud } from './controlGroupHud.js';
import {
  FX_DISTANCE_SQ,
  LOD_ENABLED,
  VAT_DISTANCE_SQ,
} from './lodDistances.js';
import {
  createHealthBars,
  DEFAULT_AGORA_ROOF,
  DEFAULT_BUILDING_ROOF,
  DEFAULT_UNIT_CHIP_LIFT,
  roofChipLift,
} from './healthBars.js';
import { HEALTH_BAR_CAPACITY, OVERLAY_MAX_SHIELDS } from './overlayLod.js';
import { LIGHTNING_HIT } from '../sim/lightning.js';
import { softDetachMesh } from './meshLifecycle.js';

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
  // Lite still records drawIndexed(..., 0) into render bundles — WebGPU warns.
  mesh.visible = count > 0;
}

/**
 * Expand Lite's dirty range for one instance slot.
 * Prefer this over flushThinInstances(), which always marks the full buffer dirty.
 */
function markThinInstanceSlotDirty(mesh, slot) {
  const ti = mesh?.thinInstances;
  if (!ti || slot < 0 || slot >= (ti.count ?? 0)) return;
  if (ti._version === ti._gpuVersion) {
    ti._version++;
    ti._dirtyMin = slot;
    ti._dirtyMax = slot + 1;
  } else {
    if (slot < ti._dirtyMin) ti._dirtyMin = slot;
    if (slot + 1 > ti._dirtyMax) ti._dirtyMax = slot + 1;
  }
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
  return { x: ray.ox + ray.dx * t, y: 0, z: ray.oz + ray.dz * t };
}

/**
 * Ray × heightfield. y=0 plane picks read "further away" on slopes — units and
 * markers must share this hit or the ping won't sit under the cursor.
 * @param {(x: number, z: number) => number} heightAt
 */
function rayHitTerrain(ray, heightAt) {
  if (!heightAt) return rayHitGround(ray);
  const maxH = HEIGHT_AMPLITUDE + 1;
  const minH = -0.5;
  // Looking down: march from sky band to below min surface.
  let t0 = 0;
  let t1 = 8000;
  if (Math.abs(ray.dy) > 1e-8) {
    const tTop = (maxH - ray.oy) / ray.dy;
    const tBot = (minH - ray.oy) / ray.dy;
    t0 = Math.max(0, Math.min(tTop, tBot));
    t1 = Math.max(tTop, tBot);
  }
  if (!(t1 > t0)) return rayHitGround(ray);

  const steps = 56;
  let prevT = t0;
  let prevAbove = null;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const x = ray.ox + ray.dx * t;
    const y = ray.oy + ray.dy * t;
    const z = ray.oz + ray.dz * t;
    const above = y >= heightAt(x, z);
    if (prevAbove === true && !above) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) * 0.5;
        const mx = ray.ox + ray.dx * mid;
        const my = ray.oy + ray.dy * mid;
        const mz = ray.oz + ray.dz * mid;
        if (my >= heightAt(mx, mz)) lo = mid;
        else hi = mid;
      }
      const ht = (lo + hi) * 0.5;
      const hx = ray.ox + ray.dx * ht;
      const hz = ray.oz + ray.dz * ht;
      return { x: hx, y: heightAt(hx, hz), z: hz };
    }
    prevAbove = above;
    prevT = t;
  }
  // Fallback: still return a plane hit so orders aren't dropped.
  return rayHitGround(ray);
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

/** Small clearance above sampled terrain (instance origin at ground + this). */
const FOOT_CLEARANCE = 0.06;

/** Yaw, then pitch (somersault), then roll (barrel) — comic air tumble. */
function writeUnitMatrix(matrices, slot, x, z, uniformScale, yaw, moving, groundY = 0, pitch = 0, roll = 0) {
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
  const cy = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // After yaw+pitch: X0=(cy,0,-syw), Y0=(syw*sp,cp,cy*sp), Z0=(syw*cp,-sp,cy*cp)
  // Then roll about local Z: X=X0*cr+Y0*sr, Y=-X0*sr+Y0*cr, Z=Z0
  const x0x = cy;
  const x0z = -syw;
  const y0x = syw * sp;
  const y0y = cp;
  const y0z = cy * sp;
  const z0x = syw * cp;
  const z0y = -sp;
  const z0z = cy * cp;

  matrices[o] = (x0x * cr + y0x * sr) * sx;
  matrices[o + 1] = (y0y * sr) * sx;
  matrices[o + 2] = (x0z * cr + y0z * sr) * sx;
  matrices[o + 3] = 0;
  matrices[o + 4] = (-x0x * sr + y0x * cr) * sy;
  matrices[o + 5] = (y0y * cr) * sy;
  matrices[o + 6] = (-x0z * sr + y0z * cr) * sy;
  matrices[o + 7] = 0;
  matrices[o + 8] = z0x * sz;
  matrices[o + 9] = z0y * sz;
  matrices[o + 10] = z0z * sz;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = groundY + FOOT_CLEARANCE;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function writeFlatRing(matrices, i, x, z, diameter, ringDiam, ringH, groundY = 0) {
  const o = i * 16;
  if (diameter <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const s = diameter / ringDiam;
  const y = groundY + ringH * 0.5;
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

/** Uniform scale + Y spin; `yOffset` is added above ground / foot clearance. */
function writeGroundSpinMarker(matrices, i, x, z, scale, spinYaw, yOffset, groundY = 0) {
  const o = i * 16;
  if (scale <= 0) {
    for (let k = 0; k < 16; k++) matrices[o + k] = 0;
    return;
  }
  const c = Math.cos(spinYaw);
  const s = Math.sin(spinYaw);
  matrices[o] = c * scale;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * scale;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = scale;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * scale;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * scale;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = groundY + FOOT_CLEARANCE + yOffset;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

/** v1 collar.glb — uniform scale + Y spin at feet. */
function writeSelectionCollar(matrices, i, x, z, scale, spinYaw, groundY = 0) {
  // Match game/units.js SELECTION_INDICATOR_Y_OFFSET * TILE (TILE≈4 → 0.14).
  writeGroundSpinMarker(matrices, i, x, z, scale, spinYaw, 0.14, groundY);
}

/**
 * Order / fallback washes. Collar idle bands are NOT this — each part keeps its
 * authored color in a per-part buffer (materials are whitened so instance color
 * can fully replace: multiply cannot bleach red/yellow albedo to gray).
 */
const RING_TINT = {
  white: [1, 1, 1, 1],
  cyan: [0.15, 1, 1, 1],
  red: [1, 0.12, 0.08, 1],
  /** Force-move wash — same gray as target.glb move arrow. */
  yellow: [0.68, 0.68, 0.68, 1],
};

/** Write RGBA into a color buffer at instance i. */
function writeRgbaAt(colors, i, c) {
  const o = i * 4;
  colors[o] = c[0];
  colors[o + 1] = c[1];
  colors[o + 2] = c[2];
  colors[o + 3] = c[3] ?? 1;
}

function applyUnlitHudMaterial(mat) {
  if (!mat) return;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('ormTexture' in mat || 'baseColorTexture' in mat) setPbrUnlit(mat);
  else if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
}

/**
 * collar.glb bakes solid band colors into 1×1 baseColor textures — setting
 * diffuseColor / baseColorFactor does not clear them. Read the authored RGB
 * (factor if present, else material name) before swapping to a white mat.
 */
function authoredCollarBandColor(mat) {
  const f = mat?.baseColorFactor ?? mat?._baseColorFactor;
  if (Array.isArray(f) && f.length >= 3) {
    return [f[0], f[1], f[2], 1];
  }
  const name = String(mat?.name || '').toLowerCase();
  if (name.includes('red')) return [1, 0.02, 0.02, 1];
  if (name.includes('yellow')) return [1, 0.77, 0, 1];
  if (name.includes('white') || name.includes('grey') || name.includes('gray')) {
    return [0.8, 0.8, 0.8, 1];
  }
  return [1, 1, 1, 1];
}

/** White unlit std mat so thin-instance color fully owns the collar look. */
function makeCollarTintMaterial() {
  const mat = createStandardMaterial();
  mat.diffuseColor = [1, 1, 1];
  // disableLighting path is emissive × diffuse × instanceColor
  mat.emissiveColor = [1, 1, 1];
  mat.alpha = 1;
  applyUnlitHudMaterial(mat);
  return mat;
}

const SELECTION_COLLAR_URL = '/assets/models/collar.glb';
/** v1: max(0.12, TILE * 0.22) with TILE=4. */
const SELECTION_COLLAR_SCALE = 0.88;
/** Casters — 50% larger than the base infantry collar. */
const SELECTION_COLLAR_CASTER_SCALE = SELECTION_COLLAR_SCALE * 1.5;
/** Vehicles / air — fixed large collar (10% under prior 3.4). */
const SELECTION_COLLAR_VEHICLE_SCALE = 3.4 * 0.9;

/** v1 click-command marker (`game/ui.js` createTargetMarker). */
const ORDER_MARKER_URL = '/assets/models/target.glb';
/**
 * Park this far along eye→hit (clamped). Same screen XY as the click, in front
 * of world geo. Scale tracks placeDist so apparent size stays steady.
 */
const ORDER_MARKER_HUD_DIST = 55;
const ORDER_MARKER_BASE_SCALE = 2.2;
const ORDER_POP_MS = 125;
const ORDER_HOLD_MS = 250;
const ORDER_FADE_MS = 200;
const ORDER_TOTAL_MS = ORDER_POP_MS + ORDER_HOLD_MS + ORDER_FADE_MS;
/** Radians of Y spin during pop (settles to camera-facing). Was 1.35π; punched to 2.4π — midpoint. */
const ORDER_SPIN_RAD = Math.PI * 1.875;

/** Boot / grow floor for type×owner unit batches. */
const UNIT_BATCH_INITIAL = 32;

function tintableParts(batch) {
  return batch.vatParts ?? batch.staticParts ?? null;
}

function partWhiteColors(batch) {
  return batch.vatWhiteColors ?? batch.partWhiteColors ?? null;
}

function vatPartMeshes(batch) {
  const parts = tintableParts(batch);
  if (parts?.length) return parts.map((p) => p.mesh);
  return batch.mesh ? [batch.mesh] : [];
}

function applyPartColors(batch) {
  const parts = tintableParts(batch);
  if (parts?.length) {
    const white = partWhiteColors(batch);
    for (const part of parts) {
      setThinInstanceColors(part.mesh, part.isTeamColor ? batch.colors : white);
    }
    return;
  }
  if (batch.mesh) setThinInstanceColors(batch.mesh, batch.colors);
}

function fillRgbaWhite(buf, from, to) {
  for (let s = from; s < to; s++) {
    buf[s * 4] = 1;
    buf[s * 4 + 1] = 1;
    buf[s * 4 + 2] = 1;
    buf[s * 4 + 3] = 1;
  }
}

/** Map unit thin-instance meshes for GPU pick (pickable only when USE_GPU_PICK). */
function registerUnitPickBatch(unitPickMeshes, batch) {
  if (!batch) return;
  for (const mesh of vatPartMeshes(batch)) {
    if (!mesh) continue;
    mesh.pickable = USE_GPU_PICK;
    unitPickMeshes.set(mesh, batch);
  }
}

function resizeTypeBatch(batch, entityIds, opts = {}) {
  const prealloc = opts.preallocKoth ?? false;
  const newSize = entityIds.length;
  if (newSize > batch.gpuCapacity) {
    const cap = capacityFor(newSize, { initial: UNIT_BATCH_INITIAL });
    growTypeBatchCapacity(batch, cap);
  }
  // Keep GPU draw count at capacity for KOTH — Lite fails when ti.count grows after boot
  // without a setThinInstances realloc. Shadow casters key off mappedSize; empty
  // prealloc batches stay at full ti.count but do not cast.
  const drawCount = prealloc ? Math.max(batch.gpuCapacity, 1) : newSize;
  for (const mesh of vatPartMeshes(batch)) setThinInstanceCount(mesh, drawCount);
  batch.entityIds = entityIds;
  batch.mappedSize = newSize;
  if (prealloc && newSize < batch.gpuCapacity) {
    for (let s = newSize; s < batch.gpuCapacity; s++) {
      const o = s * 16;
      for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
    }
  }
  applyPartColors(batch);
  for (const mesh of vatPartMeshes(batch)) flushThinInstances(mesh);
}

/**
 * Realloc thin-instance / VAT buffers to a larger capacity (pow2 grow).
 * @param {object} batch
 * @param {number} newCap
 */
function growTypeBatchCapacity(batch, newCap) {
  const oldCap = batch.gpuCapacity | 0;
  if (newCap <= oldCap) return;

  const matrices = new Float32Array(newCap * 16);
  matrices.set(batch.matrices.subarray(0, oldCap * 16));
  const colors = new Float32Array(newCap * 4);
  colors.set(batch.colors.subarray(0, oldCap * 4));
  for (let s = oldCap; s < newCap; s++) {
    colors[s * 4] = 1;
    colors[s * 4 + 1] = 1;
    colors[s * 4 + 2] = 1;
    colors[s * 4 + 3] = 1;
  }

  const parts = tintableParts(batch);
  if (parts?.length) {
    const prevWhite = partWhiteColors(batch);
    const white = new Float32Array(newCap * 4);
    if (prevWhite) white.set(prevWhite.subarray(0, oldCap * 4));
    fillRgbaWhite(white, oldCap, newCap);
    if (batch.vatParts?.length) {
      const vatParams = new Float32Array(newCap * 4);
      vatParams.set(batch.vatParams.subarray(0, oldCap * 4));
      const vatMoving = new Uint8Array(newCap);
      vatMoving.set(batch.vatMoving.subarray(0, oldCap));
      const vatPhase = new Float32Array(newCap);
      vatPhase.set(batch.vatPhase.subarray(0, oldCap));
      const frameCount = Math.max(1, batch.idleClip?.frameCount ?? 1);
      for (let s = oldCap; s < newCap; s++) {
        vatPhase[s] = (s * 17 + 3) % frameCount;
      }
      fillVatInstanceParams(vatParams, newCap, batch.idleClip, batch.walkClip, vatMoving, batch.carryClip, batch.carryWalkClip, batch.chopClip);
      for (const part of batch.vatParts) {
        setThinInstances(part.mesh, matrices, newCap);
        setThinInstanceColors(part.mesh, part.isTeamColor ? colors : white);
        part.handle.setInstances(vatParams);
      }
      batch.vatWhiteColors = white;
      batch.vatParams = vatParams;
      batch.vatMoving = vatMoving;
      batch.vatPhase = vatPhase;
    } else {
      for (const part of batch.staticParts) {
        setThinInstances(part.mesh, matrices, newCap);
        setThinInstanceColors(part.mesh, part.isTeamColor ? colors : white);
      }
      batch.partWhiteColors = white;
    }
  } else if (batch.mesh) {
    setThinInstances(batch.mesh, matrices, newCap);
    setThinInstanceColors(batch.mesh, colors);
  }

  batch.matrices = matrices;
  batch.colors = colors;
  batch.gpuCapacity = newCap;
}

async function loadStaticUnitParts(engine, url) {
  const meshes = await loadBakedUnitMeshParts(engine, url);
  /** @type {{ mesh: object, isTeamColor: boolean }[]} */
  const parts = [];
  for (const mesh of meshes) {
    const team = isTeamColorMaterial(mesh.material);
    if (team) prepareTeamColorMaterial(engine, mesh);
    parts.push({ mesh, isTeamColor: team });
  }
  return parts;
}

/**
 * @param {object} engine
 * @param {number} typeId
 * @param {number} activeCount
 * @param {number} gpuCap
 */
/** VAT when registered; otherwise static mesh bake (interim until all units are skinned). */
async function createTypeBatch(engine, typeId, activeCount, gpuCap) {
  if (isVatUnitType(typeId)) {
    const def = VAT_UNIT_DEFS[typeId];
    const vat = await loadVatUnitTemplate(engine, def);
    const cap = Math.max(activeCount, gpuCap, 1);
    const matrices = new Float32Array(cap * 16);
    const colors = new Float32Array(cap * 4);
    const vatWhiteColors = new Float32Array(cap * 4);
    for (let s = 0; s < cap; s++) {
      colors[s * 4] = 1;
      colors[s * 4 + 1] = 1;
      colors[s * 4 + 2] = 1;
      colors[s * 4 + 3] = 1;
      vatWhiteColors[s * 4] = 1;
      vatWhiteColors[s * 4 + 1] = 1;
      vatWhiteColors[s * 4 + 2] = 1;
      vatWhiteColors[s * 4 + 3] = 1;
    }

    const vatParams = new Float32Array(cap * 4);
    const vatMoving = new Uint8Array(cap);
    const vatPhase = new Float32Array(cap);
    for (let s = 0; s < cap; s++) {
      vatPhase[s] = (s * 17 + 3) % Math.max(1, vat.idleClip.frameCount);
    }
    fillVatInstanceParams(vatParams, cap, vat.idleClip, vat.walkClip, vatMoving, vat.carryClip, vat.carryWalkClip, vat.chopClip);

    // Shared matrices across primitives; TeamColor part alone takes owner tint.
    // setInstances must run before registerScene for the thin-instance VAT path.
    for (const part of vat.parts) {
      setThinInstances(part.mesh, matrices, cap);
      if (activeCount < cap) setThinInstanceCount(part.mesh, activeCount);
      setThinInstanceColors(part.mesh, part.isTeamColor ? colors : vatWhiteColors);
      part.handle.setInstances(vatParams);
    }

    return {
      mesh: vat.mesh,
      matrices,
      colors,
      vatWhiteColors,
      baseSize: 1,
      entityIds: [],
      gpuCapacity: cap,
      mappedSize: 0,
      vatHandle: vat.handle,
      vatParts: vat.parts,
      vatRoot: vat.root,
      vatContainer: vat.container,
      vatParams,
      vatMoving,
      vatPhase,
      idleClip: vat.idleClip,
      walkClip: vat.walkClip,
      carryClip: vat.carryClip ?? null,
      carryWalkClip: vat.carryWalkClip ?? null,
      chopClip: vat.chopClip ?? null,
      vatScale: vat.instanceScale,
      vatFootLift: vat.footLift,
      vatDirty: false,
    };
  }

  const staticParts = await loadStaticUnitParts(engine, UNIT_MODEL_URLS[typeId]);
  if (!staticParts.length) throw new Error(`no mesh parts for unit type ${typeId}`);
  const mesh = staticParts[0].mesh;
  const cap = Math.max(activeCount, gpuCap, 1);
  const matrices = new Float32Array(cap * 16);
  const colors = new Float32Array(cap * 4);
  const partWhite = new Float32Array(cap * 4);
  fillRgbaWhite(colors, 0, cap);
  fillRgbaWhite(partWhite, 0, cap);
  for (const part of staticParts) {
    setThinInstances(part.mesh, matrices, cap);
    if (activeCount < cap) setThinInstanceCount(part.mesh, activeCount);
    setThinInstanceColors(part.mesh, part.isTeamColor ? colors : partWhite);
  }
  return {
    mesh,
    matrices,
    colors,
    partWhiteColors: partWhite,
    staticParts,
    baseSize: 1,
    entityIds: [],
    gpuCapacity: cap,
    mappedSize: 0,
    fxSockets: mesh.fxSockets ?? [],
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} capacity
 * @param {{ types?: Int8Array | Uint8Array | number[], owners?: Uint8Array | number[], gpuCapacity?: number, field?: object | null, onAnimLoadProgress?: (done: number, total: number) => void }} [opts]
 */
export async function createRenderer(canvas, capacity, opts = {}) {
  const bootT0 = performance.now();
  const bootDebug = new URLSearchParams(location.search).get('debug') === 'boot';
  const bootLog = (label) => {
    if (!bootDebug) return;
    console.info(`[boot] ${label} +${(performance.now() - bootT0).toFixed(0)}ms`);
  };
  /** Yield a painted frame so sequential GLB / pipeline work cannot pin the tab. */
  function afterPaint() {
    return new Promise((resolve) => {
      const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
      raf(() => setTimeout(resolve, 0));
    });
  }
  const types = opts.types;
  const gpuCapacity = opts.gpuCapacity ?? capacity;
  const preallocKoth = gpuCapacity > capacity;
  const engine = await createEngine(canvas, { msaaSamples: 1 });
  bootLog('engine');
  const scene = createSceneContext(engine);
  const buildingMenuFontPromise = loadFont('/assets/fonts/Roboto-Regular.ttf').catch((err) => {
    console.warn('Building menu labels disabled: Roboto font failed to load.', err);
    return null;
  });
  const tableHalfF = opts.field ? worldHalfFFromField(opts.field) : WORLD_HALF_F;
  const cameraHalfF = resolveCameraHalfF(tableHalfF, opts.field?.cameraHalfF);

  const camera = createArcRotateCamera(-Math.PI / 2.1, Math.PI / 3.2, cameraHalfF * 1.55, {
    x: 0,
    y: 0,
    z: 0,
  });
  // Lite calls Babylon's maxZ equivalent `farPlane`. The default 1000 clips
  // the environment ring and even parts of the board at wide zoom levels.
  camera.farPlane = 40000;
  scene.camera = camera;
  // Camera input is owned by cameraController (v1 mouse/keyboard). Do not attachControl —
  // Lite would still register wheel/touch handlers that fight our hub.
  const cameraController = createCameraController(camera, canvas, { worldHalfF: cameraHalfF });

  const celestial = createCelestialRig(scene, { worldHalfF: tableHalfF });
  const sun = celestial.shadowLight;
  const sky = celestial.fillLight;
  const skyBaseIntensity = celestial.fillBaseIntensity;

  // CSM: fits cascades from thin-instance world AABBs + camera (ESM only fits
  // mesh.world × local bounds, so board-scale TI units vanish or become ~2 texels).
  // Keep worldSpaceBias tiny — unit height is ~1–2; 0.15+ eats character contact shadows.
  // Note: Lite keeps darkness / worldSpaceBias on an internal csmCfg, not sg._config.
  // Quality is fixed at construction: the depth texture is allocated at these
  // dimensions and csmCfg is captured in the generator's closures, with no
  // setter and no dispose. Changing tiers therefore needs a reload — see the
  // settings menu, which persists the choice and says so.
  const shadowQuality = opts.shadowQuality ?? {};
  const shadowOpts = {
    mapSize: shadowQuality.mapSize ?? 2048,
    numCascades: shadowQuality.numCascades ?? 4,
    lambda: 0.85,
    cascadeBlendPercentage: 0.08,
    stabilizeCascades: true,
    shadowMaxZ: tableHalfF * 2.75,
    worldSpaceBias: 0.02,
    // 0 = black in shadow, 1 = no shadow (PCF mixes darkness→1 by lit factor).
    darkness: 0.16,
    frustumEdgeFalloff: 0.04,
    forceRefreshEveryFrame: true,
  };
  const shadowGen = createCsmDirectionalShadowGenerator(engine, sun, shadowOpts);
  sun.shadowGenerator = shadowGen;
  // Always boots enabled so receivers register with shadow sampling compiled in
  // (see markShadowReceivers before applyShadowState). Callers wanting shadows
  // off apply setShadowsEnabled(false) after start().
  let shadowsEnabled = true;
  /** Socket fire / ground fire / particles / aura sparkles — settings slider + F key. */
  const DEFAULT_FX_QUALITY = {
    hardMax: 65536,
    initial: 8192,
    unitFxIntervalMs: 80,
    groundFireIntervalMs: 55,
    sparkleIntervalMs: 70,
    emitChance: 1,
    distance: 900,
    cullRangeScale: 1,
    socketFire: true,
  };
  let fxMode = opts.fxMode ?? 3;
  let lastNonZeroFxMode = fxMode > 0 ? fxMode : 3;
  let fxQuality = { ...DEFAULT_FX_QUALITY, ...(opts.fxQuality || {}) };
  let lastNonZeroFxQuality = { ...fxQuality };
  let fxEnabled = fxMode !== 0;
  let unitFxIntervalMs = fxQuality.unitFxIntervalMs;
  let groundFireIntervalMs = fxQuality.groundFireIntervalMs;
  let fxEmitChance = fxQuality.emitChance;
  let fxDistanceSq =
    fxQuality.distance > 0 ? fxQuality.distance * fxQuality.distance : 0;
  let socketFireEnabled = fxMode !== 0 && !!fxQuality.socketFire;
  /**
   * Per-style cadences (not one global pulse). Classic recipe:
   * fire = steady rate-over-time, smoke = slow puffs, sparkle = intermittent twinkles.
   * unitFxIntervalMs remains a quality scale factor (~1 at default 80).
   */
  const SOCKET_FX_CADENCE = {
    fire: 70,
    smoke: 240,
    sparkle: 210,
  };
  let socketFireElapsed = Math.random() * SOCKET_FX_CADENCE.fire;
  let socketSmokeElapsed = Math.random() * SOCKET_FX_CADENCE.smoke;
  let socketSparkleElapsed = Math.random() * SOCKET_FX_CADENCE.sparkle;
  let groundFireElapsed = 0;
  /** VAT clock advance — A/B with V key. */
  let vatEnabled = true;
  /** Unit meshes + pose loop — A/B with U key. */
  let unitsEnabled = true;
  /** When true, FX / trail / lightning clocks freeze (sim pause). */
  let fxPaused = false;
  /** Stable list so shadow task state is not rebuilt every flush. */
  let shadowCasterList = [];
  // Tiny hidden caster used while shadows are "off". Keeps CSM passes non-empty
  // (empty [] still records depth-only passes that crash billboards) without
  // detaching the generator (that poisoned near cascades on re-enable).
  const shadowOffCasterMat = createStandardMaterial();
  shadowOffCasterMat.diffuseColor = [0, 0, 0];
  const shadowOffCaster = createSphere(engine, { diameter: 0.05, segments: 4 });
  shadowOffCaster.name = 'shadow-off-caster';
  shadowOffCaster.material = shadowOffCasterMat;
  shadowOffCaster.visible = false;
  shadowOffCaster.receiveShadows = false;
  shadowOffCaster.position.y = -1000;
  addToScene(scene, shadowOffCaster);
  const SHADOW_CASTERS_OFF = [shadowOffCaster];

  /** @type {{ meshes: object[], update?: (camera: object, deltaMs: number) => void, applyTreeUpdates?: Function, dispose: () => void } | null} */
  let terrain = null;
  /** Serializes setField + drops stale rebuilds (match start / seed change). */
  let fieldGen = 0;
  /** @type {AbortController | null} */
  let fieldAbort = null;
  let setFieldChain = Promise.resolve();
  /** @type {{ setVisible: (on: boolean) => void, dispose: () => void } | null} */
  let tileGrid = null;
  let tileGridVisible = false;
  /** Occupancy fills lag behind field while grid is hidden; refresh on show. */
  let tileGridOccupancyDirty = false;
  /** O-key screenshot chrome — HUD / collars / grids off, world stays. */
  let screenshotHudHidden = false;
  /** @type {{ x: number, z: number, radius: number, owner?: number }[] | { x: number, z: number, radius: number, owner?: number } | null} */
  let lastWorkRadiusSpec = null;
  /** @type {unknown} */
  let lastBuildingHighlight = null;
  /** @type {{ setFocus: Function, dispose: () => void } | null} */
  let placementGrid = null;
  /** @type {{ type: string, x: number, z: number, valid?: boolean } | null} */
  let placementFocus = null;
  let ground = null;
  /** @type {object | null} */
  let fieldSnap = opts.field ?? null;
  /** Late-bound so scenery can emit before the particle system exists. */
  const treeFireEmit = { fn: null };

  function allowContinuousFx() {
    return fxEmitChance >= 1 || Math.random() < fxEmitChance;
  }

  /** v1 fire/smoke: explosion.png sprite + random spin. */
  function puffSprite(spin = 1.4) {
    return {
      sprite: 'puff',
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * spin,
    };
  }

  // Must exist before `await createTerrainFromField` — cached tree/rock GLBs can
  // fire onModelMesh as a microtask before the later shadow-setup consts run.
  /** Meshes already queued/deferred at least once (avoid re-defer on every place()). */
  const shadowCasterNoted = new WeakSet();
  /** @type {object[]} */
  const pendingShadowNotes = [];
  let shadowNotesReady = false;

  function sceneryOpts() {
    return {
      emitFire(x, y, z, scale) {
        if (!fxEnabled || !socketFireEnabled || !allowContinuousFx()) return;
        const eye = cameraEyePos();
        if (eye && Number.isFinite(fxDistanceSq) && fxDistanceSq > 0) {
          const dx = eye.x - x;
          const dy = eye.y - y;
          const dz = eye.z - z;
          if (dx * dx + dy * dy + dz * dz > fxDistanceSq) return;
        }
        treeFireEmit.fn?.(x, y, z, scale);
      },
      // 3D trees/rocks pop in after Phase A register — fold them into CSM.
      onModelMesh(mesh) {
        if (!mesh) return;
        mesh.receiveShadows = shadowsEnabled && !isBackdropMesh(mesh);
        noteShadowMesh(mesh);
      },
    };
  }

  function groundYAt(x, z) {
    return fieldSnap ? surfaceHeightAt(fieldSnap, x, z) : 0;
  }

  function cameraEyePos() {
    const wm = camera.worldMatrix;
    if (wm && Number.isFinite(wm[12])) return { x: wm[12], y: wm[13], z: wm[14] };
    const p = camera.position;
    return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
  }

  function rebuildTileGrid(snap) {
    tileGrid?.dispose?.();
    placementGrid?.dispose?.();
    tileGrid = null;
    placementGrid = null;
    tileGridOccupancyDirty = false;
    if (!snap) return;
    tileGrid = createTileGridOverlay(engine, scene, snap);
    // Apply current toggle after rebuild (mesh starts hidden / off-scene).
    tileGrid.setVisible(tileGridVisible);
    placementGrid = createPlacementGridOverlay(engine, scene);
    syncPlacementGrid();
  }

  /** Refresh blocked/slow fills from the live field (trees, buildings, etc.). */
  function refreshTileGridOccupancy() {
    if (!tileGrid || !fieldSnap) return;
    tileGrid.refreshOccupancy?.(fieldSnap);
    tileGridOccupancyDirty = false;
  }

  /** Local G-grid around the placement ghost. Hidden while the full G overlay is on. */
  function syncPlacementGrid() {
    if (!placementGrid) return;
    if (screenshotHudHidden || tileGridVisible || !placementFocus || !fieldSnap) {
      placementGrid.setFocus(null);
      return;
    }
    placementGrid.setFocus(fieldSnap, placementFocus);
  }

  function applyWorkRadiusSpec(spec) {
    if (!spec) {
      workRadiusRings.clear();
      return;
    }
    const list = Array.isArray(spec) ? spec : [spec];
    workRadiusRings.sync(list);
  }

  function hideScreenshotHudChrome() {
    buildingRadial.hide();
    actionRadial.hide();
    selectionHud.clear();
    controlGroupHud.clear();
    healthBars.begin();
    healthBars.end();
    workRadiusRings.clear();
    tileGrid?.setVisible(false);
    placementGrid?.setFocus(null);
    for (const mesh of selRingParts) mesh.visible = false;
    if (orderMarker) orderMarker.visible = false;
    buildingProps.setSelectionHighlight?.(null);
    pickHitboxes.clear();
  }

  function restoreScreenshotHudChrome() {
    applyWorkRadiusSpec(lastWorkRadiusSpec);
    buildingProps.setSelectionHighlight?.(lastBuildingHighlight);
    if (tileGridVisible && tileGridOccupancyDirty) refreshTileGridOccupancy();
    tileGrid?.setVisible(tileGridVisible);
    syncPlacementGrid();
    applyUnitMeshVisibility();
  }

  /** Unit templates wait on this so 3D trees/rocks win the first pop-in. */
  let sceneryModelsReady = Promise.resolve();
  if (opts.field) {
    terrain = await createTerrainFromField(engine, scene, opts.field, camera, sceneryOpts());
    sceneryModelsReady = terrain.modelsReady ?? Promise.resolve();
    rebuildTileGrid(opts.field);
  } else {
    const groundMat = createStandardMaterial();
    groundMat.diffuseColor = [0.18, 0.28, 0.16];
    ground = createGround(engine, { width: tableHalfF * 2, height: tableHalfF * 2 });
    ground.material = groundMat;
    addToScene(scene, ground);
  }

  let entitySlot = new Int32Array(Math.max(capacity, gpuCapacity));
  entitySlot.fill(-1);
  /** Per-entity batch map key (VAT shards use `${typeId}#${shard}`). */
  /** @type {(string | number | null)[]} */
  const entityBatchKey = new Array(entitySlot.length).fill(null);

  function ensureEntityCapacity(needed) {
    const n = Math.max(0, needed | 0);
    if (n <= entitySlot.length) return;
    const nextLen = capacityFor(n, { initial: entitySlot.length });
    const next = new Int32Array(nextLen);
    next.fill(-1);
    next.set(entitySlot);
    entitySlot = next;
    while (entityBatchKey.length < nextLen) entityBatchKey.push(null);
  }
  const UNIT_PING_MS = 280;
  const UNIT_PING_PULSES = 0.5;
  const UNIT_PING_PEAK = 1.35;
  /** @type {Map<number, { started: number, r: number, g: number, b: number, a: number }>} */
  const unitPings = new Map();

  /** @type {Map<string | number, object>} */
  const typeBatches = new Map();
  /** Mesh → batch for GPU unit picking (static + VAT parts). */
  const unitPickMeshes = new Map();
  const vatInstanceCap = maxVatInstancesPerBatch(engine);

  function batchKey(typeId, owner = 0) {
    return `${typeId}:${owner | 0}`;
  }

  function vatShardKey(typeId, shard) {
    return `${typeId}#${shard}`;
  }

  function chunkIds(ids, maxPer) {
    const out = [];
    for (let i = 0; i < ids.length; i += maxPer) out.push(ids.slice(i, i + maxPer));
    return out.length ? out : [[]];
  }

  async function addVatShards(typeId, entityIds, owner = 0) {
    const base = batchKey(typeId, owner);
    const chunks = chunkIds(entityIds, vatInstanceCap);
    for (let shard = 0; shard < chunks.length; shard++) {
      const slice = chunks[shard];
      const key = chunks.length === 1 ? base : vatShardKey(base, shard);
      const gpuCap = capacityFor(slice.length, { initial: UNIT_BATCH_INITIAL });
      const batch = await createTypeBatch(engine, typeId, slice.length, gpuCap);
      batch.entityIds = slice;
      batch.mappedSize = slice.length;
      batch.vatShard = shard;
      batch.vatShardBase = base;
      if (batch.vatContainer) addToScene(scene, batch.vatContainer);
      else if (batch.vatRoot) addToScene(scene, batch.vatRoot);
      else for (const mesh of vatPartMeshes(batch)) addToScene(scene, mesh);
      noteBatchMeshesForShadow(batch);
      refineVatFootLift(batch);
      typeBatches.set(key, batch);
      registerUnitPickBatch(unitPickMeshes, batch);
      for (let s = 0; s < slice.length; s++) {
        entitySlot[slice[s]] = s;
        entityBatchKey[slice[s]] = key;
      }
      opts.onAnimLoadProgress?.(shard + 1, chunks.length);
    }
    return chunks.length;
  }

  /** After addToScene — soles sit near instance Y (VAT×mesh.world cancels armature). */
  function refineVatFootLift(batch) {
    if (!batch?.vatParts?.length) return;
    // Do NOT subtract mesh.worldY*scale — that double-counts and buries units.
    batch.vatFootLift = 0.08;
  }

  // Progressive boot: unit templates load in Phase B / on demand — not before first paint.
  bootLog('terrain ready');

  /** @type {Map<string, Promise<void>>} */
  const batchEnsureInflight = new Map();
  let lastMapCount = 0;
  /** @type {Int8Array | Uint8Array | number[] | null} */
  let lastMapTypes = null;
  /** @type {Uint8Array | number[] | null} */
  let lastMapOwners = null;
  let firstUnitLogged = false;
  let poseResyncGeneration = 0;
  let lastConsumedPoseResync = 0;

  async function createAndRegisterStaticBatch(typeId, entityIds, owner) {
    const batchSize = entityIds.length;
    const gpuCap = capacityFor(Math.max(batchSize, 1), { initial: UNIT_BATCH_INITIAL });
    const batch = await createTypeBatch(engine, typeId, Math.max(batchSize, 1), gpuCap);
    const key = batchKey(typeId, owner);
    batch.entityIds = entityIds;
    batch.mappedSize = batchSize;
    if (preallocKoth) {
      for (const mesh of vatPartMeshes(batch)) setThinInstanceCount(mesh, gpuCap);
      for (let s = batchSize; s < gpuCap; s++) {
        const o = s * 16;
        for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
      }
    }
    for (const partMesh of vatPartMeshes(batch)) addToScene(scene, partMesh);
    noteBatchMeshesForShadow(batch);
    typeBatches.set(key, batch);
    registerUnitPickBatch(unitPickMeshes, batch);
    for (let s = 0; s < entityIds.length; s++) {
      entitySlot[entityIds[s]] = s;
      entityBatchKey[entityIds[s]] = key;
    }
    return batch;
  }

  /**
   * Lazy VAT-first unit batches (static mesh fallback when not in VAT_UNIT_DEFS).
   * @param {number} typeId
   * @param {number} owner
   * @param {number[]} entityIds
   */
  function ensureTypeOwnerBatch(typeId, owner, entityIds) {
    const base = batchKey(typeId, owner);
    if (typeBatches.has(base) || typeBatches.has(vatShardKey(base, 0))) {
      return batchEnsureInflight.get(base) ?? Promise.resolve();
    }
    let pending = batchEnsureInflight.get(base);
    if (pending) return pending;
    pending = (async () => {
      try {
        if (isVatUnitType(typeId)) {
          await addVatShards(typeId, entityIds, owner);
        } else if (hasUnitModel(typeId)) {
          await createAndRegisterStaticBatch(typeId, entityIds, owner);
        }
        if (!firstUnitLogged && typeBatches.size > 0) {
          firstUnitLogged = true;
          bootLog('first unit template');
        }
        opts.onAnimLoadProgress?.(typeBatches.size, typeBatches.size);
        if (lastMapTypes) {
          mapEntitySlots(lastMapCount, lastMapTypes, lastMapOwners);
          // New slots need a full pose rewrite — mark dirty + ask main to drop pose cache.
          for (const batch of typeBatches.values()) {
            for (const mesh of vatPartMeshes(batch)) {
              const n = mesh.thinInstances?.count ?? 0;
              if (n > 0) flushThinInstances(mesh);
            }
            flushVatParams(batch);
          }
          poseResyncGeneration++;
          flushAllBatches();
        }
      } catch (err) {
        console.warn(`[boot] unit type ${typeId} owner ${owner} failed`, err);
      } finally {
        batchEnsureInflight.delete(base);
      }
    })();
    batchEnsureInflight.set(base, pending);
    return pending;
  }

  /** @returns {Promise<void>} */
  function scheduleBatchesForTypes(count, typesArr, ownersArr) {
    if (!typesArr || count <= 0) return Promise.resolve();
    /** @type {Map<string, number[]>} */
    const groups = new Map();
    for (let i = 0; i < count; i++) {
      const typeId = Number(typesArr[i]);
      const owner = ownersArr ? Number(ownersArr[i]) : 0;
      if (!isVatUnitType(typeId) && !hasUnitModel(typeId)) continue;
      const key = batchKey(typeId, owner);
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(i);
    }
    // Start ensures only after scenery — building the job list must not call
    // ensureTypeOwnerBatch early (that raced past the gate).
    return sceneryModelsReady.then(async () => {
      for (const [key, entityIds] of groups) {
        const colon = key.lastIndexOf(':');
        const typeId = Number(key.slice(0, colon));
        const owner = Number(key.slice(colon + 1));
        await ensureTypeOwnerBatch(typeId, owner, entityIds);
        await afterPaint();
      }
    });
  }

  const BASE_DIAMETER = 6;
  let fallback = null;
  const fallbackCap = Math.max(gpuCapacity, capacity, 1);
  {
    // Always keep a cheap sphere fallback for unknown / still-loading types.
    const mesh = createSphere(engine, { diameter: BASE_DIAMETER, segments: capacity > 500 ? 6 : 10 });
    const material = createStandardMaterial();
    material.diffuseColor = [1, 1, 1];
    mesh.material = material;
    const { matrices, colors, gpuCapacity: cap } = initThinInstances(mesh, 0, fallbackCap);
    addToScene(scene, mesh);
    fallback = {
      mesh,
      matrices,
      colors,
      baseSize: BASE_DIAMETER,
      entityIds: [],
      gpuCapacity: cap,
      mappedSize: 0,
    };
    registerUnitPickBatch(unitPickMeshes, fallback);
  }

  const RING_DIAM = 1;
  const RING_H = 0.12;
  let ringCap = Math.max(capacity, gpuCapacity, 1);
  let selRingLiveCount = capacity;
  /** @type {object[]} */
  let selRingParts = [];
  let useCollar = false;
  /** Authored band RGBA per collar part (idle tint). Empty for fallback disc. */
  /** @type {number[][]} */
  let collarBandColors = [];
  // Phase A: cheap disc now; collar GLB upgrades in Phase B.
  {
    const selRing = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 24 });
    const ringMat = createStandardMaterial();
    ringMat.diffuseColor = [0, 1, 1];
    ringMat.emissiveColor = [0, 0.5, 0.5];
    ringMat.alpha = 0.9;
    selRing.material = ringMat;
    selRingParts = [selRing];
    collarBandColors = [];
  }
  let ringMatrices = new Float32Array(ringCap * 16);
  /** One color buffer per part — idle needs different band colors per draw. */
  const ringColorBufs = selRingParts.map(() => new Float32Array(ringCap * 4));

  function ringTintForPart(partIndex, mode) {
    if (useCollar && mode === 'white') {
      return collarBandColors[partIndex] ?? RING_TINT.white;
    }
    if (!useCollar && mode === 'white') return RING_TINT.cyan;
    return RING_TINT[mode] ?? RING_TINT.white;
  }

  function writeSelRingColors(count, mode = 'white') {
    for (let p = 0; p < ringColorBufs.length; p++) {
      const c = ringTintForPart(p, mode);
      const colors = ringColorBufs[p];
      for (let i = 0; i < count; i++) writeRgbaAt(colors, i, c);
    }
  }

  function writeSelRingColorAt(i, mode = 'white') {
    for (let p = 0; p < ringColorBufs.length; p++) {
      writeRgbaAt(ringColorBufs[p], i, ringTintForPart(p, mode));
    }
    ringColorsDirty = true;
  }

  writeSelRingColors(ringCap, useCollar ? 'white' : 'cyan');
  let ringColorsDirty = true;
  for (let p = 0; p < selRingParts.length; p++) {
    const mesh = selRingParts[p];
    setThinInstances(mesh, ringMatrices, ringCap);
    setThinInstanceCount(mesh, capacity);
    setThinInstanceColors(mesh, ringColorBufs[p]);
    addToScene(scene, mesh);
  }

  let orderMarker;
  let useOrderTarget = false;
  /** Local-space Y of the arrow tip (placed on the click ray). */
  let orderTipLocalY = 0;
  // Phase A: disc marker; target.glb upgrades in Phase B.
  {
    orderMarker = createCylinder(engine, { diameter: RING_DIAM, height: RING_H, tessellation: 32 });
    const orderMat = createStandardMaterial();
    orderMat.diffuseColor = [0.35, 0.75, 1];
    orderMat.emissiveColor = [0.2, 0.55, 1];
    orderMat.alpha = 1;
    orderMarker.material = orderMat;
    orderTipLocalY = 0;
  }
  const orderMatrices = new Float32Array(16);
  setThinInstances(orderMarker, orderMatrices, 1);
  setThinInstanceColors(orderMarker, new Float32Array([1, 1, 1, 0]));
  addToScene(scene, orderMarker);
  /** @type {{ x: number, y: number, z: number, started: number, tint: string, spinDir: number } | null} */
  let orderPing = null;
  let orderMarkerShown = false;
  /** Alternate pop spin direction each new ping. */
  let nextOrderSpinDir = 1;

  // Flat rim-fade rings for selected camp/mine/farm gather reach.
  const workRadiusRings = createWorkRadiusRings(engine, scene, groundYAt);
  const carryLoads = createCarryLoads(engine, scene);

  // +64 headroom so agora/building debug spheres fit on top of unit caps.
  const pickHitboxes = createPickHitboxRenderer(
    engine,
    scene,
    Math.max(capacity, gpuCapacity, 1) + 64,
  );
  // Packed overlay — not entity-indexed. Matching entity count made stress
  // draw tens of thousands of hidden 24-seg spheres (Lite keeps ti.count at cap).
  const holyShields = createPickHitboxRenderer(
    engine,
    scene,
    OVERLAY_MAX_SHIELDS,
    {
      startVisible: true,
      name: 'holy-shield',
      segments: 24,
      renderOrder: 190,
      createMaterial: createHolyShieldMaterial,
    },
  );
  const particles = await createParticleSystem(engine, scene, {
    getEye: cameraEyePos,
    capacity: Math.max(1, fxQuality.initial | 0),
    hardMax: Math.max(1, fxQuality.hardMax | 0),
    cullRangeScale: fxQuality.cullRangeScale ?? 1,
    muted: !fxEnabled,
  });
  const unitAuras = createUnitAuras((init) => particles.emit(init), groundYAt, {
    // Continuous FX distance is quality-tiered — not tied to scenery LOD_ENABLED.
    maxSparkleDistSq: fxDistanceSq > 0 ? fxDistanceSq : 0,
    sparkleIntervalMs: fxQuality.sparkleIntervalMs,
    getEye: cameraEyePos,
    muted: !fxEnabled,
  });

  function applyFxQuality(mode, quality) {
    fxMode = Math.max(0, mode | 0);
    if (quality) fxQuality = { ...DEFAULT_FX_QUALITY, ...quality };
    if (fxMode > 0) {
      lastNonZeroFxMode = fxMode;
      lastNonZeroFxQuality = { ...fxQuality };
    }
    unitFxIntervalMs = fxQuality.unitFxIntervalMs;
    groundFireIntervalMs = fxQuality.groundFireIntervalMs;
    fxEmitChance = fxQuality.emitChance;
    fxDistanceSq =
      fxQuality.distance > 0 ? fxQuality.distance * fxQuality.distance : 0;
    socketFireEnabled = fxMode !== 0 && !!fxQuality.socketFire;
    fxEnabled = fxMode !== 0;
    particles.configure({
      hardMax: Math.max(1, fxQuality.hardMax | 0),
      cullRangeScale: fxQuality.cullRangeScale ?? 1,
      muted: !fxEnabled,
    });
    unitAuras.configure?.({
      maxSparkleDistSq: fxDistanceSq > 0 ? fxDistanceSq : 0,
      sparkleIntervalMs: fxQuality.sparkleIntervalMs,
      muted: !fxEnabled,
    });
    if (!fxEnabled) {
      socketFireElapsed = 0;
      socketSmokeElapsed = 0;
      socketSparkleElapsed = 0;
      groundFireElapsed = 0;
    }
  }
  const monkLobFx = createMonkLobFx((init) => particles.emit(init), groundYAt);
  /** Filled after mushroom.glb loads; spore FX calls through this bridge. */
  let mushrooms = null;
  const mushroomBridge = {
    spawnCluster(x, z, growAt) {
      if (!mushrooms?.spawnCluster) return false;
      const ok = mushrooms.spawnCluster(x, z, growAt);
      return ok !== false;
    },
    spawnHead(entity, x, z, killed) {
      return mushrooms?.spawnHead?.(entity, x, z, killed) === true;
    },
    clearGrown(tick) {
      mushrooms?.clearGrown?.(tick);
    },
    clear() {
      mushrooms?.clear?.();
    },
    update(deltaMs, tick) {
      mushrooms?.update?.(deltaMs, tick);
    },
  };
  const sporeBloomFx = createSporeBloomFx(
    (init) => particles.emit(init),
    groundYAt,
    mushroomBridge,
  );
  const locustFx = createLocustFx((init) => particles.emit(init));
  const fireballFx = createFireballFx((init) => particles.emit(init));
  /** Scratch bitfield when syncing auras from shieldHp. */
  let auraScratch = null;
  /** Latest sim tick for time-based FX (spore seed expiry). */
  let fxSimTick = 0;
  /** Wide at the base, then pull inward while climbing (column, not fountain). */
  treeFireEmit.fn = (x, groundY, z, scale = 1) => {
    const s = Math.max(0.65, scale);
    const count = Math.max(1, Math.round(6 * Math.min(1, fxEmitChance)));
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.35 + Math.random() * 1.35) * s;
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      const px = x + ox;
      const pz = z + oz;
      // Keep births near the roots / lower trunk.
      const py = groundY + 0.15 + Math.random() * 0.9 * s;
      const roll = Math.random();
      const color =
        roll > 0.62
          ? [1, 0.88, 0.35, 0.36]
          : roll > 0.28
            ? [1, 0.48, 0.08, 0.4]
            : [0.95, 0.18, 0.02, 0.32];
      const w = (0.28 + Math.random() * 0.38) * s;
      const h = (0.65 + Math.random() * 0.85) * s;
      // Inward toward trunk + mostly up. Outer sparks die sooner.
      const pull = 0.55 + Math.random() * 0.45;
      const life = 1.1 + Math.random() * 0.7 + (1.1 - Math.min(1, rad / (1.7 * s))) * 0.8;
      particles.emit({
        ...puffSprite(),
        position: [px, py, pz],
        velocity: [
          -ox * pull,
          2.4 + Math.random() * 2.6 * s,
          -oz * pull,
        ],
        gravity: [0, 1.5, 0],
        color,
        lifetime: life,
        startSize: [w, h],
        endSize: [w * 0.15, h * 0.35],
        drag: 0.95,
      });
    }
    for (let i = 0; i < 2; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = (0.2 + Math.random() * 0.7) * s;
      const ox = Math.cos(ang) * rad;
      const oz = Math.sin(ang) * rad;
      particles.emit({
        position: [x + ox, groundY + 0.2 + Math.random() * 0.5 * s, z + oz],
        velocity: [
          -ox * 0.7,
          2.8 + Math.random() * 2.2,
          -oz * 0.7,
        ],
        gravity: [0, 1.2, 0],
        color: [1, 0.7, 0.2, 0.5],
        lifetime: 1.6 + Math.random() * 0.8,
        startSize: 0.16 * s,
        endSize: 0.03,
        drag: 0.45,
      });
    }
  };
  // Overlay selected-then-nearest + building slack. Matching entity count
  // allocated capacity × 13 alpha-sorted billboards (50k stress → ~650k sprites).
  const healthBars = createHealthBars(engine, scene, {
    capacity: HEALTH_BAR_CAPACITY,
    getViewportHeight: () => canvasCoords(0, 0).height,
  });
  const trailGenerations = new Uint32Array(MAX_PROJECTILES);
  const trailLastEmitMs = new Float64Array(MAX_PROJECTILES);
  /** Generation last splashed — avoids double FX if a dead slot lingers. */
  const fireballSplashSeen = new Uint32Array(MAX_PROJECTILES);
  const holySlashSeen = new Uint32Array(MAX_PROJECTILES);
  let particleClockMs = 0;

  function emitFireballGroundSplashes(prev, cur) {
    if (!cur) return;
    const n = cur.highWater ?? 0;
    for (let i = 0; i < n; i++) {
      if (cur.alive[i]) continue;
      if (cur.type[i] !== PROJECTILE.FIREBALL) continue;
      const reason = cur.despawnReason?.[i] ?? PROJECTILE_DESPAWN.NONE;
      if (
        reason !== PROJECTILE_DESPAWN.HIT &&
        reason !== PROJECTILE_DESPAWN.MISS &&
        reason !== PROJECTILE_DESPAWN.TERRAIN
      ) {
        continue;
      }
      const gen = cur.generation[i];
      if (!gen || fireballSplashSeen[i] === gen) continue;
      const wasAlive =
        prev && i < prev.highWater && prev.alive[i] && prev.generation[i] === gen;
      if (!wasAlive) continue;
      fireballSplashSeen[i] = gen;
      const x = cur.x[i];
      const z = cur.z[i];
      const y = groundYAt(x, z) + 0.25;
      // Ground splash: wide burst of wisps + sparks.
      for (let n = 0; n < 36; n++) {
        const ang = (n / 36) * Math.PI * 2 + Math.random() * 0.35;
        const speed = 6 + Math.random() * 8;
        const roll = Math.random();
        particles.emit({
          ...puffSprite(),
          position: [x, y + Math.random() * 0.55, z],
          velocity: [
            Math.cos(ang) * speed,
            4 + Math.random() * 8,
            Math.sin(ang) * speed,
          ],
          gravity: [0, -16, 0],
          color:
            roll > 0.5
              ? [1, 0.8, 0.3, 0.5]
              : [1, 0.4, 0.06, 0.55],
          lifetime: 0.5 + Math.random() * 0.45,
          startSize: [
            1.3 + Math.random() * 1.6,
            2.2 + Math.random() * 2.4,
          ],
          endSize: [0.25, 0.55],
          drag: 1.15,
        });
      }
      for (let n = 0; n < 20; n++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = 3.5 + Math.random() * 7;
        particles.emit({
          position: [x, y, z],
          velocity: [
            Math.cos(ang) * speed,
            6 + Math.random() * 9,
            Math.sin(ang) * speed,
          ],
          gravity: [0, -10, 0],
          color: [1, 0.65, 0.15, 0.7],
          lifetime: 0.55 + Math.random() * 0.55,
          startSize: 0.55,
          endSize: 0.06,
          drag: 0.45,
        });
      }
      // Soft bloom at the impact point.
      particles.emit({
        ...puffSprite(0.4),
        position: [x, y + 0.4, z],
        velocity: [0, 3.5, 0],
        gravity: [0, 1.2, 0],
        color: [1, 0.55, 0.1, 0.4],
        lifetime: 0.45,
        startSize: 7.5,
        endSize: 2.2,
        drag: 1.0,
      });
    }
  }

  /** Bright Smite-style slash across the foe on holy-slash hit. */
  function emitHolySlashImpacts(prev, cur) {
    if (!cur) return;
    const n = cur.highWater ?? 0;
    for (let i = 0; i < n; i++) {
      if (cur.alive[i]) continue;
      if (cur.type[i] !== PROJECTILE.HOLY_SLASH) continue;
      if ((cur.despawnReason?.[i] ?? PROJECTILE_DESPAWN.NONE) !== PROJECTILE_DESPAWN.HIT) {
        continue;
      }
      const gen = cur.generation[i];
      if (!gen || holySlashSeen[i] === gen) continue;
      const wasAlive =
        prev && i < prev.highWater && prev.alive[i] && prev.generation[i] === gen;
      if (!wasAlive) continue;
      holySlashSeen[i] = gen;
      const x = cur.x[i];
      const z = cur.z[i];
      const y = groundYAt(x, z) + 2.2;
      const vx = cur.vx?.[i] ?? 0;
      const vz = cur.vz?.[i] ?? 1;
      const len = Math.hypot(vx, vz) || 1;
      const fx = vx / len;
      const fz = vz / len;
      const rx = -fz;
      const rz = fx;
      // Core slash beam.
      for (let s = 0; s < 14; s++) {
        const t = (s / 13) * 2 - 1;
        particles.emit({
          position: [
            x + rx * t * 4.5,
            y + (Math.random() - 0.5) * 0.6,
            z + rz * t * 4.5,
          ],
          velocity: [fx * 2, 1.5 + Math.random(), fz * 2],
          gravity: [0, 0.5, 0],
          color: [1, 0.98, 0.85, 0.95],
          lifetime: 0.18 + Math.random() * 0.12,
          startSize: [2.8, 0.55],
          endSize: [0.2, 0.05],
          drag: 0.4,
        });
      }
      particles.emit({
        position: [x, y, z],
        velocity: [0, 6, 0],
        gravity: [0, -2, 0],
        color: [1, 1, 0.92, 0.85],
        lifetime: 0.22,
        startSize: 8,
        endSize: 1.2,
        drag: 0.3,
      });
      for (let s = 0; s < 10; s++) {
        const t = (Math.random() * 2 - 1);
        particles.emit({
          position: [x + rx * t * 3.2, y + Math.random() * 1.2, z + rz * t * 3.2],
          velocity: [
            (Math.random() - 0.5) * 3,
            4 + Math.random() * 5,
            (Math.random() - 0.5) * 3,
          ],
          gravity: [0, -8, 0],
          color: [1, 0.95, 0.7, 0.7],
          lifetime: 0.35 + Math.random() * 0.25,
          startSize: 0.45,
          endSize: 0.05,
          drag: 0.6,
        });
      }
    }
  }

  /** Impact splash — white-hot punch from the rectangle-beam era. */
  function emitLightningImpact(worldX, gy, worldZ, kind = LIGHTNING_HIT.GROUND) {
    // Nuclear contact flash.
    particles.emit({
      position: [worldX, gy + 1.2, worldZ],
      velocity: [0, 22, 0],
      gravity: [0, -12, 0],
      color: [1, 1, 1, 1],
      lifetime: 0.18,
      startSize: 28,
      endSize: 4,
      drag: 0.3,
    });
    particles.emit({
      position: [worldX, gy + 2.5, worldZ],
      velocity: [0, 8, 0],
      gravity: [0, -4, 0],
      color: [0.85, 0.92, 1, 0.9],
      lifetime: 0.32,
      startSize: 18,
      endSize: 6,
      drag: 0.4,
    });
    // Dual expanding shock rings.
    particles.emit({
      position: [worldX, gy + 0.4, worldZ],
      velocity: [0, 1.2, 0],
      gravity: [0, 0, 0],
      color: [0.35, 0.55, 1, 0.75],
      lifetime: 0.45,
      startSize: 5,
      endSize: 32,
      drag: 0.04,
    });
    particles.emit({
      position: [worldX, gy + 0.6, worldZ],
      velocity: [0, 2, 0],
      gravity: [0, 0, 0],
      color: [0.95, 0.98, 1, 0.6],
      lifetime: 0.28,
      startSize: 8,
      endSize: 20,
      drag: 0.06,
    });
    // Short contact plasma only — a tall vertical ion column looked like
    // glow beads ignoring the bolt path.
    for (let i = 0; i < 6; i++) {
      particles.emit({
        position: [
          worldX + (Math.random() - 0.5) * 1.5,
          gy + 1.2 + i * 1.8,
          worldZ + (Math.random() - 0.5) * 1.5,
        ],
        velocity: [
          (Math.random() - 0.5) * 2,
          2 + Math.random() * 4,
          (Math.random() - 0.5) * 2,
        ],
        gravity: [0, 0, 0],
        color: [0.55 + Math.random() * 0.25, 0.75, 1, 0.5 - i * 0.05],
        lifetime: 0.28 + Math.random() * 0.2,
        startSize: [1.6, 3.2],
        endSize: [0.3, 0.6],
        drag: 0.35,
      });
    }
    // Violent radial sparks.
    for (let n = 0; n < 55; n++) {
      const ang = (n / 55) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 16 + Math.random() * 28;
      particles.emit({
        position: [worldX, gy + 0.6 + Math.random() * 3, worldZ],
        velocity: [
          Math.cos(ang) * speed,
          14 + Math.random() * 28,
          Math.sin(ang) * speed,
        ],
        gravity: [0, -48, 0],
        color:
          Math.random() > 0.3
            ? [1, 1, 1, 0.95]
            : [0.35, 0.55, 1, 0.8],
        lifetime: 0.4 + Math.random() * 0.55,
        startSize: 0.7 + Math.random() * 1.2,
        endSize: 0.04,
        drag: 1.35,
      });
    }
    // Slow drifting plasma wisps.
    for (let n = 0; n < 12; n++) {
      const ang = Math.random() * Math.PI * 2;
      particles.emit({
        position: [worldX, gy + 1 + Math.random() * 8, worldZ],
        velocity: [
          Math.cos(ang) * (2 + Math.random() * 4),
          1 + Math.random() * 3,
          Math.sin(ang) * (2 + Math.random() * 4),
        ],
        gravity: [0, 1.5, 0],
        color: [0.25, 0.45, 1, 0.4],
        lifetime: 0.7 + Math.random() * 0.5,
        startSize: [3, 5],
        endSize: [6, 9],
        drag: 0.6,
      });
    }
    if (kind === LIGHTNING_HIT.TREE) {
      for (let n = 0; n < 22; n++) {
        const ang = Math.random() * Math.PI * 2;
        particles.emit({
          position: [worldX, gy + 2, worldZ],
          velocity: [
            Math.cos(ang) * (3 + Math.random() * 6),
            6 + Math.random() * 12,
            Math.sin(ang) * (3 + Math.random() * 6),
          ],
          gravity: [0, -10, 0],
          color: [1, 0.45, 0.08, 0.8],
          lifetime: 0.8 + Math.random() * 0.6,
          startSize: 1.5,
          endSize: 0.12,
          drag: 0.8,
        });
      }
    }
    if (kind === LIGHTNING_HIT.UNIT) {
      particles.emit({
        position: [worldX, gy + 3.5, worldZ],
        velocity: [0, 10, 0],
        gravity: [0, -3, 0],
        color: [0.95, 0.98, 1, 0.95],
        lifetime: 0.35,
        startSize: 16,
        endSize: 4,
        drag: 0.45,
      });
      for (let n = 0; n < 18; n++) {
        const ang = Math.random() * Math.PI * 2;
        particles.emit({
          position: [worldX, gy + 2.5, worldZ],
          velocity: [
            Math.cos(ang) * (8 + Math.random() * 12),
            4 + Math.random() * 10,
            Math.sin(ang) * (8 + Math.random() * 12),
          ],
          gravity: [0, -20, 0],
          color: [1, 1, 1, 0.85],
          lifetime: 0.35 + Math.random() * 0.3,
          startSize: 0.8 + Math.random() * 0.6,
          endSize: 0.05,
          drag: 1.1,
        });
      }
    }
  }

  let lightningFlash = 0;

  const lightningBolts = createLightningBolts(engine, scene, groundYAt, {
    emitImpact: emitLightningImpact,
    emitGlow(init) {
      // Additive soft beads — blue halo without a covering tube shell.
      particles.emit(init);
    },
    onFlash(amount) {
      lightningFlash = Math.max(lightningFlash, amount);
    },
    getSkyOrigin(impactX, impactY, impactZ, seed) {
      const eye = cameraEyePos();
      const radius = Math.max(40, camera.radius ?? 200);
      // Always start above the camera so the bolt enters from off-screen.
      const aboveCam = eye.y + radius * 0.45 + 60;
      const aboveImpact = impactY + Math.max(90, radius * 0.2);
      const skyY = Math.max(aboveCam, aboveImpact);
      const boltLen = Math.max(90, skyY - impactY);
      // Big lateral entry — scales with bolt height so zoomed-out strikes lean hard.
      const lateral = Math.max(55, boltLen * 0.38, radius * 0.12);
      const ang = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
      return {
        x: impactX + Math.cos(ang) * lateral,
        y: skyY,
        z: impactZ + Math.sin(ang) * lateral,
      };
    },
  });

  const arrowTrails = createArrowTrails(engine, scene);

  const frogLandBurst = (x, z) => {
    const gy = groundYAt(x, z);
    particles.emitBurst({
      position: [x, gy + 0.2, z],
      color: [0.45, 0.95, 0.4, 0.55],
      count: 4,
      speed: 4,
      verticalSpeed: 3.5,
      gravity: [0, -18, 0],
      drag: 1.6,
      lifetime: 0.28,
      startSize: 0.7,
      endSize: 0.06,
    });
  };

  /** @type {any[]} */
  let pendingFrogUpdates = [];
  /** @type {any} */
  let frogRenderer = {
    advance() {},
    sync() {},
    commit() {},
    applyUpdates(list) {
      if (list?.length) pendingFrogUpdates.push(...list);
    },
    clear() {
      pendingFrogUpdates.length = 0;
    },
    stats: () => null,
  };
  /** Queued placements until Phase B props are ready. */
  let pendingAgoras = null;
  let pendingBuildings = null;
  let pendingRallyFlags = null;
  /** @type {any} */
  let agoraProps = {
    place(list) { pendingAgoras = list ?? []; },
    placeRallyFlags(list) { pendingRallyFlags = list ?? []; },
    setRallyGhost() {},
    update() {},
    isPickMesh() { return false; },
    resolvePick() { return null; },
    clear() {},
  };
  /** @type {any} */
  let buildingProps = {
    place(list) { pendingBuildings = list ?? []; },
    setSelectionHighlight() {},
    setGhost() {},
    isPickMesh() { return false; },
    resolvePick() { return null; },
    forEachFxInstance() {},
    clear() {},
    updateSelectionHighlight() {},
    update() {},
  };
  const radialStub = {
    showAt() {},
    update() {},
    hide() {},
    isOpen() { return false; },
    setCompact() {},
    setCategory() {},
    unlockCategory() {},
    setHover() {},
    setHoverByType() {},
    setHoverFromPick() {},
    clearHover() {},
    pickOptionAtRay() { return null; },
    hitAtRay() { return false; },
    hitHubHoleAtRay() { return false; },
    registerLabels() {},
    disposeLabels() {},
    setUtilityAvailability() {},
    setPaused() {},
    setResearchedUpgrades() {},
    setTrackDisplay() {},
    setArmed() {},
    clearTracks() {},
    getTracks() { return {}; },
    getArmed() { return null; },
    categoryLocked: false,
  };
  /** @type {any} */
  let buildingRadial = radialStub;
  /** @type {any} */
  let actionRadial = { ...radialStub };
  /** @type {any} Bottom-of-screen selection strip (camera-locked HUD). */
  let selectionHud = {
    setGroups() {},
    update() {},
    pickSlot() { return null; },
    clear() {},
    registerLabels() {},
    disposeLabels() {},
  };

  /** Canvas-local pointer for HUD hover (CSS px). */
  let hudPointer = null;
  const radialScreen = {
    worldToScreen(x, y, z) {
      const { width, height } = canvasCoords(0, 0);
      const c = matVec4(viewProjection(), x, y, z, 1);
      if (Math.abs(c[3]) < 1e-8) return null;
      let cx = c[0];
      let cy = c[1];
      let cw = c[3];
      if (cw < 0) {
        cx = -cx;
        cy = -cy;
        cw = -cw;
      }
      const iw = 1 / cw;
      return {
        x: (cx * iw * 0.5 + 0.5) * width,
        y: (1 - cy * iw) * 0.5 * height,
      };
    },
    rayFromCanvas(canvasX, canvasY) {
      const { width, height } = canvasCoords(0, 0);
      return pickingRay(canvasX, canvasY, viewProjection(), width, height);
    },
    getViewport() {
      const { width, height } = canvasCoords(0, 0);
      return {
        width,
        height,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
      };
    },
    font: null,
    canvas,
    getPointerCanvas() {
      return hudPointer;
    },
  };
  canvas.addEventListener('pointermove', (e) => {
    const cc = canvasCoords(e.clientX, e.clientY);
    hudPointer = { x: cc.x, y: cc.y };
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => {
    hudPointer = null;
  }, { passive: true });

  /** @type {any} Side control-group pads (camera-locked). */
  let controlGroupHud = {
    update() {},
    pick() { return null; },
    setExtra() {},
    setFilled() {},
    setHold() {},
    clear() {},
  };
  try {
    controlGroupHud = createControlGroupHud(engine, scene, radialScreen);
  } catch (err) {
    console.warn('[controlGroupHud] init failed', err);
  }

  onSceneDispose(scene, () => {
    buildingRadial.disposeLabels?.();
    actionRadial.disposeLabels?.();
    selectionHud.disposeLabels?.();
    controlGroupHud.clear?.();
  });

  function radialPickingRay(clientX, clientY) {
    const cc = canvasCoords(clientX, clientY);
    return pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
  }
  const visionDraw = { fn: null };
  /** @type {{ attachOverlay?: Function, detachOverlay?: Function, syncOverlay?: Function } | null} */
  let fogApi = null;
  const projectileRenderer = createProjectileRenderer(
    engine,
    scene,
    groundYAt,
    (slot, generation, x, y, z, vx, vz, def, vy = 0, age = 0) => {
      const isFireball = def.id === PROJECTILE.FIREBALL;
      const isArrow = def.mesh === PROJECTILE_MESH.ARROW;
      const isShadow = def.id === PROJECTILE.SHADOW_BOLT;
      const isLocust = def.id === PROJECTILE.LOCUST_SWARM;
      if (isLocust) {
        locustFx.track(slot, generation, x, y, z, vx, vz);
        return;
      }
      if (isFireball) {
        fireballFx.track(slot, generation, x, y, z, vx, vy, vz, age === 0);
        return;
      }
      if (def.id === PROJECTILE.SPORE_STREAM) return;
      const emitGapMs = isShadow ? 20 : isArrow ? 22 : 32;
      if (
        trailGenerations[slot] === generation &&
        particleClockMs - trailLastEmitMs[slot] < emitGapMs
      ) {
        return;
      }
      trailGenerations[slot] = generation;
      trailLastEmitMs[slot] = particleClockMs;
      if (isArrow) {
        // World-oriented dashes (not camera billboards) so they follow travel.
        arrowTrails.emit(x, y, z, vx, vy, vz);
        // Ice bolts also leave a soft frost wisp.
        if (def.id === PROJECTILE.ICE_BOLT) {
          particles.emit({
            position: [x, y, z],
            velocity: [-vx * 0.08, 0.4, -vz * 0.08],
            gravity: [0, -0.2, 0],
            color: [0.65, 0.9, 1, 0.45],
            lifetime: 0.28,
            startSize: 0.9,
            endSize: 0.1,
            drag: 1.2,
          });
        }
        return;
      }
      const speed = Math.hypot(vx, vz);
      const offset = speed > 1e-6 ? 0.55 / speed : 0;
      const px = x - vx * offset;
      const pz = z - vz * offset;
      if (isShadow) {
        // Purple inky star beads trailing the round black bolt.
        for (let n = 0; n < 2; n++) {
          const hang = 0.12 + Math.random() * 0.18;
          particles.emit({
            blend: 'alpha',
            shape: 'star',
            fadeOut: false,
            hangTime: hang,
            position: [
              px + (Math.random() - 0.5) * 0.5,
              y + (Math.random() - 0.5) * 0.4,
              pz + (Math.random() - 0.5) * 0.5,
            ],
            velocity: [0, -0.1 - Math.random() * 0.2, 0],
            gravity: [0, -14 - Math.random() * 8, 0],
            color:
              Math.random() > 0.35
                ? [0.55, 0.15, 0.85, 1]
                : [0.12, 0.02, 0.18, 1],
            lifetime: hang + 0.55,
            startSize: 0.22 + Math.random() * 0.14,
            peakSize: 0.45 + Math.random() * 0.25,
            endSize: 0.12,
            drag: 0.1,
          });
        }
        return;
      }
    },
    {
      shouldDraw(x, z, owner) {
        return visionDraw.fn ? visionDraw.fn(x, z, owner) : true;
      },
    },
  );

  function isRenderableMesh(node) {
    return !!(node && '_gpu' in node && 'material' in node && node.material);
  }

  function forEachMesh(root, fn) {
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (isRenderableMesh(node)) fn(node);
      const kids = node.children;
      if (kids?.length) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }

  /**
   * Late-loaded PBR meshes must not enter CSM until Lite finishes their color-pass
   * materialize. Immediate setShadowTaskCasterMeshes → task.addMesh throws in
   * resolvePendingMeshes (ext topo / missing rebuild) on hard refresh.
   * @type {WeakSet<object>}
   */
  const shadowCasterDefer = new WeakSet();

  function isBackdropMesh(mesh) {
    return (mesh?.name || '') === 'distant-mountains';
  }

  function deferShadowCaster(mesh) {
    if (!mesh) return;
    shadowCasterDefer.add(mesh);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        shadowCasterDefer.delete(mesh);
        try {
          applyShadowState();
        } catch (err) {
          console.warn('[boot] shadow update after defer failed', err);
        }
      });
    });
  }

  /** First-seen mesh → defer into CSM (safe during progressive boot). */
  function noteShadowMesh(mesh) {
    if (!mesh || shadowCasterNoted.has(mesh)) return;
    shadowCasterNoted.add(mesh);
    if (!shadowNotesReady) {
      pendingShadowNotes.push(mesh);
      return;
    }
    deferShadowCaster(mesh);
  }

  function flushPendingShadowNotes() {
    shadowNotesReady = true;
    for (let i = 0; i < pendingShadowNotes.length; i++) {
      deferShadowCaster(pendingShadowNotes[i]);
    }
    pendingShadowNotes.length = 0;
  }

  function noteBatchMeshesForShadow(batch) {
    for (const mesh of vatPartMeshes(batch)) noteShadowMesh(mesh);
  }

  function collectShadowCasters() {
    /** @type {object[]} */
    const casters = [];
    const pushMesh = (mesh, { ignoreVisible = false } = {}) => {
      if (!isRenderableMesh(mesh)) return;
      if (shadowCasterDefer.has(mesh)) return;
      // Units-off A/B hides meshes for the color pass but should still cast —
      // otherwise U looks like a huge win that is really just shadows.
      if (!ignoreVisible && mesh.visible === false) return;
      const ti = mesh.thinInstances;
      if (ti && !(ti.count > 0)) return;
      casters.push(mesh);
    };
    for (const batch of typeBatches.values()) {
      // KOTH keeps empty owner batches at full ti.count with zero matrices — skip those.
      if (!(batch.mappedSize > 0)) continue;
      for (const mesh of vatPartMeshes(batch)) {
        pushMesh(mesh, { ignoreVisible: !unitsEnabled });
      }
    }
    if (fallback?.mappedSize > 0) {
      pushMesh(fallback.mesh, { ignoreVisible: !unitsEnabled });
    }
    if (terrain?.meshes) {
      for (const root of terrain.meshes) {
        // GLB/bake scenery only — billboard impostors are flat cards and cast junk.
        const name = root.name || '';
        if (typeof name === 'string' && name.startsWith('scenery-model-')) {
          forEachMesh(root, pushMesh);
        }
      }
    }
    buildingProps.forEachShadowMesh?.(pushMesh);
    agoraProps.forEachShadowMesh?.(pushMesh);
    return casters;
  }

  function markShadowReceivers(on) {
    const recv = !!on;
    if (ground) ground.receiveShadows = recv;
    if (terrain?.meshes) {
      for (const root of terrain.meshes) {
        forEachMesh(root, (m) => {
          m.receiveShadows = recv && !isBackdropMesh(m);
        });
      }
    }
    for (const batch of typeBatches.values()) {
      for (const mesh of vatPartMeshes(batch)) mesh.receiveShadows = recv;
    }
    if (fallback?.mesh) fallback.mesh.receiveShadows = recv;
    buildingProps.forEachShadowMesh?.((mesh) => {
      mesh.receiveShadows = recv;
    });
    agoraProps.forEachShadowMesh?.((mesh) => {
      mesh.receiveShadows = recv;
    });
  }

  function sameCasterList(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function applyShadowState() {
    // Never detach the generator or pass an empty caster list — both broke Lite
    // CSM (billboard pipeline crash, or near-cascade dead / far still lit).
    // Off = dummy caster only (cheap map fill) + receivers cleared (fully lit).
    if (!shadowsEnabled) {
      if (!sameCasterList(shadowCasterList, SHADOW_CASTERS_OFF)) {
        shadowCasterList = SHADOW_CASTERS_OFF;
        setShadowTaskCasterMeshes(shadowGen, shadowCasterList);
      }
      markShadowReceivers(false);
      return;
    }
    markShadowReceivers(true);
    const next = collectShadowCasters();
    if (!sameCasterList(shadowCasterList, next)) {
      shadowCasterList = next;
      try {
        setShadowTaskCasterMeshes(shadowGen, shadowCasterList);
      } catch (err) {
        // Progressive boot: caster list included a mesh Lite can't shadow yet.
        console.warn('[boot] setShadowTaskCasterMeshes failed; keeping prior casters', err);
        shadowCasterList = SHADOW_CASTERS_OFF;
        try {
          setShadowTaskCasterMeshes(shadowGen, shadowCasterList);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Receivers must be flagged before register so Lite builds shadow sampling in.
  flushPendingShadowNotes();
  markShadowReceivers(true);
  applyShadowState();

  let frameCb = null;
  /** @type {Map<number, { x: number, z: number, radius: number, generation: number, endsAtMs: number }>} */
  const groundFires = new Map();
  // Continuous FX intervals come from fxQuality (settings slider); see applyFxQuality.
  /** Match sim FIRE_ZONE_TTL (100 ticks @ 20Hz). */
  const FIRE_ZONE_VISUAL_MS = 5000;

  function applyUnitMeshVisibility() {
    for (const batch of typeBatches.values()) {
      for (const mesh of vatPartMeshes(batch)) {
        const count = mesh.thinInstances?.count ?? 0;
        mesh.visible = unitsEnabled && count > 0;
      }
    }
    if (fallback?.mesh) {
      const count = fallback.mesh.thinInstances?.count ?? 0;
      fallback.mesh.visible = unitsEnabled && count > 0;
    }
    for (const mesh of selRingParts) {
      const count = mesh.thinInstances?.count ?? 0;
      mesh.visible = unitsEnabled && !screenshotHudHidden && count > 0;
    }
    carryLoads.setVisible(unitsEnabled);
  }

  onBeforeRender(scene, (deltaMs) => {
    // Celestial spin demo (no-op unless toggled). Uses wall-clock delta so the
    // sun keeps sweeping even when the sim is paused.
    celestial.update(deltaMs);
    terrain?.update?.(camera, deltaMs);
    // Freeze FX aging while sim is paused so bolts/trails don't burn out.
    const fxDt = fxPaused ? 0 : deltaMs;
    buildingProps.update?.(fxDt);
    particleClockMs += Math.min(100, Math.max(0, fxDt));
    if (fxEnabled) {
      // Quality slider scales all socket cadences (default unitFxIntervalMs=80 → 1×).
      const cadenceScale = Math.max(0.5, (unitFxIntervalMs || 80) / 80);
      socketFireElapsed += fxDt;
      socketSmokeElapsed += fxDt;
      socketSparkleElapsed += fxDt;
      if (socketFireElapsed >= SOCKET_FX_CADENCE.fire * cadenceScale) {
        socketFireElapsed = 0;
        emitUnitSocketFire('fire');
        emitBuildingSocketFx('fire');
      }
      if (socketSmokeElapsed >= SOCKET_FX_CADENCE.smoke * cadenceScale) {
        socketSmokeElapsed = 0;
        emitUnitSocketFire('smoke');
        emitBuildingSocketFx('smoke');
      }
      if (socketSparkleElapsed >= SOCKET_FX_CADENCE.sparkle * cadenceScale) {
        socketSparkleElapsed = 0;
        emitUnitSocketFire('sparkle');
        emitBuildingSocketFx('sparkle');
      }
      groundFireElapsed += fxDt;
      if (groundFireElapsed >= groundFireIntervalMs) {
        groundFireElapsed = 0;
        emitGroundFirePatches();
      }
      particles.update(fxDt);
      unitAuras.update(fxDt);
    }
    agoraProps.update?.(camera);
    monkLobFx.update(fxDt);
    sporeBloomFx.update(fxDt, fxSimTick);
    locustFx.update(fxDt);
    mushrooms?.commit?.();
    frogRenderer.advance(fxDt);
    arrowTrails.update(fxDt);
    arrowTrails.commit();
    lightningBolts.update(fxDt);
    lightningBolts.commit();
    if (lightningFlash > 0.001) {
      sky.intensity = skyBaseIntensity + lightningFlash * 1.8;
      lightningFlash *= Math.exp(-fxDt * 0.012);
    } else if (lightningFlash !== 0) {
      lightningFlash = 0;
      sky.intensity = skyBaseIntensity;
    }
    if (vatEnabled && !fxPaused) {
      const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
      for (const batch of typeBatches.values()) {
        if (batch.vatParts?.length) {
          for (const part of batch.vatParts) part.handle.update(dt);
        } else {
          batch.vatHandle?.update?.(dt);
        }
      }
    }
    if (frameCb) frameCb(deltaMs);
    // After sync so helix puffs spawn on this frame's orb, not last frame's.
    fireballFx.update(fxDt);
  });

  function emitGroundFirePatches() {
    for (const [slot, fire] of groundFires) {
      const remain = fire.endsAtMs - particleClockMs;
      if (remain <= 0) {
        groundFires.delete(slot);
        continue;
      }
      if (!allowContinuousFx()) continue;
      const gy = groundYAt(fire.x, fire.z);
      const r = Math.max(1.2, fire.radius * 0.85);
      const fade = Math.max(0.3, Math.min(1, remain / (FIRE_ZONE_VISUAL_MS * 0.85)));
      const count = 3 + Math.floor(fade * 3);
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * r;
        const ox = Math.cos(ang) * rad;
        const oz = Math.sin(ang) * rad;
        const roll = Math.random();
        particles.emit({
          ...puffSprite(),
          position: [fire.x + ox, gy + 0.1 + Math.random() * 0.35, fire.z + oz],
          velocity: [
            (Math.random() - 0.5) * 0.6,
            1.4 + Math.random() * 2.2,
            (Math.random() - 0.5) * 0.6,
          ],
          gravity: [0, 1.1, 0],
          color:
            roll > 0.55
              ? [1, 0.75, 0.2, 0.45 * fade]
              : [1, 0.35, 0.05, 0.4 * fade],
          lifetime: 0.4 + Math.random() * 0.35,
          startSize: [0.45 + Math.random() * 0.55, 0.9 + Math.random() * 0.9],
          endSize: [0.08, 0.2],
          drag: 1.1,
        });
      }
    }
  }

  /**
   * Inherent FX size before empty scale. Blender empties are often ~0.3–0.5;
   * this keeps the effect readable at those sizes while empty scale still
   * relative-tunes them.
   */
  const SOCKET_FX_INHERENT = 3.0;

  /**
   * Map authored empty names → FX style + default size. The name is the only
   * thing that picks a style; nothing downstream rewrites it based on what the
   * socket is attached to. Add a style here rather than branching at the
   * emitter, and keep new names clear of the words already matched below.
   * Supported: smoke_anchor*, fire_anchor*, hex_anchor*, sparkle_anchor*
   * (spawn_* ignored).
   * Final size = inherent × styleBase × emptyScale × instanceScale.
   * @returns {{ style: string, base: number } | null}
   */
  function socketFxKind(name) {
    if (!name || /spawn/i.test(name)) return null;
    if (/smoke/i.test(name)) return { style: 'smoke', base: 1.15 };
    if (/sparkle/i.test(name)) return { style: 'sparkle', base: 1.0 };
    if (/hex/i.test(name)) return { style: 'hex', base: 0.8 };
    if (/fire/i.test(name)) return { style: 'torch', base: 1.0 };
    return null;
  }

  function instanceUniformScale(m, o) {
    const s =
      (Math.hypot(m[o], m[o + 1], m[o + 2]) +
        Math.hypot(m[o + 4], m[o + 5], m[o + 6]) +
        Math.hypot(m[o + 8], m[o + 9], m[o + 10])) /
      3;
    return Number.isFinite(s) && s > 1e-6 ? s : 1;
  }

  /**
   * Cadence groups, not styles: hex and torch both tick at the fire rate.
   * @param {'fire' | 'smoke' | 'sparkle'} group
   */
  function socketMatchesGroup(style, group) {
    if (group === 'smoke') return style === 'smoke';
    if (group === 'sparkle') return style === 'sparkle';
    return style === 'hex' || style === 'torch';
  }

  /** Constant FX at unit empties for one cadence group. */
  function emitUnitSocketFire(group) {
    if (!socketFireEnabled) return;
    // Always camera-gate continuous FX (scenery LOD_ENABLED is a separate switch).
    const eye = cameraEyePos();
    const distSq = fxDistanceSq;
    for (const batch of typeBatches.values()) {
      const sockets = batch.fxSockets;
      if (!sockets?.length) continue;
      const count = batch.mesh?.thinInstances?.count ?? 0;
      const m = batch.matrices;
      for (let slot = 0; slot < count; slot++) {
        const o = slot * 16;
        if (!(m[o + 15] > 0)) continue;
        if (eye && distSq > 0) {
          const dx = eye.x - m[o + 12];
          const dy = eye.y - m[o + 13];
          const dz = eye.z - m[o + 14];
          if (dx * dx + dy * dy + dz * dz > distSq) continue;
        }
        if (!allowContinuousFx()) continue;
        const instScale = instanceUniformScale(m, o);
        for (let s = 0; s < sockets.length; s++) {
          const sock = sockets[s];
          const kind = socketFxKind(sock.name);
          if (!kind || !socketMatchesGroup(kind.style, group)) continue;
          // Socket x/y/z is the empty origin (world translation from bake).
          const lx = sock.x;
          const ly = sock.y;
          const lz = sock.z;
          const wx = m[o + 12] + m[o] * lx + m[o + 8] * lz;
          const wy = m[o + 13] + m[o + 5] * ly;
          const wz = m[o + 14] + m[o + 2] * lx + m[o + 10] * lz;
          const sockScale = Number.isFinite(sock.scale) && sock.scale > 1e-6 ? sock.scale : 1;
          emitSocketFlame(
            wx, wy, wz,
            SOCKET_FX_INHERENT * kind.base * sockScale * instScale,
            kind.style,
          );
        }
      }
    }
  }

  /** Building empties for one cadence group (spawn_* ignored). */
  function emitBuildingSocketFx(group) {
    if (!socketFireEnabled) return;
    const eye = cameraEyePos();
    const distSq = fxDistanceSq;
    buildingProps.forEachFxInstance?.((_typeId, m, slot, sockets) => {
      const o = slot * 16;
      if (eye && distSq > 0) {
        const dx = eye.x - m[o + 12];
        const dy = eye.y - m[o + 13];
        const dz = eye.z - m[o + 14];
        if (dx * dx + dy * dy + dz * dz > distSq) return;
      }
      if (!allowContinuousFx()) return;
      const instScale = instanceUniformScale(m, o);
      for (let s = 0; s < sockets.length; s++) {
        const sock = sockets[s];
        const kind = socketFxKind(sock.name);
        if (!kind) continue;
        if (!socketMatchesGroup(kind.style, group)) continue;
        const lx = sock.x;
        const ly = sock.y;
        const lz = sock.z;
        const wx = m[o + 12] + m[o] * lx + m[o + 8] * lz;
        const wy = m[o + 13] + m[o + 5] * ly;
        const wz = m[o + 14] + m[o + 2] * lx + m[o + 10] * lz;
        const sockScale = Number.isFinite(sock.scale) && sock.scale > 1e-6 ? sock.scale : 1;
        emitSocketFlame(
          wx, wy, wz,
          SOCKET_FX_INHERENT * kind.base * sockScale * instScale,
          kind.style,
        );
      }
    });
  }

  /**
   * Layered socket FX (classic game-fire recipe):
   * hot core + rising flame tongues + ember sparks; smoke is separate soft puffs.
   * Density scales with fxEmitChance so low FX settings stay cheap.
   */
  function emitSocketFlame(x, y, z, scale, style) {
    const s = Math.max(0.12, scale);
    if (style === 'smoke') {
      emitSocketSmoke(x, y, z, s);
      return;
    }
    if (style === 'sparkle') {
      emitSocketSparkle(x, y, z, s);
      return;
    }
    emitSocketFire(x, y, z, s, style === 'hex');
  }

  /** Wisps per fire tick — density is what separates a body of flame from a streamer. */
  const FIRE_WISPS_PER_TICK = 5;
  /**
   * Wide discs pooled at the socket. Wisps are born inside this pool rather
   * than in empty air, which is what stops each one reading as a circle
   * popping into existence at the base. Roughly two of every three ticks
   * against a multi-second life: churn rate is what reads as boiling, not
   * population.
   */
  const FIRE_BASE_CHANCE = 0.7;
  /** Ember rolls per fire tick — see the loop for the per-roll chance. */
  const FIRE_EMBERS_PER_TICK = 2;

  /**
   * Spawn angle for the next wisp: two out-of-step sweeps rather than a steady
   * precession, so the spoke licks back and forth across ~±90° and never
   * completes a turn (a full rotation reads as a spinning streamer, not fire).
   * Clock-derived rather than a counter so sockets appearing or dying cannot
   * desync it; position seeds the phase to keep neighbours out of lockstep.
   */
  function fireSpokeAngle(x, z) {
    const t = particleClockMs / 1000;
    const phase = x * 0.7139 + z * 1.3157;
    return (
      phase +
      1.15 * Math.sin(t * 2.1 + phase) +
      0.45 * Math.sin(t * 3.7 + phase * 2.3)
    );
  }

  /** @param {boolean} hex Arcane white-blue with ink beads, vs orange hearth. */
  function emitSocketFire(x, y, z, s, hex) {
    const dens = Math.min(1, fxEmitChance);
    if (Math.random() < FIRE_BASE_CHANCE * dens) {
      const bSize = (0.32 + Math.random() * 0.22) * s;
      particles.emit({
        ...puffSprite(0.6),
        // Sunk by a fraction of the disc's own width, so only the top of the
        // pool shows and discs surface into the flame instead of appearing in
        // mid-air. Tied to bSize so resizing cannot bury or float the pool.
        position: [
          x + (Math.random() - 0.5) * 0.22 * s,
          y - bSize * (0.2 + Math.random() * 0.3),
          z + (Math.random() - 0.5) * 0.22 * s,
        ],
        velocity: [
          (Math.random() - 0.5) * 0.08 * s,
          (0.5 + Math.random() * 0.6) * s,
          (Math.random() - 0.5) * 0.08 * s,
        ],
        gravity: [0, 0.1, 0],
        color: hex ? [0.72, 0.9, 1, 0.33] : [1, 0.72, 0.24, 0.34],
        lifetime: 1.8 + Math.random() * 1.2,
        startSize: bSize,
        // Collapses to a tenth of its width, so the pool narrows to a point as
        // it climbs instead of carrying a slab of fire upward.
        endSize: bSize * (0.06 + Math.random() * 0.09),
        drag: 1.6,
      });
    }
    // Wisps land in a band around the sweeping spoke and curl as they climb,
    // so the column reads as arcs of fire built from plain round particles.
    const spoke = fireSpokeAngle(x, z);
    for (let i = 0; i < FIRE_WISPS_PER_TICK; i++) {
      if (Math.random() > dens) continue;
      const ang = spoke + (Math.random() - 0.5) * 0.85;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const rad = (0.04 + Math.random() * 0.12) * s;
      const swirl = (0.2 + Math.random() * 0.26) * s;
      const outward = (0.04 + Math.random() * 0.12) * s;
      const roll = Math.random();
      // Tuned against the soft sprite's squared falloff so ~60 overlapping
      // wisps leave the plume reading as colour while the base clips to white.
      const color = hex
        ? roll > 0.55
          ? [0.7, 0.92, 1, 0.22]
          : roll > 0.2
            ? [0.4, 0.7, 1, 0.19]
            : [1, 1, 1, 0.26]
        : roll > 0.55
          ? [1, 0.88, 0.3, 0.23]
          : roll > 0.22
            ? [1, 0.42, 0.05, 0.22]
            : [0.9, 0.14, 0.02, 0.18];
      // Wisps are deliberately small against the column they build: structure
      // is only visible while the flame stands several diameters tall.
      const size = (0.11 + Math.random() * 0.12) * s;
      particles.emit({
        ...puffSprite(),
        position: [x + cs * rad, y + Math.random() * 0.06 * s, z + sn * rad],
        // Mostly tangential with a little outward drift — drag bleeds the
        // swirl off early, leaving a curved kick rather than an orbit.
        velocity: [
          cs * outward - sn * swirl,
          (0.63 + Math.random() * 0.81) * s,
          sn * outward + cs * swirl,
        ],
        // Weak buoyancy against heavy drag: wisps coast up, then hang and fade
        // near the top instead of streaming off it.
        gravity: [0, hex ? 0.12 : 0.18, 0],
        color,
        // Lifetime × wisps-per-tick sets the live count (~100 per socket).
        lifetime: 1.2 + Math.random() * 0.9,
        startSize: size,
        endSize: size * (0.35 + Math.random() * 0.25),
        drag: 1.5,
      });
    }
    if (hex) emitStaffInkDrip(x, y, z, s, dens);
    // Embers — small, drift sideways more than up. Rolled per tick rather than
    // per wisp, so wisp density changes do not multiply the sparks. Two rolls
    // rather than a single higher chance: pairs read as a spit of sparks.
    for (let i = 0; i < FIRE_EMBERS_PER_TICK; i++) {
      if (Math.random() > 0.22 * dens) continue;
      const eAng = Math.random() * Math.PI * 2;
      const kick = (0.2 + Math.random() * 0.4) * s;
      particles.emit({
        position: [x, y + 0.04 * s, z],
        velocity: [
          Math.cos(eAng) * kick,
          (0.4 + Math.random() * 0.6) * s,
          Math.sin(eAng) * kick,
        ],
        gravity: [0, 0.1, 0],
        color: hex
          ? [0.75, 0.92, 1, 0.55]
          : [1, 0.7, 0.2, 0.55],
        lifetime: 0.7 + Math.random() * 0.5,
        startSize: (0.035 + Math.random() * 0.04) * s,
        endSize: 0.01 * s,
        drag: 0.5,
      });
    }
  }

  /**
   * Hex fire only: a bead of ink gathers under the flame, swells, then falls.
   * Alpha blend is required — additive black draws nothing. Solid (no fadeOut)
   * so the drop stays inky against the white flame right up to the ground,
   * where killY culls it. A shrunken cousin of the spore-bloom tree drips.
   */
  function emitStaffInkDrip(x, y, z, s, dens) {
    if (Math.random() > 0.12 * dens) return;
    const hang = 0.18 + Math.random() * 0.22;
    const peak = (0.11 + Math.random() * 0.06) * s;
    particles.emit({
      blend: 'alpha',
      hard: true,
      fadeOut: false,
      killY: groundYAt(x, z) - 0.2,
      // Sits below the socket so beads bud off the underside of the flame
      // rather than out of its bright core, where they read as holes.
      position: [
        x + (Math.random() - 0.5) * 0.18 * s,
        y - (0.18 + Math.random() * 0.08) * s,
        z + (Math.random() - 0.5) * 0.18 * s,
      ],
      velocity: [0, (-0.05 - Math.random() * 0.1) * s, 0],
      // Far gentler than the tree drips: this one only falls a metre or two,
      // and at their gravity it would be a single blurred frame.
      gravity: [0, -9 - Math.random() * 5, 0],
      color: [0, 0, 0, 1],
      hangTime: hang,
      lifetime: hang + 1.6,
      startSize: (0.05 + Math.random() * 0.04) * s,
      peakSize: peak,
      endSize: peak,
      drag: 0.05,
    });
  }

  /** Puff rolls per chimney tick; later rolls are coin flips, see the loop. */
  const SMOKE_PUFFS_PER_TICK = 3;
  /** Stars per sparkle tick — short-lived, so the live count tracks this closely. */
  const SPARKLE_PER_TICK = 4;

  function emitSocketSmoke(x, y, z, s) {
    const dens = Math.min(1, fxEmitChance);
    // Slow chimney rhythm: a puff every ~240ms tick, often doubled or
    // tripled. Thickness comes from puffs overlapping each other, not from
    // raising their alpha, which would only darken the column rather than
    // fill it out.
    for (let i = 0; i < SMOKE_PUFFS_PER_TICK; i++) {
      if (Math.random() > (i === 0 ? 1 : i === 1 ? 0.75 : 0.5) * dens) continue;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.1 * s;
      const drift = 0.08 + Math.random() * 0.2;
      const start = (0.28 + Math.random() * 0.22) * s;
      const end = (1.0 + Math.random() * 0.8) * s;
      particles.emit({
        ...puffSprite(0.9),
        blend: 'alpha',
        fadeOut: true,
        position: [
          x + Math.cos(ang) * rad,
          y + Math.random() * 0.05 * s,
          z + Math.sin(ang) * rad,
        ],
        velocity: [
          Math.cos(ang) * drift,
          (0.4 + Math.random() * 0.55) * s,
          Math.sin(ang) * drift,
        ],
        gravity: [0, 0.18, 0],
        color:
          Math.random() > 0.5
            ? [0.42, 0.42, 0.45, 0.34]
            : [0.28, 0.28, 0.3, 0.28],
        lifetime: 2.2 + Math.random() * 1.4,
        startSize: start,
        endSize: end,
        drag: 0.35,
      });
    }
    if (Math.random() < 0.2 * dens) {
      particles.emit({
        ...puffSprite(0.9),
        blend: 'alpha',
        fadeOut: true,
        position: [x, y + 0.04 * s, z],
        velocity: [
          (Math.random() - 0.5) * 0.15,
          (0.25 + Math.random() * 0.3) * s,
          (Math.random() - 0.5) * 0.15,
        ],
        gravity: [0, 0.12, 0],
        color: [0.18, 0.18, 0.2, 0.4],
        lifetime: 1.2 + Math.random() * 0.6,
        startSize: 0.2 * s,
        endSize: 0.6 * s,
        drag: 0.5,
      });
    }
  }

  function emitSocketSparkle(x, y, z, s) {
    const dens = Math.min(1, fxEmitChance);
    // A handful of stars per ~210ms tick, each free to skip its beat so the
    // cloud keeps twinkling irregularly instead of pulsing with the cadence.
    for (let i = 0; i < SPARKLE_PER_TICK; i++) {
      if (Math.random() > 0.85 * dens) continue;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.18 * s;
      const roll = Math.random();
      particles.emit({
        blend: 'alpha',
        shape: 'star',
        fadeOut: true,
        position: [
          x + Math.cos(ang) * rad,
          y + Math.random() * 0.1 * s,
          z + Math.sin(ang) * rad,
        ],
        velocity: [
          (Math.random() - 0.5) * 0.4 * s,
          (0.3 + Math.random() * 0.6) * s,
          (Math.random() - 0.5) * 0.4 * s,
        ],
        gravity: [0, 0.06, 0],
        color:
          roll > 0.66
            ? [1, 0.95, 0.55, 0.9]
            : roll > 0.33
              ? [0.75, 0.55, 1, 0.85]
              : [0.55, 0.9, 1, 0.85],
        lifetime: 0.5 + Math.random() * 0.45,
        startSize: (0.14 + Math.random() * 0.16) * s,
        endSize: 0.02 * s,
        drag: 0.7,
      });
    }
  }

  // Lite only runs material-group builders during register. Phase B adds the first
  // PBR meshes (units/buildings) after `_built` — without a primed PBR group,
  // render-task pending resolve throws (no group.r / _rebuildSingle).
  {
    const white = createTexture2DFromPixels(
      engine,
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      { minFilter: 'linear', magFilter: 'linear' },
    );
    const orm = createTexture2DFromPixels(
      engine,
      new Uint8Array([255, 128, 0, 255]),
      1,
      1,
      { minFilter: 'linear', magFilter: 'linear' },
    );
    const prime = createSphere(engine, { diameter: 0.05, segments: 4 });
    prime.name = 'pbr-group-prime';
    prime.material = createPbrMaterial({
      name: 'pbr-group-prime',
      baseColorTexture: white,
      ormTexture: orm,
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
      doubleSided: true,
      occlusionStrength: 0,
    });
    prime.visible = false;
    prime.pickable = false;
    prime.receiveShadows = false;
    prime.position.y = -1000;
    addToScene(scene, prime);
  }

  await registerSceneWithShadowSupport(scene);
  bootLog('scene registered (first paint ready)');
  // GPU picker retained for USE_GPU_PICK / dumpPickBench — not created on the live CPU path.
  const gpuPicker = USE_GPU_PICK ? createGpuPicker(scene) : null;

  /**
   * Lite's pick walks `scene.meshes` by captured length and reads `.pickable`
   * without null-checks. Under load (async mesh churn) a hole throws — treat
   * as miss instead of an uncaught rejection on click.
   */
  async function safePickAsync(x, y, opts) {
    if (!gpuPicker) return null;
    try {
      return await pickAsync(gpuPicker, x, y, opts);
    } catch {
      return null;
    }
  }

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

  function flushVatParams(batch) {
    if (!batch.vatDirty) return;
    if (!batch.vatHandle && !batch.vatParts?.length) return;
    const n = batch.mesh.thinInstances?.count ?? batch.gpuCapacity;
    const params = batch.vatParams.subarray(0, n * 4);
    if (batch.vatParts?.length) {
      for (const part of batch.vatParts) part.handle.setInstances(params);
    } else {
      batch.vatHandle.setInstances(params);
    }
    batch.vatDirty = false;
  }

  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }

  function easeOutBack(t) {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  }

  function clearOrderMatrix(matrices) {
    for (let k = 0; k < 16; k++) matrices[k] = 0;
  }

  function writeSpinAt(matrices, x, y, z, scale, spinYaw) {
    if (scale <= 1e-4) {
      clearOrderMatrix(matrices);
      return;
    }
    const c = Math.cos(spinYaw);
    const s = Math.sin(spinYaw);
    matrices[0] = c * scale;
    matrices[1] = 0;
    matrices[2] = -s * scale;
    matrices[3] = 0;
    matrices[4] = 0;
    matrices[5] = scale;
    matrices[6] = 0;
    matrices[7] = 0;
    matrices[8] = s * scale;
    matrices[9] = 0;
    matrices[10] = c * scale;
    matrices[11] = 0;
    matrices[12] = x;
    matrices[13] = y;
    matrices[14] = z;
    matrices[15] = 1;
  }

  function hideOrderMarker() {
    if (!orderMarkerShown) return;
    clearOrderMatrix(orderMatrices);
    setThinInstanceColor(orderMarker, 0, 1, 1, 1, 0);
    markThinInstanceSlotDirty(orderMarker, 0);
    orderMarkerShown = false;
  }

  /**
   * Slam / pop / shrink. Tip on the eye→hit ray (click screen XY) near the camera.
   * World scale ∝ placeDist → steady on-screen size at any zoom / click distance.
   */
  function updateOrderMarker() {
    if (!orderPing) {
      hideOrderMarker();
      return;
    }
    const elapsed = performance.now() - orderPing.started;
    if (elapsed >= ORDER_TOTAL_MS) {
      orderPing = null;
      hideOrderMarker();
      return;
    }

    const x = orderPing.x;
    const z = orderPing.z;
    const gy = (Number.isFinite(orderPing.y) ? orderPing.y : groundYAt(x, z)) + FOOT_CLEARANCE;
    const eye = cameraEyePos();

    let animScale = 1;
    // Relative spin during pop; settles to 0 so the face stays camera-facing.
    const spinDir = orderPing.spinDir || 1;
    let spinOffset = 0;

    if (elapsed < ORDER_POP_MS) {
      const u = elapsed / ORDER_POP_MS;
      const pop = easeOutBack(Math.min(1, u));
      animScale = 2.4 - 1.4 * pop;
      // Ease-out spin into face — more turns + longer pop reads clearly.
      spinOffset = spinDir * (1 - easeOutCubic(u)) * ORDER_SPIN_RAD;
    } else if (elapsed < ORDER_POP_MS + ORDER_HOLD_MS) {
      animScale = 1;
      spinOffset = 0;
    } else {
      const u = (elapsed - ORDER_POP_MS - ORDER_HOLD_MS) / ORDER_FADE_MS;
      animScale = Math.max(0, 1 - u * u);
      spinOffset = spinDir * u * 0.45;
    }

    const dx = x - eye.x;
    const dy = gy - eye.y;
    const dz = z - eye.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const placeDist = Math.min(ORDER_MARKER_HUD_DIST, dist * 0.45);
    // scale / placeDist is constant → same pixels whether zoomed in or out.
    const scale = Math.max(
      0,
      animScale * ORDER_MARKER_BASE_SCALE * (placeDist / ORDER_MARKER_HUD_DIST),
    );
    if (scale <= 1e-4) {
      hideOrderMarker();
      return;
    }

    const inv = 1 / dist;
    const tipX = eye.x + dx * inv * placeDist;
    const tipY = eye.y + dy * inv * placeDist;
    const tipZ = eye.z + dz * inv * placeDist;
    // Origin so the tip vertex lands on the ray (Y spin only — tip is on local Y).
    const ox = tipX;
    const oy = tipY - orderTipLocalY * scale;
    const oz = tipZ;

    if (useOrderTarget) {
      // target.glb is flat on YZ (thin on X) — yaw so local +X faces the camera.
      const faceYaw = Math.atan2(-(eye.z - oz), eye.x - ox);
      writeSpinAt(orderMatrices, ox, oy, oz, scale, faceYaw + spinOffset);
    } else {
      writeFlatRing(orderMatrices, 0, tipX, tipZ, 10 * scale, RING_DIAM, RING_H, tipY);
    }
    const tint = RING_TINT[orderPing.tint] ?? RING_TINT.white;
    setThinInstanceColor(orderMarker, 0, tint[0], tint[1], tint[2], 1);
    markThinInstanceSlotDirty(orderMarker, 0);
    orderMarkerShown = true;
  }

  function unitPingBoost(started, now) {
    const t = now - started;
    if (t >= UNIT_PING_MS) return 1;
    const u = t / UNIT_PING_MS;
    const wave = Math.abs(Math.cos(u * Math.PI * UNIT_PING_PULSES));
    return 1 + wave * wave * UNIT_PING_PEAK;
  }

  function writeUnitPing(i, ping, boost) {
    const slot = entitySlot[i];
    if (slot < 0) return;
    const key = entityBatchKey[i];
    const batch = (key != null ? typeBatches.get(key) : null) ?? fallback;
    if (!batch) return;
    const r = ping.r * boost;
    const g = ping.g * boost;
    const b = ping.b * boost;
    const parts = tintableParts(batch);
    if (parts?.length) {
      for (const part of parts) {
        if (part.isTeamColor) {
          setThinInstanceColor(part.mesh, slot, r, g, b, ping.a);
        } else {
          setThinInstanceColor(part.mesh, slot, boost, boost, boost, ping.a);
        }
        markThinInstanceSlotDirty(part.mesh, slot);
      }
      return;
    }
    if (batch.mesh) {
      setThinInstanceColor(batch.mesh, slot, r, g, b, ping.a);
      markThinInstanceSlotDirty(batch.mesh, slot);
    }
  }

  function snapshotUnitPing(i) {
    const slot = entitySlot[i];
    if (slot < 0) return null;
    const key = entityBatchKey[i];
    const batch = (key != null ? typeBatches.get(key) : null) ?? fallback;
    const c = batch?.colors;
    const o = slot * 4;
    if (!c || o + 3 >= c.length) return { started: performance.now(), r: 1, g: 1, b: 1, a: 1 };
    return { started: performance.now(), r: c[o], g: c[o + 1], b: c[o + 2], a: c[o + 3] };
  }

  function updateUnitPings() {
    if (unitPings.size === 0) return;
    const now = performance.now();
    for (const [i, ping] of unitPings) {
      const boost = unitPingBoost(ping.started, now);
      writeUnitPing(i, ping, boost);
      if (now - ping.started >= UNIT_PING_MS) unitPings.delete(i);
    }
  }

  function flushAllBatches() {
    updateOrderMarker();
    if (screenshotHudHidden) {
      if (buildingRadial.isOpen()) buildingRadial.hide();
      if (actionRadial.isOpen()) actionRadial.hide();
      selectionHud.clear();
      controlGroupHud.clear();
    } else {
      if (buildingRadial.isOpen()) {
        buildingRadial.update?.(camera);
      }
      if (actionRadial.isOpen()) {
        actionRadial.update?.(camera);
      }
      selectionHud.update?.(camera);
      controlGroupHud.update?.(camera);
    }
    buildingProps.updateHarvestPing?.();
    updateUnitPings();
    for (const batch of typeBatches.values()) {
      flushVatParams(batch);
      // Unit matrices: markThinInstanceSlotDirty on write — do not flushThinInstances
      // (that API forces a full-buffer upload every call).
    }
    if (ringColorsDirty) {
      pushSelRingColors();
      ringColorsDirty = false;
    }
    if (screenshotHudHidden) {
      for (const mesh of selRingParts) mesh.visible = false;
      if (orderMarker) orderMarker.visible = false;
      workRadiusRings.clear();
    }
    // Selection / order matrices marked dirty on write.
    pickHitboxes.commit();
    holyShields.commit();
    workRadiusRings.commit();
    carryLoads.commit();
    projectileRenderer.commit();
    frogRenderer.sync();
    frogRenderer.commit();
    arrowTrails.commit();
    lightningBolts.commit();
    if (shadowsEnabled) applyShadowState();
  }

  function ensureSelRingCapacity(needed) {
    const n = Math.max(0, needed | 0);
    if (n <= ringCap) return;
    const oldCap = ringCap;
    const newCap = capacityFor(n, { initial: oldCap });
    const nextMatrices = new Float32Array(newCap * 16);
    nextMatrices.set(ringMatrices.subarray(0, oldCap * 16));
    ringMatrices = nextMatrices;
    for (let p = 0; p < ringColorBufs.length; p++) {
      const next = new Float32Array(newCap * 4);
      next.set(ringColorBufs[p].subarray(0, oldCap * 4));
      ringColorBufs[p] = next;
    }
    ringCap = newCap;
    for (let p = 0; p < selRingParts.length; p++) {
      const mesh = selRingParts[p];
      setThinInstances(mesh, ringMatrices, newCap);
      setThinInstanceColors(mesh, ringColorBufs[p]);
    }
  }

  function setSelRingCount(n) {
    const count = Math.max(0, n | 0);
    ensureSelRingCapacity(count);
    selRingLiveCount = count;
    for (const mesh of selRingParts) setThinInstanceCount(mesh, count);
  }

  function pushSelRingColors() {
    for (let p = 0; p < selRingParts.length; p++) {
      setThinInstanceColors(selRingParts[p], ringColorBufs[p]);
    }
  }

  function writeInstanceAt(i, typeId, owner, x, z, diameter, yaw = 0, moving = false, loft = 0, pitch = 0, roll = 0, groundYOverride = NaN, carrying = false, chopping = false, walkRate = 1) {
    const slot = entitySlot[i];
    if (slot < 0) return false;
    const key = entityBatchKey[i] ?? batchKey(typeId, owner);
    const batch = typeBatches.get(key) ?? fallback;
    if (!batch) return false;
    const tiCount = batch.mesh.thinInstances?.count ?? 0;
    if (slot >= tiCount) return false;
    writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, batch === fallback, loft, pitch, roll, groundYOverride, carrying, chopping, walkRate);
    if (monkLobFx.isFlying(i)) monkLobFx.notePose(i, x, z);
    if (diameter > 0.05) {
      const def = getUnitDef(typeId);
      const gy = Number.isFinite(groundYOverride) ? groundYOverride : groundYAt(x, z);
      mushrooms?.noteHeadPose?.(
        i,
        x,
        gy + loft + (def.pickHeight ?? 1.1) * 1.85,
        z,
      );
    }
    return true;
  }

  function mapEntitySlots(count, typesArr, ownersArr) {
    lastMapCount = count;
    lastMapTypes = typesArr;
    lastMapOwners = ownersArr ?? null;
    ensureEntityCapacity(count);
    scheduleBatchesForTypes(count, typesArr, ownersArr);

    entitySlot.fill(-1);
    entityBatchKey.fill(null);
    const nextByBase = new Map();
    for (let i = 0; i < count; i++) {
      const type = Number(typesArr[i]);
      const owner = ownersArr ? Number(ownersArr[i]) : 0;
      const key = batchKey(type, owner);
      if (!nextByBase.has(key)) nextByBase.set(key, []);
      nextByBase.get(key).push(i);
    }

    /** @type {Set<string | number>} */
    const usedKeys = new Set();

    for (const [baseKey, entityIds] of nextByBase) {
      // VAT shards: `${type:owner}#shard` created at boot when count > vatInstanceCap.
      const typeFromKey = Number(String(baseKey).split(':')[0]);
      const sharded = typeBatches.has(vatShardKey(baseKey, 0));
      if (sharded || (isVatUnitType(typeFromKey) && !typeBatches.has(baseKey))) {
        const chunks = chunkIds(entityIds, vatInstanceCap);
        for (let shard = 0; shard < chunks.length; shard++) {
          const key = chunks.length === 1 && typeBatches.has(baseKey)
            ? baseKey
            : vatShardKey(baseKey, shard);
          const batch = typeBatches.get(key);
          if (!batch) continue;
          usedKeys.add(key);
          const slice = chunks[shard];
          resizeTypeBatch(batch, slice, { preallocKoth });
          for (let s = 0; s < slice.length; s++) {
            entitySlot[slice[s]] = s;
            entityBatchKey[slice[s]] = key;
          }
          if (batch.vatHandle) {
            batch.vatDirty = true;
            flushVatParams(batch);
          }
        }
        continue;
      }

      const batch = typeBatches.get(baseKey);
      if (batch) {
        usedKeys.add(baseKey);
        resizeTypeBatch(batch, entityIds, { preallocKoth });
        for (let s = 0; s < entityIds.length; s++) {
          entitySlot[entityIds[s]] = s;
          entityBatchKey[entityIds[s]] = baseKey;
        }
        if (batch.vatHandle) {
          batch.vatDirty = true;
          flushVatParams(batch);
        }
      }
    }

    for (const [key, batch] of typeBatches) {
      if (!usedKeys.has(key)) {
        batch.entityIds = [];
        batch.mappedSize = 0;
        if (preallocKoth) {
          resizeTypeBatch(batch, [], { preallocKoth: true });
        } else {
          for (const mesh of vatPartMeshes(batch)) setThinInstanceCount(mesh, 0);
        }
      }
    }

    const unmapped = [];
    for (let i = 0; i < count; i++) {
      if (entitySlot[i] < 0) unmapped.push(i);
    }

    // Sphere fallback only for types with no model. Pending VAT/static loads stay
    // invisible until their template arrives (then remapped).
    if (unmapped.length > 0 && fallback) {
      const fbIds = unmapped.filter((i) => {
        const t = Number(typesArr[i]);
        return !isVatUnitType(t) && !hasUnitModel(t);
      });
      resizeTypeBatch(fallback, fbIds, { preallocKoth: false });
      for (let s = 0; s < fbIds.length; s++) {
        entitySlot[fbIds[s]] = s;
        entityBatchKey[fbIds[s]] = null;
      }
    }

    return unmapped.filter((i) => entitySlot[i] < 0);
  }

  function viewProjection() {
    const { aspect } = canvasCoords(0, 0);
    return getViewProjectionMatrix(camera, aspect);
  }

  function writeBatchInstance(batch, slot, x, z, diameter, yaw, moving, useSphereY, loft = 0, pitch = 0, roll = 0, groundYOverride = NaN, carrying = false, chopping = false, walkRate = 1) {
    const baseGy = Number.isFinite(groundYOverride) ? groundYOverride : groundYAt(x, z);
    const gy = baseGy + (loft || 0);
    let animateVat = diameter > 0;
    if (LOD_ENABLED && animateVat) {
      const eye = cameraEyePos();
      const edx = eye.x - x;
      const edy = eye.y - gy;
      const edz = eye.z - z;
      animateVat = edx * edx + edy * edy + edz * edz <= VAT_DISTANCE_SQ;
    }

    if (useSphereY) {
      const scale = diameter / batch.baseSize;
      const o = slot * 16;
      if (scale <= 0) {
        for (let k = 0; k < 16; k++) batch.matrices[o + k] = 0;
        syncVatSlot(batch, slot, false, false, false, false, 1);
        for (const mesh of vatPartMeshes(batch)) markThinInstanceSlotDirty(mesh, slot);
        return;
      }
      const stretch = moving ? 1.14 : 1;
      const narrow = moving ? 0.9 : 1;
      const sx = scale * narrow;
      const sy = scale;
      const sz = scale * stretch;
      const cy = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const y = gy + FOOT_CLEARANCE + diameter * 0.5;
      const x0x = cy;
      const x0z = -syw;
      const y0x = syw * sp;
      const y0y = cp;
      const y0z = cy * sp;
      const z0x = syw * cp;
      const z0y = -sp;
      const z0z = cy * cp;
      batch.matrices[o] = (x0x * cr + y0x * sr) * sx;
      batch.matrices[o + 1] = (y0y * sr) * sx;
      batch.matrices[o + 2] = (x0z * cr + y0z * sr) * sx;
      batch.matrices[o + 3] = 0;
      batch.matrices[o + 4] = (-x0x * sr + y0x * cr) * sy;
      batch.matrices[o + 5] = (y0y * cr) * sy;
      batch.matrices[o + 6] = (-x0z * sr + y0z * cr) * sy;
      batch.matrices[o + 7] = 0;
      batch.matrices[o + 8] = z0x * sz;
      batch.matrices[o + 9] = z0y * sz;
      batch.matrices[o + 10] = z0z * sz;
      batch.matrices[o + 11] = 0;
      batch.matrices[o + 12] = x;
      batch.matrices[o + 13] = y;
      batch.matrices[o + 14] = z;
      batch.matrices[o + 15] = 1;
    } else if (diameter <= 0) {
      writeUnitMatrix(batch.matrices, slot, x, z, 0, yaw, false, gy, pitch, roll);
    } else {
      const scale = batch.vatScale ?? 1;
      const lift = batch.vatFootLift ?? 0;
      writeUnitMatrix(batch.matrices, slot, x, z, scale, yaw, false, gy + lift, pitch, roll);
    }

    syncVatSlot(batch, slot, diameter > 0 && moving, animateVat, carrying, chopping, walkRate);
    for (const mesh of vatPartMeshes(batch)) markThinInstanceSlotDirty(mesh, slot);
  }

  /** VAT state: idle / walk / carry / chop, high bit frozen (fps=0) beyond VAT distance. */
  function syncVatSlot(batch, slot, moving, animate, carrying = false, chopping = false, walkRate = 1) {
    if (!batch.vatHandle || slot >= batch.vatMoving.length) return;
    const want = vatWant(!!moving, !!carrying, !!animate, !!chopping);
    const clip = clipForVatState(batch, want);
    const clipId = want & ~VAT_FROZEN;
    const walkClip = clipId === VAT_CLIP.WALK || clipId === VAT_CLIP.CARRY_WALK;
    const fps = (want & VAT_FROZEN) !== 0
      ? 0
      : walkClip
        ? vatWalkFps(clip.fps, walkRate)
        : clip.fps;
    const prevFps = batch.vatParams[slot * 4 + 3];
    if (batch.vatMoving[slot] === want && Math.abs(prevFps - fps) < 0.08) return;
    batch.vatMoving[slot] = want;
    writeVatSlotParams(batch.vatParams, slot, clip, batch.vatPhase[slot], fps);
    batch.vatDirty = true;
  }

  async function upgradeHudMeshes() {
    try {
      const parts = await loadBakedUnitMeshParts(engine, SELECTION_COLLAR_URL);
      if (!parts.length) return;
      for (const mesh of selRingParts) {
        mesh.visible = false;
        setThinInstanceCount(mesh, 0);
      }
      selRingParts = parts;
      useCollar = true;
      collarBandColors = [];
      for (const mesh of selRingParts) {
        collarBandColors.push(authoredCollarBandColor(mesh.material));
        mesh.material = makeCollarTintMaterial();
        setThinInstances(mesh, ringMatrices, ringCap);
        setThinInstanceCount(mesh, selRingLiveCount);
        addToScene(scene, mesh);
      }
      while (ringColorBufs.length < selRingParts.length) {
        ringColorBufs.push(new Float32Array(ringCap * 4));
      }
      writeSelRingColors(selRingLiveCount, 'white');
      pushSelRingColors();
      ringColorsDirty = true;
    } catch (err) {
      console.warn('Selection collar model failed (keeping disc):', SELECTION_COLLAR_URL, err);
    }

    try {
      const markerParts = await loadBakedUnitMeshParts(engine, ORDER_MARKER_URL);
      const marker = markerParts[0];
      if (!marker) throw new Error('order marker mesh missing');
      const mat = marker.material;
      if (mat) {
        applyUnlitHudMaterial(mat);
        if ('alpha' in mat) mat.alpha = 1;
        if (mat.emissiveColor) mat.emissiveColor = [0, 0, 0];
      }
      orderTipLocalY = marker.boundMin?.[1] ?? 0;
      if (marker.position) {
        marker.position.x = 0;
        marker.position.y = 0;
        marker.position.z = 0;
        marker.markLocalDirty?.();
      }
      orderMarker.visible = false;
      setThinInstanceCount(orderMarker, 0);
      orderMarker = marker;
      useOrderTarget = true;
      setThinInstances(orderMarker, orderMatrices, 1);
      setThinInstanceColors(orderMarker, new Float32Array([1, 1, 1, 0]));
      addToScene(scene, orderMarker);
      orderMarkerShown = false;
    } catch (err) {
      console.warn('Order marker model failed (keeping disc):', ORDER_MARKER_URL, err);
    }
  }

  let engineStarted = false;

  /** Resolves when heavy boot assets are in — safe to unlock input. */
  let resolveInteractive = /** @type {(v?: void) => void} */ (() => {});
  const interactiveReady = new Promise((resolve) => {
    resolveInteractive = resolve;
  });

  /**
   * After the board is playable, decode remaining unit / building GLBs one
   * asset per frame — no scene meshes. Instantiating them here would pin the
   * loading-screen 1v1 (hidden thin-instances still hit writeBuffer). A later
   * match place() / batch create hits the CPU cache and writes owner colors.
   */
  async function warmRoster() {
    try {
      if (buildingProps?.prefetchProgressive) {
        await buildingProps.prefetchProgressive();
        bootLog('roster buildings');
      }
      for (const url of Object.values(UNIT_MODEL_URLS)) {
        await prefetchBakedMesh(engine, url);
        await afterPaint();
      }
      bootLog('roster units');
    } catch (err) {
      console.warn('[boot] roster warm failed', err);
    }
  }

  // Phase B — background loads; do not gate start()/first paint.
  // World scenery (3D trees/rocks) finishes before unit templates so the board
  // reads as place-first. Interactive unlocks once agora/building systems exist
  // and live units have started loading — remaining roster warms on the
  // loading-screen match, one asset per frame.
  void (async () => {
    try {
      await sceneryModelsReady;
      bootLog('scenery models');

      void scheduleBatchesForTypes(capacity, types, opts.owners);

      const propsP = Promise.all([
        createFrogRenderer(engine, scene, groundYAt, frogLandBurst),
        createMushroomPreviews(engine, scene, groundYAt),
        createAgoraProps(engine, scene, groundYAt),
        createBuildingProps(engine, scene, groundYAt, {
          emit: (init) => particles.emit(init),
          emitBurst: (init) => particles.emitBurst(init),
        }),
        upgradeHudMeshes(),
      ]).then(async ([frogs, shrooms, agoras, buildings]) => {
        frogRenderer = frogs;
        if (pendingFrogUpdates.length) {
          frogRenderer.applyUpdates(pendingFrogUpdates);
          pendingFrogUpdates.length = 0;
        }
        mushrooms = shrooms;
        agoraProps = agoras;
        buildingProps = buildings;
        if (pendingAgoras) agoraProps.place(pendingAgoras);
        if (pendingRallyFlags) agoraProps.placeRallyFlags?.(pendingRallyFlags);
        // Progressive place — do not await every type before unlocking.
        if (pendingBuildings) {
          void buildingProps.place(pendingBuildings).then(() => {
            buildingProps.forEachShadowMesh?.(noteShadowMesh);
            if (shadowsEnabled) applyShadowState();
          });
        }
        pendingAgoras = null;
        pendingRallyFlags = null;
        pendingBuildings = null;
        agoraProps.forEachShadowMesh?.(noteShadowMesh);
        buildingProps.forEachShadowMesh?.(noteShadowMesh);
        if (shadowsEnabled) applyShadowState();
        bootLog('buildings + props');
      });

      void (async () => {
        try {
          const font = await buildingMenuFontPromise;
          radialScreen.font = font;
          const [buildMenu, actionMenu, selHud] = await Promise.all([
            createBuildingRadialMenu(engine, scene, groundYAt, radialScreen),
            createBuildingActionRadial(engine, scene, groundYAt, radialScreen),
            createSelectionHud(engine, scene, radialScreen),
          ]);
          buildingRadial = buildMenu;
          actionRadial = actionMenu;
          selectionHud = selHud;
          buildingRadial.registerLabels?.();
          actionRadial.registerLabels?.();
          selectionHud.registerLabels?.();
          bootLog('radials');
        } catch (err) {
          console.error('[boot] radials failed', err);
        }
      })();

      await propsP;
      bootLog('phase B core complete');
    } catch (err) {
      console.error('[boot] phase B failed', err);
    } finally {
      bootLog('interactive');
      resolveInteractive();
      void warmRoster();
    }
  })();

  return {
    engine,
    scene,
    camera,
    cameraController,

    /** Resolves when boot asset work is done and input should feel smooth. */
    whenInteractive() {
      return interactiveReady;
    },

    setCount(n) {
      ensureEntityCapacity(n);
      setSelRingCount(n);
      writeSelRingColors(n, useCollar ? 'white' : 'cyan');
      pushSelRingColors();
    },

    /**
     * True when a late unit batch remapped slots — clear pose cache and rewrite instances.
     * @returns {boolean}
     */
    consumePoseResync() {
      if (poseResyncGeneration === lastConsumedPoseResync) return false;
      lastConsumedPoseResync = poseResyncGeneration;
      return true;
    },

    /** Place static agora meshes (init / world rebuild). */
    placeAgoras(list) {
      agoraProps.place(list ?? []);
      agoraProps.forEachShadowMesh?.(noteShadowMesh);
      if (shadowsEnabled) applyShadowState();
    },

    /** Planted train-rally flags for production buildings. */
    placeRallyFlags(list) {
      agoraProps.placeRallyFlags?.(list ?? []);
    },

    /** Flag cursor while setting a building rally point. */
    setRallyGhost(pos) {
      agoraProps.setRallyGhost?.(pos ?? null);
    },

    /** Rewash TeamColor after the local profile swatch changes. */
    refreshOwnerTints() {
      buildingProps?.refreshTeamColors?.();
      agoraProps?.refreshTeamColors?.();
    },

    /** Place constructed buildings. */
    async placeBuildings(list) {
      await buildingProps.place?.(list ?? []);
      buildingProps.forEachShadowMesh?.(noteShadowMesh);
      if (shadowsEnabled) applyShadowState();
    },

    /** Building selection collar(s) — fixed S/M/L world size (not the build menu). */
    setBuildingSelectionHighlight(pos) {
      lastBuildingHighlight = pos ?? null;
      if (screenshotHudHidden) {
        buildingProps.setSelectionHighlight?.(null);
        return;
      }
      buildingProps.setSelectionHighlight?.(lastBuildingHighlight);
    },

    /** Placement ghost (translucent building mesh). */
    setBuildingGhost(pos) {
      buildingProps.setGhost?.(pos ?? null);
      placementFocus = pos?.type
        ? { type: pos.type, x: pos.x, z: pos.z, valid: pos.valid !== false }
        : null;
      syncPlacementGrid();
    },

    /**
     * Draw (or clear with null / []) flat ground rings for drop-off work radii.
     * @param {{ x: number, z: number, radius: number } | { x: number, z: number, radius: number }[] | null} spec
     */
    setWorkRadiusRing(spec) {
      lastWorkRadiusSpec = spec ?? null;
      if (screenshotHudHidden) {
        workRadiusRings.clear();
        return;
      }
      applyWorkRadiusSpec(lastWorkRadiusSpec);
    },

    /**
     * Flash the harvestable a gather click landed on (tree / rock / farm).
     * @param {number} tile
     */
    pingUnit(i) {
      const id = i | 0;
      if (id < 0) return false;
      const ping = snapshotUnitPing(id);
      if (!ping) return false;
      unitPings.set(id, ping);
      writeUnitPing(id, ping, 1 + UNIT_PING_PEAK);
      return true;
    },

    pingBuilding(x, z) {
      return buildingProps.pingAt?.(x, z) ?? false;
    },

    pingAgora(index) {
      return agoraProps.pingAt?.(index) ?? false;
    },

    pingHarvestTarget(tile) {
      const t = tile | 0;
      if (t < 0) return false;
      if (fieldSnap?.foodNode?.[t]) {
        const w = fieldSnap.width | 0;
        if (w <= 0) return false;
        const tz = Math.floor(t / w);
        const tx = t - tz * w;
        const half = worldHalfFFromField(fieldSnap);
        const x = (tx + 0.5) * TILE_SIZE_F - half;
        const z = (tz + 0.5) * TILE_SIZE_F - half;
        buildingProps.pingHarvestAt?.(x, z);
        return true;
      }
      return terrain?.pingHarvest?.(t) ?? false;
    },

    /**
     * GPU mesh pick → own agora / placeable under the cursor, or null.
     * Hits the actual building mesh (thin instance), not a ground radius.
     * Gated by USE_GPU_PICK — live path is rayPickSpheres / rayHitSpheresNearest.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {Promise<{ kind: 'agora' | 'building', index: number } | null>}
     */
    async pickBuilding(clientX, clientY) {
      if (!USE_GPU_PICK || !gpuPicker) return null;
      const cc = canvasCoords(clientX, clientY);
      const info = await safePickAsync(cc.x, cc.y, {
        filter: (mesh) =>
          Boolean(buildingProps.isPickMesh?.(mesh) || agoraProps.isPickMesh?.(mesh)),
      });
      if (!info?.hit || !info.pickedMesh) return null;
      const slot = info.thinInstanceIndex;
      return (
        buildingProps.resolvePick?.(info.pickedMesh, slot) ??
        agoraProps.resolvePick?.(info.pickedMesh, slot) ??
        null
      );
    },

    /** Build menu (tilted ring + pads + icons). Screen-stable size via eye distance. */
    showBuildingRadial(x, z, owner = 0) {
      if (screenshotHudHidden) return;
      actionRadial.hide();
      buildingRadial.showAt(x, z, camera, owner);
    },

    hideBuildingRadial() {
      buildingRadial.hide();
    },

    isBuildingRadialOpen() {
      return buildingRadial.isOpen();
    },

    /**
     * Placeable action menu (units / upgrades). Mutually exclusive with the agora build radial.
     * @param {number} x
     * @param {number} z
     * @param {string} buildingType
     */
    showActionRadial(x, z, buildingType) {
      if (screenshotHudHidden) return;
      buildingRadial.hide();
      actionRadial.showAt(x, z, buildingType, camera);
    },

    hideActionRadial() {
      actionRadial.hide();
    },

    setScreenshotHudHidden(on) {
      const next = !!on;
      if (screenshotHudHidden === next) return screenshotHudHidden;
      screenshotHudHidden = next;
      if (screenshotHudHidden) hideScreenshotHudChrome();
      else restoreScreenshotHudChrome();
      return screenshotHudHidden;
    },

    getScreenshotHudHidden() {
      return screenshotHudHidden;
    },

    isActionRadialOpen() {
      return actionRadial.isOpen();
    },

    /** Mark researched upgrade pads (dull + full progress ring). */
    setActionRadialResearched(ids) {
      actionRadial.setResearchedUpgrades?.(ids);
    },

    setRadialMenuGate(snapshot) {
      buildingRadial.setMenuGate?.(snapshot);
      actionRadial.setMenuGate?.(snapshot);
    },

    /** Dull / enable Cancel on the open action radial. */
    setActionRadialUtilityAvailability(avail) {
      actionRadial.setUtilityAvailability?.(avail);
    },

    /** Hold / resume look on the Pause pad. */
    setActionRadialPaused(on) {
      actionRadial.setPaused?.(Boolean(on));
    },

    /**
     * Queue/progress display for action pads.
     * Keys: `unit:id` / `upgrade:id` → `{ progress: 0..1, count }`.
     * @param {Record<string, { progress?: number, count?: number }> | Map<string, { progress?: number, count?: number }>} tracks
     */
    setActionRadialTracks(tracks) {
      actionRadial.setTrackDisplay?.(tracks);
    },

    /** Arm cancel for two-click confirm (`null` clears). */
    setActionRadialArmed(id) {
      actionRadial.setArmed?.(id ?? null);
    },

    clearActionRadialTracks() {
      actionRadial.clearTracks?.();
    },

    getActionRadialTracks() {
      return actionRadial.getTracks?.() ?? {};
    },

    getActionRadialArmed() {
      return actionRadial.getArmed?.() ?? null;
    },

    /** Shrink the open radial while ghost-placing so it stays out of the way. */
    setBuildingRadialCompact(on) {
      buildingRadial.setCompact?.(Boolean(on));
    },

    /** Switch Basic / Advanced / Elemental page on the open radial. */
    setBuildingRadialCategory(categoryId, lock = false) {
      buildingRadial.setCategory?.(categoryId, { lock: Boolean(lock) });
    },

    /** Let pie hover switch pages again (after canceling a building ghost). */
    unlockBuildingRadialCategory() {
      buildingRadial.unlockCategory?.();
    },

    /**
     * Pick a radial option (CPU disc hit — pie / pad / icon; agora pie only). Sync-friendly.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {Promise<{ kind: 'building' | 'category' | 'unit' | 'upgrade' | 'pause' | 'cancel', id?: string } | null>}
     */
    async pickBuildingRadial(clientX, clientY) {
      const ray = radialPickingRay(clientX, clientY);
      if (buildingRadial.isOpen()) {
        return buildingRadial.pickOptionAtRay?.(ray) ?? null;
      }
      if (actionRadial.isOpen()) {
        return actionRadial.pickOptionAtRay?.(ray) ?? null;
      }
      return null;
    },

    /**
     * Hover via CPU disc pick (full pad including hole). Sync — no GPU queue.
     * When switchCategory is true and the page is unlocked, pie hover flips pages.
     * After a pie click (locked), hover only highlights — page stays put.
     * @param {number} clientX
     * @param {number} clientY
     */
    hoverBuildingRadial(clientX, clientY, switchCategory = false) {
      const ray = radialPickingRay(clientX, clientY);
      if (buildingRadial.isOpen()) {
        const pick = buildingRadial.pickOptionAtRay?.(ray) ?? null;
        if (
          switchCategory &&
          pick?.kind === 'category' &&
          !buildingRadial.categoryLocked
        ) {
          buildingRadial.setCategory?.(pick.id);
        }
        if (buildingRadial.setHoverFromPick) buildingRadial.setHoverFromPick(pick);
        else if (pick?.kind === 'building') buildingRadial.setHoverByType?.(pick.id);
        else buildingRadial.clearHover();
        return;
      }
      if (actionRadial.isOpen()) {
        const pick = actionRadial.pickOptionAtRay?.(ray) ?? null;
        actionRadial.setHoverFromPick?.(pick);
      }
    },

    /**
     * Sync gesture test: over a visible option (pad / icon) or ring chrome.
     * Action radials do not claim the empty yard inside the ring.
     * Must not await GPU (pointerdown latch).
     * Always ray-test — a stale hover must not claim the whole screen.
     */
    hitBuildingRadial(clientX, clientY) {
      const ray = radialPickingRay(clientX, clientY);
      if (buildingRadial.isOpen()) {
        return buildingRadial.hitAtRay?.(ray) ?? false;
      }
      if (actionRadial.isOpen()) {
        return actionRadial.hitAtRay?.(ray) ?? false;
      }
      return false;
    },

    /**
     * Empty hub hole that frames the selected building (click-through on pointer-up).
     */
    hitBuildingRadialHub(clientX, clientY) {
      const ray = radialPickingRay(clientX, clientY);
      if (buildingRadial.isOpen()) {
        return buildingRadial.hitHubHoleAtRay?.(ray) ?? false;
      }
      if (actionRadial.isOpen()) {
        return actionRadial.hitHubHoleAtRay?.(ray) ?? false;
      }
      return false;
    },

    /**
     * Client fog overlay + projectile/unit hide queries. Overlay rebuilds with setField.
     * @param {{ attachOverlay?: Function, detachOverlay?: Function, syncOverlay?: Function } | null} api
     */
    attachFogOfWar(api) {
      fogApi?.detachOverlay?.();
      fogApi = api ?? null;
      if (fogApi && fieldSnap) {
        fogApi.attachOverlay?.(engine, scene, fieldSnap);
        fogApi.syncOverlay?.();
      }
    },

    /**
     * @param {((x: number, z: number, owner: number) => boolean) | null} fn
     */
    setVisionDraw(fn) {
      visionDraw.fn = fn ?? null;
    },

    /**
     * Swap flat ground for atlas terrain (or rebuild after world reset).
     * Serialized + generation-gated so overlapping match starts can't leave
     * two forests in the scene.
     */
    setField(snap) {
      const gen = ++fieldGen;
      const ac = new AbortController();
      fieldAbort?.abort();
      fieldAbort = ac;
      const run = async () => {
        const prev = terrain;
        // Drop terrain from the update + CSM caster paths BEFORE destroying GPU
        // buffers — otherwise shadow/submit keeps WriteBuffer'ing dead TI mats.
        terrain = null;
        fieldSnap = snap ?? null;
        const tableHalf = snap ? worldHalfFFromField(snap) : WORLD_HALF_F;
        cameraController.setWorldHalfF?.(resolveCameraHalfF(tableHalf, snap?.cameraHalfF));
        celestial.setWorldHalfF?.(tableHalf);
        fogApi?.detachOverlay?.();
        applyShadowState();
        prev?.dispose?.();
        if (ground) {
          softDetachMesh(scene, ground);
          ground = null;
        }
        if (!snap) {
          if (gen !== fieldGen) return;
          rebuildTileGrid(null);
          fogApi?.detachOverlay?.();
          applyShadowState();
          return;
        }
        const next = await createTerrainFromField(engine, scene, snap, camera, {
          ...sceneryOpts(),
          signal: ac.signal,
        });
        if (gen !== fieldGen || ac.signal.aborted) {
          next.dispose?.();
          applyShadowState();
          return;
        }
        terrain = next;
        sceneryModelsReady = next.modelsReady ?? Promise.resolve();
        applyShadowState();
        rebuildTileGrid(snap);
        fogApi?.attachOverlay?.(engine, scene, snap);
        fogApi?.syncOverlay?.();
        terrain?.applyFogDim?.(
          fogApi?.isEnabled?.() ? (x, z) => fogApi.fogFactorAt(x, z) : null,
        );
      };
      const p = setFieldChain.then(run, run);
      setFieldChain = p.catch(() => {});
      return p;
    },

    /**
     * Resolves when the latest setField terrain is ready.
     * Pass `{ models: true }` to also wait for 3D tree/rock GLBs (boot only).
     */
    whenFieldReady(opts) {
      if (opts?.models) return setFieldChain.then(() => sceneryModelsReady);
      return setFieldChain;
    },

    applySceneryFog(isVisible) {
      terrain?.applyFogDim?.(isVisible);
    },

    applySceneryFogTiles(forEachTile) {
      terrain?.applyFogTiles?.(forEachTile);
    },

    applyTreeUpdates(updatesList) {
      if (!updatesList?.length) return;
      for (let i = 0; i < updatesList.length; i++) {
        terrain?.applyTreeUpdates?.(updatesList[i]);
      }
      // Field slowMask is already synced on session.field (= fieldSnap).
      if (tileGridVisible) refreshTileGridOccupancy();
      else tileGridOccupancyDirty = true;
      syncPlacementGrid();
    },

    applyRockUpdates(updatesList) {
      if (!updatesList?.length) return;
      for (let i = 0; i < updatesList.length; i++) {
        terrain?.applyRockUpdates?.(updatesList[i]);
      }
      if (tileGridVisible) refreshTileGridOccupancy();
      else tileGridOccupancyDirty = true;
      syncPlacementGrid();
    },

    /** Rebuild blocked/slow overlay from the current field (grid-based buildings, etc.). */
    refreshTileGrid() {
      if (tileGridVisible) refreshTileGridOccupancy();
      else tileGridOccupancyDirty = true;
      syncPlacementGrid();
    },

    applyFireZoneUpdates(updatesList) {
      if (!updatesList?.length) return;
      for (let u = 0; u < updatesList.length; u++) {
        const patch = updatesList[u];
        const n = patch?.slots?.length ?? 0;
        for (let i = 0; i < n; i++) {
          const slot = patch.slots[i];
          if (!patch.alive[i]) {
            const cur = groundFires.get(slot);
            if (cur && cur.generation === patch.generation[i]) {
              groundFires.delete(slot);
            }
            continue;
          }
          const ttlMs = (patch.ttl[i] || 50) * 50;
          groundFires.set(slot, {
            x: patch.px[i],
            z: patch.py[i],
            radius: patch.radius[i],
            generation: patch.generation[i],
            endsAtMs: particleClockMs + ttlMs,
          });
        }
      }
    },

    applyFrogUpdates(updatesList) {
      frogRenderer.applyUpdates(updatesList);
    },

    applyLightningUpdates(updatesList) {
      if (!updatesList?.length) return;
      for (let u = 0; u < updatesList.length; u++) {
        const patch = updatesList[u];
        const n = patch?.count ?? 0;
        for (let i = 0; i < n; i++) {
          lightningBolts.strike(patch.x[i], patch.y[i], patch.kind[i]);
        }
      }
    },

    applyHolyArmorUpdates(updatesList) {
      unitAuras.applyHolyArmorUpdates(updatesList);
    },

    applyMonkKickUpdates(updatesList) {
      monkLobFx.applyUpdates(updatesList);
    },

    setMonkLobDisplayAlpha(alpha) {
      monkLobFx.setDisplayAlpha(alpha);
    },

    monkLobHeight(entity) {
      return monkLobFx.loftFor(entity);
    },

    monkLobPitch(entity) {
      return monkLobFx.pitchFor(entity);
    },

    monkLobYawTwist(entity) {
      return monkLobFx.yawTwistFor(entity);
    },

    monkLobRoll(entity) {
      return monkLobFx.rollFor(entity);
    },

    /** @deprecated alias for monkLobPitch */
    monkLobSpin(entity) {
      return monkLobFx.pitchFor(entity);
    },

    applySporeBloomUpdates(updatesList, tick) {
      if (Number.isFinite(tick)) fxSimTick = tick;
      sporeBloomFx.applyUpdates(updatesList, fxSimTick);
    },

    setFxSimTick(tick) {
      if (Number.isFinite(tick)) fxSimTick = tick;
    },

    /**
     * Sync ongoing unit buff/debuff auras for sparkles.
     * @param {number} count
     * @param {Int16Array|Uint8Array|Int32Array|{ shieldHp?: Int16Array, frostTicks?: Int16Array, dotTicks?: Int16Array }} maskOrStatus
     * @param {Float32Array} x
     * @param {Float32Array} y
     * @param {Float32Array} z
     * @param {{ fromShieldHp?: boolean, fromStatus?: boolean }} [opts]
     */
    syncUnitAuras(count, maskOrStatus, x, y, z, opts = {}) {
      const n = count | 0;
      if (opts.fromStatus || opts.fromShieldHp) {
        if (!auraScratch || auraScratch.length < n) {
          auraScratch = new Uint8Array(Math.max(n, 256));
        }
        const shield = opts.fromStatus ? maskOrStatus?.shieldHp : maskOrStatus;
        const frost = opts.fromStatus ? maskOrStatus?.frostTicks : null;
        const dot = opts.fromStatus ? maskOrStatus?.dotTicks : null;
        for (let i = 0; i < n; i++) {
          if (opts.skip?.[i]) {
            auraScratch[i] = 0;
            continue;
          }
          let mask = 0;
          if (shield && shield[i] > 0) mask |= AURA.HOLY;
          if (frost && frost[i] > 0) mask |= AURA.FROST;
          if (dot && dot[i] > 0) mask |= AURA.SHADOW;
          auraScratch[i] = mask;
        }
        unitAuras.sync(n, auraScratch, x, y, z);
        return;
      }
      unitAuras.sync(count, maskOrStatus, x, y, z);
    },

    /**
     * Keep circling locust packs on units/buildings while stacks are up.
     * @param {number} count
     * @param {Int16Array|null|undefined} stacks
     * @param {Float32Array} x
     * @param {Float32Array} y
     * @param {Float32Array} z
     * @param {{ skip?: Uint8Array, buildings?: { x: number, z: number, locustStacks?: number }[], hideBuilding?: (b: object) => boolean }} [opts]
     */
    syncLocustDots(count, stacks, x, y, z, opts = {}) {
      locustFx.beginDots();
      const n = count | 0;
      if (stacks) {
        for (let i = 0; i < n; i++) {
          if (opts.skip?.[i]) continue;
          const s = stacks[i] | 0;
          if (s > 0) locustFx.sustain(`u:${i}`, x[i], y[i], z[i], s);
        }
      }
      const buildings = opts.buildings;
      if (buildings) {
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i];
          const s = b?.locustStacks | 0;
          if (s <= 0) continue;
          if (opts.hideBuilding?.(b)) continue;
          locustFx.sustain(`b:${i}`, b.x, groundYAt(b.x, b.z) + 1.7, b.z, s);
        }
      }
      locustFx.endDots();
    },

    setTileGridVisible(on) {
      tileGridVisible = !!on;
      if (tileGridVisible && tileGridOccupancyDirty) refreshTileGridOccupancy();
      tileGrid?.setVisible(tileGridVisible && !screenshotHudHidden);
      syncPlacementGrid();
      return tileGridVisible;
    },

    getTileGridVisible() {
      return tileGridVisible;
    },

    toggleTileGrid() {
      return this.setTileGridVisible(!tileGridVisible);
    },

    setShadowsEnabled(on) {
      shadowsEnabled = !!on;
      applyShadowState();
      return shadowsEnabled;
    },

    getShadowsEnabled() {
      return shadowsEnabled;
    },

    toggleShadows() {
      return this.setShadowsEnabled(!shadowsEnabled);
    },

    setFxEnabled(on) {
      if (on) {
        applyFxQuality(lastNonZeroFxMode, lastNonZeroFxQuality);
      } else {
        fxEnabled = false;
        socketFireEnabled = false;
        particles.configure({ muted: true, hardMax: 1 });
        unitAuras.configure?.({ muted: true });
        socketFireElapsed = 0;
        socketSmokeElapsed = 0;
        socketSparkleElapsed = 0;
        groundFireElapsed = 0;
      }
      return fxEnabled;
    },

    getFxEnabled() {
      return fxEnabled;
    },

    /** @param {number} mode 0..3 */
    setFxMode(mode, quality) {
      applyFxQuality(mode, quality);
      return fxMode;
    },

    getFxMode() {
      return fxEnabled ? fxMode : 0;
    },

    toggleFx() {
      return this.setFxEnabled(!fxEnabled);
    },

    setVatEnabled(on) {
      vatEnabled = !!on;
      return vatEnabled;
    },

    getVatEnabled() {
      return vatEnabled;
    },

    toggleVat() {
      return this.setVatEnabled(!vatEnabled);
    },

    setUnitsEnabled(on) {
      unitsEnabled = !!on;
      applyUnitMeshVisibility();
      // Refresh casters so units-off still feeds CSM (see collectShadowCasters).
      if (shadowsEnabled) applyShadowState();
      return unitsEnabled;
    },

    getUnitsEnabled() {
      return unitsEnabled;
    },

    toggleUnits() {
      return this.setUnitsEnabled(!unitsEnabled);
    },

    /** Spin the sun/fill through all angles to preview lighting. Client-only. */
    setCelestialSpin(on, opts) {
      return celestial.setSpin(on, opts);
    },

    toggleCelestialSpin() {
      return celestial.toggleSpin();
    },

    getCelestialSpin() {
      return celestial.getSpin();
    },

    /** Freeze particle / lightning / trail clocks (wire to sim pause). */
    setFxPaused(on) {
      fxPaused = !!on;
      return fxPaused;
    },

    /** Console helper: renderer.debugShadows() */
    debugShadows() {
      const parts = [];
      for (const batch of typeBatches.values()) {
        if (!(batch.mappedSize > 0)) continue;
        for (const mesh of vatPartMeshes(batch)) {
          const fam = mesh.material?._buildGroup?._materialFamily ?? '?';
          parts.push({
            name: mesh.name || '(unit)',
            mapped: batch.mappedSize,
            ti: mesh.thinInstances?.count ?? 0,
            visible: mesh.visible !== false,
            vat: !!mesh.vat,
            fam,
            recv: !!mesh.receiveShadows,
            bmin: mesh.boundMin,
            bmax: mesh.boundMax,
          });
        }
      }
      return {
        enabled: shadowsEnabled,
        type: shadowGen?._shadowType,
        darkness: shadowOpts.darkness,
        worldSpaceBias: shadowOpts.worldSpaceBias,
        depthBias: shadowGen?._config?._bias,
        casters: shadowCasterList.length,
        unitParts: parts,
        unitPartCount: parts.length,
      };
    },

    setPickHitboxesVisible(on) {
      return pickHitboxes.setVisible(on);
    },

    getPickHitboxesVisible() {
      return pickHitboxes.getVisible();
    },

    togglePickHitboxes() {
      return pickHitboxes.toggle();
    },

    /** Console: renderer.debugPickHitboxes() */
    debugPickHitboxes() {
      return pickHitboxes.debug();
    },

    /**
     * Sync debug spheres to match CPU pick volumes.
     * `{ x, y, z, r }[]` with center at pickHeight and radius pickRadius.
     */
    syncPickHitboxes(spheres) {
      if (screenshotHudHidden) {
        pickHitboxes.clear();
        return;
      }
      pickHitboxes.sync(spheres);
    },

    /**
     * Rim-lit absorb bubbles on living units with shieldHp.
     * Same `{ x, y, z, r }` shape as pick hitboxes.
     */
    syncHolyShields(spheres) {
      holyShields.sync(spheres);
    },

    debugHolyShields() {
      return holyShields.debug();
    },

    /**
     * Comically large haul props over villagers' heads.
     * @param {number} count
     * @param {{ x: Float32Array, y: Float32Array, z: Float32Array, yaw?: Float32Array, amt: Int32Array, kind?: Uint8Array, alive?: Uint8Array, skip?: Uint8Array }} opts
     */
    syncCarryLoads(count, opts) {
      carryLoads.sync(count, opts);
    },

    resetCamera() {
      cameraController.reset();
    },

    groundYAt(x, z) {
      return groundYAt(x, z);
    },

    /** Rebuild type-batch mapping when entity count/types change (e.g. staging → live). */
    rebuildFromTypes(count, typesArr, ownersArr) {
      setSelRingCount(count);
      const stillUnmapped = mapEntitySlots(count, typesArr, ownersArr);
      flushAllBatches();
      return stillUnmapped;
    },

    /** Write instance transforms from sim/world positions (avoids origin flash after rebuild). */
    syncInstances(count, typesArr, positions, options = {}) {
      const alive = options.alive;
      const owners = options.owners;
      const carrying = options.carrying;
      const gatherAct = options.gatherAct;
      const hideUnit = options.hideUnit;
      let unmapped = 0;
      for (let i = 0; i < count; i++) {
        const owner = owners ? owners[i] : 0;
        const def = getUnitDef(typesArr[i]);
        if (alive && !alive[i]) {
          writeInstanceAt(i, typesArr[i], owner, 0, 0, 0);
          continue;
        }
        if (hideUnit?.(i, positions.x[i], positions.z[i], owner)) {
          writeInstanceAt(i, typesArr[i], owner, 0, 0, 0);
          continue;
        }
        const act = gatherAct ? (gatherAct[i] | 0) : 0;
        const load = act === GATHER_ACT.HAUL || (!gatherAct && carrying && (carrying[i] | 0) > 0);
        const chop = act === GATHER_ACT.CHOP;
        if (!writeInstanceAt(i, typesArr[i], owner, positions.x[i], positions.z[i], def.size, 0, false, 0, 0, 0, NaN, load, chop)) unmapped++;
      }
      flushAllBatches();
      return unmapped;
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
        applyPartColors(batch);
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

    writeInstance(i, typeId, owner, x, z, diameter, yaw = 0, moving = false, loft = 0, pitch = 0, roll = 0, groundYOverride = NaN, carrying = false, chopping = false, walkRate = 1) {
      return writeInstanceAt(i, typeId, owner, x, z, diameter, yaw, moving, loft, pitch, roll, groundYOverride, carrying, chopping, walkRate);
    },

    /**
     * Authored rider empties for a transport type, once its mesh package is in.
     * Empty until bake includes `spawn_anchor*` — callers fall back to generated seats.
     */
    transportSeats(typeId) {
      const want = typeId | 0;
      for (const [key, batch] of typeBatches) {
        const typeFromKey = Number(String(key).split(/[:#]/)[0]);
        if (typeFromKey !== want) continue;
        const seats = spawnSeatsFromSockets(batch.fxSockets);
        if (seats.length) return seats;
      }
      return [];
    },

    debugBatches(count, typesArr, ownersArr) {
      const unmapped = [];
      const byType = {};
      for (let i = 0; i < count; i++) {
        const type = typesArr[i];
        byType[type] = (byType[type] ?? 0) + 1;
        if (entitySlot[i] < 0) unmapped.push(i);
      }
      const batches = {};
      for (const [key, batch] of typeBatches) {
        batches[key] = {
          entities: batch.entityIds.length,
          capacity: batch.gpuCapacity,
          tiCount: batch.mesh.thinInstances?.count ?? 0,
        };
      }
      if (fallback) {
        batches.fallback = {
          entities: fallback.entityIds.length,
          capacity: fallback.gpuCapacity,
          tiCount: fallback.mesh.thinInstances?.count ?? 0,
        };
      }
      return { count, byType, batches, unmapped };
    },

    commit() {
      flushAllBatches();
    },

    syncProjectiles(prev, cur, alpha) {
      if (!cur) {
        locustFx.clear();
        fireballFx.clear();
        return projectileRenderer.sync(prev, cur, alpha);
      }
      locustFx.beginFrame();
      fireballFx.beginFrame();
      emitFireballGroundSplashes(prev, cur);
      emitHolySlashImpacts(prev, cur);
      const result = projectileRenderer.sync(prev, cur, alpha);
      locustFx.endFrame();
      fireballFx.endFrame();
      return result;
    },

    clearProjectiles() {
      projectileRenderer.clear();
      frogRenderer.clear();
      arrowTrails.clear();
      lightningBolts.clear();
      particles.clear();
      unitAuras.clear();
      monkLobFx.clear();
      sporeBloomFx.clear();
      locustFx.clear();
      fireballFx.clear();
      mushrooms?.clear?.();
      holyShields.clear();
      carryLoads.clear();
      groundFires.clear();
      trailGenerations.fill(0);
      trailLastEmitMs.fill(0);
      fireballSplashSeen.fill(0);
      holySlashSeen.fill(0);
      projectileRenderer.commit();
      frogRenderer.commit();
      arrowTrails.commit();
      lightningBolts.commit();
    },

    emitParticle(init) {
      return particles.emit(init);
    },

    emitParticleBurst(init) {
      return particles.emitBurst(init);
    },

    clearParticles() {
      particles.clear();
    },

    particleStats() {
      return particles.stats();
    },

    /**
     * Live vs allocated for stress / capacity checks.
     * `active` = currently used; `capacity` = reserved buffers.
     */
    poolStats() {
      let unitLive = 0;
      let unitCap = 0;
      const unitBatches = {};
      for (const [key, batch] of typeBatches) {
        const live = batch.entityIds?.length ?? 0;
        const cap = batch.gpuCapacity | 0;
        unitLive += live;
        unitCap += cap;
        unitBatches[key] = { active: live, capacity: cap };
      }
      if (fallback) {
        const live = fallback.entityIds?.length ?? 0;
        const cap = fallback.gpuCapacity | 0;
        unitLive += live;
        unitCap += cap;
        unitBatches.fallback = { active: live, capacity: cap };
      }
      return {
        units: { active: unitLive, capacity: unitCap, batches: unitBatches },
        particles: particles.stats(),
        trails: arrowTrails.stats?.() ?? null,
        frogs: frogRenderer.stats?.() ?? null,
        lightning: lightningBolts.stats?.() ?? null,
        groundFires: { active: groundFires.size },
      };
    },

    /**
     * Selection cursor. With collar.glb: `spinYaw` rotates in place.
     * Fallback disc: `unitSize` is treated as ground diameter (legacy).
     * @param {'white' | 'red' | 'yellow' | 'cyan'} [tint]
     *   white = authored collar bands; red = attack wash; yellow = force-move gray
     * @param {{ kind?: 'default' | 'caster' | 'vehicle' }} [opts]
     */
    writeSelectionRing(i, x, z, unitSize, spinYaw = 0, tint = 'white', opts = {}) {
      // Clear path: no terrain sample — callers only hit this on select→deselect edges.
      if (!(unitSize > 0)) {
        if (useCollar) writeSelectionCollar(ringMatrices, i, 0, 0, 0, 0, 0);
        else writeFlatRing(ringMatrices, i, 0, 0, 0, RING_DIAM, RING_H, 0);
        writeSelRingColorAt(i, tint);
        for (const mesh of selRingParts) markThinInstanceSlotDirty(mesh, i);
        return;
      }
      const gy = groundYAt(x, z);
      if (useCollar) {
        let base = SELECTION_COLLAR_SCALE;
        if (opts.kind === 'vehicle') base = SELECTION_COLLAR_VEHICLE_SCALE;
        else if (opts.kind === 'caster') base = SELECTION_COLLAR_CASTER_SCALE;
        writeSelectionCollar(ringMatrices, i, x, z, base, spinYaw, gy);
      } else {
        let diam = unitSize;
        if (opts.kind === 'vehicle') diam = Math.max(unitSize, 10);
        else if (opts.kind === 'caster') diam = unitSize * 1.5;
        writeFlatRing(ringMatrices, i, x, z, diam, RING_DIAM, RING_H, gy);
      }
      writeSelRingColorAt(i, tint);
      for (const mesh of selRingParts) markThinInstanceSlotDirty(mesh, i);
    },

    /**
     * Feed the bottom-of-screen selection strip. `entries` is one row per
     * distinct selected type: units `{ kind:'unit', typeId, name, count }` or
     * buildings `{ kind:'building', typeKey, name, count }`. Empty/undefined
     * clears the strip.
     */
    setSelectionGroups(entries) {
      selectionHud.setGroups?.(entries ?? []);
    },

    /**
     * Selection-strip chip under a client point →
     * `{ kind:'unit', typeId }` / `{ kind:'building', typeKey }`, or null.
     * Lets input treat the bottom strip as clickable buttons.
     */
    pickSelectionHud(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      return selectionHud.pickSlot?.(cc.x, cc.y) ?? null;
    },

    /** Extra black + white pads (three per side). */
    setExtraControlGroups(on) {
      controlGroupHud.setExtra?.(!!on);
    },

    /**
     * Control-group pad under a client point → group id 0..5, or null.
     * Id 0 is red — callers must use `!= null`, not truthiness.
     */
    pickControlGroupHud(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      const id = controlGroupHud.pick?.(cc.x, cc.y);
      return id == null ? null : id;
    },

    setControlGroupFilled(id, on) {
      controlGroupHud.setFilled?.(id, on);
    },

    setControlGroupCount(id, n) {
      controlGroupHud.setCount?.(id, n);
    },

    setControlGroupHold(id) {
      controlGroupHud.setHold?.(id);
    },

    beginHealthBars() {
      healthBars.begin();
    },

    /** v1-style chips above the unit / building. `lift` is world-Y above ground. */
    writeHealthBar(x, z, lift, ratio, flags) {
      if (screenshotHudHidden) return;
      const gy = groundYAt(x, z);
      const above = Number.isFinite(lift) && lift > 0.05 ? lift : DEFAULT_UNIT_CHIP_LIFT;
      const y = gy + above;
      if (LOD_ENABLED) {
        const eye = cameraEyePos();
        const dx = eye.x - x;
        const dy = eye.y - y;
        const dz = eye.z - z;
        if (dx * dx + dz * dz > FX_DISTANCE_SQ) return;
        if (dx * dx + dy * dy + dz * dz > FX_DISTANCE_SQ) return;
      }
      healthBars.write(x, y, z, lift, ratio, flags);
    },

    buildingChipHeight(typeId) {
      return buildingProps.chipHeight?.(typeId) ?? roofChipLift(0, DEFAULT_BUILDING_ROOF);
    },

    agoraChipHeight() {
      return agoraProps.chipHeight?.() ?? roofChipLift(0, DEFAULT_AGORA_ROOF);
    },

    endHealthBars() {
      healthBars.end();
    },

    /**
     * Start a click-command ping at ground (x, z).
     * Attack-move = red arrow + hot red ring; force-move = gray arrow + cyan ring.
     * Both get a flat radial ring; force-move is wider. Double-tap upgrades
     * without restarting the arrow.
     * @param {'white' | 'red' | 'yellow'} [tint]
     * @param {{ forceMove?: boolean }} [opts]
     */
    pingOrderMarker(x, z, y, tint = 'white', opts = {}) {
      const now = performance.now();
      const gy = Number.isFinite(y) ? y : groundYAt(x, z);
      const mode = tint === 'red' || tint === 'yellow' ? tint : 'white';
      const forceMove = !!opts.forceMove;
      const eye = cameraEyePos();
      const dist = Math.hypot(x - eye.x, gy - eye.y, z - eye.z) || 1;
      const zoom = Math.min(3.5, Math.max(0.8, dist / 200));
      const moveBurst = [0.45, 0.95, 1, 0.95];
      const attackBurst = [1, 0.22, 0.1, 1];
      const attackPulse = [1, 0.18, 0.08, 0.85];

      // Double-tap force-move upgrades the pending attack-move arrow — don't restart.
      const upgrade =
        forceMove &&
        !!orderPing &&
        now - orderPing.started < ORDER_TOTAL_MS;

      if (upgrade) {
        orderPing.x = x;
        orderPing.y = gy;
        orderPing.z = z;
        orderPing.tint = mode;
      } else {
        const spinDir = nextOrderSpinDir;
        nextOrderSpinDir = -nextOrderSpinDir;
        orderPing = { x, y: gy, z, started: now, tint: mode, spinDir };
        const sparkColor = forceMove ? moveBurst : attackBurst;
        particles.emitBurst({
          position: [x, gy + 0.35 * zoom, z],
          color: sparkColor,
          count: 14,
          speed: 8 * zoom,
          verticalSpeed: 6 * zoom,
          gravity: [0, -35 * zoom, 0],
          drag: 2.5,
          lifetime: 0.28,
          startSize: 1.4 * zoom,
          endSize: 0.12 * zoom,
        });
        // Attack-move ground ring — hot red flat wash (force-move gets cyan below).
        if (!forceMove) {
          particles.emitBurst({
            position: [x, gy + 0.18 * zoom, z],
            color: attackBurst,
            count: 20,
            speed: 14 * zoom,
            verticalSpeed: 3.0 * zoom,
            gravity: [0, -40 * zoom, 0],
            drag: 2.0,
            lifetime: 0.38,
            startSize: 1.9 * zoom,
            endSize: 0.06 * zoom,
          });
          // Soft expanding pulse so the ring silhouette reads at a glance.
          particles.emit({
            position: [x, gy + 0.1 * zoom, z],
            velocity: [0, 0.5 * zoom, 0],
            gravity: [0, 0, 0],
            color: attackPulse,
            lifetime: 0.3,
            startSize: 2.2 * zoom,
            endSize: 12 * zoom,
            drag: 0.05,
          });
        }
      }
      if (forceMove) {
        particles.emitBurst({
          position: [x, gy + 0.18 * zoom, z],
          color: moveBurst,
          count: 22,
          speed: 16 * zoom,
          verticalSpeed: 3.5 * zoom,
          gravity: [0, -42 * zoom, 0],
          drag: 2.0,
          lifetime: 0.4,
          startSize: 2.0 * zoom,
          endSize: 0.06 * zoom,
        });
      }
      updateOrderMarker();
    },

    /** @deprecated use pingOrderMarker */
    showOrderMarker(x, z, y, tint) {
      if (x || z) this.pingOrderMarker(x, z, y, tint);
      else {
        orderPing = null;
        hideOrderMarker();
      }
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

    /**
     * GPU mesh pick → sim entity id, or -1.
     * Uses rest-pose geometry for VAT units (instance matrix only).
     * Caller should filter alive / carried / owner.
     * Gated by USE_GPU_PICK — live path is rayPickSpheres*.
     */
    async pickUnit(clientX, clientY) {
      if (!USE_GPU_PICK || !gpuPicker) return -1;
      const cc = canvasCoords(clientX, clientY);
      const info = await safePickAsync(cc.x, cc.y, {
        filter: (mesh) => unitPickMeshes.has(mesh),
      });
      if (!info?.hit || !info.pickedMesh) return -1;
      const batch = unitPickMeshes.get(info.pickedMesh);
      if (!batch) return -1;
      const slot = info.thinInstanceIndex;
      if (slot < 0 || slot >= batch.entityIds.length) return -1;
      const id = batch.entityIds[slot];
      return Number.isInteger(id) && id >= 0 ? id : -1;
    },

    /** Screen → world ray (shared across unit + building picks on one click). */
    clientPickingRay(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      return pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
    },

    /**
     * Nearest sphere hit. `count` defaults to spheres.length.
     * Pass a prebuilt ray to avoid a second unproject on the same click.
     */
    rayPickSpheres(clientX, clientY, spheres, count) {
      const ray = this.clientPickingRay(clientX, clientY);
      if (!ray) return -1;
      return this.rayHitSpheresNearest(ray, spheres, count);
    },

    rayHitSpheresNearest(ray, spheres, count = spheres.length) {
      if (!ray) return -1;
      const n = Math.min(count, spheres.length);
      let best = -1;
      let bestT = Infinity;
      for (let s = 0; s < n; s++) {
        const sp = spheres[s];
        const t = rayHitSphere(ray, sp.x, sp.y, sp.z, sp.r);
        if (t !== null && t < bestT) {
          bestT = t;
          best = sp.id != null ? sp.id : s;
        }
      }
      return best;
    },

    /**
     * Every sphere the ray hits, nearest first — packed-tight units all come back
     * instead of just the closest one, so callers can multi-select the whole clump.
     * Allocating form kept for dumpPickBench; prefer rayHitSpheresAllInto.
     */
    rayPickSpheresAll(clientX, clientY, spheres, count) {
      const ray = this.clientPickingRay(clientX, clientY);
      if (!ray) return [];
      const n = Math.min(count ?? spheres.length, spheres.length);
      const hits = [];
      for (let s = 0; s < n; s++) {
        const sp = spheres[s];
        const t = rayHitSphere(ray, sp.x, sp.y, sp.z, sp.r);
        if (t !== null) hits.push({ id: sp.id != null ? sp.id : s, t });
      }
      hits.sort((a, b) => a.t - b.t);
      return hits.map((h) => h.id);
    },

    /**
     * Zero-alloc multi-hit: writes sorted ids into outIds[0..return).
     * outTs is scratch for sort keys (same length as outIds).
     */
    rayHitSpheresAllInto(ray, spheres, count, outIds, outTs) {
      if (!ray) return 0;
      const sphereN = Math.min(count, spheres.length);
      const outCap = Math.min(outIds.length, outTs.length);
      let hitN = 0;
      for (let s = 0; s < sphereN && hitN < outCap; s++) {
        const sp = spheres[s];
        const t = rayHitSphere(ray, sp.x, sp.y, sp.z, sp.r);
        if (t === null) continue;
        outIds[hitN] = sp.id != null ? sp.id : s;
        outTs[hitN] = t;
        hitN++;
      }
      // Insertion sort — hitN is tiny (overlaps under cursor).
      for (let i = 1; i < hitN; i++) {
        const id = outIds[i];
        const t = outTs[i];
        let j = i - 1;
        while (j >= 0 && outTs[j] > t) {
          outIds[j + 1] = outIds[j];
          outTs[j + 1] = outTs[j];
          j--;
        }
        outIds[j + 1] = id;
        outTs[j + 1] = t;
      }
      return hitN;
    },

    screenToGround(clientX, clientY) {
      const cc = canvasCoords(clientX, clientY);
      const ray = pickingRay(cc.x, cc.y, viewProjection(), cc.width, cc.height);
      if (!ray) return null;
      return fieldSnap ? rayHitTerrain(ray, (x, z) => groundYAt(x, z)) : rayHitGround(ray);
    },

    canvasCoords,

    start() {
      if (engineStarted) return Promise.resolve();
      engineStarted = true;
      return startEngine(engine);
    },
  };
}
