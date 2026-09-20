// Gamepad pie-menu aim — stick up is −π/2 (screen-top); stick right is π
// (screen-right) because the disc's B axis is screen-left.
// Agora is two rings: half throw = inner pie, full throw = outer pads.
// A second stick at full throw also takes the outer ring.

export const RADIAL_STICK_DEADZONE = 0.22;
/** One-stick half throw — inner ring when the menu has two levels. */
export const RADIAL_STICK_INNER = 0.36;
/** Stay on the inner ring down to here once aimed (sloppy hardware). */
export const RADIAL_STICK_INNER_LEAVE = 0.24;
/** One-stick / second-stick full throw — outer ring. */
export const RADIAL_STICK_OUTER = 0.72;
/** Stay on the outer ring down to here once aimed. */
export const RADIAL_STICK_OUTER_LEAVE = 0.55;

/**
 * @param {number} a
 * @param {number} b
 */
export function angAbsDelta(a, b) {
  let d = (Number(a) || 0) - (Number(b) || 0);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} [dz]
 */
export function stickPolar(x, y, dz = RADIAL_STICK_DEADZONE) {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(ax, ay);
  if (!(mag > dz)) return { mag: 0, ang: 0, live: false };
  // Flip X so clockwise stick matches the tilted disc (B is screen-left).
  return { mag, ang: Math.atan2(ay, -ax), live: true };
}

/**
 * @param {number} ang
 * @param {{ ang?: number }[] | null | undefined} slices
 */
export function nearestRadialSlice(ang, slices) {
  if (!slices?.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const s of slices) {
    if (!s || !Number.isFinite(s.ang)) continue;
    const d = angAbsDelta(ang, s.ang);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * @param {{ mag: number, live: boolean }} left
 * @param {{ mag: number, live: boolean }} right
 * @param {boolean} useL
 * @param {boolean} useR
 */
function pickAim(left, right, useL, useR) {
  if (useL && useR) return left.mag >= right.mag ? left : right;
  return useL ? left : right;
}

function asPick(slice, ring) {
  if (!slice) return null;
  const pick = { kind: slice.kind, ang: slice.ang, ring };
  if (slice.id != null) pick.id = slice.id;
  return pick;
}

/**
 * Which ring a live stick is on. `held` is last frame's ring so a sloppy
 * throw does not drop inner→none or outer→inner mid-aim.
 * @param {{ mag: number, live: boolean }} polar
 * @param {boolean} twoLevel
 * @param {'inner' | 'outer' | null | undefined} held
 */
export function radialStickRing(polar, twoLevel, held) {
  if (!polar?.live) return null;
  const mag = polar.mag;
  if (twoLevel) {
    const outerGate = held === 'outer' ? RADIAL_STICK_OUTER_LEAVE : RADIAL_STICK_OUTER;
    const innerGate = held ? RADIAL_STICK_INNER_LEAVE : RADIAL_STICK_INNER;
    if (mag >= outerGate) return 'outer';
    if (mag >= innerGate) return 'inner';
    return null;
  }
  const gate = held === 'outer' ? RADIAL_STICK_INNER_LEAVE : RADIAL_STICK_INNER;
  return mag >= gate ? 'outer' : null;
}

/**
 * Map both sticks onto a radial. Two-level menus use half throw for `inner`
 * and full throw (either stick) for `outer`. A one-ring menu treats half or
 * full throw as `outer`.
 *
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number } | null | undefined} read
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 * @param {'inner' | 'outer' | null | undefined} [heldRing]
 */
export function radialStickPick(read, targets, heldRing = null) {
  const inner = targets?.inner ?? [];
  const outer = targets?.outer ?? [];
  if (!inner.length && !outer.length) return null;

  const left = stickPolar(read?.lx, read?.ly);
  const right = stickPolar(read?.rx, read?.ry);
  const twoLevel = inner.length > 0 && outer.length > 0;
  const leftRing = radialStickRing(left, twoLevel, heldRing);
  const rightRing = radialStickRing(right, twoLevel, heldRing);

  if (twoLevel) {
    const leftOuter = leftRing === 'outer';
    const rightOuter = rightRing === 'outer';
    const leftInner = leftRing === 'inner';
    const rightInner = rightRing === 'inner';
    if (leftOuter || rightOuter) {
      const aim = pickAim(left, right, leftOuter, rightOuter);
      return asPick(nearestRadialSlice(aim.ang, outer), 'outer');
    }
    if (leftInner || rightInner) {
      const aim = pickAim(left, right, leftInner, rightInner);
      return asPick(nearestRadialSlice(aim.ang, inner), 'inner');
    }
    return null;
  }

  if ((leftRing === 'outer' || rightRing === 'outer') && outer.length) {
    const aim = pickAim(left, right, leftRing === 'outer', rightRing === 'outer');
    return asPick(nearestRadialSlice(aim.ang, outer), 'outer');
  }
  return null;
}
