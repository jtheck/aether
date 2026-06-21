// P2P lockstep transport — GetFire match lobby + command/tick_confirm relay.
// Sim rules live in simSession.js; this file only moves frames between peers.

import { stressPerSideFromSearch } from '../sim/worldSetup.js';

const LOBBY = 'aether-v2-dev';
const MATCH_TIMEOUT_MS = 120_000;

/** devMode on for http/localhost dev — signaling still uses wss://getfire.net. */
export function p2pDevModeFromLocation(loc = globalThis.location) {
  const params = new URLSearchParams(loc.search);
  if (params.get('dev') === '0') return false;
  if (params.has('dev')) return true;
  const h = loc.hostname;
  return loc.protocol === 'http:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

async function waitForP2pConsumer(p2p, timeoutMs = 8000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    p2p.ensureConnected?.();
    if (p2p.consumer?.subscriptions) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function unwrapMessage(data) {
  const msg = typeof data === 'string' ? JSON.parse(data) : data;
  if (msg?.type === 'game_data' && msg.content) return msg.content;
  return msg;
}

function sendReliable(p2p, message, peerId = null) {
  if (!p2p?.sendData) return;
  if (peerId) p2p.sendData(message, peerId);
  else p2p.sendData(message);
}

/**
 * Auto-match two tabs via GetFire P2P, then bridge SimSession lockstep.
 * @param {{ lobby?: string, seed?: number, onStatus?: (msg: string) => void }} [options]
 */
export function createNetMatch(options = {}) {
  const lobby = options.lobby ?? LOBBY;
  const defaultSeed = options.seed ?? 0x1234;
  const onStatus = options.onStatus ?? (() => {});

  if (typeof globalThis.GETFIREP2P !== 'function') {
    throw new Error('GETFIREP2P not loaded — include vendor/getfire-p2p.js in index.html');
  }

  let p2p = null;
  let peerId = null;
  let localUserId = null;
  let localPlayerId = 0;
  let isHost = false;
  let session = null;
  let matchResolve = null;
  let matchReject = null;
  let matchDone = false;
  let lastConfirmTick = -1;
  let rejoinTimer = null;

  const shortId = (id) => (id ? id.slice(-8) : '?');

  const matchPromise = new Promise((resolve, reject) => {
    matchResolve = resolve;
    matchReject = reject;
  });

  const matchTimeout = setTimeout(() => {
    if (!matchDone) matchReject(new Error('Match timeout — open a second tab or use ?solo=1'));
  }, MATCH_TIMEOUT_MS);

  function finishMatch(config) {
    if (matchDone) return;
    matchDone = true;
    clearTimeout(matchTimeout);
    if (rejoinTimer) clearInterval(rejoinTimer);
    console.log('[Aether net] match ready — player', config.localPlayerId, config.isHost ? '(host)' : '(guest)');
    matchResolve(config);
  }

  /** v1-style fallback when built-in auto-match misses a join event. */
  function tryMatchWithPeer(theirId) {
    if (matchDone || !p2p || !theirId || theirId === localUserId) return;
    const connected = p2p.getConnectedPeers?.() ?? [];
    if (connected.includes(theirId)) return;

    const myId = localUserId;
    if (myId > theirId) {
      console.log('[Aether net] requestMatch →', shortId(theirId));
      p2p.requestMatch(theirId);
      return;
    }
    // Lower id waits, then forces request if peer never initiates.
    setTimeout(() => {
      const now = p2p.getConnectedPeers?.() ?? [];
      if (!now.includes(theirId) && !matchDone) {
        console.log('[Aether net] fallback requestMatch →', shortId(theirId));
        p2p.requestMatch(theirId);
      }
    }, 3000);
  }

  function onGameLobbyMessage(data) {
    if (!data?.type) return;
    if (data.type === 'player_join' || data.type === 'player_rejoin') {
      if (data.from === localUserId) {
        onStatus(`In lobby — id …${shortId(localUserId)} — open 2nd tab`);
        return;
      }
      console.log('[Aether net] lobby:', data.type, shortId(data.from));
      onStatus(`Found peer …${shortId(data.from)} — connecting…`);
      setTimeout(() => tryMatchWithPeer(data.from), 300);
    }
  }

  function sendTickConfirm(tick) {
    if (!session || !p2p || !peerId) return;
    if (tick <= lastConfirmTick) return;
    lastConfirmTick = tick;
    sendReliable(p2p, { type: 'tick_confirm', tick, playerId: session.localPlayerId }, peerId);
  }

  function onDataMessage(data, fromPeerId) {
    let msg;
    try {
      msg = unwrapMessage(data);
    } catch {
      return;
    }
    if (!msg?.type) return;

    switch (msg.type) {
      case 'match_start':
        if (matchDone) return;
        if (!localUserId) localUserId = p2p.getUserId?.() ?? null;
        localPlayerId = msg.hostUserId === localUserId ? 0 : 1;
        isHost = localPlayerId === 0;
        finishMatch({ localPlayerId, seed: msg.seed, peerId: fromPeerId, isHost });
        break;

      case 'command_frame':
        session?.bufferRemoteFrame(msg.frame);
        break;

      case 'tick_confirm':
        if (msg.playerId !== undefined && msg.tick !== undefined) {
          session?.setPeerConfirmedTick(msg.playerId, msg.tick);
        }
        break;

      case 'request_tick_confirm':
        if (session) sendTickConfirm(session.confirmedTick + 1);
        break;

      case 'ping':
      case 'pong':
        break;

      default:
        break;
    }
  }

  function onPeerConnected(id) {
    peerId = id;
    console.log('[Aether net] WebRTC connected →', shortId(id));
    onStatus(`P2P linked …${shortId(id)} — starting…`);

    if (!localUserId) localUserId = p2p.getUserId();
    isHost = localUserId < id;
    localPlayerId = isHost ? 0 : 1;
    const seed = defaultSeed;

    if (isHost) {
      const startMsg = {
        type: 'match_start',
        seed,
        hostUserId: localUserId,
        guestUserId: id,
      };
      sendReliable(p2p, startMsg, id);
      // Data channel may not be open on guest yet — retry a few times.
      for (const delay of [250, 750, 1500]) {
        setTimeout(() => {
          if (!matchDone) sendReliable(p2p, startMsg, id);
        }, delay);
      }
    }

    // Both sides start here — don't wait for match_start (guest channel race).
    finishMatch({ localPlayerId, seed, peerId: id, isHost });
  }

  function onPeerDisconnected() {
    peerId = null;
    onStatus('Peer disconnected');
  }

  onStatus('Joining match lobby…');

  p2p = globalThis.GETFIREP2P({
    roomType: 'aether-v2',
    devMode: p2pDevModeFromLocation(),
    onGameLobbyMessage,
    onDataChannelMessage: onDataMessage,
    onPeerConnected,
    onPeerDisconnected,
  });

  (async () => {
    const ok = await waitForP2pConsumer(p2p);
    if (!ok) {
      matchReject(
        new Error('GetFire P2P signaling failed (hard refresh, or ?solo=1). Need devMode on http localhost.'),
      );
      return;
    }
    localUserId = p2p.getUserId?.() ?? null;
    console.log('[Aether net] joining lobby', lobby, 'as', shortId(localUserId));
    p2p.joinMatchLobby?.(lobby);
    onStatus(`Matching in ${lobby}… (open another tab)`);

    rejoinTimer = setInterval(() => {
      if (matchDone) return;
      const peers = p2p.getConnectedPeers?.() ?? [];
      if (peers.length > 0) return;
      p2p.announcePresence?.();
    }, 6000);
  })();

  return {
    waitForMatch: () => matchPromise,

    attachSession(simSession) {
      session = simSession;

      const prevSubmit = session.submitCommand.bind(session);
      session.submitCommand = (command) => {
        const frame = prevSubmit(command);
        if (frame && peerId) {
          sendReliable(p2p, { type: 'command_frame', frame }, peerId);
        }
        return frame;
      };

      const prevCommit = session.onCommit;
      session.onCommit = (tick, checksum) => {
        sendTickConfirm(tick + 1);
        prevCommit?.(tick, checksum);
      };

      sendTickConfirm(1);
    },

    disconnect() {
      p2p?.disconnect?.();
    },
  };
}

/** Net on by default; ?solo=1 or ?stress=N disables. */
export function netModeFromSearch(search = '') {
  const params = new URLSearchParams(search);
  if (params.has('solo')) return false;
  if (stressPerSideFromSearch(search) > 0) return false;
  if (params.has('net') && params.get('net') === '0') return false;
  return true;
}
