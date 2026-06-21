// Q16.16 fixed-point math. The ONLY numeric type the simulation is allowed to use.
//
// A fixed value is a 32-bit signed integer equal to (real * 2^16).
// Constraint: keep |real| < 32768 so the raw value fits in int32 and the
// bitwise operations below stay valid. That is a 32768-unit world half-extent,
// far larger than any Aether map.
//
// Why fixed-point instead of floats: IEEE-754 +,-,*,/ and sqrt are deterministic
// across browsers, but the transcendentals (sin/cos/tan/exp/log/pow) are NOT
// guaranteed bit-identical. Lockstep P2P cannot tolerate a single differing bit.
// Fixed-point sidesteps the whole class of problems and makes checksums trivial.

export const SHIFT = 16;
export const ONE = 1 << SHIFT; // 65536
export const HALF = ONE >> 1;
export const FRAC_MASK = ONE - 1;

export function fromInt(n) {
  return n << SHIFT;
}

// fromFloat is for AUTHORING/config only (map data, tuning constants). Never call
// it inside the per-tick simulation with a runtime float.
export function fromFloat(f) {
  return Math.round(f * ONE);
}

export function toFloat(x) {
  return x / ONE;
}

// Floor toward -infinity (matches the mul/div semantics below).
export function toInt(x) {
  return x >> SHIFT;
}

// Exact floor((a*b) / 2^16) without ever exceeding Number.MAX_SAFE_INTEGER.
// Decompose b = bHi*2^16 + bLo so each partial product stays well under 2^53.
export function mul(a, b) {
  const bHi = b >> SHIFT; // signed integer part
  const bLo = b & FRAC_MASK; // fractional part, 0..65535
  // a*bHi is integer; a*bLo (<= ~2^44) is floor-divided. Do not use >> here:
  // a*bLo can exceed 32 bits, which would corrupt a bitwise shift.
  return a * bHi + Math.floor((a * bLo) / ONE);
}

// floor((a / b)) in fixed-point. a*ONE stays within safe-integer range.
export function div(a, b) {
  return Math.floor((a * ONE) / b);
}

// sqrt of a fixed value, returned as fixed. Math.sqrt is correctly rounded
// (IEEE-754) and therefore deterministic. x*ONE <= ~2^44 stays exact.
export function sqrt(x) {
  return Math.round(Math.sqrt(x * ONE));
}

// Magnitude of a fixed-point vector.
export function len(x, y) {
  return sqrt(mul(x, x) + mul(y, y));
}

// Squared distance (cheaper, no sqrt) between two fixed-point points.
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return mul(dx, dx) + mul(dy, dy);
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function abs(x) {
  return x < 0 ? -x : x;
}
