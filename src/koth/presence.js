// Presence on the global broadcast is a discovery heartbeat, not membership.
// A peer is in a match only when they announce that match as live and are not
// still in the private browse sandbox.

import { KOTH_APP_STATE, SHARD_PHASE } from './protocol.js';

/**
 * Ended matches can keep receiving live heartbeats from spectators that missed
 * the host's shutdown. Refresh the tombstone for every such heartbeat so the
 * old match cannot be re-added until every stale announcer has gone quiet.
 */
export function suppressEndedMatchPresence(endedMatches, data, now = Date.now()) {
  const id = data?.matchId;
  if (!id) return false;
  if (!data.gone && !endedMatches.has(id)) return false;
  endedMatches.set(id, now);
  return true;
}

export function pruneEndedMatches(endedMatches, ttlMs, now = Date.now()) {
  for (const [id, lastSeenAt] of endedMatches) {
    if (now - lastSeenAt > ttlMs) endedMatches.delete(id);
  }
}

/** Listing lobbies: in the matchmaking channel, not a live shard. */
export function isBrowsePresence(data) {
  return data?.appState === KOTH_APP_STATE.PRIVATE_SANDBOX
    && data?.phase !== SHARD_PHASE.LIVE;
}

/** Peer said they left `matchId` - drop them from that lobby, keep the match. */
export function isMatchLeavePresence(data, matchId) {
  return !!(data?.left && data.from && data.matchId && data.matchId === matchId);
}

/** In `matchId` as a live member (player or spectator). */
export function isLiveMatchMember(data, matchId) {
  if (!data?.from || !data.matchId || !matchId) return false;
  if (data.matchId !== matchId) return false;
  if (data.gone || data.left) return false;
  if (data.phase !== SHARD_PHASE.LIVE) return false;
  if (data.appState === KOTH_APP_STATE.PRIVATE_SANDBOX) return false;
  return true;
}

/** In `matchId` as a spectator - not a browser and not a seated player. */
export function isSpectatorMember(data, matchId) {
  if (!isLiveMatchMember(data, matchId)) return false;
  return data.role === 'spectator' || data.appState === KOTH_APP_STATE.SPECTATOR;
}

/** A stable spectator heartbeat relinquishes a stale active seat; JOINING does not. */
export function relinquishesActiveSeat(data, matchId) {
  return isSpectatorMember(data, matchId)
    && data.role === 'spectator'
    && data.appState === KOTH_APP_STATE.SPECTATOR;
}
