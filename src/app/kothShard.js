// King of the Hill shard — multi-peer P2P orchestration.
//
// GetFire lobby = signaling + auto WebRTC mesh.
// Broadcast channel = shard presence (matchId, phase, tick).
// Sim-changing shard events are deterministic proposals, not host decisions.
//
// Hard KOTH invariants:
// - Page load creates a private sandbox and never claims a public live slot.
// - Public live state is entered by applying one complete MATCH_SNAPSHOT.
// - Mid-match sync uses catch-up replay, never tick-0 reset.
// - Roster changes after live start flow through JOIN_ACCEPT or SLOT_DEFEAT.
// - Commands and tick confirms must be owned by the userId for their playerId.

import { p2pDevModeFromLocation } from './net.js';
import { replayCatchUp } from './catchup.js';
import { CMD } from '../sim/commands.js';
import {
  LOBBY,
  BROADCAST,
  MSG,
  KOTH_APP_STATE,
  SHARD_PHASE,
  SHARD_ANNOUNCE_MS,
  activePlayerIds,
  ownsPlayerFrame,
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
  reserveOpenSlot,
  activateSlot,
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

const JOIN_DELAY_TICKS = 24;
const JOIN_ASSIGN_LEAD_TICKS = 12;
const KOTH_PROTOCOL_VERSION = 2;
const MIN_LIVE_PLAYERS = 2;
const MAX_ACTIVE_PLAYERS = 5;
const SEEN_MESSAGE_LIMIT = 2000;
const MATCHMAKING_LOBBY = `${LOBBY}:matchmaking`;

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
 *   onPresentationSync?: (config: object) => void,
 * }} [options]
 */
export function createKothShard(options = {}) {
  const onStatus = options.onStatus ?? (() => {});
  const onShardChange = options.onShardChange ?? (() => {});
  const onLiveStart = options.onLiveStart ?? (() => {});
  const onPresentationSync = options.onPresentationSync ?? (() => {});

  if (typeof globalThis.GETFIREP2P !== 'function') {
    throw new Error('GETFIREP2P not loaded');
  }

  let p2p = null;
  let localUserId = null;
  let session = null;

  let matchId = generateMatchId();
  let phase = SHARD_PHASE.SANDBOX;
  let roster = createEmptyRoster();
  roster[0] = { userId: null, state: 'active', playerId: 0 };
  let seed = 0x1234;
  let localPlayerId = 0;
  let appState = KOTH_APP_STATE.PRIVATE_SANDBOX;
  let role = 'player';
  let catchUpReady = true;
  let matchStartSlots = [0];
  let matchHumanPlayers = [0];
  /** @type {Map<string, string>} peerId -> userId */
  const peerUserIds = new Map();
  /** @type {Set<string>} peerIds that exchanged this KOTH protocol version */
  const readyPeerIds = new Set();
  /** @type {Map<number, number>} playerId -> last confirm timestamp */
  const playerLastConfirm = new Map();
  /** @type {Set<string>} */
  const seenMessageIds = new Set();
  /** @type {string[]} */
  const seenMessageOrder = [];
  /** @type {Map<string, object>} userId -> join intent */
  const joinIntents = new Map();
  /** @type {Map<number, object[]>} tick -> accepted joins that become active after spawn */
  const pendingAcceptedJoins = new Map();
  let pendingLocalJoin = null;
  let activeCatchupRequestId = '';
  let catchupRetryTimer = null;
  let catchupRetryAttempt = 0;
  const pendingPresentationJoinTicks = new Set();
  let liveStartKey = '';
  let messageSeq = 0;
  let lagTimer = null;
  let discoveryTimer = null;
  let joinedLobbyName = null;
  let lastDiscoveryStatus = '';
  let bestLivePresence = null;
  let bootResolve = null;
  const bootPromise = new Promise((r) => {
    bootResolve = r;
  });

  function liveConfig(reset = false) {
    return {
      mode: 'koth',
      seed,
      localPlayerId,
      localUserId,
      appState,
      roster: cloneSlots(roster),
      humanPlayers: [...matchHumanPlayers],
      role,
      matchId,
      phase,
      activeSlots: activePlayerIds(roster),
      startKey: liveStartKey,
      tick: session?.confirmedTick ?? 0,
      reset,
    };
  }

  function notifyLiveStart(reset = false) {
    onLiveStart(liveConfig(reset));
  }

  function notifyPresentationSync(extra = {}) {
    onPresentationSync({ ...liveConfig(false), ...extra });
  }


  let announceTimer = null;
  let presencePeers = new Map();

  function emitShard() {
    onShardChange({
      matchId,
      phase,
      roster: cloneSlots(roster),
      seed,
      localPlayerId,
      role,
      appState,
      localUserId,
    });
  }

  function broadcastPresence(extra = {}) {
    if (!p2p?.broadcast) return;
    if (appState !== KOTH_APP_STATE.PRIVATE_SANDBOX) touchSavedMatch();
    p2p.broadcast(
      {
        type: MSG.SHARD_PRESENCE,
        matchId,
        phase,
        activeCount: countActive(roster),
        tick: session?.confirmedTick ?? 0,
        from: localUserId,
        v: KOTH_PROTOCOL_VERSION,
        peers: connectedPeerIds(),
        ...extra,
      },
      BROADCAST,
    );
  }

  function shardLobbyName(id = matchId) {
    return `${LOBBY}:${id}`;
  }

  function joinLobby(lobby) {
    if (!p2p?.joinMatchLobby) return;
    if (joinedLobbyName === lobby) return;
    joinedLobbyName = lobby;
    p2p.joinMatchLobby(lobby);
  }

  function joinMatchmakingLobby() {
    joinLobby(MATCHMAKING_LOBBY);
  }

  function joinShardLobby() {
    joinLobby(shardLobbyName());
  }

  function rememberLivePresence(data) {
    if (!data?.matchId || data.phase !== SHARD_PHASE.LIVE) return;
    if (!bestLivePresence || (data.tick ?? 0) >= (bestLivePresence.tick ?? 0)) {
      bestLivePresence = {
        matchId: data.matchId,
        tick: data.tick ?? 0,
        from: data.from,
      };
    }
  }

  function enterMatchmaking() {
    appState = KOTH_APP_STATE.MATCHMAKING;
    role = 'player';
    catchUpReady = true;
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    localPlayerId = 0;
    joinMatchmakingLobby();
    emitShard();
    broadcastPresence();
    pumpDiscovery();
    onStatus(`Lobby — waiting for ${MIN_LIVE_PLAYERS} players`);
  }

  function followLivePresence(presence) {
    if (!presence?.matchId) return false;
    matchId = presence.matchId;
    phase = SHARD_PHASE.LIVE;
    appState = KOTH_APP_STATE.SPECTATOR;
    role = 'spectator';
    catchUpReady = false;
    roster = createEmptyRoster();
    localPlayerId = -1;
    joinShardLobby();
    emitShard();
    broadcastPresence();
    session?.setLocalPlayerId?.(-1);
    session?.setRole?.('spectator');
    notifyPresentationSync({
      mode: 'koth',
      role: 'spectator',
      localPlayerId: -1,
      appState,
      reset: false,
      inputEnabled: false,
    });
    onStatus(`Connecting to live match …${shortId(matchId)}`);
    if (presence.from) tryConnectPeer(presence.from);
    return true;
  }

  function nextMessageId(type) {
    return `${localUserId ?? 'boot'}:${type}:${++messageSeq}`;
  }

  function withMessageId(msg) {
    const versioned = msg.v == null ? { ...msg, v: KOTH_PROTOCOL_VERSION } : msg;
    const sourced = versioned.from == null && localUserId ? { ...versioned, from: localUserId } : versioned;
    if (sourced._mid) return sourced;
    return { ...sourced, _mid: nextMessageId(sourced.type ?? 'msg') };
  }

  function sendAll(msg) {
    const stamped = withMessageId(msg);
    rememberMessageId(stamped._mid);
    p2p?.sendData?.(stamped);
  }

  function sendPeer(peerId, msg) {
    const stamped = withMessageId(msg);
    rememberMessageId(stamped._mid);
    p2p?.sendData?.(stamped, peerId);
  }

  function rememberMessageId(mid) {
    if (!mid || seenMessageIds.has(mid)) return;
    seenMessageIds.add(mid);
    seenMessageOrder.push(mid);
    while (seenMessageOrder.length > SEEN_MESSAGE_LIMIT) {
      const old = seenMessageOrder.shift();
      if (old) seenMessageIds.delete(old);
    }
  }

  function relay(msg, fromPeerId) {
    if (!msg?._mid || !shouldRelay(msg.type)) return;
    for (const peerId of connectedPeerIds()) {
      if (peerId === fromPeerId) continue;
      sendPeer(peerId, msg);
    }
  }

  function shouldRelay(type) {
    return (
      type === MSG.SHARD_HELLO ||
      type === MSG.SHARD_STATE ||
      type === MSG.MATCH_RESET ||
      type === MSG.MATCH_SNAPSHOT ||
      type === MSG.COMMAND_FRAME ||
      type === MSG.TICK_CONFIRM ||
      type === MSG.JOIN_INTENT ||
      type === MSG.JOIN_ACCEPT ||
      type === MSG.JOIN_READY ||
      type === MSG.ROSTER_UPDATE ||
      type === MSG.SLOT_DEFEAT ||
      type === MSG.SHARD_GONE ||
      type === MSG.CATCHUP_READY
    );
  }

  function connectedPeerIds() {
    return p2p?.getConnectedPeers?.() ?? [];
  }

  function tryConnectPeer(userId) {
    if (!p2p || !userId || userId === localUserId) return;
    presencePeers.set(userId, userId);
    if (connectedPeerIds().includes(userId)) return;

    const request = (attempt = 0) => {
      if (phase !== SHARD_PHASE.SANDBOX && phase !== SHARD_PHASE.LIVE) return;
      if (!connectedPeerIds().includes(userId)) p2p.requestMatch?.(userId);
      if (attempt < 2) {
        setTimeout(() => {
          if (!connectedPeerIds().includes(userId)) request(attempt + 1);
        }, 1200 + attempt * 1800);
      }
    };

    if (!localUserId || localUserId > userId) request();
    else setTimeout(request, 900);
  }

  function setDiscoveryStatus(msg) {
    if (lastDiscoveryStatus === msg) return;
    lastDiscoveryStatus = msg;
    onStatus(msg);
  }

  function pumpDiscovery() {
    if (!p2p || !localUserId) return;
    if (appState === KOTH_APP_STATE.MATCHMAKING || phase === SHARD_PHASE.LIVE) p2p.announcePresence?.();
    broadcastPresence();
    for (const userId of presencePeers.keys()) tryConnectPeer(userId);
    for (const peerId of connectedPeerIds()) {
      if (readyPeerIds.has(peerId)) continue;
      sendPeer(peerId, {
        type: MSG.SHARD_HELLO,
        matchId,
        from: localUserId,
        phase,
      });
    }
    if (appState === KOTH_APP_STATE.MATCHMAKING) {
      const known = Math.max(0, allKnownUserIds().length - 1);
      const linked = connectedPeerIds().length;
      setDiscoveryStatus(
        linked > 0
          ? `Linked ${linked} peer${linked === 1 ? '' : 's'} — starting…`
          : `Lobby — ${known ? `found ${known}, connecting…` : 'waiting for challengers'}`,
      );
    }
  }

  function allKnownUserIds() {
    const ids = new Set([localUserId]);
    for (const id of connectedPeerIds()) ids.add(id);
    for (const id of peerUserIds.values()) ids.add(id);
    return [...ids].filter(Boolean);
  }

  function connectedRosterUserIds() {
    const ids = new Set([localUserId]);
    for (const id of connectedPeerIds()) {
      if (!readyPeerIds.has(id)) continue;
      ids.add(peerUserIds.get(id) ?? id);
    }
    return [...ids].filter(Boolean);
  }

  function setPhase(next) {
    phase = next;
    emitShard();
    broadcastPresence();
  }

  function setRole(next) {
    role = next;
    if (phase === SHARD_PHASE.LIVE) {
      appState = next === 'player' ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    }
    session?.setRole(next);
    emitShard();
    notifyPresentationSync({ role: next, appState, inputEnabled: next === 'player' });
  }

  function startFreshSandbox(reason = 'No live shard found') {
    if (phase !== SHARD_PHASE.SANDBOX) return;
    clearSavedMatch();
    matchId = generateMatchId();
    seed = 0x1234;
    liveStartKey = '';
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    localPlayerId = 0;
    role = 'player';
    appState = KOTH_APP_STATE.PRIVATE_SANDBOX;
    catchUpReady = true;
    onStatus(`${reason} — new sandbox …${shortId(matchId)}`);
    onLiveStart({
      mode: 'sandbox',
      seed,
      localPlayerId: 0,
      humanPlayers: [0],
      role: 'player',
      matchId,
      phase,
      activeSlots: [0],
      reset: true,
    });
    emitShard();
    broadcastPresence();
  }

  function reconcileMatchId(incomingMatchId, incomingPhase = SHARD_PHASE.SANDBOX) {
    if (!incomingMatchId || incomingMatchId === matchId) return true;
    if (phase !== SHARD_PHASE.SANDBOX) return false;
    if (appState === KOTH_APP_STATE.PRIVATE_SANDBOX) return false;

    const nextMatchId =
      incomingPhase === SHARD_PHASE.LIVE ? incomingMatchId : [matchId, incomingMatchId].sort()[0];
    if (nextMatchId !== matchId) {
      matchId = nextMatchId;
      seed = hashSeed(matchId);
      liveStartKey = '';
      roster = createEmptyRoster();
      roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
      if (incomingPhase === SHARD_PHASE.LIVE) saveMatch({ matchId, userId: localUserId, slot: 0 });
      onStatus(`Joined shard …${shortId(matchId)}`);
      if (incomingPhase === SHARD_PHASE.LIVE) joinShardLobby();
      emitShard();
      broadcastPresence();
    }
    return true;
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

  function eventSourcePlayerId() {
    const active = activePlayerIds(roster);
    return active.length ? active[0] : localPlayerId;
  }

  function userForPlayerId(playerId) {
    const slot = roster[playerId];
    return slot?.playerId === playerId && slot.state === 'active' ? slot.userId : null;
  }

  function rosterUserIds(slots) {
    return slots
      .filter((s) => s.state === 'active' && s.userId)
      .map((s) => s.userId)
      .sort();
  }

  function isCanonicalResetSender(msg, slots) {
    const ids = rosterUserIds(slots);
    return ids.length >= 2 && msg.from === ids[0];
  }

  function validateCommandFrame(frame) {
    return ownsPlayerFrame(roster, frame);
  }

  function applyLocalRosterSlot() {
    const localSlot = slotForUser(roster, localUserId);
    const activeLocalSlot = localSlot?.state === 'active' ? localSlot : null;
    localPlayerId = activeLocalSlot?.playerId ?? -1;
    role = activeLocalSlot ? 'player' : 'spectator';
    appState = activeLocalSlot ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    session?.setLocalPlayerId?.(localPlayerId);
    session?.setRole?.(role);
    return localSlot;
  }

  function checkLagTimeouts() {
    // Lag/disconnect defeats need quorum evidence in a peer-consensus model.
    // Keep confirm timestamps for UI/debugging, but do not let one peer decide.
    if (phase !== SHARD_PHASE.LIVE || !session) return;
    sendTickConfirm(session.confirmedTick + 1);
  }

  function forceDefeatPlayer(playerId, userId) {
    const tick = (session?.confirmedTick ?? 0) + 2;
    roster = releaseUser(roster, userId, true);
    sendAll({ type: MSG.SLOT_DEFEAT, matchId, playerId, userId, tick });
    applySlotDefeat(playerId, tick);
    checkShardEmpty();
  }

  function applySlotDefeat(playerId, tick) {
    const eventId = `defeat:${matchId}:${playerId}:${tick}`;
    const source = eventSourcePlayerId();
    const frame = session?.submitAtTick(
      tick,
      { type: CMD.FORCE_ELIMINATE, playerId },
      { playerId: source, commandId: eventId },
    );
    if (frame) {
      frame.userId = userForPlayerId(frame.playerId);
      sendAll({ type: MSG.COMMAND_FRAME, frame });
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
    windDownShard();
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
    rememberAcceptedJoin(msg);
    pendingPresentationJoinTicks.add(msg.joinTick);
    const eventId = msg.eventId ?? `join:${matchId}:${msg.userId}:${msg.playerId}:${msg.joinTick}`;
    const frame = session?.submitAtTick(
      msg.joinTick,
      { type: CMD.SPAWN_SLOT, playerId: msg.playerId },
      { playerId: eventSourcePlayerId(), commandId: eventId },
    );
    if (frame) {
      frame.userId = userForPlayerId(frame.playerId);
      sendAll({ type: MSG.COMMAND_FRAME, frame });
    }
  }

  function rememberAcceptedJoin(msg) {
    let list = pendingAcceptedJoins.get(msg.joinTick);
    if (!list) {
      list = [];
      pendingAcceptedJoins.set(msg.joinTick, list);
    }
    if (!list.some((join) => join.userId === msg.userId && join.playerId === msg.playerId)) {
      list.push({ userId: msg.userId, playerId: msg.playerId, joinTick: msg.joinTick });
    }
  }

  function activateAcceptedJoinsAtTick(tick) {
    const joins = pendingAcceptedJoins.get(tick);
    if (!joins?.length) return;
    for (const join of joins) {
      roster = activateSlot(roster, join.playerId, join.userId).slots;
    }
    pendingAcceptedJoins.delete(tick);
    emitShard();
    broadcastPresence();
  }

  function promoteLocalJoinIfReady(tick) {
    if (!pendingLocalJoin || tick < pendingLocalJoin.joinTick) return;
    localPlayerId = pendingLocalJoin.playerId;
    role = 'player';
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    catchUpReady = true;
    session?.setLocalPlayerId?.(localPlayerId);
    session?.setRole?.('player');
    if (!matchHumanPlayers.includes(localPlayerId)) {
      matchHumanPlayers = [...matchHumanPlayers, localPlayerId].sort((a, b) => a - b);
      session?.setHumanPlayers?.(matchHumanPlayers);
    }
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    notifyPresentationSync({ role: 'player', appState, localPlayerId, inputEnabled: true });
    sendAll({
      type: MSG.JOIN_READY,
      matchId,
      userId: localUserId,
      playerId: localPlayerId,
      tick,
    });
    onStatus(`Joined match — player ${localPlayerId}`);
    pendingLocalJoin = null;
    emitShard();
    broadcastPresence();
  }

  function handleJoinReady(msg) {
    if (msg.matchId !== matchId) return;
    if (!msg.userId || msg.playerId == null) return;
    const slot = roster[msg.playerId];
    if (slot?.state !== 'active' || slot.userId !== msg.userId) return;
    if (!matchHumanPlayers.includes(msg.playerId)) {
      matchHumanPlayers = [...matchHumanPlayers, msg.playerId].sort((a, b) => a - b);
      session?.setHumanPlayers?.(matchHumanPlayers);
    }
    session?.setPeerConfirmedTick?.(msg.playerId, Math.max(msg.tick ?? 0, session.confirmedTick));
    emitShard();
  }

  function syncJoinedPresentationIfReady(tick) {
    if (!pendingPresentationJoinTicks.has(tick)) return;
    pendingPresentationJoinTicks.delete(tick);
    notifyPresentationSync({ role, appState, localPlayerId, inputEnabled: role === 'player' });
  }

  function maybeStartLive() {
    if (appState !== KOTH_APP_STATE.MATCHMAKING || role !== 'player') return;
    const ids = connectedRosterUserIds();
    const total = ids.length;
    if (phase !== SHARD_PHASE.SANDBOX || total < MIN_LIVE_PLAYERS) return;
    roster = rosterFromPeers(ids);
    seed = hashSeed(matchId);
    const localSlot = applyLocalRosterSlot();
    liveStartKey = matchStartKey(matchId, roster, seed);

    const resetSender = rosterUserIds(roster)[0];
    if (localUserId !== resetSender) {
      appState = KOTH_APP_STATE.MATCHMAKING;
      role = 'player';
      onStatus(`Linked ${total} peers — waiting for roster sync…`);
      return;
    }

    setPhase(SHARD_PHASE.LIVE);
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    joinShardLobby();
    matchStartSlots = activePlayerIds(roster);
    matchHumanPlayers = [...matchStartSlots];
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);

    sendAll({
      type: MSG.MATCH_SNAPSHOT,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      seed,
      roster: cloneSlots(roster),
      phase: SHARD_PHASE.LIVE,
      tick: 0,
      activeSlots: activePlayerIds(roster),
      humanPlayers: activePlayerIds(roster),
      startKey: liveStartKey,
    });

    onStatus(`Match live — ${total} players — id …${shortId(matchId)}`);
    notifyLiveStart(true);
  }

  function handleMatchSnapshot(msg, fromPeerId = null) {
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (!reconcileMatchId(msg.matchId, SHARD_PHASE.LIVE)) return;
    const nextRoster = cloneSlots(msg.roster ?? roster);
    const nextSeed = msg.seed ?? seed;
    const nextKey = msg.startKey ?? matchStartKey(matchId, nextRoster, nextSeed);
    if (!isCanonicalResetSender(msg, nextRoster)) return;
    const localSnapshotSlot = slotForUser(nextRoster, localUserId);
    if (localSnapshotSlot?.state !== 'active') {
      // Late spectators must not apply the tick-0 start snapshot to the visible sim.
      // They need to replay from a live sponsor to the current tick first.
      roster = nextRoster;
      seed = nextSeed;
      liveStartKey = nextKey;
      matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
      matchHumanPlayers = msg.humanPlayers ?? [...matchStartSlots];
      phase = SHARD_PHASE.LIVE;
      role = 'spectator';
      appState = KOTH_APP_STATE.SPECTATOR;
      localPlayerId = -1;
      catchUpReady = false;
      session?.setLocalPlayerId?.(-1);
      session?.setRole?.('spectator');
      saveMatch({ matchId, userId: localUserId, slot: null });
      emitShard();
      notifyPresentationSync({
        mode: 'koth',
        role: 'spectator',
        localPlayerId: -1,
        appState,
        reset: false,
        inputEnabled: false,
      });
      onStatus('Live match found — catching up…');
      beginCatchup(fromPeerId ?? pickSponsorPeerId(), msg.tick ?? 0);
      return;
    }
    if (phase === SHARD_PHASE.LIVE && liveStartKey === nextKey) {
      roster = nextRoster;
      matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
      matchHumanPlayers = msg.humanPlayers ?? [...matchStartSlots];
      session?.setHumanPlayers?.(matchHumanPlayers);
      applyLocalRosterSlot();
      emitShard();
      return;
    }
    if (phase === SHARD_PHASE.LIVE && liveStartKey && liveStartKey !== nextKey) return;
    roster = cloneSlots(msg.roster ?? roster);
    seed = msg.seed ?? seed;
    liveStartKey = nextKey;
    matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
    matchHumanPlayers = msg.humanPlayers ?? [...matchStartSlots];
    applyLocalRosterSlot();
    appState = role === 'player' ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    setPhase(SHARD_PHASE.LIVE);
    catchUpReady = true;
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    onStatus(`Synced — player ${localPlayerId}`);
    notifyLiveStart(true);
  }

  function handleJoinIntent(msg) {
    if (msg.matchId !== matchId) return;
    if (phase !== SHARD_PHASE.LIVE || !session || !catchUpReady) return;
    if (!msg.caughtUp) return;
    if (!msg.userId) return;
    const joinTick = msg.joinTick ?? ((session.confirmedTick ?? 0) + JOIN_DELAY_TICKS);
    const prev = joinIntents.get(msg.userId);
    if (!prev || joinTick < prev.joinTick || (joinTick === prev.joinTick && (msg.intentId ?? '') < (prev.intentId ?? ''))) {
      joinIntents.set(msg.userId, {
        ...msg,
        joinTick,
        intentId: msg.intentId ?? `intent:${matchId}:${msg.userId}:${joinTick}`,
      });
    }
    processJoinQueue();
  }

  function processJoinQueue() {
    if (phase !== SHARD_PHASE.LIVE || !session) return;
    if (localUserId !== rosterUserIds(roster)[0]) return;
    const intents = [...joinIntents.values()].sort(
      (a, b) => a.joinTick - b.joinTick || String(a.userId).localeCompare(String(b.userId)),
    );
    for (const intent of intents) {
      if (intent.joinTick <= session.confirmedTick) {
        joinIntents.delete(intent.userId);
        continue;
      }
      if (session.confirmedTick < intent.joinTick - JOIN_ASSIGN_LEAD_TICKS) continue;
      const { slots, playerId } = reserveOpenSlot(roster, intent.userId);
      if (playerId < 0) break;
      roster = slots;
      const accept = {
        type: MSG.JOIN_ACCEPT,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        userId: intent.userId,
        playerId,
        joinTick: intent.joinTick,
        eventId: `join:${matchId}:${intent.userId}:${playerId}:${intent.joinTick}`,
        spawnSeed: hashSeed(`${matchId}:${intent.userId}:${playerId}:${intent.joinTick}`),
      };
      sendAll(accept);
      commitJoinAtTick(accept);
      joinIntents.delete(intent.userId);
      if (intent.userId === localUserId) {
        pendingLocalJoin = { playerId, joinTick: intent.joinTick };
        role = 'spectator';
        appState = KOTH_APP_STATE.JOINING;
        catchUpReady = true;
        session.setRole('spectator');
        notifyPresentationSync({ role: 'spectator', appState, localPlayerId, inputEnabled: false });
        onStatus(`Joining at tick ${intent.joinTick}…`);
      }
      emitShard();
      broadcastPresence();
    }
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
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      userId: localUserId,
      playerId,
      joinTick: msg.joinTick,
    };
    sendAll(accept);
    commitJoinAtTick(accept);
    session?.setLocalPlayerId?.(playerId);
    session?.setRole('player');
    emitShard();
  }

  function handleJoinAccept(msg) {
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (msg.matchId !== matchId) return;
    roster = reserveSlot(roster, msg.playerId, msg.userId);
    commitJoinAtTick(msg);
    joinIntents.delete(msg.userId);
    if (msg.userId === localUserId) {
      pendingLocalJoin = { playerId: msg.playerId, joinTick: msg.joinTick };
      role = 'spectator';
      appState = KOTH_APP_STATE.JOINING;
      catchUpReady = true;
      session?.setRole('spectator');
      notifyPresentationSync({ role: 'spectator', appState, localPlayerId, inputEnabled: false });
      onStatus(`Joining at tick ${msg.joinTick}…`);
    }
    emitShard();
    broadcastPresence();
  }

  async function handleSnapshotRequest(msg, fromPeerId) {
    if (msg.matchId !== matchId) return;
    if (!session) return;
    if (msg.to && msg.to !== localUserId) return;
    if (role === 'spectator' && !msg.relay) {
      const sponsor = pickSponsorPeerId();
      if (sponsor && sponsor !== fromPeerId) {
        sendPeer(sponsor, { ...msg, relay: true });
      }
      return;
    }
    // Reply with a self-consistent pair: current tick and current checksum.
    // The requester may have asked from a stale SHARD_STATE tick.
    const tick = session.confirmedTick;
    const ledger = msg.fullReplay
      ? session.exportLedger(0, tick)
      : session.exportLedger(msg.fromTick ?? 0, tick);
    const responsePeerId = connectedPeerIds().includes(msg.from) ? msg.from : fromPeerId;
    sendPeer(responsePeerId, {
      type: MSG.SNAPSHOT_OFFER,
      matchId,
      to: msg.from,
      requestId: msg.requestId,
      tick,
      checksum: session._lastChecksum,
      ledger,
      ledgerFrameCount: ledger.length,
      matchConfig: matchConfig(),
    });
  }

  async function handleSnapshotOffer(msg) {
    if (msg.matchId !== matchId) return;
    if (msg.to && msg.to !== localUserId) return;
    if (!activeCatchupRequestId || msg.requestId !== activeCatchupRequestId) return;
    if (!session || !msg.matchConfig) return;
    activeCatchupRequestId = '';
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
      phase = SHARD_PHASE.LIVE;
      appState = KOTH_APP_STATE.SPECTATOR;
      localPlayerId = -1;
      matchStartSlots = msg.matchConfig.activeSlots ?? matchStartSlots;
      matchHumanPlayers = msg.matchConfig.humanPlayers ?? matchHumanPlayers;
      session.setHumanPlayers?.(matchHumanPlayers);
      session.setLocalPlayerId?.(-1);
      setRole('spectator');
      saveMatch({ matchId, userId: localUserId, slot: null });
      onStatus('Caught up — J to join');
      notifyPresentationSync({
        mode: 'koth',
        role: 'spectator',
        reset: false,
        inputEnabled: false,
        updateHumanPlayers: true,
      });
      sendAll({ type: MSG.CATCHUP_READY, matchId, userId: localUserId, tick: msg.tick });
      catchupRetryAttempt = 0;
    } catch (err) {
      console.warn('[KOTH] catch-up failed', err);
      catchUpReady = false;
      pendingLocalJoin = null;
      localPlayerId = -1;
      role = 'spectator';
      appState = KOTH_APP_STATE.SPECTATOR;
      session?.setLocalPlayerId?.(-1);
      session?.setRole?.('spectator');
      notifyPresentationSync({ mode: 'koth', role: 'spectator', localPlayerId: -1, appState, reset: false, inputEnabled: false });
      onStatus('Catch-up failed — retrying…');
      scheduleCatchupRetry(msg.tick ?? 0);
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
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (msg._mid) {
      if (seenMessageIds.has(msg._mid)) return;
      rememberMessageId(msg._mid);
      relay(msg, fromPeerId);
    }
    if (msg.from) peerUserIds.set(fromPeerId, msg.from);
    if (msg.userId && msg.userId !== localUserId) presencePeers.set(msg.userId, msg.userId);

    switch (msg.type) {
      case MSG.SHARD_HELLO:
        if (msg.v !== KOTH_PROTOCOL_VERSION) return;
        if (!reconcileMatchId(msg.matchId, msg.phase)) return;
        if (msg.from) peerUserIds.set(fromPeerId, msg.from);
        readyPeerIds.add(fromPeerId);
        presencePeers.set(msg.from ?? fromPeerId, msg.from ?? fromPeerId);
        sendPeer(fromPeerId, {
          type: MSG.SHARD_STATE,
          v: KOTH_PROTOCOL_VERSION,
          matchId,
          from: localUserId,
          phase,
          roster: cloneSlots(roster),
          seed,
          tick: session?.confirmedTick ?? 0,
          matchStartSlots,
          matchHumanPlayers,
          startKey: liveStartKey,
        });
        if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
        else if (phase === SHARD_PHASE.LIVE && role !== 'player') {
          setRole('spectator');
          beginCatchup(pickSponsorPeerId(), session?.confirmedTick ?? 0);
        }
        break;

      case MSG.SHARD_STATE:
        if (msg.v !== KOTH_PROTOCOL_VERSION) return;
        if (!reconcileMatchId(msg.matchId, msg.phase)) return;
        if (msg.from) peerUserIds.set(fromPeerId, msg.from);
        readyPeerIds.add(fromPeerId);
        if (msg.matchStartSlots) matchStartSlots = msg.matchStartSlots;
        if (msg.matchHumanPlayers) matchHumanPlayers = msg.matchHumanPlayers;
        if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
        if (msg.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX) {
          roster = cloneSlots(msg.roster ?? roster);
          seed = msg.seed ?? seed;
          liveStartKey = msg.startKey ?? liveStartKey;
          phase = SHARD_PHASE.LIVE;
          appState = KOTH_APP_STATE.SPECTATOR;
          role = 'spectator';
          localPlayerId = -1;
          catchUpReady = false;
          session?.setLocalPlayerId?.(-1);
          session?.setRole?.('spectator');
          emitShard();
          notifyPresentationSync({
            mode: 'koth',
            role: 'spectator',
            localPlayerId: -1,
            appState,
            reset: false,
            inputEnabled: false,
          });
          beginCatchup(fromPeerId, msg.tick ?? 0);
        }
        break;

      case MSG.MATCH_RESET:
      case MSG.MATCH_SNAPSHOT:
        handleMatchSnapshot(msg, fromPeerId);
        break;

      case MSG.COMMAND_FRAME:
        if (validateCommandFrame(msg.frame)) session?.bufferRemoteFrame(msg.frame);
        break;

      case MSG.TICK_CONFIRM:
        if (msg.playerId !== undefined && msg.tick !== undefined) {
          if (!msg.userId || userForPlayerId(msg.playerId) !== msg.userId) return;
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
        // Deprecated: JOIN_ACCEPT is the single typed join transition.
        break;

      case MSG.JOIN_ACCEPT:
        handleJoinAccept(msg);
        break;

      case MSG.JOIN_READY:
        handleJoinReady(msg);
        break;

      case MSG.ROSTER_UPDATE:
        // Deprecated: roster changes after live start must arrive through
        // JOIN_ACCEPT or SLOT_DEFEAT plus the corresponding deterministic command.
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
    if (activeCatchupRequestId) return;
    if (catchupRetryTimer) {
      clearTimeout(catchupRetryTimer);
      catchupRetryTimer = null;
    }
    catchUpReady = false;
    activeCatchupRequestId = `catchup:${matchId}:${localUserId}:${Date.now().toString(36)}:${++messageSeq}`;
    const target = tick || session.confirmedTick || 0;
    sendPeer(peerId, {
      type: MSG.SNAPSHOT_REQUEST,
      matchId,
      from: localUserId,
      to: peerUserIds.get(peerId) ?? peerId,
      requestId: activeCatchupRequestId,
      tick: target,
      fromTick: 0,
      fullReplay: true,
    });
    onStatus('Catching up…');
  }

  function scheduleCatchupRetry(tick = 0) {
    if (catchupRetryTimer) return;
    const delay = Math.min(5000, 500 * 2 ** catchupRetryAttempt);
    catchupRetryAttempt++;
    catchupRetryTimer = setTimeout(() => {
      catchupRetryTimer = null;
      beginCatchup(pickSponsorPeerId(), tick);
    }, delay);
  }

  function sendTickConfirm(tick) {
    if (!session || role !== 'player') return;
    if (userForPlayerId(session.localPlayerId) !== localUserId) return;
    sendAll({ type: MSG.TICK_CONFIRM, tick, playerId: session.localPlayerId, userId: localUserId });
  }

  function onPeerConnected(peerId) {
    console.log('[KOTH] peer connected', shortId(peerId));
    peerUserIds.set(peerId, peerId);
    presencePeers.set(peerId, peerId);
    sendPeer(peerId, {
      type: MSG.SHARD_HELLO,
      v: KOTH_PROTOCOL_VERSION,
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
    readyPeerIds.delete(peerId);
    onStatus(`Peer …${shortId(uid ?? peerId)} link lost — waiting for mesh gossip`);
  }

  function onBroadcastMessage(data) {
    if (data?.type !== MSG.SHARD_PRESENCE) return;
    if (data.from === localUserId) return;
    rememberLivePresence(data);
    if (appState === KOTH_APP_STATE.PRIVATE_SANDBOX) return;
    if (data.phase === SHARD_PHASE.LIVE && phase !== SHARD_PHASE.LIVE) {
      followLivePresence(data);
      return;
    }
    if (!reconcileMatchId(data.matchId, data.phase)) return;
    presencePeers.set(data.from, data.from);
    tryConnectPeer(data.from);
    if (data.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX) {
      setDiscoveryStatus('Live match found — connecting…');
    }
  }

  function onGameLobbyMessage(data) {
    if (!data?.type) return;
    if (data.type === 'player_join' || data.type === 'player_rejoin') {
      if (data.from === localUserId) {
        broadcastPresence();
        return;
      }
      tryConnectPeer(data.from);
    }
  }

  // --- boot ---

  onStatus('Joining King of the Hill…');

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
    if (role === 'player') roster[0].userId = localUserId;
    {
      const saved = loadSavedMatch();
      if (appState !== KOTH_APP_STATE.PRIVATE_SANDBOX) {
        saveMatch({
          matchId,
          userId: localUserId,
          slot: saved?.userId === localUserId ? saved.slot : undefined,
        });
      }
    }

    p2p.joinBroadcast?.(BROADCAST);

    setPhase(SHARD_PHASE.SANDBOX);
    onStatus(
      role === 'spectator'
        ? `Looking for live shard …${shortId(matchId)}`
        : `Sandbox — match …${shortId(matchId)} — waiting for challengers`,
    );

    bootResolve?.({
      mode: 'sandbox',
      seed,
      localPlayerId: 0,
      humanPlayers: [0],
      role,
      matchId,
      phase,
      activeSlots: role === 'player' ? [0] : [],
    });
    bootResolve = null;

    announceTimer = setInterval(() => broadcastPresence(), SHARD_ANNOUNCE_MS);
    discoveryTimer = setInterval(() => pumpDiscovery(), 3000);
    lagTimer = setInterval(() => checkLagTimeouts(), 5000);
    setTimeout(() => pumpDiscovery(), 500);
    setTimeout(() => pumpDiscovery(), 1500);
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
      appState,
    }),

    attachSession(simSession) {
      session = simSession;

      const prevSubmit = session.submitCommand.bind(session);
      session.submitCommand = (command) => {
        if (role !== 'player') return null;
        if (userForPlayerId(session.localPlayerId) !== localUserId) return null;
        const frame = prevSubmit(command);
        if (frame) {
          frame.userId = localUserId;
          sendAll({ type: MSG.COMMAND_FRAME, frame });
        }
        return frame;
      };

      const prevCommit = session.onCommit;
      session.onCommit = (tick, checksum) => {
        activateAcceptedJoinsAtTick(tick);
        promoteLocalJoinIfReady(tick);
        syncJoinedPresentationIfReady(tick);
        sendTickConfirm(tick + 1);
        processJoinQueue();
        prevCommit?.(tick, checksum);
        if (phase === SHARD_PHASE.LIVE) broadcastPresence({ tick });
      };

      sendTickConfirm(1);
    },

    startOrJoinLive() {
      if (phase === SHARD_PHASE.LIVE) return;
      if (bestLivePresence?.matchId && bestLivePresence.from) {
        followLivePresence(bestLivePresence);
        return;
      }
      clearSavedMatch();
      matchId = generateMatchId();
      seed = hashSeed(matchId);
      enterMatchmaking();
    },

    requestJoin() {
      if (role === 'player') return;
      if (appState === KOTH_APP_STATE.JOINING || appState === KOTH_APP_STATE.QUEUED) return;
      if (!catchUpReady) {
        onStatus('Still catching up…');
        return;
      }
      const joinTick = (session?.confirmedTick ?? 0) + JOIN_DELAY_TICKS;
      const intentId = `intent:${matchId}:${localUserId}:${joinTick}`;
      sendAll({
        type: MSG.JOIN_INTENT,
        matchId,
        userId: localUserId,
        slot: -1,
        caughtUp: true,
        joinTick,
        intentId,
      });
      appState = countActive(roster) >= MAX_ACTIVE_PLAYERS ? KOTH_APP_STATE.QUEUED : KOTH_APP_STATE.JOINING;
      session?.setRole?.('spectator');
      notifyPresentationSync({ role: 'spectator', appState, inputEnabled: false });
      onStatus(appState === KOTH_APP_STATE.QUEUED ? 'Queued for next slot…' : 'Requesting slot…');
    },

    isSpectator() {
      return role === 'spectator';
    },

    canJoin() {
      return catchUpReady && !activeCatchupRequestId && role === 'spectator' && appState === KOTH_APP_STATE.SPECTATOR;
    },

    joinActionLabel() {
      return countActive(roster) >= MAX_ACTIVE_PLAYERS ? 'Join Player Queue' : 'Enter Match';
    },

    canStartOrJoinLive() {
      return appState === KOTH_APP_STATE.PRIVATE_SANDBOX;
    },

    releaseSlot(spectate = true) {
      if (localPlayerId >= 0) forceDefeatPlayer(localPlayerId, localUserId);
    },

    disconnect() {
      if (announceTimer) clearInterval(announceTimer);
      if (discoveryTimer) clearInterval(discoveryTimer);
      if (catchupRetryTimer) clearTimeout(catchupRetryTimer);
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

function matchStartKey(matchId, roster, seed) {
  const users = roster
    .filter((s) => s.state === 'active' && s.userId)
    .map((s) => `${s.playerId}:${s.userId}`)
    .join('|');
  return `${matchId}:${seed}:${users}`;
}

/** KOTH on by default; ?solo=1 or ?stress=N disables. */
export function kothModeFromSearch(search = '') {
  const params = new URLSearchParams(search);
  if (params.has('solo')) return false;
  if (params.get('stress')) return false;
  if (params.has('koth') && params.get('koth') === '0') return false;
  return true;
}
