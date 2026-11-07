import { it } from 'node:test';
import assert from 'node:assert/strict';

it('waits for the reliable channel and keeps a peer that recovers during grace', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    ActionCable: globalThis.ActionCable,
    RTCPeerConnection: globalThis.RTCPeerConnection,
  };
  const channels = [];
  const peerConnections = [];
  const dataChannels = [];

  class FakePeerConnection {
    constructor(config) {
      this.config = config;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.closed = false;
      peerConnections.push(this);
    }

    createDataChannel() {
      const channel = {
        readyState: 'connecting',
        sent: [],
        send(message) { this.sent.push(message); },
        close() { this.readyState = 'closed'; },
      };
      dataChannels.push(channel);
      return channel;
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
    let p2p;
    p2p = globalThis.window.GETFIREP2P({
      roomType: 'test',
      onPeerConnected: (peerId) => {
        connected.push(peerId);
        p2p.sendData({ type: 'lobby_hello' }, peerId);
      },
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
    const dataChannel = dataChannels[0];
    connection.iceConnectionState = 'connected';
    connection.oniceconnectionstatechange();
    connection.connectionState = 'connected';
    connection.onconnectionstatechange();

    assert.deepEqual(connected, []);
    assert.deepEqual(p2p.getConnectedPeers(), []);
    assert.deepEqual(dataChannel.sent, []);

    dataChannel.readyState = 'open';
    dataChannel.onopen();

    assert.deepEqual(connected, ['peer-a']);
    assert.deepEqual(p2p.getConnectedPeers(), ['peer-a']);
    assert.equal(JSON.parse(dataChannel.sent[0]).content.type, 'lobby_hello');

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
    assert.equal(
      dataChannel.sent.map((message) => JSON.parse(message)).filter((message) => message.type === 'game_data').length,
      2,
    );
    p2p.disconnect();
  } finally {
    globalThis.window = prior.window;
    globalThis.document = prior.document;
    globalThis.ActionCable = prior.ActionCable;
    globalThis.RTCPeerConnection = prior.RTCPeerConnection;
  }
});
