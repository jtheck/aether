// Radial / HUD gate: requirements first (locked), then bank (unafford).
// Matches v1 menu styling — grey/black when locked, red when broke.

import { canAffordBank } from './resources.js';

export const MENU_OK = 'ok';
export const MENU_UNAFFORD = 'unafford';
export const MENU_LOCKED = 'locked';

/**
 * @param {{
 *   cost?: Record<string, number> | null,
 *   requires?: readonly string[] | null,
 *   bank?: Record<string, number> | null,
 *   ownedTypes?: Set<string> | Iterable<string> | null,
 * }} opts
 * @returns {'ok' | 'unafford' | 'locked'}
 */
export function menuGateState(opts) {
  const requires = opts?.requires;
  if (requires?.length) {
    const owned = opts.ownedTypes instanceof Set
      ? opts.ownedTypes
      : new Set(opts.ownedTypes ?? []);
    for (let i = 0; i < requires.length; i++) {
      if (!owned.has(requires[i])) return MENU_LOCKED;
    }
  }
  if (!canAffordBank(opts?.bank, opts?.cost)) return MENU_UNAFFORD;
  return MENU_OK;
}
