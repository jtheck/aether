import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ratingDelta } from './elo.js';
import { createHandler } from './handler.js';
import { mergeIndex } from './publish.js';
import { createMemoryStore } from './store.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function post(body) {
  return {
    requestContext: { http: { method: 'POST' } },
    headers: { origin: 'https://play.example' },
    body: JSON.stringify(body),
  };
}

function duel(playerId, extra = {}) {
  return {
    board: '1v1',
    matchId: 'lobby-abc123',
    playerId,
    tick: 4000,
    checksum: 99,
    winnerSeat: 0,
    players: [
      { playerId: A, seat: 0 },
      { playerId: B, seat: 1 },
    ],
    ...extra,
  };
}

function setup() {
  const store = createMemoryStore();
  const handler = createHandler({
    store,
    season: '2026-1',
    allowedOrigins: ['https://play.example'],
    now: () => '2026-10-17T03:00:00.000Z',
  });
  return { store, handler };
}

async function json(handler, event) {
  const res = await handler(event);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

test('equal opponents exchange 16 points', () => {
  assert.equal(ratingDelta(1000, 1000, 1), 16);
  assert.equal(ratingDelta(1000, 1000, 0), -16);
});

test('a favorite gains less than 16', () => {
  assert.equal(ratingDelta(1200, 1000, 1), 8);
  assert.equal(ratingDelta(1000, 1200, 0), -8);
});

test('one report waits, the second settles and publishes the board', async () => {
  const { store, handler } = setup();
  const first = await json(handler, post(duel(A)));
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'pending');
  assert.equal(store.objects.has('ladder/index.json'), false);

  const second = await json(handler, post(duel(B)));
  assert.equal(second.status, 200);
  assert.equal(second.body.status, 'settled');
  assert.equal(second.body.season, '2026-1');
  const byId = Object.fromEntries(second.body.ratings.map((row) => [row.playerId, row]));
  assert.equal(byId[A].rating, 1016);
  assert.equal(byId[A].delta, 16);
  assert.equal(byId[B].rating, 984);
  assert.equal(byId[B].delta, -16);

  const board = JSON.parse(store.objects.get('ladder/seasons/2026-1/1v1.json'));
  assert.deepEqual(board.rows.map((row) => row.playerId), [A, B]);
  assert.equal(board.rows[0].rank, 1);
  assert.equal(board.rows[0].rating, 1016);

  const index = JSON.parse(store.objects.get('ladder/index.json'));
  assert.equal(index.current, '2026-1');
  assert.deepEqual(index.seasons, ['2026-1']);
  assert.equal(index.boards['1v1'], 'seasons/2026-1/1v1.json');
  assert.equal(second.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(second.headers['access-control-allow-origin'], 'https://play.example');
});

test('a repeated report does not move the rating again', async () => {
  const { store, handler } = setup();
  await handler(post(duel(A)));
  await handler(post(duel(B)));
  const again = await json(handler, post(duel(A)));
  assert.equal(again.body.status, 'settled');
  const row = await store.getItem('1v1#2026-1', `p#${A}`);
  assert.equal(row.games, 1);
  assert.equal(row.rating, 1016);
  assert.equal(row.wins, 1);
});

test('disagreement does not change ratings', async () => {
  const { store, handler } = setup();
  await handler(post(duel(A)));
  const other = await json(handler, post(duel(B, { checksum: 100 })));
  assert.equal(other.status, 409);
  assert.equal(other.body.status, 'conflict');
  assert.equal(await store.getItem('1v1#2026-1', `p#${A}`), null);
  assert.equal(store.objects.has('ladder/index.json'), false);
});

test('the same player cannot settle by reporting twice', async () => {
  const { handler } = setup();
  await handler(post(duel(A)));
  const again = await json(handler, post(duel(A)));
  assert.equal(again.body.status, 'pending');
});

test('teams waits for one report from each side, then rates against the average', async () => {
  const { handler, store } = setup();
  const players = [
    { playerId: A, seat: 0, team: 0 },
    { playerId: B, seat: 1, team: 0 },
    { playerId: C, seat: 2, team: 1 },
    { playerId: D, seat: 3, team: 1 },
  ];
  const report = (playerId) => post({
    board: 'teams',
    matchId: 'lobby-teams-1',
    playerId,
    tick: 8000,
    checksum: 7,
    winnerSeat: 0,
    players,
  });

  const sameSide = await json(handler, report(A));
  await handler(report(B));
  const still = await json(handler, report(B));
  assert.equal(sameSide.body.status, 'pending');
  assert.equal(still.body.status, 'pending');

  const done = await json(handler, report(C));
  assert.equal(done.body.status, 'settled');
  const byId = Object.fromEntries(done.body.ratings.map((row) => [row.playerId, row.delta]));
  assert.equal(byId[A], 16);
  assert.equal(byId[B], 16);
  assert.equal(byId[C], -16);
  assert.equal(byId[D], -16);
  assert.equal(store.objects.has('ladder/seasons/2026-1/teams.json'), true);
});

test('a client cannot choose the season', async () => {
  const { handler, store } = setup();
  await handler(post(duel(A, { season: '1999-1' })));
  await handler(post(duel(B, { season: '1999-1' })));
  assert.equal(store.objects.has('ladder/seasons/2026-1/1v1.json'), true);
  assert.equal(store.objects.has('ladder/seasons/1999-1/1v1.json'), false);
});

test('malformed reports are rejected', async () => {
  const { handler } = setup();
  const missing = await json(handler, post(duel(A, { players: [{ playerId: A, seat: 0 }] })));
  assert.equal(missing.status, 400);
  const junk = await json(handler, { requestContext: { http: { method: 'POST' } }, body: '{' });
  assert.equal(junk.status, 400);
});

test('a new season keeps the old id and replaces the current board map', () => {
  const first = mergeIndex(null, { season: '2026-1', board: '1v1' });
  const next = mergeIndex(
    { ...first, boards: { ...first.boards, teams: 'seasons/2026-1/teams.json' } },
    { season: '2026-2', board: '1v1' },
  );
  assert.equal(next.current, '2026-2');
  assert.deepEqual(next.seasons, ['2026-1', '2026-2']);
  assert.deepEqual(next.boards, { '1v1': 'seasons/2026-2/1v1.json' });
});

test('two searchers within the window are paired, and a far rating waits', async () => {
  const { store, handler } = setup();
  const join = (playerId, userId) => post({
    action: 'queue',
    playerId,
    userId,
    name: userId,
    color: '#112233',
  });
  const first = await json(handler, join(A, 'user-a'));
  assert.equal(first.body.status, 'waiting');
  assert.equal(first.body.looking, 1);
  assert.equal(first.body.low, 900);
  assert.equal(first.body.high, 1100);

  const second = await json(handler, join(B, 'user-b'));
  assert.equal(second.body.status, 'matched');
  assert.equal(second.body.role, 'guest');
  assert.equal(second.body.hostUserId, 'user-a');
  assert.equal(second.body.players.length, 2);

  const again = await json(handler, join(A, 'user-a'));
  assert.equal(again.body.status, 'matched');
  assert.equal(again.body.matchId, second.body.matchId);
  assert.equal(again.body.role, 'host');
});

test('an old pairing does not skip a new search', async () => {
  const store = createMemoryStore();
  const now = 1_700_000_000_000;
  const handler = createHandler({
    store,
    season: '2026-1',
    allowedOrigins: [],
    now: () => '2026-10-17T03:00:00.000Z',
    clock: () => now,
  });
  await store.putItem({
    pk: 'assign#1v1',
    sk: `p#${A}`,
    matchId: 'lobby-old',
    seed: 1,
    hostPlayerId: A,
    at: now - 60_000,
    players: [
      { playerId: A, userId: 'user-a', name: 'A', color: '#112233', rating: 1000 },
      { playerId: B, userId: 'user-b', name: 'B', color: '#112233', rating: 1000 },
    ],
  });
  const res = await json(handler, post({
    action: 'queue',
    playerId: A,
    userId: 'user-a',
    name: 'A',
    color: '#112233',
  }));
  assert.equal(res.body.status, 'waiting');
  assert.equal(res.body.looking, 1);
});

test('a disagreement is stored against the other player', async () => {
  const { store, handler } = setup();
  await handler(post(duel(A)));
  await handler(post(duel(B, { checksum: 100 })));
  const incidents = await store.listByPrefix(`incident#${A}`, '');
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].kind, 'discrepancy');
  assert.equal(incidents[0].reporterId, B);
});

function queueJoin(playerId, userId, board) {
  return post({
    action: 'queue',
    board,
    playerId,
    userId,
    name: userId,
    color: '#112233',
  });
}

test('teams fills four seats, balances the sides, and leaves a fifth waiting', async () => {
  const { store, handler } = setup();
  const ratings = [[A, 1000], [B, 1090], [C, 1060], [D, 1030]];
  for (const [playerId, rating] of ratings) {
    await store.putItem({ pk: 'teams#2026-1', sk: `p#${playerId}`, playerId, rating, games: 4, wins: 2, name: playerId });
  }
  assert.equal((await json(handler, queueJoin(A, 'user-a', 'teams'))).body.status, 'waiting');
  assert.equal((await json(handler, queueJoin(B, 'user-b', 'teams'))).body.status, 'waiting');
  assert.equal((await json(handler, queueJoin(C, 'user-c', 'teams'))).body.looking, 3);

  const matched = await json(handler, queueJoin(D, 'user-d', 'teams'));
  assert.equal(matched.body.status, 'matched');
  assert.equal(matched.body.board, 'teams');
  assert.equal(matched.body.role, 'guest');
  assert.equal(matched.body.hostPlayerId, A);
  const bySeat = Object.fromEntries(matched.body.players.map((player) => [player.seat, player]));
  assert.equal(bySeat[0].playerId, B);
  assert.equal(bySeat[0].team, 0);
  assert.equal(bySeat[1].playerId, A);
  assert.equal(bySeat[1].team, 0);
  assert.equal(bySeat[2].playerId, C);
  assert.equal(bySeat[2].team, 1);
  assert.equal(bySeat[3].playerId, D);
  assert.equal(bySeat[3].team, 1);

  const host = await json(handler, queueJoin(A, 'user-a', 'teams'));
  assert.equal(host.body.status, 'matched');
  assert.equal(host.body.role, 'host');
  assert.equal(host.body.matchId, matched.body.matchId);

  const fifth = await json(handler, queueJoin(E, 'user-e', 'teams'));
  assert.equal(fifth.body.status, 'waiting');
  assert.equal(fifth.body.looking, 1);
  assert.equal(fifth.body.board, 'teams');
});

test('a teams search does not take a rating outside its window or a 1v1 waiter', async () => {
  const { store, handler } = setup();
  await store.putItem({ pk: 'teams#2026-1', sk: `p#${E}`, playerId: E, rating: 1200, games: 1, wins: 1 });
  await handler(queueJoin(E, 'user-e', 'teams'));
  await handler(queueJoin(A, 'user-a', '1v1'));
  await handler(queueJoin(B, 'user-b', 'teams'));
  await handler(queueJoin(C, 'user-c', 'teams'));
  const matched = await json(handler, queueJoin(D, 'user-d', 'teams'));
  assert.equal(matched.body.status, 'waiting');
  assert.equal(matched.body.looking, 4);

  const duel = await json(handler, queueJoin(B, 'user-b', '1v1'));
  assert.equal(duel.body.status, 'matched');
  assert.equal(duel.body.board, '1v1');
  assert.equal(duel.body.players.map((player) => player.playerId).sort().join(), [A, B].sort().join());
});

test('the teams queue widens until a far rating can fill the table', async () => {
  const store = createMemoryStore();
  let now = 1_700_000_000_000;
  const handler = createHandler({
    store,
    season: '2026-1',
    allowedOrigins: [],
    now: () => '2026-10-17T03:00:00.000Z',
    clock: () => now,
  });
  await store.putItem({ pk: 'teams#2026-1', sk: `p#${E}`, playerId: E, rating: 1700, games: 3, wins: 3 });
  await handler(queueJoin(E, 'user-e', 'teams'));
  now += 120_000;
  await handler(queueJoin(A, 'user-a', 'teams'));
  await handler(queueJoin(B, 'user-b', 'teams'));
  await handler(queueJoin(C, 'user-c', 'teams'));
  const early = await json(handler, queueJoin(A, 'user-a', 'teams'));
  assert.equal(early.body.status, 'waiting');
  const widened = await json(handler, queueJoin(E, 'user-e', 'teams'));
  assert.equal(widened.body.status, 'matched');
  assert.equal(widened.body.players.length, 4);
  assert.equal(widened.body.players.some((player) => player.playerId === E), true);
});

test('leaving the teams queue does not drop a 1v1 search', async () => {
  const { handler } = setup();
  await handler(queueJoin(A, 'user-a', 'teams'));
  await handler(queueJoin(B, 'user-b', '1v1'));
  const left = await json(handler, post({ action: 'leave', playerId: A, board: 'teams' }));
  assert.equal(left.body.status, 'left');
  const still = await json(handler, queueJoin(C, 'user-c', '1v1'));
  assert.equal(still.body.status, 'matched');
  assert.equal(still.body.players.some((player) => player.playerId === B), true);
});

test('a teams board read is empty until a match settles, and looking is per queue', async () => {
  const { handler } = setup();
  await handler(queueJoin(A, 'user-a', '1v1'));
  const board = await json(handler, {
    requestContext: { http: { method: 'GET' } },
    queryStringParameters: { board: 'teams' },
  });
  assert.equal(board.body.board, 'teams');
  assert.deepEqual(board.body.rows, []);
  const looking = await json(handler, {
    requestContext: { http: { method: 'GET' } },
    queryStringParameters: { looking: '1', board: 'teams' },
  });
  assert.equal(looking.body.looking, 0);
  assert.equal(looking.body.board, 'teams');
});

test('republishing a settled match after the season changes leaves the new index alone', async () => {
  const store = createMemoryStore();
  const first = createHandler({
    store,
    season: '2026-1',
    allowedOrigins: [],
    now: () => '2026-10-17T03:00:00.000Z',
  });
  await first(post(duel(A)));
  await first(post(duel(B)));

  const rolled = createHandler({
    store,
    season: '2026-2',
    allowedOrigins: [],
    now: () => '2026-11-01T00:00:00.000Z',
  });
  const again = await json(rolled, post(duel(A)));
  assert.equal(again.body.season, '2026-1');
  const index = JSON.parse(store.objects.get('ladder/index.json'));
  assert.equal(index.current, '2026-1');
  assert.equal(await store.getItem('1v1#2026-2', `p#${A}`), null);
});
