// Overlay-only LOD for health chips + collar *spin* (collars always draw).
// Independent of legacy lodDistances.LOD_ENABLED (VAT / scenery / FX).

/** Max unit health chips written per frame. Selected take slots first. */
export const OVERLAY_MAX_BARS = 3072;
/** Selected + damaged buildings sit on top of the unit budget. */
export const OVERLAY_MAX_BUILDING_BARS = 128;
/**
 * Billboard slot pool. Must stay overlay-sized — never entity / KOTH / stress
 * count. Each slot is up to 13 alpha-sorted sprites.
 */
export const HEALTH_BAR_CAPACITY = OVERLAY_MAX_BARS + OVERLAY_MAX_BUILDING_BARS;
/** Packed holy-shield spheres (not entity-indexed). */
export const OVERLAY_MAX_SHIELDS = 256;
/** Full-size chips within this XZ distance of the look-at; beyond = one step smaller. */
export const OVERLAY_BAR_NEAR_DISTANCE = 280;
export const OVERLAY_BAR_NEAR_DISTANCE_SQ =
  OVERLAY_BAR_NEAR_DISTANCE * OVERLAY_BAR_NEAR_DISTANCE;
/** Collar burst + idle spin within this XZ distance of the camera eye. */
export const OVERLAY_COLLAR_SPIN_DISTANCE = 320;
export const OVERLAY_COLLAR_SPIN_DISTANCE_SQ =
  OVERLAY_COLLAR_SPIN_DISTANCE * OVERLAY_COLLAR_SPIN_DISTANCE;

/**
 * Camera refs for overlay distance.
 * - `x`/`z`: look-at target (health-bar pick + near/far size)
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

/** Partition so the `maxN` nearest (by d2) occupy slots [offset, offset + maxN). */
function selectNearest(ids, d2, count, maxN, offset = 0) {
  if (count <= maxN) return;
  let left = offset;
  let right = offset + count - 1;
  const goal = offset + maxN - 1;
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

/** True when the chip should use the smaller far step (look-at XZ). */
export function overlayBarIsFar(dx, dz) {
  return dx * dx + dz * dz > OVERLAY_BAR_NEAR_DISTANCE_SQ;
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

/**
 * Selected candidates always take a slot (nearest selected if they overflow).
 * Remaining slots go to the nearest wounded. Mutates `ids` / `d2` order.
 * @param {Int32Array} ids
 * @param {Float32Array} d2
 * @param {number} count
 * @param {number} maxN
 * @param {ArrayLike<number>} selectedById 1 if that entity id is selected
 * @param {Uint8Array} allowed
 */
export function markSelectedThenNearest(ids, d2, count, maxN, selectedById, allowed) {
  allowed.fill(0);
  if (count <= 0 || maxN <= 0) return 0;

  let selN = 0;
  for (let i = 0; i < count; i++) {
    if (!selectedById[ids[i]]) continue;
    if (i !== selN) {
      swapI32(ids, i, selN);
      swapF32(d2, i, selN);
    }
    selN++;
  }

  if (selN >= maxN) {
    selectNearest(ids, d2, selN, maxN);
    for (let k = 0; k < maxN; k++) allowed[ids[k]] = 1;
    return maxN;
  }

  for (let k = 0; k < selN; k++) allowed[ids[k]] = 1;
  const remain = maxN - selN;
  const hurtN = count - selN;
  if (remain <= 0 || hurtN <= 0) return selN;
  selectNearest(ids, d2, hurtN, remain, selN);
  const take = Math.min(hurtN, remain);
  for (let k = 0; k < take; k++) allowed[ids[selN + k]] = 1;
  return selN + take;
}
