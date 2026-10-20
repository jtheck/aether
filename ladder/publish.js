// Public boards live under the ladder/ prefix. CloudFront behavior ladder/*
// forwards that path, so /ladder/index.json is the object ladder/index.json.

export const INDEX_KEY = 'ladder/index.json';

export function boardKey(season, board) {
  return `ladder/seasons/${season}/${board}.json`;
}

export function boardPath(season, board) {
  return `seasons/${season}/${board}.json`;
}

function rowPlayerId(row) {
  return row.playerId ?? String(row.sk ?? '').slice(2);
}

export function boardDocument({ season, board, rows, updatedAt }) {
  const sorted = [...rows].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.games !== a.games) return b.games - a.games;
    const aId = rowPlayerId(a);
    const bId = rowPlayerId(b);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
  return {
    season,
    board,
    updatedAt,
    rows: sorted.map((row, index) => ({
      rank: index + 1,
      playerId: rowPlayerId(row),
      name: row.name || '',
      rating: row.rating,
      wins: row.wins ?? 0,
      losses: Math.max(0, (row.games | 0) - (row.wins ?? 0)),
    })),
  };
}

/** Point the index at this season. A season change keeps old ids and starts a new board map. */
export function mergeIndex(existing, { season, board }) {
  const path = boardPath(season, board);
  const prior = existing && typeof existing === 'object' ? existing : null;
  const seasons = Array.isArray(prior?.seasons) ? prior.seasons.filter((id) => typeof id === 'string') : [];
  if (!seasons.includes(season)) seasons.push(season);
  const sameSeason = prior?.current === season;
  const boards = sameSeason && prior.boards && typeof prior.boards === 'object' ? { ...prior.boards } : {};
  boards[board] = path;
  return { current: season, seasons, boards };
}
