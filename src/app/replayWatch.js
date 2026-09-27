import { collectFramesForTick } from '../sim/commandFrame.js';
import { TICK_HZ, TICK_MS, formatHudMatchClock, matchSecondsFromTick } from './simSession.js';
import { replayCatchUpInto, groupFramesByTick } from './catchup.js';
import {
  buildReplayFile,
  liveConfigFromReplay,
  parseReplayFile,
  pickReplayText,
  replayEndTick,
} from './replay.js';

export const REPLAY_SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

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
  const s = Number(speed);
  if (!Number.isFinite(s) || s <= 2) return 1;
  return Math.min(80, Math.max(1, Math.round(s)));
}

/** Wall ms the render blend should spend on one sim tick at this playback speed. */
export function replayDisplayBlendMs(speed, tickMs = TICK_MS) {
  const s = Number(speed);
  const rate = Number.isFinite(s) && s > 0 ? s : 1;
  return tickMs / rate;
}

/** @param {number} speed */
export function formatReplaySpeed(speed) {
  if (speed === 0.125) return '⅛×';
  if (speed === 0.25) return '¼×';
  if (speed === 0.5) return '½×';
  return `${speed}×`;
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

/** @param {number} tick */
export function formatReplayClock(tick) {
  return formatHudMatchClock(matchSecondsFromTick(tick | 0));
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
  const phase = ctx?.matchLobby?.getState?.()?.phase;
  if (phase === 'playing' || phase === 'starting' || phase === 'countdown') {
    return 'Leave or finish the match first';
  }
  const presence = ctx?.kothShard?.getLobbyPresence?.();
  if (presence?.playing) return 'Leave the match first';
  return null;
}

/**
 * Bottom-left VOD: skip back/forward, play, scrub, speed, plus menu open and post-match Watch.
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
    speed: 1,
    gen: 0,
    busy: false,
    scrubbing: false,
    barDismissed: false,
    bound: false,
    /** Tick the in-flight seek is rebuilding toward. */
    seekTarget: null,
    /** Latest skip/scrub asked for while a seek is already running. */
    pendingSeek: null,
    /** Stop the in-flight catch-up on the tick it has reached. */
    abortSeek: false,
    /** Playback was running when this seek chain started. */
    resumeAfterSeek: false,
    speedOpen: false,
    /** @type {Map<number, object>} */
    checkpoints: new Map(),
  };

  function els() {
    return {
      bar: document.getElementById('replay-watch'),
      play: document.getElementById('replay-play'),
      rew: document.getElementById('replay-rew'),
      fwd: document.getElementById('replay-fwd'),
      scrub: /** @type {HTMLInputElement | null} */ (document.getElementById('replay-scrub')),
      ghost: document.getElementById('replay-ghost'),
      clock: document.getElementById('replay-clock'),
      speed: document.getElementById('replay-speed'),
      speedPop: document.getElementById('replay-speed-pop'),
      speedSlider: /** @type {HTMLInputElement | null} */ (document.getElementById('replay-speed-slider')),
      close: document.getElementById('replay-close'),
      watch: document.getElementById('match-replay-watch'),
    };
  }

  function endTick() {
    return replayEndTick(state.file);
  }

  function shownTick() {
    if (state.abortSeek) return deps.getCtx()?.session?.confirmedTick | 0;
    if (state.pendingSeek != null) return state.pendingSeek;
    if (state.seekTarget != null) return state.seekTarget;
    return deps.getCtx()?.session?.confirmedTick | 0;
  }

  function paint() {
    const { bar, play, rew, fwd, scrub, ghost, clock, speed, speedPop, speedSlider, close, watch } = els();
    const end = endTick();
    const tick = shownTick();
    const live = deps.getCtx()?.session?.confirmedTick | 0;
    const armed = Boolean(state.file);
    if (watch) watch.hidden = !armed;
    if (!bar) return;
    bar.hidden = !armed || state.barDismissed;
    if (play) {
      play.textContent = state.playing || state.busy ? 'Pause' : 'Play';
      play.disabled = !armed;
    }
    if (rew) rew.disabled = !armed || tick <= 0;
    if (fwd) fwd.disabled = !armed || tick >= end;
    if (speed) {
      speed.textContent = formatReplaySpeed(state.speed);
      speed.disabled = !armed;
      speed.setAttribute('aria-expanded', state.speedOpen ? 'true' : 'false');
    }
    if (speedPop) speedPop.hidden = !state.speedOpen || !armed || state.barDismissed;
    if (speedSlider) {
      speedSlider.max = String(REPLAY_SPEEDS.length - 1);
      speedSlider.value = String(replaySpeedIndex(state.speed));
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
  }

  function pausePlayback() {
    state.playing = false;
    state.resumeAfterSeek = false;
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
    state.seekTarget = null;
    state.pendingSeek = null;
    state.abortSeek = false;
    state.resumeAfterSeek = false;
    state.speedOpen = false;
    state.checkpoints.clear();
    const ctx = deps.getCtx();
    if (ctx?.session) ctx.session.watchingReplay = false;
    const { bar, watch } = els();
    if (bar) bar.hidden = true;
    if (watch) watch.hidden = true;
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

  function catchupOptions(fromTick, shouldContinue) {
    return {
      stayPaused: true,
      fromTick,
      ticksPerFrame: 80,
      shouldContinue,
      onBatch: (tick) => maybeCheckpoint(deps.getCtx()?.session, tick),
    };
  }

  async function resumeFromCheckpoint(ctx, file, checkpoint, want, shouldContinue) {
    const imported = await ctx.session.importCheckpoint(checkpoint, checkpoint.checksum);
    const from = imported.tick | 0;
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = true;
    ctx.session.simAcc = 0;
    ctx.inputApi?.setRole?.('spectator');
    if (from < want && shouldContinue()) {
      await replayCatchUpInto(
        ctx.session,
        liveConfigFromReplay(file, { garden: state.garden, skipSplash: true }),
        file.frames,
        want,
        null,
        catchupOptions(from, shouldContinue),
      );
    }
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = true;
  }

  async function rebuildToTick(ctx, targetTick, { skipSplash, shouldContinue }) {
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
    const want = Math.max(0, targetTick | 0);
    if (want > 0) {
      await replayCatchUpInto(
        ctx.session,
        cfg,
        file.frames,
        want,
        null,
        { stayPaused: true, fromTick: 0, ticksPerFrame: 80, shouldContinue, onBatch: (tick) => maybeCheckpoint(ctx.session, tick) },
      );
      ctx.session.watchingReplay = true;
      ctx.session.pauseLockstep = true;
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
    paint();
    const shouldContinue = () => state.gen === gen && state.pendingSeek == null && !state.abortSeek;
    let aborted = false;
    try {
      if (want < cur) {
        const mark = nearestReplayCheckpointTick(state.checkpoints.keys(), want);
        const checkpoint = mark > 0 ? state.checkpoints.get(mark) : null;
        if (checkpoint) await resumeFromCheckpoint(ctx, file, checkpoint, want, shouldContinue);
        else await rebuildToTick(ctx, want, { skipSplash: true, shouldContinue });
      } else {
        await replayCatchUpInto(
          ctx.session,
          liveConfigFromReplay(file, { garden: state.garden, skipSplash: true }),
          file.frames,
          want,
          null,
          catchupOptions(cur, shouldContinue),
        );
        ctx.session.watchingReplay = true;
        ctx.session.pauseLockstep = true;
      }
    } catch (err) {
      console.error('[replay] seek failed', err);
      deps.setStatus('Replay seek failed');
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

  async function playLoop() {
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file) return;
    const end = endTick();
    if (replayPlayShouldRewind(ctx.session.confirmedTick, end)) {
      if (!(await seekTo(0))) return;
    }
    if (!state.file) return;
    const gen = state.gen;
    state.playing = true;
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = false;
    ctx.session.simAcc = 0;
    ctx.session._displayBlendMs = replayDisplayBlendMs(state.speed);
    ctx.renderer?.setFxPaused?.(false);
    paint();
    const byTick = groupFramesByTick(file.frames);
    const humans = file.config.humanPlayers ?? file.config.activeSlots ?? [];
    try {
      while (state.playing && state.gen === gen) {
        const started = performance.now();
        const batch = replayBatchSize(state.speed);
        let committed = 0;
        while (committed < batch && state.playing && state.gen === gen) {
          const next = (ctx.session.confirmedTick | 0) + 1;
          if (next > end) {
            state.playing = false;
            break;
          }
          const frames = collectFramesForTick(byTick, next, humans);
          await ctx.session.client.commitTickAsync(next, frames);
          if (state.gen !== gen) return;
          if ((ctx.session.confirmedTick | 0) !== next) {
            ctx.session.confirmedTick = next;
          }
          committed += 1;
        }
        if (state.gen !== gen) return;
        paint();
        if (committed > 0) await maybeCheckpoint(ctx.session, ctx.session.confirmedTick | 0);
        if (state.gen !== gen) return;
        ctx.session._displayBlendMs = replayDisplayBlendMs(state.speed);
        if (committed > 0 && state.playing) {
          const targetMs = (committed * TICK_MS) / state.speed;
          await sleepMs(targetMs - (performance.now() - started));
        }
      }
    } catch (err) {
      if (state.gen === gen) {
        console.error('[replay] playback failed', err);
        deps.setStatus('Replay playback failed');
      }
    } finally {
      if (state.gen === gen) {
        state.playing = false;
        ctx.session.pauseLockstep = true;
        ctx.session.simAcc = 0;
        paint();
      }
    }
  }

  function togglePlay() {
    if (!state.file) return false;
    if (state.busy) {
      state.abortSeek = true;
      state.playing = false;
      state.resumeAfterSeek = false;
      paint();
      return true;
    }
    deps.parkLobby?.();
    state.barDismissed = false;
    if (state.playing) pausePlayback();
    else playLoop();
    return true;
  }

  function armFromSession(session, names) {
    if (!session?.replayConfig) {
      hide();
      return;
    }
    state.file = buildReplayFile(session, { names });
    state.checkpoints.clear();
    state.garden = session.replayGarden ?? null;
    session.watchingReplay = true;
    state.barDismissed = false;
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
    state.file = file;
    state.checkpoints.clear();
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
      deps.setStatus('Could not load replay');
      hide();
    } finally {
      state.busy = false;
      paint();
    }
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    const { play, rew, fwd, scrub, speed, speedPop, speedSlider, close, watch } = els();
    play?.addEventListener('click', () => { togglePlay(); });
    rew?.addEventListener('click', () => { skip(-1); });
    fwd?.addEventListener('click', () => { skip(1); });
    speed?.addEventListener('click', (event) => {
      event.stopPropagation();
      state.speedOpen = !state.speedOpen;
      paint();
    });
    speedSlider?.addEventListener('input', () => {
      const picked = REPLAY_SPEEDS[speedSlider.value | 0];
      if (picked != null) state.speed = picked;
      paint();
    });
    speedPop?.addEventListener('pointerdown', (event) => { event.stopPropagation(); });
    document.addEventListener('pointerdown', (event) => {
      if (!state.speedOpen) return;
      const target = /** @type {Node | null} */ (event.target);
      if (target && (speed?.contains(target) || speedPop?.contains(target))) return;
      state.speedOpen = false;
      paint();
    });
    close?.addEventListener('click', () => {
      pausePlayback();
      state.barDismissed = true;
      paint();
    });
    watch?.addEventListener('click', () => {
      deps.parkLobby?.();
      state.barDismissed = false;
      paint();
      togglePlay();
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
    state.speed = stepReplaySpeed(state.speed, dir);
    paint();
    return true;
  }

  function isWatching() {
    return Boolean(deps.getCtx()?.session?.watchingReplay && state.file);
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
  };
}
