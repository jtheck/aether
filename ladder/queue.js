// Ranked queues. A waiting row heartbeats on each poll. Pairing uses the
// searcher's window, which starts at ±100 and widens by 50 every 10 seconds.
// 1v1 pairs two players. Teams fills four and balances the sides by rating.

import { START_RATING } from './elo.js';
import { playerKey } from './report.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const QUEUE_PK = 'queue#1v1';
export const ASSIGN_PK = 'assign#1v1';
export const TEAMS_QUEUE_PK = 'queue#teams';
export const TEAMS_ASSIGN_PK = 'assign#teams';
export const QUEUE_FRESH_MS = 20_000;
/** A pairing is only reused for a few seconds, long enough for both polls to see it. */
export const ASSIGN_HOLD_MS = 15_000;

export function searchWindow(waitMs) {
  const steps = Math.floor(Math.max(0, waitMs) / 10_000);
  return Math.min(800, 100 + steps * 50);
}

export function freshRows(rows, now) {
  return rows.filter((row) => now - (row.heartbeat ?? 0) < QUEUE_FRESH_MS);
}

export function pickOpponent(me, rows, now) {
  const window = searchWindow(now - me.enqueuedAt);
  let best = null;
  for (const row of rows) {
    if (row.playerId === me.playerId) continue;
    const gap = Math.abs((row.rating ?? START_RATING) - me.rating);
    if (gap > window) continue;
    if (!best || gap < best.gap || (gap === best.gap && row.enqueuedAt < best.row.enqueuedAt)) {
      best = { row, gap };
    }
  }
  return { window, opponent: best?.row ?? null };
}

/** Three other waiters inside the searcher's window, closest rating first. */
export function pickTeam(me, rows, now) {
  const window = searchWindow(now - me.enqueuedAt);
  const near = [];
  for (const row of rows) {
    if (row.playerId === me.playerId) continue;
    const gap = Math.abs((row.rating ?? START_RATING) - me.rating);
    if (gap > window) continue;
    near.push(row);
  }
  near.sort((a, b) => {
    const gapA = Math.abs((a.rating ?? START_RATING) - me.rating);
    const gapB = Math.abs((b.rating ?? START_RATING) - me.rating);
    if (gapA !== gapB) return gapA - gapB;
    if ((a.enqueuedAt ?? 0) !== (b.enqueuedAt ?? 0)) return (a.enqueuedAt ?? 0) - (b.enqueuedAt ?? 0);
    return a.playerId < b.playerId ? -1 : 1;
  });
  if (near.length < 3) return null;
  return [me, near[0], near[1], near[2]];
}

/**
 * Strongest with weakest, the other two together. Seats 0 and 1 are one side.
 * @param {{ playerId: string, rating?: number }[]} rows
 */
export function assignTeamSeats(rows) {
  const ordered = rows.slice().sort((a, b) => {
    const byRating = (b.rating ?? START_RATING) - (a.rating ?? START_RATING);
    if (byRating) return byRating;
    return a.playerId < b.playerId ? -1 : 1;
  });
  const placed = [ordered[0], ordered[3], ordered[1], ordered[2]];
  return placed.map((row, seat) => ({
    playerId: row.playerId,
    userId: row.userId,
    name: row.name,
    color: row.color,
    rating: row.rating ?? START_RATING,
    seat,
    team: seat < 2 ? 0 : 1,
  }));
}

const DUEL = { id: '1v1', queue: QUEUE_PK, assign: ASSIGN_PK, size: 2 };
const TEAMS = { id: 'teams', queue: TEAMS_QUEUE_PK, assign: TEAMS_ASSIGN_PK, size: 4 };

function specFor(board) {
  return board === 'teams' ? TEAMS : DUEL;
}

function cleanName(name) {
  const text = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return text || 'Player';
}

function cleanColor(color) {
  const text = String(color ?? '');
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '#88ccff';
}

export function parseQueueJoin(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const playerId = String(body.playerId ?? '').toLowerCase();
  if (!UUID.test(playerId)) return { ok: false, error: 'invalid playerId' };
  const userId = String(body.userId ?? '').trim();
  if (!userId || userId.length > 80) return { ok: false, error: 'invalid userId' };
  return {
    ok: true,
    playerId,
    userId,
    name: cleanName(body.name),
    color: cleanColor(body.color),
  };
}

function waitingBody(me, rows, now, board) {
  const fresh = freshRows(rows, now);
  const window = searchWindow(now - me.enqueuedAt);
  return {
    ok: true,
    status: 'waiting',
    board,
    rating: me.rating,
    looking: fresh.length,
    low: me.rating - window,
    high: me.rating + window,
  };
}

function matchedBody(assign, playerId, board) {
  const host = assign.players.find((player) => player.playerId === assign.hostPlayerId);
  return {
    ok: true,
    status: 'matched',
    board,
    matchId: assign.matchId,
    seed: assign.seed,
    role: playerId === assign.hostPlayerId ? 'host' : 'guest',
    hostUserId: host?.userId ?? '',
    hostPlayerId: assign.hostPlayerId,
    players: assign.players,
  };
}

function makeMatchId(now, rand) {
  const suffix = Math.floor(rand * 0xffffffff).toString(36).padStart(4, '0').slice(0, 6);
  return `lobby-${now.toString(36)}-${suffix}`;
}

function publicPlayer(row) {
  return {
    playerId: row.playerId,
    userId: row.userId,
    name: row.name,
    color: row.color,
    rating: row.rating,
  };
}

export async function handleQueue(store, body, { season, now, random = Math.random }) {
  const parsed = parseQueueJoin(body);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };
  const spec = specFor(body?.board);
  const other = spec.id === 'teams' ? DUEL : TEAMS;

  const sk = playerKey(parsed.playerId);
  const assigned = await store.getItem(spec.assign, sk);
  if (assigned?.matchId && now - (assigned.at ?? 0) < ASSIGN_HOLD_MS) {
    return { status: 200, body: matchedBody(assigned, parsed.playerId, spec.id) };
  }
  if (assigned) await dropAssign(store, spec.assign, assigned, parsed.playerId);

  const ratingRow = await store.getItem(`${spec.id}#${season}`, sk);
  const rating = ratingRow?.rating ?? START_RATING;
  const prev = await store.getItem(spec.queue, sk);
  const me = {
    pk: spec.queue,
    sk,
    playerId: parsed.playerId,
    userId: parsed.userId,
    name: parsed.name,
    color: parsed.color,
    rating,
    enqueuedAt: prev?.enqueuedAt ?? now,
    heartbeat: now,
  };
  await store.putItem(me);
  await store.deleteItem(other.queue, sk);

  const rows = freshRows(await store.listByPrefix(spec.queue, 'p#'), now);
  const opponent = spec.size === 2 ? pickOpponent(me, rows, now).opponent : null;
  const group = spec.size === 4 ? pickTeam(me, rows, now) : (opponent ? [me, opponent] : null);
  if (!group) return { status: 200, body: waitingBody(me, rows, now, spec.id) };

  const players = spec.size === 4 ? assignTeamSeats(group) : group.map(publicPlayer);
  const hostPlayerId = players.reduce((host, player) => (player.playerId < host ? player.playerId : host), players[0].playerId);
  const assign = {
    matchId: makeMatchId(now, random()),
    seed: Math.floor(random() * 0x100000000) >>> 0,
    hostPlayerId,
    players,
    at: now,
    board: spec.id,
  };
  const paired = await store.pairQueue({
    deletes: players.map((player) => ({ pk: spec.queue, sk: playerKey(player.playerId) })),
    puts: players.map((player) => ({ pk: spec.assign, sk: playerKey(player.playerId), ...assign })),
  });
  if (!paired.ok) {
    const again = await store.getItem(spec.assign, sk);
    if (again?.matchId && now - (again.at ?? 0) < ASSIGN_HOLD_MS) {
      return { status: 200, body: matchedBody(again, parsed.playerId, spec.id) };
    }
    const left = freshRows(await store.listByPrefix(spec.queue, 'p#'), now);
    return { status: 200, body: waitingBody(me, left, now, spec.id) };
  }
  return { status: 200, body: matchedBody(assign, parsed.playerId, spec.id) };
}

export async function handleName(store, body, { season }) {
  const playerId = String(body?.playerId || '').toLowerCase();
  if (!UUID.test(playerId)) {
    return { status: 400, body: { ok: false, error: 'invalid playerId' } };
  }
  const name = cleanName(body.name);
  const boards = [];
  for (const id of ['1v1', 'teams']) {
    const row = await store.getItem(`${id}#${season}`, playerKey(playerId));
    if (!row || row.name === name) continue;
    await store.putItem({ ...row, name });
    boards.push(id);
  }
  return { status: 200, body: { ok: true, updated: boards.length > 0, boards } };
}

export async function countLooking(store, now, board = '1v1') {
  const spec = specFor(board);
  const rows = freshRows(await store.listByPrefix(spec.queue, 'p#'), now);
  return rows.length;
}

async function dropAssign(store, assignPk, assigned, playerId) {
  const ids = new Set([playerId]);
  for (const player of assigned?.players || []) {
    if (player?.playerId) ids.add(player.playerId);
  }
  for (const id of ids) await store.deleteItem(assignPk, playerKey(id));
}

export async function handleLeave(store, body) {
  const playerId = String(body?.playerId ?? '').toLowerCase();
  if (!UUID.test(playerId)) return { status: 400, body: { ok: false, error: 'invalid playerId' } };
  const specs = body?.board === 'teams' ? [TEAMS] : body?.board === '1v1' ? [DUEL] : [DUEL, TEAMS];
  for (const spec of specs) {
    const assigned = await store.getItem(spec.assign, playerKey(playerId));
    await store.deleteItem(spec.queue, playerKey(playerId));
    if (assigned) await dropAssign(store, spec.assign, assigned, playerId);
  }
  return { status: 200, body: { ok: true, status: 'left' } };
}
