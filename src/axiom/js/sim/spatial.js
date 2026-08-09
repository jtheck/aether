/** Uniform-grid spatial hash for particle neighbor queries. Engine-agnostic. */

/**
 * @param {object} opts
 * @param {number} [opts.cellSize=4]
 * @param {number} [opts.maxPerCell=64]
 * @param {number} [opts.initialCells=4096]
 */
export function createSpatialHash(opts = {}) {
  const cellSize = opts.cellSize ?? 4;
  const invCell = 1 / cellSize;
  const maxPerCell = opts.maxPerCell ?? 64;
  const cellCap = opts.initialCells ?? 4096;

  /** @type {Map<number, Int32Array>} */
  const cells = new Map();
  /** @type {Map<number, number>} */
  const counts = new Map();

  function cellKey(cx, cy, cz) {
    // 3D hash into signed 32-bit key space
    return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
  }

  function ensureCell(key) {
    let arr = cells.get(key);
    if (!arr) {
      arr = new Int32Array(maxPerCell);
      cells.set(key, arr);
      counts.set(key, 0);
    }
    return arr;
  }

  return {
    cellSize,
    invCell,

    clear() {
      // Drop cells entirely when the map grows — reuse was leaking every explored region
      // (counts reset still iterated all historical keys every frame → FPS bleed while flying).
      if (cells.size > cellCap) {
        cells.clear();
        counts.clear();
        return;
      }
      counts.clear();
      for (const key of cells.keys()) counts.set(key, 0);
    },

    /**
     * Bin particles into the grid. Caller should clear() first when rebuilding.
     * @param {Float32Array} px
     * @param {Float32Array} py
     * @param {Float32Array} pz
     * @param {number} count
     */
    insertAll(px, py, pz, count) {
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(px[i] * invCell);
        const cy = Math.floor(py[i] * invCell);
        const cz = Math.floor(pz[i] * invCell);
        const key = cellKey(cx, cy, cz);
        const arr = ensureCell(key);
        const n = counts.get(key) || 0;
        if (n < maxPerCell) {
          arr[n] = i;
          counts.set(key, n + 1);
        }
      }
    },

    /**
     * Gather neighbor indices into `out` (capped). Returns written count.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} radius
     * @param {Int32Array} out
     */
    queryRadius(x, y, z, radius, out) {
      const r = radius;
      const minCx = Math.floor((x - r) * invCell);
      const maxCx = Math.floor((x + r) * invCell);
      const minCy = Math.floor((y - r) * invCell);
      const maxCy = Math.floor((y + r) * invCell);
      const minCz = Math.floor((z - r) * invCell);
      const maxCz = Math.floor((z + r) * invCell);
      const r2 = r * r;
      let w = 0;
      const outLen = out.length;

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            const key = cellKey(cx, cy, cz);
            const n = counts.get(key);
            if (!n) continue;
            const arr = cells.get(key);
            for (let k = 0; k < n && w < outLen; k++) {
              out[w++] = arr[k];
            }
            if (w >= outLen) return w;
          }
        }
      }
      // Note: callers that need exact radius should filter by distance using store positions.
      // We return cell candidates; r2 kept for future tight filter without alloc.
      void r2;
      void cellCap;
      return w;
    },
  };
}
