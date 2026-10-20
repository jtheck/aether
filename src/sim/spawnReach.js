// How far a ground unit can walk from a tile. Same steps as findPath:
// four sides, and a diagonal only when both flanking tiles are open.

import { isPassable } from './field.js';

/**
 * A lone agora pad plus its shallow shore is about 129 tiles.
 * Past this, the start has joined real land.
 */
export const SPAWN_REACH_MIN = 400;

const CARD = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const DIAG = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** Walkable tiles reachable from (tx, tz), capped at `limit`. */
export function walkableReach(field, tx, tz, limit = SPAWN_REACH_MIN) {
  const cap = limit | 0;
  if (cap <= 0 || !isPassable(field, tx, tz)) return 0;
  const width = field.width | 0;
  const height = field.height | 0;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const start = tz * width + tx;
  seen[start] = 1;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  let count = 0;
  while (head < tail) {
    const key = queue[head++];
    count++;
    if (count >= cap) return count;
    const x = key % width;
    const z = (key / width) | 0;
    for (let i = 0; i < CARD.length; i++) {
      const nx = x + CARD[i][0];
      const nz = z + CARD[i][1];
      if (!isPassable(field, nx, nz)) continue;
      const next = nz * width + nx;
      if (seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
    for (let i = 0; i < DIAG.length; i++) {
      const dx = DIAG[i][0];
      const dz = DIAG[i][1];
      const nx = x + dx;
      const nz = z + dz;
      if (!isPassable(field, nx, nz)) continue;
      if (!isPassable(field, x + dx, z) || !isPassable(field, x, z + dz)) continue;
      const next = nz * width + nx;
      if (seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return count;
}
