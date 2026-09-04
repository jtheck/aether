import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLobbyName, resolveLobbyName } from './lobbyName.js';

describe('koth lobby names', () => {
  it('is stable for a match id', () => {
    const a = generateLobbyName('koth-abc-12345678');
    const b = generateLobbyName('koth-abc-12345678');
    assert.match(a, /^\S+ \S+$/);
    assert.equal(a, b);
  });

  it('differs across distinct match ids', () => {
    const a = generateLobbyName('koth-abc-12345678');
    const b = generateLobbyName('koth-zzz-deadbeef');
    assert.notEqual(a, b);
  });

  it('prefers an announced lobby name', () => {
    assert.equal(
      resolveLobbyName({ lobbyName: 'Quiet Hill', matchId: 'koth-abc-12345678' }),
      'Quiet Hill',
    );
    assert.equal(
      resolveLobbyName({ lobbyName: '  ', matchId: 'koth-abc-12345678' }),
      generateLobbyName('koth-abc-12345678'),
    );
  });
});
