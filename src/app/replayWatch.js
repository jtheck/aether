import { collectFramesForTick } from '../sim/commandFrame.js';
import { TICK_MS, formatHudMatchClock, matchSecondsFromTick } from './simSession.js';
import { replayCatchUpInto, groupFramesByTick } from './catchup.js';
import {
  buildReplayFile,
  liveConfigFromReplay,
  parseReplayFile,
  pickReplayText,
  replayEndTick,
} from './replay.js';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8];

/** @param {number} current */
export function nextReplaySpeed(current) {
  const i = REPLAY_SPEEDS.indexOf(current);
  return REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length] ?? 1;
}

/** @param {number} speed */
export function formatReplaySpeed(speed) {
  if (speed === 0.5) return '½×';
  return `${speed}×`;
}

/** Play at the last tick should rewind to 0 first. */
export function replayPlayShouldRewind(tick, endTick) {
  return (tick | 0) >= Math.max(0, (endTick | 0) - 1);
}

/** @param {number} tick */
export function formatReplayClock(tick) {
  return formatHudMatchClock(matchSecondsFromTick(tick | 0));
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
 * Bottom-bar VOD: rewind / play / scrub / speed, plus menu open and post-match Watch.
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
  };

  function els() {
    return {
      bar: document.getElementById('replay-watch'),
      play: document.getElementById('replay-play'),
      rew: document.getElementById('replay-rew'),
      scrub: /** @type {HTMLInputElement | null} */ (document.getElementById('replay-scrub')),
      clock: document.getElementById('replay-clock'),
      speed: document.getElementById('replay-speed'),
      close: document.getElementById('replay-close'),
      watch: document.getElementById('match-replay-watch'),
    };
  }

  function endTick() {
    return replayEndTick(state.file);
  }

  function paint() {
    const { bar, play, rew, scrub, clock, speed, close, watch } = els();
    const ctx = deps.getCtx();
    const tick = ctx?.session?.confirmedTick | 0;
    const end = endTick();
    const armed = Boolean(state.file);
    if (watch) watch.hidden = !armed;
    if (!bar) return;
    bar.hidden = !armed || state.barDismissed;
    if (play) {
      play.textContent = state.playing ? 'Pause' : 'Play';
      play.disabled = state.busy || !armed;
    }
    if (rew) rew.disabled = state.busy || !armed;
    if (speed) {
      speed.textContent = formatReplaySpeed(state.speed);
      speed.disabled = state.busy || !armed;
    }
    if (close) close.disabled = !armed;
    if (clock) clock.textContent = `${formatReplayClock(tick)} / ${formatReplayClock(end)}`;
    if (scrub && !state.scrubbing) {
      scrub.max = String(Math.max(0, end));
      scrub.value = String(Math.max(0, Math.min(end, tick)));
      scrub.disabled = state.busy || !armed;
    }
  }

  function pausePlayback() {
    state.playing = false;
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
    const ctx = deps.getCtx();
    if (ctx?.session) ctx.session.watchingReplay = false;
    const { bar, watch } = els();
    if (bar) bar.hidden = true;
    if (watch) watch.hidden = true;
  }

  async function loadGardenFor(file) {
    if (state.garden) return state.garden;
    const url = file?.config?.gardenUrl;
    if (!url) return null;
    const garden = await deps.loadGarden(url);
    state.garden = garden;
    return garden;
  }

  async function rebuildToTick(ctx, targetTick, { skipSplash }) {
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
    ctx.inputApi?.setInputEnabled?.(false);
    const want = Math.max(0, targetTick | 0);
    if (want > 0) {
      await replayCatchUpInto(
        ctx.session,
        cfg,
        file.frames,
        want,
        null,
        { stayPaused: true, fromTick: 0, ticksPerFrame: 80 },
      );
      ctx.session.watchingReplay = true;
      ctx.session.pauseLockstep = true;
    }
  }

  async function seekTo(targetTick) {
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file || state.busy) return;
    const end = endTick();
    const want = Math.max(0, Math.min(end, targetTick | 0));
    const cur = ctx.session.confirmedTick | 0;
    if (want === cur) return;
    const resume = state.playing;
    const gen = ++state.gen;
    state.playing = false;
    state.busy = true;
    paint();
    try {
      if (want < cur) {
        await rebuildToTick(ctx, want, { skipSplash: true });
      } else {
        await replayCatchUpInto(
          ctx.session,
          liveConfigFromReplay(file, { garden: state.garden, skipSplash: true }),
          file.frames,
          want,
          null,
          { stayPaused: true, fromTick: cur, ticksPerFrame: 80 },
        );
        ctx.session.watchingReplay = true;
        ctx.session.pauseLockstep = true;
      }
    } catch (err) {
      console.error('[replay] seek failed', err);
      deps.setStatus('Replay seek failed');
    } finally {
      if (gen === state.gen) {
        state.busy = false;
        paint();
        if (resume && state.file) playLoop();
      }
    }
  }

  async function playLoop() {
    const ctx = deps.getCtx();
    const file = state.file;
    if (!ctx?.session || !file) return;
    const end = endTick();
    if (replayPlayShouldRewind(ctx.session.confirmedTick, end)) {
      await seekTo(0);
    }
    if (!state.file) return;
    const gen = state.gen;
    state.playing = true;
    ctx.session.watchingReplay = true;
    ctx.session.pauseLockstep = false;
    ctx.session.simAcc = 0;
    ctx.renderer?.setFxPaused?.(false);
    paint();
    const byTick = groupFramesByTick(file.frames);
    const humans = file.config.humanPlayers ?? file.config.activeSlots ?? [];
    try {
      while (state.playing && state.gen === gen) {
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
        paint();
        await sleepMs(TICK_MS / state.speed);
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
    if (state.busy) return true;
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
    const { play, rew, scrub, speed, close, watch } = els();
    play?.addEventListener('click', () => { togglePlay(); });
    rew?.addEventListener('click', () => {
      deps.parkLobby?.();
      state.barDismissed = false;
      state.playing = false;
      seekTo(0);
    });
    speed?.addEventListener('click', () => {
      state.speed = nextReplaySpeed(state.speed);
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
    isWatching,
  };
}
