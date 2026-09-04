import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInLobbyStatus,
  formatLobbyPlayerLine,
  formatLobbyRow,
  lobbyPeople,
  lobbyRowSignature,
  shouldCenterKothLobby,
  shouldShowKothBrowser,
  shouldShowKothWaitingHud,
} from './kothLobby.js';
import { generateLobbyName } from '../koth/lobbyName.js';

describe('koth lobby rows', () => {
  it('uses a unique lobby name instead of the host name', () => {
    const row = formatLobbyRow({
      matchId: 'koth-abc-12345678',
      lobbyName: 'Quiet Hill',
      hostName: 'Blind',
      activeCount: 2,
      seats: 5,
      tick: 0,
    });
    assert.equal(row.title, 'Quiet Hill');
    assert.equal(row.meta, '2/5  ·  0s');
    assert.match(row.label, /Join Quiet Hill/);
  });

  it('derives a stable name from match id when none is announced', () => {
    const matchId = 'koth-zzzz-deadbeef';
    const row = formatLobbyRow({
      matchId,
      hostName: 'Blind',
      activeCount: 1,
      seats: 5,
      tick: 120,
    });
    assert.equal(row.title, generateLobbyName(matchId));
    assert.equal(row.meta, '1/5  ·  6s');
  });

  it('notes watchers in the lobby meta', () => {
    const row = formatLobbyRow({
      matchId: 'koth-abc-12345678',
      lobbyName: 'Amber Agora',
      activeCount: 1,
      spectatorCount: 2,
      seats: 5,
      tick: 0,
    });
    assert.equal(row.meta, '1/5  ·  2 watching  ·  0s');
  });

  it('titles the in-match card with the lobby name', () => {
    const hosted = formatInLobbyStatus({
      hosting: true,
      lobbyName: 'Quiet Hill',
      hostName: 'Overseer',
      activeCount: 1,
      seats: 5,
      tick: 0,
    });
    assert.equal(hosted.title, 'Quiet Hill');
    assert.equal(hosted.meta, '1/5  ·  0s');
    const joined = formatInLobbyStatus({
      hosting: false,
      role: 'player',
      lobbyName: 'Quiet Hill',
      hostName: 'Overseer',
      activeCount: 2,
      seats: 5,
      tick: 40,
    });
    assert.equal(joined.title, 'Quiet Hill');
    const spec = formatInLobbyStatus({
      hosting: false,
      role: 'spectator',
      lobbyName: 'Quiet Hill',
      hostName: 'Overseer',
      activeCount: 2,
      spectators: [{ name: 'Sam', spectator: true }],
      seats: 5,
      tick: 40,
    });
    assert.equal(spec.title, 'Quiet Hill');
    assert.equal(spec.meta, '2/5  ·  1 watching  ·  2s');
    const searching = formatInLobbyStatus({
      appState: 'matchmaking',
      hosting: false,
      activeCount: 1,
      seats: 5,
      tick: 0,
    });
    assert.equal(searching.title, 'Looking for a match…');
    const stalled = formatInLobbyStatus({
      stalled: true,
      lobbyName: 'Quiet Hill',
      activeCount: 2,
      seats: 5,
      tick: 40,
    });
    assert.equal(stalled.title, 'Waiting for players…');
    assert.equal(stalled.meta, '2/5  ·  2s');
  });

  it('hides the KOTH browser while another game type is live', () => {
    assert.equal(shouldShowKothBrowser({ browsing: true }), true);
    assert.equal(shouldShowKothBrowser({ parked: true, browsing: true }), false);
  });

  it('centers the HUD while waiting, not while browsing, playing, or lagging', () => {
    assert.equal(shouldCenterKothLobby({ browsing: true }), false);
    assert.equal(shouldCenterKothLobby({ waiting: true, browsing: false }), true);
    assert.equal(shouldCenterKothLobby({ role: 'player', activeCount: 1, browsing: false }), true);
    assert.equal(shouldCenterKothLobby({ role: 'spectator', activeCount: 2, browsing: false }), true);
    assert.equal(shouldCenterKothLobby({ role: 'player', activeCount: 2, browsing: false }), false);
    assert.equal(shouldCenterKothLobby({
      role: 'player',
      activeCount: 2,
      browsing: false,
      stalled: true,
      waiting: true,
    }), false);
    assert.equal(shouldCenterKothLobby({ browsing: false, waiting: false, canJoin: true }), true);
  });

  it('keeps the waiting HUD up for mid-match lag without centering it', () => {
    const lag = {
      role: 'player',
      activeCount: 3,
      browsing: false,
      stalled: true,
      waiting: true,
    };
    assert.equal(shouldShowKothWaitingHud(lag), true);
    assert.equal(shouldCenterKothLobby(lag), false);
    assert.equal(shouldShowKothWaitingHud({ role: 'player', activeCount: 3, browsing: false }), false);
    assert.equal(shouldShowKothWaitingHud({ waiting: true, browsing: false }), true);
  });

  it('labels seated players and spectators', () => {
    assert.equal(formatLobbyPlayerLine({ name: 'Blind', you: true }), 'Blind (you)');
    assert.equal(formatLobbyPlayerLine({ name: 'Aria' }), 'Aria');
    assert.equal(formatLobbyPlayerLine({ playerId: 1 }), 'Player 2');
    assert.equal(formatLobbyPlayerLine({ name: 'Sam', spectator: true }), 'Sam (watching)');
    assert.equal(formatLobbyPlayerLine({ name: 'Sam', you: true, spectator: true }), 'Sam (you, watching)');
    assert.equal(formatLobbyPlayerLine({ name: 'Aria', lagging: true }), 'Aria (lagging)');
  });

  it('lists spectators after seated players', () => {
    const people = lobbyPeople({
      players: [{ name: 'Blind', you: true }],
      spectators: [{ name: 'Sam', spectator: true }],
    });
    assert.deepEqual(people.map((p) => p.name), ['Blind', 'Sam']);
  });

  it('signatures change when occupancy or lobby name changes', () => {
    const a = { matchId: 'm1', activeCount: 1, tick: 0, lobbyName: 'Quiet Hill' };
    const b = { ...a, activeCount: 2 };
    assert.notEqual(lobbyRowSignature(a), lobbyRowSignature(b));
    const c = { ...a, lobbyName: 'Amber Agora' };
    assert.notEqual(lobbyRowSignature(a), lobbyRowSignature(c));
  });
});
