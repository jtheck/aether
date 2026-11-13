/**
 * Deterministic simulation rules generation shared by every live transport and
 * replay files. Bump when the same command tape can build a different world.
 * Presentation, fog, and camera-only changes do not bump this number.
 */
import { SIM_RULES_GENERATION, SIM_RULES_SHA256 } from './rulesEpoch.js';

export const SIM_GENERATION = 23;
export const SIM_RULES_ID = SIM_RULES_SHA256.slice(0, 12);

if (SIM_RULES_GENERATION !== SIM_GENERATION) {
  throw new Error(
    `Simulation rules epoch ${SIM_RULES_GENERATION} does not match generation ${SIM_GENERATION}`,
  );
}

/** Live peers must explicitly advertise this exact generation. */
export function hasCurrentSimGeneration(value, current = SIM_GENERATION) {
  return Number.isInteger(value) && value === current;
}

/** Same-generation peers must also run the exact deterministic source epoch. */
export function hasCurrentSimRules(value, current = SIM_RULES_ID) {
  return typeof value === 'string' && value === current;
}
