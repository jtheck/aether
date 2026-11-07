import { it } from 'node:test';
import assert from 'node:assert/strict';

it('keeps a peer whose transient disconnected state recovers during grace', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    ActionCable: globalThis.ActionCable,
    RTCPeerConnection: globalThis.RTCPeerConnection,
  };
  const channels = [];
  const peerConnections = [];

  class FakePeerConnection {
    constructor(config) {
      this.config = config;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.closed = false;
      peerConnections.push(this);
    }

    createDataChannel() {
      return {
        readyState: 'connecting',
        send() {},
        close() { this.readyState = 'closed'; },
      };
    }

    async createOffer() {
      return { type: 'offer', sdp: 'test' };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    async getStats() {
      return new Map();
    }

    close() {
      this.closed = true;
      this.connectionState = 'closed';
      this.onconnectionstatechange?.();
    }
  }

  globalThis.window = {};
  globalThis.document = { location: { protocol: 'https:' } };
  globalThis.RTCPeerConnection = FakePeerConnection;

  try {
    await import(`./getfire-p2p.js?recovery=${Date.now()}`);
    // The vendored file also bundles ActionCable after GETFIREP2P, so replace
    // that browser transport with the deterministic channel fake after import.
    globalThis.ActionCable = {
      createConsumer(url) {
        return {
          url,
          subscriptions: {
            create(params, callbacks) {
              const channel = {
                params,
                callbacks,
                performed: [],
                perform(action, payload) { this.performed.push({ action, payload }); },
                unsubscribe() {},
              };
              channels.push(channel);
              return channel;
            },
          },
        };
      },
    };
    const connected = [];
    const disconnected = [];
    const p2p = globalThis.window.GETFIREP2P({
      roomType: 'test',
      onPeerConnected: (peerId) => connected.push(peerId),
      onPeerDisconnected: (peerId) => disconnected.push(peerId),
    });
    p2p.joinMatchLobby('test-room');
    const lobby = channels[0];
    lobby.callbacks.connected.call(lobby);
    p2p.requestMatch('peer-a', 'test-room');
    lobby.callbacks.received.call(lobby, {
      type: 'match_accepted',
      from: 'peer-a',
      to: p2p.getUserId(),
      room_id: 'pair-room',
    });

    const connection = peerConnections[0];
    connection.connectionState = 'connected';
    connection.onconnectionstatechange();
    assert.deepEqual(p2p.getConnectedPeers(), ['peer-a']);

    connection.connectionState = 'disconnected';
    connection.onconnectionstatechange();
    assert.deepEqual(disconnected, ['peer-a']);
    assert.deepEqual(p2p.getConnectedPeers(), []);

    t.mock.timers.tick(3000);
    connection.connectionState = 'connected';
    connection.onconnectionstatechange();
    t.mock.timers.tick(3000);

    assert.equal(connection.closed, false);
    assert.deepEqual(connected, ['peer-a', 'peer-a']);
    assert.deepEqual(p2p.getConnectedPeers(), ['peer-a']);
    p2p.disconnect();
  } finally {
    globalThis.window = prior.window;
    globalThis.document = prior.document;
    globalThis.ActionCable = prior.ActionCable;
    globalThis.RTCPeerConnection = prior.RTCPeerConnection;
  }
});
