// One recent list per ladder player. 1v1, 2v2, and King of the Hill share it.

export const RECENT_LIMIT = 15;
export const RECENT_SK = 'recent';

const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MATCH_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isLadderPlayerId(playerId) {
  return PLAYER_ID.test(String(playerId ?? '').toLowerCase());
}

export function isMatchId(matchId) {
  return MATCH_ID.test(String(matchId ?? ''));
}

export function matchSnapshotKey(matchId) {
  return `ladder/matches/${String(matchId).toLowerCase()}.json`;
}

export function recentPartition(playerId) {
  return `recent#${String(playerId).toLowerCase()}`;
}

export function playerRecentKey(playerId) {
  return `ladder/players/${String(playerId).toLowerCase()}.json`;
}

/** Workshop publishedfileid. Absent on a match the player did not save. */
const REPLAY_ID = /^\d{1,20}$/;

export function matchRecent(entry) {
  const mode = entry?.mode === '2v2' || entry?.mode === 'KOTH' ? entry.mode : '1v1';
  const result = entry?.result === 'loss' ? 'loss' : 'win';
  const delta = Number.isFinite(entry?.delta) ? entry.delta | 0 : 0;
  const rating = Number.isFinite(entry?.rating) ? entry.rating | 0 : 0;
  const opponent = String(entry?.opponent || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Player';
  const at = String(entry?.at || '');
  const row = { at, mode, result, opponent, delta, rating };
  const replay = String(entry?.replay ?? '').trim();
  if (REPLAY_ID.test(replay)) row.replay = replay;
  const matchId = String(entry?.matchId ?? '').toLowerCase();
  if (MATCH_ID.test(matchId)) row.matchId = matchId;
  return row;
}

export function prependRecent(existing, entry) {
  const prior = Array.isArray(existing) ? existing : [];
  return [matchRecent(entry), ...prior.map(matchRecent)].slice(0, RECENT_LIMIT);
}

/** History writes for one settle. `loaded` is the current recent item per player, if any. */
export function historyPuts(entriesById, loaded) {
  return Object.entries(entriesById).map(([playerId, entry]) => {
    const row = loaded?.[playerId];
    const oldRev = Number.isInteger(row?.rev) ? row.rev : null;
    return {
      pk: recentPartition(playerId),
      sk: RECENT_SK,
      playerId,
      oldRev,
      recent: prependRecent(row?.recent, entry),
    };
  });
}
