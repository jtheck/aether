// O-key screenshot chrome: tap hides HUD for a beat; hold stays hidden
// until release, then the same linger. Extra taps / hold time add a few
// hundred ms, capped.

export const SCREENSHOT_HUD_CLASS = 'screenshot-hud';
export const SCREENSHOT_HUD_TAP_MS = 1200;
export const SCREENSHOT_HUD_ADD_MS = 350;
export const SCREENSHOT_HUD_HOLD_ADD_EVERY_MS = 400;
export const SCREENSHOT_HUD_MAX_LINGER_MS = 4200;

/**
 * @param {{
 *   tapMs?: number,
 *   addMs?: number,
 *   holdAddEveryMs?: number,
 *   maxLingerMs?: number,
 * }} [opts]
 */
export function createScreenshotHudClock(opts = {}) {
  const tapMs = opts.tapMs ?? SCREENSHOT_HUD_TAP_MS;
  const addMs = opts.addMs ?? SCREENSHOT_HUD_ADD_MS;
  const holdAddEveryMs = opts.holdAddEveryMs ?? SCREENSHOT_HUD_HOLD_ADD_EVERY_MS;
  const maxLingerMs = opts.maxLingerMs ?? SCREENSHOT_HUD_MAX_LINGER_MS;

  let holding = false;
  let lingerMs = 0;
  let hideUntil = 0;
  let lastHoldAddAt = 0;

  function clampLinger(ms) {
    return Math.min(maxLingerMs, Math.max(0, ms));
  }

  function rideHold(now) {
    if (!holding) return;
    while (now - lastHoldAddAt >= holdAddEveryMs && lingerMs < maxLingerMs) {
      lastHoldAddAt += holdAddEveryMs;
      lingerMs = clampLinger(lingerMs + addMs);
    }
  }

  function snapshot(now) {
    const hidden = holding || now < hideUntil;
    return {
      hidden,
      holding,
      lingerMs: holding ? lingerMs : hidden ? Math.max(0, hideUntil - now) : 0,
    };
  }

  return {
    press(now) {
      if (holding) {
        rideHold(now);
        return snapshot(now);
      }
      if (now < hideUntil) {
        lingerMs = clampLinger(Math.max(0, hideUntil - now) + addMs);
      } else {
        lingerMs = tapMs;
      }
      holding = true;
      lastHoldAddAt = now;
      hideUntil = now + lingerMs;
      return snapshot(now);
    },

    release(now) {
      if (!holding) return snapshot(now);
      rideHold(now);
      holding = false;
      hideUntil = now + lingerMs;
      return snapshot(now);
    },

    tick(now) {
      if (holding) rideHold(now);
      return snapshot(now);
    },

    isHolding() {
      return holding;
    },
  };
}

/**
 * @param {{
 *   onChange?: (hidden: boolean) => void,
 *   onPress?: () => void,
 *   now?: () => number,
 *   requestFrame?: (cb: (t: number) => void) => number,
 *   cancelFrame?: (id: number) => void,
 * }} [opts]
 */
export function createScreenshotHud(opts = {}) {
  const clock = createScreenshotHudClock(opts);
  const nowFn = opts.now ?? (() => performance.now());
  const raf = opts.requestFrame
    ?? (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(() => cb(nowFn()), 16));
  const caf = opts.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout);

  let handle = 0;
  let lastHidden = false;

  function flush() {
    const snap = clock.tick(nowFn());
    if (snap.hidden !== lastHidden) {
      lastHidden = snap.hidden;
      opts.onChange?.(lastHidden);
    }
    if (snap.hidden || snap.holding) {
      if (!handle) {
        handle = raf(() => {
          handle = 0;
          flush();
        });
      }
    }
    return snap;
  }

  return {
    press() {
      clock.press(nowFn());
      opts.onPress?.();
      return flush();
    },
    release() {
      clock.release(nowFn());
      return flush();
    },
    isHidden() {
      return lastHidden;
    },
    dispose() {
      if (handle) caf(handle);
      handle = 0;
    },
  };
}
