// Deterministic roster — slots, reservations, spectator promotion.

import { MAX_SLOTS, assignSlotsFromUserIds, cloneSlots } from './protocol.js';

/** @typedef {import('./protocol.js').SlotEntry} SlotEntry */

export function createEmptyRoster() {
  return Array.from({ length: MAX_SLOTS }, (_, i) => ({
    userId: null,
    state: 'empty',
    playerId: i,
  }));
}

/**
 * Build roster from connected peer userIds (sandbox→live start, fresh match).
 * @param {string[]} userIds
 */
export function rosterFromPeers(userIds) {
  return assignSlotsFromUserIds(userIds);
}

/**
 * Reserve a slot for reconnect within TTL.
 * @param {SlotEntry[]} slots
 * @param {number} playerId
 * @param {string} userId
 */
export function reserveSlot(slots, playerId, userId) {
  const next = cloneSlots(slots);
  const s = next[playerId];
  if (!s) return next;
  s.userId = userId;
  s.state = 'reserved';
  return next;
}

/**
 * Claim first empty/reserved slot for a joining user (spectator→player).
 * @param {SlotEntry[]} slots
 * @param {string} userId
 */
export function claimOpenSlot(slots, userId) {
  const next = cloneSlots(slots);
  const existing = next.find((s) => s.userId === userId);
  if (existing) {
    if (existing.state === 'active') return { slots: next, playerId: existing.playerId };
    if (existing.state === 'spectator' || existing.state === 'reserved') {
      existing.state = 'active';
      return { slots: next, playerId: existing.playerId };
    }
  }

  for (const s of next) {
    if (s.state === 'empty') {
      s.userId = userId;
      s.state = 'active';
      return { slots: next, playerId: s.playerId };
    }
  }
  return { slots: next, playerId: -1 };
}

export function reserveOpenSlot(slots, userId) {
  const next = cloneSlots(slots);
  const existing = next.find((s) => s.userId === userId);
  if (existing) {
    if (existing.state === 'active' || existing.state === 'reserved') {
      return { slots: next, playerId: existing.playerId };
    }
    if (existing.state === 'spectator') {
      existing.state = 'reserved';
      return { slots: next, playerId: existing.playerId };
    }
  }

  for (const s of next) {
    if (s.state === 'empty') {
      s.userId = userId;
      s.state = 'reserved';
      return { slots: next, playerId: s.playerId };
    }
  }
  return { slots: next, playerId: -1 };
}


export function activateSlot(slots, playerId, userId) {
  const next = cloneSlots(slots);
  const s = next[playerId];
  if (!s || !userId) return { slots: next, playerId: -1 };
  const current = next.find((entry) => entry.userId === userId);
  if (current && current.playerId !== playerId) {
    current.userId = null;
    current.state = 'empty';
  }
  s.userId = userId;
  s.state = 'active';
  return { slots: next, playerId };
}


/** @param {SlotEntry[]} slots @param {string} userId */
export function releaseUser(slots, userId, toSpectator = true) {
  const next = cloneSlots(slots);
  for (const s of next) {
    if (s.userId !== userId) continue;
    if (toSpectator) {
      s.state = 'spectator';
    } else {
      s.userId = null;
      s.state = 'empty';
    }
  }
  return next;
}

/** @param {SlotEntry[]} slots */
export function countActive(slots) {
  let n = 0;
  for (const s of slots) if (s.state === 'active') n++;
  return n;
}

/** @param {SlotEntry[]} slots */
export function hasLiveShard(slots) {
  return countActive(slots) > 0;
}
