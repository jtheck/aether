import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGameLobby } from './gameLobby.js';
import { MODE_IDS } from '../lobby/modes.js';
import { typeChannel } from '../lobby/protocol.js';

function fakeP2p() {
  const joined = new Set();
  return {
    getUserId: () => 'me',
    joinBroadcast: (channel) => { joined.add(channel); },
    leaveBroadcast: (channel) => { joined.delete(channel); },
    joined,
  };
}

describe('game lobby auto listen', () => {
  it('keeps type channels after a drawer unlisten while auto-listen is on', () => {
    const p2p = fakeP2p();
    const lobby = createGameLobby({ getP2p: () => p2p });
    lobby.setAutoListen(true);
    for (const mode of MODE_IDS) {
      assert.equal(p2p.joined.has(typeChannel(mode)), true);
      assert.equal(lobby.isListening(mode), true);
    }
    lobby.listen('teams');
    lobby.unlisten('teams');
    assert.equal(p2p.joined.has(typeChannel('teams')), true);
    lobby.setAutoListen(false);
    assert.equal(p2p.joined.has(typeChannel('teams')), false);
  });

  it('leaves a drawer channel when auto-listen is off', () => {
    const p2p = fakeP2p();
    const lobby = createGameLobby({ getP2p: () => p2p });
    lobby.listen('onevsone');
    assert.equal(p2p.joined.has(typeChannel('onevsone')), true);
    lobby.unlisten('onevsone');
    assert.equal(p2p.joined.has(typeChannel('onevsone')), false);
  });
});
