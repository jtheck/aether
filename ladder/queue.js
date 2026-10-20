// Ranked queues. A waiting row heartbeats on each poll. Pairing uses the
// searcher's window, which starts at ±100 and widens by 50 every 10 seconds.
// 1v1 pairs two players. Teams fills four and balances the sides by rating.
// King of the Hill fills a live hill up to five seated and three watching.
// A new hill opens only when three or more are queued and every hill is full.
// Three spectators of one hill can agree to leave and open another.

import { START_RATING } from './elo.js';
import { playerKey } from './report.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const QUEUE_PK = 'queue#1v1';
export const ASSIGN_PK = 'assign#1v1';
export const TEAMS_QUEUE_PK = 'queue#teams';
export const TEAMS_ASSIGN_PK = 'assign#teams';
export const KOTH_QUEUE_PK = 'queue#koth';
export const KOTH_ASSIGN_PK = 'assign#koth';
export const HILL_PK = 'hill#koth';
/** Smallest group that scores, and the smallest group that opens a hill. */
export const KOTH_SIZE = 3;
/** Seated fighters. The sixth arrival watches. */
export const KOTH_SEATS = 5;
/** Five seated plus three spectators. The eighth person is the third watcher. */
export const KOTH_HOLD = 8;
/** Watchers who can agree to open a hill of their own. */
export const KOTH_SPLIT = 3;
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

/** Waiters inside the window, closest first. A pair does not start a hill. */
export function pickHill(me, rows, now) {
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
  if (near.length < KOTH_SIZE - 1) return null;
  return [me, ...near.slice(0, KOTH_SEATS - 1)];
}

/** A live hill under eight people, inside the searcher's window. Open seats first. */
export function pickOpenHill(me, hills, now) {
  const window = searchWindow(now - me.enqueuedAt);
  const open = [];
  for (const hill of freshRows(hills, now)) {
    if ((hill.population | 0) >= KOTH_HOLD) continue;
    if (!hill.matchId || !hill.hostUserId) continue;
    const gap = Math.abs((hill.rating ?? START_RATING) - me.rating);
    if (gap > window) continue;
    open.push({ hill, gap });
  }
  open.sort((a, b) => {
    const aSeat = (a.hill.seated | 0) < KOTH_SEATS ? 0 : 1;
    const bSeat = (b.hill.seated | 0) < KOTH_SEATS ? 0 : 1;
    if (aSeat !== bSeat) return aSeat - bSeat;
    const pop = (a.hill.population | 0) - (b.hill.population | 0);
    if (pop) return pop;
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.hill.matchId < b.hill.matchId ? -1 : 1;
  });
  return open[0]?.hill ?? null;
}

export function hillKey(matchId) {
  return `h#${String(matchId ?? '').slice(0, 80)}`;
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

/** Seats follow player id so every client builds the same hill. */
export function assignHillSeats(rows) {
  const ordered = rows.slice().sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  return ordered.map((row, seat) => ({
    playerId: row.playerId,
    userId: row.userId,
    name: row.name,
    color: row.color,
    rating: row.rating ?? START_RATING,
    seat,
    team: 0,
  }));
}

const DUEL = { id: '1v1', queue: QUEUE_PK, assign: ASSIGN_PK };
const TEAMS = { id: 'teams', queue: TEAMS_QUEUE_PK, assign: TEAMS_ASSIGN_PK };
const HILL = { id: 'koth', queue: KOTH_QUEUE_PK, assign: KOTH_ASSIGN_PK };
const BOARDS = [DUEL, TEAMS, HILL];

function specFor(board) {
  if (board === 'teams') return TEAMS;
  if (board === 'koth') return HILL;
  return DUEL;
}

function otherBoards(spec) {
  return BOARDS.filter((row) => row.id !== spec.id);
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

function hillFromAssign(assign, now) {
  const host = assign.players.find((player) => player.playerId === assign.hostPlayerId) || assign.players[0];
  const rating = Math.round(
    assign.players.reduce((sum, player) => sum + (player.rating ?? START_RATING), 0) / assign.players.length,
  );
  return {
    pk: HILL_PK,
    sk: hillKey(assign.matchId),
    matchId: assign.matchId,
    hostUserId: host?.userId ?? '',
    hostPlayerId: assign.hostPlayerId,
    seed: assign.seed,
    rating,
    seated: assign.players.length,
    spectators: 0,
    population: assign.players.length,
    heartbeat: now,
    split: [],
    splitMatch: null,
  };
}

function joinBody(hill, role) {
  return {
    ok: true,
    status: 'join',
    board: 'koth',
    matchId: hill.matchId,
    seed: hill.seed,
    role,
    hostUserId: hill.hostUserId,
    hostPlayerId: hill.hostPlayerId,
  };
}

function splitBody(splitMatch, playerId) {
  const host = splitMatch.players.find((player) => player.playerId === splitMatch.hostPlayerId);
  return {
    ok: true,
    status: 'matched',
    board: 'koth',
    matchId: splitMatch.matchId,
    seed: splitMatch.seed,
    role: playerId === splitMatch.hostPlayerId ? 'host' : 'guest',
    hostUserId: host?.userId ?? '',
    hostPlayerId: splitMatch.hostPlayerId,
    players: splitMatch.players,
  };
}

function splitMatchId(playerIds) {
  let hash = 0x811c9dc5;
  const text = playerIds.slice().sort().join('|');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `hill-${(hash >>> 0).toString(36)}`;
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
  for (const other of otherBoards(spec)) await store.deleteItem(other.queue, sk);

  const rows = freshRows(await store.listByPrefix(spec.queue, 'p#'), now);
  if (spec.id === 'koth') {
    const hills = await store.listByPrefix(HILL_PK, 'h#');
    const open = pickOpenHill(me, hills, now);
    if (open) {
      await store.deleteItem(spec.queue, sk);
      const role = (open.seated | 0) < KOTH_SEATS ? 'player' : 'spectator';
      const next = {
        ...open,
        seated: (open.seated | 0) + (role === 'player' ? 1 : 0),
        spectators: (open.spectators | 0) + (role === 'spectator' ? 1 : 0),
        population: (open.population | 0) + 1,
        heartbeat: now,
      };
      await store.putItem(next);
      return { status: 200, body: joinBody(next, role) };
    }
  }
  const opponent = spec.id === '1v1' ? pickOpponent(me, rows, now).opponent : null;
  const group = spec.id === 'teams'
    ? pickTeam(me, rows, now)
    : spec.id === 'koth'
      ? pickHill(me, rows, now)
      : (opponent ? [me, opponent] : null);
  if (!group) return { status: 200, body: waitingBody(me, rows, now, spec.id) };

  const players = spec.id === 'teams'
    ? assignTeamSeats(group)
    : spec.id === 'koth'
      ? assignHillSeats(group)
      : group.map(publicPlayer);
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
  if (spec.id === 'koth') await store.putItem(hillFromAssign(assign, now));
  return { status: 200, body: matchedBody(assign, parsed.playerId, spec.id) };
}

function clampCount(value, max) {
  const n = value | 0;
  if (n < 0) return 0;
  return n > max ? max : n;
}

export async function handleHill(store, body, { now }) {
  const matchId = String(body?.matchId ?? '').slice(0, 80);
  if (!matchId) return { status: 400, body: { ok: false, error: 'match' } };
  const existing = await store.getItem(HILL_PK, hillKey(matchId));
  const seated = clampCount(body?.seated, KOTH_SEATS);
  const spectators = clampCount(body?.spectators, 24);
  const rating = Number.isFinite(body?.rating) ? body.rating | 0 : (existing?.rating ?? START_RATING);
  const splitMatch = existing?.splitMatch && now - (existing.splitMatch.at ?? 0) < ASSIGN_HOLD_MS
    ? existing.splitMatch
    : null;
  const hostUserId = String(body?.hostUserId || existing?.hostUserId || '').slice(0, 80);
  await store.putItem({
    pk: HILL_PK,
    sk: hillKey(matchId),
    matchId,
    hostUserId,
    hostPlayerId: String(body?.hostPlayerId || existing?.hostPlayerId || '').toLowerCase(),
    seed: existing?.seed ?? (body?.seed >>> 0),
    rating,
    seated,
    spectators,
    population: seated + spectators,
    heartbeat: now,
    split: Array.isArray(existing?.split) ? existing.split : [],
    splitMatch,
  });
  return { status: 200, body: { ok: true, population: seated + spectators } };
}

export async function handleHillSplit(store, body, { now }) {
  const matchId = String(body?.matchId ?? '').slice(0, 80);
  const playerId = String(body?.playerId ?? '').toLowerCase();
  if (!matchId || !UUID.test(playerId)) return { status: 400, body: { ok: false, error: 'match' } };
  const userId = String(body?.userId ?? '').trim().slice(0, 80);
  if (!userId) return { status: 400, body: { ok: false, error: 'user' } };
  const item = await store.getItem(HILL_PK, hillKey(matchId));
  if (!item) return { status: 404, body: { ok: false, error: 'hill' } };

  const issued = item.splitMatch && now - (item.splitMatch.at ?? 0) < ASSIGN_HOLD_MS ? item.splitMatch : null;
  if (issued && (issued.players || []).some((player) => player.playerId === playerId)) {
    return { status: 200, body: splitBody(issued, playerId) };
  }
  const held = new Set((issued?.players || []).map((player) => player.playerId));
  const split = (Array.isArray(item.split) ? item.split : [])
    .filter((player) => (
      player?.playerId
      && player.playerId !== playerId
      && !held.has(player.playerId)
      && now - (player.at ?? 0) < QUEUE_FRESH_MS
    ));
  split.push({
    playerId,
    userId,
    name: cleanName(body?.name),
    color: cleanColor(body?.color),
    rating: Number.isFinite(body?.rating) ? body.rating | 0 : (item.rating ?? START_RATING),
    at: now,
  });
  const live = split.slice(-8);
  let splitMatch = issued;
  let rest = live;
  if (!splitMatch && live.length >= KOTH_SPLIT) {
    const taking = live.slice(0, KOTH_SPLIT);
    const players = assignHillSeats(taking);
    const hostPlayerId = players.reduce(
      (host, player) => (player.playerId < host ? player.playerId : host),
      players[0].playerId,
    );
    const id = splitMatchId(taking.map((player) => player.playerId));
    splitMatch = {
      matchId: id,
      seed: Number.parseInt(id.slice(5), 36) >>> 0,
      hostPlayerId,
      players,
      at: now,
      board: 'koth',
    };
    rest = live.slice(KOTH_SPLIT);
    const host = players.find((player) => player.playerId === hostPlayerId);
    await store.putItem({
      pk: HILL_PK,
      sk: hillKey(id),
      matchId: id,
      hostUserId: host?.userId ?? '',
      hostPlayerId,
      seed: splitMatch.seed,
      rating: item.rating ?? START_RATING,
      seated: KOTH_SPLIT,
      spectators: 0,
      population: KOTH_SPLIT,
      heartbeat: now,
      split: [],
      splitMatch: null,
    });
  }
  await store.putItem({ ...item, split: rest, splitMatch, heartbeat: item.heartbeat });
  if (!splitMatch || !(splitMatch.players || []).some((player) => player.playerId === playerId)) {
    return { status: 200, body: { ok: true, status: 'waiting', agreed: rest.length, need: KOTH_SPLIT } };
  }
  return { status: 200, body: splitBody(splitMatch, playerId) };
}

export async function handleName(store, body, { season }) {
  const playerId = String(body?.playerId || '').toLowerCase();
  if (!UUID.test(playerId)) {
    return { status: 400, body: { ok: false, error: 'invalid playerId' } };
  }
  const name = cleanName(body.name);
  const boards = [];
  for (const id of ['1v1', 'teams', 'koth']) {
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
  const specs = body?.board === 'teams' ? [TEAMS]
    : body?.board === 'koth' ? [HILL]
      : body?.board === '1v1' ? [DUEL]
        : BOARDS;
  for (const spec of specs) {
    const assigned = await store.getItem(spec.assign, playerKey(playerId));
    await store.deleteItem(spec.queue, playerKey(playerId));
    if (assigned) await dropAssign(store, spec.assign, assigned, playerId);
  }
  return { status: 200, body: { ok: true, status: 'left' } };
}
