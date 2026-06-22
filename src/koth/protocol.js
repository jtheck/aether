// King of the Hill — wire protocol + deterministic negotiation helpers.

export const LOBBY = 'aether-koth';
export const BROADCAST = 'aether-koth';
export const MAX_SLOTS = 5;
export const LAG_TIMEOUT_MS = 45_000;
export const SHARD_ANNOUNCE_MS = 4000;
export const CATCHUP_LEDGER_KEEP = 600;

/** @typedef {'empty' | 'active' | 'reserved' | 'spectator'} SlotState */

/** @typedef {{ userId: string | null, state: SlotState, playerId: number }} SlotEntry */

export const SHARD_PHASE = {
  SANDBOX: 'sandbox',
  LIVE: 'live',
  EMPTY: 'empty',
};

export const MSG = {
  // broadcast (server-relayed presence)
  SHARD_PRESENCE: 'shard_presence',

  // P2P shard lifecycle
  SHARD_HELLO: 'shard_hello',
  SHARD_STATE: 'shard_state',
  MATCH_RESET: 'match_reset',

  // lockstep (existing)
  COMMAND_FRAME: 'command_frame',
  TICK_CONFIRM: 'tick_confirm',
  REQUEST_TICK_CONFIRM: 'request_tick_confirm',

  // catch-up / join
  SNAPSHOT_REQUEST: 'snapshot_request',
  SNAPSHOT_OFFER: 'snapshot_offer',
  LEDGER_CHUNK: 'ledger_chunk',
  CATCHUP_READY: 'catchup_ready',
  JOIN_INTENT: 'join_intent',
  JOIN_PREPARE: 'join_prepare',
  JOIN_ACCEPT: 'join_accept',

  // roster / slots
  ROSTER_UPDATE: 'roster_update',
  SLOT_RELEASE: 'slot_release',
  SLOT_DEFEAT: 'slot_defeat',
  SHARD_GONE: 'shard_gone',

  PING: 'ping',
  PONG: 'pong',
};

/** Lowest userId breaks ties — "convene" peer for match_reset / join_accept. */
export function negotiateConvene(userIds) {
  if (!userIds.length) return null;
  return [...userIds].sort()[0];
}

/** Deterministic slot order: sorted userIds → slots 0..n-1. */
export function assignSlotsFromUserIds(userIds) {
  const sorted = [...userIds].sort();
  /** @type {SlotEntry[]} */
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({
    userId: null,
    state: 'empty',
    playerId: i,
  }));
  for (let i = 0; i < sorted.length && i < MAX_SLOTS; i++) {
    slots[i] = { userId: sorted[i], state: 'active', playerId: i };
  }
  return slots;
}

/** @param {SlotEntry[]} slots */
export function activePlayerIds(slots) {
  const out = [];
  for (const s of slots) {
    if (s.state === 'active' && s.userId) out.push(s.playerId);
  }
  return out.sort((a, b) => a - b);
}

/** @param {SlotEntry[]} slots @param {string} userId */
export function slotForUser(slots, userId) {
  for (const s of slots) {
    if (s.userId === userId) return s;
  }
  return null;
}

/** @param {SlotEntry[]} slots */
export function cloneSlots(slots) {
  return slots.map((s) => ({ ...s }));
}

export function shortId(id) {
  return id ? id.slice(-8) : '?';
}
