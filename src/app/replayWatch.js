import { collectFramesForTick } from '../sim/commandFrame.js';
import { TICK_HZ, TICK_MS, displayPoseSample, matchSecondsFromTick } from './simSession.js';
import { replayCatchUpInto, groupFramesByTick } from './catchup.js';
import {
  buildReplayFile,
  liveConfigFromReplay,
  parseReplayFile,
  pickReplayText,
  replayChecksumExpect,
  replayEndTick,
  REPLAY_SIM_MISMATCH,
} from './replay.js';
import {
  REPLAY_POSE_KEEP,
  captureReplayPose,
  presentReplayPose,
  replayReverseFill,
  trimReplayPoses,
} from './replayPose.js';
import { replayCamPose } from './replayCam.js';
import { replayFollowPlan } from './viewFollow.js';

export { REPLAY_POSE_KEEP };

/** 0 pauses. 1 is normal play. Every other stop plays at that rate. */
export const REPLAY_SPEEDS = [-32, -16, -8, -4, -2, -1, -0.5, -0.25, -0.125, 0, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** @param {number} current */
export function nextReplaySpeed(current) {
  const i = REPLAY_SPEEDS.indexOf(current);
  return REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length] ?? 1;
}

/** @param {number} speed */
export function replaySpeedIndex(speed) {
  const i = REPLAY_SPEEDS.indexOf(speed);
  return i < 0 ? REPLAY_SPEEDS.indexOf(1) : i;
}

/** 0–1 position of one speed stop on the slider. */
export function replaySpeedStopRatio(speed, speeds = REPLAY_SPEEDS) {
  const max = Math.max(1, speeds.length - 1);
  const i = speeds.indexOf(speed);
  return i < 0 ? 0 : i / max;
}

/**
 * 0–1 position of the forward/reverse boundary on the speed slider.
 * An explicit 0 stop is that stop. Otherwise the mark sits halfway between
 * the last negative speed and the first positive one.
 * @param {number[]} [speeds]
 */
export function replaySpeedZeroRatio(speeds = REPLAY_SPEEDS) {
  const max = Math.max(1, speeds.length - 1);
  const zero = speeds.indexOf(0);
  if (zero >= 0) return zero / max;
  let lastNeg = -1;
  for (let i = 0; i < speeds.length; i++) {
    if (speeds[i] < 0) lastNeg = i;
    else break;
  }
  if (lastNeg < 0 || lastNeg >= max) return 0.5;
  return (lastNeg + 0.5) / max;
}

/** One step slower or faster. Stays put at either end. */
export function stepReplaySpeed(current, dir) {
  const i = replaySpeedIndex(current);
  const next = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, i + (dir < 0 ? -1 : 1)));
  return REPLAY_SPEEDS[next] ?? 1;
}

/**
 * Ticks to commit before yielding. Slow speeds through 2× stay one tick so the clock stays smooth.
 * Faster settings batch, otherwise each worker round-trip caps the rate near 8×.
 * @param {number} speed
 */
export function replayBatchSize(speed) {
  const s = Math.abs(Number(speed));
  if (!Number.isFinite(s) || s <= 2) return 1;
  return Math.min(80, Math.max(1, Math.round(s)));
}

/** Wall ms the render blend should spend on one sim tick at this playback speed. */
export function replayDisplayBlendMs(speed, tickMs = TICK_MS) {
  const s = Math.abs(Number(speed));
  const rate = Number.isFinite(s) && s > 0 ? s : 1;
  return tickMs / rate;
}

/** @param {number} speed */
export function formatReplaySpeed(speed) {
  const neg = Number(speed) < 0;
  const mag = Math.abs(Number(speed));
  let label;
  if (mag === 0.125) label = '⅛×';
  else if (mag === 0.25) label = '¼×';
  else if (mag === 0.5) label = '½×';
  else label = `${mag}×`;
  return neg ? `−${label}` : label;
}

/** How often a watched replay stores a world checkpoint, in sim ticks (10s). */
export const REPLAY_CHECKPOINT_GAP = TICK_HZ * 10;

/** Keep enough marks to cover a long match without holding every export. */
const REPLAY_CHECKPOINT_CAP = 48;

/**
 * True when `tick` is at least one gap past the newest stored mark.
 * @param {Iterable<number>} haveTicks
 * @param {number} tick
 * @param {number} [gap]
 */
export function replayCheckpointDue(haveTicks, tick, gap = REPLAY_CHECKPOINT_GAP) {
  const t = tick | 0;
  if (t <= 0) return false;
  let latest = 0;
  for (const stored of haveTicks) {
    const s = stored | 0;
    if (s <= t && s > latest) latest = s;
  }
  return t - latest >= gap;
}

/**
 * Newest stored tick at or before `tick`, or -1.
 * @param {Iterable<number>} haveTicks
 * @param {number} tick
 */
export function nearestReplayCheckpointTick(haveTicks, tick) {
  const t = tick | 0;
  let best = -1;
  for (const stored of haveTicks) {
    const s = stored | 0;
    if (s <= t && s > best) best = s;
  }
  return best;
}
export function replayPlayShouldRewind(tick, endTick) {
  return (tick | 0) >= Math.max(0, (endTick | 0) - 1);
}

/** How far the skip buttons jump. */
export const REPLAY_SKIP_SEC = 10;

/**
 * Tick after a skip. `dir` < 0 steps backward and clamps to the tape.
 * @param {number} tick
 * @param {number} endTick
 * @param {number} dir
 * @param {number} [tickHz]
 */
export function replaySkipTarget(tick, endTick, dir, tickHz = TICK_HZ) {
  const end = Math.max(0, endTick | 0);
  const step = REPLAY_SKIP_SEC * Math.max(1, tickHz | 0);
  const delta = dir < 0 ? -step : step;
  return Math.max(0, Math.min(end, (tick | 0) + delta));
}

/** Minutes and seconds. Minutes stay on the clock under a minute (`0:05`). */
export function formatReplayClock(tick) {
  const s = Math.max(0, Math.floor(matchSecondsFromTick(tick | 0)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 0–1 position of a tick on the tape. */
export function replayScrubRatio(tick, endTick) {
  const end = Math.max(0, endTick | 0);
  if (end <= 0) return 0;
  return Math.max(0, Math.min(1, (tick | 0) / end));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function replayBlockedReason(ctx) {
  if (ctx?.matchLobby?.isActive?.()) return 'Leave or finish the match first';
  const presence = ctx?.kothShard?.getLobbyPresence?.();
  if (presence && presence.browsing === false) return 'Leave the match first';
  return null;
}

/**
 * Bottom-left VOD: jump, skip, play, scrub, speed, plus menu open and post-match Watch.
 * @param {{
 *   getCtx: () => object | null,
 *   applyLiveConfig: (ctx: object, cfg: object, shard: object | null) => Promise<void>,
 *   loadGarden: (url: string) => Promise<object>,
 *   setStatus: (text: string) => void,
 *   parkLobby: () => void,
 *   getKothShard: () => object | null,
 * }} deps
 */
export function createReplayController(deps) {
  const state = {
    file: null,
    garden: null,
    playing: false,
    /** True while playLoop is in its startup await, before `playing` flips on. */
    playPending: false,
    speedSerial: 0,
    speed: 0,
    gen: 0,
    busy: false,
    scrubbing: false,
    barDismissed: false,
    /** User closed the bar to return to the victory or loss card. */
    closedToResult: false,
    bound: false,
    /** Tick the in-flight seek is rebuilding toward. */
    seekTarget: null,
    /** Latest skip/scrub asked for while a seek is already running. */
    pendingSeek: null,
    /** Stop the in-flight catch-up on the tick it has reached. */
    abortSeek: false,
    /** Playback was running when this seek chain started. */
    resumeAfterSeek: false,
    /** @type {Map<number, object>} */
    checkpoints: new Map(),
    /** @type {Map<number, object>} Render poses for reverse playback, keyed by sim tick. */
    poses: new Map(),
    /** Last replay-bar state announced to the lobby. */
    replayListed: false,
    /** Continuous reverse playhead. Null while the worker clock is what we show. */
    poseCursor: null,
    /** Pointer is down on the speed slider. Paint must not write the thumb. */
    speedDragging: false,
    /** Restarts after a pass died with a non-zero speed still selected. */
    playRetries: 0,
  };

  function els() {
    return {
      bar: document.getElementById('replay-watch'),
      start: document.getElementById('replay-start'),
      rew: document.getElementById('replay-rew'),
      play: document.getElementById('replay-play'),
      fwd: document.getElementById('replay-fwd'),
      endBtn: document.getElementById('replay-end'),
      scrub: /** @type {HTMLInputElement | null} */ (document.getElementById('replay-scrub')),
      ghost: document.getElementById('replay-ghost'),
      clock: document.getElementById('replay-clock'),
      speed: document.getElementById('replay-speed'),
      speedSlider: /** @type {HTMLInputElement | null} */ (document.getElementById('replay-speed-slider')),
      speedZero: document.getElementById('replay-speed-zero'),
      speedOne: document.getElementById('replay-speed-one'),
      close: document.getElementById('replay-close'),
      watch: document.getElementById('match-replay-watch'),
    };
  }

  function failStatus(err, fallback) {
    const message = String(err?.message || err || '');
    if (/checksum mismatch/i.test(message)) return REPLAY_SIM_MISMATCH;
    return fallback;
  }

  function endTick() {
    return replayEndTick(state.file);
  }

  function shownTick() {
    if (state.poseCursor != null && !state.abortSeek && state.pendingSeek == null) {
      return Math.max(0, Math.round(state.poseCursor));
    }
    if (state.abortSeek) return deps.getCtx()?.session?.confirmedTick | 0;
    if (state.pendingSeek != null) return state.pendingSeek;
    if (state.seekTarget != null) return state.seekTarget;
    return deps.getCtx()?.session?.confirmedTick | 0;
  }

  function syncReplayAnnounce() {
    const open = Boolean(state.file) && !state.barDismissed;
    if (open === state.replayListed) return;
    state.replayListed = open;
    deps.onReplayWatch?.(open);
  }

  function paint() {
    const { bar, start, rew, play, fwd, endBtn, scrub, ghost, clock, speed, speedSlider, speedZero, speedOne, close, watch } = els();
    const end = endTick();
    const tick = shownTick();
    const live = deps.getCtx()?.session?.confirmedTick | 0;
    const armed = Boolean(state.file);
    if (watch) watch.hidden = !armed;
    if (!bar) {
      syncReplayAnnounce();
      return;
    }
    bar.hidden = !armed || state.barDismissed;
    if (start) start.disabled = !armed || tick <= 0;
    if (rew) rew.disabled = !armed || tick <= 0;
    if (play) {
      const paused = state.speed === 0;
      play.disabled = !armed;
      play.textContent = paused ? '\u25B6' : '\u23F8';
      const playLabel = paused ? 'Play' : 'Pause';
      play.title = playLabel;
      play.setAttribute('aria-label', playLabel);
    }
    if (fwd) fwd.disabled = !armed || tick >= end;
    if (endBtn) endBtn.disabled = !armed || tick >= end;
    if (speed) speed.textContent = formatReplaySpeed(state.speed);
    if (speedSlider) {
      speedSlider.max = String(REPLAY_SPEEDS.length - 1);
      if (!state.speedDragging) speedSlider.value = String(replaySpeedIndex(state.speed));
      speedSlider.disabled = !armed;
      const title = state.speed === 0 ? '0× pause' : state.speed === 1 ? '1× play' : formatReplaySpeed(state.speed);
      speedSlider.title = title;
      speedSlider.setAttribute('aria-valuetext', title);
    }
    const zeroAt = replaySpeedStopRatio(0);
    const oneAt = replaySpeedStopRatio(1);
    if (speedZero) {
      speedZero.style.setProperty('--replay-speed-at', String(zeroAt));
      speedZero.classList.toggle('is-active', state.speed === 0);
    }
    if (speedOne) {
      speedOne.style.setProperty('--replay-speed-at', String(oneAt));
      speedOne.classList.toggle('is-active', state.speed === 1);
    }
    if (close) close.disabled = !armed;
    if (clock) clock.textContent = `${formatReplayClock(tick)} / ${formatReplayClock(end)}`;
    if (scrub && !state.scrubbing) {
      scrub.max = String(Math.max(0, end));
      scrub.value = String(Math.max(0, Math.min(end, tick)));
      scrub.disabled = !armed;
    }
    if (ghost) {
      const catching = state.busy && live !== tick;
      ghost.hidden = !catching;
      if (catching) ghost.style.setProperty('--replay-ghost', String(replayScrubRatio(live, end)));
    }
    syncReplayAnnounce();
  }

  function pausePlayback() {
    state.playing = false;
    state.resumeAfterSeek = false;
    state.speed = 0;
    const session = deps.getCtx()?.session;
    if (session) {
      session.pauseLockstep = true;
      session.simAcc = 0;
    }
    paint();
  }

  function hide() {
    state.gen += 1;
    state.playing = false;
    state.file = null;
    state.garden = null;
    state.busy = false;
    state.scrubbing = false;
    state.barDismissed = false;
    state.closedToResult = false;
    state.seekTarget = null;
    state.pendingSeek = null;
    state.abortSeek = false;
    state.resumeAfterSeek = false;
    state.playPending = false;
    state.speed = 0;
    state.checkpoints.clear();
    state.poses.clear();
    state.poseCursor = null;
    const ctx = deps.getCtx();
    if (ctx?.session) {
      ctx.session.watchingReplay = false;
      ctx.session._replayPoseSample = null;
      ctx.session.replayPoseHold = false;
      ctx.session.replayClockTick = null;
    }
    const { bar, watch } = els();
    if (bar) bar.hidden = true;
    if (watch) watch.hidden = true;
    syncReplayAnnounce();
  }

  async function loadGardenFor(file) {
    if (state.garden) return state.garden;
    if (file?.garden && typeof file.garden === 'object') {
      state.garden = file.garden;
      return file.garden;
    }
    const url = file?.config?.gardenUrl;
    if (!url) return null;
    const garden = await deps.loadGarden(url);
    state.garden = garden;
    return garden;
  }

  function rememberCheckpoint(tick, checkpoint) {
    const stored = tick | 0;
    if (stored <= 0 || !checkpoint) return;
    state.checkpoints.set(stored, checkpoint);
    while (state.checkpoints.size > REPLAY_CHECKPOINT_CAP) {
      let oldest = stored;
      for (const key of state.checkpoints.keys()) {
        if (key < oldest) oldest = key;
      }
      if (oldest === stored) break;
      state.checkpoints.delete(oldest);
    }
  }

  async function maybeCheckpoint(session, tick) {
    if (!session || !replayCheckpointDue(state.checkpoints.keys(), tick)) return;
    const msg = await session.client.exportCheckpointAsync();
    rememberCheckpoint(msg.tick | 0, msg.checkpoint);
  }

  function catchupOptions(fromTick, shouldContinue, onTick) {
    return {
      stayPaused: true,
      fromTick,
      ticksPerFrame: 80,
      shouldContinue,
      onTick,
      onBatch: (tick) => maybeCheckpoint(deps.getCtx()?.session, tick),
    };
  }

  function rememberPose(session, tick) {
    const t = tick | 0;
    const views = session?.client?.views;
    if (!views || state.poses.has(t)) return;
    state.poses.set(t, captureReplayPose(views, t));
    const anchor = state.poseCursor != null ? Math.round(state.poseCursor) : t;
    trimReplayPoses(state.poses, REPLAY_POSE_KEEP + 1, anchor);
  }

  function poseRecordFrom(targetTick) {
    const keepFrom = Math.max(0, (targetTick | 0) - REPLAY_POSE_KEEP);
    return (tick) => {
      if ((tick | 0) >= keepFrom) rememberPose(deps.getCtx()?.session, tick);
    };
  }

  function oldestPoseTick() {
    let best = -1;
    for (const tick of state.poses.keys()) {
      if (best < 0 || tick < best) best = tick;
    }
    return best;
  }

  function poseCovers(tickF) {
    const sample = displayPoseSample(Math.max(0, Number(tickF) || 0));
    if (!state.poses.has(sample.tick)) return false;
    if (sample.alpha >= 1 || sample.tick <= 0) return true;
    return state.poses.has(sample.tick - 1);
  }

  async function resumeFromCheckpoint(ctx, file, checkpoint, want, shouldContinue, onTick) {
    const imported = await ctx.session.importCheckpoint(checkpoint, checkpoint.checksum);
    const from = imported.tick | 0;
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = true;
    ctx.session.simAcc = 0;
    ctx.inputApi?.setRole?.('spectator');
    onTick?.(from);
    if (from < want && shouldContinue()) {
      await replayCatchUpInto(
        ctx.session,
        liveConfigFromReplay(file, { garden: state.garden, skipSplash: true }),
        file.frames,
        want,
        replayChecksumExpect(file, want),
        catchupOptions(from, shouldContinue, onTick),
      );
    }
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = true;
  }

  async function rebuildToTick(ctx, targetTick, { skipSplash, shouldContinue, onTick }) {
    const file = state.file;
    if (!file) return;
    const garden = await loadGardenFor(file);
    const cfg = liveConfigFromReplay(file, {
      garden,
      skipSplash,
      loadingLabel: skipSplash ? '' : 'Loading replay…',
    });
    ctx.session.watchingReplay = true;
    ctx.localSoloHold = true;
    await deps.applyLiveConfig(ctx, cfg, deps.getKothShard?.() ?? ctx.kothShard ?? null);
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = true;
    ctx.session.simAcc = 0;
    ctx.inputApi?.setRole?.('spectator');
    onTick?.(ctx.session.confirmedTick | 0);
    const want = Math.max(0, targetTick | 0);
    if (want > 0) {
      await replayCatchUpInto(
        ctx.session,
        cfg,
        file.frames,
        want,
        replayChecksumExpect(file, want),
        catchupOptions(0, shouldContinue, onTick),
      );
      ctx.session.watchingReplay = true;
      ctx.session.pauseLockstep = true;
    }
  }

  async function moveSimTo(ctx, file, want, shouldContinue, onTick) {
    const cur = ctx.session.confirmedTick | 0;
    const target = Math.max(0, Math.min(endTick(), want | 0));
    if (target === cur) {
      onTick?.(target);
      return;
    }
    if (target < cur) {
      const mark = nearestReplayCheckpointTick(state.checkpoints.keys(), target);
      const checkpoint = mark > 0 ? state.checkpoints.get(mark) : null;
      if (checkpoint) await resumeFromCheckpoint(ctx, file, checkpoint, target, shouldContinue, onTick);
      else await rebuildToTick(ctx, target, { skipSplash: true, shouldContinue, onTick });
    } else {
      await replayCatchUpInto(
        ctx.session,
        liveConfigFromReplay(file, { garden: state.garden, skipSplash: true }),
        file.frames,
        target,
        replayChecksumExpect(file, target),
        catchupOptions(cur, shouldContinue, onTick),
      );
      ctx.session.watchingReplay = true;
      ctx.session.pauseLockstep = true;
    }
  }

  async function ensureSimAt(want) {
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file) return false;
    const target = Math.max(0, Math.min(endTick(), want | 0));
    if ((ctx.session.confirmedTick | 0) === target) return true;
    const gen = state.gen;
    state.busy = true;
    state.seekTarget = target;
    paint();
    const shouldContinue = () => state.gen === gen && state.pendingSeek == null && !state.abortSeek;
    try {
      await moveSimTo(ctx, file, target, shouldContinue, poseRecordFrom(target));
      return state.gen === gen && !state.abortSeek && state.pendingSeek == null
        && (ctx.session.confirmedTick | 0) === target;
    } catch (err) {
      if (state.gen === gen) {
        console.error('[replay] sync failed', err);
        deps.setStatus(failStatus(err, 'Replay seek failed'));
      }
      return false;
    } finally {
      if (state.gen === gen) {
        state.busy = false;
        state.seekTarget = null;
        ctx.session.watchingReplay = !state.closedToResult;
        ctx.session.pauseLockstep = true;
        paint();
      }
    }
  }

  function anchorTick() {
    if (state.pendingSeek != null) return state.pendingSeek;
    if (state.seekTarget != null) return state.seekTarget;
    return deps.getCtx()?.session?.confirmedTick | 0;
  }

  function skip(dir) {
    if (!state.file || !deps.getCtx()?.session) return;
    deps.parkLobby?.();
    state.barDismissed = false;
    seekTo(replaySkipTarget(anchorTick(), endTick(), dir));
  }

  function jumpTo(tick) {
    if (!state.file || !deps.getCtx()?.session) return;
    deps.parkLobby?.();
    state.barDismissed = false;
    seekTo(tick);
  }

  async function seekTo(targetTick) {
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file) return false;
    const end = endTick();
    const want = Math.max(0, Math.min(end, targetTick | 0));
    if (state.busy) {
      state.pendingSeek = want === state.seekTarget ? null : want;
      paint();
      return true;
    }
    const cur = ctx.session.confirmedTick | 0;
    if (want === cur) return true;
    const resume = state.playing || state.resumeAfterSeek;
    const gen = ++state.gen;
    state.playing = false;
    state.busy = true;
    state.seekTarget = want;
    state.pendingSeek = null;
    state.abortSeek = false;
    state.resumeAfterSeek = resume;
    state.poseCursor = null;
    ctx.session._replayPoseSample = null;
    ctx.session.replayPoseHold = false;
    ctx.session.replayClockTick = null;
    paint();
    const shouldContinue = () => state.gen === gen && state.pendingSeek == null && !state.abortSeek;
    let aborted = false;
    try {
      await moveSimTo(ctx, file, want, shouldContinue, poseRecordFrom(want));
    } catch (err) {
      console.error('[replay] seek failed', err);
      deps.setStatus(failStatus(err, 'Replay seek failed'));
    } finally {
      if (gen === state.gen) {
        aborted = state.abortSeek;
        state.busy = false;
        state.seekTarget = null;
        state.abortSeek = false;
        const pending = aborted ? null : state.pendingSeek;
        state.pendingSeek = null;
        const landed = ctx.session.confirmedTick | 0;
        if (!aborted && pending != null && pending !== landed && state.file) {
          seekTo(pending);
          return false;
        }
        if (aborted) state.resumeAfterSeek = false;
        paint();
        if (!aborted && state.resumeAfterSeek && state.file) {
          state.resumeAfterSeek = false;
          playLoop();
        }
      } else {
        aborted = true;
      }
    }
    return !aborted;
  }

  function nextPaint() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }

  async function fillBackward(cursor, gen) {
    const session = deps.getCtx()?.session;
    if (!session || !state.file) return false;
    let guard = 0;
    while (!poseCovers(cursor)) {
      if (guard++ > 64) return false;
      if (state.gen !== gen || state.abortSeek || state.speed >= 0 || state.pendingSeek != null) {
        return false;
      }
      const oldest = oldestPoseTick();
      const plan = replayReverseFill(
        oldest < 0 ? null : oldest,
        cursor,
        state.checkpoints.keys(),
        REPLAY_POSE_KEEP,
      );
      if (!plan) return poseCovers(cursor);
      const ctx = deps.getCtx();
      state.busy = true;
      state.seekTarget = plan.to;
      paint();
      const shouldContinue = () => (
        state.gen === gen
        && !state.abortSeek
        && state.pendingSeek == null
        && state.speed < 0
      );
      const record = (tick) => {
        if ((tick | 0) >= plan.keepFrom) rememberPose(session, tick);
      };
      try {
        const checkpoint = plan.from > 0 ? state.checkpoints.get(plan.from) : null;
        if (checkpoint) await resumeFromCheckpoint(ctx, state.file, checkpoint, plan.to, shouldContinue, record);
        else await rebuildToTick(ctx, plan.to, { skipSplash: true, shouldContinue, onTick: record });
      } catch (err) {
        console.error('[replay] reverse fill failed', err);
        deps.setStatus(failStatus(err, 'Replay reverse failed'));
        return false;
      } finally {
        if (state.gen === gen) {
          state.busy = false;
          state.seekTarget = null;
          session.watchingReplay = true;
          session.pauseLockstep = true;
          paint();
        }
      }
      if (!shouldContinue()) return false;
      if (oldestPoseTick() === oldest) return poseCovers(cursor);
    }
    return true;
  }

  async function syncPoseCursor(session) {
    if (state.poseCursor == null) return true;
    const want = Math.max(0, Math.round(state.poseCursor));
    state.poseCursor = null;
    session._replayPoseSample = null;
    session.replayClockTick = null;
    session.replayPoseHold = true;
    const ok = await ensureSimAt(want);
    session.replayPoseHold = false;
    return ok;
  }

  /** @returns {Promise<boolean>} true when playback should continue in the other direction */
  async function forwardPass(gen) {
    const ctx = deps.getCtx();
    const session = ctx?.session;
    const file = state.file;
    if (!session || !file) return false;
    if (!(await syncPoseCursor(session))) {
      if (state.gen === gen && state.speed < 0 && state.pendingSeek == null && !state.abortSeek) return true;
      return false;
    }
    if (state.gen !== gen || state.pendingSeek != null || state.abortSeek) return false;
    if (state.speed < 0) return true;
    if (state.speed === 0 || !state.playing) return false;
    session.replayPoseHold = false;
    session._replayPoseSample = null;
    session.replayClockTick = null;
    session.watchingReplay = true;
    session.pauseLockstep = false;
    session.simAcc = 0;
    session._displayBlendMs = replayDisplayBlendMs(state.speed);
    ctx.renderer?.setFxPaused?.(false);
    rememberPose(session, session.confirmedTick | 0);
    const end = endTick();
    const byTick = groupFramesByTick(file.frames);
    const humans = file.config.humanPlayers ?? file.config.activeSlots ?? [];
    while (state.gen === gen && state.speed > 0 && state.pendingSeek == null && !state.abortSeek) {
      state.playing = true;
      const started = performance.now();
      const batch = replayBatchSize(state.speed);
      let committed = 0;
      while (committed < batch && state.gen === gen && state.speed > 0 && state.pendingSeek == null && !state.abortSeek) {
        const next = (session.confirmedTick | 0) + 1;
        if (next > end) {
          state.playing = false;
          state.speed = 0;
          return false;
        }
        const frames = collectFramesForTick(byTick, next, humans);
        const committedTick = await session.client.commitTickAsync(next, frames);
        session._lastChecksum = committedTick?.checksum;
        const drifted = replayChecksumExpect(file, next);
        if (drifted != null && (session._lastChecksum >>> 0) !== drifted) {
          state.playing = false;
          state.speed = 0;
          deps.setStatus(REPLAY_SIM_MISMATCH);
          return false;
        }
        if (state.gen !== gen) return false;
        if ((session.confirmedTick | 0) !== next) session.confirmedTick = next;
        rememberPose(session, next);
        committed += 1;
      }
      if (state.gen !== gen || state.pendingSeek != null || state.abortSeek) return false;
      if (state.speed < 0) return true;
      if (state.speed === 0 || !state.playing) return false;
      paint();
      if (committed > 0) await maybeCheckpoint(session, session.confirmedTick | 0);
      if (state.gen !== gen || state.pendingSeek != null || state.abortSeek) return false;
      if (state.speed < 0) return true;
      if (state.speed === 0 || !state.playing) return false;
      session._displayBlendMs = replayDisplayBlendMs(state.speed);
      if (committed > 0) {
        const targetMs = (committed * TICK_MS) / Math.abs(state.speed);
        await sleepMs(targetMs - (performance.now() - started));
      }
    }
    return state.gen === gen && state.speed < 0 && state.pendingSeek == null && !state.abortSeek;
  }

  /** @returns {Promise<boolean>} true when playback should continue forward */
  async function reversePass(gen) {
    const ctx = deps.getCtx();
    const session = ctx?.session;
    if (!session || !state.file) return false;
    session.watchingReplay = true;
    session.pauseLockstep = true;
    session.simAcc = 0;
    session.replayPoseHold = true;
    ctx.renderer?.setFxPaused?.(true);
    if (state.poseCursor == null) state.poseCursor = session.confirmedTick | 0;
    let last = performance.now();
    while (state.gen === gen && state.speed < 0 && state.pendingSeek == null && !state.abortSeek) {
      state.playing = true;
      if (!poseCovers(state.poseCursor)) {
        const ok = await fillBackward(state.poseCursor, gen);
        last = performance.now();
        if (state.gen !== gen || state.pendingSeek != null || state.abortSeek) return false;
        if (state.speed > 0) return true;
        if (!(state.speed < 0)) return false;
        if (!ok) {
          await sleepMs(50);
          continue;
        }
      }
      presentReplayPose(session, state.poseCursor, state.poses);
      paint();
      await nextPaint();
      if (state.gen !== gen || state.pendingSeek != null || state.abortSeek) return false;
      if (state.speed > 0) return true;
      if (!(state.speed < 0)) return false;
      const now = performance.now();
      let dt = now - last;
      last = now;
      if (dt > 50) dt = 50;
      const rate = Math.abs(Number(state.speed)) || 1;
      let next = state.poseCursor - (dt / TICK_MS) * rate;
      if (next < 0) next = 0;
      state.poseCursor = next;
      if (next <= 0) {
        state.playing = false;
        state.speed = 0;
        presentReplayPose(session, 0, state.poses);
        return false;
      }
    }
    return state.gen === gen && state.speed > 0 && state.pendingSeek == null && !state.abortSeek;
  }

  async function playLoop() {
    if (state.playing || state.playPending) return;
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file || state.speed === 0) return;
    const session = ctx.session;
    const serial = state.speedSerial;
    let resumeFail = false;
    let resumeSeek = false;
    state.playPending = true;
    try {
      if (state.speed > 0 && state.poseCursor != null) {
        if (!(await syncPoseCursor(session))) return;
        if (!state.file) return;
      }
      if (state.speed === 0) return;
      if (state.speed > 0 && replayPlayShouldRewind(session.confirmedTick, endTick())) {
        if (!(await seekTo(0))) return;
        if (state.speed === 0) return;
      }
      if (!state.file || !deps.getCtx()?.session) return;
    const gen = state.gen;
    state.playing = true;
    session.watchingReplay = true;
    paint();
    try {
      while (state.gen === gen && state.file && state.pendingSeek == null && state.speed !== 0 && !state.abortSeek) {
        state.playing = true;
        const again = state.speed < 0 ? await reversePass(gen) : await forwardPass(gen);
        if (!again) {
          resumeFail = state.speed !== 0 && state.pendingSeek == null && !state.abortSeek;
          break;
        }
      }
    } catch (err) {
      if (state.gen === gen) {
        console.error('[replay] playback failed', err);
        deps.setStatus(failStatus(err, 'Replay playback failed'));
      }
    } finally {
      if (state.gen === gen) {
        state.playing = false;
        const pending = state.pendingSeek;
        session.pauseLockstep = true;
        session.simAcc = 0;
        if (pending != null) {
          if (state.speed !== 0) resumeSeek = true;
          state.resumeAfterSeek = true;
          state.poseCursor = null;
          session._replayPoseSample = null;
          session.replayPoseHold = false;
          session.replayClockTick = null;
          state.pendingSeek = null;
          paint();
          await seekTo(pending);
        } else if (state.abortSeek) {
          state.poseCursor = null;
          session._replayPoseSample = null;
          session.replayPoseHold = false;
          session.replayClockTick = null;
          state.abortSeek = false;
          paint();
        } else {
          paint();
        }
      }
    }
    } finally {
      state.playPending = false;
      const speedChanged = state.speedSerial !== serial;
      const want = state.speed !== 0
        && !state.playing
        && !state.busy
        && state.pendingSeek == null
        && !state.abortSeek
        && state.file;
      const failed = resumeFail && !speedChanged && !resumeSeek;
      if (want && (speedChanged || resumeSeek || failed) && state.playRetries < 4) {
        if (failed) state.playRetries += 1;
        else state.playRetries = 0;
        playLoop();
      } else if (state.speed === 0) {
        state.playRetries = 0;
      }
    }
  }

  function applySpeed(speed) {
    state.speed = speed;
    state.speedSerial += 1;
    state.playRetries = 0;
    if (speed === 0) {
      state.resumeAfterSeek = false;
      if (state.playing || state.playPending) pausePlayback();
      else paint();
      return;
    }
    // 0× is the only pause. Reverse speeds are playback too.
    state.resumeAfterSeek = true;
    if (state.playing || state.playPending) state.playing = true;
    paint();
    if (state.busy) return;
    if (!state.playing && !state.playPending) playLoop();
  }

  function togglePlay() {
    if (!state.file) return false;
    if (state.busy) {
      state.abortSeek = true;
      state.playing = false;
      state.resumeAfterSeek = false;
      state.speed = 0;
      paint();
      return true;
    }
    deps.parkLobby?.();
    state.barDismissed = false;
    if (state.playing || state.playPending) applySpeed(0);
    else applySpeed(1);
    return true;
  }

  function armFromSession(session, names) {
    if (!session?.replayConfig) {
      hide();
      return;
    }
    state.file = buildReplayFile(session, { names });
    state.checkpoints.clear();
    state.poses.clear();
    state.poseCursor = null;
    state.garden = session.replayGarden ?? null;
    session.watchingReplay = false;
    state.barDismissed = true;
    if (!state.playing) state.speed = 0;
    paint();
  }

  async function openFromMenu() {
    const ctx = deps.getCtx();
    if (!ctx?.session) return;
    const blocked = replayBlockedReason(ctx);
    if (blocked) {
      deps.setStatus(blocked);
      return;
    }
    let text;
    try {
      text = await pickReplayText();
    } catch (err) {
      console.error('[replay] open failed', err);
      deps.setStatus('Could not open replay');
      return;
    }
    if (text == null) return;
    let file;
    try {
      file = parseReplayFile(text);
    } catch (err) {
      deps.setStatus(err?.message || 'Could not open replay');
      return;
    }
    state.gen += 1;
    state.playing = false;
    state.speed = 0;
    state.file = file;
    state.checkpoints.clear();
    state.poses.clear();
    state.poseCursor = null;
    state.garden = null;
    state.busy = true;
    state.barDismissed = false;
    paint();
    try {
      await loadGardenFor(file);
      await rebuildToTick(ctx, 0, { skipSplash: false });
      deps.setStatus('Replay');
      deps.parkLobby?.();
    } catch (err) {
      console.error('[replay] load failed', err);
      deps.setStatus(failStatus(err, 'Could not load replay'));
      hide();
    } finally {
      state.busy = false;
      paint();
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    const { start, rew, play, fwd, endBtn, scrub, speedSlider, close, watch } = els();
    start?.addEventListener('click', () => { jumpTo(0); });
    rew?.addEventListener('click', () => { skip(-1); });
    play?.addEventListener('click', () => { togglePlay(); });
    fwd?.addEventListener('click', () => { skip(1); });
    endBtn?.addEventListener('click', () => { jumpTo(endTick()); });
    const applySlider = () => {
      const picked = REPLAY_SPEEDS[speedSlider.value | 0];
      if (picked != null) applySpeed(picked);
    };
    speedSlider?.addEventListener('pointerdown', () => { state.speedDragging = true; });
    const endSpeedDrag = () => {
      if (!state.speedDragging) return;
      state.speedDragging = false;
      applySlider();
    };
    window.addEventListener('pointerup', endSpeedDrag);
    window.addEventListener('pointercancel', endSpeedDrag);
    speedSlider?.addEventListener('input', applySlider);
    close?.addEventListener('click', () => {
      pausePlayback();
      state.barDismissed = true;
      state.closedToResult = true;
      const session = deps.getCtx()?.session;
      if (session) session.watchingReplay = false;
      deps.unparkLobby?.();
      paint();
    });
    watch?.addEventListener('click', () => {
      const session = deps.getCtx()?.session;
      if (session) session.watchingReplay = true;
      state.closedToResult = false;
      deps.parkLobby?.();
      state.barDismissed = false;
      paint();
      togglePlay();
      // A click leaves this button focused. The next key would light it
      // and the lobby would swallow the key before spectator follow.
      watch.blur();
    });
    let scrubTimer = 0;
    scrub?.addEventListener('input', () => {
      state.scrubbing = true;
      const clock = els().clock;
      if (clock) {
        clock.textContent = `${formatReplayClock(scrub.value | 0)} / ${formatReplayClock(endTick())}`;
      }
      clearTimeout(scrubTimer);
      scrubTimer = window.setTimeout(() => {
        state.scrubbing = false;
        seekTo(scrub.value | 0);
      }, 140);
    });
    scrub?.addEventListener('change', () => {
      clearTimeout(scrubTimer);
      state.scrubbing = false;
      seekTo(scrub.value | 0);
    });
  }

  function nudgeSpeed(dir) {
    if (!isWatching()) return false;
    applySpeed(stepReplaySpeed(state.speed, dir));
    return true;
  }

  function isWatching() {
    return Boolean(deps.getCtx()?.session?.watchingReplay && state.file);
  }

  function getHead() {
    return {
      tick: shownTick(),
      speed: state.speed,
      open: Boolean(state.file) && !state.barDismissed,
    };
  }

  /** Pull the local tape toward someone else's replay head. */
  function followRemote(tick, speed) {
    if (!state.file) return false;
    const plan = replayFollowPlan({
      localTick: shownTick(),
      remoteTick: tick,
      localSpeed: state.speed,
      remoteSpeed: speed,
      busy: state.busy || state.playPending,
    });
    if (!plan) return false;
    if (state.closedToResult) return false;
    if (state.barDismissed) {
      state.barDismissed = false;
      deps.parkLobby?.();
    }
    if (plan.seek != null) {
      state.speed = plan.speed;
      state.resumeAfterSeek = plan.speed !== 0;
      seekTo(plan.seek);
      return true;
    }
    applySpeed(plan.speed);
    return true;
  }

  return {
    bind,
    hide,
    paint,
    armFromSession,
    openFromMenu,
    togglePlay,
    nudgeSpeed,
    isWatching,
    getHead,
    followRemote,
    camPose: (owner, tick) => replayCamPose(state.file?.cams, owner, tick),
    ownerNames() {
      const names = state.file?.names;
      if (!names || typeof names !== 'object' || Array.isArray(names)) return null;
      return names;
    },
  };
}
