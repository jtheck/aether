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

async function lookingPayload(board) {
  const key = board === 'teams' ? 'teams' : '1v1';
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
  if (board !== 'teams') return true;
  const data = await lookingPayload(board);
  return data?.board === 'teams';
}

export function touchLadderName(playerId, name) {
  return post({ action: 'name', playerId, name });
}

export function queueLadder(body) {
  return post({ action: 'queue', ...body });
}

export function leaveLadder(playerId, board = '1v1') {
  return post({ action: 'leave', playerId, board: board === 'teams' ? 'teams' : '1v1' });
}

export function postLadderIncident(body) {
  return post({ action: 'incident', ...body });
}

export function postLadderReport(body) {
  return post(body);
}

export async function loadLadderBoard(pageOrigin = '', board = '1v1') {
  const key = board === 'teams' ? 'teams' : '1v1';
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
