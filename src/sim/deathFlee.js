// Presentation hint: which way a villager or brigand should run when they die.
// Gameplay never reads this. Checksums ignore it. Each client derives it in its
// own sim from the killing blow, so the renderer can play the sprint locally.

import * as fx from './fixed.js';
import { UNIT } from './unitTypes.js';

const NOTE_CAP = 256;

/** Eight stable compass steps. Avoids a transcendental when nothing else points. */
const OCTANT = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const INV_DIAG = 0.7071067811865476;

function ensure(w) {
  if (w.deathNoteId) return;
  w.deathNoteId = new Int32Array(NOTE_CAP);
  w.deathNoteX = new Float32Array(NOTE_CAP);
  w.deathNoteZ = new Float32Array(NOTE_CAP);
  w.deathNoteN = 0;
}

function unitAway(ax, az) {
  const len = fx.len(ax, az);
  if (len <= 0) return null;
  return { x: fx.toFloat(fx.div(ax, len)), z: fx.toFloat(fx.div(az, len)) };
}

/**
 * Away from the fight: the killer, else whoever they were hitting, else
 * opposite the way they were facing.
 * @returns {{ x: number, z: number }}
 */
export function fleeVector(w, i, source = -1) {
  if (source >= 0 && source < w.count && source !== i) {
    const away = unitAway(w.px[i] - w.px[source], w.py[i] - w.py[source]);
    if (away) return away;
  }
  const tgt = w.targetEntity?.[i] ?? -1;
  if (tgt >= 0 && tgt < w.count && tgt !== i) {
    const away = unitAway(w.px[i] - w.px[tgt], w.py[i] - w.py[tgt]);
    if (away) return away;
  }
  if (w.faceX && w.faceY) {
    const away = unitAway(-(w.faceX[i] | 0), -(w.faceY[i] | 0));
    if (away) return away;
  }
  const step = OCTANT[i & 7];
  const diag = step[0] !== 0 && step[1] !== 0;
  return {
    x: diag ? step[0] * INV_DIAG : step[0],
    z: diag ? step[1] * INV_DIAG : step[1],
  };
}

/** Record a flee heading for this death. No-op for every other unit type. */
export function noteDeathFlee(w, i, source = -1) {
  const type = w.type?.[i];
  if (type !== UNIT.VILLAGER && type !== UNIT.BRIGAND) return;
  ensure(w);
  const n = w.deathNoteN | 0;
  if (n >= NOTE_CAP) return;
  const away = fleeVector(w, i, source);
  w.deathNoteId[n] = i;
  w.deathNoteX[n] = away.x;
  w.deathNoteZ[n] = away.z;
  w.deathNoteN = n + 1;
}

/** Drain this tick's flee headings. Null when nobody ran. */
export function takeDeathNotes(w) {
  const n = w?.deathNoteN | 0;
  if (!n) return null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { id: w.deathNoteId[i], x: w.deathNoteX[i], z: w.deathNoteZ[i] };
  }
  w.deathNoteN = 0;
  return out;
}
