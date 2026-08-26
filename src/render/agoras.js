// Thin-instanced agora.glb props + flag.glb banners (agora ownership + rally).

import {
  addToScene,
  createCylinder,
  createStandardMaterial,
  flushThinInstances,
  markMaterialUboDirty,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { USE_GPU_PICK } from './pickMode.js';
import { ownerTint } from './ownerTints.js';
import { isTeamColorMaterial, prepareTeamColorMaterial } from './teamColor.js';
import { forEachRallyDash } from './rallyDash.js';

const AGORA_MODEL_URL = '/assets/models/agora.glb';
const FLAG_MODEL_URL = '/assets/models/flag.glb';
/** Staging uses 2; leave headroom for future multi-agora maps. */
const MAX_AGORAS = 8;
const MAX_RALLY_FLAGS = 32;
const MAX_RALLY_LINE_SEGS = 512;
const MAX_GHOST_LINE_SEGS = 256;
const AGORA_SCALE = 1;
/** Rally / ghost flags still scale from eye distance. */
const FLAG_BASE_SCALE = 2.15;
const FLAG_DIST_REF = 110;
const FLAG_SCALE_MIN = 1.35;
const FLAG_SCALE_MAX = 3.4;
/** Fallback if the camera has not published radius limits yet. */
const FLAG_RADIUS_MIN = 40;
/** Dashed rally stroke (world units). */
const RALLY_DASH = 1.55;
const RALLY_GAP = 1.05;
const RALLY_LINE_RADIUS = 0.22;
const RALLY_ARROW_RADIUS = 0.38;
const RALLY_ARROW_LEN = 0.95;
/** Sparse chevrons that race ahead of the dash pattern. */
const RALLY_ARROW_PERIOD = 6.4;
/** Hover above ground samples so segments don't clip into hills. */
const RALLY_LINE_Y = 1.15;
/** World-units per ms — dashes crawl building → flag. */
const RALLY_FLOW_SPEED = 0.0045;
/** Big ants run ahead of the dashed stroke. */
const RALLY_ARROW_FLOW_SPEED = 0.011;

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
  mesh.visible = count > 0;
}

/** Attack-move rally stroke / teamcolor — same red as unit a-move pings. */
const ATTACK_MOVE_TINT = [0.95, 0.22, 0.18];

function writeRallyColor(colors, slot, owner, alpha, attackMove) {
  if (attackMove) {
    const o = slot * 4;
    colors[o] = ATTACK_MOVE_TINT[0];
    colors[o + 1] = ATTACK_MOVE_TINT[1];
    colors[o + 2] = ATTACK_MOVE_TINT[2];
    colors[o + 3] = alpha;
    return;
  }
  writeOwnerColor(colors, slot, owner, alpha);
}

function writeMatrix(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sc = scale;
  matrices[o] = c * sc;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sc;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * sc;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function writeOwnerColor(colors, slot, owner, alpha = 1) {
  const tint = ownerTint(owner);
  const o = slot * 4;
  colors[o] = tint[0];
  colors[o + 1] = tint[1];
  colors[o + 2] = tint[2];
  colors[o + 3] = alpha;
}

function flagScaleForDist(dist) {
  const t = dist / FLAG_DIST_REF;
  return Math.max(FLAG_SCALE_MIN, Math.min(FLAG_SCALE_MAX, FLAG_BASE_SCALE * t));
}

/** Agora ownership flag: min at closest zoom, max at max camera radius. */
function flagScaleForCamera(camera) {
  const r = camera?.radius;
  if (!Number.isFinite(r)) return FLAG_SCALE_MIN;
  const minR = camera.lowerRadiusLimit ?? FLAG_RADIUS_MIN;
  const maxR = camera.upperRadiusLimit ?? r;
  const t = (r - minR) / Math.max(1e-6, maxR - minR);
  return FLAG_SCALE_MIN + Math.max(0, Math.min(1, t)) * (FLAG_SCALE_MAX - FLAG_SCALE_MIN);
}

function cameraEye(camera) {
  const wm = camera?.worldMatrix;
  if (wm && Number.isFinite(wm[12])) {
    return { x: wm[12], y: wm[13], z: wm[14] };
  }
  const p = camera?.position;
  return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0 };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createAgoraProps(engine, scene, groundYAt) {
  /** @type {{ mesh: object, matrices: Float32Array }[]} */
  const layers = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[]} */
  const agoraFlagLayers = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[]} */
  const rallyFlagLayers = [];
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array, isTeamColor: boolean }[]} */
  const ghostFlagLayers = [];
  /** @type {Set<object>} */
  const pickMeshes = new Set();
  let placedCount = 0;
  /** @type {{ x: number, z: number, yaw: number, owner: number }[]} */
  let agoraCache = [];
  /** @type {{ x: number, z: number, points: { x: number, z: number }[], yaw: number, owner: number }[]} */
  let rallyCache = [];
  /** @type {{ x: number, z: number, points: { x: number, z: number }[], yaw: number, owner: number } | null} */
  let rallyGhost = null;
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array } | null} */
  let rallyLine = null;
  /** @type {{ mesh: object, matrices: Float32Array, colors: Float32Array } | null} */
  let ghostLine = null;
  let dashPhase = 0;
  let arrowPhase = 0;
  let lastFlagEyeX = NaN;
  let lastFlagEyeY = NaN;
  let lastFlagEyeZ = NaN;
  let lastFlagRadius = NaN;
  /** @type {object | null} */
  let lastFlagCamera = null;
  /** @type {{ anchorX: number, anchorZ: number } | null} */
  let hubFlagPose = null;
  /** ~3 world-units of eye motion before rally flag scales are rewritten. */
  const FLAG_EYE_MOVE_SQ = 9;
  const FLAG_RADIUS_EPS = 0.35;

  const emptyApi = {
    place() {},
    placeRallyFlags() {},
    setRallyGhost() {},
    setHubFlagPose() {},
    update() {},
    clear() {},
    isPickMesh() {
      return false;
    },
    resolvePick() {
      return null;
    },
    forEachShadowMesh() {},
  };

  try {
    const parts = await loadBakedUnitMeshParts(engine, AGORA_MODEL_URL);
    for (let p = 0; p < parts.length; p++) {
      const mesh = parts[p];
      // GPU pick path kept; CPU ray-vs-sphere is live (see pickMode.js).
      mesh.pickable = USE_GPU_PICK;
      if (isTeamColorMaterial(mesh.material)) prepareTeamColorMaterial(engine, mesh);
      const matrices = new Float32Array(MAX_AGORAS * 16);
      setThinInstances(mesh, matrices, MAX_AGORAS);
      setThinInstanceCount(mesh, 0);
      addToScene(scene, mesh);
      layers.push({ mesh, matrices });
      pickMeshes.add(mesh);
    }
  } catch (err) {
    console.warn('[agoras] agora.glb failed', err);
    return emptyApi;
  }

  async function loadFlagLayers(cap, pickable, into) {
    try {
      const parts = await loadBakedUnitMeshParts(engine, FLAG_MODEL_URL);
      for (let p = 0; p < parts.length; p++) {
        const mesh = parts[p];
        mesh.pickable = pickable;
        if (isTeamColorMaterial(mesh.material)) prepareTeamColorMaterial(engine, mesh);
        const isTeamColor = isTeamColorMaterial(mesh.material);
        const matrices = new Float32Array(cap * 16);
        const colors = new Float32Array(cap * 4);
        colors.fill(1);
        setThinInstances(mesh, matrices, cap);
        setThinInstanceColors(mesh, colors);
        setThinInstanceCount(mesh, 0);
        addToScene(scene, mesh);
        into.push({ mesh, matrices, colors, isTeamColor });
        if (pickable) pickMeshes.add(mesh);
      }
    } catch (err) {
      console.warn('[agoras] flag.glb failed', err);
    }
  }

  await loadFlagLayers(MAX_AGORAS, USE_GPU_PICK, agoraFlagLayers);
  await loadFlagLayers(MAX_RALLY_FLAGS, false, rallyFlagLayers);
  await loadFlagLayers(1, false, ghostFlagLayers);

  function makeLineBatch(cap) {
    const mesh = createCylinder(engine, {
      diameter: 1,
      height: 1,
      tessellation: 6,
    });
    mesh.pickable = false;
    const material = createStandardMaterial();
    material.diffuseColor = [1, 1, 1];
    material.emissiveColor = [0.55, 0.55, 0.55];
    material.ambientColor = [0.25, 0.25, 0.25];
    material.specularColor = [0, 0, 0];
    material.disableLighting = true;
    if ('unlit' in material) material.unlit = true;
    material.alpha = 1;
    material.backFaceCulling = false;
    mesh.material = material;
    markMaterialUboDirty(material);
    const matrices = new Float32Array(cap * 16);
    const colors = new Float32Array(cap * 4);
    colors.fill(1);
    setThinInstances(mesh, matrices, cap);
    setThinInstanceColors(mesh, colors);
    setThinInstanceCount(mesh, 0);
    addToScene(scene, mesh);
    return { mesh, matrices, colors };
  }

  rallyLine = makeLineBatch(MAX_RALLY_LINE_SEGS);
  ghostLine = makeLineBatch(MAX_GHOST_LINE_SEGS);

  function writeFlagBatch(batchLayers, list, eye, scaleFor, hideAt) {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const owner = a.owner | 0;
      const hide =
        hideAt &&
        (a.x - hideAt.anchorX) ** 2 + (a.z - hideAt.anchorZ) ** 2 < 4;
      const yaw = a.yaw != null ? a.yaw : Math.atan2(-a.x, -a.z);
      const x = a.x;
      const z = a.z;
      const y = groundYAt(a.x, a.z);
      const dist = Math.hypot(eye.x - x, eye.y - y, eye.z - z) || FLAG_DIST_REF;
      const scale = hide
        ? 0
        : scaleFor
          ? scaleFor(dist)
          : flagScaleForDist(dist);
      for (const layer of batchLayers) {
        writeMatrix(layer.matrices, i, x, y, z, yaw, scale);
        if (layer.isTeamColor) writeRallyColor(layer.colors, i, owner, 1, a.attackMove);
        else {
          const o = i * 4;
          if (a.attackMove) {
            layer.colors[o] = ATTACK_MOVE_TINT[0];
            layer.colors[o + 1] = ATTACK_MOVE_TINT[1];
            layer.colors[o + 2] = ATTACK_MOVE_TINT[2];
            layer.colors[o + 3] = 1;
          } else {
            layer.colors[o] = 1;
            layer.colors[o + 1] = 1;
            layer.colors[o + 2] = 1;
            layer.colors[o + 3] = 1;
          }
        }
      }
    }
    for (const layer of batchLayers) {
      setThinInstanceCount(layer.mesh, n);
      setThinInstanceColors(layer.mesh, layer.colors);
      flushThinInstances(layer.mesh);
    }
  }

  /** Unit Y-cylinder → world segment A→B (thin-instance matrix). */
  function writeSegmentMatrix(matrices, slot, ax, ay, az, bx, by, bz, radius) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05) {
      const o = slot * 16;
      for (let k = 0; k < 16; k++) matrices[o + k] = 0;
      matrices[o + 15] = 1;
      return false;
    }
    const yx = dx / len;
    const yy = dy / len;
    const yz = dz / len;
    let xx;
    let xy;
    let xz;
    if (Math.abs(yy) < 0.9) {
      xx = -yz;
      xy = 0;
      xz = yx;
    } else {
      xx = 0;
      xy = yz;
      xz = -yy;
    }
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    const sx = radius * 2;
    const sy = len;
    const sz = radius * 2;
    const o = slot * 16;
    matrices[o] = xx * sx;
    matrices[o + 1] = xy * sx;
    matrices[o + 2] = xz * sx;
    matrices[o + 3] = 0;
    matrices[o + 4] = yx * sy;
    matrices[o + 5] = yy * sy;
    matrices[o + 6] = yz * sy;
    matrices[o + 7] = 0;
    matrices[o + 8] = zx * sz;
    matrices[o + 9] = zy * sz;
    matrices[o + 10] = zz * sz;
    matrices[o + 11] = 0;
    matrices[o + 12] = (ax + bx) * 0.5;
    matrices[o + 13] = (ay + by) * 0.5;
    matrices[o + 14] = (az + bz) * 0.5;
    matrices[o + 15] = 1;
    return true;
  }

  function fallbackPoints(entry) {
    return [
      { x: entry.fromX ?? entry.x, z: entry.fromZ ?? entry.z },
      { x: entry.x, z: entry.z },
    ];
  }

  /**
   * Flowing dashed polyline (dashes + arrowheads) along world XZ points.
   * Dashes and chevrons share the polyline but march at different speeds
   * (big ants run ahead) — both crawl building → flag.
   * @returns {number} next free slot
   */
  function writeDashedPath(batch, points, owner, startSlot, maxSlot, phase, ghost, attackMove) {
    if (!batch || !points || points.length < 2) return startSlot;
    const period = RALLY_DASH + RALLY_GAP;
    /** @type {{ ax: number, az: number, ux: number, uz: number, len: number, s0: number }[]} */
    const segs = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const ax = points[i].x;
      const az = points[i].z;
      const bx = points[i + 1].x;
      const bz = points[i + 1].z;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      segs.push({
        ax,
        az,
        ux: (bx - ax) / len,
        uz: (bz - az) / len,
        len,
        s0: total,
      });
      total += len;
    }
    if (segs.length === 0 || total < 0.05) return startSlot;

    let slot = startSlot;
    const baseAlpha = ghost ? 0.7 : 0.95;
    let segI = 0;

    const emit = (s0, s1, radius, pulse) => {
      if (slot >= maxSlot || s1 - s0 < 0.12) return;
      while (segI < segs.length && segs[segI].s0 + segs[segI].len < s0 - 1e-6) segI++;
      for (let i = segI; i < segs.length && slot < maxSlot; i++) {
        const seg = segs[i];
        const lo = Math.max(s0, seg.s0);
        const hi = Math.min(s1, seg.s0 + seg.len);
        if (hi - lo < 0.12) {
          if (seg.s0 >= s1) break;
          continue;
        }
        const t0 = lo - seg.s0;
        const t1 = hi - seg.s0;
        const x0 = seg.ax + seg.ux * t0;
        const z0 = seg.az + seg.uz * t0;
        const x1 = seg.ax + seg.ux * t1;
        const z1 = seg.az + seg.uz * t1;
        const y0 = groundYAt(x0, z0) + RALLY_LINE_Y;
        const y1 = groundYAt(x1, z1) + RALLY_LINE_Y;
        if (!writeSegmentMatrix(batch.matrices, slot, x0, y0, z0, x1, y1, z1, radius)) {
          continue;
        }
        writeRallyColor(batch.colors, slot, owner, baseAlpha * pulse, attackMove);
        if (pulse > 0.95) {
          const o = slot * 4;
          batch.colors[o] = Math.min(1, batch.colors[o] * 1.25);
          batch.colors[o + 1] = Math.min(1, batch.colors[o + 1] * 1.25);
          batch.colors[o + 2] = Math.min(1, batch.colors[o + 2] * 1.25);
        }
        slot++;
      }
    };

    forEachRallyDash(total, phase, RALLY_DASH, period, (a, b) => {
      if (slot >= maxSlot) return;
      emit(a, b, RALLY_LINE_RADIUS, 0.82);
    });
    // Chevrons are a second, faster march — reset the segment cursor.
    segI = 0;
    forEachRallyDash(total, arrowPhase, RALLY_ARROW_LEN, RALLY_ARROW_PERIOD, (a, b) => {
      if (slot >= maxSlot) return;
      emit(a, b, RALLY_ARROW_RADIUS, 1);
    });
    return slot;
  }

  function flushLineBatch(batch, count) {
    setThinInstanceCount(batch.mesh, count);
    setThinInstanceColors(batch.mesh, batch.colors);
    flushThinInstances(batch.mesh);
  }

  function rewriteRallyLines() {
    if (!rallyLine) return;
    let n = 0;
    for (let i = 0; i < rallyCache.length; i++) {
      const r = rallyCache[i];
      const pts =
        r.points?.length >= 2 ? r.points : fallbackPoints(r);
      n = writeDashedPath(
        rallyLine,
        pts,
        r.owner,
        n,
        MAX_RALLY_LINE_SEGS,
        dashPhase,
        false,
        r.attackMove,
      );
    }
    flushLineBatch(rallyLine, n);
  }

  function rewriteGhostLine() {
    if (!ghostLine) return;
    if (!rallyGhost) {
      flushLineBatch(ghostLine, 0);
      return;
    }
    const pts =
      rallyGhost.points?.length >= 2
        ? rallyGhost.points
        : fallbackPoints(rallyGhost);
    const n = writeDashedPath(
      ghostLine,
      pts,
      rallyGhost.owner,
      0,
      MAX_GHOST_LINE_SEGS,
      dashPhase,
      true,
      rallyGhost.attackMove,
    );
    flushLineBatch(ghostLine, n);
  }

  function rewriteFlags(camera) {
    if (camera) lastFlagCamera = camera;
    const cam = camera ?? lastFlagCamera;
    const eye = cameraEye(cam);
    // Force a fresh latch so the next update() doesn't skip after place/rally.
    lastFlagEyeX = eye.x;
    lastFlagEyeY = eye.y;
    lastFlagEyeZ = eye.z;
    if (cam && Number.isFinite(cam.radius)) lastFlagRadius = cam.radius;
    const agoraScale = flagScaleForCamera(cam);
    writeFlagBatch(agoraFlagLayers, agoraCache, eye, () => agoraScale, hubFlagPose);
    writeFlagBatch(rallyFlagLayers, rallyCache, eye);
    if (rallyGhost) {
      writeFlagBatch(ghostFlagLayers, [rallyGhost], eye);
    } else {
      for (const layer of ghostFlagLayers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
      }
    }
  }

  /**
   * @param {{ x: number, z: number, yaw?: number, owner?: number }[]} list
   */
  function place(list) {
    const n = Math.min(MAX_AGORAS, list?.length ?? 0);
    placedCount = n;
    agoraCache = [];
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const x = a.x;
      const z = a.z;
      const y = groundYAt(x, z);
      const yaw = a.yaw != null ? a.yaw : Math.atan2(-x, -z);
      agoraCache.push({ x, z, yaw, owner: a.owner | 0 });
      for (const layer of layers) {
        writeMatrix(layer.matrices, i, x, y, z, yaw, AGORA_SCALE);
      }
    }
    for (const layer of layers) {
      setThinInstanceCount(layer.mesh, n);
      flushThinInstances(layer.mesh);
    }
    rewriteFlags(null);
  }

  /**
   * @param {{ x: number, z: number, fromX?: number, fromZ?: number, points?: { x: number, z: number }[], yaw?: number, owner?: number }[]} list
   */
  function placeRallyFlags(list) {
    const n = Math.min(MAX_RALLY_FLAGS, list?.length ?? 0);
    rallyCache = [];
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const points =
        a.points?.length >= 2
          ? a.points.map((p) => ({ x: p.x, z: p.z }))
          : [
              { x: a.fromX ?? a.x, z: a.fromZ ?? a.z },
              { x: a.x, z: a.z },
            ];
      rallyCache.push({
        x: a.x,
        z: a.z,
        points,
        yaw: a.yaw != null ? a.yaw : 0,
        owner: a.owner | 0,
        attackMove: !!a.attackMove,
      });
    }
    rewriteRallyLines();
    rewriteFlags(null);
  }

  /** @param {{ x: number, z: number, fromX?: number, fromZ?: number, points?: { x: number, z: number }[], owner?: number } | null} pos */
  function setRallyGhost(pos) {
    if (!pos) {
      rallyGhost = null;
    } else {
      const points =
        pos.points?.length >= 2
          ? pos.points.map((p) => ({ x: p.x, z: p.z }))
          : [
              { x: pos.fromX ?? pos.x, z: pos.fromZ ?? pos.z },
              { x: pos.x, z: pos.z },
            ];
      rallyGhost = {
        x: pos.x,
        z: pos.z,
        points,
        yaw: 0,
        owner: pos.owner | 0,
      };
    }
    rewriteGhostLine();
    rewriteFlags(null);
  }

  /**
   * Hide the world standard at this agora while the radial draws its HUD copy.
   * @param {{ anchorX: number, anchorZ: number } | null | undefined} pose
   */
  function setHubFlagPose(pose) {
    const next =
      pose &&
      Number.isFinite(pose.anchorX) &&
      Number.isFinite(pose.anchorZ)
        ? pose
        : null;
    if (!hubFlagPose && !next) return;
    hubFlagPose = next;
    rewriteFlags(null);
  }

  function update(camera) {
    const showLines = rallyCache.length > 0 || rallyGhost;
    if (!agoraCache.length && !showLines) return;
    if (showLines) {
      const now = performance.now();
      dashPhase = now * RALLY_FLOW_SPEED;
      arrowPhase = now * RALLY_ARROW_FLOW_SPEED;
      rewriteRallyLines();
      rewriteGhostLine();
    }
    // Agora flags track camera radius; rally flags still track eye distance.
    // place/rally calls rewriteFlags(null), which resets the latch.
    const eye = cameraEye(camera);
    const movedSq =
      (eye.x - lastFlagEyeX) ** 2 +
      (eye.y - lastFlagEyeY) ** 2 +
      (eye.z - lastFlagEyeZ) ** 2;
    const r = camera?.radius;
    const zoomed =
      Number.isFinite(r) &&
      (!Number.isFinite(lastFlagRadius) || Math.abs(r - lastFlagRadius) >= FLAG_RADIUS_EPS);
    if (
      hubFlagPose ||
      !Number.isFinite(lastFlagEyeX) ||
      movedSq >= FLAG_EYE_MOVE_SQ ||
      zoomed
    ) {
      rewriteFlags(camera);
    }
  }

  function clear() {
    place([]);
    placeRallyFlags([]);
    setRallyGhost(null);
  }

  function isPickMesh(mesh) {
    return pickMeshes.has(mesh);
  }

  /**
   * @param {object} mesh
   * @param {number} thinInstanceIndex
   * @returns {{ kind: 'agora', index: number } | null}
   */
  function resolvePick(mesh, thinInstanceIndex) {
    if (!pickMeshes.has(mesh)) return null;
    if (thinInstanceIndex < 0 || thinInstanceIndex >= placedCount) return null;
    return { kind: 'agora', index: thinInstanceIndex };
  }

  /** Placed agora body meshes (not flags / rally lines / ghosts). */
  function forEachShadowMesh(fn) {
    if (placedCount <= 0) return;
    for (const layer of layers) {
      if (layer.mesh) fn(layer.mesh);
    }
  }

  function refreshTeamColors() {
    rewriteFlags(null);
  }

  return {
    place,
    refreshTeamColors,
    placeRallyFlags,
    setRallyGhost,
    setHubFlagPose,
    update,
    clear,
    isPickMesh,
    resolvePick,
    forEachShadowMesh,
  };
}
