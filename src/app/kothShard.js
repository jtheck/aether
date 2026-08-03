// King of the Hill shard — multi-peer P2P orchestration.
//
// GetFire lobby = signaling + auto WebRTC mesh.
// Broadcast channel = shard presence (matchId, phase, tick).
//
// Hard KOTH invariants:
// - Page load creates a private sandbox and never claims a public live slot.
// - Public live state is entered by applying one complete MATCH_SNAPSHOT.
// - Mid-match sync uses checkpoint + ledger delta (or full replay before the
//   first checkpoint); L2+ observers only pull from their sponsor observer.
// - Open seats use cascading SLOT_OFFER / opt-in SLOT_CLAIM (no auto-promote).
// - Roster changes after live start flow through JOIN_ACCEPT or SLOT_DEFEAT.
// - Commands and tick confirms must be owned by the userId for their playerId.

import { p2pDevModeFromLocation } from './net.js';
import { replayCatchUp, formatMatchTime, matchSecondsFromTick } from './catchup.js';
import {
  createChunkAssembler,
  createLedgerAssembler,
  packCheckpointChunks,
  packLedgerChunks,
} from './kothCheckpointWire.js';
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
  createObserverTree,
  upsertNode,
  assignSponsor,
  promoteObserverToPlayer,
  offerEligibleUserIds,
  listObserversByJoin,
  CHECKPOINT_INTERVAL_TICKS,
  OFFER_EXPAND_MS,
} from '../koth/observerTree.js';
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
const KOTH_PROTOCOL_VERSION = 3;
const MIN_LIVE_PLAYERS = 2;
const MAX_ACTIVE_PLAYERS = 5;
// How long to listen in the matchmaking lobby for an existing match before
// creating a new one, so two players pressing start near-simultaneously join the
// same match instead of each spawning their own.
const CATCHUP_OFFER_TIMEOUT_MS = 8000;
const MATCH_DISCOVERY_MS = 1200;
// How long a heard-about live match stays in the registry without a refresh.
const LIVE_MATCH_TTL_MS = 12000;
const SEEN_MESSAGE_LIMIT = 2000;
const MATCHMAKING_LOBBY = `${LOBBY}:matchmaking`;
const DEBUG_KOTH =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'koth';

function unwrapMessage(data) {
  const msg = typeof data === 'string' ? JSON.parse(data) : data;
  if (msg?.type === 'game_data' && msg.content) return msg.content;
  return msg;
}

function userIdsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(b) || b.endsWith(a);
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
  let armyPerSide = (options.armyPerSide | 0) || 0;

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
  /** True while replayCatchUp is awaited — blocks overlapping offers/retries. */
  let catchupInFlight = false;
  let catchupRetryTimer = null;
  let catchupOfferTimer = null;
  let catchupRequestStartedAt = 0;
  let catchupRetryAttempt = 0;
  let broadcastCatchupTimer = null;
  const pendingPresentationJoinTicks = new Set();
  let liveStartKey = '';
  let messageSeq = 0;
  let lagTimer = null;
  let bootstrapTimer = null;
  let discoveryTimer = null;
  let discoverThenStartTimer = null;
  const joinedLobbies = new Set();
  let lastDiscoveryStatus = '';
  // Registry of live matches heard via broadcast presence, keyed by matchId.
  // Host and spectators all announce the same matchId with different active
  // counts, so we keep the MAX active count (the host's view) per match.
  const liveMatches = new Map();
  /** matchId -> Set<userId> everyone who has announced that live match */
  const matchAnnouncers = new Map();
  /** userIds seen in the current match lobby (player_join / player_rejoin). */
  const lobbyPeers = new Set();
  /** @type {Map<string, number>} userId -> last nudge timestamp */
  const lastNudgeAt = new Map();
  /** @type {Map<string, string>} userId -> role from last broadcast presence */
  const peerPresenceRole = new Map();
  const NUDGE_COOLDOWN_MS = 6000;
  /** @type {Set<string>} live players already attempted for catch-up RTC */
  const dialTargetsTried = new Set();
  let connectFallbackTimer = null;
  let connectFallbackFor = null;
  let dialSwitchBusy = false;
  /** Canonical king / first live announcer we followed — stable dial target for spectators. */
  let matchHostUserId = null;
  /** Spectator may only dial one peer at a time until connected or fallback. */
  let activeDialTarget = null;
  // Last logged presence signature per peer, so DEBUG only prints on change.
  const presenceLogSig = new Map();

  /** Observer fan-out tree (king authoritative; peers mirror assignments). */
  const observerTree = createObserverTree();
  let assignedSponsorId = null;
  let observerDepth = 0;
  let offerEpoch = 0;
  let offerExpandSteps = 0;
  let offerStartedAt = 0;
  /** @type {string[]} */
  let offerEligible = [];
  let localOfferEligible = false;
  let offerExpandTimer = null;
  let lastCheckpointTickPublished = 0;
  const checkpointAssembler = createChunkAssembler();
  const ledgerAssembler = createLedgerAssembler();
  /** Incoming catch-up pieces keyed by requestId. */
  const pendingCatchupParts = new Map();

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
      activeSlots: matchStartSlots.length ? [...matchStartSlots] : activePlayerIds(roster),
      armyPerSide,
      startKey: liveStartKey,
      tick: session?.confirmedTick ?? 0,
      reset,
    };
  }

  function notifyLiveStart(reset = false) {
    return onLiveStart(liveConfig(reset));
  }

  function notifyPresentationSync(extra = {}) {
    onPresentationSync({ ...liveConfig(false), ...extra });
  }


  let announceTimer = null;
  let pingTimer = null;
  let presencePeers = new Map();
  /** Smoothed worst-peer RTT (ms), null when no live peers. */
  let rttMs = null;
  let pingSeq = 0;
  /** @type {Map<number, { t0: number, peerId: string }>} */
  const pendingPings = new Map();
  /** @type {Map<string, number>} peerId -> last RTT sample */
  const peerRttMs = new Map();

  const PING_INTERVAL_MS = 1000;
  const PING_STALE_MS = 5000;

  function refreshRttFromPeers() {
    const peers = connectedPeerIds();
    for (const id of [...peerRttMs.keys()]) {
      if (!peers.includes(id)) peerRttMs.delete(id);
    }
    if (!peers.length) {
      rttMs = null;
      return;
    }
    let worst = 0;
    let any = false;
    for (const peerId of peers) {
      const sample = peerRttMs.get(peerId);
      if (sample == null) continue;
      any = true;
      if (sample > worst) worst = sample;
    }
    rttMs = any ? worst : null;
  }

  function pumpPing() {
    if (phase !== SHARD_PHASE.LIVE) {
      rttMs = null;
      pendingPings.clear();
      peerRttMs.clear();
      return;
    }
    const peers = connectedPeerIds();
    if (!peers.length) {
      rttMs = null;
      pendingPings.clear();
      peerRttMs.clear();
      return;
    }
    const now = performance.now();
    for (const [id, pending] of pendingPings) {
      if (now - pending.t0 > PING_STALE_MS) pendingPings.delete(id);
    }
    for (const peerId of peers) {
      const id = ++pingSeq;
      pendingPings.set(id, { t0: now, peerId });
      sendPeer(peerId, { type: MSG.PING, id, matchId });
    }
  }

  function handlePingMsg(msg, fromPeerId) {
    if (!fromPeerId || msg?.id == null) return;
    sendPeer(fromPeerId, { type: MSG.PONG, id: msg.id, matchId });
  }

  function handlePongMsg(msg, fromPeerId) {
    if (msg?.id == null) return;
    const pending = pendingPings.get(msg.id);
    if (!pending) return;
    pendingPings.delete(msg.id);
    const sample = performance.now() - pending.t0;
    const peerId = fromPeerId || pending.peerId;
    if (peerId) peerRttMs.set(peerId, sample);
    refreshRttFromPeers();
  }

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
        role,
        appState,
        v: KOTH_PROTOCOL_VERSION,
        peers: connectedPeerIds(),
        sponsorId: assignedSponsorId,
        observerDepth,
        offerEpoch: offerEpoch || undefined,
        offerEligible: offerEligible.length ? offerEligible : undefined,
        checkpointTick: session?.getCachedCheckpoint?.()?.tick || lastCheckpointTickPublished || undefined,
        ...extra,
      },
      BROADCAST,
    );
  }

  function livePlayerUserIds() {
    const ids = [];
    for (const s of roster) {
      if (s.state === 'active' && s.userId) ids.push(s.userId);
    }
    if (role === 'player' && localUserId && !ids.some((id) => userIdsMatch(id, localUserId))) {
      ids.push(localUserId);
    }
    return ids;
  }

  function isKing() {
    const hostId = rosterHostUserId();
    return !!(hostId && userIdsMatch(localUserId, hostId));
  }

  function applySponsorAssignment(userId, sponsorId, depth) {
    if (!userId) return;
    upsertNode(observerTree, userId, {
      role: 'observer',
      sponsorId: sponsorId ?? null,
      depth: depth ?? (sponsorId ? 1 : 0),
    });
    if (sponsorId) {
      const list = observerTree.childrenOf.get(sponsorId) ?? [];
      if (!list.includes(userId)) {
        list.push(userId);
        observerTree.childrenOf.set(sponsorId, list);
      }
      upsertNode(observerTree, sponsorId, {});
    }
    if (userIdsMatch(userId, localUserId)) {
      assignedSponsorId = sponsorId;
      observerDepth = depth ?? (sponsorId ? 1 : 0);
    }
  }

  function kingAssignObserver(observerUserId) {
    if (!isKing() || !observerUserId || userIdsMatch(observerUserId, localUserId)) return null;
    for (const pid of livePlayerUserIds()) {
      upsertNode(observerTree, pid, { role: 'player', depth: 0, sponsorId: null, caughtUp: true });
    }
    const node = assignSponsor(observerTree, livePlayerUserIds(), observerUserId);
    if (!node?.sponsorId) return node;
    const msg = {
      type: MSG.SPONSOR_ASSIGN,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      userId: observerUserId,
      sponsorId: node.sponsorId,
      depth: node.depth,
    };
    sendAll(msg);
    return node;
  }

  function noteObserverCaughtUp(userId) {
    if (!userId) return;
    upsertNode(observerTree, userId, {
      role: userIdsMatch(userId, localUserId) && role === 'player' ? 'player' : 'observer',
      caughtUp: true,
      joinedAt: observerTree.nodes.get(userId)?.joinedAt ?? Date.now(),
    });
    if (isKing() && !userIdsMatch(userId, localUserId)) {
      const existing = observerTree.nodes.get(userId);
      if (!existing?.sponsorId) kingAssignObserver(userId);
      refreshSlotOffer();
    }
  }

  function refreshSlotOffer() {
    if (!isKing() || phase !== SHARD_PHASE.LIVE) return;
    const active = countActive(roster);
    if (active >= MAX_ACTIVE_PLAYERS) {
      endSlotOffer('full');
      return;
    }
    if (!offerEpoch) {
      offerEpoch = Date.now();
      offerExpandSteps = 0;
      offerStartedAt = Date.now();
    }
    offerEligible = offerEligibleUserIds(observerTree, offerExpandSteps);
    sendAll({
      type: MSG.SLOT_OFFER,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      offerEpoch,
      eligible: offerEligible,
      expandSteps: offerExpandSteps,
      activeCount: active,
    });
    applyLocalOfferState(offerEpoch, offerEligible);
    scheduleOfferExpand();
  }

  function scheduleOfferExpand() {
    if (offerExpandTimer) clearTimeout(offerExpandTimer);
    if (!isKing() || countActive(roster) >= MAX_ACTIVE_PLAYERS) return;
    offerExpandTimer = setTimeout(() => {
      offerExpandTimer = null;
      if (!isKing() || countActive(roster) >= MAX_ACTIVE_PLAYERS) return;
      offerExpandSteps += 1;
      refreshSlotOffer();
    }, OFFER_EXPAND_MS);
  }

  function endSlotOffer(reason = 'filled') {
    if (offerExpandTimer) {
      clearTimeout(offerExpandTimer);
      offerExpandTimer = null;
    }
    const endedEpoch = offerEpoch;
    offerEpoch = 0;
    offerExpandSteps = 0;
    offerEligible = [];
    localOfferEligible = false;
    if (endedEpoch) {
      sendAll({
        type: MSG.SLOT_OFFER_END,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        offerEpoch: endedEpoch,
        reason,
      });
    }
    if (
      role === 'spectator' &&
      (appState === KOTH_APP_STATE.QUEUED || appState === KOTH_APP_STATE.SPECTATOR) &&
      catchUpReady
    ) {
      onStatus(reason === 'full' ? 'Match full — spectating' : 'Seat claimed — spectating');
    }
  }

  function applyLocalOfferState(epoch, eligible) {
    offerEpoch = epoch | 0;
    offerEligible = Array.isArray(eligible) ? [...eligible] : [];
    localOfferEligible = offerEligible.some((id) => userIdsMatch(id, localUserId));
    if (role === 'spectator' && catchUpReady && !pendingLocalJoin) {
      if (countActive(roster) >= MAX_ACTIVE_PLAYERS) {
        appState = KOTH_APP_STATE.QUEUED;
        onStatus('Match full — waiting for a seat…');
      } else if (localOfferEligible) {
        appState = KOTH_APP_STATE.SPECTATOR;
        onStatus(
          observerDepth > 1
            ? `Seat offered (L${observerDepth}) — J to claim`
            : 'Seat offered — J to claim',
        );
      } else {
        appState = KOTH_APP_STATE.QUEUED;
        onStatus(
          observerDepth > 0
            ? `Waiting for offer (L${observerDepth})…`
            : 'Waiting for seat offer…',
        );
      }
      emitShard();
    }
  }

  function childObserverIds() {
    return observerTree.childrenOf.get(localUserId) ?? [];
  }

  function isAssignedChild(userId) {
    return childObserverIds().some((id) => userIdsMatch(id, userId));
  }

  function canServeCatchUpFor(userId) {
    if (!userId || userIdsMatch(userId, localUserId)) return false;
    if (role === 'player' && localPlayerId >= 0) {
      // Players only serve their L1 child (or anyone still dialing us pre-assign).
      if (isAssignedChild(userId)) return true;
      const node = observerTree.nodes.get(userId);
      return !node?.sponsorId || userIdsMatch(node.sponsorId, localUserId);
    }
    if (role === 'spectator' && catchUpReady) {
      return isAssignedChild(userId);
    }
    return false;
  }

  async function maybePublishCheckpoint(tick) {
    if (role !== 'player' || !session) return;
    if (tick < CHECKPOINT_INTERVAL_TICKS) return;
    if (tick % CHECKPOINT_INTERVAL_TICKS !== 0) return;
    if (tick <= lastCheckpointTickPublished) return;
    try {
      const exported = await session.exportCheckpoint();
      lastCheckpointTickPublished = exported.tick | 0;
      if (isKing()) {
        sendAll({
          type: MSG.CHECKPOINT_META,
          v: KOTH_PROTOCOL_VERSION,
          matchId,
          tick: exported.tick,
          checksum: exported.checksum,
        });
      }
      // Push checkpoint blob to L1 children only.
      for (const childId of childObserverIds()) {
        const peerId = connectedPeerIds().find((pid) =>
          userIdsMatch(peerUserIds.get(pid) ?? pid, childId),
        );
        if (!peerId) continue;
        sendCheckpointToPeer(peerId, exported.checkpoint, exported.checksum, exported.tick);
      }
    } catch (err) {
      console.warn('[KOTH] checkpoint export failed', err);
    }
  }

  function sendCheckpointToPeer(peerId, checkpoint, checksum, tick) {
    const transferId = `cp:${matchId}:${tick}:${localUserId}`;
    const packed = packCheckpointChunks(checkpoint, transferId);
    for (let i = 0; i < packed.chunks.length; i++) {
      sendPeer(peerId, {
        type: MSG.CHECKPOINT_CHUNK,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        transferId,
        index: i,
        total: packed.total,
        text: packed.chunks[i],
        tick,
        checksum,
      });
    }
  }

  function shardLobbyName(id = matchId) {
    return `${LOBBY}:${id}`;
  }

  function announcerCount(id) {
    const set = matchAnnouncers.get(id);
    let n = 0;
    if (set) {
      for (const uid of set) {
        if (peerPresenceRole.get(uid) === 'spectator') continue;
        n++;
      }
    }
    // Presence is not echoed to the sender, so we never appear in our own
    // matchAnnouncers set. Count a local live player or the match tips every
    // simultaneous solo-king comparison toward the peer (mutual yield).
    if (
      id === matchId &&
      localUserId &&
      phase === SHARD_PHASE.LIVE &&
      role === 'player' &&
      peerPresenceRole.get(localUserId) !== 'spectator'
    ) {
      n++;
    }
    return n;
  }

  /** Higher return value = better match to join. */
  function compareLiveMatches(a, b) {
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    if (a.tick !== b.tick) return a.tick - b.tick;
    const announcerDelta = announcerCount(a.matchId) - announcerCount(b.matchId);
    if (announcerDelta !== 0) return announcerDelta;
    if (a.matchId === b.matchId) return 0;
    return a.matchId < b.matchId ? 1 : -1;
  }

  // Multi-army ghosts from stale tabs often keep an old activeCount but stop
  // advancing tick — deprioritize them so a live solo king wins discovery.
  function isStaleGhostMatch(m, now = Date.now()) {
    const tickAge = now - (m.lastTickAt ?? m.ts);
    if (m.activeCount >= 2) {
      return m.tick < 10 || tickAge > 6000;
    }
    // Solo-live stale tab still announcing an abandoned match.
    if (m.activeCount === 1 && m.tick > 0 && tickAge > 8000) return true;
    return false;
  }

  function leaveShardLobby(lobby) {
    if (!lobby || lobby === MATCHMAKING_LOBBY) return;
    if (!joinedLobbies.has(lobby)) return;
    joinedLobbies.delete(lobby);
    p2p?.leaveMatchLobby?.(lobby);
  }

  // RTC signaling must target one match lobby — leaving stale ones prevents
  // requestMatch/player_rejoin from fanning out to abandoned matches.
  function switchToMatchLobby(nextMatchId) {
    const nextLobby = shardLobbyName(nextMatchId);
    lobbyPeers.clear();
    activeDialTarget = null;
    for (const lobby of [...joinedLobbies]) {
      if (lobby === MATCHMAKING_LOBBY || lobby === nextLobby) continue;
      if (DEBUG_KOTH) console.info('[KOTH] leave lobby', lobby.slice(LOBBY.length + 1));
      leaveShardLobby(lobby);
    }
  }

  // Additive: a client stays in the matchmaking lobby AND any match lobby it
  // belongs to. `autoMatch:false` joins a discovery-only lobby (no WebRTC).
  function joinLobby(lobby, autoMatch = true) {
    if (!p2p?.joinMatchLobby || !lobby) return;
    if (joinedLobbies.has(lobby)) return;
    joinedLobbies.add(lobby);
    p2p.joinMatchLobby(lobby, { autoMatch });
  }

  // The global discovery lobby every client sits in from boot. It only relays
  // presence so a client can find the actual match lobby — it never sets up P2P.
  // RTC is established exclusively inside the real match lobby.
  function joinMatchmakingLobby() {
    joinLobby(MATCHMAKING_LOBBY, false);
  }

  // The actual match lobby — this is where P2P/RTC is established. Joined in
  // addition to the discovery lobby.
  function joinShardLobby() {
    joinMatchmakingLobby();
    joinLobby(shardLobbyName(), true);
  }

  function noteMatchAnnouncer(id, userId) {
    if (!id || !userId || userId === localUserId) return;
    if (peerPresenceRole.get(userId) === 'spectator') {
      presencePeers.set(userId, userId);
      return;
    }
    let set = matchAnnouncers.get(id);
    if (!set) {
      set = new Set();
      matchAnnouncers.set(id, set);
    }
    set.add(userId);
    presencePeers.set(userId, userId);
  }

  function recordLiveMatch(data) {
    if (!data?.matchId || data.phase !== SHARD_PHASE.LIVE) return;
    if (data.from) noteMatchAnnouncer(data.matchId, data.from);
    const now = Date.now();
    const active = data.activeCount ?? 0;
    const prev = liveMatches.get(data.matchId);
    const tick = data.tick ?? 0;
    if (!prev) {
      liveMatches.set(data.matchId, {
        matchId: data.matchId,
        from: data.from ?? null,
        activeCount: active,
        tick,
        ts: now,
        lastTickAt: tick > 0 ? now : now,
      });
      return;
    }
    prev.ts = now;
    if (tick > prev.tick) {
      prev.tick = tick;
      prev.lastTickAt = now;
    }
    // Keep the strongest announcer as the peer to connect to (the host reports
    // the highest active count; spectators report 0).
    if (active >= prev.activeCount) {
      prev.activeCount = active;
      if (data.from) prev.from = data.from;
    } else if (!prev.from && data.from) {
      prev.from = data.from;
    }
  }

  // Best live match to belong to: most active armies, then highest tick (live
  // sim beats frozen ghost tabs), then most announcers, then lowest matchId.
  function bestLiveMatch() {
    const now = Date.now();
    let best = null;
    let bestFallback = null;
    for (const [id, m] of [...liveMatches]) {
      if (now - m.ts > LIVE_MATCH_TTL_MS) {
        liveMatches.delete(id);
        matchAnnouncers.delete(id);
        continue;
      }
      if (!m.from) continue;
      if (isStaleGhostMatch(m, now)) {
        if (!bestFallback || compareLiveMatches(m, bestFallback) > 0) bestFallback = m;
        continue;
      }
      if (!best || compareLiveMatches(m, best) > 0) best = m;
    }
    return best ?? bestFallback;
  }

  // Publish our own live match into the registry. Clients never receive their
  // own presence broadcast, so without this a solo king has no `current` entry
  // and convergeToBestMatch used to treat every peer solo match as stronger —
  // both kings abandoned into spectator at once (mutual yield).
  function noteSelfLiveMatch() {
    if (!matchId || !localUserId || phase !== SHARD_PHASE.LIVE) return;
    if (role !== 'player') return;
    const now = Date.now();
    const tick = session?.confirmedTick ?? 0;
    const active = countActive(roster);
    const prev = liveMatches.get(matchId);
    if (!prev) {
      liveMatches.set(matchId, {
        matchId,
        from: localUserId,
        activeCount: active,
        tick,
        ts: now,
        lastTickAt: now,
      });
      return;
    }
    prev.ts = now;
    prev.from = localUserId;
    prev.activeCount = Math.max(prev.activeCount, active);
    if (tick >= prev.tick) {
      prev.tick = tick;
      prev.lastTickAt = now;
    }
  }

  // Move onto the strongest known live match unless we are already an
  // authoritative multi-army host. Works for solo kings AND spectators, so a
  // peer stranded on a host that has since yielded re-converges to the real one.
  function convergeToBestMatch() {
    if (phase !== SHARD_PHASE.LIVE) return false;
    const myActive = role === 'spectator' ? 0 : countActive(roster);
    if (role === 'player' && myActive >= MIN_LIVE_PLAYERS) return false;
    // Never tear down a live match that already has a P2P link or running sim.
    if (role === 'player' && connectedPeerIds().length > 0) return false;
    if (role === 'player' && (session?.confirmedTick ?? 0) > 0) return false;
    if (role === 'player') noteSelfLiveMatch();
    const best = bestLiveMatch();
    if (!best || !best.from || best.matchId === matchId) return false;
    // Synthesize a local entry when the registry only has peer matches (we never
    // hear our own presence). Equal activeCount then falls through to tick /
    // announcer / matchId ordering so exactly one simultaneous solo king yields.
    const current = liveMatches.get(matchId) ?? {
      matchId,
      from: localUserId,
      activeCount: myActive,
      tick: session?.confirmedTick ?? 0,
      ts: Date.now(),
      lastTickAt: Date.now(),
    };
    const stronger =
      best.activeCount > myActive ||
      (best.activeCount === myActive && compareLiveMatches(best, current) > 0);
    if (!stronger) return false;
    if (DEBUG_KOTH) {
      console.info('[KOTH] converge', {
        mine: shortId(matchId),
        best: shortId(best.matchId),
        bestActive: best.activeCount,
        myActive,
        role,
      });
    }
    onStatus(`Converging to match …${shortId(best.matchId)}`);
    return followLivePresence({ matchId: best.matchId, from: best.from, phase: SHARD_PHASE.LIVE });
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

  function cancelDiscoverStart() {
    if (discoverThenStartTimer) {
      clearTimeout(discoverThenStartTimer);
      discoverThenStartTimer = null;
    }
  }

  // Stagger solo-match creation so two tabs pressing Start near-simultaneously
  // don't both miss each other's presence and spawn separate matches.
  function discoveryDelayMs() {
    let h = 0;
    const id = localUserId ?? '';
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return MATCH_DISCOVERY_MS + (Math.abs(h) % MATCH_DISCOVERY_MS);
  }

  function followLivePresence(presence) {
    if (!presence?.matchId) return false;
    if (presence.matchId === matchId && phase === SHARD_PHASE.LIVE && role === 'spectator') {
      if (presence.from) noteMatchAnnouncer(presence.matchId, presence.from);
      switchToMatchLobby(matchId);
      scheduleMatchLobbyConnect(presence.matchId);
      return true;
    }
    // Live players with an active link or sim never abandon via follow/converge.
    if (role === 'player' && phase === SHARD_PHASE.LIVE) {
      if (connectedPeerIds().length > 0) return false;
      if ((session?.confirmedTick ?? 0) > 0) return false;
    }
    cancelDiscoverStart();
    const abandoningSolo = phase === SHARD_PHASE.LIVE && role === 'player';
    const prevMatchId = matchId;
    matchId = presence.matchId;
    if (prevMatchId !== matchId) {
      activeCatchupRequestId = '';
      clearCatchupOfferTimer();
      resetDialState();
      switchToMatchLobby(matchId);
    }
    phase = SHARD_PHASE.LIVE;
    appState = KOTH_APP_STATE.SPECTATOR;
    role = 'spectator';
    catchUpReady = false;
    liveStartKey = '';
    roster = createEmptyRoster();
    if (presence.from) {
      matchHostUserId = presence.from;
      seedHostRosterIfSpectating(presence.from);
    }
    localPlayerId = -1;
    joinShardLobby();
    emitShard();
    broadcastPresence();
    session?.setLocalPlayerId?.(-1);
    session?.setRole?.('spectator');
    if (abandoningSolo) {
      if (session) session.pauseLockstep = true;
      if (bootstrapTimer) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
      }
    }
    notifyPresentationSync({
      mode: 'koth',
      role: 'spectator',
      localPlayerId: -1,
      appState,
      reset: false,
      inputEnabled: false,
    });
    if (DEBUG_KOTH) {
      console.info('[KOTH] following live presence', {
        matchId: shortId(matchId),
        from: shortId(presence.from),
        abandoningSolo,
      });
    }
    if (presence.from) noteMatchAnnouncer(presence.matchId, presence.from);
    onStatus(`Connecting to live match …${shortId(matchId)}`);
    scheduleMatchLobbyConnect(presence.matchId);
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

  function sendBroadcastMsg(msg) {
    const stamped = withMessageId(msg);
    rememberMessageId(stamped._mid);
    p2p?.broadcast?.(stamped, BROADCAST);
  }

  function sendAll(msg) {
    const stamped = withMessageId(msg);
    rememberMessageId(stamped._mid);
    if (connectedPeerIds().length > 0) p2p?.sendData?.(stamped);
    // Server-relay fallback for peers that could not complete WebRTC (common on
    // 3+ tabs same machine). Rare control messages only — not tick spam.
    if (
      msg.type === MSG.JOIN_ACCEPT ||
      msg.type === MSG.JOIN_READY ||
      msg.type === MSG.MATCH_SNAPSHOT ||
      msg.type === MSG.MATCH_RESET ||
      msg.type === MSG.TICK_CONFIRM ||
      msg.type === MSG.COMMAND_FRAME ||
      (msg.type === MSG.JOIN_INTENT && connectedPeerIds().length === 0)
    ) {
      sendBroadcastMsg(stamped);
    }
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

  function isMatchLobbyReady(id = matchId) {
    return p2p?.isMatchLobbyReady?.(shardLobbyName(id)) === true;
  }

  function clearConnectFallbackTimer() {
    if (connectFallbackTimer) {
      clearTimeout(connectFallbackTimer);
      connectFallbackTimer = null;
    }
    connectFallbackFor = null;
  }

  function resetDialState() {
    dialTargetsTried.clear();
    activeDialTarget = null;
    clearConnectFallbackTimer();
  }

  function wasDialTried(userId) {
    for (const t of dialTargetsTried) {
      if (userIdsMatch(t, userId)) return true;
    }
    return false;
  }

  function markDialTried(userId) {
    if (userId) dialTargetsTried.add(userId);
  }

  function pickNextUntriedTarget(id = matchId) {
    for (const uid of pickConnectTargets(id)) {
      if (!wasDialTried(uid)) return uid;
    }
    return null;
  }

  function tryNextSponsor(id = matchId, failedUserId = null) {
    if (role !== 'spectator' || catchUpReady || phase !== SHARD_PHASE.LIVE || matchId !== id) {
      return false;
    }
    if (hasLiveSponsorLink()) return false;
    if (dialSwitchBusy) return false;
    dialSwitchBusy = true;
    setTimeout(() => {
      dialSwitchBusy = false;
    }, 400);
    const failId = failedUserId ?? activeDialTarget;
    if (failId) markDialTried(failId);
    activeDialTarget = null;
    clearConnectFallbackTimer();
    const next = pickNextUntriedTarget(id);
    if (!next) {
      if (DEBUG_KOTH) console.info('[KOTH] all sponsors tried — cooling down before retry');
      scheduleBroadcastCatchup(0);
      scheduleFullDialRetry(id);
      return false;
    }
    activeDialTarget = next;
    if (DEBUG_KOTH) {
      console.info('[KOTH] connect fallback — trying next sponsor', {
        to: shortId(next),
        failed: failId ? shortId(failId) : null,
        tried: dialTargetsTried.size,
      });
    }
    nudgePeerConnect(next);
    scheduleConnectFallback(id, next);
    return true;
  }

  function scheduleFullDialRetry(id = matchId) {
    clearConnectFallbackTimer();
    connectFallbackTimer = setTimeout(() => {
      connectFallbackTimer = null;
      connectFallbackFor = null;
      if (phase !== SHARD_PHASE.LIVE || matchId !== id || catchUpReady) return;
      if (hasLiveSponsorLink()) return;
      dialTargetsTried.clear();
      activeDialTarget = null;
      if (DEBUG_KOTH) console.info('[KOTH] dial retry cycle — starting over');
      connectToMatchPeers(id);
    }, 15000);
  }

  function scheduleConnectFallback(id = matchId, target = activeDialTarget) {
    if (!target || (connectFallbackTimer && connectFallbackFor && userIdsMatch(connectFallbackFor, target))) {
      return;
    }
    clearConnectFallbackTimer();
    connectFallbackFor = target;
    connectFallbackTimer = setTimeout(() => {
      connectFallbackTimer = null;
      connectFallbackFor = null;
      if (phase !== SHARD_PHASE.LIVE || matchId !== id || catchUpReady) return;
      if (connectedPeerIds().length > 0 || isConnectedTo(target)) return;
      if (DEBUG_KOTH) console.info('[KOTH] dial timeout', { to: shortId(target) });
      tryNextSponsor(id, target);
    }, 14000);
  }

  /** Ordered dial targets. Observers dial assigned sponsor (then fallbacks).
   * Live players dial other live players only. */
  function pickConnectTargets(id = matchId) {
    const targets = [];
    const add = (uid) => {
      if (!uid || userIdsMatch(uid, localUserId)) return;
      if (!targets.some((t) => userIdsMatch(t, uid))) targets.push(uid);
    };

    if (role === 'spectator') {
      if (assignedSponsorId) add(assignedSponsorId);
      // Fallback: other observers that can sponsor (caught-up), then players.
      for (const node of listObserversByJoin(observerTree)) {
        if (node.caughtUp && node.depth >= 1) add(node.userId);
      }
      const live = liveMatches.get(id);
      const announcers = matchAnnouncers.get(id);
      if (announcers) {
        for (const uid of [...announcers].sort()) {
          if (peerPresenceRole.get(uid) === 'spectator') continue;
          add(uid);
        }
      }
      add(matchHostUserId);
      add(roster[0]?.userId);
      add(live?.from);
      return targets;
    }

    // Live players: mesh with other players only (never dial observers).
    for (const uid of livePlayerUserIds()) add(uid);
    const announcers = matchAnnouncers.get(id);
    if (announcers) {
      for (const uid of [...announcers].sort()) {
        if (peerPresenceRole.get(uid) === 'spectator') continue;
        add(uid);
      }
    }
    add(matchHostUserId);
    return targets;
  }

  function isInLobby(userId) {
    for (const uid of lobbyPeers) {
      if (userIdsMatch(uid, userId)) return true;
    }
    return false;
  }

  function isConnectedTo(userId) {
    if (!userId) return false;
    return connectedPeerIds().some((pid) => userIdsMatch(pid, userId));
  }

  /** True when this user can answer SNAPSHOT_REQUEST for us (sponsor tree). */
  function userCanSponsorCatchUp(userId) {
    if (!userId) return false;
    if (userIdsMatch(userId, localUserId)) {
      return (role === 'player' && localPlayerId >= 0) || (role === 'spectator' && catchUpReady);
    }
    if (assignedSponsorId && userIdsMatch(userId, assignedSponsorId)) return true;
    if (peerPresenceRole.get(userId) === 'player') {
      // Only before we have an assignment, or if they are our sponsor.
      if (!assignedSponsorId) return true;
      return userIdsMatch(userId, assignedSponsorId);
    }
    // Caught-up observers may sponsor deeper observers.
    const node = observerTree.nodes.get(userId);
    if (node?.role === 'observer' && node.caughtUp) {
      if (assignedSponsorId && userIdsMatch(userId, assignedSponsorId)) return true;
      if (!assignedSponsorId && observerDepth > 1) return true;
    }
    if (peerPresenceRole.get(userId) === 'spectator') {
      return !!(assignedSponsorId && userIdsMatch(userId, assignedSponsorId));
    }
    for (const pid of connectedPeerIds()) {
      if (!userIdsMatch(peerUserIds.get(pid) ?? pid, userId)) continue;
      if (!readyPeerIds.has(pid)) continue;
      const slot = slotForUser(roster, userId);
      if (slot?.state === 'active' || slot?.state === 'reserved') {
        return !assignedSponsorId || userIdsMatch(userId, assignedSponsorId);
      }
    }
    const live = liveMatches.get(matchId);
    if (
      live?.from &&
      userIdsMatch(live.from, userId) &&
      !isStaleGhostMatch(live) &&
      Date.now() - (live.lastTickAt ?? live.ts) < LIVE_MATCH_TTL_MS
    ) {
      return !assignedSponsorId || userIdsMatch(userId, assignedSponsorId);
    }
    return false;
  }

  function peerCanSponsorCatchUp(peerId) {
    return userCanSponsorCatchUp(peerUserIds.get(peerId) ?? peerId);
  }

  function messageFromLivePlayer(msg) {
    if (!msg?.from) return false;
    if (peerPresenceRole.get(msg.from) === 'player') return true;
    if (peerPresenceRole.get(msg.from) === 'spectator') return false;
    const slot = slotForUser(msg.roster ?? roster, msg.from);
    return slot?.state === 'active' || slot?.state === 'reserved';
  }

  function hasLiveSponsorLink() {
    return connectedPeerIds().some((pid) => peerCanSponsorCatchUp(pid));
  }

  // Observers dial their sponsor. Live players dial each other (higher userId
  // initiates) but never initiate to observers.
  function shouldInitiatePeerConnect(userId, fromLobbyJoin = false) {
    if (!localUserId || userIdsMatch(userId, localUserId)) return false;
    if (role === 'spectator') {
      if (catchUpReady) {
        // Caught-up observers dial assigned children? Children dial us.
        return false;
      }
      if (assignedSponsorId) return userIdsMatch(userId, assignedSponsorId);
      return userCanSponsorCatchUp(userId);
    }
    if (role === 'player') {
      if (peerPresenceRole.get(userId) === 'spectator') return false;
      if (
        fromLobbyJoin &&
        countActive(roster) >= MIN_LIVE_PLAYERS &&
        peerPresenceRole.get(userId) !== 'player'
      ) {
        return false;
      }
      return localUserId > userId;
    }
    return localUserId > userId;
  }

  function tryConnectPeer(userId, fromLobbyJoin = false) {
    if (!p2p || !userId || userIdsMatch(userId, localUserId)) return;
    presencePeers.set(userId, userId);
    if (phase !== SHARD_PHASE.LIVE) return;
    if (isConnectedTo(userId)) return;
    if (!shouldInitiatePeerConnect(userId, fromLobbyJoin)) return;

    const maxAttempts = role === 'spectator' && !catchUpReady ? 3 : 2;

    const targetMatchId = matchId;
    const lobby = shardLobbyName(targetMatchId);

    const request = (attempt = 0) => {
      if (phase !== SHARD_PHASE.LIVE || matchId !== targetMatchId) return;
      if (isConnectedTo(userId)) return;
      if (!isMatchLobbyReady(targetMatchId)) {
        if (attempt < maxAttempts + 8) setTimeout(() => request(attempt), 400);
        return;
      }
      if (DEBUG_KOTH && attempt === 0) {
        console.info('[KOTH] requestMatch', { to: shortId(userId), lobby: lobby.slice(LOBBY.length + 1) });
      }
      p2p.requestMatch?.(userId, lobby);
      if (attempt < maxAttempts) {
        setTimeout(() => {
          if (!isConnectedTo(userId)) request(attempt + 1);
        }, 1200 + attempt * 1200);
      }
    };

    request();
  }

  /** Dial if we're the initiator; otherwise player_rejoin so the peer dials us. */
  function nudgePeerConnect(userId, fromLobbyJoin = false) {
    if (!userId || userIdsMatch(userId, localUserId)) return;
    if (
      role === 'player' &&
      countActive(roster) >= MIN_LIVE_PLAYERS &&
      peerPresenceRole.get(userId) === 'spectator'
    ) {
      return;
    }
    if (
      role === 'spectator' &&
      (catchUpReady ||
        pendingLocalJoin ||
        appState === KOTH_APP_STATE.JOINING ||
        appState === KOTH_APP_STATE.QUEUED)
    ) {
      return;
    }
    if (isConnectedTo(userId)) return;
    if (role === 'spectator' && !catchUpReady && activeDialTarget && !userIdsMatch(activeDialTarget, userId)) {
      return;
    }
    const now = Date.now();
    const last = lastNudgeAt.get(userId) ?? 0;
    if (now - last < NUDGE_COOLDOWN_MS) return;
    lastNudgeAt.set(userId, now);
    noteMatchAnnouncer(matchId, userId);
    const initiator = shouldInitiatePeerConnect(userId, fromLobbyJoin);
    if (DEBUG_KOTH) {
      console.info('[KOTH] nudge peer', {
        to: shortId(userId),
        inLobby: isInLobby(userId),
        initiator,
        match: shortId(matchId),
        only: activeDialTarget ? shortId(activeDialTarget) : null,
      });
    }
    tryConnectPeer(userId, fromLobbyJoin);
    if (!initiator) p2p?.announcePresence?.(shardLobbyName(matchId));
  }

  function connectToMatchPeers(id = matchId) {
    if (
      role === 'spectator' &&
      (catchUpReady ||
        pendingLocalJoin ||
        appState === KOTH_APP_STATE.JOINING ||
        appState === KOTH_APP_STATE.QUEUED)
    ) {
      return;
    }
    if (hasLiveSponsorLink() && role === 'spectator' && !catchUpReady) {
      clearConnectFallbackTimer();
      activeDialTarget = null;
      return;
    }
    const targets = pickConnectTargets(id);
    if (targets.length === 0) return;

    if (role === 'spectator' && !catchUpReady) {
      if (activeDialTarget && !isConnectedTo(activeDialTarget)) {
        if (!connectFallbackTimer) scheduleConnectFallback(id, activeDialTarget);
        return;
      }
      const target = pickNextUntriedTarget(id) ?? pickConnectTargets(id)[0];
      if (!target) return;
      activeDialTarget = target;
      if (DEBUG_KOTH) {
        console.info('[KOTH] dial sponsor', {
          to: shortId(target),
          host: matchHostUserId ? shortId(matchHostUserId) : null,
          tried: dialTargetsTried.size,
        });
      }
      nudgePeerConnect(target);
      scheduleConnectFallback(id, target);
      return;
    }

    nudgePeerConnect(targets[0]);
    for (let i = 1; i < targets.length; i++) {
      const uid = targets[i];
      setTimeout(() => {
        if (phase !== SHARD_PHASE.LIVE || matchId !== id) return;
        if (!isConnectedTo(uid)) nudgePeerConnect(uid);
      }, 1800 * i);
    }
  }

  function scheduleMatchLobbyConnect(_id = matchId) {
    // connectToMatchPeers runs from onMatchLobbyConnected; retries use scheduleFullDialRetry
  }

  function onMatchLobbyConnected(lobbyName) {
    if (phase !== SHARD_PHASE.LIVE || lobbyName !== shardLobbyName(matchId)) return;
    if (DEBUG_KOTH) console.info('[KOTH] match lobby ready', lobbyName.slice(LOBBY.length + 1));
    p2p?.announcePresence?.(lobbyName);
    connectToMatchPeers(matchId);
    if (role === 'spectator' && !catchUpReady) scheduleBroadcastCatchup(6000);
  }

  function pumpSpectatorConnect() {
    if (phase !== SHARD_PHASE.LIVE || role !== 'spectator' || catchUpReady) return;
    if (!hasLiveSponsorLink()) connectToMatchPeers();
    const linked = hasLiveSponsorLink();
    if (!linked) {
      const n = matchAnnouncers.get(matchId)?.size ?? 0;
      onStatus(`Connecting to match …${shortId(matchId)}${n ? ` (${n} players heard)` : ''}`);
      return;
    }
    if (!activeCatchupRequestId) {
      const sponsor = pickSponsorPeerId();
      if (sponsor) scheduleCatchupAfterConnect(sponsor);
      else scheduleBroadcastCatchup(0);
    }
  }

  function setDiscoveryStatus(msg) {
    if (lastDiscoveryStatus === msg) return;
    lastDiscoveryStatus = msg;
    onStatus(msg);
  }

  function pumpDiscovery() {
    if (!p2p || !localUserId) return;
    if (phase === SHARD_PHASE.LIVE) p2p.announcePresence?.(shardLobbyName(matchId));
    else if (appState === KOTH_APP_STATE.MATCHMAKING) p2p.announcePresence?.();
    broadcastPresence();
    // While searching, follow the first live match we hear about instead of
    // waiting for the discovery timer to expire (or spawning a duplicate).
    if (appState === KOTH_APP_STATE.MATCHMAKING && phase !== SHARD_PHASE.LIVE) {
      const found = bestLiveMatch();
      if (found?.matchId && found.from) {
        followLivePresence({ matchId: found.matchId, from: found.from, phase: SHARD_PHASE.LIVE });
        return;
      }
    }
    // Re-settle onto the strongest known match (covers the case where a better
    // match's presence arrived but didn't trigger an immediate follow).
    if (phase === SHARD_PHASE.LIVE && convergeToBestMatch()) return;
    // Mutual-yield safety net: if every peer we know is also a spectator, the
    // lowest userId claims host instead of waiting on catch-up timeouts.
    if (phase === SHARD_PHASE.LIVE && role === 'spectator' && !catchUpReady) {
      tryClaimOrphanMatch();
    }
    pumpSpectatorConnect();
    if (phase === SHARD_PHASE.LIVE && role === 'player') {
      for (const uid of matchAnnouncers.get(matchId) ?? []) {
        if (uid && !userIdsMatch(uid, localUserId) && !isConnectedTo(uid)) {
          nudgePeerConnect(uid);
        }
      }
      for (const uid of lobbyPeers) {
        if (uid && !userIdsMatch(uid, localUserId) && !isConnectedTo(uid)) nudgePeerConnect(uid);
      }
    }
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
      armyPerSide,
      reset: true,
    });
    emitShard();
    broadcastPresence();
  }

  function reconcileMatchId(incomingMatchId, incomingPhase = SHARD_PHASE.SANDBOX) {
    if (!incomingMatchId || incomingMatchId === matchId) return true;
    if (phase !== SHARD_PHASE.SANDBOX) return false;
    if (appState === KOTH_APP_STATE.PRIVATE_SANDBOX) return false;

    const joiningLive = incomingPhase === SHARD_PHASE.LIVE;
    const nextMatchId = joiningLive ? incomingMatchId : [matchId, incomingMatchId].sort()[0];
    if (nextMatchId !== matchId) {
      matchId = nextMatchId;
      seed = hashSeed(matchId);
      liveStartKey = '';
      roster = createEmptyRoster();
      if (joiningLive) {
        // The match is already in progress: join as a spectator and catch up —
        // NEVER claim a starting slot. Claiming slot 0 here (and then falling
        // through to maybeStartLive) makes a late joiner elect itself canonical
        // and broadcast a conflicting roster, so two peers both believe they own
        // player 0 and every cross-peer tick confirm is rejected (split-brain).
        phase = SHARD_PHASE.LIVE;
        role = 'spectator';
        appState = KOTH_APP_STATE.SPECTATOR;
        localPlayerId = -1;
        catchUpReady = false;
        session?.setLocalPlayerId?.(-1);
        session?.setRole?.('spectator');
        saveMatch({ matchId, userId: localUserId, slot: null });
        joinShardLobby();
        notifyPresentationSync({
          mode: 'koth',
          role: 'spectator',
          localPlayerId: -1,
          appState,
          reset: false,
          inputEnabled: false,
        });
        onStatus(`Found live match …${shortId(matchId)} — catching up`);
      } else {
        roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
        onStatus(`Joined shard …${shortId(matchId)}`);
      }
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
      armyPerSide,
    };
  }

  function pickSponsorPeerId() {
    const peers = connectedPeerIds();
    if (!peers.length) return null;
    const sponsors = peers.filter((pid) => peerCanSponsorCatchUp(pid));
    if (!sponsors.length) return null;
    let h = 0;
    for (let i = 0; i < localUserId.length; i++) h = (h * 31 + localUserId.charCodeAt(i)) | 0;
    return sponsors[Math.abs(h) % sponsors.length];
  }

  /** Live player to request catch-up from — works without a P2P link. */
  function pickSponsorUserId() {
    const linked = pickSponsorPeerId();
    if (linked) return peerUserIds.get(linked) ?? linked;
    for (const uid of pickConnectTargets()) {
      if (userCanSponsorCatchUp(uid)) return uid;
    }
    const liveFrom = liveMatches.get(matchId)?.from;
    if (liveFrom && userCanSponsorCatchUp(liveFrom)) return liveFrom;
    return null;
  }

  function clearBroadcastCatchupTimer() {
    if (broadcastCatchupTimer) {
      clearTimeout(broadcastCatchupTimer);
      broadcastCatchupTimer = null;
    }
  }

  function scheduleBroadcastCatchup(delayMs = 6000) {
    if (broadcastCatchupTimer || catchUpReady || role !== 'spectator') return;
    if (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING || appState === KOTH_APP_STATE.QUEUED) return;
    broadcastCatchupTimer = setTimeout(() => {
      broadcastCatchupTimer = null;
      if (phase !== SHARD_PHASE.LIVE || role !== 'spectator' || catchUpReady) return;
      if (hasLiveSponsorLink()) return;
      if (activeCatchupRequestId) return;
      const sponsor = pickSponsorUserId();
      if (!sponsor) {
        tryClaimOrphanMatch();
        return;
      }
      if (DEBUG_KOTH) console.info('[KOTH] broadcast catch-up', { sponsor: shortId(sponsor) });
      beginCatchup(sponsor, session?.confirmedTick ?? 0);
    }, delayMs);
  }

  function notePlayerConfirm(playerId) {
    playerLastConfirm.set(playerId, performance.now());
  }

  function eventSourcePlayerId() {
    const active = activePlayerIds(roster);
    return active.length ? active[0] : localPlayerId;
  }

  function seedHostRosterIfSpectating(hostUserId) {
    if (phase !== SHARD_PHASE.LIVE || role !== 'spectator' || !hostUserId) return;
    if (countActive(roster) > 0) return;
    roster[0] = { userId: hostUserId, state: 'active', playerId: 0 };
  }

  function resolvePlayerOwner(playerId, claimedUserId = null) {
    const slot = roster[playerId];
    if (
      slot?.playerId === playerId &&
      (slot.state === 'active' || slot.state === 'reserved') &&
      slot.userId
    ) {
      return slot.userId;
    }
    if (playerId === localPlayerId && role === 'player' && localUserId) return localUserId;
    // Catch-up window: presence may seed only the king before SHARD_STATE / SNAPSHOT_OFFER.
    if (!catchUpReady && claimedUserId) {
      if (playerId === 0 && roster[0]?.userId === claimedUserId) return claimedUserId;
      const live = liveMatches.get(matchId);
      if (playerId === 0 && live?.from === claimedUserId) return claimedUserId;
    }
    return null;
  }

  function rosterHostUserId() {
    const king = roster[0];
    if (king?.userId && (king.state === 'active' || king.state === 'reserved')) return king.userId;
    if (role === 'player' && localPlayerId === 0 && localUserId) return localUserId;
    const host = rosterUserIds(roster)[0];
    if (host) return host;
    return null;
  }

  /** Roster payload for catch-up sponsors — never ship an all-empty roster. */
  function authoritativeRoster() {
    if (countActive(roster) > 0) return cloneSlots(roster);
    if (role === 'player' && localPlayerId >= 0 && localUserId) {
      const next = createEmptyRoster();
      next[localPlayerId] = { userId: localUserId, state: 'active', playerId: localPlayerId };
      return next;
    }
    return cloneSlots(roster);
  }

  function userForPlayerId(playerId, claimedUserId = null) {
    return resolvePlayerOwner(playerId, claimedUserId);
  }

  function rosterUserIds(slots) {
    return slots
      .filter((s) => s.state === 'active' && s.userId)
      .map((s) => s.userId)
      .sort();
  }

  function isCanonicalResetSender(msg, nextSlots) {
    // A reset is authored by the host of the match as it stands NOW — the solo
    // king the spectators are already following. That king may not be the lowest
    // userId of the post-reset pair (host is decoupled from player 0), so accept
    // the current roster's host first, then fall back to the incoming roster's
    // host for receivers that have no active roster yet.
    const currentHost = rosterUserIds(roster)[0];
    if (currentHost && msg.from === currentHost) return true;
    const ids = rosterUserIds(nextSlots);
    return ids.length >= 2 && msg.from === ids[0];
  }

  function validateCommandFrame(frame) {
    if (!frame || frame.playerId == null) return false;
    const slot = roster[frame.playerId];
    if (frame.userId && slot?.userId && (slot.state === 'active' || slot.state === 'reserved')) {
      if (userIdsMatch(slot.userId, frame.userId)) return true;
    }
    if (ownsPlayerFrame(roster, frame)) return true;
    if (!catchUpReady && frame?.userId) {
      const owner = resolvePlayerOwner(frame.playerId, frame.userId);
      return owner && userIdsMatch(owner, frame.userId);
    }
    return false;
  }

  function applyLocalRosterSlot() {
    const localSlot = slotForUser(roster, localUserId);
    const activeLocalSlot = localSlot?.state === 'active' ? localSlot : null;
    const wasSpectator = role === 'spectator';
    localPlayerId = activeLocalSlot?.playerId ?? -1;
    role = activeLocalSlot ? 'player' : 'spectator';
    appState = activeLocalSlot ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    session?.setLocalPlayerId?.(localPlayerId);
    session?.setRole?.(role);
    if (wasSpectator && activeLocalSlot) {
      const handoffs = promoteObserverToPlayer(observerTree, localUserId, livePlayerUserIds());
      assignedSponsorId = null;
      observerDepth = 0;
      if (handoffs.length) {
        sendAll({
          type: MSG.SPONSOR_HANDOFF,
          v: KOTH_PROTOCOL_VERSION,
          matchId,
          fromUserId: localUserId,
          assignments: handoffs,
        });
      }
      for (const uid of livePlayerUserIds()) {
        if (!userIdsMatch(uid, localUserId)) nudgePeerConnect(uid);
      }
    }
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
      assignedSponsorId = null;
      observerDepth = 0;
      noteObserverCaughtUp(localUserId);
      onStatus(
        countActive(roster) < MAX_ACTIVE_PLAYERS
          ? 'Eliminated — waiting for seat offer…'
          : 'Eliminated — spectating (match full)',
      );
      if (isKing()) refreshSlotOffer();
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
      armyPerSide,
      reset: true,
    });
  }

  /** Deterministic spawn frame for a live join — buffered locally from JOIN_ACCEPT. */
  function bufferJoinSpawnFrame(msg, eventId) {
    if (!session) return;
    const kingId = roster[0]?.userId ?? rosterHostUserId();
    if (!kingId) return;
    const frame = {
      tick: msg.joinTick,
      playerId: 0,
      commands: [{ type: CMD.SPAWN_SLOT, playerId: msg.playerId }],
      commandId: eventId,
      userId: kingId,
    };
    if (session.bufferRemoteFrame(frame) && DEBUG_KOTH) {
      console.info('[KOTH] buffered join spawn', {
        slot: msg.playerId,
        joinTick: msg.joinTick,
        king: shortId(kingId),
      });
    }
  }

  function commitJoinAtTick(msg) {
    rememberAcceptedJoin(msg);
    pendingPresentationJoinTicks.add(msg.joinTick);
    const eventId = msg.eventId ?? `join:${matchId}:${msg.userId}:${msg.playerId}:${msg.joinTick}`;
    const isKing = role === 'player' && userIdsMatch(localUserId, rosterHostUserId());
    if (isKing) {
      const frame = session?.submitAtTick(
        msg.joinTick,
        { type: CMD.SPAWN_SLOT, playerId: msg.playerId },
        { playerId: eventSourcePlayerId(), commandId: eventId },
      );
      if (frame) {
        frame.userId = userForPlayerId(frame.playerId);
        sendAll({ type: MSG.COMMAND_FRAME, frame });
      } else {
        bufferJoinSpawnFrame(msg, eventId);
      }
    } else {
      // Broadcast-only joiners may never receive COMMAND_FRAME over P2P.
      bufferJoinSpawnFrame(msg, eventId);
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

    // Handoff: reassign our former observer children, join player mesh.
    const handoffs = promoteObserverToPlayer(observerTree, localUserId, livePlayerUserIds());
    assignedSponsorId = null;
    observerDepth = 0;
    if (handoffs.length) {
      sendAll({
        type: MSG.SPONSOR_HANDOFF,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        fromUserId: localUserId,
        assignments: handoffs,
      });
    }
    upsertNode(observerTree, localUserId, {
      role: 'player',
      depth: 0,
      sponsorId: null,
      caughtUp: true,
    });
    // Dial other live players now that we are in the mesh.
    for (const uid of livePlayerUserIds()) {
      if (!userIdsMatch(uid, localUserId)) nudgePeerConnect(uid);
    }

    notifyPresentationSync({
      role: 'player',
      appState,
      localPlayerId,
      inputEnabled: true,
      updateHumanPlayers: true,
    });
    sendAll({
      type: MSG.JOIN_READY,
      matchId,
      userId: localUserId,
      playerId: localPlayerId,
      tick,
    });
    if (DEBUG_KOTH) {
      let armySize = 0;
      const world = session?.state;
      const unitCount = world?.count ?? session?.count ?? 0;
      if (world) {
        for (let i = 0; i < unitCount; i++) {
          if (world.alive[i] && world.owner[i] === localPlayerId) armySize++;
        }
      }
      console.info('[KOTH] promoted to player', {
        playerId: localPlayerId,
        tick,
        simTick: session?.confirmedTick ?? 0,
        unitCount,
        armySize,
        handoffs: handoffs.length,
      });
    }
    onStatus(`Joined match — player ${localPlayerId}`);
    pendingLocalJoin = null;
    localOfferEligible = false;
    emitShard();
    broadcastPresence();
    if (isKing()) refreshSlotOffer();
  }

  function handleJoinReady(msg) {
    if (msg.matchId !== matchId) return;
    if (!msg.userId || msg.playerId == null) return;
    const slot = roster[msg.playerId];
    if (!slot?.userId || !userIdsMatch(slot.userId, msg.userId)) return;
    if (slot.state === 'reserved') {
      roster = activateSlot(roster, msg.playerId, msg.userId).slots;
    } else if (slot.state !== 'active') return;
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

  // RETIRED. The old symmetric "two players present → both reset" election crowned
  // whichever peer was the lowest userId in its own (possibly partial) mesh view,
  // so during a simultaneous cold start two peers could each elect themselves
  // player 0. Match creation now flows through startSoloLive(): exactly one creator
  // goes live alone and every other arrival joins through the spectate→elect→reset
  // pipeline, so two-P0 is structurally impossible.
  function maybeStartLive() {}

  /** When every known participant is a stranded spectator, lowest userId becomes king. */
  function tryClaimOrphanMatch() {
    if (role !== 'spectator' || phase !== SHARD_PHASE.LIVE || catchUpReady) return false;
    if (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING || appState === KOTH_APP_STATE.QUEUED) {
      return false;
    }

    const participants = new Set([localUserId]);
    for (const uid of lobbyPeers) {
      if (uid) participants.add(uid);
    }
    for (const uid of matchAnnouncers.get(matchId) ?? []) {
      if (uid) participants.add(uid);
    }
    const live = liveMatches.get(matchId);
    if (live?.from) participants.add(live.from);
    if (matchHostUserId) participants.add(matchHostUserId);
    // A peer only blocks the claim while they still look like a live player on
    // THIS match. Do not use pickSponsorUserId / userCanSponsorCatchUp — those
    // treat liveMatches.from as a sponsor even after that peer has also yielded
    // to spectator (mutual-yield deadlock). Ignore stale `player` roles once
    // match presence has gone quiet so a dead host can be replaced.
    const liveFresh = live && Date.now() - live.ts <= LIVE_MATCH_TTL_MS;
    for (const uid of participants) {
      if (uid === localUserId) continue;
      if (peerPresenceRole.get(uid) !== 'player') continue;
      if (!liveFresh) continue;
      if (live?.from && userIdsMatch(live.from, uid)) return false;
      if (matchAnnouncers.get(matchId)?.has(uid)) return false;
    }

    const sorted = [...participants].filter(Boolean).sort();
    if (sorted[0] !== localUserId) return false;

    if (DEBUG_KOTH) console.info('[KOTH] orphan match — claiming as host', { matchId: shortId(matchId) });
    void promoteOrphanToHost();
    return true;
  }

  async function promoteOrphanToHost() {
    clearCatchupOfferTimer();
    clearBroadcastCatchupTimer();
    activeCatchupRequestId = '';
    catchupRetryAttempt = 0;
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    matchHostUserId = localUserId;
    localPlayerId = 0;
    role = 'player';
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    catchUpReady = true;
    seed = hashSeed(matchId);
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    liveStartKey = matchStartKey(matchId, roster, seed);
    notePlayerConfirm(0);
    session?.setLocalPlayerId?.(0);
    session?.setRole?.('player');
    saveMatch({ matchId, userId: localUserId, slot: 0 });
    noteSelfLiveMatch();
    await notifyLiveStart(true);
    kickstartLockstep();
    broadcastPresence();
    emitShard();
    notifyPresentationSync({ role: 'player', appState, localPlayerId: 0, inputEnabled: true, reset: true });
    onStatus(`Match live — …${shortId(matchId)} — waiting for challengers`);
  }

  // The lone creator does not wait for a second player. It goes live solo as the
  // host (single active slot, player 0 — the king). Everyone else, including the
  // very next player, discovers this match, spectates, and joins through the
  // normal pipeline; the first join flips solo→2 and resets to a fresh two-army
  // game (see resetForJoin). This is the ONLY path that creates a public match.
  async function startSoloLive() {
    const existing = bestLiveMatch();
    if (existing?.matchId && existing.from && existing.matchId !== matchId) {
      if (DEBUG_KOTH) {
        console.info('[KOTH] solo-live aborted — joining existing match', {
          existing: shortId(existing.matchId),
          mine: shortId(matchId),
        });
      }
      followLivePresence(existing);
      return;
    }
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    matchHostUserId = localUserId;
    localPlayerId = 0;
    role = 'player';
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    seed = hashSeed(matchId);
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    liveStartKey = matchStartKey(matchId, roster, seed);
    catchUpReady = true;
    notePlayerConfirm(0);
    session?.setLocalPlayerId?.(0);
    session?.setRole?.('player');
    saveMatch({ matchId, userId: localUserId, slot: 0 });
    setPhase(SHARD_PHASE.LIVE);
    noteSelfLiveMatch();
    joinShardLobby();
    await notifyLiveStart(true);
    if (DEBUG_KOTH) console.info('[KOTH] solo-live created', { matchId: shortId(matchId) });
    onStatus(`Match live — …${shortId(matchId)} — waiting for challengers`);
    upsertNode(observerTree, localUserId, {
      role: 'player',
      depth: 0,
      sponsorId: null,
      caughtUp: true,
    });
    refreshSlotOffer();
  }

  function handleMatchSnapshot(msg, fromPeerId = null) {
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (!reconcileMatchId(msg.matchId, SHARD_PHASE.LIVE)) return;
    const nextRoster = cloneSlots(msg.roster ?? roster);
    const nextSeed = msg.seed ?? seed;
    const nextKey = msg.startKey ?? matchStartKey(matchId, nextRoster, nextSeed);
    if (!isCanonicalResetSender(msg, nextRoster)) {
      if (DEBUG_KOTH) {
        console.info('[KOTH] match snapshot rejected — sender not canonical host', {
          from: shortId(msg.from),
          currentHost: shortId(rosterUserIds(roster)[0]),
          nextHost: shortId(rosterUserIds(nextRoster)[0]),
        });
      }
      return;
    }
    const localSnapshotSlot = slotForUser(nextRoster, localUserId);
    if (localSnapshotSlot?.state !== 'active') {
      // Late spectators must not apply the tick-0 start snapshot to the visible sim.
      // They need to replay from a live sponsor to the current tick first.
      roster = nextRoster;
      seed = nextSeed;
      if (msg.armyPerSide != null) armyPerSide = msg.armyPerSide | 0;
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
    // Local user is active in the incoming roster and the sender already passed
    // canonical-host validation, so this is a legitimate (re)start — e.g. the
    // solo→2 reset that promotes this spectator into player 1 with a brand-new
    // start key. Adopt it; the old anti-split-brain key bail is now subsumed by
    // isCanonicalResetSender (only the recognized host can author a re-key).
    roster = cloneSlots(msg.roster ?? roster);
    seed = msg.seed ?? seed;
    if (msg.armyPerSide != null) armyPerSide = msg.armyPerSide | 0;
    liveStartKey = nextKey;
    matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
    matchHumanPlayers = msg.humanPlayers ?? [...matchStartSlots];
    applyLocalRosterSlot();
    appState = role === 'player' ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    setPhase(SHARD_PHASE.LIVE);
    catchUpReady = true;
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });
    if (DEBUG_KOTH) console.info('[KOTH] match snapshot adopted — promoted', { localPlayerId, role });
    onStatus(`Synced — player ${localPlayerId}`);
    void notifyLiveStart(true).catch((err) => console.error('[KOTH] live start after snapshot failed', err));
  }

  function handleJoinIntent(msg) {
    // Legacy JOIN_INTENT is ignored — open seats use SLOT_OFFER / SLOT_CLAIM.
    if (DEBUG_KOTH) {
      console.info('[KOTH] join intent ignored (use slot claim)', { from: shortId(msg.userId) });
    }
  }

  // Host-authored reset that turns the solo match into a fresh two-army game.
  // The creator/king keeps player 0 (kingOwner stays the longest-living slot);
  // the joiner takes player 1. A single MATCH_SNAPSHOT carries the new roster to
  // every peer, who all rebuild at tick 0. Only the current host runs this.
  async function resetForJoin(joinerUserId) {
    if (!joinerUserId || joinerUserId === localUserId) return;
    const next = createEmptyRoster();
    next[0] = { userId: localUserId, state: 'active', playerId: 0 };
    next[1] = { userId: joinerUserId, state: 'active', playerId: 1 };
    roster = next;
    seed = hashSeed(matchId);
    matchStartSlots = [0, 1];
    matchHumanPlayers = [0, 1];
    liveStartKey = matchStartKey(matchId, roster, seed);
    localPlayerId = 0;
    role = 'player';
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    catchUpReady = true;
    joinIntents.clear();
    pendingAcceptedJoins.clear();
    pendingPresentationJoinTicks.clear();
    pendingLocalJoin = null;
    endSlotOffer('filled');
    for (const pid of matchHumanPlayers) notePlayerConfirm(pid);
    session?.setLocalPlayerId?.(0);
    session?.setRole?.('player');
    saveMatch({ matchId, userId: localUserId, slot: 0 });
    // Reset local sim + renderer to two armies before broadcasting the snapshot.
    await notifyLiveStart(true);
    sendAll({
      type: MSG.MATCH_SNAPSHOT,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      seed,
      roster: cloneSlots(roster),
      phase: SHARD_PHASE.LIVE,
      tick: 0,
      activeSlots: [0, 1],
      humanPlayers: [0, 1],
      armyPerSide,
      startKey: liveStartKey,
    });
    emitShard();
    broadcastPresence();
    onStatus(`Player joined — match reset (2 armies) …${shortId(matchId)}`);
  }

  function acceptSlotClaim(claimerUserId, claimEpoch) {
    if (!isKing() || phase !== SHARD_PHASE.LIVE || !session) return false;
    if (!claimerUserId) return false;
    if (claimEpoch && offerEpoch && claimEpoch !== offerEpoch) return false;
    if (countActive(roster) >= MAX_ACTIVE_PLAYERS) return false;
    if (offerEligible.length && !offerEligible.some((id) => userIdsMatch(id, claimerUserId))) {
      return false;
    }

    const soloKing =
      countActive(roster) === 1 ||
      (countActive(roster) === 0 && role === 'player' && localPlayerId >= 0);
    if (soloKing) {
      endSlotOffer('filled');
      void resetForJoin(claimerUserId);
      return true;
    }

    const joinTick = (session.confirmedTick ?? 0) + JOIN_DELAY_TICKS;
    if (session.confirmedTick < joinTick - JOIN_ASSIGN_LEAD_TICKS) {
      // Buffer claim until we are within lead window.
      joinIntents.set(claimerUserId, {
        userId: claimerUserId,
        joinTick,
        intentId: `claim:${matchId}:${claimerUserId}:${offerEpoch}`,
        caughtUp: true,
      });
      endSlotOffer('filled');
      return true;
    }

    const { slots, playerId } = reserveOpenSlot(roster, claimerUserId);
    if (playerId < 0) return false;
    roster = slots;
    endSlotOffer('filled');
    const accept = {
      type: MSG.JOIN_ACCEPT,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      userId: claimerUserId,
      playerId,
      joinTick,
      eventId: `join:${matchId}:${claimerUserId}:${playerId}:${joinTick}`,
      spawnSeed: hashSeed(`${matchId}:${claimerUserId}:${playerId}:${joinTick}`),
    };
    sendAll(accept);
    commitJoinAtTick(accept);
    if (userIdsMatch(claimerUserId, localUserId)) {
      applyLocalJoinPending(playerId, joinTick);
    }
    emitShard();
    broadcastPresence();
    return true;
  }

  function processJoinQueue() {
    // Completes claims that were accepted slightly early (joinTick lead).
    if (phase !== SHARD_PHASE.LIVE || !session) return;
    if (!isKing()) return;
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
      if (userIdsMatch(intent.userId, localUserId)) {
        applyLocalJoinPending(playerId, intent.joinTick);
      }
      emitShard();
      broadcastPresence();
    }
    // Keep offer alive while seats remain.
    if (countActive(roster) < MAX_ACTIVE_PLAYERS) refreshSlotOffer();
  }

  function handleSlotClaim(msg) {
    if (msg.matchId !== matchId) return;
    if (!msg.userId) return;
    if (!isKing()) {
      if (role === 'player') {
        const hostId = rosterHostUserId();
        if (hostId) {
          for (const pid of connectedPeerIds()) {
            const uid = peerUserIds.get(pid) ?? pid;
            if (userIdsMatch(uid, hostId)) {
              sendPeer(pid, msg);
              break;
            }
          }
        }
      }
      return;
    }
    if (DEBUG_KOTH) {
      console.info('[KOTH] slot claim', { from: shortId(msg.userId), epoch: msg.offerEpoch });
    }
    acceptSlotClaim(msg.userId, msg.offerEpoch);
  }

  function handleSlotOffer(msg) {
    if (msg.matchId !== matchId) return;
    applyLocalOfferState(msg.offerEpoch, msg.eligible ?? []);
  }

  function handleSlotOfferEnd(msg) {
    if (msg.matchId !== matchId) return;
    if (offerEpoch && msg.offerEpoch && msg.offerEpoch !== offerEpoch) return;
    offerEpoch = 0;
    offerEligible = [];
    localOfferEligible = false;
    if (role === 'spectator' && catchUpReady && !pendingLocalJoin) {
      appState = countActive(roster) >= MAX_ACTIVE_PLAYERS
        ? KOTH_APP_STATE.QUEUED
        : KOTH_APP_STATE.SPECTATOR;
      onStatus(
        countActive(roster) >= MAX_ACTIVE_PLAYERS
          ? 'Match full — waiting for a seat…'
          : 'Seat taken — waiting for next offer…',
      );
      emitShard();
    }
  }

  function handleSponsorAssign(msg) {
    if (msg.matchId !== matchId) return;
    applySponsorAssignment(msg.userId, msg.sponsorId, msg.depth);
    if (userIdsMatch(msg.userId, localUserId) && msg.sponsorId && !catchUpReady) {
      activeDialTarget = msg.sponsorId;
      nudgePeerConnect(msg.sponsorId);
      beginCatchup(msg.sponsorId);
    }
  }

  function handleSponsorHandoff(msg) {
    if (msg.matchId !== matchId) return;
    for (const a of msg.assignments ?? []) {
      applySponsorAssignment(a.userId, a.sponsorId, a.depth);
      if (userIdsMatch(a.userId, localUserId) && a.sponsorId) {
        assignedSponsorId = a.sponsorId;
        observerDepth = a.depth ?? 1;
        if (!isConnectedTo(a.sponsorId)) nudgePeerConnect(a.sponsorId);
      }
    }
    if (msg.fromUserId) {
      upsertNode(observerTree, msg.fromUserId, {
        role: 'player',
        depth: 0,
        sponsorId: null,
        caughtUp: true,
      });
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

  function applyLocalJoinPending(playerId, joinTick) {
    pendingLocalJoin = { playerId, joinTick };
    // Enter quorum the tick AFTER spawn so tick joinTick still commits with [0,1]
    // confirms only — otherwise we stall waiting for our own player-2 confirm.
    session?.scheduleJoin?.(joinTick + 1, playerId);
    role = 'spectator';
    appState = KOTH_APP_STATE.JOINING;
    catchUpReady = true;
    session?.setRole?.('spectator');
    notifyPresentationSync({ role: 'spectator', appState, localPlayerId, inputEnabled: false });
    onStatus(`Joining at tick ${joinTick}…`);
    if (session && session.confirmedTick >= joinTick) {
      promoteLocalJoinIfReady(session.confirmedTick);
    }
  }

  function handleJoinAccept(msg) {
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (msg.matchId !== matchId) return;
    if (DEBUG_KOTH) {
      console.info('[KOTH] join accept received', {
        user: shortId(msg.userId),
        playerId: msg.playerId,
        joinTick: msg.joinTick,
        mine: userIdsMatch(msg.userId, localUserId),
      });
    }
    roster = reserveSlot(roster, msg.playerId, msg.userId);
    commitJoinAtTick(msg);
    joinIntents.delete(msg.userId);
    if (userIdsMatch(msg.userId, localUserId)) {
      applyLocalJoinPending(msg.playerId, msg.joinTick);
    }
    emitShard();
    broadcastPresence();
  }

  async function handleSnapshotRequest(msg, fromPeerId) {
    if (msg.matchId !== matchId) return;
    if (!session) return;
    if (msg.to && !userIdsMatch(msg.to, localUserId)) {
      if (!msg.viaBroadcast && (!fromPeerId || !connectedPeerIds().includes(fromPeerId))) return;
      if (msg.viaBroadcast) return;
    }
    // L2+ must not pull from players — only assigned sponsor answers.
    if (!canServeCatchUpFor(msg.from)) {
      // Only L1 parents / players with capacity answer; never relay player-ward for L2+.
      if (role === 'spectator' && assignedSponsorId && !userIdsMatch(msg.to, assignedSponsorId)) {
        return;
      }
      return;
    }

    const tick = session.confirmedTick;
    const cached = session.getCachedCheckpoint?.();
    const checkpointTick = cached?.tick ?? 0;
    const useCheckpoint = checkpointTick > 0 && checkpointTick < tick;
    const ledger = useCheckpoint
      ? session.exportLedger(checkpointTick, tick)
      : session.exportLedger(0, tick);

    const responsePeerId = fromPeerId && connectedPeerIds().includes(fromPeerId)
      ? fromPeerId
      : connectedPeerIds().find((pid) => userIdsMatch(peerUserIds.get(pid) ?? pid, msg.from));

    const transferId = `cu:${msg.requestId || `${matchId}:${tick}`}`;
    if (useCheckpoint && responsePeerId && cached?.checkpoint) {
      sendCheckpointToPeer(responsePeerId, cached.checkpoint, cached.checksum, checkpointTick);
      const packed = packLedgerChunks(ledger, transferId);
      for (let i = 0; i < packed.chunks.length; i++) {
        sendPeer(responsePeerId, {
          type: MSG.LEDGER_CHUNK,
          v: KOTH_PROTOCOL_VERSION,
          matchId,
          transferId,
          index: i,
          total: packed.total,
          frames: packed.chunks[i],
          requestId: msg.requestId,
          to: msg.from,
          tipTick: tick,
          tipChecksum: session._lastChecksum,
          checkpointTick,
          checkpointChecksum: cached.checksum,
        });
      }
    }

    const offer = {
      type: MSG.SNAPSHOT_OFFER,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      to: msg.from,
      requestId: msg.requestId,
      tick,
      checksum: session._lastChecksum,
      ledger: useCheckpoint ? [] : ledger,
      ledgerFrameCount: ledger.length,
      ledgerTransferId: useCheckpoint ? transferId : undefined,
      checkpointTick: useCheckpoint ? checkpointTick : 0,
      checkpointChecksum: useCheckpoint ? cached.checksum : undefined,
      matchConfig: matchConfig(),
      roster: authoritativeRoster(),
      viaBroadcast: !!msg.viaBroadcast,
    };
    if (msg.viaBroadcast || !responsePeerId) {
      // Broadcast path: include ledger inline (no chunk assembly over broadcast).
      offer.ledger = ledger;
      offer.checkpoint = useCheckpoint ? cached.checkpoint : undefined;
      sendBroadcastMsg(offer);
    } else {
      sendPeer(responsePeerId, offer);
    }
  }

  async function handleSnapshotOffer(msg) {
    if (msg.matchId !== matchId) return;
    if (msg.to && msg.to !== localUserId && !userIdsMatch(msg.to, localUserId)) return;
    if (!activeCatchupRequestId || msg.requestId !== activeCatchupRequestId) return;
    if (!session || !msg.matchConfig) return;
    if (catchupInFlight) return;

    let checkpoint = msg.checkpoint ?? null;
    let ledger = msg.ledger ?? [];

    // Wait briefly for chunked checkpoint/ledger if advertised.
    if (msg.ledgerTransferId || (msg.checkpointTick > 0 && !checkpoint)) {
      const parts = pendingCatchupParts.get(msg.requestId) ?? {};
      checkpoint = checkpoint ?? parts.checkpoint ?? null;
      if (parts.ledger?.length) ledger = parts.ledger;
      if (msg.ledgerTransferId && !parts.ledger) {
        // Keep request open; ledger chunks will re-enter via handleLedgerChunk.
        pendingCatchupParts.set(msg.requestId, {
          ...parts,
          offer: msg,
          waitingLedger: true,
        });
        onStatus('Receiving catch-up ledger…');
        return;
      }
    }

    catchupInFlight = true;
    clearCatchupOfferTimer();
    const acceptedRequestId = activeCatchupRequestId;
    activeCatchupRequestId = '';
    catchUpReady = false;
    onStatus('Replaying catch-up…');
    try {
      await replayCatchUp(
        session,
        msg.matchConfig,
        ledger,
        msg.tick,
        msg.checksum,
        {
          checkpoint,
          checkpointTick: msg.checkpointTick ?? checkpoint?.tick ?? 0,
          onProgress: ({ tick, targetTick }) => {
            const elapsed = formatMatchTime(matchSecondsFromTick(tick));
            const total = formatMatchTime(matchSecondsFromTick(targetTick));
            onStatus(`Replaying ${elapsed} / ${total}…`);
          },
        },
      );
      catchUpReady = true;
      phase = SHARD_PHASE.LIVE;
      appState = KOTH_APP_STATE.SPECTATOR;
      localPlayerId = -1;
      session.pauseLockstep = false;
      matchStartSlots = msg.matchConfig.activeSlots ?? matchStartSlots;
      matchHumanPlayers = msg.matchConfig.humanPlayers ?? matchHumanPlayers;
      if (msg.matchConfig.armyPerSide != null) armyPerSide = msg.matchConfig.armyPerSide | 0;
      session.setHumanPlayers?.(matchHumanPlayers);
      if (msg.roster && countActive(msg.roster) > 0) roster = cloneSlots(msg.roster);
      session.setLocalPlayerId?.(-1);
      setRole('spectator');
      saveMatch({ matchId, userId: localUserId, slot: null });
      noteObserverCaughtUp(localUserId);
      pendingCatchupParts.delete(acceptedRequestId);
      if (DEBUG_KOTH) {
        console.info('[KOTH] caught up — ready for offers', {
          tick: msg.tick,
          checkpointTick: msg.checkpointTick ?? 0,
          rosterActive: countActive(roster),
          depth: observerDepth,
        });
      }
      onStatus(
        localOfferEligible
          ? 'Seat offered — J to claim'
          : countActive(roster) >= MAX_ACTIVE_PLAYERS
            ? 'Caught up — match full'
            : 'Caught up — waiting for seat offer…',
      );
      notifyPresentationSync({
        mode: 'koth',
        role: 'spectator',
        reset: false,
        inputEnabled: false,
        updateHumanPlayers: true,
      });
      sendAll({ type: MSG.CATCHUP_READY, matchId, userId: localUserId, tick: msg.tick });
      catchupRetryAttempt = 0;
      if (isKing()) refreshSlotOffer();
    } catch (err) {
      console.warn('[KOTH] catch-up failed', err);
      clearCatchupOfferTimer();
      activeCatchupRequestId = '';
      catchUpReady = false;
      pendingLocalJoin = null;
      localPlayerId = -1;
      role = 'spectator';
      appState = KOTH_APP_STATE.SPECTATOR;
      if (session) {
        session.pauseLockstep = true;
        session.catchupProgress = null;
      }
      session?.setLocalPlayerId?.(-1);
      session?.setRole?.('spectator');
      notifyPresentationSync({ mode: 'koth', role: 'spectator', localPlayerId: -1, appState, reset: false, inputEnabled: false });
      onStatus('Catch-up failed — retrying…');
      scheduleCatchupRetry(msg.tick ?? 0);
    } finally {
      catchupInFlight = false;
    }
  }

  function handleCheckpointChunk(msg) {
    if (msg.matchId !== matchId) return;
    const assembled = checkpointAssembler.push(
      msg.transferId,
      msg.index,
      msg.total,
      msg.text,
      { tick: msg.tick, checksum: msg.checksum },
    );
    if (!assembled) return;
    session?.cacheCheckpoint?.(assembled.checkpoint, assembled.meta.checksum ?? msg.checksum);
    lastCheckpointTickPublished = Math.max(lastCheckpointTickPublished, assembled.meta.tick | 0);
    // Forward to our children so L2+ never touch players.
    for (const childId of childObserverIds()) {
      const peerId = connectedPeerIds().find((pid) =>
        userIdsMatch(peerUserIds.get(pid) ?? pid, childId),
      );
      if (peerId) {
        sendCheckpointToPeer(
          peerId,
          assembled.checkpoint,
          assembled.meta.checksum ?? msg.checksum,
          assembled.meta.tick ?? msg.tick,
        );
      }
    }
    if (activeCatchupRequestId) {
      const parts = pendingCatchupParts.get(activeCatchupRequestId) ?? {};
      parts.checkpoint = assembled.checkpoint;
      pendingCatchupParts.set(activeCatchupRequestId, parts);
    }
  }

  function handleLedgerChunk(msg) {
    if (msg.matchId !== matchId) return;
    const assembled = ledgerAssembler.push(
      msg.transferId,
      msg.index,
      msg.total,
      msg.frames,
      {
        requestId: msg.requestId,
        tipTick: msg.tipTick,
        tipChecksum: msg.tipChecksum,
        checkpointTick: msg.checkpointTick,
      },
    );
    if (!assembled) return;
    const requestId = assembled.meta.requestId ?? msg.requestId;
    const parts = pendingCatchupParts.get(requestId) ?? {};
    parts.ledger = assembled.ledger;
    pendingCatchupParts.set(requestId, parts);
    if (parts.offer && parts.waitingLedger && requestId === activeCatchupRequestId) {
      const offer = {
        ...parts.offer,
        ledger: assembled.ledger,
        checkpoint: parts.checkpoint ?? parts.offer.checkpoint,
      };
      parts.waitingLedger = false;
      void handleSnapshotOffer(offer);
    }
  }

  function handleCheckpointMeta(msg) {
    if (msg.matchId !== matchId) return;
    lastCheckpointTickPublished = Math.max(lastCheckpointTickPublished, msg.tick | 0);
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
        if (msg.phase === SHARD_PHASE.LIVE) seedHostRosterIfSpectating(msg.from);
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
        else if (phase === SHARD_PHASE.LIVE && role === 'spectator' && !catchUpReady) {
          if (peerCanSponsorCatchUp(fromPeerId)) {
            scheduleCatchupAfterConnect(fromPeerId);
          } else if (!hasLiveSponsorLink()) {
            connectToMatchPeers();
            scheduleBroadcastCatchup(2000);
          }
        }
        break;

      case MSG.SHARD_STATE:
        if (msg.v !== KOTH_PROTOCOL_VERSION) return;
        if (!reconcileMatchId(msg.matchId, msg.phase)) return;
        if (msg.from) peerUserIds.set(fromPeerId, msg.from);
        readyPeerIds.add(fromPeerId);
        // The match start config is authoritative on live participants and never
        // changes after the match begins (joins grow the roster, not the start
        // slots). Only learn it from a LIVE sender while we ourselves are still
        // discovering — otherwise a freshly-booted late joiner's stale sandbox
        // defaults ([0]) clobber an in-progress roster and break catch-up replay.
        if (msg.phase === SHARD_PHASE.LIVE && phase !== SHARD_PHASE.LIVE) {
          if (msg.matchStartSlots) matchStartSlots = msg.matchStartSlots;
          if (msg.matchHumanPlayers) matchHumanPlayers = msg.matchHumanPlayers;
        }
        if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
        // SANDBOX→LIVE discovery, OR a followLivePresence() spectator that entered
        // LIVE with an empty roster and must adopt the real one — otherwise every
        // live command frame fails ownership validation and the spectator desyncs.
        {
          const liveFromSandbox = msg.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX;
          const liveSpectatorMissingRoster =
            msg.phase === SHARD_PHASE.LIVE &&
            phase === SHARD_PHASE.LIVE &&
            role === 'spectator' &&
            messageFromLivePlayer(msg) &&
            !pendingLocalJoin &&
            appState !== KOTH_APP_STATE.JOINING &&
            appState !== KOTH_APP_STATE.QUEUED &&
            countActive(msg.roster ?? []) > countActive(roster);
          const liveSpectatorNeedsCatchup =
            msg.phase === SHARD_PHASE.LIVE &&
            phase === SHARD_PHASE.LIVE &&
            role === 'spectator' &&
            messageFromLivePlayer(msg) &&
            !catchUpReady &&
            !pendingLocalJoin &&
            appState !== KOTH_APP_STATE.JOINING &&
            appState !== KOTH_APP_STATE.QUEUED &&
            countActive(msg.roster ?? []) > 0;
          if (liveFromSandbox || liveSpectatorMissingRoster) {
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
            if (peerCanSponsorCatchUp(fromPeerId)) {
              scheduleCatchupAfterConnect(fromPeerId);
            } else if (!hasLiveSponsorLink()) {
              connectToMatchPeers();
              scheduleBroadcastCatchup(2000);
            }
          } else if (liveSpectatorNeedsCatchup) {
            if (countActive(msg.roster ?? []) > countActive(roster)) {
              roster = cloneSlots(msg.roster ?? roster);
            }
            if (peerCanSponsorCatchUp(fromPeerId)) {
              scheduleCatchupAfterConnect(fromPeerId);
            } else if (!hasLiveSponsorLink()) {
              connectToMatchPeers();
              scheduleBroadcastCatchup(2000);
            }
          }
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
          const owner = resolvePlayerOwner(msg.playerId, msg.userId);
          if (!msg.userId || !owner || !userIdsMatch(owner, msg.userId)) {
            if (DEBUG_KOTH) {
              console.warn('[KOTH] rejected TICK_CONFIRM — roster ownership mismatch', {
                fromPlayerId: msg.playerId,
                claimedUser: shortId(msg.userId),
                rosterOwner: shortId(owner),
                rosterStates: roster.map((s) => `${s.playerId}:${s.state}:${shortId(s.userId)}`),
              });
            }
            return;
          }
          session?.setPeerConfirmedTick(msg.playerId, msg.tick);
          notePlayerConfirm(msg.playerId);
        }
        break;

      case MSG.REQUEST_TICK_CONFIRM:
        if (session) sendTickConfirm(session.confirmedTick + 1);
        break;

      case MSG.SNAPSHOT_REQUEST:
        void handleSnapshotRequest(msg, fromPeerId);
        break;

      case MSG.SNAPSHOT_OFFER:
        void handleSnapshotOffer(msg);
        break;

      case MSG.CHECKPOINT_CHUNK:
        handleCheckpointChunk(msg);
        break;

      case MSG.LEDGER_CHUNK:
        handleLedgerChunk(msg);
        break;

      case MSG.CHECKPOINT_META:
        handleCheckpointMeta(msg);
        break;

      case MSG.SPONSOR_ASSIGN:
        handleSponsorAssign(msg);
        break;

      case MSG.SPONSOR_HANDOFF:
        handleSponsorHandoff(msg);
        break;

      case MSG.SLOT_OFFER:
        handleSlotOffer(msg);
        break;

      case MSG.SLOT_CLAIM:
        handleSlotClaim(msg);
        break;

      case MSG.SLOT_OFFER_END:
        handleSlotOfferEnd(msg);
        break;

      case MSG.JOIN_INTENT:
        handleJoinIntent(msg);
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
        if (isKing()) refreshSlotOffer();
        break;

      case MSG.SHARD_GONE:
        if (msg.matchId !== matchId) return;
        if (phase === SHARD_PHASE.LIVE) windDownShard();
        break;

      case MSG.CATCHUP_READY:
        if (msg.matchId === matchId && msg.userId) {
          noteObserverCaughtUp(msg.userId);
          if (isKing() && !observerTree.nodes.get(msg.userId)?.sponsorId) {
            kingAssignObserver(msg.userId);
          }
        }
        break;

      case MSG.PING:
        handlePingMsg(msg, fromPeerId);
        break;

      case MSG.PONG:
        handlePongMsg(msg, fromPeerId);
        break;

      default:
        break;
    }
  }

  function clearCatchupOfferTimer() {
    if (catchupOfferTimer) {
      clearTimeout(catchupOfferTimer);
      catchupOfferTimer = null;
    }
  }

  function scheduleCatchupOfferTimeout(tick = 0) {
    clearCatchupOfferTimer();
    const requestId = activeCatchupRequestId;
    catchupOfferTimer = setTimeout(() => {
      catchupOfferTimer = null;
      if (activeCatchupRequestId !== requestId || catchUpReady) return;
      if (DEBUG_KOTH) console.info('[KOTH] catch-up offer timeout — retrying', { requestId: requestId.slice(-12) });
      activeCatchupRequestId = '';
      const sponsor = pickSponsorUserId();
      if (sponsor) {
        beginCatchup(sponsor, tick);
        return;
      }
      if (!tryClaimOrphanMatch()) scheduleBroadcastCatchup(0);
    }, CATCHUP_OFFER_TIMEOUT_MS);
  }

  // RTC "connected" fires before the data channel is open; defer catch-up so
  // SNAPSHOT_REQUEST is not silently dropped by getfire sendData.
  function scheduleCatchupAfterConnect(peerId) {
    if (phase !== SHARD_PHASE.LIVE || role !== 'spectator' || catchUpReady || !peerId) return;
    if (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING || appState === KOTH_APP_STATE.QUEUED) return;
    for (const delayMs of [600, 1800, 4000]) {
      setTimeout(() => {
        if (catchUpReady || catchupInFlight || phase !== SHARD_PHASE.LIVE || role !== 'spectator') return;
        if (!connectedPeerIds().includes(peerId)) return;
        if (activeCatchupRequestId) {
          if (performance.now() - catchupRequestStartedAt < CATCHUP_OFFER_TIMEOUT_MS) return;
          clearCatchupOfferTimer();
          activeCatchupRequestId = '';
        }
        beginCatchup(peerId, session?.confirmedTick ?? 0);
      }, delayMs);
    }
  }

  function beginCatchup(peerOrUserId, tick = 0) {
    if (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING) return;
    if (catchupInFlight) return;
    if (catchUpReady && (session?.confirmedTick ?? 0) > 0) return;
    if (!session || !peerOrUserId) {
      if (DEBUG_KOTH) {
        console.info('[KOTH] catch-up deferred — no sponsor yet', {
          connectedPeers: connectedPeerIds().length,
          tick,
        });
      }
      return;
    }
    if (activeCatchupRequestId) {
      if (performance.now() - catchupRequestStartedAt < CATCHUP_OFFER_TIMEOUT_MS) return;
      clearCatchupOfferTimer();
      activeCatchupRequestId = '';
    }
    if (catchupRetryTimer) {
      clearTimeout(catchupRetryTimer);
      catchupRetryTimer = null;
    }
    const target = tick || session.confirmedTick || 0;
    let sponsorUserId = assignedSponsorId
      || peerUserIds.get(peerOrUserId)
      || peerOrUserId;
    if (!userCanSponsorCatchUp(sponsorUserId)) {
      const fallback = assignedSponsorId || pickSponsorUserId();
      if (!fallback) {
        if (DEBUG_KOTH) {
          console.info('[KOTH] catch-up deferred — no live sponsor', {
            connectedPeers: connectedPeerIds().length,
            tick: target,
          });
        }
        scheduleBroadcastCatchup(0);
        if (!hasLiveSponsorLink()) connectToMatchPeers();
        if (!tryClaimOrphanMatch()) scheduleCatchupRetry(target);
        return;
      }
      sponsorUserId = fallback;
    }
    catchUpReady = false;
    activeCatchupRequestId = `catchup:${matchId}:${localUserId}:${Date.now().toString(36)}:${++messageSeq}`;
    catchupRequestStartedAt = performance.now();
    const linkedPeer = connectedPeerIds().find(
      (pid) => userIdsMatch(peerUserIds.get(pid) ?? pid, sponsorUserId) && peerCanSponsorCatchUp(pid),
    );
    const viaBroadcast = !linkedPeer;
    const cachedTick = session.getCachedCheckpoint?.()?.tick ?? 0;
    const payload = {
      type: MSG.SNAPSHOT_REQUEST,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      from: localUserId,
      to: sponsorUserId,
      requestId: activeCatchupRequestId,
      tick: target,
      fromTick: cachedTick,
      fullReplay: cachedTick <= 0,
      viaBroadcast,
    };
    if (linkedPeer) sendPeer(linkedPeer, payload);
    else sendBroadcastMsg(payload);
    scheduleCatchupOfferTimeout(target);
    onStatus(viaBroadcast ? 'Catching up via relay…' : 'Catching up…');
    if (DEBUG_KOTH) {
      console.info('[KOTH] catch-up requested', {
        sponsor: shortId(sponsorUserId),
        tick: target,
        viaBroadcast,
        requestId: activeCatchupRequestId.slice(-16),
      });
    }
  }

  function scheduleCatchupRetry(tick = 0) {
    if (catchupRetryTimer || catchupInFlight) return;
    const delay = Math.min(5000, 500 * 2 ** catchupRetryAttempt);
    catchupRetryAttempt++;
    catchupRetryTimer = setTimeout(() => {
      catchupRetryTimer = null;
      if (catchupInFlight) return;
      const sponsor = pickSponsorUserId();
      if (sponsor) beginCatchup(sponsor, tick);
    }, delay);
  }

  function sendTickConfirm(tick) {
    if (!session || role !== 'player') return;
    // Tick confirms are a live-lockstep concept. A sandbox/matchmaking session
    // free-runs and would otherwise spam playerId-0 confirms to every peer (all
    // rejected), drowning out real signal and risking stale cross-match confirms.
    if (phase !== SHARD_PHASE.LIVE) return;
    if (userForPlayerId(session.localPlayerId) !== localUserId) return;
    sendAll({ type: MSG.TICK_CONFIRM, tick, playerId: session.localPlayerId, userId: localUserId });
  }

  // Tick 0 is the init snapshot and is never committed, so the commit-driven
  // confirm cascade has no seed. Once the freshly-reset live session is ready
  // (confirmedTick === 0 for THIS match — calling before reset would broadcast a
  // stale sandbox tick), nudge confirms until the sim leaves tick 0. Repeats
  // because peers reset asynchronously and may miss the first confirm.
  function kickstartLockstep() {
    if (bootstrapTimer) clearInterval(bootstrapTimer);
    let tries = 0;
    sendTickConfirm((session?.confirmedTick ?? 0) + 1);
    bootstrapTimer = setInterval(() => {
      if (
        phase !== SHARD_PHASE.LIVE ||
        role !== 'player' ||
        (session?.confirmedTick ?? 0) > 0 ||
        ++tries > 16
      ) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        return;
      }
      sendTickConfirm((session?.confirmedTick ?? 0) + 1);
    }, 300);
  }

  function onPeerConnected(peerId) {
    console.log('[KOTH] peer connected', shortId(peerId));
    activeDialTarget = null;
    clearConnectFallbackTimer();
    clearBroadcastCatchupTimer();
    peerUserIds.set(peerId, peerId);
    presencePeers.set(peerId, peerId);
    sendPeer(peerId, {
      type: MSG.SHARD_HELLO,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      from: localUserId,
      phase,
    });

    if (phase === SHARD_PHASE.LIVE && role === 'spectator' && !catchUpReady) {
      if (peerCanSponsorCatchUp(peerId)) {
        scheduleCatchupAfterConnect(peerId);
      } else if (!hasLiveSponsorLink()) {
        connectToMatchPeers();
        scheduleBroadcastCatchup(2000);
      }
    }

    if (phase === SHARD_PHASE.SANDBOX) maybeStartLive();
  }

  function onPeerLinkFailed(peerId) {
    if (phase !== SHARD_PHASE.LIVE || role !== 'spectator' || catchUpReady) return;
    if (!activeDialTarget || !userIdsMatch(activeDialTarget, peerId)) return;
    if (DEBUG_KOTH) console.info('[KOTH] peer link failed', { to: shortId(peerId) });
    tryNextSponsor(matchId, peerId);
  }

  function onPeerDisconnected(peerId) {
    const uid = peerUserIds.get(peerId);
    peerUserIds.delete(peerId);
    readyPeerIds.delete(peerId);
    onStatus(`Peer …${shortId(uid ?? peerId)} link lost — waiting for mesh gossip`);
  }

  function processPresenceBroadcast(data) {
    if (data.from === localUserId) return;
    // Presence is a heartbeat (fires every announce interval). Only log when a
    // peer's state actually changes, so the console isn't flooded.
    if (DEBUG_KOTH) {
      const sig = `${data.from}|${data.matchId}|${data.phase}|${data.activeCount ?? 0}`;
      if (presenceLogSig.get(data.from) !== sig) {
        presenceLogSig.set(data.from, sig);
        console.info('[KOTH] presence', {
          from: shortId(data.from),
          theirMatch: shortId(data.matchId),
          theirPhase: data.phase,
          theirActive: data.activeCount,
          myMatch: shortId(matchId),
          myActive: countActive(roster),
        });
      }
    }
    if (data.from) {
      if (data.role) peerPresenceRole.set(data.from, data.role);
      else if (data.appState === KOTH_APP_STATE.SPECTATOR) peerPresenceRole.set(data.from, 'spectator');
      if (data.sponsorId != null || data.observerDepth != null) {
        applySponsorAssignment(data.from, data.sponsorId ?? null, data.observerDepth ?? 0);
      }
      if (data.role === 'spectator' || data.appState === KOTH_APP_STATE.SPECTATOR) {
        upsertNode(observerTree, data.from, {
          role: 'observer',
          joinedAt: observerTree.nodes.get(data.from)?.joinedAt ?? Date.now(),
        });
        if (isKing() && phase === SHARD_PHASE.LIVE) {
          if (!observerTree.nodes.get(data.from)?.sponsorId) kingAssignObserver(data.from);
          if (countActive(roster) < MAX_ACTIVE_PLAYERS) refreshSlotOffer();
        }
      }
      if (data.offerEpoch && Array.isArray(data.offerEligible)) {
        applyLocalOfferState(data.offerEpoch, data.offerEligible);
      }
    }
    recordLiveMatch(data);
    if (appState === KOTH_APP_STATE.PRIVATE_SANDBOX) return;
    if (data.phase === SHARD_PHASE.LIVE && phase !== SHARD_PHASE.LIVE) {
      const best = bestLiveMatch();
      if (best?.matchId && best.from) {
        followLivePresence({ matchId: best.matchId, from: best.from, phase: SHARD_PHASE.LIVE });
      }
      return;
    }
    // Already live: converge to the single strongest match (handles the
    // simultaneous-start race transitively, including re-converging spectators).
    if (convergeToBestMatch()) return;
    if (!reconcileMatchId(data.matchId, data.phase)) return;
    if (data.matchId !== matchId || phase !== SHARD_PHASE.LIVE) return;
    noteMatchAnnouncer(data.matchId, data.from);
    // Spectators dial once from onMatchLobbyConnected; never re-nudge from presence.
    if (role === 'spectator') return;
    nudgePeerConnect(data.from);
    if (data.phase === SHARD_PHASE.LIVE && phase === SHARD_PHASE.SANDBOX) {
      setDiscoveryStatus('Live match found — connecting…');
    }
  }

  function onGameBroadcastMessage(msg) {
    if (!msg?.type) return;
    if (msg.from && userIdsMatch(msg.from, localUserId)) return;
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (msg._mid) {
      if (seenMessageIds.has(msg._mid)) return;
      rememberMessageId(msg._mid);
    }
    switch (msg.type) {
      case MSG.SNAPSHOT_REQUEST:
        void handleSnapshotRequest(msg, null);
        break;
      case MSG.SNAPSHOT_OFFER:
        void handleSnapshotOffer(msg);
        break;
      case MSG.CHECKPOINT_META:
        handleCheckpointMeta(msg);
        break;
      case MSG.SPONSOR_ASSIGN:
        handleSponsorAssign(msg);
        break;
      case MSG.SPONSOR_HANDOFF:
        handleSponsorHandoff(msg);
        break;
      case MSG.SLOT_OFFER:
        handleSlotOffer(msg);
        break;
      case MSG.SLOT_CLAIM:
        handleSlotClaim(msg);
        break;
      case MSG.SLOT_OFFER_END:
        handleSlotOfferEnd(msg);
        break;
      case MSG.JOIN_INTENT:
        handleJoinIntent(msg);
        break;
      case MSG.JOIN_ACCEPT:
        handleJoinAccept(msg);
        break;
      case MSG.JOIN_READY:
        handleJoinReady(msg);
        break;
      case MSG.CATCHUP_READY:
        if (msg.matchId === matchId && msg.userId) noteObserverCaughtUp(msg.userId);
        break;
      case MSG.MATCH_SNAPSHOT:
        handleMatchSnapshot(msg);
        break;
      case MSG.TICK_CONFIRM:
        if (msg.playerId !== undefined && msg.tick !== undefined) {
          const owner = resolvePlayerOwner(msg.playerId, msg.userId);
          if (!msg.userId || !owner || !userIdsMatch(owner, msg.userId)) break;
          session?.setPeerConfirmedTick(msg.playerId, msg.tick);
          notePlayerConfirm(msg.playerId);
        }
        break;
      case MSG.COMMAND_FRAME:
        if (validateCommandFrame(msg.frame)) session?.bufferRemoteFrame(msg.frame);
        break;
      default:
        break;
    }
  }

  function onBroadcastMessage(raw) {
    const data = raw && raw.type === 'broadcast' && raw.content ? raw.content : raw;
    if (!data?.type) return;
    if (data.type !== MSG.SHARD_PRESENCE) {
      onGameBroadcastMessage(data);
      return;
    }
    processPresenceBroadcast(data);
  }

  function onGameLobbyMessage(data, lobbyName) {
    if (!data?.type) return;
    // Discovery lobby — track nothing, never RTC here.
    if (lobbyName === MATCHMAKING_LOBBY) return;
    if (data.type === 'player_join' || data.type === 'player_rejoin') {
      if (userIdsMatch(data.from, localUserId)) {
        broadcastPresence();
        return;
      }
      if (phase === SHARD_PHASE.LIVE && lobbyName === shardLobbyName(matchId)) {
        lobbyPeers.add(data.from);
        if (role === 'spectator') return;
        if (role === 'player' && data.type === 'player_join') {
          p2p?.announcePresence?.(lobbyName);
          // Spectators dial in; only nudge the first joiner while solo with no link yet.
          if (
            connectedPeerIds().length > 0 ||
            countActive(roster) >= MIN_LIVE_PLAYERS ||
            peerPresenceRole.get(data.from) === 'spectator'
          ) {
            return;
          }
          nudgePeerConnect(data.from, true);
          return;
        }
        if (role === 'player' && countActive(roster) >= MIN_LIVE_PLAYERS && data.type === 'player_rejoin') {
          return;
        }
        nudgePeerConnect(data.from, data.type === 'player_join');
      }
    }
  }

  // --- boot ---

  onStatus('Joining King of the Hill…');

  p2p = globalThis.GETFIREP2P({
    roomType: 'aether-koth',
    devMode: p2pDevModeFromLocation(),
    onGameLobbyMessage,
    onMatchLobbyConnected,
    onDataChannelMessage: onDataMessage,
    onPeerConnected,
    onPeerDisconnected,
    onPeerLinkFailed,
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
    // Every client joins the global matchmaking lobby immediately (phase 1:
    // sandbox while pinging for presence). This is what lets peers mesh and
    // discover the live match before anyone elects to join; without it, tabs
    // can only requestMatch inside their own per-match lobby and never find
    // each other.
    joinMatchmakingLobby();

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
      armyPerSide,
    });
    bootResolve = null;

    announceTimer = setInterval(() => broadcastPresence(), SHARD_ANNOUNCE_MS);
    pingTimer = setInterval(() => pumpPing(), PING_INTERVAL_MS);
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
    /** Worst connected-peer RTT in ms, or null if solo / unknown. */
    getRttMs: () => (rttMs == null ? null : Math.round(rttMs)),

    // Called by the app once a live session has finished (re)building its world,
    // so confirmedTick reflects THIS match. Seeds the lockstep confirm handshake.
    notifyLiveSessionReady() {
      if (phase === SHARD_PHASE.LIVE && role === 'player') kickstartLockstep();
    },

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
        void maybePublishCheckpoint(tick);
        if (isKing() && countActive(roster) < MAX_ACTIVE_PLAYERS) {
          // Ensure an offer exists whenever a seat is open.
          if (!offerEpoch) refreshSlotOffer();
        }
        prevCommit?.(tick, checksum);
        if (phase === SHARD_PHASE.LIVE) broadcastPresence({ tick });
      };

      sendTickConfirm(1);
    },

    startOrJoinLive() {
      if (phase === SHARD_PHASE.LIVE) return;
      // Already discovered a live match? Join it.
      const known = bestLiveMatch();
      if (known?.matchId && known.from) {
        followLivePresence({ matchId: known.matchId, from: known.from, phase: SHARD_PHASE.LIVE });
        return;
      }
      // Otherwise listen in the matchmaking lobby for an existing match before
      // creating one. Leaving the private sandbox lets live presence arriving
      // during the window auto-follow (see onBroadcastMessage), so two players
      // pressing start join the same match instead of each making their own.
      if (discoverThenStartTimer) return; // already searching
      appState = KOTH_APP_STATE.MATCHMAKING;
      emitShard();
      onStatus('Looking for a match…');
      broadcastPresence();
      pumpDiscovery();
      discoverThenStartTimer = setTimeout(() => {
        discoverThenStartTimer = null;
        if (phase === SHARD_PHASE.LIVE) return;
        const found = bestLiveMatch();
        if (found?.matchId && found.from) {
          followLivePresence({ matchId: found.matchId, from: found.from, phase: SHARD_PHASE.LIVE });
          return;
        }
        clearSavedMatch();
        matchId = generateMatchId();
        seed = hashSeed(matchId);
        void startSoloLive();
      }, discoveryDelayMs());
    },

    requestJoin() {
      if (role === 'player') {
        if (DEBUG_KOTH) console.info('[KOTH] join ignored — already a player', { localPlayerId });
        return;
      }
      if (appState === KOTH_APP_STATE.JOINING) {
        if (DEBUG_KOTH) console.info('[KOTH] join ignored — already claiming', { appState });
        onStatus('Claim already in progress…');
        return;
      }
      if (phase !== SHARD_PHASE.LIVE) {
        if (DEBUG_KOTH) console.info('[KOTH] join ignored — no live match', { phase, appState });
        onStatus('No live match to join yet…');
        return;
      }
      if (!catchUpReady) {
        if (connectedPeerIds().length === 0) {
          scheduleMatchLobbyConnect();
          scheduleBroadcastCatchup(0);
          onStatus('Connecting to match — waiting for data link…');
        } else {
          if (!hasLiveSponsorLink()) connectToMatchPeers();
          scheduleBroadcastCatchup(0);
          onStatus('Still catching up…');
        }
        return;
      }
      if (countActive(roster) >= MAX_ACTIVE_PLAYERS) {
        appState = KOTH_APP_STATE.QUEUED;
        onStatus('Match full — waiting for a seat…');
        emitShard();
        return;
      }
      if (!localOfferEligible || !offerEpoch) {
        appState = KOTH_APP_STATE.QUEUED;
        onStatus(
          observerDepth > 0
            ? `Waiting for offer (L${observerDepth})…`
            : 'Waiting for seat offer…',
        );
        emitShard();
        return;
      }
      if (DEBUG_KOTH) {
        console.info('[KOTH] slot claim → sending', {
          matchId: shortId(matchId),
          offerEpoch,
          depth: observerDepth,
          host: shortId(rosterHostUserId()),
        });
      }
      sendAll({
        type: MSG.SLOT_CLAIM,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        userId: localUserId,
        offerEpoch,
      });
      appState = KOTH_APP_STATE.JOINING;
      session?.setRole?.('spectator');
      notifyPresentationSync({ role: 'spectator', appState, inputEnabled: false });
      onStatus('Claiming seat…');
      emitShard();
    },

    isSpectator() {
      return role === 'spectator';
    },

    canJoin() {
      return (
        catchUpReady &&
        !activeCatchupRequestId &&
        role === 'spectator' &&
        appState !== KOTH_APP_STATE.JOINING
      );
    },

    joinActionLabel() {
      if (countActive(roster) >= MAX_ACTIVE_PLAYERS) return 'Match Full';
      if (localOfferEligible) return 'Claim Seat';
      return 'Waiting for Offer';
    },

    /** Observer depth (0 = player / unassigned, 1 = L1, …). */
    getObserverDepth: () => observerDepth,
    isOfferEligible: () => localOfferEligible,

    canStartOrJoinLive() {
      return appState === KOTH_APP_STATE.PRIVATE_SANDBOX;
    },

    releaseSlot(spectate = true) {
      if (localPlayerId >= 0) forceDefeatPlayer(localPlayerId, localUserId);
    },

    disconnect() {
      cancelDiscoverStart();
      clearCatchupOfferTimer();
      if (offerExpandTimer) clearTimeout(offerExpandTimer);
      if (announceTimer) clearInterval(announceTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (discoveryTimer) clearInterval(discoveryTimer);
      if (catchupRetryTimer) clearTimeout(catchupRetryTimer);
      if (lagTimer) clearInterval(lagTimer);
      if (bootstrapTimer) clearInterval(bootstrapTimer);
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

/** KOTH on by default; ?solo=1, ?stress=N, or ?animStress=N disables. */
export function kothModeFromSearch(search = '') {
  const params = new URLSearchParams(search);
  if (params.has('solo')) return false;
  if (params.get('stress')) return false;
  if (params.get('animStress')) return false;
  if (params.has('koth') && params.get('koth') === '0') return false;
  return true;
}
