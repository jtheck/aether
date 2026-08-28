import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatInLobbyStatus, formatLobbyRow, lobbyRowSignature } from './kothLobby.js';

describe('koth lobby rows', () => {
  it('uses the host name when present', () => {
    const row = formatLobbyRow({
      matchId: 'koth-abc-12345678',
      hostName: 'Blind',
      activeCount: 2,
      seats: 5,
      tick: 0,
    });
    assert.equal(row.title, 'Blind');
    assert.equal(row.meta, '2/5  ·  0s');
    assert.match(row.label, /Join Blind/);
  });

  it('falls back to a short match id', () => {
    const row = formatLobbyRow({
      matchId: 'koth-zzzz-deadbeef',
      hostName: '  ',
      activeCount: 1,
      seats: 5,
      tick: 120,
    });
    assert.equal(row.title, '…deadbeef');
    assert.equal(row.meta, '1/5  ·  6s');
  });

  it('describes a hosted lobby versus a joined one', () => {
    const hosted = formatInLobbyStatus({
      hosting: true,
      hostName: 'Overseer',
      activeCount: 1,
      seats: 5,
      tick: 0,
    });
    assert.equal(hosted.title, 'Your lobby');
    assert.equal(hosted.meta, '1/5  ·  0s');
    const joined = formatInLobbyStatus({
      hosting: false,
      role: 'player',
      hostName: 'Overseer',
      activeCount: 2,
      seats: 5,
      tick: 40,
    });
    assert.equal(joined.title, "In Overseer's lobby");
    const spec = formatInLobbyStatus({
      hosting: false,
      role: 'spectator',
      hostName: 'Overseer',
      activeCount: 2,
      seats: 5,
      tick: 40,
    });
    assert.equal(spec.title, 'Spectating Overseer');
  });

  it('signatures change when occupancy or name changes', () => {
    const a = { matchId: 'm1', activeCount: 1, tick: 0, hostName: 'A' };
    const b = { ...a, activeCount: 2 };
    assert.notEqual(lobbyRowSignature(a), lobbyRowSignature(b));
  });
});
