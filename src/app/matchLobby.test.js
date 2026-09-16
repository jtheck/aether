import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchLobby } from './matchLobby.js';
import { createGameLobby } from './gameLobby.js';
import { MSG } from '../lobby/protocol.js';
import { CMD } from '../sim/commands.js';

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
  it('creates a host room and gates start until a second ready player', () => {
    const p2p = fakeP2p('host');
    const gameLobby = createGameLobby({ getP2p: () => p2p });
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby,
    });
    assert.equal(room.createRoom('teams'), true);
    assert.equal(room.isHosting(), true);
    assert.equal(room.canStart(), false);
    assert.equal(room.startBlockReason(), 'Need 2 players');
    assert.match([...p2p.lobbies][0], /aether-v2-teams:lobby-/);
    room.leaveRoom();
  });

  it('host applies join/ready and can start', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const gameLobby = createGameLobby({ getP2p: () => p2p });
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby,
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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
    room.leaveRoom();
  });

  it('seats a joiner from the type broadcast without RTC', () => {
    const hostP2p = fakeP2p('host-id');
    let hostBroadcast = null;
    const hostRoom = createMatchLobby({
      getP2p: () => hostP2p,
      getUserId: () => 'host-id',
      gameLobby: createGameLobby({ getP2p: () => hostP2p }),
      subscribeBroadcast: (fn) => { hostBroadcast = fn; return () => {}; },
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

  it('does not claim a seat from signaling from alone', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, from: 'guest', name: 'Guest', roomId, mode });
    assert.equal(room.getState().playerCount, 1);
    room.leaveRoom();
  });

  it('countdown finish loads playing and drops the browse row', async () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    let started = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
      onStartMatch: (snap) => { started = snap; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    assert.equal(room.requestStart(), true);
    dataFn({ v: 1, type: MSG.START, countdownEndsAt: Date.now() - 1, roomId, mode });
    await new Promise((r) => setTimeout(r, 0));
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
      subscribeBroadcast: (fn) => { onBroadcast = fn; return () => {}; },
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

  it('delivers chapter votes while the match is playing', () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const votes = [];
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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
    dataFn({ v: 1, type: MSG.START, countdownEndsAt: Date.now() - 1, roomId, mode });
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
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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

  it('removes a departing player from lockstep during play', async () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    dataFn({ v: 1, type: MSG.START, countdownEndsAt: Date.now() - 1, roomId, mode });
    await new Promise((r) => setTimeout(r, 0));
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

  it('reopens ready-up and browse announce when the match ends', async () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
      onStartMatch: () => {},
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    assert.equal(room.requestStart(), true);
    dataFn({ v: 1, type: MSG.START, countdownEndsAt: Date.now() - 1, roomId, mode });
    await new Promise((r) => setTimeout(r, 0));
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

  it('restores the sandbox if you leave the rematch lobby', async () => {
    const p2p = fakeP2p('host');
    let dataFn = null;
    let left = 0;
    const room = createMatchLobby({
      getP2p: () => p2p,
      getUserId: () => 'host',
      gameLobby: createGameLobby({ getP2p: () => p2p }),
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
      onStartMatch: () => {},
      onLeaveMatch: () => { left += 1; },
    });
    room.createRoom('onevsone');
    const { roomId, mode } = room.getState();
    dataFn({ v: 1, type: MSG.JOIN, userId: 'guest', name: 'Guest', color: '#0f0', roomId, mode });
    dataFn({ v: 1, type: MSG.READY, userId: 'guest', ready: true, roomId, mode });
    room.requestStart();
    dataFn({ v: 1, type: MSG.START, countdownEndsAt: Date.now() - 1, roomId, mode });
    await new Promise((r) => setTimeout(r, 0));
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
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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
    assert.equal(outbound.payload.text, 'hello world');

    lobbyFn({ type: MSG.CHAT, id: 'guest:1:aa', from: 'guest', name: 'Guest', text: 'hi there', ts: 1 }, ch);
    lobbyFn({ type: MSG.CHAT, id: 'guest:1:aa', from: 'guest', name: 'Guest', text: 'hi there', ts: 1 }, ch);
    const fromGuest = room.getChatLog().filter((m) => m.from === 'guest');
    assert.equal(fromGuest.length, 1);
    assert.equal(fromGuest[0].text, 'hi there');

    // Messages on a different room are ignored.
    lobbyFn({ type: MSG.CHAT, id: 'x:2:bb', from: 'other', text: 'nope', ts: 2 }, 'some-other-lobby');
    assert.equal(room.getChatLog().some((m) => m.from === 'other'), false);
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
      subscribeBroadcast: (fn) => { onBroadcast = fn; return () => {}; },
      subscribeDataMessage: (fn) => { dataFn = fn; return () => {}; },
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
});
