import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchLobby } from './matchLobby.js';
import { createGameLobby } from './gameLobby.js';
import { MSG } from '../lobby/protocol.js';

function fakeP2p(userId = 'host') {
  const broadcasts = [];
  const sent = [];
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
    broadcasts,
    sent,
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
});
