// Deterministic PRNG (Mulberry32). The simulation's ONLY source of randomness.
// Math.random() is banned inside sim/ — it is non-deterministic and would desync
// lockstep instantly.
//
// State is a single uint32 held on the returned object as `.s`, so it can be
// folded into the world checksum and snapshotted/restored with the rest of state.

export function makeRng(seed) {
  return { s: seed >>> 0 };
}

export function rngU32(r) {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

// Integer in [min, max). Uses modulo; bias is negligible for gameplay ranges.
export function rngRange(r, min, max) {
  const span = max - min;
  return min + (rngU32(r) % span);
}

// 0..ONE-1 as a Q16.16 fraction in [0, 1).
export function rngFrac(r) {
  return rngU32(r) & 0xffff;
}
