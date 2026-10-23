// Lightweight camera / selection / replay-head sync.
// Players publish at most a few times a second, and only when the view changed.
// Spectators apply one player's view. The camera plays between those samples
// so the picture keeps moving instead of stepping on each packet.
// Replay followers also take tick and speed.

import { sameUserId } from '../lobby/ids.js';

export const VIEW_TYPE = 'view';
export const VIEW_MIN_MS = 250;
export const VIEW_UNIT_CAP = 48;
export const VIEW_BUILDING_CAP = 12;

function quant(n, step) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const q = Math.round(v / step) * step;
  return Math.abs(q) < 1e-6 ? 0 : q;
}

function sameNums(a, b) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if ((left[i] | 0) !== (right[i] | 0)) return false;
  }
  return true;
}

function sameBuildings(a, b) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const x = left[i];
    const y = right[i];
    if ((x?.[0] | 0) !== (y?.[0] | 0) || (x?.[1] | 0) !== (y?.[1] | 0)) return false;
  }
  return true;
}

/**
 * Compact view packet. `seq` lets a dual delivery (mesh + lobby) collapse.
 * @param {{
 *   from?: string,
 *   playerId?: number,
 *   pose?: { x?: number, z?: number, radius?: number, alpha?: number },
 *   units?: number[],
 *   buildings?: { kind?: string, index?: number }[],
 *   replay?: { tick?: number, speed?: number } | null,
 * }} sample
 * @param {number} seq
 */
export function packView(sample, seq) {
  if (!sample?.from) return null;
  const pose = sample.pose ?? {};
  /** @type {Record<string, any>} */
  const msg = {
    type: VIEW_TYPE,
    from: String(sample.from),
    pid: sample.playerId | 0,
    n: seq >>> 0,
    x: quant(pose.x, 0.25),
    z: quant(pose.z, 0.25),
    r: quant(pose.radius, 0.5),
    a: quant(pose.alpha, 0.02),
  };
  const units = sample.units;
  if (units?.length) {
    const u = [];
    for (let i = 0; i < units.length && u.length < VIEW_UNIT_CAP; i++) u.push(units[i] | 0);
    if (u.length) msg.u = u;
  }
  const buildings = sample.buildings;
  if (buildings?.length) {
    const b = [];
    for (let i = 0; i < buildings.length && b.length < VIEW_BUILDING_CAP; i++) {
      const row = buildings[i];
      if (!row || (row.kind !== 'building' && row.kind !== 'agora')) continue;
      b.push([row.kind === 'agora' ? 1 : 0, row.index | 0]);
    }
    if (b.length) msg.b = b;
  }
  if (Number.isFinite(Number(sample.tick))) msg.t = sample.tick | 0;
  if (sample.replay) {
    msg.rt = sample.replay.tick | 0;
    msg.rs = Number(sample.replay.speed) || 0;
  }
  return msg;
}

/** @param {number[][] | null | undefined} packed */
export function unpackBuildings(packed) {
  if (!Array.isArray(packed)) return [];
  const out = [];
  for (let i = 0; i < packed.length && out.length < VIEW_BUILDING_CAP; i++) {
    const row = packed[i];
    if (!Array.isArray(row)) continue;
    out.push({
      kind: (row[0] | 0) === 1 ? 'agora' : 'building',
      index: row[1] | 0,
    });
  }
  return out;
}

/** @param {object | null | undefined} prev @param {object | null | undefined} next */
export function viewChanged(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  if ((prev.pid | 0) !== (next.pid | 0)) return true;
  if (prev.x !== next.x || prev.z !== next.z || prev.r !== next.r || prev.a !== next.a) return true;
  if ((prev.rt ?? null) !== (next.rt ?? null)) return true;
  if ((prev.rs ?? null) !== (next.rs ?? null)) return true;
  return !sameNums(prev.u, next.u) || !sameBuildings(prev.b, next.b);
}

/**
 * Send on the first view and whenever it changes, but never faster than `minMs`.
 */
export function shouldSendView(prev, next, now, lastAt, minMs = VIEW_MIN_MS) {
  if (!next) return false;
  if (!viewChanged(prev, next)) return false;
  if (prev && (now - lastAt) < minMs) return false;
  return true;
}

/** @param {object | null | undefined} msg */
export function isViewBody(msg) {
  return Boolean(msg && msg.type === VIEW_TYPE && msg.from != null && msg.from !== '' && Number.isFinite(Number(msg.pid)));
}

/** Flat view, or a lobby `content` wrapper (object or JSON string). */
export function unwrapView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (isViewBody(raw)) return raw;
  const nested = raw.content;
  if (nested && typeof nested === 'object' && isViewBody(nested)) return nested;
  if (typeof nested === 'string') {
    try {
      const parsed = JSON.parse(nested);
      if (isViewBody(parsed)) return parsed;
    } catch {
      /* not json */
    }
  }
  return null;
}

/**
 * How far ahead a replay head may drift before the follower seeks.
 * Paused scrubs stay tight. Fast playback allows about half a second of tape.
 * @param {number} speed
 */
export function replayFollowSlack(speed) {
  const rate = Math.abs(Number(speed)) || 0;
  if (rate === 0) return 2;
  return Math.max(10, Math.round(rate * 20 * 0.5));
}

/**
 * @param {{ localTick?: number, remoteTick?: number, localSpeed?: number, remoteSpeed?: number, busy?: boolean }} state
 * @returns {{ seek?: number, speed: number } | null}
 */
export function replayFollowPlan({
  localTick = 0,
  remoteTick = 0,
  localSpeed = 0,
  remoteSpeed = 0,
  busy = false,
} = {}) {
  const remote = Number(remoteSpeed) || 0;
  const local = Number(localSpeed) || 0;
  const gap = Math.abs((remoteTick | 0) - (localTick | 0));
  const slack = replayFollowSlack(remote);
  if (busy) {
    if (gap > slack * 2) return { seek: remoteTick | 0, speed: remote };
    return null;
  }
  if (gap > slack) return { seek: remoteTick | 0, speed: remote };
  if (local !== remote) return { speed: remote };
  return null;
}

/** How long a still gap can be before the next move plays across one cadence. */
const GLIDE_HOLD_MS = 450;
/** A keyboard pan stays under this. Farther than this is a camera recall. */
const GLIDE_SNAP_DIST = 360;

function angleDelta(from, to) {
  let d = (Number(to) || 0) - (Number(from) || 0);
  const turn = Math.PI * 2;
  while (d > Math.PI) d -= turn;
  while (d < -Math.PI) d += turn;
  return d;
}

/**
 * Play remote camera samples as a continuous move.
 * Packets land a few times a second. Between them the view travels the
 * segment, so a pan doesn't stop and start on each update.
 */
export function createCameraGlide() {
  /** @type {{ x: number, z: number, r: number, a: number, at: number }[]} */
  let samples = [];
  let delay = VIEW_MIN_MS;

  function read(remote) {
    return {
      x: Number(remote?.x) || 0,
      z: Number(remote?.z) || 0,
      r: Number(remote?.r ?? remote?.radius) || 0,
      a: Number(remote?.a ?? remote?.alpha) || 0,
    };
  }

  function poseOf(sample) {
    return { x: sample.x, z: sample.z, radius: sample.r, alpha: sample.a };
  }

  function reset() {
    samples = [];
    delay = VIEW_MIN_MS;
  }

  /**
   * @param {{ x?: number, z?: number, r?: number, radius?: number, a?: number, alpha?: number }} remote
   * @param {number} now
   * @returns {{ snap: true, pose: { x: number, z: number, radius: number, alpha: number } } | null}
   */
  function push(remote, now) {
    const t = Number(now) || 0;
    const pose = read(remote);
    const last = samples[samples.length - 1];
    if (!last) {
      samples = [{ ...pose, at: t }];
      delay = VIEW_MIN_MS;
      return { snap: true, pose: poseOf(samples[0]) };
    }
    const gap = t - last.at;
    if (gap <= 0) {
      samples[samples.length - 1] = { ...pose, at: last.at };
      return null;
    }
    const dist = Math.hypot(pose.x - last.x, pose.z - last.z);
    if (dist > GLIDE_SNAP_DIST) {
      samples = [{ ...pose, at: t }];
      delay = VIEW_MIN_MS;
      return { snap: true, pose: poseOf(samples[0]) };
    }
    if (gap > GLIDE_HOLD_MS) last.at = t - VIEW_MIN_MS;
    samples.push({ ...pose, at: t });
    if (samples.length > 4) samples.splice(0, samples.length - 4);
    delay = Math.max(1, t - samples[samples.length - 2].at);
    return null;
  }

  /** @param {number} now */
  function step(now) {
    if (!samples.length) return null;
    if (samples.length === 1) return poseOf(samples[0]);
    const playAt = (Number(now) || 0) - delay;
    while (samples.length > 2 && samples[1].at <= playAt) samples.shift();
    const a = samples[0];
    const b = samples[1];
    if (playAt <= a.at) return poseOf(a);
    if (playAt >= b.at) return poseOf(b);
    const u = (playAt - a.at) / Math.max(1, b.at - a.at);
    return {
      x: a.x + (b.x - a.x) * u,
      z: a.z + (b.z - a.z) * u,
      radius: a.r + (b.r - a.r) * u,
      alpha: a.a + angleDelta(a.a, b.a) * u,
    };
  }

  return { push, step, reset };
}

/** Snap a big jump, ease a pan, hold when the pose is already there. */
export function cameraFollowMode(local, remote) {
  if (!local || !remote) return 'snap';
  const dist = Math.hypot((local.x || 0) - (remote.x || 0), (local.z || 0) - (remote.z || 0));
  const dr = Math.abs((local.radius || 0) - (remote.radius || 0));
  let da = Math.abs((local.alpha || 0) - (remote.alpha || 0));
  if (da > Math.PI) da = (Math.PI * 2) - da;
  if (dist < 0.6 && dr < 0.6 && da < 0.04) return 'hold';
  if (dist > 48 || dr > 40) return 'snap';
  return 'ease';
}

/** Seat column: replay viewer, spectator, lockstep stall, ready, or waiting. */
export function rosterStatusLabel(person) {
  if (person?.lagging) return 'lagging';
  if (person?.replay) return 'watching replay';
  if (person?.watching) return 'Watching';
  if (person?.ready) return 'Ready';
  return 'Not ready';
}

/**
 * @param {{
 *   sample: () => object,
 *   send: (msg: object) => void,
 *   shouldPublish?: () => boolean,
 *   localUserId?: () => string | null,
 *   localOwner?: () => number,
 *   lobbyActive?: () => boolean,
 *   roomId?: () => string | null,
 *   applyCamera?: (msg: object) => void,
 *   applySelection?: (msg: object) => void,
 *   applyReplay?: (msg: object) => void,
 *   onTarget?: (target: object | null) => void,
 * }} deps
 */
export function createViewFollow(deps) {
  const glide = createCameraGlide();
  /** @type {{ kind: 'owner', owner: number } | { kind: 'user', userId: string, replay: true } | null} */
  let target = null;
  let lastSent = null;
  let lastSentAt = 0;
  let seq = 1;
  let applying = false;
  let pageHidden = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let hiddenTimer = null;
  /** @type {Map<string, number>} */
  const seenSeq = new Map();

  function emit() {
    deps.onTarget?.(target);
  }

  function clear() {
    glide.reset();
    if (!target) return;
    target = null;
    emit();
  }

  /** @param {number} owner */
  function canFollowOwner(owner) {
    const id = owner | 0;
    if (!Number.isFinite(id)) return null;
    const mine = deps.localOwner?.();
    if (mine != null && mine >= 0 && id === (mine | 0)) return null;
    return id;
  }

  /** @param {number} owner */
  function toggleOwner(owner) {
    const id = canFollowOwner(owner);
    if (id == null) return;
    if (target?.kind === 'owner' && target.owner === id) target = null;
    else target = { kind: 'owner', owner: id };
    glide.reset();
    emit();
  }

  /** Enter follow for this owner. Stays put when that owner is already the target. */
  function followOwner(owner) {
    const id = canFollowOwner(owner);
    if (id == null) return;
    if (target?.kind === 'owner' && target.owner === id) return;
    target = { kind: 'owner', owner: id };
    glide.reset();
    emit();
  }

  /** @param {string} userId */
  function toggleUser(userId) {
    if (userId == null || userId === '') return;
    if (sameUserId(userId, deps.localUserId?.())) return;
    if (target?.kind === 'user' && sameUserId(target.userId, userId)) target = null;
    else target = { kind: 'user', userId: String(userId), replay: true };
    glide.reset();
    emit();
  }

  function publish(now) {
    if (target) return;
    const sending = !deps.shouldPublish || deps.shouldPublish();
    const recording = Boolean(deps.shouldRecord?.());
    if (!sending && !recording) return;
    if (lastSent && (now - lastSentAt) < VIEW_MIN_MS) return;
    const packed = packView(deps.sample?.() ?? {}, seq);
    if (!packed) return;
    if (!viewChanged(lastSent, packed)) {
      lastSentAt = now;
      return;
    }
    lastSent = packed;
    lastSentAt = now;
    seq = (seq + 1) >>> 0 || 1;
    if (recording) deps.record?.(packed);
    if (sending) deps.send?.(packed);
  }

  function accept(msg) {
    if (!target || !msg) return false;
    if (sameUserId(msg.from, deps.localUserId?.())) return false;
    if (msg.roomId) {
      const room = deps.roomId?.() ?? '';
      if (!room || msg.roomId !== room) return false;
    } else if (msg.matchId) {
      const live = deps.kothMatchId?.() ?? '';
      if (!live || msg.matchId !== live || deps.lobbyActive?.()) return false;
    }
    if (target.kind === 'owner' && (msg.pid | 0) !== target.owner) return false;
    if (target.kind === 'user' && !sameUserId(msg.from, target.userId)) return false;
    const key = String(msg.from);
    const n = msg.n >>> 0;
    if (seenSeq.get(key) === n) return false;
    seenSeq.set(key, n);
    return true;
  }

  function receive(raw) {
    const msg = unwrapView(raw);
    if (!accept(msg)) return false;
    applying = true;
    try {
      glide.push(
        { x: msg.x, z: msg.z, r: msg.r, a: msg.a },
        typeof performance !== 'undefined' ? performance.now() : 0,
      );
      deps.applyCamera?.(msg);
      deps.applySelection?.(msg);
      if (msg.rt != null) deps.applyReplay?.(msg);
    } finally {
      applying = false;
    }
    return true;
  }

  /** Smoothed follow pose for this frame, or null when not following or still waiting on a sample. */
  function cameraPose(now) {
    if (!target) return null;
    return glide.step(now);
  }

  function userSteered() {
    if (applying || !target) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    clear();
  }

  /**
   * rAF stops while the tab is hidden, which froze the leader's camera and
   * let the follower's tape run off. A slow timer keeps the head published.
   * Browsers throttle this; it still beats silence.
   * @param {boolean} hidden
   */
  function setPageHidden(hidden) {
    pageHidden = Boolean(hidden);
    if (hiddenTimer != null) {
      clearInterval(hiddenTimer);
      hiddenTimer = null;
    }
    if (!pageHidden) return;
    hiddenTimer = setInterval(() => publish(performance.now()), 1000);
  }

  return {
    toggleOwner,
    followOwner,
    toggleUser,
    clear,
    publish,
    receive,
    cameraPose,
    userSteered,
    setPageHidden,
    isApplying: () => applying,
    isFollowing: () => target != null,
    ownerTarget: () => (target?.kind === 'owner' ? target.owner : null),
    userTarget: () => (target?.kind === 'user' ? target.userId : null),
  };
}
