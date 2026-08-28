// Overlay-only LOD for health chips + collar *spin* (collars always draw).
// Independent of legacy lodDistances.LOD_ENABLED (VAT / scenery / FX).

/** Max unit health chips written per frame (nearest-N to look-at). */
export const OVERLAY_MAX_BARS = 256;
/** Selected + damaged buildings sit on top of the unit nearest-N budget. */
export const OVERLAY_MAX_BUILDING_BARS = 128;
/**
 * Billboard slot pool. Must stay overlay-sized — never entity / KOTH / stress
 * count. Each slot is up to 13 alpha-sorted sprites.
 */
export const HEALTH_BAR_CAPACITY = OVERLAY_MAX_BARS + OVERLAY_MAX_BUILDING_BARS;
/** Packed holy-shield spheres (not entity-indexed). */
export const OVERLAY_MAX_SHIELDS = 256;
/** Collar burst + idle spin within this XZ distance of the camera eye. */
export const OVERLAY_COLLAR_SPIN_DISTANCE = 320;
export const OVERLAY_COLLAR_SPIN_DISTANCE_SQ =
  OVERLAY_COLLAR_SPIN_DISTANCE * OVERLAY_COLLAR_SPIN_DISTANCE;

/**
 * Camera refs for overlay distance.
 * - `x`/`z`: look-at target (health-bar nearest-N)
 * - `eyeX`/`eyeZ`: camera eye on XZ (collar spin)
 * @param {{ camera?: {
 *   target?: { x: number, z: number },
 *   position?: { x: number, z: number },
 *   worldMatrix?: ArrayLike<number>,
 * } }} renderer
 */
export function overlayCameraRef(renderer) {
  const cam = renderer?.camera;
  const t = cam?.target;
  let x = 0;
  let z = 0;
  if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
    x = t.x;
    z = t.z;
  }
  const wm = cam?.worldMatrix;
  let eyeX = x;
  let eyeZ = z;
  if (wm && Number.isFinite(wm[12])) {
    eyeX = wm[12];
    eyeZ = wm[14];
  } else {
    const p = cam?.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      eyeX = p.x;
      eyeZ = p.z;
    }
  }
  if (!Number.isFinite(t?.x) || !Number.isFinite(t?.z)) {
    x = eyeX;
    z = eyeZ;
  }
  return { x, z, eyeX, eyeZ };
}

function swapI32(a, i, j) {
  const t = a[i];
  a[i] = a[j];
  a[j] = t;
}

function swapF32(a, i, j) {
  const t = a[i];
  a[i] = a[j];
  a[j] = t;
}

/** Partition so the `maxN` nearest (by d2) occupy slots [0, maxN). */
function selectNearest(ids, d2, count, maxN) {
  let left = 0;
  let right = count - 1;
  const goal = maxN - 1;
  while (left < right) {
    const pivot = d2[(left + right) >> 1];
    let i = left;
    let j = right;
    while (i <= j) {
      while (d2[i] < pivot) i++;
      while (d2[j] > pivot) j--;
      if (i <= j) {
        swapI32(ids, i, j);
        swapF32(d2, i, j);
        i++;
        j--;
      }
    }
    if (goal <= j) right = j;
    else if (goal >= i) left = i;
    else break;
  }
}

/**
 * Mark the nearest `maxN` candidates in `allowed` (index by entity id).
 * Mutates `ids` / `d2` order. Returns how many were marked.
 * @param {Int32Array} ids
 * @param {Float32Array} d2
 * @param {number} count
 * @param {number} maxN
 * @param {Uint8Array} allowed
 */
export function markNearestN(ids, d2, count, maxN, allowed) {
  allowed.fill(0);
  if (count <= 0 || maxN <= 0) return 0;
  if (count <= maxN) {
    for (let k = 0; k < count; k++) allowed[ids[k]] = 1;
    return count;
  }
  selectNearest(ids, d2, count, maxN);
  for (let k = 0; k < maxN; k++) allowed[ids[k]] = 1;
  return maxN;
}
