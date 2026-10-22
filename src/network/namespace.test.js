import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalNetworkEnvironment, networkChannel } from './namespace.js';
import { LOBBY as KOTH_CHANNEL } from '../koth/protocol.js';
import { MODES } from '../lobby/modes.js';

describe('multiplayer network namespace', () => {
  it('isolates local development from production channels', () => {
    const local = { protocol: 'http:', hostname: 'localhost' };
    const lan = { protocol: 'http:', hostname: '192.168.1.20' };
    const live = { protocol: 'https:', hostname: 'aether.garden' };

    assert.equal(isLocalNetworkEnvironment(local), true);
    assert.equal(isLocalNetworkEnvironment(lan), true);
    assert.equal(isLocalNetworkEnvironment(live), false);
    assert.equal(networkChannel('aether-koth', local), 'aether-koth-dev');
    assert.equal(networkChannel('aether-v2-1v1', lan), 'aether-v2-1v1-dev');
    assert.equal(networkChannel('aether-koth', live), 'aether-koth');
  });

  it('gives every game mode a distinct discovery channel', () => {
    const channels = [KOTH_CHANNEL, ...Object.values(MODES).map((mode) => mode.typeChannel)];
    assert.equal(new Set(channels).size, channels.length);
  });
});
