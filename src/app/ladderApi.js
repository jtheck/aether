export const LADDER_URL = 'https://3vpb374tfhjnta5mcmo7zq3fqq0lzxbh.lambda-url.us-west-2.on.aws/';

async function post(body) {
  const res = await fetch(LADDER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

function boardKey(board) {
  return board === 'teams' || board === 'koth' ? board : '1v1';
}

async function lookingPayload(board) {
  const key = boardKey(board);
  const res = await fetch(`${LADDER_URL}?looking=1&board=${key}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function ladderLooking(board = '1v1') {
  const data = await lookingPayload(board);
  return Number.isFinite(data?.looking) ? data.looking : null;
}

/** The live function echoes the board only after the teams queue is deployed. */
export async function ladderQueueReady(board = '1v1') {
  const key = boardKey(board);
  if (key === '1v1') return true;
  const data = await lookingPayload(key);
  return data?.board === key;
}

export function touchLadderName(playerId, name) {
  return post({ action: 'name', playerId, name });
}

export function queueLadder(body) {
  return post({ action: 'queue', ...body });
}

export function leaveLadder(playerId, board = '1v1') {
  return post({ action: 'leave', playerId, board: boardKey(board) });
}

export function postLadderIncident(body) {
  return post({ action: 'incident', ...body });
}

export function postLadderReport(body) {
  return post(body);
}

export function postLadderSnapshot(body) {
  return post({ action: 'snapshot', ...body });
}

const LADDER_MATCH = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export async function loadLadderSnapshot(matchId, pageOrigin = '') {
  const id = String(matchId || '').toLowerCase();
  if (!LADDER_MATCH.test(id)) return null;
  if (String(pageOrigin).includes('aether.garden')) {
    try {
      const res = await fetch(`/ladder/matches/${id}.json`);
      if (res.ok) return res.json();
    } catch { /* fall through to the function */ }
  }
  const res = await fetch(`${LADDER_URL}?match=${id}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export function postLadderKoth(body) {
  return post({ action: 'koth', ...body });
}

export function postHill(body) {
  return post({ action: 'hill', ...body });
}

export function postHillSplit(body) {
  return post({ action: 'hill-split', ...body });
}

const LADDER_PLAYER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadLadderRecent(playerId, pageOrigin = '') {
  const id = String(playerId || '').toLowerCase();
  if (!LADDER_PLAYER.test(id)) return { playerId: id, recent: [] };
  if (String(pageOrigin).includes('aether.garden')) {
    try {
      const res = await fetch(`/ladder/players/${id}.json`);
      if (res.ok) return res.json();
    } catch { /* fall through to the function */ }
  }
  const res = await fetch(`${LADDER_URL}?player=${id}`);
  if (!res.ok) return { playerId: id, recent: [] };
  return res.json().catch(() => ({ playerId: id, recent: [] }));
}

export async function loadLadderBoard(pageOrigin = '', board = '1v1') {
  const key = boardKey(board);
  if (String(pageOrigin).includes('aether.garden')) {
    try {
      const indexRes = await fetch('/ladder/index.json');
      if (indexRes.ok) {
        const index = await indexRes.json();
        const path = index?.boards?.[key] || `seasons/${index.current || '2026-1'}/${key}.json`;
        const boardRes = await fetch(`/ladder/${path}`);
        if (boardRes.ok) return boardRes.json();
      }
    } catch { /* fall through to the function */ }
  }
  const res = await fetch(`${LADDER_URL}?board=${key}`);
  if (!res.ok) return { rows: [] };
  return res.json().catch(() => ({ rows: [] }));
}
