import {
  CHAT_KEEP,
  emptyReel,
  linesOverlappingRange,
  nextClipTime,
  normalizeReel,
  prevClipTime,
  sample,
} from './timeline.js';

/** Timeline seconds per wall second. `>|` sprints so the chat stack can catch up. */
export const RATE_SKIP = 24;

/**
 * Playhead over a reel. Play / stop / rewind / ff all sample(t) so camera
 * matches the sheet. Chat can linger for each line's authored `dur` (wall time)
 * so a skip still lets you read, then times out or is forced out of the queue.
 */
export function createStoryPlayer(opts = {}) {
  let reel = normalizeReel(opts.reel || emptyReel());
  let t = 0;
  let rate = 0;
  const listeners = [];
  /** @type {{ id: string, speaker: string, text: string, style: string, t: number, dur: number, until: number }[]} */
  let chat = [];
  const nowMs = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  function coveringPaint(s) {
    return {
      ...s,
      lines: s.lines.slice(),
      line: s.lines.length ? s.lines[s.lines.length - 1] : null,
    };
  }

  function chatPaint(s) {
    const lines = chat.map(({ until, ...rest }) => rest);
    return { ...s, lines, line: lines.length ? lines[lines.length - 1] : null };
  }

  function resetChat(s) {
    chat = s.lines.map((line) => ({ ...line, until: Infinity }));
  }

  function expireChat(now, coveringIds) {
    const n = chat.length;
    chat = chat.filter((e) => coveringIds.has(e.id) || now < e.until);
    return chat.length !== n;
  }

  function rememberLines(lines, playhead, now) {
    const have = new Set(chat.map((e) => e.id));
    for (const line of lines) {
      if (have.has(line.id)) continue;
      const remain = Math.max(0.05, line.t + line.dur - playhead);
      chat.push({ ...line, until: now + remain * 1000 });
    }
    while (chat.length > CHAT_KEEP) chat.shift();
  }

  function emit(mode = 'play') {
    const s = sample(reel, t);
    const now = nowMs();
    if (mode === 'seek') {
      resetChat(s);
      const out = coveringPaint(s);
      opts.onSample?.(out);
      for (const fn of listeners) fn(out, { t, rate, duration: reel.duration });
      return;
    }
    expireChat(now, new Set(s.lines.map((line) => line.id)));
    rememberLines(s.lines, t, now);
    const out = chatPaint(s);
    opts.onSample?.(out);
    for (const fn of listeners) fn(out, { t, rate, duration: reel.duration });
  }

  function clampSeek(next) {
    return Math.max(0, Math.min(reel.duration, Number(next) || 0));
  }

  const api = {
    getReel() {
      return reel;
    },
    setReel(next) {
      reel = normalizeReel(next);
      t = clampSeek(t);
      emit('seek');
    },
    time() {
      return t;
    },
    rate() {
      return rate;
    },
    duration() {
      return reel.duration;
    },
    sample() {
      const s = sample(reel, t);
      expireChat(nowMs(), new Set(s.lines.map((line) => line.id)));
      return chat.length ? chatPaint(s) : coveringPaint(s);
    },
    play() {
      rate = 1;
      if (t >= reel.duration && reel.duration > 0) t = 0;
      emit('play');
    },
    stop() {
      rate = 0;
      emit('play');
    },
    toggle() {
      if (rate === 0) api.play();
      else api.stop();
    },
    rewind() {
      rate = -2;
      emit('play');
    },
    fastForward() {
      rate = rate >= 2 ? 4 : 2;
      emit('play');
    },
    seek(next) {
      t = clampSeek(next);
      emit('seek');
    },
    toStart() {
      rate = 0;
      t = 0;
      emit('seek');
    },
    toEnd() {
      api.skipForward();
    },
    skipForward() {
      if (reel.duration <= 0 || t >= reel.duration) {
        rate = 0;
        t = reel.duration;
        emit('play');
        return;
      }
      rate = RATE_SKIP;
      emit('play');
    },
    prevClip() {
      rate = 0;
      t = prevClipTime(reel, t);
      emit('seek');
    },
    nextClip() {
      rate = 0;
      t = nextClipTime(reel, t);
      emit('seek');
    },
    tick(deltaMs) {
      const now = nowMs();
      const live = sample(reel, t);
      const dropped = expireChat(now, new Set(live.lines.map((line) => line.id)));
      if (rate === 0 || reel.duration <= 0) {
        if (dropped) emit('play');
        return;
      }
      const from = t;
      const dt = Math.min(50, Math.max(0, Number(deltaMs) || 0));
      t += (dt / 1000) * rate;
      if (t <= 0) {
        t = 0;
        rate = 0;
      } else if (t >= reel.duration) {
        t = reel.duration;
        rate = 0;
      }
      rememberLines(linesOverlappingRange(reel, from, t), t, now);
      emit('play');
    },
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return api;
}
