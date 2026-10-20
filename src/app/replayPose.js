// Reverse replay is a forward sim with the pictures kept.
// The worker never steps backward. While a replay plays we keep the last few
// seconds of render poses; negative speeds walk that tape. Past the tape, the
// caller resims from the nearest world checkpoint and records the next window.

import { toFloat } from '../sim/fixed.js';
import { displayPoseSample } from './simSession.js';
import { beginSharedPublish, endSharedPublish } from '../sim/sharedState.js';

/** Sim ticks of smooth reverse kept in memory (10s at 20 Hz). */
export const REPLAY_POSE_KEEP = 20 * 10;

const UNIT_I32 = ['px', 'py', 'faceX', 'faceY', 'hp', 'carriedBy', 'carriedAmt'];
const UNIT_I16 = ['shieldHp', 'frostTicks', 'dotTicks', 'locustStacks', 'mana'];
const UNIT_U8 = ['alive', 'owner', 'type', 'order', 'carriedKind', 'gatherAct'];

/**
 * @param {Int32Array | Int16Array | Uint8Array | Uint16Array | Uint32Array | null | undefined} src
 * @param {new (n: number) => Int32Array | Int16Array | Uint8Array | Uint16Array | Uint32Array} Ctor
 * @param {number} n
 */
function copyPrefix(src, Ctor, n) {
  const out = new Ctor(Math.max(0, n | 0));
  if (!src || out.length <= 0) return out;
  const len = Math.min(out.length, src.length | 0);
  if (len > 0) out.set(src.subarray(0, len));
  return out;
}

/**
 * @param {Int32Array | null | undefined} src
 * @param {number} n
 */
function fixedPrefix(src, n) {
  const out = new Float32Array(Math.max(0, n | 0));
  if (!src) return out;
  const len = Math.min(out.length, src.length | 0);
  for (let i = 0; i < len; i++) out[i] = toFloat(src[i]);
  return out;
}

/**
 * @param {Int32Array | Int16Array | Uint8Array | Uint16Array | Uint32Array | null | undefined} dst
 * @param {Int32Array | Int16Array | Uint8Array | Uint16Array | Uint32Array | null | undefined} src
 */
function blit(dst, src) {
  if (!dst || !src || src.length <= 0) return;
  const n = Math.min(dst.length, src.length);
  dst.set(src.subarray(0, n), 0);
}

/**
 * @param {object} projectiles
 */
function captureProjectiles(projectiles) {
  const h = projectiles?.highWater | 0;
  return {
    highWater: h,
    activeCount: projectiles?.activeCount | 0,
    x: fixedPrefix(projectiles?.px, h),
    z: fixedPrefix(projectiles?.py, h),
    vx: fixedPrefix(projectiles?.vx, h),
    vz: fixedPrefix(projectiles?.vy, h),
    px: copyPrefix(projectiles?.px, Int32Array, h),
    py: copyPrefix(projectiles?.py, Int32Array, h),
    vxRaw: copyPrefix(projectiles?.vx, Int32Array, h),
    vyRaw: copyPrefix(projectiles?.vy, Int32Array, h),
    generation: copyPrefix(projectiles?.generation, Uint32Array, h),
    age: copyPrefix(projectiles?.age, Uint16Array, h),
    lifetime: copyPrefix(projectiles?.lifetime, Uint16Array, h),
    alive: copyPrefix(projectiles?.alive, Uint8Array, h),
    type: copyPrefix(projectiles?.type, Uint8Array, h),
    owner: copyPrefix(projectiles?.owner, Uint8Array, h),
    despawnReason: copyPrefix(projectiles?.despawnReason, Uint8Array, h),
  };
}

/**
 * Copy the live render pose out of the shared sim view.
 * Only the live unit count and projectile high-water are kept.
 * @param {object} views
 * @param {number} tick
 */
export function captureReplayPose(views, tick) {
  const n = views?.header ? (views.header[1] | 0) : (views?.count | 0);
  /** @type {Record<string, any>} */
  const pose = {
    tick: tick | 0,
    count: n,
    x: fixedPrefix(views?.px, n),
    z: fixedPrefix(views?.py, n),
    faceXf: fixedPrefix(views?.faceX, n),
    faceZf: fixedPrefix(views?.faceY, n),
    projectiles: captureProjectiles(views?.projectiles),
  };
  for (const key of UNIT_I32) pose[key] = copyPrefix(views?.[key], Int32Array, n);
  for (const key of UNIT_I16) pose[key] = copyPrefix(views?.[key], Int16Array, n);
  for (const key of UNIT_U8) pose[key] = copyPrefix(views?.[key], Uint8Array, n);
  return pose;
}

/**
 * Write a stored pose back into the shared sim view the renderer already reads.
 * @param {object} views
 * @param {object} pose
 */
export function applyReplayPose(views, pose) {
  if (!views || !pose) return;
  const n = pose.count | 0;
  const bracket = !!(views.header && views.header.buffer instanceof SharedArrayBuffer);
  if (bracket) beginSharedPublish(views);
  try {
    if (views.header) {
      views.header[1] = n;
      views.header[2] = pose.tick | 0;
    }
    for (const key of UNIT_I32) blit(views[key], pose[key]);
    for (const key of UNIT_I16) blit(views[key], pose[key]);
    for (const key of UNIT_U8) blit(views[key], pose[key]);
    const src = pose.projectiles;
    const dst = views.projectiles;
    if (src && dst) {
      const h = src.highWater | 0;
      const prevH = views.header ? (views.header[5] | 0) : h;
      if (dst.alive && prevH > h) dst.alive.fill(0, h, prevH);
      if (views.header) {
        views.header[3] = src.activeCount | 0;
        views.header[5] = h;
      }
      blit(dst.px, src.px);
      blit(dst.py, src.py);
      blit(dst.vx, src.vxRaw);
      blit(dst.vy, src.vyRaw);
      blit(dst.generation, src.generation);
      blit(dst.age, src.age);
      blit(dst.lifetime, src.lifetime);
      blit(dst.alive, src.alive);
      blit(dst.type, src.type);
      blit(dst.owner, src.owner);
      blit(dst.despawnReason, src.despawnReason);
    }
  } finally {
    if (bracket) endSharedPublish(views);
  }
}

function unitSnapshot(pose) {
  if (!pose.unitSnap) {
    pose.unitSnap = {
      tick: pose.tick | 0,
      x: pose.x,
      z: pose.z,
      faceX: pose.faceXf,
      faceZ: pose.faceZf,
    };
  }
  return pose.unitSnap;
}

function projectileSnapshot(pose) {
  if (!pose.projSnap) {
    const src = pose.projectiles ?? {};
    pose.projSnap = {
      tick: pose.tick | 0,
      highWater: src.highWater | 0,
      activeCount: src.activeCount | 0,
      x: src.x,
      z: src.z,
      vx: src.vx,
      vz: src.vz,
      generation: src.generation,
      age: src.age,
      lifetime: src.lifetime,
      alive: src.alive,
      type: src.type,
      owner: src.owner,
      despawnReason: src.despawnReason,
    };
  }
  return pose.projSnap;
}

/**
 * Show `tickF` from the pose tape. The worker clock stays where it is.
 * @param {object} session
 * @param {number} tickF
 * @param {Map<number, object>} poses
 */
export function presentReplayPose(session, tickF, poses) {
  const views = session?.client?.views;
  if (!views || !poses) return false;
  const sample = displayPoseSample(Math.max(0, Number(tickF) || 0));
  const cur = poses.get(sample.tick);
  if (!cur) return false;
  const prevPose = sample.tick > 0 ? (poses.get(sample.tick - 1) ?? cur) : cur;
  applyReplayPose(views, cur);
  session.snapshots?.set(sample.tick, unitSnapshot(cur));
  session.snapshots?.set(Math.max(0, sample.tick - 1), unitSnapshot(prevPose));
  session.projectileSnapshots?.set(sample.tick, projectileSnapshot(cur));
  session.projectileSnapshots?.set(Math.max(0, sample.tick - 1), projectileSnapshot(prevPose));
  session._replayPoseSample = sample;
  session.replayClockTick = Math.max(0, Math.round(Number(tickF) || 0));
  return true;
}

/**
 * Drop poses farthest from `anchor` until `cap` remain.
 * A distance tie drops the later tick, so the tape prefers the past.
 * @param {Map<number, object>} poses
 * @param {number} cap
 * @param {number} anchor
 */
export function trimReplayPoses(poses, cap, anchor) {
  const limit = Math.max(1, cap | 0);
  const center = anchor | 0;
  while (poses.size > limit) {
    let worst = null;
    let worstDist = -1;
    for (const key of poses.keys()) {
      const dist = Math.abs((key | 0) - center);
      if (dist > worstDist || (dist === worstDist && worst != null && key > worst)) {
        worstDist = dist;
        worst = key;
      }
    }
    if (worst == null || worst === center) break;
    poses.delete(worst);
  }
}

/**
 * Newest stored tick at or before `tick`, or -1.
 * @param {Iterable<number>} ticks
 * @param {number} tick
 */
function newestCheckpointAtOrBefore(ticks, tick) {
  const t = tick | 0;
  let best = -1;
  for (const stored of ticks) {
    const s = stored | 0;
    if (s <= t && s > best) best = s;
  }
  return best;
}

/**
 * Where to resim so reverse can show `cursor` when the pose tape does not reach it.
 * `to` is the cursor tick. `from` is the checkpoint to restore (0 rebuilds).
 * Only poses at and after `keepFrom` need to be kept.
 * Returns null when the tape already reaches the cursor. Tick 0 rebuilds in place.
 * @param {number | null} oldestPose
 * @param {number} cursor
 * @param {Iterable<number>} checkpointTicks
 * @param {number} [keep]
 * @returns {{ from: number, to: number, keepFrom: number } | null}
 */
export function replayReverseFill(oldestPose, cursor, checkpointTicks, keep = REPLAY_POSE_KEEP) {
  const want = Math.max(0, Math.floor(Number(cursor) || 0));
  const span = Math.max(1, keep | 0);
  const oldest = oldestPose == null || oldestPose < 0 ? null : (oldestPose | 0);
  if (oldest != null && want >= oldest) return null;
  if (want < 0) return null;
  // Tick 0 is the rebuilt world, not a checkpoint step.
  if (want === 0) return { from: 0, to: 0, keepFrom: 0 };
  const mark = newestCheckpointAtOrBefore(checkpointTicks, want - 1);
  const from = mark > 0 ? mark : 0;
  if (from >= want) return null;
  return {
    from,
    to: want,
    keepFrom: Math.max(from, want - span),
  };
}
