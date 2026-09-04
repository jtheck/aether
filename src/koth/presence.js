// Presence on the global broadcast is a discovery heartbeat, not membership.
// A peer is in a match only when they announce that match as live and are not
// still in the private browse sandbox.

import { KOTH_APP_STATE, SHARD_PHASE } from './protocol.js';

/** Listing lobbies: in the matchmaking channel, not a live shard. */
export function isBrowsePresence(data) {
  return data?.appState === KOTH_APP_STATE.PRIVATE_SANDBOX
    && data?.phase !== SHARD_PHASE.LIVE;
}

/** Peer said they left `matchId` — drop them from that lobby, keep the match. */
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

/** In `matchId` as a spectator — not a browser and not a seated player. */
export function isSpectatorMember(data, matchId) {
  if (!isLiveMatchMember(data, matchId)) return false;
  return data.role === 'spectator' || data.appState === KOTH_APP_STATE.SPECTATOR;
}
