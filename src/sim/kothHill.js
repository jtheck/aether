// Hill zone — units within center radius (visual hill at origin).

import * as fx from './fixed.js';

export const HILL_RADIUS = fx.fromFloat(40);
const HILL_R2 = fx.mul(HILL_RADIUS, HILL_RADIUS);

export function unitsOnHill(w, owner = -1) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (owner >= 0 && w.owner[i] !== owner) continue;
    if (fx.dist2(w.px[i], w.py[i], 0, 0) <= HILL_R2) n++;
  }
  return n;
}

/** Owner with most units on hill (-1 = none). */
export function hillController(w) {
  const counts = new Int32Array(8);
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    if (fx.dist2(w.px[i], w.py[i], 0, 0) > HILL_R2) continue;
    const o = w.owner[i];
    if (o >= 0 && o < counts.length) counts[o]++;
  }
  let best = -1;
  let bestN = 0;
  for (let o = 0; o < counts.length; o++) {
    if (counts[o] > bestN) {
      bestN = counts[o];
      best = o;
    }
  }
  return bestN > 0 ? best : -1;
}
