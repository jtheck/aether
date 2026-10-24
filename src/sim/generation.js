/**
 * Deterministic simulation rules generation shared by every live transport and
 * replay files. Bump when the same command tape can build a different world.
 * Presentation, fog, and camera-only changes do not bump this number.
 */
export const SIM_GENERATION = 1;

/** Live peers must explicitly advertise this exact generation. */
export function hasCurrentSimGeneration(value, current = SIM_GENERATION) {
  return Number.isInteger(value) && value === current;
}
