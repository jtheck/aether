// Local RTS control groups — coloured side pads assign on hold, select on
// click, jump the camera on a second tap of the same pad / number key.
// Entity indices are stable within a match (spawn is append-only); a new world
// must call clearControlGroups() so stale ids cannot select the next match.

import { isBuildingAlive } from '../../sim/buildings.js';

export const CONTROL_GROUP_COUNT = 6;
/** Hold this long on a pad to assign the current selection (click selects). */
export const CONTROL_GROUP_HOLD_MS = 400;
/** Second tap of the same group within this window centers the camera. */
export const CONTROL_GROUP_DOUBLE_MS = 429;

const KEY_TO_GROUP = {
  Digit1: 0, Numpad1: 0,
  Digit2: 1, Numpad2: 1,
  Digit3: 2, Numpad3: 2,
  Digit4: 3, Numpad4: 3,
  Digit5: 4, Numpad5: 4,
  Digit6: 5, Numpad6: 5,
};

/** @param {string} code KeyboardEvent.code */
export function controlGroupIdFromCode(code) {
  const id = KEY_TO_GROUP[code];
  return id == null ? null : id;
}

export function createEmptyControlGroups() {
  return Array.from({ length: CONTROL_GROUP_COUNT }, () => ({
    units: [],
    buildings: [],
  }));
}

/**
 * @param {{ units: number[], buildings: { kind: string, index: number }[] }[]} groups
 * @param {number} id
 * @param {number[]} units
 * @param {{ kind: string, index: number }[]} buildings
 */
export function assignControlGroup(groups, id, units, buildings) {
  const i = id | 0;
  if (i < 0 || i >= CONTROL_GROUP_COUNT) return false;
  const blds = [];
  const list = buildings ?? [];
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (!b?.kind) continue;
    blds.push({ kind: b.kind, index: b.index | 0 });
  }
  groups[i] = { units: (units ?? []).slice(), buildings: blds };
  return true;
}

/**
 * Drop dead / foreign / missing members. Does not mutate `group`.
 * @param {{ units?: number[], buildings?: { kind: string, index: number }[] } | null | undefined} group
 * @param {{ count: number, alive: Uint8Array, owner: Uint8Array }} world
 * @param {number} localPlayerId
 * @param {{ owner?: number, hp?: number }[] | null | undefined} buildings
 * @param {{ owner?: number }[] | null | undefined} agoras
 */
export function livingControlGroup(group, world, localPlayerId, buildings, agoras) {
  /** @type {number[]} */
  const units = [];
  const srcU = group?.units ?? [];
  const n = world?.count | 0;
  for (let k = 0; k < srcU.length; k++) {
    const id = srcU[k] | 0;
    if (id < 0 || id >= n) continue;
    if (!world.alive[id] || (world.owner[id] | 0) !== localPlayerId) continue;
    units.push(id);
  }
  /** @type {{ kind: 'agora' | 'building', index: number }[]} */
  const blds = [];
  const srcB = group?.buildings ?? [];
  for (let k = 0; k < srcB.length; k++) {
    const sel = srcB[k];
    if (sel?.kind === 'agora') {
      const a = agoras?.[sel.index];
      if (!a || (a.owner | 0) !== localPlayerId) continue;
      blds.push({ kind: 'agora', index: sel.index | 0 });
    } else if (sel?.kind === 'building') {
      const b = buildings?.[sel.index];
      if (!isBuildingAlive(b) || (b.owner | 0) !== localPlayerId) continue;
      blds.push({ kind: 'building', index: sel.index | 0 });
    }
  }
  return { units, buildings: blds };
}

export function controlGroupFilled(members) {
  return (members?.units?.length ?? 0) > 0 || (members?.buildings?.length ?? 0) > 0;
}

/**
 * Same pad / number key again inside the double-tap window.
 * @param {{ id: number, t: number } | null | undefined} prev
 * @param {number} id
 * @param {number} now
 * @param {number} [windowMs]
 */
export function isControlGroupDoubleTap(prev, id, now, windowMs = CONTROL_GROUP_DOUBLE_MS) {
  return !!prev && prev.id === id && now - prev.t <= windowMs;
}
