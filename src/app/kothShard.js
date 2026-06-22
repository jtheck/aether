// King of the Hill shard — multi-peer P2P orchestration.
//
// GetFire lobby = signaling + auto WebRTC mesh.
// Broadcast channel = shard presence (matchId, phase, tick).
// Convene peer (lowest userId) sends match_reset / join_accept — not authoritative sim.

import { p2pDevModeFromLocation } from './net.js';
import { replayCatchUp } from './catchup.js';
import { CMD } from '../sim/commands.js';
import {
  LOBBY,
  BROADCAST,
  MSG,
  SHARD_PHASE,
  SHARD_ANNOUNCE_MS,
  LAG_TIMEOUT_MS,
  negotiateConvene,
  activePlayerIds,
  slotForUser,
  shortId,
  cloneSlots,
} from '../koth/protocol.js';
import {
  generateMatchId,
  loadSavedMatch,
  saveMatch,
  touchSavedMatch,
  clearSavedMatch,
} from '../koth/matchId.js';
import {
  createEmptyRoster,
  rosterFromPeers,
  countActive,
  claimOpenSlot,
  releaseUser,
  reserveSlot,
} from '../koth/roster.js';

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

/**
 * @param {{
 *   onStatus?: (msg: string) => void,
 *   onShardChange?: (shard: object) => void,
 *   onLiveStart?: (config: object) => void,
 * }} [options]
 */
export function createKothShard(options = {}) {
  const onStatus = options.onStatus ?? (() => {});
  const onShardChange = options.onShardChange ?? (() => {});
  const onLiveStart = options.onLiveStart ?? (() => {});

  if (typeof globalThis.GETFIREP2P !== 'function') {
    throw new Error('GETFIREP2P not loaded');
  }

  let p2p = null;
  let localUserId = null;
  let session = null;

  let matchId = loadSavedMatch()?.matchId ?? generateMatchId();
  let phase = SHARD_PHASE.SANDBOX;
  let roster = createEmptyRoster();
  roster[0] = { userId: null, state: 'active', playerId: 0 };
  let seed = 0x1234;
  let conveneId = null;
  let localPlayerId = 0;
  let role = 'player';
  let catchUpReady = true;
  let matchStartSlots = [0];
  let matchHumanPlayers = [0];
  /** @type {Map<string, string>} peerId -> userId */
  const peerUserIds = new Map();
  /** @type {Map<number, number>} playerId -> last confirm timestamp */
  const playerLastConfirm = new Map();
  /** spectator userId -> sponsor userId (relay tree) */
  const spectatorSponsors = new Map();
  let lagTimer = null;
  let bootResolve = null;
  const bootPromise = new Promise((r) => {
    bootResolve = r;
  });

  function liveConfig(reset = false) {
    return {
      mode: 'koth',
      seed,
      localPlayerId,
      humanPlayers: activePlayerIds(roster),
      role: 'player',
      matchId,
      phase,
      activeSlots: activePlayerIds(roster),
      reset,
    };
  }

  function notifyLiveStart(reset = false) {
    onLiveStart(liveConfig(reset));
  }


  let announceTimer = null;
  let presencePeers = new Map();

  function emitShard() {
    onShardChange({
      matchId,
      phase,
      roster: cloneSlots(roster),
      seed,
      conveneId,
      localPlayerId,
      role,
      localUserId,
    });
  }

  function broadcastPresence(extra = {}) {
    if (!p2p?.broadcast) return;
    touchSavedMatch();
    p2p.broadcast(
      {
        type: MSG.SHARD_PRESENCE,
        matchId,
        phase,
        activeCount: countActive(roster),
        tick: session?.confirmedTick ?? 0,
        conveneId: conveneId ?? localUserId,
        from: localUserId,
        ...extra,
      },
      BROADCAST,
    );
  }

  function sendAll(msg) {
    p2p?.sendData?.(msg);
  }

  function sendPeer(peerId, msg) {
    p2p?.sendData?.(msg, peerId);
  }

  function connectedPeerIds() {
    return p2p?.getConnectedPeers?.() ?? [];
  }

  function allKnownUserIds() {
    const ids = new Set([localUserId]);
    for (const id of connectedPeerIds()) ids.add(id);
    for (const id of presencePeers.keys()) ids.add(id);
    return [...ids].filter(Boolean);
  }

  function recomputeConvene() {
    conveneId = negotiateConvene(allKnownUserIds());
    emitShard();
  }

  function isConvene() {
    return localUserId && conveneId === localUserId;
  }

  function setPhase(next) {
    phase = next;
    emitShard();
    broadcastPresence();
  }

  function setRole(next) {
    role = next;
    session?.setRole(next);
    emitShard();
  }

  function matchConfig() {
    return {
      seed,
      mode: 'koth',
      activeSlots: matchStartSlots,
      humanPlayers: [...matchHumanPlayers],
    };
  }

  function pickSponsorPeerId() {
    const peers = connectedPeerIds();
    if (!peers.length) return null;
    const sponsors = [];
    for (const pid of peers) {
      const uid = peerUserIds.get(pid) ?? pid;
      const slot = slotForUser(roster, uid);
      if (slot?.state === 'active') sponsors.push(pid);
    }
    if (!sponsors.length) return peers[0];
    let h = 0;
    for (let i = 0; i < localUserId.length; i++) h = (h * 31 + localUserId.charCodeAt(i)) | 0;
    return sponsors[Math.abs(h) % sponsors.length];
  }

  function notePlayerConfirm(playerId) {
    playerLastConfirm.set(playerId, performance.now());
  }

  function checkLagTimeouts() {
    if (phase !== SHARD_PHASE.LIVE || !session || !isConvene()) return;
    const now = performance.now();
    for (const pid of matchHumanPlayers) {
      if (pid === localPlayerId) continue;
      const last = playerLastConfirm.get(pid) ?? now;
      if (now - last < LAG_TIMEOUT_MS) continue;
      const slot = roster[pid];
      if (!slot?.userId || slot.state !== 'active') continue;
      onStatus(`Player ${pid} lagged out`);
      forceDefeatPlayer(pid, slot.userId);
    }
  }

  function forceDefeatPlayer(playerId, userId) {
    const tick = (session?.confirmedTick ?? 0) + 2;
    roster = releaseUser(roster, userId, true);
    sendAll({ type: MSG.SLOT_DEFEAT, matchId, playerId, userId, tick });
    applySlotDefeat(playerId, tick);
    checkShardEmpty();
  }

  function applySlotDefeat(playerId, tick) {
    if (isConvene()) {
      const frame = session?.submitAtTick(tick, { type: CMD.FORCE_ELIMINATE, playerId });
      if (frame) sendAll({ type: MSG.COMMAND_FRAME, frame });
    }
    if (playerId === localPlayerId) {
      setRole('spectator');
      catchUpReady = true;
      onStatus('Eliminated — spectating (J to rejoin)');
    }
  }

  function checkShardEmpty() {
    if (phase !== SHARD_PHASE.LIVE) return;
    if (countActive(roster) > 0) return;
    if (isConvene()) windDownShard();
  }

  function windDownShard() {
    sendAll({ type: MSG.SHARD_GONE, matchId });
    broadcastPresence({ gone: true });
    clearSavedMatch();
    matchId = generateMatchId();
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    localPlayerId = 0;
    role = 'player';
    catchUpReady = true;
    saveMatch({ matchId, userId: localUserId, slot: 0 });
    setPhase(SHARD_PHASE.SANDBOX);
    onStatus(`New sandbox — …${shortId(matchId)}`);
    onLiveStart({
      mode: 'sandbox',
      seed: hashSeed(matchId),
      localPlayerId: 0,
      humanPlayers: [0],
      role: 'player',
      matchId,
      phase: SHARD_PHASE.SANDBOX,
      activeSlots: [0],
      reset: true,
    });
  }

  function commitJoinAtTick(msg) {
    if (!matchHumanPlayers.includes(msg.playerId)) {
      matchHumanPlayers = [...matchHumanPlayers, msg.playerId].sort((a, b) => a - b);
    }
    session?.scheduleJoin(msg.joinTick, msg.playerId);
    if (isConvene()) {
      const frame = session?.submitAtTick(msg.joinTick, {
        type: CMD.SPAWN_SLOT,
        playerId: msg.playerId,
      });
      if (frame) sendAll({ type: MSG.COMMAND_FRAME, frame });
    }
  }

  function maybeStartLive() {
    const peers = connectedPeerIds();
    const total = peers.length + 1;
    if (phase !== SHARD_PHASE.SANDBOX || total < 2) return;

    const ids = allKnownUserIds();
    roster = rosterFromPeers(ids);
    recomputeConvene();
    seed = hashSeed(matchId);
    localPlayerId = slotForUser(roster, localUserId)?.playerId ?? 0;

    if (!isConvene()) {
      onStatus('Waiting for match start…');
      return;
    }

    setPhase(SHARD_PHASE.LIVE);
    role = 'player';
    matchStartSlots = activePlayerIds(roster);
    matchHumanPlayers = [...matchStartSlots];
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);

    sendAll({
      type: MSG.MATCH_RESET,
      matchId,
      seed,
      roster: cloneSlots(roster),
      joinTick: 0,
    });

    onStatus(`Match live — ${total} players — id …${shortId(matchId)}`);
    notifyLiveStart(true);
  }

  function handleMatchReset(msg) {
    if (msg.matchId !== matchId) return;
    roster = cloneSlots(msg.roster ?? roster);
    seed = msg.seed ?? seed;
    matchStartSlots = activePlayerIds(roster);
    matchHumanPlayers = [...matchStartSlots];
    localPlayerId = slotForUser(roster, localUserId)?.playerId ?? localPlayerId;
    setPhase(SHARD_PHASE.LIVE);
    role = 'player';
    catchUpReady = true;
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    onStatus(`Synced — player ${localPlayerId}`);
    notifyLiveStart(true);
  }

  function handleJoinIntent(msg) {
    if (phase !== SHARD_PHASE.LIVE || !session || !catchUpReady) return;
    if (msg.userId !== localUserId && !isConvene()) return;
    if (!isConvene()) return;
    if (!msg.caughtUp) return;

    const joinTick = (session.confirmedTick ?? 0) + 3;
    sendAll({
      type: MSG.JOIN_PREPARE,
      matchId,
      userId: msg.userId,
      joinTick,
      slot: msg.slot ?? -1,
    });
  }

  function handleJoinPrepare(msg) {
    if (msg.matchId !== matchId || msg.userId !== localUserId) return;
    const { slots, playerId } = claimOpenSlot(roster, localUserId);
    if (playerId < 0) {
      setRole('spectator');
      return;
    }
    roster = slots;
    localPlayerId = playerId;
    role = 'player';
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    const accept = {
      type: MSG.JOIN_ACCEPT,
      matchId,
      userId: localUserId,
      playerId,
      joinTick: msg.joinTick,
    };
    sendAll(accept);
    commitJoinAtTick(accept);
    session?.setRole('player');
    emitShard();
  }

  function handleJoinAccept(msg) {
    if (msg.matchId !== matchId) return;
    const { slots } = claimOpenSlot(roster, msg.userId);
    roster = slots;
    commitJoinAtTick(msg);
    if (msg.userId === localUserId) {
      localPlayerId = msg.playerId;
      role = 'player';
      catchUpReady = true;
      session?.setRole('player');
      saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    }
    emitShard();
    broadcastPresence();
  }

  async function handleSnapshotRequest(msg, fromPeerId) {
    if (!session) return;
    if (role === 'spectator' && !msg.relay) {
      const sponsor = pickSponsorPeerId();
      if (sponsor && sponsor !== fromPeerId) {
        sendPeer(sponsor, { ...msg, from: localUserId });
      }
      return;
    }
    const tick = msg.tick ?? session.confirmedTick;
    const ledger = msg.fullReplay
      ? session.exportFullLedger()
      : session.exportLedger(msg.fromTick ?? 0, tick);
    sendPeer(fromPeerId, {
      type: MSG.SNAPSHOT_OFFER,
      matchId,
      tick,
      checksum: session._lastChecksum,
      ledger,
      matchConfig: matchConfig(),
    });
  }

  async function handleSnapshotOffer(msg) {
    if (!session || !msg.matchConfig) return;
    catchUpReady = false;
    onStatus('Replaying catch-up…');
    try {
      await replayCatchUp(
        session,
        msg.matchConfig,
        msg.ledger ?? [],
        msg.tick,
        msg.checksum,
      );
      catchUpReady = true;
      setRole('spectator');
      onStatus('Caught up — J to join');
      sendAll({ type: MSG.CATCHUP_READY, matchId, userId: localUserId, tick: msg.tick });
    } catch (err) {
      console.warn('[KOTH] catch-up failed', err);
      catchUpReady = false;
      onStatus('Catch-up failed — retrying…');
      beginCatchup(pickSponsorPeerId(), msg.tick ?? 0);
    }
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
      case MSG.SHARD_HELLO:
        if (msg.matchId && msg.matchId !== matchId) return;
        if (msg.from) peerUserIds.set(fromPeerId, msg.from);
        presencePeers.set(msg.from ?? fromPeerId, msg.from ?? fromPeerId);
        recomputeConvene();
        sendPeer(fromPeerId, {
          type: MSG.SHARD_STATE,
          matchId,
          phase,
          roster: cloneSlots(roster),
          seed,
          conveneId,
          tick: session?.confirmedTick ?? 0,
          matchStartSlots,
          matchHumanPlayers,
        });
        if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
        else if (phase === SHARD_PHASE.LIVE && role !== 'player') {
          setRole('spectator');
          beginCatchup(pickSponsorPeerId(), session?.confirmedTick ?? 0);
        }
        break;

      case MSG.SHARD_STATE:
        if (msg.matchId !== matchId) return;
        if (msg.matchStartSlots) matchStartSlots = msg.matchStartSlots;
        if (msg.matchHumanPlayers) matchHumanPlayers = msg.matchHumanPlayers;
        if (msg.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX) {
          roster = cloneSlots(msg.roster ?? roster);
          seed = msg.seed ?? seed;
          conveneId = msg.conveneId ?? conveneId;
          setPhase(SHARD_PHASE.LIVE);
          localPlayerId = slotForUser(roster, localUserId)?.playerId ?? -1;
          if (localPlayerId < 0) {
            setRole('spectator');
            beginCatchup(fromPeerId, msg.tick ?? 0);
          } else {
            role = 'player';
            saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
            notifyLiveStart(true);
          }
        }
        break;

      case MSG.MATCH_RESET:
        handleMatchReset(msg);
        break;

      case MSG.COMMAND_FRAME:
        session?.bufferRemoteFrame(msg.frame);
        break;

      case MSG.TICK_CONFIRM:
        if (msg.playerId !== undefined && msg.tick !== undefined) {
          session?.setPeerConfirmedTick(msg.playerId, msg.tick);
          notePlayerConfirm(msg.playerId);
        }
        break;

      case MSG.REQUEST_TICK_CONFIRM:
        if (session) sendTickConfirm(session.confirmedTick + 1);
        break;

      case MSG.SNAPSHOT_REQUEST:
        handleSnapshotRequest(msg, fromPeerId);
        break;

      case MSG.SNAPSHOT_OFFER:
        handleSnapshotOffer(msg);
        break;

      case MSG.JOIN_INTENT:
        handleJoinIntent(msg, fromPeerId);
        break;

      case MSG.JOIN_PREPARE:
        handleJoinPrepare(msg);
        break;

      case MSG.JOIN_ACCEPT:
        handleJoinAccept(msg);
        break;

      case MSG.ROSTER_UPDATE:
        if (msg.matchId === matchId && msg.roster) {
          roster = cloneSlots(msg.roster);
          emitShard();
        }
        break;

      case MSG.SLOT_DEFEAT:
        if (msg.matchId !== matchId) return;
        roster = releaseUser(roster, msg.userId, true);
        applySlotDefeat(msg.playerId, msg.tick);
        emitShard();
        break;

      case MSG.SHARD_GONE:
        if (msg.matchId !== matchId) return;
        if (phase === SHARD_PHASE.LIVE) windDownShard();
        break;

      case MSG.CATCHUP_READY:
        break;

      default:
        break;
    }
  }

  function beginCatchup(peerId, tick = 0) {
    if (!session || !peerId) return;
    catchUpReady = false;
    const target = tick || session.confirmedTick || 0;
    sendPeer(peerId, {
      type: MSG.SNAPSHOT_REQUEST,
      matchId,
      tick: target,
      fromTick: 0,
      fullReplay: true,
    });
    onStatus('Catching up…');
  }

  function sendTickConfirm(tick) {
    if (!session || role !== 'player') return;
    sendAll({ type: MSG.TICK_CONFIRM, tick, playerId: session.localPlayerId });
  }

  function onPeerConnected(peerId) {
    console.log('[KOTH] peer connected', shortId(peerId));
    recomputeConvene();
    sendPeer(peerId, {
      type: MSG.SHARD_HELLO,
      matchId,
      from: localUserId,
      phase,
    });

    const saved = loadSavedMatch();
    if (saved?.matchId === matchId && saved.slot != null && phase === SHARD_PHASE.LIVE) {
      const slot = roster[saved.slot];
      if (slot && slot.userId === localUserId) {
        roster = reserveSlot(roster, saved.slot, localUserId);
        localPlayerId = saved.slot;
        role = 'player';
        onStatus(`Rejoining slot ${localPlayerId}…`);
      }
    }

    if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
  }

  function onPeerDisconnected(peerId) {
    const uid = peerUserIds.get(peerId);
    peerUserIds.delete(peerId);
    presencePeers.delete(peerId);
    recomputeConvene();
    if (phase === SHARD_PHASE.LIVE && uid) {
      roster = releaseUser(roster, uid, true);
      emitShard();
      checkShardEmpty();
    }
  }

  function onBroadcastMessage(data) {
    if (data?.type !== MSG.SHARD_PRESENCE) return;
    if (data.matchId !== matchId) return;
    if (data.from === localUserId) return;
    presencePeers.set(data.from, data.from);
    if (data.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX) {
      onStatus(`Live match found — connecting…`);
    }
  }

  function onGameLobbyMessage(data) {
    if (!data?.type) return;
    if (data.type === 'player_join' || data.type === 'player_rejoin') {
      if (data.from === localUserId) {
        onStatus(`KOTH lobby — match …${shortId(matchId)}`);
        broadcastPresence();
        return;
      }
    }
  }

  // --- boot ---

  onStatus('Joining King of the Hill…');
  saveMatch({ matchId, userId: null });

  p2p = globalThis.GETFIREP2P({
    roomType: 'aether-koth',
    devMode: p2pDevModeFromLocation(),
    onGameLobbyMessage,
    onDataChannelMessage: onDataMessage,
    onPeerConnected,
    onPeerDisconnected,
    onBroadcastMessage,
  });

  (async () => {
    const ok = await waitForP2pConsumer(p2p);
    if (!ok) throw new Error('GetFire signaling failed');
    localUserId = p2p.getUserId?.() ?? null;
    roster[0].userId = localUserId;
    saveMatch({ matchId, userId: localUserId });
    recomputeConvene();

    p2p.joinBroadcast?.(BROADCAST);
    p2p.joinMatchLobby?.(LOBBY);

    setPhase(SHARD_PHASE.SANDBOX);
    onStatus(`Sandbox — match …${shortId(matchId)} — waiting for challengers`);

    bootResolve?.({
      mode: 'sandbox',
      seed,
      localPlayerId: 0,
      humanPlayers: [0],
      role: 'player',
      matchId,
      phase,
      activeSlots: [0],
    });
    bootResolve = null;

    announceTimer = setInterval(() => broadcastPresence(), SHARD_ANNOUNCE_MS);
    lagTimer = setInterval(() => checkLagTimeouts(), 5000);
    broadcastPresence();
  })();

  return {
    waitForBoot: () => bootPromise,
    getShard: () => ({
      matchId,
      phase,
      roster: cloneSlots(roster),
      seed,
      localPlayerId,
      role,
      conveneId,
    }),

    attachSession(simSession) {
      session = simSession;

      const prevSubmit = session.submitCommand.bind(session);
      session.submitCommand = (command) => {
        if (role !== 'player') return null;
        const frame = prevSubmit(command);
        if (frame) sendAll({ type: MSG.COMMAND_FRAME, frame });
        return frame;
      };

      const prevCommit = session.onCommit;
      session.onCommit = (tick, checksum) => {
        sendTickConfirm(tick + 1);
        prevCommit?.(tick, checksum);
        if (phase === SHARD_PHASE.LIVE) broadcastPresence({ tick });
      };

      sendTickConfirm(1);
    },

    requestJoin() {
      if (role === 'player') return;
      if (!catchUpReady) {
        onStatus('Still catching up…');
        return;
      }
      sendAll({
        type: MSG.JOIN_INTENT,
        matchId,
        userId: localUserId,
        slot: -1,
        caughtUp: true,
      });
      onStatus('Requesting slot…');
    },

    isSpectator() {
      return role === 'spectator';
    },

    canJoin() {
      return catchUpReady && role === 'spectator';
    },

    releaseSlot(spectate = true) {
      roster = releaseUser(roster, localUserId, spectate);
      if (spectate) setRole('spectator');
      sendAll({ type: MSG.ROSTER_UPDATE, matchId, roster: cloneSlots(roster) });
      broadcastPresence();
    },

    disconnect() {
      if (announceTimer) clearInterval(announceTimer);
      if (lagTimer) clearInterval(lagTimer);
      p2p?.disconnect?.();
    },
  };
}

function hashSeed(matchId) {
  let h = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++) {
    h ^= matchId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** KOTH on by default; ?solo=1 or ?stress=N disables. */
export function kothModeFromSearch(search = '') {
  const params = new URLSearchParams(search);
  if (params.has('solo')) return false;
  if (params.get('stress')) return false;
  if (params.has('koth') && params.get('koth') === '0') return false;
  return true;
}
