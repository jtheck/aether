// Hold-to-queue for a production unit. The press itself trains one.
// After a short beat, more trains land on a steady interval while the
// same option stays down. A tap ends before the beat, so it stays one.

/** Beat before the second train. Matches menu-nav hold. */
export const QUEUE_HOLD_DELAY_MS = 320;
/** Gap between trains once the hold is repeating. */
export const QUEUE_HOLD_INTERVAL_MS = 160;

/**
 * Unit id worth repeating, or null for everything else (build, research, pause).
 * @param {object | string | null | undefined} pick
 */
export function unitQueueKey(pick) {
  if (!pick || typeof pick !== 'object') return null;
  if (pick.kind !== 'unit' || pick.id == null || pick.id === '') return null;
  return String(pick.id);
}

/**
 * @param {{ id: string | null, heldAt: number, lastAt: number }} state
 * @param {string | null} id
 * @param {number} t
 */
export function nextQueueHold(state, id, t) {
  if (!id) return { fire: false, id: null, heldAt: 0, lastAt: 0 };
  if (id !== state.id) return { fire: true, id, heldAt: t, lastAt: t };
  if (
    t - state.heldAt >= QUEUE_HOLD_DELAY_MS
    && t - state.lastAt >= QUEUE_HOLD_INTERVAL_MS
  ) {
    return { fire: true, id, heldAt: state.heldAt, lastAt: t };
  }
  return { fire: false, id: state.id, heldAt: state.heldAt, lastAt: state.lastAt };
}

/**
 * Timer for devices that are not polled every frame (mouse, keyboard).
 * Does not fire on start — the caller already trained the first one,
 * or will on release if the hold never reached the beat.
 * @param {{ delay?: number, interval?: number, setTimer?: Function, clearTimer?: Function }} [opts]
 */
export function createQueueHoldTimer(opts = {}) {
  const delay = opts.delay ?? QUEUE_HOLD_DELAY_MS;
  const interval = opts.interval ?? QUEUE_HOLD_INTERVAL_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
  let timer = null;
  let generation = 0;
  let key = null;

  function clear() {
    if (timer == null) return;
    clearTimer(timer);
    timer = null;
  }

  function stop(id) {
    if (id != null && id !== key) return;
    generation += 1;
    key = null;
    clear();
  }

  function start(id, fire) {
    stop();
    key = id;
    const gen = ++generation;
    const kick = (ms) => {
      timer = setTimer(() => {
        timer = null;
        if (gen !== generation) return;
        fire();
        if (gen !== generation) return;
        kick(interval);
      }, ms);
    };
    kick(delay);
  }

  return {
    get key() {
      return key;
    },
    start,
    stop,
  };
}
