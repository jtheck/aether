/** Chunked infinite volume — load/unload cubic regions around a focus point. */

/**
 * @param {number} x
 * @param {number} chunkSize
 */
export function coordToChunk(x, chunkSize) {
  return Math.floor(x / chunkSize);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 */
export function chunkKey(cx, cy, cz) {
  return `${cx},${cy},${cz}`;
}

/**
 * @param {string} key
 */
export function parseChunkKey(key) {
  const [cx, cy, cz] = key.split(',').map(Number);
  return { cx, cy, cz };
}

/**
 * Chebyshev neighborhood (cube of chunks).
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} radius
 * @param {(cx: number, cy: number, cz: number) => void} fn
 */
export function forEachChunkInRadius(cx, cy, cz, radius, fn) {
  const r = radius | 0;
  for (let dz = -r; dz <= r; dz++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        fn(cx + dx, cy + dy, cz + dz);
      }
    }
  }
}

export function maxChunksForRadius(radius) {
  const e = 2 * (radius | 0) + 1;
  return e * e * e;
}

/**
 * Full-chunk equivalents inside the inscribed live sphere
 * (r = (radius + 0.5) * chunkSize). Particle budget divides by this, not the
 * paging cube — corner chunks never fill and must not steal quota.
 * @param {number} radius
 */
export function sphereChunkEquivalent(radius) {
  const R = (radius | 0) + 0.5;
  return (4 / 3) * Math.PI * R * R * R;
}

/**
 * World-space AABB for a chunk index.
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} chunkSize
 */
export function chunkBounds(cx, cy, cz, chunkSize) {
  return {
    minX: cx * chunkSize,
    minY: cy * chunkSize,
    minZ: cz * chunkSize,
    size: chunkSize,
  };
}
