import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchLobby } from './matchLobby.js';
import { createGameLobby } from './gameLobby.js';
import { COUNTDOWN_MS, MSG } from '../lobby/protocol.js';
import { ladderMatchDeal } from '../lobby/ladderMap.js';
import { CMD } from '../sim/commands.js';
import { SIM_GENERATION } from '../sim/generation.js';

const withSim = (fn) => (message, ...rest) => fn(
  { sim: SIM_GENERATION, ...message },
  ...rest,
);

async function finishCountdown(t) {
  t.mock.timers.tick(COUNTDOWN_MS);
  await Promise.resolve();
}

function fakeP2p(userId = 'host') {
  const broadcasts = [];
  const sent = [];
  const lobbyMessages = [];
  const lobbies = new Set();
  return {
    getUserId: () => userId,
    joinBroadcast() {},
    leaveBroadcast() {},
    broadcast(data, channel) { broadcasts.push({ data, channel }); },
    joinMatchLobby(name) { lobbies.add(name); },
    leaveMatchLobby(name) { lobbies.delete(name); },
    requestMatch() {},
    announcePresence() {},
    sendData(msg, peerId) { sent.push({ msg, peerId }); },
    sendLobbyMessage(lobbyName, payload) {
      if (!lobbies.has(lobbyName)) return false;
      lobbyMessages.push({ lobbyName, payload });
      return true;
    },
    broadcasts,
    sent,
    lobbyMessages,
    lobbies,
  };
}

describe('match lobby', () => {
  it('parks other matchmaking for the full room lifetime', () => {
    const p2p = fakeP2p('host');
    const activeChanges = [];
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      onActiveChange: (active) => activeChanges.push(active),
    });

    room.createRoom('onevsone');
    room.leaveRoom();

    assert.deepEqual(activeChanges, [true, false]);
  });

  it('creates a host room and gates start until a second ready player', () => {
    const p2p = fakeP2p('host');
    const gameLobby = createGameLobby({ getP2p: () => p2p });
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby,
    });
    assert.equal(room.createRoom('teams'), true);
    assert.equal(room.hasPlayed(), false);
    assert.equal(room.isHosting(), true);
    assert.equal(room.canStart(), false);
    assert.equal(room.startBlockReason(), 'Need 2 players');
    assert.match([...p2p.lobbies][0], /aether-v2-teams:lobby-/);
    room.leaveRoom();
  });

  it('rejects a peer that omits the live simulation generation', () => {
    const p2p = fakeP2p('host');
    let receive = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { receive = fn; return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    const join = { v: 1, type: MSG.JOIN, userId: 'guest', roomId, mode };

    receive(join);
    assert.equal(room.getState().playerCount, 1);
    receive({ ...join, sim: SIM_GENERATION });
    assert.equal(room.getState().playerCount, 2);
  });

  it('host applies join/ready and can start', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const gameLobby = createGameLobby({ getP2p: () => p2p });
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby,
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({
      v: 1,
      type: MSG.JOIN,
      from: 'host',
      userId: 'guest',
      name: 'Guest',
      color: '#0f0',
      roomId,
      mode,
    });
    assert.equal(room.getState().playerCount, 2);
    assert.notEqual(room.getState().seats[0].userId, room.getState().seats[1].userId);
    assert.equal(room.canStart(), false);
    dataFn({
      v: 1,
      type: MSG.READY,
      from: 'host',
      userId: 'guest',
      ready: true,
      roomId,
      mode,
    });
    assert.equal(room.canStart(), true);
    assert.equal(room.requestStart(), true);
    assert.equal(room.getState().phase, 'countdown');
    assert.equal(room.getState().settings.fieldSize, 'tiny');
    room.leaveRoom();
  });

  it('seats a joiner from the type broadcast without RTC', () => {
    const hostP2p = fakeP2p('host-id');
    let hostBroadcast = null;
    const hostRoom = createMatchLobby({
      getP2p: () => hostP2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => hostP2p }),
      subscribeBroadcast: (fn) => { hostBroadcast = withSim(fn); return () => {}; },
    });
    hostRoom.createRoom('onevsone');
    const { roomId, mode } = hostRoom.getState();
    hostBroadcast({
      v: 1,
      type: MSG.JOIN,
      userId: 'guest-id',
      name: 'Guest',
      color: '#00f',
      roomId,
      mode,
    });
    const seats = hostRoom.getState().seats;
    assert.equal(seats[0].userId, 'host-id');
    assert.equal(seats[1].userId, 'guest-id');
    assert.equal(seats[0].name !== seats[1].name || seats[0].userId !== seats[1].userId, true);
    hostRoom.leaveRoom();
  });

  it('starts a ranked countdown when the guest joins on the type broadcast', () => {
    const hostP2p = fakeP2p('host-id');
    let hostBroadcast = null;
    const hostRoom = createMatchLobby({
      getP2p: () => hostP2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => hostP2p }),
      subscribeBroadcast: (fn) => { hostBroadcast = withSim(fn); return () => {}; },
    });
    hostRoom.createRoom('onevsone', { roomId: 'lobby-ranked', seed: 7, ranked: true });
    hostBroadcast({
      v: 1,
      type: MSG.JOIN,
      userId: 'guest-id',
      name: 'Guest',
      color: '#00f',
      ready: true,
      roomId: 'lobby-ranked',
      mode: 'onevsone',
    });
    assert.equal(hostRoom.getState().phase, 'countdown');
    assert.equal(hostRoom.getState().ranked, true);
    const deal = ladderMatchDeal(7);
    assert.equal(hostRoom.getState().settings.seed, deal.seed);
    assert.equal(hostRoom.getState().settings.fieldSize, deal.fieldSize);
    hostRoom.leaveRoom();
  });

  it('gives the guest the host seed and both seats', () => {
    const hostP2p = fakeP2p('host-id');
    let hostBroadcast = null;
    const hostRoom = createMatchLobby({
      getP2p: () => hostP2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => hostP2p }),
      subscribeBroadcast: (fn) => { hostBroadcast = withSim(fn); return () => {}; },
    });
    hostRoom.createRoom('onevsone', { roomId: 'lobby-ranked', seed: 7, ranked: true });
    const guestP2p = fakeP2p('guest-id');
    let guestBroadcast = null;
    const guestRoom = createMatchLobby({
      getP2p: () => guestP2p,
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => guestP2p }),
      subscribeBroadcast: (fn) => { guestBroadcast = withSim(fn); return () => {}; },
    });
    guestRoom.joinRoom('onevsone', 'lobby-ranked', 'host-id', { ranked: true, seed: 7 });
    hostBroadcast({
      v: 1,
      type: MSG.JOIN,
      userId: 'guest-id',
      name: 'Guest',
      color: '#00f',
      ready: true,
      roomId: 'lobby-ranked',
      mode: 'onevsone',
    });
    const start = hostP2p.broadcasts.map((row) => row.data).find((data) => data.type === MSG.START);
    const deal = ladderMatchDeal(7);
    assert.equal(start.seed, deal.seed);
    assert.equal(start.settings.fieldSize, deal.fieldSize);
    assert.equal(start.seats.filter((seat) => seat.kind === 'human').length, 2);
    guestBroadcast(start);
    const guest = guestRoom.getState();
    assert.equal(guest.settings.seed, deal.seed);
    assert.equal(guest.settings.fieldSize, deal.fieldSize);
    assert.equal(guest.playerCount, 2);
    assert.equal(guest.phase, 'countdown');
    hostRoom.leaveRoom();
    guestRoom.leaveRoom();
  });

  it('seats a ranked teams match from the roster and waits for all four', () => {
    const hostP2p = fakeP2p('host-id');
    let hostBroadcast = null;
    const hostRoom = createMatchLobby({
      getP2p: () => hostP2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => hostP2p }),
      subscribeBroadcast: (fn) => { hostBroadcast = withSim(fn); return () => {}; },
    });
    hostRoom.createRoom('teams', {
      roomId: 'lobby-teams',
      seed: 11,
      ranked: true,
      roster: [
        { userId: 'host-id', seat: 2, team: 1 },
        { userId: 'a', seat: 0, team: 0 },
        { userId: 'b', seat: 1, team: 0 },
        { userId: 'c', seat: 3, team: 1 },
      ],
    });
    assert.equal(hostRoom.getState().seats[2].userId, 'host-id');
    assert.equal(hostRoom.getState().seats[0].kind, 'empty');
    const join = (userId) => hostBroadcast({
      v: 1,
      type: MSG.JOIN,
      userId,
      name: userId,
      color: '#00f',
      ready: true,
      roomId: 'lobby-teams',
      mode: 'teams',
    });
    join('a');
    assert.equal(hostRoom.getState().phase, 'waiting');
    assert.equal(hostRoom.getState().seats[0].userId, 'a');
    join('stranger');
    assert.equal(hostRoom.getState().seats.some((seat) => seat.userId === 'stranger'), false);
    join('b');
    assert.equal(hostRoom.getState().phase, 'waiting');
    join('c');
    assert.equal(hostRoom.getState().phase, 'countdown');
    assert.deepEqual(hostRoom.getState().seats.map((seat) => seat.userId), ['a', 'b', 'host-id', 'c']);
    const deal = ladderMatchDeal(11, 'teams');
    assert.equal(hostRoom.getState().settings.seed, deal.seed);
    assert.equal(hostRoom.getState().settings.fieldSize, deal.fieldSize);
    hostRoom.leaveRoom();
  });

  it('does not claim a seat from signaling from alone', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, from: 'guest', name: 'Guest', roomId, mode });
    assert.equal(room.getState().playerCount, 1);
    room.leaveRoom();
  });

  it('countdown finish loads playing and drops the browse row', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    let started = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onStartMatch: (snap) => { started = snap; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    assert.equal(room.requestStart(), true);
    await finishCountdown(t);
    assert.equal(room.getState().phase, 'playing');
    assert.equal(started?.roomId, roomId);
    assert.ok(p2p.broadcasts.some((row) => row.data.type === MSG.CLOSED));
    room.leaveRoom();
  });

  it('does not drop a joiner when the host closes the browse listing after start', () => {
    let onBroadcast = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('guest-id'),
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('guest-id') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
    });
    guest.joinRoom('onevsone', 'lobby-1', 'host-id');
    onBroadcast({
      v: 1,
      type: MSG.ANNOUNCE,
      mode: 'onevsone',
      roomId: 'lobby-1',
      phase: 'playing',
      seats: [
        { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true },
        { index: 1, kind: 'human', userId: 'guest-id', name: 'G', ready: true },
      ],
      settings: { fieldSize: 'tiny', seed: 1 },
    });
    assert.equal(guest.getState().phase, 'playing');
    onBroadcast({ v: 1, type: MSG.CLOSED, mode: 'onevsone', roomId: 'lobby-1' });
    assert.equal(guest.isActive(), true);
    guest.leaveRoom();
  });

  it('delivers chapter votes while the match is playing', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    const votes = [];
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onChapter: (msg) => votes.push(msg),
    });
    room.createRoom('adventure');
    const { roomId, mode } = room.getState();
    dataFn({
      v: 1,
      type: MSG.JOIN,
      userId: 'guest',
      name: 'Guest',
      color: '#0f0',
      roomId,
      mode,
    });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    await finishCountdown(t);
    dataFn({
      v: 1,
      type: MSG.CHAPTER,
      roomId,
      mode,
      url: '/maps/chapter2.garden',
      playerId: 1,
      party: [{ name: 'A' }],
      epoch: 1,
    });
    assert.equal(votes.length, 1);
    assert.equal(votes[0].url, '/maps/chapter2.garden');
    room.sendChapter({ url: '/maps/chapter2.garden', playerId: 0, epoch: 1 });
    assert.equal(p2p.sent.at(-1).msg.type, MSG.CHAPTER);
    room.leaveRoom();
  });

  it('embeds a workshop garden on START so guests can play', async () => {
    const garden = { v: 4, n: 'Grove', w: 8, h: 8 };
    const p2p = fakeP2p('host');
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      loadGarden: async (settings) => (settings.chapter === 'workshop:99' ? garden : null),
    });
    room.createRoom('adventure');
    room.setSetting('chapter', 'workshop:99');
    assert.equal(room.requestStart(), true);
    assert.equal(room.getState().loadingMap, true);
    await new Promise((r) => setTimeout(r, 0));
    const start = p2p.sent.find((row) => row.msg.type === MSG.START);
    assert.deepEqual(start.msg.garden, garden);
    assert.deepEqual(room.getState().garden, garden);
    assert.equal(room.getState().phase, 'countdown');
    room.leaveRoom();
  });

  it('guests keep an embedded START garden for match load', () => {
    const garden = { v: 4, n: 'Grove', w: 8, h: 8 };
    let dataFn = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('guest-id'),
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('guest-id') }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    guest.joinRoom('adventure', 'lobby-1', 'host-id');
    dataFn({
      v: 1,
      type: MSG.START,
      countdownEndsAt: Date.now() + 3000,
      roomId: 'lobby-1',
      mode: 'adventure',
      garden,
    });
    assert.deepEqual(guest.getState().garden, garden);
    guest.leaveRoom();
  });

  it('drops lockstep frames from a previous chapter epoch', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const buffered = [];
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('adventure');
    const { roomId, mode } = room.getState();
    room.attachSession({
      localPlayerId: 0,
      role: 'player',
      confirmedTick: 0,
      submitCommand() { return { tick: 1, playerId: 0, commands: [] }; },
      bufferRemoteFrame(frame) { buffered.push(frame); },
      setPeerConfirmedTick() {},
    });
    dataFn({
      v: 1,
      type: MSG.FRAME,
      roomId,
      mode,
      epoch: 0,
      frame: { tick: 2, playerId: 1, commands: [{ type: 1 }] },
    });
    room.setLockstepEpoch(1);
    dataFn({
      v: 1,
      type: MSG.FRAME,
      roomId,
      mode,
      epoch: 0,
      frame: { tick: 4000, playerId: 1, commands: [{ type: 1 }] },
    });
    dataFn({
      v: 1,
      type: MSG.FRAME,
      roomId,
      mode,
      epoch: 1,
      frame: { tick: 1, playerId: 1, commands: [{ type: 1 }] },
    });
    assert.equal(buffered.length, 2);
    assert.equal(buffered[0].tick, 2);
    assert.equal(buffered[1].tick, 1);
    room.leaveRoom();
  });

  it('removes a departing player from lockstep during play', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    await finishCountdown(t);
    assert.equal(room.getState().phase, 'playing');

    const removed = [];
    const frames = [];
    room.attachSession({
      localPlayerId: 0,
      role: 'player',
      confirmedTick: 10,
      humanPlayers: [0, 1],
      submitCommand() { return null; },
      removeHumanPlayer(id) { removed.push(id); },
      submitAtTick(tick, cmd, opts) {
        frames.push({ tick, cmd, opts });
        return { tick, playerId: 0, commands: [cmd], commandId: opts.commandId };
      },
      bufferRemoteFrame() {},
      setPeerConfirmedTick() {},
    });
    dataFn({
      v: 1,
      type: MSG.LEAVE,
      userId: 'guest',
      playerId: 1,
      tick: 12,
      roomId,
      mode,
    });
    assert.deepEqual(removed, [1]);
    assert.equal(room.getState().playerCount, 1);
    assert.equal(frames[0].cmd.type, CMD.FORCE_ELIMINATE);
    assert.equal(frames[0].cmd.playerId, 1);
    assert.equal(frames[0].tick, 12);
    room.leaveRoom();
  });

  it('forfeits an opponent who drops during play', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    let onDisconnect = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      subscribePeerDisconnected: (fn) => { onDisconnect = fn; return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    await finishCountdown(t);
    assert.equal(room.getState().phase, 'playing');

    const removed = [];
    const frames = [];
    onDisconnect('guest');
    assert.equal(room.getState().playerCount, 1);
    room.attachSession({
      localPlayerId: 0,
      role: 'player',
      confirmedTick: 10,
      humanPlayers: [0, 1],
      submitCommand() { return null; },
      removeHumanPlayer(id) { removed.push(id); },
      submitAtTick(tick, cmd, opts) {
        frames.push({ tick, cmd, opts });
        return { tick, playerId: 0, commands: [cmd], commandId: opts.commandId };
      },
      bufferRemoteFrame() {},
      setPeerConfirmedTick() {},
    });
    assert.deepEqual(removed, [1]);
    assert.equal(frames[0].cmd.type, CMD.FORCE_ELIMINATE);
    assert.equal(frames[0].cmd.playerId, 1);
    room.leaveRoom();
  });

  it('forfeits the host when their link drops during play', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    let dataFn = null;
    let onDisconnect = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('guest'),
      getUserId: () => 'guest',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('guest') }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      subscribePeerDisconnected: (fn) => { onDisconnect = fn; return () => {}; },
      onStartMatch: () => {},
    });
    guest.joinRoom('onevsone', 'lobby-1', 'host');
    dataFn({
      v: 1,
      type: MSG.START,
      countdownEndsAt: Date.now() - 1,
      roomId: 'lobby-1',
      mode: 'onevsone',
      seats: [
        { index: 0, kind: 'human', userId: 'host', name: 'Host', ready: true },
        { index: 1, kind: 'human', userId: 'guest', name: 'Guest', ready: true },
      ],
    });
    await finishCountdown(t);
    assert.equal(guest.getState().phase, 'playing');
    const removed = [];
    guest.attachSession({
      localPlayerId: 1,
      role: 'player',
      confirmedTick: 4,
      submitCommand() { return null; },
      removeHumanPlayer(id) { removed.push(id); },
      submitAtTick() { return { tick: 6 }; },
      bufferRemoteFrame() {},
      setPeerConfirmedTick() {},
    });
    onDisconnect('host');
    assert.deepEqual(removed, [0]);
    assert.equal(guest.getState().playerCount, 1);
    guest.leaveRoom();
  });

  it('closes a ranked countdown when the opponent leaves', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host-id');
    let onBroadcast = null;
    let requeue = 0;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
      onRankedPregameEnd: () => { requeue += 1; },
    });
    room.createRoom('onevsone', { roomId: 'lobby-ranked', seed: 7, ranked: true });
    onBroadcast({
      v: 1,
      type: MSG.JOIN,
      userId: 'guest-id',
      name: 'Guest',
      color: '#00f',
      ready: true,
      roomId: 'lobby-ranked',
      mode: 'onevsone',
    });
    assert.equal(room.getState().phase, 'countdown');
    onBroadcast({
      v: 1,
      type: MSG.LEAVE,
      userId: 'guest-id',
      roomId: 'lobby-ranked',
      mode: 'onevsone',
    });
    assert.equal(room.isActive(), false);
    assert.equal(requeue, 1);
    room.leaveRoom();
    assert.equal(requeue, 1);
  });

  it('leaves the countdown when the host closes it', () => {
    let onBroadcast = null;
    let requeue = 0;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('guest-id'),
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('guest-id') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
      onRankedPregameEnd: () => { requeue += 1; },
    });
    guest.joinRoom('onevsone', 'lobby-ranked', 'host-id', { ranked: true, seed: 7 });
    onBroadcast({
      v: 1,
      type: MSG.START,
      countdownEndsAt: Date.now() + 3000,
      roomId: 'lobby-ranked',
      mode: 'onevsone',
      phase: 'countdown',
      seats: [
        { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true },
        { index: 1, kind: 'human', userId: 'guest-id', name: 'G', ready: true },
      ],
    });
    assert.equal(guest.getState().phase, 'countdown');
    onBroadcast({
      v: 1,
      type: MSG.CLOSED,
      mode: 'onevsone',
      roomId: 'lobby-ranked',
      phase: 'countdown',
    });
    assert.equal(guest.isActive(), false);
    assert.equal(requeue, 1);
  });

  it('forfeits a player whose confirms stop', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    await finishCountdown(t);
    assert.equal(room.getState().phase, 'playing');
    const removed = [];
    const frames = [];
    room.attachSession({
      localPlayerId: 0,
      role: 'player',
      confirmedTick: 10,
      lockstepBlockedMs() { return 8000; },
      lockstepWaiters() { return [1]; },
      submitCommand() { return null; },
      removeHumanPlayer(id) { removed.push(id); },
      submitAtTick(tick, cmd) {
        frames.push({ tick, cmd });
        return { tick, playerId: 0, commands: [cmd] };
      },
      bufferRemoteFrame() {},
      setPeerConfirmedTick() {},
    });
    t.mock.timers.tick(500);
    assert.deepEqual(removed, [1]);
    assert.equal(frames[0].cmd.type, CMD.FORCE_ELIMINATE);
    assert.equal(frames[0].cmd.playerId, 1);
    room.leaveRoom();
  });

  it('leaves a ranked lobby when the opponent never arrives', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
    const p2p = fakeP2p('host-id');
    let requeue = 0;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      onRankedPregameEnd: () => { requeue += 1; },
    });
    room.createRoom('onevsone', { roomId: 'lobby-ranked', seed: 7, ranked: true });
    assert.equal(room.getState().phase, 'waiting');
    t.mock.timers.tick(500);
    t.mock.timers.tick(12000);
    assert.equal(room.isActive(), false);
    assert.equal(requeue, 1);
  });

  it('reopens ready-up and browse announce when the match ends', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onStartMatch: () => {},
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    assert.equal(room.requestStart(), true);
    await finishCountdown(t);
    assert.equal(room.getState().phase, 'playing');
    const before = p2p.broadcasts.length;
    assert.equal(room.returnToWaiting(), true);
    const state = room.getState();
    assert.equal(state.phase, 'waiting');
    assert.equal(state.seats.find((s) => s.userId === 'guest')?.ready, false);
    assert.equal(state.seats.find((s) => s.userId === 'host')?.ready, true);
    assert.ok(p2p.broadcasts.slice(before).some((row) => row.data.type === MSG.ANNOUNCE));
    assert.equal(room.returnToWaiting(), false);
    room.leaveRoom();
  });

  it('restores the sandbox if you leave the rematch lobby', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const p2p = fakeP2p('host');
    let dataFn = null;
    let left = 0;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onStartMatch: () => {},
      onLeaveMatch: () => { left += 1; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    await finishCountdown(t);
    room.returnToWaiting();
    assert.equal(left, 0);
    room.leaveRoom();
    assert.equal(left, 1);
  });

  it('guest pings the host after returning to the rematch lobby', async () => {
    const p2p = fakeP2p('guest-id');
    let dataFn = null;
    const guest = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onStartMatch: () => {},
    });
    guest.joinRoom('onevsone', 'lobby-1', 'host-id');
    dataFn({
      v: 1,
      type: MSG.START,
      countdownEndsAt: Date.now() - 1,
      roomId: 'lobby-1',
      mode: 'onevsone',
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(guest.getState().phase, 'playing');
    const before = p2p.sent.length;
    assert.equal(guest.returnToWaiting(), true);
    assert.equal(guest.getState().phase, 'waiting');
    const join = p2p.sent.slice(before).find((row) => row.msg.type === MSG.JOIN);
    assert.equal(join?.msg.ready, false);
    guest.leaveRoom();
  });

  it('sends chat on the match room and logs inbound messages, deduping by id', () => {
    const p2p = fakeP2p('host');
    let lobbyFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeLobbyMessage: (fn) => { lobbyFn = fn; return () => {}; },
    });
    room.createRoom('onevsone');
    const ch = [...p2p.lobbies][0];

    assert.equal(room.sendChat('  hello   world  '), true);
    const outbound = p2p.lobbyMessages.find((m) => m.payload.type === MSG.CHAT);
    assert.equal(outbound.lobbyName, ch);
    assert.equal(outbound.payload.content.text, 'hello world');
    const own = room.getChatLog();
    assert.equal(own.length, 1);
    assert.equal(own[0].text, 'hello world');
    assert.equal(own[0].from, 'host');
    assert.equal(own[0].watching, false);
    // Self-echo of the same id must not double-paint.
    lobbyFn(outbound.payload, ch);
    assert.equal(room.getChatLog().length, 1);

    lobbyFn({ type: MSG.CHAT, content: { type: MSG.CHAT, id: 'guest:1:aa', from: 'guest', name: 'Guest', text: 'hi there', ts: 1 } }, ch);
    lobbyFn({ type: MSG.CHAT, id: 'guest:1:aa', from: 'guest', name: 'Guest', text: 'hi there', ts: 1 }, ch);
    const fromGuest = room.getChatLog().filter((m) => m.from === 'guest');
    assert.equal(fromGuest.length, 1);
    assert.equal(fromGuest[0].text, 'hi there');

    // Messages on a different room are ignored.
    lobbyFn({ type: MSG.CHAT, id: 'x:2:bb', from: 'other', text: 'nope', ts: 2 }, 'some-other-lobby');
    assert.equal(room.getChatLog().some((m) => m.from === 'other'), false);
    room.leaveRoom();
  });

  it('logs chat from the data channel and type broadcast', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    let broadcastFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeBroadcast: (fn) => { broadcastFn = withSim(fn); return () => {}; },
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({
      v: 1,
      type: MSG.CHAT,
      mode,
      roomId,
      id: 'p:1:aa',
      from: 'peer',
      name: 'Peer',
      text: 'via rtc',
      ts: 1,
    });
    broadcastFn({
      v: 1,
      type: MSG.CHAT,
      mode,
      roomId,
      id: 'p:2:bb',
      from: 'peer',
      name: 'Peer',
      text: 'via air',
      ts: 2,
    });
    dataFn({
      v: 1,
      type: MSG.CHAT,
      mode: 'teams',
      roomId,
      id: 'wrong-mode:1',
      from: 'other',
      text: 'wrong mode',
      ts: 3,
    });
    broadcastFn({
      v: 1,
      type: MSG.CHAT,
      mode,
      roomId: 'other-room',
      id: 'wrong-room:1',
      from: 'other',
      text: 'wrong room',
      ts: 4,
    });
    const texts = room.getChatLog().map((m) => m.text);
    assert.deepEqual(texts, ['via rtc', 'via air']);
    room.leaveRoom();
  });

  it('rate-limits chat and drops empty messages', () => {
    const p2p = fakeP2p('host');
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
    });
    room.createRoom('onevsone');
    assert.equal(room.sendChat('first'), true);
    assert.equal(room.sendChat('second too soon'), false);
    assert.equal(room.sendChat('   '), false);
    assert.equal(p2p.lobbyMessages.filter((m) => m.payload.type === MSG.CHAT).length, 1);
    room.leaveRoom();
  });

  it('does not send chat outside a room', () => {
    const p2p = fakeP2p('host');
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
    });
    assert.equal(room.sendChat('hello'), false);
    assert.equal(p2p.lobbyMessages.length, 0);
  });

  it('guest leaves the frozen board if the host closes the rematch lobby', async () => {
    let onBroadcast = null;
    let dataFn = null;
    let left = 0;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('guest-id'),
      getUserId: () => 'guest-id',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('guest-id') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      onStartMatch: () => {},
      onLeaveMatch: () => { left += 1; },
    });
    guest.joinRoom('onevsone', 'lobby-1', 'host-id');
    dataFn({
      v: 1,
      type: MSG.START,
      countdownEndsAt: Date.now() - 1,
      roomId: 'lobby-1',
      mode: 'onevsone',
    });
    await new Promise((r) => setTimeout(r, 0));
    guest.returnToWaiting();
    onBroadcast({ v: 1, type: MSG.CLOSED, mode: 'onevsone', roomId: 'lobby-1' });
    assert.equal(guest.isActive(), false);
    assert.equal(left, 1);
  });

  it('lists a full-lobby joiner as a spectator and keeps the seats', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', roomId, mode });
    dataFn({ v: 1, type: MSG.JOIN, userId: 'eye', name: 'Eye', roomId, mode });
    const state = room.getState();
    assert.equal(state.playerCount, 2);
    assert.equal(state.seats.some((s) => s.userId === 'eye'), false);
    assert.equal(state.spectators[0].userId, 'eye');
    room.leaveRoom();
  });

  it('a listed spectator follows the same countdown as the seats', () => {
    let onBroadcast = null;
    let started = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('eye'),
      getUserId: () => 'eye',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('eye') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
      onStartMatch: (snap) => { started = snap; },
    });
    guest.joinRoom('onevsone', 'lobby-1', 'host-id');
    onBroadcast({
      v: 1,
      type: MSG.ANNOUNCE,
      mode: 'onevsone',
      roomId: 'lobby-1',
      phase: 'waiting',
      seats: [
        { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true, team: 0 },
        { index: 1, kind: 'human', userId: 'guest', name: 'G', ready: true, team: 0 },
      ],
      spectators: [{ userId: 'eye', name: 'Eye', color: '' }],
      settings: { fieldSize: 'tiny', seed: 1 },
    });
    assert.equal(guest.getState().watching, true);
    assert.equal(guest.getState().playerCount, 2);
    assert.equal(guest.sendChat('from the stands'), true);
    assert.equal(guest.getChatLog()[0].watching, true);
    onBroadcast({
      v: 1,
      type: MSG.START,
      mode: 'onevsone',
      roomId: 'lobby-1',
      countdownEndsAt: Date.now() - 1,
    });
    return new Promise((r) => setTimeout(r, 0)).then(() => {
      assert.equal(started?.roomId, 'lobby-1');
      assert.equal(guest.getState().phase, 'playing');
      guest.leaveRoom();
    });
  });

  it('seats a 1v1 watcher without taking a player slot', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', roomId, mode });
    dataFn({ v: 1, type: MSG.SPECTATE, userId: 'watch', name: 'Eye', color: '#fff', roomId, mode });
    const state = room.getState();
    assert.equal(state.playerCount, 2);
    assert.equal(state.seats.some((s) => s.userId === 'watch'), false);
    assert.equal(state.spectators.length, 1);
    assert.equal(state.spectators[0].userId, 'watch');
    assert.equal(room.canStart(), false);
    room.leaveRoom();
  });

  it('embeds a custom 1v1 map on START so guests can play', async () => {
    const garden = { v: 4, n: 'Duel', w: 32, h: 32, mt: 'onevsone' };
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
      loadGarden: async (settings) => (settings.chapter === 'workshop:10/map.garden' ? garden : null),
    });
    room.createRoom('onevsone');
    room.setSetting('chapter', 'workshop:10/map.garden');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    assert.equal(room.requestStart(), true);
    await new Promise((r) => setTimeout(r, 0));
    const start = p2p.sent.find((row) => row.msg.type === MSG.START);
    assert.deepEqual(start.msg.garden, garden);
    assert.equal(room.getState().settings.chapter, 'workshop:10/map.garden');
    room.leaveRoom();
  });

  it('refuses a full-lobby joiner when spectators are off', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('teams');
    room.setSetting('allowSpectators', false);
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', roomId, mode });
    dataFn({ v: 1, type: MSG.JOIN, userId: 'ally', name: 'Ally', roomId, mode });
    dataFn({ v: 1, type: MSG.JOIN, userId: 'eye', name: 'Eye', roomId, mode });
    dataFn({ v: 1, type: MSG.JOIN, userId: 'extra', name: 'Extra', roomId, mode });
    dataFn({ v: 1, type: MSG.SPECTATE, userId: 'watch', name: 'Watch', roomId, mode });
    const state = room.getState();
    assert.equal(state.settings.allowSpectators, false);
    assert.equal(state.playerCount, 4);
    assert.equal(state.seats.some((s) => s.userId === 'extra'), false);
    assert.equal(state.spectators.length, 0);
    assert.equal(room.movePerson('eye', 1), false);
    room.leaveRoom();
  });

  it('sends a watcher home when the host turns spectators off', () => {
    let onBroadcast = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('eye'),
      getUserId: () => 'eye',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('eye') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
    });
    assert.equal(guest.spectateRoom('onevsone', 'lobby-1', 'host-id'), true);
    onBroadcast({
      v: 1,
      type: MSG.ANNOUNCE,
      mode: 'onevsone',
      roomId: 'lobby-1',
      phase: 'waiting',
      seats: [
        { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true, team: 0 },
        { index: 1, kind: 'human', userId: 'guest', name: 'G', ready: true, team: 0 },
      ],
      spectators: [],
      settings: { fieldSize: 'tiny', seed: 1, chapter: '', allowSpectators: false },
    });
    assert.equal(guest.isActive(), false);
  });

  it('keeps a watcher waiting while the host still allows spectators', () => {
    let onBroadcast = null;
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('eye'),
      getUserId: () => 'eye',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('eye') }),
      subscribeBroadcast: (fn) => { onBroadcast = withSim(fn); return () => {}; },
    });
    guest.spectateRoom('onevsone', 'lobby-1', 'host-id');
    onBroadcast({
      v: 1,
      type: MSG.ANNOUNCE,
      mode: 'onevsone',
      roomId: 'lobby-1',
      phase: 'waiting',
      seats: [
        { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true, team: 0 },
        { index: 1, kind: 'empty', userId: null, name: '', ready: false, team: 0 },
      ],
      spectators: [],
      settings: { fieldSize: 'tiny', seed: 1, allowSpectators: true },
    });
    assert.equal(guest.isActive(), true);
    assert.equal(guest.getState().watching, false);
    guest.leaveRoom();
  });

  it('refuses an adventure spectator', () => {
    const guest = createMatchLobby({
      getP2p: () => fakeP2p('eye'),
      getUserId: () => 'eye',
      gameLobby: createGameLobby({ getP2p: () => fakeP2p('eye') }),
    });
    assert.equal(guest.spectateRoom('adventure', 'lobby-1', 'host'), false);
    assert.equal(guest.isActive(), false);
  });

  it('watcher joins the match room and does not ready', () => {
    const p2p = fakeP2p('eye');
    const guest = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'eye',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
    });
    assert.equal(guest.spectateRoom('onevsone', 'lobby-1', 'host-id'), true);
    const state = guest.getState();
    assert.equal(state.watching, true);
    assert.equal(state.playerCount, 0);
    assert.equal(state.spectators[0].userId, 'eye');
    assert.ok(p2p.broadcasts.some((row) => row.data.type === MSG.SPECTATE));
    guest.setReady(true);
    assert.equal(p2p.sent.some((row) => row.msg.type === MSG.READY), false);
    guest.leaveRoom();
  });

  it('marks a seat as watching the replay and relays it', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = withSim(fn); return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({
      v: 1,
      type: MSG.JOIN,
      from: 'host',
      userId: 'guest',
      name: 'Guest',
      color: '#0f0',
      roomId,
      mode,
    });
    assert.equal(room.setReplayWatch(true), true);
    assert.equal(room.getState().seats.find((s) => s.userId === 'host').replay, true);
    dataFn({
      v: 1,
      type: MSG.REPLAY,
      from: 'guest',
      userId: 'guest',
      replay: true,
      roomId,
      mode,
    });
    assert.equal(room.getState().seats.find((s) => s.userId === 'guest').replay, true);
    assert.equal(room.setReplayWatch(false), true);
    assert.equal(room.getState().seats.find((s) => s.userId === 'host').replay, false);
    room.leaveRoom();
  });
});
