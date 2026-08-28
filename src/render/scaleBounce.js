// Shared stage-pop: a small, quick overshoot then a short settle.
// Used for tree/rock exhaustion and building completion.

export const SCALE_BOUNCE_MS = 380;
export const SCALE_RISE_MS = 440;

const DROP_BUMP = 1.032;
const DROP_UNDER = 0.978;
const DROP_T_BUMP = 0.08;
const DROP_T_UNDER = 0.78;

const RISE_OVER = 1.04;
const RISE_T_OVER = 0.70;

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Shrink: tiny bump up, fast drop just below target, quick settle. */
export function stageDropScale(from, to, t) {
  const bump = from * DROP_BUMP;
  const under = to * DROP_UNDER;
  if (t <= DROP_T_BUMP) {
    const u = easeOutCubic(t / DROP_T_BUMP);
    return from + (bump - from) * u;
  }
  if (t <= DROP_T_UNDER) {
    const u = (t - DROP_T_BUMP) / (DROP_T_UNDER - DROP_T_BUMP);
    return bump + (under - bump) * (u * u);
  }
  const u = (t - DROP_T_UNDER) / (1 - DROP_T_UNDER);
  return under + (to - under) * easeOutCubic(u);
}

/** Grow: rush just past target, then a short settle. */
export function stageRiseScale(from, to, t) {
  const over = to * RISE_OVER;
  if (t <= RISE_T_OVER) {
    const u = easeOutCubic(t / RISE_T_OVER);
    return from + (over - from) * u;
  }
  const u = (t - RISE_T_OVER) / (1 - RISE_T_OVER);
  return over + (to - over) * easeOutCubic(u);
}
