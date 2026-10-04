/**
 * Faded corpses stay in the thin-instance batches until a compact. The gate is a
 * fraction of units still fading or alive — not of everyone who ever spawned.
 * A wiped stress army used to sit just under 8% of the original count and keep
 * those zero-scale VAT slots in the color pass and every shadow cascade.
 *
 * @param {{
 *   count: number,
 *   fadedCorpses: number,
 *   retired?: number,
 *   now: number,
 *   lastCompact: number,
 *   minHold?: number,
 *   fraction?: number,
 *   minIntervalMs?: number,
 * }} opts
 */
export function corpseCompactDue(opts) {
  const faded = opts.fadedCorpses | 0;
  const retired = opts.retired | 0;
  const held = faded - retired;
  if (held <= 0) return false;
  const livingish = (opts.count | 0) - faded;
  if (livingish <= 0) return true;
  const minHold = opts.minHold ?? 64;
  const fraction = opts.fraction ?? 0.08;
  if (held < minHold) return false;
  if (held + 1e-6 < livingish * fraction) return false;
  const minIntervalMs = opts.minIntervalMs ?? 1000;
  return opts.now - opts.lastCompact > minIntervalMs;
}
