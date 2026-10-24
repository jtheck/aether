import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ratingDelta } from './elo.js';
import { createHandler } from './handler.js';
import { mergeIndex } from './publish.js';
import { prependRecent, RECENT_LIMIT } from './recent.js';
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
  const recent = await store.getItem(`recent#${A}`, 'recent');
  assert.equal(recent.recent.length, 1);
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

const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const G = '99999999-9999-4999-8999-999999999999';
const H = '88888888-8888-4888-8888-888888888888';
const I = '77777777-7777-4777-8777-777777777777';

test('a hill starts at three close players and leaves a far rating waiting', async () => {
  const { store, handler } = setup();
  await store.putItem({ pk: 'koth#2026-1', sk: `p#${F}`, playerId: F, rating: 1400, games: 4, wins: 2 });
  assert.equal((await json(handler, queueJoin(F, 'user-f', 'koth'))).body.status, 'waiting');
  assert.equal((await json(handler, queueJoin(A, 'user-a', 'koth'))).body.status, 'waiting');
  assert.equal((await json(handler, queueJoin(B, 'user-b', 'koth'))).body.status, 'waiting');
  const matched = await json(handler, queueJoin(C, 'user-c', 'koth'));
  assert.equal(matched.body.status, 'matched');
  assert.equal(matched.body.board, 'koth');
  assert.equal(matched.body.players.length, 3);
  assert.deepEqual(matched.body.players.map((player) => player.playerId), [A, B, C]);
  assert.deepEqual(matched.body.players.map((player) => player.seat), [0, 1, 2]);
  const far = await json(handler, queueJoin(F, 'user-f', 'koth'));
  assert.equal(far.body.status, 'waiting');
  assert.equal(far.body.board, 'koth');
});

test('a live hill takes the next players up to five seated and three watching', async () => {
  const { handler } = setup();
  await handler(queueJoin(A, 'user-a', 'koth'));
  await handler(queueJoin(B, 'user-b', 'koth'));
  const matched = await json(handler, queueJoin(C, 'user-c', 'koth'));
  assert.equal(matched.body.players.length, 3);
  const fourth = await json(handler, queueJoin(D, 'user-d', 'koth'));
  assert.equal(fourth.body.status, 'join');
  assert.equal(fourth.body.role, 'player');
  assert.equal(fourth.body.matchId, matched.body.matchId);
  const fifth = await json(handler, queueJoin(E, 'user-e', 'koth'));
  assert.equal(fifth.body.status, 'join');
  assert.equal(fifth.body.role, 'player');
  const watching = [F, G, H];
  for (const id of watching) {
    const joined = await json(handler, queueJoin(id, `user-${id[0]}`, 'koth'));
    assert.equal(joined.body.status, 'join');
    assert.equal(joined.body.role, 'spectator');
    assert.equal(joined.body.matchId, matched.body.matchId);
  }
  const ninth = await json(handler, queueJoin(I, 'user-i', 'koth'));
  assert.equal(ninth.body.status, 'waiting');
  assert.equal(ninth.body.looking, 1);
});

test('three queued players open a new hill when every live hill is full', async () => {
  const { store, handler } = setup();
  await store.putItem({
    pk: 'hill#koth',
    sk: 'h#lobby-full',
    matchId: 'lobby-full',
    hostUserId: 'user-z',
    hostPlayerId: F,
    rating: 1000,
    seated: 5,
    spectators: 3,
    population: 8,
    heartbeat: Date.now(),
  });
  await handler(queueJoin(A, 'user-a', 'koth'));
  await handler(queueJoin(B, 'user-b', 'koth'));
  const opened = await json(handler, queueJoin(C, 'user-c', 'koth'));
  assert.equal(opened.body.status, 'matched');
  assert.equal(opened.body.players.length, 3);
  assert.notEqual(opened.body.matchId, 'lobby-full');
});

test('three spectators who agree open a hill of their own', async () => {
  const { handler } = setup();
  await handler(queueJoin(A, 'user-a', 'koth'));
  await handler(queueJoin(B, 'user-b', 'koth'));
  const matched = await json(handler, queueJoin(C, 'user-c', 'koth'));
  const matchId = matched.body.matchId;
  const first = await json(handler, post({
    action: 'hill-split', matchId, playerId: D, userId: 'user-d', name: 'D',
  }));
  assert.equal(first.body.status, 'waiting');
  assert.equal(first.body.agreed, 1);
  await handler(post({ action: 'hill-split', matchId, playerId: E, userId: 'user-e', name: 'E' }));
  const third = await json(handler, post({
    action: 'hill-split', matchId, playerId: F, userId: 'user-f', name: 'F',
  }));
  assert.equal(third.body.status, 'matched');
  assert.equal(third.body.players.length, 3);
  assert.equal(third.body.role, 'guest');
  assert.notEqual(third.body.matchId, matchId);
  const again = await json(handler, post({
    action: 'hill-split', matchId, playerId: D, userId: 'user-d', name: 'D',
  }));
  assert.equal(again.body.status, 'matched');
  assert.equal(again.body.matchId, third.body.matchId);
  assert.equal(again.body.role, 'host');
});

test('leaving the hill queue does not drop a 1v1 search', async () => {
  const { handler } = setup();
  await handler(queueJoin(A, 'user-a', 'koth'));
  await handler(queueJoin(B, 'user-b', '1v1'));
  const left = await json(handler, post({ action: 'leave', playerId: A, board: 'koth' }));
  assert.equal(left.body.status, 'left');
  const still = await json(handler, queueJoin(C, 'user-c', '1v1'));
  assert.equal(still.body.status, 'matched');
  assert.equal(still.body.players.some((player) => player.playerId === B), true);
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

test('a koth death settles once and a repeat does not move rating again', async () => {
  const { store, handler } = setup();
  const body = {
    action: 'koth',
    matchId: 'hill-1',
    playerId: A,
    tick: 1200,
    checksum: 7,
    points: 1,
    victimId: B,
    survivorIds: [A],
  };
  const first = await json(handler, post(body));
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'settled');
  const king = first.body.ratings.find((row) => row.playerId === A);
  const fallen = first.body.ratings.find((row) => row.playerId === B);
  assert.equal(king.delta, 4);
  assert.equal(fallen.delta, -4);
  const again = await json(handler, post(body));
  assert.equal(again.body.status, 'settled');
  const row = await store.getItem('koth#2026-1', `p#${A}`);
  assert.equal(row.rating, 1004);
  assert.equal(row.games, 1);
  const recent = await store.getItem(`recent#${A}`, 'recent');
  assert.equal(recent.recent.length, 1);
  assert.equal(recent.recent[0].mode, 'KOTH');
  assert.equal(recent.recent[0].result, 'win');
});

test('recent results keep the last matches and drop the oldest', () => {
  let recent = [];
  for (let i = 0; i < RECENT_LIMIT + 3; i++) {
    recent = prependRecent(recent, {
      at: `t${i}`,
      mode: '1v1',
      result: 'win',
      opponent: 'Bea',
      delta: 16,
      rating: 1000 + i,
    });
  }
  assert.equal(recent.length, RECENT_LIMIT);
  assert.equal(recent[0].at, `t${RECENT_LIMIT + 2}`);
  assert.equal(recent.at(-1).at, 't3');
});

test('a workshop file id stays on that match only', () => {
  const withReplay = prependRecent([], {
    at: 't1',
    mode: '1v1',
    result: 'win',
    opponent: 'Bea',
    delta: 16,
    rating: 1016,
    replay: '3801871581',
  });
  assert.equal(withReplay[0].replay, '3801871581');
  const mixed = prependRecent(withReplay, {
    at: 't2',
    mode: '2v2',
    result: 'loss',
    opponent: 'Cy',
    delta: -8,
    rating: 1008,
    replay: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3801871581',
  });
  assert.equal(mixed[0].replay, undefined);
  assert.equal(mixed[1].replay, '3801871581');
});

test('one player list holds 1v1, 2v2, and koth together', async () => {
  const { store, handler } = setup();
  const players = [
    { playerId: A, seat: 0, name: 'Ann' },
    { playerId: B, seat: 1, name: 'Bea' },
  ];
  await handler(post(duel(A, { players })));
  await handler(post(duel(B, { players })));
  const team = (playerId) => post({
    board: 'teams',
    matchId: 'lobby-teams-9',
    playerId,
    tick: 8000,
    checksum: 7,
    winnerSeat: 0,
    players: [
      { playerId: A, seat: 0, team: 0, name: 'Ann' },
      { playerId: B, seat: 1, team: 0, name: 'Bea' },
      { playerId: C, seat: 2, team: 1, name: 'Cy' },
      { playerId: D, seat: 3, team: 1, name: 'Dee' },
    ],
  });
  await handler(team(A));
  await handler(team(C));
  const hill = await json(handler, post({
    action: 'koth',
    matchId: 'hill-9',
    playerId: A,
    tick: 1200,
    checksum: 7,
    points: 1,
    victimId: B,
    survivorIds: [A],
  }));
  assert.equal(hill.body.status, 'settled');

  const recent = await store.getItem(`recent#${A}`, 'recent');
  assert.deepEqual(recent.recent.map((entry) => entry.mode), ['KOTH', '2v2', '1v1']);
  assert.equal(recent.recent[0].result, 'win');
  assert.equal(recent.recent[0].opponent, 'Bea');
  assert.equal(recent.recent[1].result, 'win');
  assert.equal(recent.recent[1].opponent, 'Cy, Dee');
  assert.equal(recent.recent[2].result, 'win');
  assert.equal(recent.recent[2].opponent, 'Bea');
  assert.equal(recent.recent[2].delta, 16);
  assert.equal(recent.recent[0].matchId, 'hill-9');

  const pub = JSON.parse(store.objects.get(`ladder/players/${A}.json`));
  assert.equal(pub.playerId, A);
  assert.deepEqual(pub.recent.map((entry) => entry.mode), ['KOTH', '2v2', '1v1']);
  const fetched = await json(handler, {
    requestContext: { http: { method: 'GET' } },
    queryStringParameters: { player: A },
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.recent[2].result, 'win');
});

function snapshotBody(playerId, extra = {}) {
  return {
    action: 'snapshot',
    matchId: 'lobby-abc123',
    playerId,
    tick: 200,
    players: [
      { playerId: A, seat: 0, name: 'Ann' },
      { playerId: B, seat: 1, name: 'Bea' },
    ],
    map: 'Duel',
    mapType: '1 vs 1',
    mapSize: 'Small',
    mapSeed: '4821',
    samples: [{
      tick: 200,
      villagers: [4, 3],
      army: [40, 0],
      income: [12, 8],
      bank: [90, 70],
      actions: [6, 2],
    }],
    tech: [{ playerId: A, kind: 'building', id: 'barracks', tick: 200 }],
    stats: [
      { playerId: A, kills: 1, losses: 0, trained: 2, razes: 0, buildingsLost: 0, gathered: 12, spent: 10 },
      { playerId: B, kills: 0, losses: 1, trained: 1, razes: 0, buildingsLost: 0, gathered: 8, spent: 4 },
    ],
    ...extra,
  };
}

test('a snapshot is stored once when two players agree', async () => {
  const { store, handler } = setup();
  const first = await json(handler, post(snapshotBody(A)));
  assert.equal(first.body.status, 'pending');
  assert.equal(store.objects.has('ladder/matches/lobby-abc123.json'), false);
  const second = await json(handler, post(snapshotBody(B, { map: 'Other' })));
  assert.equal(second.body.status, 'saved');
  const saved = JSON.parse(store.objects.get('ladder/matches/lobby-abc123.json'));
  assert.equal(saved.tick, 200);
  assert.equal(saved.map, 'Other');
  assert.equal(saved.mapType, '1 vs 1');
  assert.equal(saved.mapSize, 'Small');
  assert.equal(saved.mapSeed, '4821');
  assert.equal(saved.samples[0].army[0], 40);
  assert.equal(saved.tech[0].id, 'barracks');
  const again = await json(handler, post(snapshotBody(A, {
    samples: [{
      tick: 200,
      villagers: [1, 1],
      army: [0, 0],
      income: [0, 0],
      bank: [0, 0],
      actions: [0, 0],
    }],
  })));
  assert.equal(again.body.status, 'pending');
  assert.equal(JSON.parse(store.objects.get('ladder/matches/lobby-abc123.json')).samples[0].army[0], 40);
  const fetched = await json(handler, {
    requestContext: { http: { method: 'GET' } },
    queryStringParameters: { match: 'lobby-abc123' },
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.players[0].name, 'Ann');
});
