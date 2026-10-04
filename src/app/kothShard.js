// King of the Hill shard — multi-peer P2P orchestration.
//
// GetFire lobby = signaling + auto WebRTC mesh.
// Broadcast channel = shard presence (matchId, phase, tick).
//
// Hard KOTH invariants:
// - Page load creates a private staging and never claims a public live slot.
// - Public live state is entered by catching up to the live tip, never by
//   rebuilding the board.
// - EVERY join is the same join: claim → JOIN_ACCEPT → deterministic SPAWN_SLOT
//   at an agreed tick. The first challenger used to trigger a full match reset
//   to a fresh two-army tick 0, which rebuilt the world under every spectator,
//   killed their catch-up and their queued claim. spawnKothSlot works for any
//   slot at any tick, so the king simply keeps playing and the joiner drops in.
// - Mid-match sync uses a world checkpoint + ledger delta. Solo live (one king)
//   attaches at a tip checkpoint — no ledger replay needed. L2+ observers only
//   pull from their sponsor.
// - Open seats use cascading SLOT_OFFER / opt-in SLOT_CLAIM (no auto-promote).
// - Combat wipe (0 living units, or every agora gone after one was founded)
//   vacates the seat on that commit and returns the user to the spectator /
//   offer pool. True wipe still ends the round.
// - Roster changes after live start flow through JOIN_ACCEPT or SLOT_DEFEAT.
// - Commands and tick confirms must be owned by the userId for their playerId.

import { p2pDevModeFromLocation } from './net.js';
import { getPlayerColor, getPlayerName, getUnitSkins } from './settings.js';
import { ownerColorsFromRoster, sanitizeOwnerColor } from '../render/ownerTints.js';
import { aetherSteam } from './steam.js';
import {
  localOwnedPacks,
  ownerSkinsFromRoster,
  sanitizeSkins,
  selectedSkins,
} from './dlcCatalog.js';
import {
  replayCatchUp,
  formatMatchTime,
  matchSecondsFromTick,
  shouldExportFreshCatchupCheckpoint,
} from './catchup.js';
import { LOCKSTEP_STALL_UI_MS } from './simSession.js';
import {
  BROADCAST_CHUNK_CHARS,
  BROADCAST_LEDGER_CHUNK_FRAMES,
  CHECKPOINT_CHUNK_CHARS,
  LEDGER_CHUNK_FRAMES,
  createChunkAssembler,
  createLedgerAssembler,
  packCheckpointChunks,
  packLedgerChunks,
} from './kothCheckpointWire.js';
import { CMD } from '../sim/commands.js';
import { kothWipedOwners } from '../sim/kothMeta.js';
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
  removeNode,
  assignSponsor,
  promoteObserverToPlayer,
  demotePlayerToObserver,
  offerEligibleUserIds,
  listObserversByJoin,
  recomputeDepths,
  reconcilePlayers,
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
import { generateLobbyName } from '../koth/lobbyName.js';
import {
  CHAT_MIN_INTERVAL_MS,
  CHAT_TYPE,
  chatSpeakPayload,
  createChatLog,
  ingestChat,
  makeChatMessage,
  unwrapChatMessage,
} from '../lobby/chat.js';
import {
  isLiveMatchMember,
  isMatchLeavePresence,
  isSpectatorMember,
  relinquishesActiveSeat,
} from '../koth/presence.js';
import {
  canSkipCatchupRequest,
  canUseCatchupCheckpoint,
  catchupOfferChecksum,
  catchupRequestTick,
  expectCatchupLedgerChunks,
  isSoloLiveSpectatorOffer,
  needsCatchupCheckpoint,
  resolveCatchupOfferWorld,
  shouldKeepSpectatorJoin,
  shouldRestartSpectatorCatchup,
  soloLiveOfferHasWorld,
} from './spectatorAttach.js';
import {
  JOIN_CONFIRM_GRACE_MS,
  CLAIM_SETTLE_MS,
  MAX_SLOT_CLAIM_ATTEMPTS,
  SLOT_CLAIM_TIMEOUT_MS,
  canAdmitJoinerToQuorum,
  canClaimSeatNow,
  catchupOfferLedger,
  framesAfterTick,
  joinConfirmExpired,
  joinQuorumTick,
  joinSpawnTick,
  mergeHeldConfirms,
  shouldApplyOfferState,
  shouldBroadcastLockstepFallback,
  shouldHoldLockstepDuringCatchup,
} from './joinLockstep.js';
import {
  createEmptyRoster,
  rosterFromPeers,
  countActive,
  lowestActiveUserId,
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

// Spawn runway for a join. This has to cover the joiner's distance plus a
// relayed round trip before their first confirm admits them to quorum.
const JOIN_DELAY_TICKS = 40;
/** Ticks a fresh joiner holds its input for while peers take its first confirm. */
const JOIN_INPUT_SETTLE_TICKS = 20;
// 4: every join is a drop-in SPAWN_SLOT; the first challenger no longer rebuilds
// the board (which used to reset every spectator's catch-up and queued claim).
const KOTH_PROTOCOL_VERSION = 4;
const MIN_LIVE_PLAYERS = 2;
const MAX_ACTIVE_PLAYERS = 5;
// How long to listen in the matchmaking lobby for an existing match before
// creating a new one, so two players pressing start near-simultaneously join the
// same match instead of each spawning their own.
const CATCHUP_OFFER_TIMEOUT_MS = 8000;
// The seat offer is re-announced slowly so a peer that missed it (or joined
// after it was minted) still hears about it, without putting a message on the
// wire every commit.
const OFFER_REANNOUNCE_MS = 3000;
// Eligibility is recomputed off the observer tree; throttle it so the king is
// not sorting the observer crowd 20 times a second.
const OFFER_RECOMPUTE_MS = 250;
// Relay chunk pacing. Every millisecond spent here becomes lag the joiner has to
// burn down after attaching, so keep it brisk — just not a single burst that the
// relay drops on the floor.
const RELAY_CHUNK_INTERVAL_MS = 8;
const RELAY_CHUNK_BATCH = 4;
/** Repaint the catch-up progress line at most this often. */
const CATCHUP_PROGRESS_MS = 250;
/** How often a live client publishes its tick in presence (liveness + discovery). */
const TICK_PRESENCE_MS = 250;
/** Announced tick dropping by more than this means the match restarted at 0. */
const MATCH_TICK_RESET_SLACK = 200;
/** Only trust the announced live tick while it is still advancing. */
const LIVE_TICK_FRESH_MS = 2000;
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

function addListener(set, fn) {
  if (typeof fn !== 'function') return () => {};
  set.add(fn);
  return () => { set.delete(fn); };
}

function emitListeners(set, ...args) {
  for (const fn of set) {
    try { fn(...args); } catch (err) { console.error(err); }
  }
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
  const onLeaveSolo = options.onLeaveSolo ?? (() => {});
  let armyPerSide = (options.armyPerSide | 0) || 0;

  if (typeof globalThis.GETFIREP2P !== 'function') {
    throw new Error('GETFIREP2P not loaded');
  }

  let p2p = null;
  const broadcastListeners = new Set();
  const lobbyMessageListeners = new Set();
  const dataListeners = new Set();
  const peerConnectedListeners = new Set();
  const peerDisconnectedListeners = new Set();
  const matchLobbyConnectedListeners = new Set();
  const chatListeners = new Set();
  let localUserId = null;
  let session = null;
  /** 1v1 / teams / adventure hold — don't wrap commands as KOTH lockstep. */
  let lobbyMatchHold = false;
  const chatLog = createChatLog();
  let lastChatSendAt = 0;

  let matchId = generateMatchId();
  let phase = SHARD_PHASE.SANDBOX;
  let roster = createEmptyRoster();
  roster[0] = { userId: null, state: 'active', playerId: 0 };
  let seed = 0x1234;
  let localPlayerId = 0;
  let appState = KOTH_APP_STATE.PRIVATE_SANDBOX;
  let role = 'player';
  let catchUpReady = true;
  /** True only after the local sim is the host match — not the 3-villager stub. */
  let liveSimAttached = false;
  let matchStartSlots = [0];
  let matchHumanPlayers = [0];
  /** Player ids already eliminated this match — don't submit FORCE_ELIMINATE twice. */
  const defeatedPlayers = new Set();
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
  /** @type {Map<number, object[]>} tick -> accepted joins that become active after spawn */
  const pendingAcceptedJoins = new Map();
  let pendingLocalJoin = null;
  let activeCatchupRequestId = '';
  /** True while replayCatchUp is awaited — blocks overlapping offers/retries. */
  let catchupInFlight = false;
  /** Bumped when the live match is replaced so an in-flight replay cannot apply. */
  let catchupEpoch = 0;
  let catchupRetryTimer = null;
  /** Shared in-flight host checkpoint export (multiple spectators can request at once). */
  let catchupExportInFlight = null;
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
  /** userId -> display name from presence. */
  const peerNames = new Map();
  // Set when the player picks a listed lobby or starts their own. Stops
  // convergeToBestMatch from yanking them onto a "stronger" match.
  let pinnedMatchId = null;
  /** matchId -> Set<userId> everyone who has announced that live match */
  const matchAnnouncers = new Map();
  /** userIds seen in the current match lobby (player_join / player_rejoin). */
  const lobbyPeers = new Set();
  /** Spectators who announced THIS live match — not browsers on the firehose. */
  const matchLobbySpectators = new Set();
  /** userId -> last live presence / match-lobby join for this shard. */
  const matchMemberSeenAt = new Map();
  const MATCH_MEMBER_TTL_MS = SHARD_ANNOUNCE_MS * 3 + 2000;
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
  /** @type {string[]} */
  let offerEligible = [];
  let localOfferEligible = false;
  /** Last offer HUD string — presence heartbeats must not retrigger it. */
  let lastOfferStatus = '';
  let offerExpandTimer = null;
  /** Last offer put on the wire. onCommit refreshes at tick rate; only changes ship. */
  let lastOfferSignature = '';
  let lastOfferSentAt = 0;
  let lastOfferComputedAt = 0;
  /** Highest closed epoch — blocks a stale heartbeat from re-arming a dead offer. */
  let endedOfferEpoch = 0;
  /** King whose offer epochs we mirror. Changes reset the epoch window. */
  let offerAuthorityId = null;
  let claimTimer = null;
  let claimSettleTimer = null;
  let claimAttempts = 0;
  /** Claim requested while still catching up — fires once we are level. */
  let claimWhenLevel = false;
  /** When catch-up last completed — seeded peer confirms need a moment to settle. */
  let catchUpReadyAt = 0;
  /** playerId -> reserved joiner we are still waiting on (king only). */
  const joinConfirmWatch = new Map();
  /** playerId -> earliest tick a joiner may enter our lockstep quorum. */
  const pendingQuorum = new Map();
  /** Tick at which our own freshly joined seat gets its controls (0 = now). */
  let inputEnableTick = 0;
  let lastCheckpointTickPublished = 0;
  const checkpointAssembler = createChunkAssembler();
  const ledgerAssembler = createLedgerAssembler();
  /** Incoming catch-up pieces keyed by requestId. */
  const pendingCatchupParts = new Map();
  /** Outbound relay chunks, paced so the broadcast channel does not drop them. */
  let relayChunkQueue = [];
  let relayChunkTimer = null;
  let lastCatchupProgressAt = 0;
  let lastTickPresenceAt = 0;
  /** Live frames / confirms that arrived while reset() wiped the session ledger. */
  const heldCatchupFrames = [];
  const heldCatchupConfirms = [];

  let bootResolve = null;
  const bootPromise = new Promise((r) => {
    bootResolve = r;
  });

  /** userId → per-unit cosmetic pack ids (render-only, not hashed into sim). */
  const userSkins = new Map();
  /** userId → profile hex (render-only; every client must paint the same army). */
  const userColors = new Map();

  function localDlc() {
    return localOwnedPacks(aetherSteam.ownedPacks());
  }

  function localSkins() {
    return selectedSkins(localDlc(), getUnitSkins());
  }

  function rememberUserSkins(userId, skins) {
    if (!userId || !skins || typeof skins !== 'object' || Array.isArray(skins)) return;
    userSkins.set(String(userId), sanitizeSkins(skins));
  }

  function rememberUserDlc(userId, dlc) {
    if (!userId || !Array.isArray(dlc)) return;
    rememberUserSkins(userId, selectedSkins(dlc, {}));
  }

  function ownerSkinsNow() {
    if (localUserId) rememberUserSkins(localUserId, localSkins());
    const fromRoster = ownerSkinsFromRoster(roster, userSkins);
    if (localPlayerId >= 0 && fromRoster[localPlayerId] == null) {
      const skins = localSkins();
      if (Object.keys(skins).length) fromRoster[localPlayerId] = skins;
    }
    return fromRoster;
  }

  function localColor() {
    return sanitizeOwnerColor(getPlayerColor());
  }

  function rememberUserColor(userId, hex) {
    const clean = sanitizeOwnerColor(hex);
    if (!userId || !clean) return false;
    const key = String(userId);
    if (userColors.get(key) === clean) return false;
    userColors.set(key, clean);
    return true;
  }

  function ownerColorsNow() {
    if (localUserId) rememberUserColor(localUserId, localColor());
    return ownerColorsFromRoster(roster, userColors);
  }

  function liveConfig(reset = false) {
    return {
      mode: 'koth',
      seed,
      localPlayerId,
      localUserId,
      appState,
      roster: cloneSlots(roster),
      humanPlayers: [...matchHumanPlayers],
      aiPlayers: [],
      role,
      matchId,
      phase,
      activeSlots: matchStartSlots.length ? [...matchStartSlots] : activePlayerIds(roster),
      armyPerSide,
      startKey: liveStartKey,
      tick: session?.confirmedTick ?? 0,
      ownerSkins: ownerSkinsNow(),
      ownerColors: ownerColorsNow(),
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
    if (lobbyMatchHold) return;
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
        name: getPlayerName(),
        lobbyName: generateLobbyName(matchId),
        dlc: localDlc(),
        skins: localSkins(),
        color: localColor(),
        role,
        appState,
        v: KOTH_PROTOCOL_VERSION,
        peers: connectedPeerIds(),
        sponsorId: assignedSponsorId,
        observerDepth,
        // Seat eligibility depends on this. Repeating it here means a dropped
        // CATCHUP_READY costs one heartbeat, not the rest of the match.
        caughtUp: phase === SHARD_PHASE.LIVE ? !!catchUpReady : undefined,
        // Only the king mints offers. A spectator echoing its mirrored copy lets
        // a closed epoch come back to life on peers that already ended it.
        offerEpoch: offerEpoch && isKing() ? offerEpoch : undefined,
        offerEligible: offerEpoch && isKing() && offerEligible.length ? offerEligible : undefined,
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
    assignSponsor(observerTree, livePlayerUserIds(), observerUserId);
    recomputeDepths(observerTree);
    const node = observerTree.nodes.get(observerUserId);
    if (!node?.sponsorId) return node;
    sendAll({
      type: MSG.SPONSOR_ASSIGN,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      userId: observerUserId,
      sponsorId: node.sponsorId,
      depth: node.depth,
    });
    return node;
  }

  function noteObserverCaughtUp(userId) {
    noteObserverCaughtUpState(userId, true);
  }

  /**
   * Seat eligibility hinges on this flag, and CATCHUP_READY is a single
   * fire-and-forget message — one drop used to leave that joiner waiting for an
   * offer for the rest of the match. Presence repeats the same state every
   * heartbeat, so this must be cheap and idempotent.
   */
  function noteObserverCaughtUpState(userId, ready) {
    if (!userId) return;
    const existing = observerTree.nodes.get(userId);
    const changed = !!existing?.caughtUp !== !!ready;
    upsertNode(observerTree, userId, {
      role: userIdsMatch(userId, localUserId) && role === 'player' ? 'player' : 'observer',
      caughtUp: !!ready,
      joinedAt: existing?.joinedAt ?? Date.now(),
    });
    if (!isKing() || userIdsMatch(userId, localUserId)) return;
    if (ready && !observerTree.nodes.get(userId)?.sponsorId) kingAssignObserver(userId);
    if (changed) refreshSlotOffer([], { force: true });
  }

  /** A seat holder (or mid-join claimer) must never appear in an offer. */
  function offerExcluded(userId) {
    if (!userId) return true;
    for (const slot of roster) {
      if (!slot.userId || (slot.state !== 'active' && slot.state !== 'reserved')) continue;
      if (userIdsMatch(slot.userId, userId)) return true;
    }
    for (const list of pendingAcceptedJoins.values()) {
      for (const join of list) {
        if (join.userId && userIdsMatch(join.userId, userId)) return true;
      }
    }
    return false;
  }

  /** Bring tree roles in line with the roster; king publishes the resulting moves. */
  function reconcileObserverRoles() {
    const assignments = reconcilePlayers(observerTree, livePlayerUserIds());
    if (assignments.length) publishSponsorHandoffs(assignments);
    return assignments;
  }

  /** Epochs must outrank anything already closed, even if our clock lags. */
  function nextOfferEpoch() {
    return Math.max(Date.now(), endedOfferEpoch + 1, offerEpoch + 1);
  }

  function clearOfferExpandTimer() {
    if (offerExpandTimer) {
      clearTimeout(offerExpandTimer);
      offerExpandTimer = null;
    }
  }

  /**
   * Publish the open-seat offer. Called from onCommit, so it must be cheap and
   * idempotent: recompute on a short throttle, and only put a SLOT_OFFER on the
   * wire when the eligible set actually changed (plus a slow re-announce).
   */
  function refreshSlotOffer(extraEligible = [], { force = false } = {}) {
    if (!isKing() || phase !== SHARD_PHASE.LIVE) return;
    const active = countActive(roster);
    if (active >= MAX_ACTIVE_PLAYERS) {
      endSlotOffer('full');
      return;
    }
    const now = Date.now();
    const hot = force || !offerEpoch || extraEligible.length > 0;
    if (!hot && now - lastOfferComputedAt < OFFER_RECOMPUTE_MS) return;
    lastOfferComputedAt = now;

    reconcileObserverRoles();
    if (!offerEpoch) {
      offerEpoch = nextOfferEpoch();
      offerExpandSteps = 0;
      clearOfferExpandTimer();
    }
    const eligible = offerEligibleUserIds(observerTree, offerExpandSteps, {
      exclude: offerExcluded,
      minCandidates: MAX_ACTIVE_PLAYERS - active,
    });
    for (const id of extraEligible) {
      if (!id || offerExcluded(id)) continue;
      if (!eligible.some((e) => userIdsMatch(e, id))) eligible.push(id);
    }
    const signature = `${offerEpoch}|${active}|${eligible.join(',')}`;
    if (force || signature !== lastOfferSignature || now - lastOfferSentAt >= OFFER_REANNOUNCE_MS) {
      if (DEBUG_KOTH && signature !== lastOfferSignature) {
        console.info('[KOTH] offer', {
          epoch: offerEpoch,
          expandSteps: offerExpandSteps,
          eligible: eligible.map(shortId),
          observers: [...observerTree.nodes.values()]
            .filter((n) => n.role === 'observer')
            .map((n) => `${shortId(n.userId)}:L${n.depth}${n.caughtUp ? ':ready' : ''}${offerExcluded(n.userId) ? ':seated' : ''}`),
        });
      }
      lastOfferSignature = signature;
      lastOfferSentAt = now;
      sendAll({
        type: MSG.SLOT_OFFER,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        offerEpoch,
        eligible,
        expandSteps: offerExpandSteps,
        activeCount: active,
      });
    }
    applyLocalOfferState(offerEpoch, eligible, { from: localUserId });
    scheduleOfferExpand();
  }

  // One expand step every OFFER_EXPAND_MS. The timer must survive a refresh —
  // re-arming it on every refresh (which onCommit does at tick rate) meant it
  // could never fire, so eligibility never cascaded past L1.
  function scheduleOfferExpand() {
    if (offerExpandTimer) return;
    if (!isKing() || !offerEpoch || countActive(roster) >= MAX_ACTIVE_PLAYERS) return;
    offerExpandTimer = setTimeout(() => {
      offerExpandTimer = null;
      if (!isKing() || !offerEpoch || countActive(roster) >= MAX_ACTIVE_PLAYERS) return;
      offerExpandSteps += 1;
      refreshSlotOffer([], { force: true });
    }, OFFER_EXPAND_MS);
  }

  function endSlotOffer(reason = 'filled', winnerUserId = null) {
    clearOfferExpandTimer();
    const endedEpoch = offerEpoch;
    offerEpoch = 0;
    offerExpandSteps = 0;
    offerEligible = [];
    localOfferEligible = false;
    lastOfferSignature = '';
    if (endedEpoch) {
      endedOfferEpoch = Math.max(endedOfferEpoch, endedEpoch);
      sendAll({
        type: MSG.SLOT_OFFER_END,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        offerEpoch: endedEpoch,
        reason,
        winnerUserId: winnerUserId ?? undefined,
      });
    }
    if (
      role === 'spectator' &&
      (appState === KOTH_APP_STATE.QUEUED || appState === KOTH_APP_STATE.SPECTATOR) &&
      catchUpReady
    ) {
      lastOfferStatus = reason === 'full' ? 'Match full — spectating' : 'Seat claimed — spectating';
      onStatus(lastOfferStatus);
    } else {
      lastOfferStatus = '';
    }
  }

  /** A claim is in flight — offer gossip must not steal the HUD back. */
  function claimPending() {
    return !!pendingLocalJoin || appState === KOTH_APP_STATE.JOINING;
  }

  function applyLocalOfferState(epoch, eligible, { from = null } = {}) {
    // Epochs are Date.now() — `| 0` would wrap them to 32 bits and break every
    // monotonic comparison the moment the clock crosses a 2^32 ms boundary.
    const next = Number.isFinite(epoch) ? Math.trunc(epoch) : 0;
    const mine = !from || userIdsMatch(from, localUserId);
    if (!mine && !shouldApplyOfferState({
      incomingEpoch: next,
      currentEpoch: offerEpoch,
      endedEpoch: endedOfferEpoch,
    })) {
      return;
    }
    if (next !== offerEpoch) claimAttempts = 0;
    offerEpoch = next;
    offerEligible = Array.isArray(eligible) ? [...eligible] : [];
    if (from) offerAuthorityId = from;
    localOfferEligible = offerEligible.some((id) => userIdsMatch(id, localUserId));
    if (role !== 'spectator' || !catchUpReady || claimPending()) return;

    let nextStatus = '';
    if (countActive(roster) >= MAX_ACTIVE_PLAYERS) {
      appState = KOTH_APP_STATE.QUEUED;
      nextStatus = 'Match full — waiting for a seat…';
    } else if (localOfferEligible) {
      appState = KOTH_APP_STATE.SPECTATOR;
      nextStatus =
        observerDepth > 1
          ? `Seat offered (L${observerDepth}) — J to claim`
          : 'Seat offered — J to claim';
    } else {
      appState = KOTH_APP_STATE.QUEUED;
      nextStatus =
        observerDepth > 0
          ? `Waiting for offer (L${observerDepth})…`
          : 'Waiting for seat offer…';
    }
    if (nextStatus !== lastOfferStatus) {
      lastOfferStatus = nextStatus;
      onStatus(nextStatus);
    }
    emitShard();
  }

  /**
   * Only the king mints offers. A spectator heartbeat that still carries the
   * previous epoch is stale by construction, so it must not be applied.
   */
  function isOfferAuthority(userId) {
    if (!userId) return false;
    if (userIdsMatch(userId, localUserId)) return isKing();
    const hostId = rosterHostUserId();
    if (hostId && userIdsMatch(userId, hostId)) return true;
    // Until the host world lands our roster is a guess, so we cannot tell who
    // the king is — don't reject the real one over a mis-seeded roster.
    return !liveSimAttached;
  }

  /**
   * The king is whoever holds the lowest live seat, so it changes when a host
   * leaves. Drop the previous king's epoch window — their wall clock may have
   * been ahead of the new one, which would reject every new offer as stale.
   */
  function syncOfferAuthority() {
    const hostId = rosterHostUserId();
    if (!hostId) return;
    if (!offerAuthorityId) {
      offerAuthorityId = hostId;
      return;
    }
    if (userIdsMatch(offerAuthorityId, hostId)) return;
    if (DEBUG_KOTH) {
      console.info('[KOTH] offer authority changed', {
        from: shortId(offerAuthorityId),
        to: shortId(hostId),
      });
    }
    offerAuthorityId = hostId;
    offerEpoch = 0;
    offerEligible = [];
    localOfferEligible = false;
    endedOfferEpoch = 0;
    lastOfferSignature = '';
    lastOfferSentAt = 0;
    lastOfferComputedAt = 0;
    claimAttempts = 0;
    clearOfferExpandTimer();
  }

  function childObserverIds() {
    return observerTree.childrenOf.get(localUserId) ?? [];
  }

  function isAssignedChild(userId) {
    return childObserverIds().some((id) => userIdsMatch(id, userId));
  }

  /**
   * @param {string} userId requester
   * @param {string | null | undefined} claimedSponsorId the requester's own view
   *   of its sponsor. The requester is the authority on what it actually knows:
   *   if its SPONSOR_ASSIGN never landed, our tree names a sponsor it has never
   *   heard of, and refusing on that basis stranded it on the loading screen.
   */
  function canServeCatchUpFor(userId, claimedSponsorId = undefined) {
    if (!userId || userIdsMatch(userId, localUserId)) return false;
    const claimsUs = claimedSponsorId != null && userIdsMatch(claimedSponsorId, localUserId);
    const unassigned = claimedSponsorId === null;
    if (role === 'player' && localPlayerId >= 0) {
      // Players serve their L1 child, plus any observer that has no sponsor yet.
      if (claimsUs || isAssignedChild(userId)) return true;
      if (unassigned) return true;
      const node = observerTree.nodes.get(userId);
      return !node?.sponsorId || userIdsMatch(node.sponsorId, localUserId);
    }
    if (role === 'spectator' && catchUpReady) {
      return claimsUs || isAssignedChild(userId);
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
    sendCheckpointChunks({ peerId, checkpoint, checksum, tick });
  }

  /**
   * A data channel takes a burst of chunks; the server relay does not. Pace them
   * out — the receiver re-arms its catch-up timeout on every chunk, so a paced
   * world still lands well inside the retry window.
   */
  function queueRelayChunk(msg) {
    relayChunkQueue.push({ msg, matchId });
    if (relayChunkTimer) return;
    const pump = () => {
      relayChunkTimer = null;
      for (let i = 0; i < RELAY_CHUNK_BATCH; i++) {
        const next = relayChunkQueue.shift();
        if (!next) return;
        if (next.matchId === matchId) sendBroadcastMsg(next.msg);
      }
      if (relayChunkQueue.length) relayChunkTimer = setTimeout(pump, RELAY_CHUNK_INTERVAL_MS);
    };
    relayChunkTimer = setTimeout(pump, 0);
  }

  function clearRelayChunkQueue() {
    relayChunkQueue = [];
    if (relayChunkTimer) {
      clearTimeout(relayChunkTimer);
      relayChunkTimer = null;
    }
  }

  /**
   * Ship a world checkpoint as chunks. With no data channel the chunks go over
   * the broadcast relay (smaller pieces, addressed with `to`) — a whole world
   * inline on one relay message is silently dropped, which left the joiner
   * waiting on "Receiving host world…" forever.
   */
  function sendCheckpointChunks({ peerId = null, toUserId = null, checkpoint, checksum, tick }) {
    const transferId = `cp:${matchId}:${tick}:${localUserId}`;
    const relay = !peerId;
    const packed = packCheckpointChunks(
      checkpoint,
      transferId,
      relay ? BROADCAST_CHUNK_CHARS : CHECKPOINT_CHUNK_CHARS,
    );
    for (let i = 0; i < packed.chunks.length; i++) {
      const msg = {
        type: MSG.CHECKPOINT_CHUNK,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        transferId,
        index: i,
        total: packed.total,
        text: packed.chunks[i],
        tick,
        checksum,
        to: toUserId ?? undefined,
      };
      if (relay) queueRelayChunk(msg);
      else sendPeer(peerId, msg);
    }
  }

  function sendLedgerChunks({ peerId = null, toUserId = null, ledger, transferId, meta }) {
    const relay = !peerId;
    const packed = packLedgerChunks(
      ledger,
      transferId,
      relay ? BROADCAST_LEDGER_CHUNK_FRAMES : LEDGER_CHUNK_FRAMES,
    );
    for (let i = 0; i < packed.chunks.length; i++) {
      const msg = {
        type: MSG.LEDGER_CHUNK,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        transferId,
        index: i,
        total: packed.total,
        frames: packed.chunks[i],
        to: toUserId ?? undefined,
        ...meta,
      };
      if (relay) queueRelayChunk(msg);
      else sendPeer(peerId, msg);
    }
  }

  function shardLobbyName(id = matchId) {
    return `${LOBBY}:${id}`;
  }

  /** Chat is meaningful once we're in a shared shard (not the solo sandbox). */
  function isChatActive() {
    return appState !== KOTH_APP_STATE.PRIVATE_SANDBOX;
  }

  function noteChat(raw, { requireMatchId = false } = {}) {
    if (!unwrapChatMessage(raw)) return false;
    if (requireMatchId && raw?.matchId && raw.matchId !== matchId) return true;
    if (isChatActive() && ingestChat(chatLog, raw)) emitListeners(chatListeners);
    return true;
  }

  /** Chat over the shard room. Local paint first; wire uses GetFire `content`
   *  plus the presence broadcast and RTC so other clients actually receive it. */
  function sendChat(text) {
    if (!isChatActive()) return false;
    const now = Date.now();
    if (now - lastChatSendAt < CHAT_MIN_INTERVAL_MS) return false;
    const msg = makeChatMessage({
      from: localUserId,
      name: getPlayerName(),
      color: getPlayerColor(),
      text,
    });
    if (!msg) return false;
    lastChatSendAt = now;
    if (chatLog.add(msg)) emitListeners(chatListeners);
    const room = appState === KOTH_APP_STATE.MATCHMAKING
      ? MATCHMAKING_LOBBY
      : shardLobbyName(matchId);
    p2p?.sendLobbyMessage?.(room, chatSpeakPayload(msg));
    p2p?.broadcast?.({ ...msg, matchId }, BROADCAST);
    p2p?.sendData?.(msg);
    return true;
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
    matchLobbySpectators.clear();
    matchMemberSeenAt.clear();
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
    if (lobbyMatchHold) return;
    joinLobby(MATCHMAKING_LOBBY, false);
  }

  function leaveMatchmakingLobby() {
    if (!joinedLobbies.has(MATCHMAKING_LOBBY)) return;
    joinedLobbies.delete(MATCHMAKING_LOBBY);
    p2p?.leaveMatchLobby?.(MATCHMAKING_LOBBY);
  }

  // Park KOTH discovery while another game type is live. Broadcast stays up so
  // 1v1 / teams / adventure can still use the same P2P instance; we just leave
  // the KOTH catalog and stop announcing.
  function parkKothDiscovery() {
    cancelDiscoverStart();
    leaveShardLobby(shardLobbyName(matchId));
    leaveMatchmakingLobby();
  }

  // The actual match lobby — this is where P2P/RTC is established. Joined in
  // addition to the discovery lobby.
  function joinShardLobby() {
    if (lobbyMatchHold) return;
    joinMatchmakingLobby();
    joinLobby(shardLobbyName(), true);
  }

  function notePeerName(userId, name) {
    if (!userId || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed) peerNames.set(userId, trimmed);
  }

  function nameForUser(userId) {
    if (!userId) return '';
    if (userIdsMatch(userId, localUserId)) return getPlayerName();
    const direct = peerNames.get(userId);
    if (direct) return direct;
    for (const [id, name] of peerNames) {
      if (userIdsMatch(id, userId)) return name;
    }
    const live = liveMatches.get(matchId);
    if (live?.hostName && live.from && userIdsMatch(live.from, userId)) return live.hostName;
    return '';
  }

  function lobbyPlayers() {
    const stalled = (session?.lockstepBlockedMs?.() ?? 0) >= LOCKSTEP_STALL_UI_MS;
    const waitingOn = new Set(stalled ? (session?.lockstepWaiters?.() ?? []) : []);
    const out = [];
    for (const slot of roster) {
      if (slot.state !== 'active' || !slot.userId) continue;
      const you = userIdsMatch(slot.userId, localUserId);
      out.push({
        playerId: slot.playerId,
        userId: slot.userId,
        name: nameForUser(slot.userId) || `Player ${(slot.playerId | 0) + 1}`,
        you,
        lagging: waitingOn.has(slot.playerId),
      });
    }
    if (out.length) return out;
    const live = liveMatches.get(matchId);
    if (live?.from || live?.hostName) {
      out.push({
        playerId: 0,
        userId: live.from ?? '',
        name: live.hostName || nameForUser(live.from) || 'Host',
        you: !!(live.from && userIdsMatch(live.from, localUserId)),
      });
    }
    return out;
  }

  function isSeatedUser(userId) {
    if (!userId) return false;
    for (const slot of roster) {
      if (slot.state === 'active' && slot.userId && userIdsMatch(slot.userId, userId)) {
        return true;
      }
    }
    return false;
  }

  function alreadyListedUser(seen, userId) {
    if (!userId) return true;
    if (seen.has(userId)) return true;
    for (const id of seen) {
      if (userIdsMatch(id, userId)) return true;
    }
    return false;
  }

  function lobbySpectators() {
    const seen = new Set();
    const out = [];
    const add = (userId) => {
      if (!userId || isSeatedUser(userId) || alreadyListedUser(seen, userId)) return;
      seen.add(userId);
      out.push({
        userId,
        name: nameForUser(userId) || 'Spectator',
        you: userIdsMatch(userId, localUserId),
        spectator: true,
      });
    };
    // Membership is the match lobby + live presence for this matchId.
    // Global broadcast / observer-tree gossip is discovery, not a seat.
    if (role === 'spectator' && phase === SHARD_PHASE.LIVE) add(localUserId);
    for (const uid of matchLobbySpectators) add(uid);
    for (const uid of lobbyPeers) add(uid);
    return out;
  }

  function dropMatchingIds(collection, userId) {
    if (!userId || !collection) return;
    if (collection instanceof Map) {
      for (const id of [...collection.keys()]) {
        if (userIdsMatch(id, userId)) collection.delete(id);
      }
      return;
    }
    for (const id of [...collection]) {
      if (userIdsMatch(id, userId)) collection.delete(id);
    }
  }

  function touchMatchMember(userId) {
    if (!userId || userIdsMatch(userId, localUserId)) return;
    matchMemberSeenAt.set(userId, Date.now());
  }

  function forgetMatchMember(userId) {
    if (!userId || userIdsMatch(userId, localUserId)) return;
    dropMatchingIds(lobbyPeers, userId);
    dropMatchingIds(matchLobbySpectators, userId);
    dropMatchingIds(peerPresenceRole, userId);
    dropMatchingIds(matchMemberSeenAt, userId);
    dropMatchingIds(matchAnnouncers.get(matchId), userId);
    const live = liveMatches.get(matchId);
    dropMatchingIds(live?.spectatorIds, userId);
    let treeId = observerTree.nodes.has(userId) ? userId : '';
    if (!treeId) {
      for (const id of observerTree.nodes.keys()) {
        if (userIdsMatch(id, userId)) {
          treeId = id;
          break;
        }
      }
    }
    if (treeId) {
      const orphans = removeNode(observerTree, treeId);
      recomputeDepths(observerTree);
      syncLocalObserverPlacement();
      if (isKing() && phase === SHARD_PHASE.LIVE) {
        for (const oid of orphans) kingAssignObserver(oid);
        refreshSlotOffer([], { force: true });
      }
    }
  }

  function lastSeenMatchMember(userId) {
    if (!userId) return null;
    if (matchMemberSeenAt.has(userId)) return matchMemberSeenAt.get(userId);
    for (const [id, ts] of matchMemberSeenAt) {
      if (userIdsMatch(id, userId)) return ts;
    }
    return null;
  }

  function pruneStaleMatchMembers(now = Date.now()) {
    if (phase !== SHARD_PHASE.LIVE) return;
    const ids = new Set([...lobbyPeers, ...matchLobbySpectators]);
    for (const uid of ids) {
      const seen = lastSeenMatchMember(uid);
      if (seen == null || now - seen > MATCH_MEMBER_TTL_MS) forgetMatchMember(uid);
    }
  }

  function broadcastMatchLeave(leavingId) {
    if (!p2p?.broadcast || !leavingId || !localUserId) return;
    p2p.broadcast(
      {
        type: MSG.SHARD_PRESENCE,
        matchId: leavingId,
        left: true,
        from: localUserId,
        name: getPlayerName(),
        role,
        appState,
        phase: SHARD_PHASE.SANDBOX,
        v: KOTH_PROTOCOL_VERSION,
      },
      BROADCAST,
    );
  }

  function pickLobbyName(data, prev) {
    const announced = typeof data?.lobbyName === 'string' ? data.lobbyName.trim() : '';
    if (announced) return announced;
    if (prev?.lobbyName) return prev.lobbyName;
    return generateLobbyName(data?.matchId);
  }

  function isPlayerAnnounce(data) {
    return data?.role === 'player' || data?.appState === KOTH_APP_STATE.LIVE_PLAYER;
  }

  function isSpectatorAnnounce(data) {
    return data?.role === 'spectator' || data?.appState === KOTH_APP_STATE.SPECTATOR;
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
    if (!data?.matchId) return;
    if (data.gone) {
      liveMatches.delete(data.matchId);
      matchAnnouncers.delete(data.matchId);
      return;
    }
    if (data.left && data.from) {
      const prev = liveMatches.get(data.matchId);
      dropMatchingIds(prev?.spectatorIds, data.from);
      return;
    }
    if (data.phase !== SHARD_PHASE.LIVE) return;
    if (data.from) noteMatchAnnouncer(data.matchId, data.from);
    if (data.from && typeof data.name === 'string') notePeerName(data.from, data.name);
    const now = Date.now();
    const active = data.activeCount ?? 0;
    const prev = liveMatches.get(data.matchId);
    const tick = data.tick ?? 0;
    const lobbyName = pickLobbyName(data, prev);
    if (!prev) {
      const spectatorIds = new Set();
      if (data.from && isSpectatorAnnounce(data)) spectatorIds.add(data.from);
      liveMatches.set(data.matchId, {
        matchId: data.matchId,
        from: data.from ?? null,
        hostName: isPlayerAnnounce(data) && typeof data.name === 'string' ? data.name : '',
        lobbyName,
        spectatorIds,
        activeCount: active,
        tick,
        ts: now,
        lastTickAt: tick > 0 ? now : now,
      });
      return;
    }
    prev.ts = now;
    prev.lobbyName = lobbyName;
    if (!prev.spectatorIds) prev.spectatorIds = new Set();
    if (data.from && isSpectatorAnnounce(data)) prev.spectatorIds.add(data.from);
    if (data.from && isPlayerAnnounce(data)) prev.spectatorIds.delete(data.from);
    // A big step backwards from the host we are following means the match was
    // rebuilt at tick 0 (solo→2 keeps the same matchId). Monotonic-only would
    // leave a stale high-water mark that makes every client look hopelessly
    // behind. Only the host may walk it back — a lagging spectator announcing
    // its own low tick must not drag the live clock down with it.
    // Live players are in lockstep with each other, so any of them reporting a
    // tick this far back means the board restarted — `prev.from` flips between
    // co-hosts and must not be the gate.
    const hostRestarted = isPlayerAnnounce(data) && tick + MATCH_TICK_RESET_SLACK < prev.tick;
    if (tick > prev.tick || hostRestarted) {
      prev.tick = tick;
      prev.lastTickAt = now;
    }
    // Keep the strongest announcer as the peer to connect to. Lobby titles come
    // from lobbyName, not the announcer's player name.
    if (active >= prev.activeCount) {
      prev.activeCount = active;
      if (data.from) prev.from = data.from;
      if (isPlayerAnnounce(data) && typeof data.name === 'string' && data.name) {
        prev.hostName = data.name;
      }
    } else if (!prev.from && data.from) {
      prev.from = data.from;
    }
  }

  function pruneLiveMatches(now = Date.now()) {
    for (const [id, m] of [...liveMatches]) {
      if (now - m.ts > LIVE_MATCH_TTL_MS) {
        liveMatches.delete(id);
        matchAnnouncers.delete(id);
      }
    }
  }

  function listLiveLobbies() {
    const now = Date.now();
    pruneLiveMatches(now);
    const out = [];
    for (const m of liveMatches.values()) {
      if (!m.from) continue;
      if (isStaleGhostMatch(m, now)) continue;
      out.push({
        matchId: m.matchId,
        from: m.from,
        lobbyName: m.lobbyName || generateLobbyName(m.matchId),
        hostName: m.hostName ?? '',
        activeCount: m.activeCount,
        spectatorCount: m.spectatorIds?.size ?? 0,
        tick: m.tick,
        seats: MAX_ACTIVE_PLAYERS,
      });
    }
    out.sort((a, b) => compareLiveMatches(b, a));
    return out;
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
    // A lobby the player created or picked from the list stays put, including
    // a solo host. Unpinned discovery can still fold two simultaneous starts.
    if (pinnedMatchId && matchId === pinnedMatchId) return false;
    if (role === 'player' && myActive >= MIN_LIVE_PLAYERS) return false;
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
    onStatus('Converging to match…');
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
    // Presence for the match we already occupy is gossip, never a transition.
    // During tick 0 a host may have no peer link yet; treating an echo as a new
    // match demoted the host and restarted discovery in a tight loop.
    if (presence.matchId === matchId && phase === SHARD_PHASE.LIVE) {
      if (presence.from) noteMatchAnnouncer(presence.matchId, presence.from);
      switchToMatchLobby(matchId);
      if (role === 'spectator') scheduleMatchLobbyConnect(presence.matchId);
      return true;
    }
    // Created or picked lobbies are pinned to this matchId before go-live.
    // Do not abandon them for a different match that is already on the list.
    if (pinnedMatchId && pinnedMatchId === matchId && presence.matchId !== matchId) return false;
    // Established multi-army matches never abandon via follow/converge. A solo
    // host is allowed to yield even after its clock or peer link has started.
    if (role === 'player' && phase === SHARD_PHASE.LIVE) {
      if (countActive(roster) >= MIN_LIVE_PLAYERS) return false;
    }
    cancelDiscoverStart();
    onLeaveSolo();
    const abandoningSolo = phase === SHARD_PHASE.LIVE && role === 'player';
    const prevMatchId = matchId;
    matchId = presence.matchId;
    if (prevMatchId !== matchId) {
      invalidateInFlightCatchup();
      resetDialState();
      switchToMatchLobby(matchId);
    }
    phase = SHARD_PHASE.LIVE;
    appState = KOTH_APP_STATE.SPECTATOR;
    role = 'spectator';
    catchUpReady = false;
    detachLiveSim();
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
    pauseStubSim();
    if (abandoningSolo && bootstrapTimer) {
      clearInterval(bootstrapTimer);
      bootstrapTimer = null;
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
    onStatus('Connecting to live match…');
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
    // 3+ tabs same machine). Seat / catch-up-ready must be here or the third
    // client never sees an offer and freezes after a claim that only the host got.
    if (
      shouldBroadcastLockstepFallback(msg.type)
      || (msg.type === MSG.JOIN_INTENT && connectedPeerIds().length === 0)
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
      type === MSG.CATCHUP_READY ||
      type === MSG.SLOT_OFFER ||
      type === MSG.SLOT_CLAIM ||
      type === MSG.SLOT_OFFER_END ||
      type === MSG.SPONSOR_ASSIGN ||
      type === MSG.SPONSOR_HANDOFF ||
      type === MSG.REQUEST_TICK_CONFIRM
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
    emitListeners(matchLobbyConnectedListeners, lobbyName);
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
      onStatus(n ? `Connecting to match… (${n} players heard)` : 'Connecting to match…');
      // WebRTC to a sponsor can fail to open entirely (common with several tabs on
      // one machine). This pump runs every few seconds, so fall back to a relayed
      // catch-up rather than sitting on the backdrop forever — otherwise the first
      // join is stuck whenever the one-shot lobby-connected broadcast timer is
      // missed. If a P2P link opens meanwhile, the timer's own guard defers to it.
      if (!activeCatchupRequestId && !catchupInFlight) scheduleBroadcastCatchup(2000);
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
    if (lobbyMatchHold) return;
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
    // Runs off a timer, not off commits — a stalled quorum is exactly when the
    // commit-driven checks stop firing.
    if (phase === SHARD_PHASE.LIVE) {
      checkJoinerConfirmTimeouts();
      checkPendingLocalJoinTimeout();
      pumpQueuedClaim();
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
        dlc: localDlc(),
        skins: localSkins(),
        color: localColor(),
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

  function detachLiveSim() {
    liveSimAttached = false;
  }

  function attachLiveSim() {
    liveSimAttached = true;
  }

  function pauseStubSim() {
    if (session) session.pauseLockstep = true;
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
    pinnedMatchId = null;
    catchUpReady = true;
    detachLiveSim();
    onStatus(`${reason} — new staging`);
    onLiveStart({
      mode: 'staging',
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

  function returnToPrivateSandbox() {
    cancelDiscoverStart();
    clearCatchupOfferTimer();
    clearOfferExpandTimer();
    clearClaimTimer();
    clearRelayChunkQueue();
    if (catchupRetryTimer) {
      clearTimeout(catchupRetryTimer);
      catchupRetryTimer = null;
    }
    if (broadcastCatchupTimer) {
      clearTimeout(broadcastCatchupTimer);
      broadcastCatchupTimer = null;
    }
    if (bootstrapTimer) {
      clearInterval(bootstrapTimer);
      bootstrapTimer = null;
    }
    resetDialState();
    pinnedMatchId = null;
    matchHostUserId = null;
    liveStartKey = '';
    activeCatchupRequestId = '';
    catchupInFlight = false;
    pendingLocalJoin = null;
    pendingAcceptedJoins.clear();
    pendingPresentationJoinTicks.clear();
    joinConfirmWatch.clear();
    pendingQuorum.clear();
    inputEnableTick = 0;
    claimWhenLevel = false;
    offerEpoch = 0;
    offerEligible = [];
    localOfferEligible = false;
    endedOfferEpoch = 0;
    offerAuthorityId = null;
    lastOfferSignature = '';
    lastOfferSentAt = 0;
    lastOfferComputedAt = 0;
    claimAttempts = 0;
    assignedSponsorId = null;
    observerDepth = 0;
    observerTree.nodes.clear();
    observerTree.childrenOf.clear();
    lobbyPeers.clear();
    matchLobbySpectators.clear();
    matchMemberSeenAt.clear();
    chatLog.clear();
    clearSavedMatch();
    matchId = generateMatchId();
    seed = 0x1234;
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    defeatedPlayers.clear();
    localPlayerId = 0;
    role = 'player';
    appState = KOTH_APP_STATE.PRIVATE_SANDBOX;
    phase = SHARD_PHASE.SANDBOX;
    catchUpReady = true;
    detachLiveSim();
    session?.setLocalPlayerId?.(0);
    session?.setRole?.('player');
    if (session) session.pauseLockstep = false;
    joinMatchmakingLobby();
    emitShard();
    broadcastPresence();
    onStatus('Left lobby');
  }

  function leaveLiveLobby() {
    if (appState === KOTH_APP_STATE.PRIVATE_SANDBOX && phase !== SHARD_PHASE.LIVE) {
      return false;
    }
    const leavingId = matchId;
    const wasLive = phase === SHARD_PHASE.LIVE;
    const wasPlayer = wasLive && role === 'player';
    const othersRemain = wasPlayer && countActive(roster) > 1;

    if (wasPlayer && othersRemain && localPlayerId >= 0) {
      const tick = (session?.confirmedTick ?? 0) + 2;
      const pid = localPlayerId;
      roster = releaseUser(roster, localUserId, true);
      sendAll({ type: MSG.SLOT_DEFEAT, matchId: leavingId, playerId: pid, userId: localUserId, tick });
    } else if (wasLive && wasPlayer) {
      sendAll({ type: MSG.SHARD_GONE, matchId: leavingId });
      broadcastPresence({ gone: true });
    }
    if (wasLive) broadcastMatchLeave(leavingId);

    liveMatches.delete(leavingId);
    matchAnnouncers.delete(leavingId);
    leaveShardLobby(shardLobbyName(leavingId));
    returnToPrivateSandbox();
    return true;
  }

  function joinActionLabel() {
    if (claimWhenLevel) return 'Catching Up…';
    if (claimPending()) return 'Claiming…';
    if (countActive(roster) >= MAX_ACTIVE_PLAYERS) return 'Match Full';
    if (localOfferEligible) return 'Claim Seat';
    return 'Waiting for Offer';
  }

  function getLobbyPresence() {
    const browsing = appState === KOTH_APP_STATE.PRIVATE_SANDBOX && phase !== SHARD_PHASE.LIVE;
    const live = liveMatches.get(matchId);
    const hosting = phase === SHARD_PHASE.LIVE && role === 'player';
    const playing = phase === SHARD_PHASE.LIVE && role === 'player' && countActive(roster) >= 2;
    const stalled = playing && (session?.lockstepBlockedMs?.() ?? 0) >= LOCKSTEP_STALL_UI_MS;
    pruneStaleMatchMembers();
    const spectators = lobbySpectators();
    return {
      parked: lobbyMatchHold,
      browsing,
      inLobby: !browsing,
      waiting: !browsing && (!playing || stalled),
      playing,
      stalled,
      matchId,
      phase,
      role,
      appState,
      hosting,
      lobbyName: live?.lobbyName || generateLobbyName(matchId),
      hostName: hosting ? getPlayerName() : (live?.hostName ?? ''),
      activeCount: hosting || phase === SHARD_PHASE.LIVE
        ? countActive(roster)
        : (live?.activeCount ?? 0),
      seats: MAX_ACTIVE_PLAYERS,
      tick: session?.confirmedTick ?? live?.tick ?? 0,
      canJoin: (
        catchUpReady &&
        !activeCatchupRequestId &&
        role === 'spectator' &&
        appState !== KOTH_APP_STATE.JOINING
      ),
      joinLabel: joinActionLabel(),
      players: lobbyPlayers(),
      spectators,
      spectatorCount: spectators.length,
    };
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
        detachLiveSim();
        session?.setLocalPlayerId?.(-1);
        session?.setRole?.('spectator');
        pauseStubSim();
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
        onStatus('Found live match — catching up');
      } else {
        roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
        onStatus('Joined match');
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
      aiPlayers: [],
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
      beginCatchup(sponsor);
    }, delayMs);
  }

  function notePlayerConfirm(playerId) {
    playerLastConfirm.set(playerId, performance.now());
  }

  function holdingCatchupLockstep() {
    return shouldHoldLockstepDuringCatchup({
      catchupInFlight,
      catchupRequested: !!activeCatchupRequestId,
      replayingCatchUp: !!session?.replayingCatchUp,
    });
  }

  function ingestCommandFrame(frame) {
    if (!validateCommandFrame(frame)) return;
    if (holdingCatchupLockstep()) {
      heldCatchupFrames.push(frame);
      return;
    }
    session?.bufferRemoteFrame(frame);
  }

  function ingestTickConfirm(msg) {
    if (msg.matchId !== matchId) return;
    if (msg.playerId === undefined || msg.tick === undefined) return;
    const slot = roster[msg.playerId];
    // Empty/defeated seats may keep emitting briefly while SLOT_DEFEAT crosses
    // the mesh. A reserved rejoiner is also not live until its spawn commits;
    // accepting either would admit stale confirms into the new reservation.
    if (slot?.state !== 'active') return;
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
    if (holdingCatchupLockstep()) {
      heldCatchupConfirms.push({ playerId: msg.playerId, tick: msg.tick });
      return;
    }
    admitPendingQuorum(msg.playerId, msg.tick);
    session?.setPeerConfirmedTick(msg.playerId, msg.tick);
    notePlayerConfirm(msg.playerId);
  }

  /**
   * Presence is the low-rate relay fallback for live clock progress. Tick
   * confirms can be throttled on the server relay, while presence continues to
   * reach spectators; only trust it for an active seat owned by its sender.
   */
  function ingestPresenceTick(data) {
    if (data.matchId !== matchId || data.phase !== SHARD_PHASE.LIVE) return;
    if (!isPlayerAnnounce(data) || !Number.isFinite(data.tick)) return;
    const slot = slotForKnownUser(data.from);
    if (slot?.state !== 'active' || !userIdsMatch(slot.userId, data.from)) return;
    ingestTickConfirm({
      matchId,
      userId: data.from,
      playerId: slot.playerId,
      tick: (data.tick | 0) + 1,
    });
  }

  function seedPeerConfirms(playerIds, tick) {
    for (const id of playerIds ?? []) {
      session?.setPeerConfirmedTick?.(id, tick);
      notePlayerConfirm(id);
    }
  }

  function flushHeldCatchupLockstep(tipTick) {
    const frames = heldCatchupFrames.splice(0);
    const confirms = heldCatchupConfirms.splice(0);
    for (const frame of framesAfterTick(frames, tipTick)) {
      session?.bufferRemoteFrame(frame);
    }
    const seeded = mergeHeldConfirms(confirms, matchHumanPlayers, tipTick);
    for (const [playerId, tick] of seeded) {
      admitPendingQuorum(playerId, tick);
      session?.setPeerConfirmedTick?.(playerId, tick);
      notePlayerConfirm(playerId);
    }
  }

  /** Release a reservation when a joiner never reaches its first live confirm. */
  function watchJoinerConfirm(playerId, userId, joinTick) {
    if (playerId == null || playerId < 0 || !userId) return;
    if (userIdsMatch(userId, localUserId)) return;
    joinConfirmWatch.set(playerId, {
      userId,
      joinTick: joinTick | 0,
      deadline: Date.now() + JOIN_CONFIRM_GRACE_MS,
    });
  }

  function checkJoinerConfirmTimeouts() {
    if (!joinConfirmWatch.size) return;
    const now = Date.now();
    for (const [playerId, watch] of [...joinConfirmWatch]) {
      const slot = roster[playerId];
      const stillOurs = slot?.userId && userIdsMatch(slot.userId, watch.userId);
      const confirmed = (session?.peerConfirmedTick?.get(playerId) ?? 0) > watch.joinTick;
      if (!stillOurs || confirmed) {
        joinConfirmWatch.delete(playerId);
        continue;
      }
      if (!joinConfirmExpired({ now, deadline: watch.deadline, confirmed })) continue;
      joinConfirmWatch.delete(playerId);
      if (!isKing()) continue;
      console.warn('[KOTH] joiner never entered lockstep — dropping', {
        playerId,
        user: shortId(watch.userId),
        joinTick: watch.joinTick,
      });
      onStatus('A joiner failed to sync — dropped');
      forceDefeatPlayer(playerId, watch.userId);
    }
  }

  /**
   * A remote joiner does NOT enter our lockstep quorum at a pre-agreed tick.
   *
   * It used to, and that is what froze the table: every peer parked at
   * `joinTick + 1` waiting on a client that might still be seconds away (or
   * might never arrive at all), and nothing but a watchdog could break it.
   * Instead we record the earliest tick they may enter and admit them the moment
   * their first confirm actually arrives — so nobody ever waits on a ghost.
   *
   * Admitting at slightly different local ticks across peers is safe: the joiner
   * authors no commands before its first confirm tick, so the frames collected
   * for the differing window are identical (empty) everywhere.
   */
  function scheduleJoinerQuorum(playerId, joinTick, userId = null) {
    if (playerId == null || playerId < 0 || !session) return;
    if (userId) watchJoinerConfirm(playerId, userId, joinTick);
    pendingQuorum.set(playerId, joinQuorumTick(joinTick));
    session.setPeerConfirmedTick?.(playerId, joinTick | 0);
  }

  /** Their first confirm at or past the agreed tick puts them in the quorum. */
  function admitPendingQuorum(playerId, tick, { force = false } = {}) {
    const earliest = pendingQuorum.get(playerId);
    if (earliest == null) {
      if (!force) return;
    } else if (!canAdmitJoinerToQuorum({ confirmTick: tick, earliestTick: earliest })) {
      return;
    }
    pendingQuorum.delete(playerId);
    joinConfirmWatch.delete(playerId);
    if (!matchHumanPlayers.includes(playerId)) {
      matchHumanPlayers = [...matchHumanPlayers, playerId].sort((a, b) => a - b);
    }
    session?.setHumanPlayers?.(matchHumanPlayers);
    if (DEBUG_KOTH) {
      console.info('[KOTH] joiner entered lockstep', { playerId, tick, ourTick: session?.confirmedTick });
    }
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
    const host = lowestActiveUserId(roster);
    if (host) return host;
    // Boot/reconciliation fallback before the authoritative roster arrives.
    if (role === 'player' && localPlayerId >= 0 && localUserId) return localUserId;
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
      clearClaimTimer();
      notePlayerInTree(localUserId);
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
    // Revolving KOTH spectators must keep simulating so they can claim the next
    // seat. No generic post-game or presentation path may leave an attached,
    // caught-up spectator paused.
    if (
      role === 'spectator'
      && catchUpReady
      && session.pauseLockstep
      && !session.replayingCatchUp
      && !catchupInFlight
    ) {
      session.pauseLockstep = false;
      session.simAcc = 0;
      if (DEBUG_KOTH) console.warn('[KOTH] resumed paused live spectator');
    }
    sendTickConfirm(session.confirmedTick + 1);
    checkJoinerConfirmTimeouts();
    checkPendingLocalJoinTimeout();
    logQueuedClaimProgress();
    logLockstepStall();
  }

  function logQueuedClaimProgress() {
    if (!DEBUG_KOTH || !claimWhenLevel || !session) return;
    console.warn('[KOTH] queued claim progress', {
      ...claimReadiness(),
      ourTick: session.confirmedTick,
      pauseLockstep: session.pauseLockstep,
      waitingForWorker: session.waitingForWorker,
      inFlightTick: session.inFlightTick,
      humanPlayers: [...(session.humanPlayers ?? [])],
      peerConfirms: Object.fromEntries(session.peerConfirmedTick ?? []),
      liveCeiling: session.liveTickCeiling?.(),
      announcedTick: liveMatches.get(matchId)?.tick ?? 0,
    });
  }

  /** Name whoever lockstep is parked on — a freeze is always someone's confirm. */
  function logLockstepStall() {
    if (!DEBUG_KOTH || !session) return;
    const blockedMs = session.lockstepBlockedMs?.() ?? 0;
    if (blockedMs < 1000) return;
    const waiters = session.lockstepWaiters?.() ?? [];
    console.warn('[KOTH] lockstep stalled', {
      blockedMs: Math.round(blockedMs),
      ourTick: session.confirmedTick,
      waitingOn: waiters.map((pid) => ({
        playerId: pid,
        user: shortId(roster[pid]?.userId),
        state: roster[pid]?.state,
        confirmed: session.peerConfirmedTick?.get(pid) ?? 0,
      })),
      humanPlayers: [...(session.humanPlayers ?? [])],
      localPlayerId: session.localPlayerId,
      pendingJoin: pendingLocalJoin,
    });
  }

  function slotForKnownUser(userId) {
    if (!userId) return null;
    return slotForUser(roster, userId)
      ?? roster.find((s) => s.userId && userIdsMatch(s.userId, userId))
      ?? null;
  }

  function removePlayerFromQuorum(playerId) {
    if (playerId == null || playerId < 0) return;
    matchHumanPlayers = matchHumanPlayers.filter((id) => id !== playerId);
    session?.removeHumanPlayer?.(playerId);
    playerLastConfirm.delete(playerId);
    pendingQuorum.delete(playerId);
  }

  /**
   * Presence / gone said an active player left. Drop them from lockstep now so
   * remaining clients do not wait on their confirms. The king authors SLOT_DEFEAT
   * when the leaver's own message was missed (RTC already torn down).
   */
  function dropSeatedLeaver(userId) {
    const slot = slotForKnownUser(userId);
    if (phase !== SHARD_PHASE.LIVE || slot?.state !== 'active' || slot.playerId < 0) return false;
    const tick = (session?.confirmedTick ?? 0) + 2;
    vacateActiveSeat(slot.playerId, slot.userId, {
      authorDefeat: isKing(),
      eliminateTick: tick,
      killUnits: true,
    });
    emitShard();
    syncOfferAuthority();
    if (isKing()) refreshSlotOffer([], { force: true });
    checkShardEmpty();
    return true;
  }

  function forceDefeatPlayer(playerId, userId) {
    const tick = (session?.confirmedTick ?? 0) + 2;
    vacateActiveSeat(playerId, userId, {
      authorDefeat: true,
      eliminateTick: tick,
      killUnits: true,
    });
    emitShard();
    syncOfferAuthority();
    if (isKing()) refreshSlotOffer([], { force: true });
    checkShardEmpty();
  }

  function handleSlotDefeat(msg) {
    if (msg.matchId !== matchId) return;
    const slot = slotForKnownUser(msg.userId) ?? roster[msg.playerId];
    // No tick means the seat's own owner withdrew, and their clock may be behind
    // everyone else's. Free the quorum slot immediately on every peer, but let
    // only the king turn it into a sim command — at the king's tick, so the
    // elimination lands on the same tick everywhere.
    const selfReported = msg.tick == null;
    vacateActiveSeat(msg.playerId, slot?.userId ?? msg.userId, {
      authorDefeat: selfReported && isKing(),
      eliminateTick: selfReported ? (session?.confirmedTick ?? 0) + 2 : msg.tick,
      killUnits: !selfReported || isKing(),
    });
    emitShard();
    syncOfferAuthority();
    if (isKing()) refreshSlotOffer([], { force: true });
    checkShardEmpty();
  }

  function publishSponsorHandoffs(assignments) {
    if (!isKing() || !assignments?.length) return;
    sendAll({
      type: MSG.SPONSOR_HANDOFF,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      fromUserId: localUserId,
      assignments,
    });
  }

  /**
   * Every peer runs the same deterministic promote/demote + depth rebuild, so a
   * client whose sponsor just changed roles can re-place itself without waiting
   * on a SPONSOR_HANDOFF that may never arrive. The king's assignment still wins
   * whenever one does land.
   */
  function syncLocalObserverPlacement() {
    if (!localUserId) return;
    const self = observerTree.nodes.get(localUserId);
    if (self?.role !== 'observer') return;
    observerDepth = self.depth | 0;
    if (self.sponsorId) {
      assignedSponsorId = self.sponsorId;
      return;
    }
    // No sponsor in the tree. Keep the king's assignment unless that peer is
    // gone entirely — an unreachable subtree must not wipe our only dial target,
    // but a departed sponsor must not keep being dialled either.
    if (assignedSponsorId && !treeHasUser(assignedSponsorId)) assignedSponsorId = null;
  }

  function treeHasUser(userId) {
    if (!userId) return false;
    if (observerTree.nodes.has(userId)) return true;
    for (const id of observerTree.nodes.keys()) {
      if (userIdsMatch(id, userId)) return true;
    }
    return false;
  }

  function parkUserInObserverPool(userId) {
    if (!userId) return;
    const assignments = demotePlayerToObserver(observerTree, userId, livePlayerUserIds());
    recomputeDepths(observerTree);
    syncLocalObserverPlacement();
    publishSponsorHandoffs(treeAssignments(assignments));
  }

  /**
   * A user took a seat. Every client must stop treating them as an observer —
   * otherwise the king keeps offering the open seat to someone already playing
   * while the real observers stay parked below them and never become eligible.
   */
  function notePlayerInTree(userId) {
    if (!userId) return;
    const players = livePlayerUserIds();
    if (!players.some((id) => userIdsMatch(id, userId))) players.push(userId);
    const moved = promoteObserverToPlayer(observerTree, userId, players);
    recomputeDepths(observerTree);
    const mine = userIdsMatch(userId, localUserId);
    if (mine) {
      assignedSponsorId = null;
      observerDepth = 0;
      localOfferEligible = false;
    } else {
      syncLocalObserverPlacement();
    }
    const assignments = treeAssignments(moved);
    // The promoted node owns the handoff for its own former children; the king
    // owns it for everybody else.
    if (assignments.length && (mine || isKing())) {
      sendAll({
        type: MSG.SPONSOR_HANDOFF,
        v: KOTH_PROTOCOL_VERSION,
        matchId,
        fromUserId: userId,
        assignments,
      });
    }
  }

  /** Read sponsor/depth back off the tree — depths shift during a reassign. */
  function treeAssignments(moved) {
    const out = [];
    for (const move of moved ?? []) {
      const node = observerTree.nodes.get(move?.userId);
      if (!node || node.role === 'player') continue;
      out.push({ userId: node.userId, sponsorId: node.sponsorId ?? null, depth: node.depth | 0 });
    }
    return out;
  }

  /**
   * Empty a live seat and move that user into the spectator / offer pool.
   * Combat wipe skips FORCE_ELIMINATE — the army is already gone.
   */
  function vacateActiveSeat(playerId, userId, {
    authorDefeat = false,
    eliminateTick = 0,
    killUnits = false,
  } = {}) {
    if (playerId == null || playerId < 0) return false;
    const slot = roster[playerId];
    const uid = userId ?? slot?.userId;
    if (slot?.state === 'active' && uid) {
      roster = releaseUser(roster, uid, false);
    }
    applySlotDefeat(playerId, eliminateTick, { killUnits });
    parkUserInObserverPool(uid);
    if (authorDefeat && uid) {
      sendAll({
        type: MSG.SLOT_DEFEAT,
        matchId,
        playerId,
        userId: uid,
        tick: eliminateTick,
      });
    }
    return true;
  }

  function retireCombatWipes() {
    if (phase !== SHARD_PHASE.LIVE || lobbyMatchHold) return;
    // Revolving KOTH does not enter generic post-game observation. Even when the
    // sim reports zero survivors, retire every wiped seat so the shard can wind
    // down or offer clean seats instead of leaving spectators paused.
    if (!session?.koth || session.replayingCatchUp) return;

    const wiped = kothWipedOwners(session.koth);
    let changed = false;
    const returned = [];
    for (const playerId of wiped) {
      const slot = roster[playerId];
      if (slot?.state !== 'active' || !slot.userId) continue;
      if (defeatedPlayers.has(playerId)) continue;
      const authorDefeat = isKing() || playerId === localPlayerId;
      returned.push(slot.userId);
      vacateActiveSeat(playerId, slot.userId, {
        authorDefeat,
        eliminateTick: (session.confirmedTick ?? 0) + 2,
        killUnits: false,
      });
      changed = true;
    }
    if (!changed) return;
    emitShard();
    broadcastPresence();
    syncOfferAuthority();
    if (isKing()) refreshSlotOffer(returned, { force: true });
    checkShardEmpty();
  }

  function applySlotDefeat(playerId, tick, { killUnits = true } = {}) {
    removePlayerFromQuorum(playerId);
    if (!defeatedPlayers.has(playerId)) {
      defeatedPlayers.add(playerId);
      if (killUnits) {
        const eventId = `defeat:${matchId}:${playerId}:${tick}`;
        const source = eventSourcePlayerId();
        const frame = session?.submitAtTick(
          tick,
          { type: CMD.FORCE_ELIMINATE, playerId },
          { playerId: source, commandId: eventId },
        );
        if (frame) {
          frame.userId = userForPlayerId(frame.playerId);
          sendAll({ type: MSG.COMMAND_FRAME, matchId, frame });
        }
      }
    }
    if (playerId === localPlayerId && role === 'player') {
      localPlayerId = -1;
      session?.setLocalPlayerId?.(-1);
      catchUpReady = true;
      pendingLocalJoin = null;
      clearClaimTimer();
      claimAttempts = 0;
      localOfferEligible = false;
      saveMatch({ matchId, userId: localUserId, slot: null });
      setRole('spectator');
      onStatus(
        countActive(roster) < MAX_ACTIVE_PLAYERS
          ? 'Eliminated — waiting for seat offer…'
          : 'Eliminated — spectating (match full)',
      );
      return;
    }
    // Our seat was revoked before we ever reached the spawn tick. Without this
    // the client stays in JOINING for ever: the HUD says "Claiming…", every
    // reconnect / re-catch-up / re-claim path bails out on that state, and the
    // pending join would later promote us into a seat that no longer exists.
    if (pendingLocalJoin && pendingLocalJoin.playerId === playerId) {
      cancelPendingLocalJoin('Seat withdrawn — waiting for next offer…');
    }
  }

  /**
   * Abandon a reserved-but-not-yet-live seat and go back to spectating.
   * @param {string} message status line for the player
   */
  function cancelPendingLocalJoin(message) {
    const pending = pendingLocalJoin;
    if (!pending) return;
    pendingLocalJoin = null;
    clearClaimTimer();
    claimAttempts = 0;
    claimWhenLevel = false;
    joinConfirmWatch.delete(pending.playerId);
    pendingQuorum.delete(pending.playerId);
    inputEnableTick = 0;
    removePlayerFromQuorum(pending.playerId);
    if (roster[pending.playerId]?.userId && userIdsMatch(roster[pending.playerId].userId, localUserId)) {
      roster = releaseUser(roster, localUserId, false);
    }
    localPlayerId = -1;
    role = 'spectator';
    appState = countActive(roster) >= MAX_ACTIVE_PLAYERS
      ? KOTH_APP_STATE.QUEUED
      : KOTH_APP_STATE.SPECTATOR;
    localOfferEligible = false;
    lastOfferStatus = message;
    session?.setLocalPlayerId?.(-1);
    session?.setRole?.('spectator');
    saveMatch({ matchId, userId: localUserId, slot: null });
    notifyPresentationSync({
      role: 'spectator',
      appState,
      localPlayerId: -1,
      inputEnabled: false,
      updateHumanPlayers: true,
    });
    console.warn('[KOTH] pending join cancelled', { playerId: pending.playerId, joinTick: pending.joinTick });
    // Tickless: release the reservation immediately. The king turns it into the
    // deterministic elimination on its own clock.
    sendAll({
      type: MSG.SLOT_DEFEAT,
      matchId,
      playerId: pending.playerId,
      userId: localUserId,
    });
    onStatus(message);
    emitShard();
    broadcastPresence();
  }

  /**
   * Nothing on the wire is guaranteed to tell us our reservation died, so a
   * pending join that never promotes has to time itself out. Runs off a timer
   * because a stalled quorum is exactly when commit-driven checks stop firing.
   */
  function checkPendingLocalJoinTimeout() {
    if (!pendingLocalJoin) return;
    if (!pendingLocalJoin.deadline) return;
    if (Date.now() < pendingLocalJoin.deadline) return;
    cancelPendingLocalJoin('Join timed out — waiting for next offer…');
  }

  function checkShardEmpty() {
    if (phase !== SHARD_PHASE.LIVE) return;
    if (countActive(roster) > 0) return;
    // A provisional spectator roster can be empty before catch-up lands. Only
    // the current offer authority may declare the shared shard gone.
    if (!offerAuthorityId || !userIdsMatch(offerAuthorityId, localUserId)) return;
    windDownShard();
  }

  function handleShardGone(msg) {
    if (msg.matchId !== matchId || phase !== SHARD_PHASE.LIVE) return;
    if (!msg.from || !offerAuthorityId || !userIdsMatch(msg.from, offerAuthorityId)) return;
    windDownShard();
  }

  function windDownShard() {
    sendAll({ type: MSG.SHARD_GONE, matchId });
    broadcastPresence({ gone: true });
    clearSavedMatch();
    clearOfferExpandTimer();
    clearClaimTimer();
    joinConfirmWatch.clear();
    pendingQuorum.clear();
    inputEnableTick = 0;
    claimWhenLevel = false;
    offerEpoch = 0;
    offerEligible = [];
    localOfferEligible = false;
    endedOfferEpoch = 0;
    offerAuthorityId = null;
    lastOfferSignature = '';
    claimAttempts = 0;
    observerTree.nodes.clear();
    observerTree.childrenOf.clear();
    assignedSponsorId = null;
    observerDepth = 0;
    matchId = generateMatchId();
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    defeatedPlayers.clear();
    roster = createEmptyRoster();
    roster[0] = { userId: localUserId, state: 'active', playerId: 0 };
    localPlayerId = 0;
    role = 'player';
    catchUpReady = true;
    detachLiveSim();
    setPhase(SHARD_PHASE.SANDBOX);
    onStatus('New staging');
    onLiveStart({
      mode: 'staging',
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
    const sourcePlayerId = eventSourcePlayerId();
    const kingId = userForPlayerId(sourcePlayerId) ?? rosterHostUserId();
    if (!kingId) return;
    const frame = {
      tick: msg.joinTick,
      playerId: sourcePlayerId,
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
        sendAll({ type: MSG.COMMAND_FRAME, matchId, frame });
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
    for (const join of joins) notePlayerInTree(join.userId);
    emitShard();
    broadcastPresence();
  }

  function promoteLocalJoinIfReady(tick) {
    if (!pendingLocalJoin || tick < pendingLocalJoin.joinTick) return;
    // Never promote into a seat that was taken back while we were catching up —
    // that produced a ghost player whose confirms every peer rejected.
    const reserved = roster[pendingLocalJoin.playerId];
    const stillOurs = reserved?.userId
      && userIdsMatch(reserved.userId, localUserId)
      && (reserved.state === 'active' || reserved.state === 'reserved');
    if (!stillOurs) {
      cancelPendingLocalJoin('Seat withdrawn — waiting for next offer…');
      return;
    }
    localPlayerId = pendingLocalJoin.playerId;
    const joinTick = pendingLocalJoin.joinTick;
    role = 'player';
    appState = KOTH_APP_STATE.LIVE_PLAYER;
    catchUpReady = true;
    attachLiveSim();
    session?.setLocalPlayerId?.(localPlayerId);
    session?.setRole?.('player');
    seedPeerConfirms(
      matchHumanPlayers.filter((id) => id !== localPlayerId),
      (tick | 0) + 1,
    );
    // Our own seat enters immediately: lockstep skips self, so this only makes
    // our own frames get collected locally — it can never stall us.
    if (!matchHumanPlayers.includes(localPlayerId)) {
      matchHumanPlayers = [...matchHumanPlayers, localPlayerId].sort((a, b) => a - b);
    }
    pendingQuorum.delete(localPlayerId);
    session?.setHumanPlayers?.(matchHumanPlayers);
    saveMatch({ matchId, slot: localPlayerId, userId: localUserId });

    // Handoff: reassign our former observer children, join player mesh.
    clearClaimTimer();
    notePlayerInTree(localUserId);
    // Dial other live players now that we are in the mesh.
    for (const uid of livePlayerUserIds()) {
      if (!userIdsMatch(uid, localUserId)) nudgePeerConnect(uid);
    }

    // Input stays off until every peer has admitted us to their quorum. A command
    // authored before then would be collected by some peers and dropped by
    // others — the joiner's confirm has to land first.
    inputEnableTick = tick + JOIN_INPUT_SETTLE_TICKS;
    notifyPresentationSync({
      role: 'player',
      appState,
      localPlayerId,
      inputEnabled: false,
      updateHumanPlayers: true,
      sweepToSpawn: true,
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
      });
    }
    onStatus(`Joined match — player ${localPlayerId}`);
    pendingLocalJoin = null;
    kickstartLockstep();
    localOfferEligible = false;
    emitShard();
    broadcastPresence();
    syncOfferAuthority();
    if (isKing()) refreshSlotOffer([], { force: true });
  }

  function handleJoinReady(msg) {
    if (msg.matchId !== matchId) return;
    if (!msg.userId || msg.playerId == null) return;
    const slot = roster[msg.playerId];
    if (!slot?.userId || !userIdsMatch(slot.userId, msg.userId)) return;
    if (slot.state === 'reserved') {
      roster = activateSlot(roster, msg.playerId, msg.userId).slots;
    } else if (slot.state !== 'active') return;
    // They reported the tick they reached, so they are real — admit them. Never
    // claim they confirmed OUR tick: that would let us commit ticks they have
    // not acknowledged.
    admitPendingQuorum(msg.playerId, msg.tick ?? 0, { force: true });
    session?.setPeerConfirmedTick?.(msg.playerId, msg.tick ?? 0);
    notePlayerInTree(msg.userId);
    emitShard();
    if (isKing()) refreshSlotOffer([], { force: true });
  }

  function syncJoinedPresentationIfReady(tick) {
    if (!pendingPresentationJoinTicks.has(tick)) return;
    pendingPresentationJoinTicks.delete(tick);
    notifyPresentationSync({
      role,
      appState,
      localPlayerId,
      inputEnabled: role === 'player' && !inputEnableTick,
    });
  }

  /** Hand the joiner its controls once the table has taken its confirms. */
  function releaseJoinerInputIfReady(tick) {
    if (!inputEnableTick || tick < inputEnableTick) return;
    inputEnableTick = 0;
    if (role !== 'player' || localPlayerId < 0) return;
    notifyPresentationSync({ role: 'player', appState, localPlayerId, inputEnabled: true });
    onStatus(`In the match — player ${localPlayerId + 1}`);
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
    attachLiveSim();
    seed = hashSeed(matchId);
    matchStartSlots = [0];
    matchHumanPlayers = [0];
    defeatedPlayers.clear();
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
    onStatus('Match live — waiting for challengers');
  }

  // The lone creator does not wait for a second player. It goes live solo as the
  // host (single active slot, player 0 — the king). Everyone else, including the
  // very next player, discovers this match, spectates, and drops in through the
  // one join pipeline — the board is never rebuilt for them. This is the ONLY
  // path that creates a public match.
  async function startSoloLive() {
    // Explicit "Start a lobby" pins the new matchId first. Discovery (no pin)
    // still joins a match that is already up instead of splitting a cold start.
    const creatingPinned = pinnedMatchId && pinnedMatchId === matchId;
    if (!creatingPinned) {
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
    defeatedPlayers.clear();
    liveStartKey = matchStartKey(matchId, roster, seed);
    catchUpReady = true;
    attachLiveSim();
    notePlayerConfirm(0);
    session?.setLocalPlayerId?.(0);
    session?.setRole?.('player');
    saveMatch({ matchId, userId: localUserId, slot: 0 });
    setPhase(SHARD_PHASE.LIVE);
    noteSelfLiveMatch();
    joinShardLobby();
    await notifyLiveStart(true);
    if (DEBUG_KOTH) console.info('[KOTH] solo-live created', { matchId: shortId(matchId) });
    onStatus('Match live — waiting for challengers');
    upsertNode(observerTree, localUserId, {
      role: 'player',
      depth: 0,
      sponsorId: null,
      caughtUp: true,
    });
    refreshSlotOffer([], { force: true });
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
      // 3rd+ joiners also receive this snapshot again (broadcast / relay). Do
      // not pause or wipe a reserved seat, and do not restart a good attach.
      const sameStart = !!nextKey && liveStartKey === nextKey;
      if (sameStart && shouldKeepSpectatorJoin({
        pendingLocalJoin: !!pendingLocalJoin,
        joining: appState === KOTH_APP_STATE.JOINING,
      })) {
        return;
      }
      // A new start key means the board really was rebuilt (the solo→2 reset).
      // A claim against the old board is dead, and holding it here left the
      // client attached to a world nobody else is playing. Keep the player's
      // intent so they are queued for the rebuilt match instead of dropped.
      if (!sameStart && (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING)) {
        cancelPendingLocalJoin('Match restarted — still queued for a seat…');
        claimWhenLevel = true;
      }
      const restart = shouldRestartSpectatorCatchup({
        liveStartKey,
        nextKey,
        liveSimAttached,
        catchupInFlight,
        catchupRequested: !!activeCatchupRequestId,
      });
      if (!restart) return;
      roster = nextRoster;
      seed = nextSeed;
      if (msg.armyPerSide != null) armyPerSide = msg.armyPerSide | 0;
      liveStartKey = nextKey;
      matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
      matchHumanPlayers = (msg.humanPlayers ?? [...matchStartSlots])
        .filter((id) => nextRoster[id]?.state === 'active');
      invalidateInFlightCatchup();
      phase = SHARD_PHASE.LIVE;
      role = 'spectator';
      appState = KOTH_APP_STATE.SPECTATOR;
      localPlayerId = -1;
      catchUpReady = false;
      detachLiveSim();
      onLeaveSolo();
      session?.setLocalPlayerId?.(-1);
      session?.setRole?.('spectator');
      pauseStubSim();
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
      matchHumanPlayers = (msg.humanPlayers ?? [...matchStartSlots])
        .filter((id) => roster[id]?.state === 'active' && !defeatedPlayers.has(id));
      session?.setHumanPlayers?.(matchHumanPlayers);
      applyLocalRosterSlot();
      emitShard();
      return;
    }
    // Local user is active in the incoming roster and the sender already passed
    // canonical-host validation, so this is a legitimate (re)start. No current
    // path authors one — joins are drop-in — but the handler stays so a host
    // that does re-key the board can still bring everyone with it.
    invalidateInFlightCatchup();
    roster = cloneSlots(msg.roster ?? roster);
    seed = msg.seed ?? seed;
    if (msg.armyPerSide != null) armyPerSide = msg.armyPerSide | 0;
    liveStartKey = nextKey;
    matchStartSlots = msg.activeSlots ?? activePlayerIds(roster);
    matchHumanPlayers = msg.humanPlayers ?? [...matchStartSlots];
    defeatedPlayers.clear();
    applyLocalRosterSlot();
    appState = role === 'player' ? KOTH_APP_STATE.LIVE_PLAYER : KOTH_APP_STATE.SPECTATOR;
    setPhase(SHARD_PHASE.LIVE);
    catchUpReady = true;
    attachLiveSim();
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

  function acceptSlotClaim(claimerUserId, claimEpoch, claimerLagTicks = 0) {
    if (!isKing() || phase !== SHARD_PHASE.LIVE || !session) return false;
    if (!claimerUserId) return false;
    if (countActive(roster) >= MAX_ACTIVE_PLAYERS) return false;
    // Already seated or already mid-join — a retried claim must not book a second seat.
    if (offerExcluded(claimerUserId)) return false;
    // A claim against an epoch we have already closed (or never opened) is stale.
    // Re-open instead of dropping it, so the claimer's retry lands on a live
    // epoch rather than timing out into the spectator pool.
    const epoch = Number(claimEpoch) || 0;
    if (!offerEpoch || (epoch && epoch !== offerEpoch)) {
      refreshSlotOffer([claimerUserId], { force: true });
      return false;
    }
    if (offerEligible.length && !offerEligible.some((id) => userIdsMatch(id, claimerUserId))) {
      return false;
    }

    const joinTick = joinSpawnTick({
      hostTick: session.confirmedTick ?? 0,
      delayTicks: JOIN_DELAY_TICKS,
      claimerLagTicks,
    });
    if (DEBUG_KOTH) {
      console.info('[KOTH] accepting claim', {
        user: shortId(claimerUserId),
        hostTick: session.confirmedTick,
        claimerLagTicks,
        joinTick,
      });
    }
    const { slots, playerId } = reserveOpenSlot(roster, claimerUserId);
    if (playerId < 0) {
      // Lost a race for the last seat; the claimer's retry lands on the next offer.
      refreshSlotOffer([], { force: true });
      return false;
    }
    roster = slots;
    // Accept immediately. Holding the accept until `joinTick - LEAD` spent half
    // the joiner's spawn window before it even heard about the seat, and every
    // peer parks at that tick waiting for them.
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
    endSlotOffer('filled', claimerUserId);
    commitJoinAtTick(accept);
    scheduleJoinerQuorum(playerId, joinTick, claimerUserId);
    if (userIdsMatch(claimerUserId, localUserId)) {
      applyLocalJoinPending(playerId, joinTick);
    }
    emitShard();
    broadcastPresence();
    return true;
  }

  function handleSlotClaim(msg) {
    if (msg.matchId !== matchId) return;
    if (!msg.userId) return;
    // Claims are addressed to the peer that authored the offer. During a death
    // handoff, stale roster views can briefly elect different kings; without an
    // address both of them can reserve different seats for the same claim.
    if (msg.to && !userIdsMatch(msg.to, localUserId)) return;
    if (!isKing()) {
      // An addressed claim must never be forwarded to a second authority. The
      // claimer will retry against the next offer if authority changed in flight.
      if (msg.to) return;
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
      console.info('[KOTH] slot claim', {
        from: shortId(msg.userId),
        epoch: msg.offerEpoch,
        claimerTick: msg.tick,
        claimerLag: msg.lagTicks,
        hostTick: session?.confirmedTick,
      });
    }
    // The claimer's own lag estimate is measured against confirms that were
    // already stale in flight, so on a relayed mesh it reads far too low. The gap
    // between our tick and the tick they stamped on this message is the real
    // distance they have to cover, latency included.
    const wireLag = Math.max(0, (session?.confirmedTick ?? 0) - (msg.tick | 0));
    acceptSlotClaim(msg.userId, msg.offerEpoch, Math.max(msg.lagTicks | 0, wireLag));
  }

  function handleSlotOffer(msg) {
    if (msg.matchId !== matchId) return;
    if (!isOfferAuthority(msg.from)) return;
    applyLocalOfferState(msg.offerEpoch, msg.eligible ?? [], { from: msg.from });
  }

  function handleSlotOfferEnd(msg) {
    if (msg.matchId !== matchId) return;
    if (!isOfferAuthority(msg.from)) return;
    const ended = Number.isFinite(msg.offerEpoch) ? Math.trunc(msg.offerEpoch) : 0;
    if (ended && offerEpoch && ended !== offerEpoch) return;
    if (ended) endedOfferEpoch = Math.max(endedOfferEpoch, ended);
    offerEpoch = 0;
    offerEligible = [];
    localOfferEligible = false;
    lastOfferSignature = '';
    claimAttempts = 0;
    // We won the seat: JOIN_ACCEPT drives the HUD from here. Without this the
    // winner briefly reads "Seat taken" because the end goes out first.
    if (msg.winnerUserId && userIdsMatch(msg.winnerUserId, localUserId)) return;
    const full = countActive(roster) >= MAX_ACTIVE_PLAYERS;
    if (appState === KOTH_APP_STATE.JOINING && msg.winnerUserId && !pendingLocalJoin) {
      // Lost the race for this seat, but they asked to play — stay in the queue.
      failLocalClaim(
        full ? 'Match full — waiting for a seat…' : 'Seat taken — still queued…',
        { requeue: !full },
      );
      return;
    }
    if (role === 'spectator' && catchUpReady && !claimPending()) {
      appState = full ? KOTH_APP_STATE.QUEUED : KOTH_APP_STATE.SPECTATOR;
      lastOfferStatus = full
        ? 'Match full — waiting for a seat…'
        : 'Seat taken — waiting for next offer…';
      onStatus(lastOfferStatus);
      emitShard();
    }
  }

  function clearClaimTimer() {
    if (claimTimer) {
      clearTimeout(claimTimer);
      claimTimer = null;
    }
    clearClaimSettleTimer();
  }

  function clearClaimSettleTimer() {
    if (!claimSettleTimer) return;
    clearTimeout(claimSettleTimer);
    claimSettleTimer = null;
  }

  function scheduleQueuedClaimRetry() {
    if (claimSettleTimer || !claimWhenLevel) return;
    const readiness = claimReadiness();
    const settleRemaining = Math.max(0, CLAIM_SETTLE_MS - readiness.msSinceAttach);
    claimSettleTimer = setTimeout(() => {
      claimSettleTimer = null;
      pumpQueuedClaim();
      if (claimWhenLevel) scheduleQueuedClaimRetry();
    }, Math.max(50, Math.min(250, settleRemaining || 250)));
  }

  /**
   * A claim that never becomes a JOIN_ACCEPT (dropped relay message, lost race,
   * king handover mid-claim) must not leave the client stuck in JOINING with no
   * way to claim again.
   */
  function armClaimTimeout() {
    clearClaimTimer();
    claimTimer = setTimeout(() => {
      claimTimer = null;
      if (pendingLocalJoin || role === 'player') return;
      if (appState !== KOTH_APP_STATE.JOINING) return;
      if (
        claimAttempts < MAX_SLOT_CLAIM_ATTEMPTS &&
        offerEpoch &&
        localOfferEligible &&
        countActive(roster) < MAX_ACTIVE_PLAYERS
      ) {
        sendSlotClaim();
        return;
      }
      failLocalClaim('Claim lost — waiting for next offer…');
    }, SLOT_CLAIM_TIMEOUT_MS);
  }

  /**
   * @param {{ requeue?: boolean }} [options] requeue — the player still wants in
   *   (someone else won this seat), so claim the next offer automatically rather
   *   than making them press the key again every rotation.
   */
  function failLocalClaim(message, { requeue = false } = {}) {
    clearClaimTimer();
    claimAttempts = 0;
    claimWhenLevel = requeue && countActive(roster) < MAX_ACTIVE_PLAYERS;
    if (role === 'player' || pendingLocalJoin) return;
    appState = countActive(roster) >= MAX_ACTIVE_PLAYERS
      ? KOTH_APP_STATE.QUEUED
      : KOTH_APP_STATE.SPECTATOR;
    lastOfferStatus = message;
    onStatus(message);
    session?.setRole?.('spectator');
    emitShard();
  }

  /**
   * Ticks we are behind the live match.
   *
   * Peer tick confirms are the primary measure, but they only bound us by the
   * *slowest* confirm we have received — if one player's confirms are not
   * reaching us, that number understates the real gap. The host's announced tick
   * covers that, and is only trusted while it is still advancing: a latched
   * stale value would leave the client "catching up" for ever.
   */
  function localLagTicks() {
    const sessionLag = session?.lagBehindLiveTicks?.() ?? 0;
    const live = liveMatches.get(matchId);
    const advancing = live && Date.now() - (live.lastTickAt ?? 0) < LIVE_TICK_FRESH_MS;
    if (!advancing) return sessionLag;
    const announced = Math.max(0, (live.tick | 0) - (session?.confirmedTick ?? 0));
    return Math.max(sessionLag, announced);
  }

  function claimReadiness() {
    return {
      catchUpReady,
      lagTicks: localLagTicks(),
      msSinceAttach: catchUpReadyAt ? performance.now() - catchUpReadyAt : Infinity,
    };
  }

  /** A queued claim fires as soon as we are level with the live tick. */
  function pumpQueuedClaim() {
    if (!claimWhenLevel) return;
    if (role === 'player' || claimPending()) {
      claimWhenLevel = false;
      clearClaimSettleTimer();
      return;
    }
    if (!localOfferEligible || !offerEpoch || countActive(roster) >= MAX_ACTIVE_PLAYERS) return;
    if (!canClaimSeatNow(claimReadiness())) {
      scheduleQueuedClaimRetry();
      return;
    }
    claimWhenLevel = false;
    clearClaimSettleTimer();
    claimAttempts = 0;
    sendSlotClaim();
  }

  function sendSlotClaim() {
    claimAttempts++;
    if (DEBUG_KOTH) {
      console.info('[KOTH] slot claim → sending', {
        matchId: shortId(matchId),
        offerEpoch,
        attempt: claimAttempts,
        depth: observerDepth,
        host: shortId(rosterHostUserId()),
      });
    }
    sendAll({
      type: MSG.SLOT_CLAIM,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      to: offerAuthorityId || rosterHostUserId(),
      userId: localUserId,
      offerEpoch,
      // Lets the king pick a spawn tick we can actually reach.
      tick: session?.confirmedTick ?? 0,
      lagTicks: localLagTicks(),
    });
    appState = KOTH_APP_STATE.JOINING;
    session?.setRole?.('spectator');
    notifyPresentationSync({ role: 'spectator', appState, inputEnabled: false });
    onStatus(claimAttempts > 1 ? `Claiming seat (retry ${claimAttempts - 1})…` : 'Claiming seat…');
    emitShard();
    armClaimTimeout();
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
    if (msg.fromUserId) {
      upsertNode(observerTree, msg.fromUserId, {
        role: 'player',
        depth: 0,
        sponsorId: null,
        caughtUp: true,
      });
      observerTree.childrenOf.delete(msg.fromUserId);
    }
    for (const a of msg.assignments ?? []) {
      applySponsorAssignment(a.userId, a.sponsorId, a.depth);
      if (userIdsMatch(a.userId, localUserId) && a.sponsorId) {
        assignedSponsorId = a.sponsorId;
        observerDepth = a.depth ?? 1;
        if (!isConnectedTo(a.sponsorId)) nudgePeerConnect(a.sponsorId);
      }
    }
    recomputeDepths(observerTree);
    syncLocalObserverPlacement();
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
    // The joiner's own deadline sits behind the king's, so an authoritative
    // revoke wins and this only fires when nothing told us at all.
    pendingLocalJoin = {
      playerId,
      joinTick,
      deadline: Date.now() + JOIN_CONFIRM_GRACE_MS * 2,
    };
    clearClaimTimer();
    claimAttempts = 0;
    claimWhenLevel = false;
    // Enter quorum the tick AFTER spawn so tick joinTick still commits with [0,1]
    // confirms only — otherwise we stall waiting for our own player-2 confirm.
    scheduleJoinerQuorum(playerId, joinTick);
    seedPeerConfirms(
      matchHumanPlayers.filter((id) => id !== playerId),
      (session?.confirmedTick ?? 0) + 1,
    );
    role = 'spectator';
    appState = KOTH_APP_STATE.JOINING;
    catchUpReady = true;
    // A spectator can inherit the loading/solo world's post-game flag. Joining
    // a revolving KOTH seat reopens the round; do not let main's post-game
    // observer path pause us before we can reach the deterministic spawn tick.
    if (session) {
      session.kothMatchOver = 0;
      session.matchWinner = -1;
      session.pauseLockstep = false;
      session.simAcc = 0;
    }
    session?.setRole?.('spectator');
    notifyPresentationSync({ role: 'spectator', appState, localPlayerId, inputEnabled: false });
    onStatus(`Joining at tick ${joinTick}…`);
    if (DEBUG_KOTH) {
      console.info('[KOTH] join pending', {
        playerId,
        joinTick,
        ourTick: session?.confirmedTick ?? 0,
        lag: localLagTicks(),
      });
    }
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
    defeatedPlayers.delete(msg.playerId);
    commitJoinAtTick(msg);
    scheduleJoinerQuorum(msg.playerId, msg.joinTick, msg.userId);
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
    // An observer that never received its SPONSOR_ASSIGN says so (sponsorId null).
    // Re-publish it so the fan-out tree converges even on a partial mesh.
    if (isKing() && msg.from && msg.sponsorId == null) {
      const node = observerTree.nodes.get(msg.from);
      if (!node?.sponsorId) kingAssignObserver(msg.from);
      else {
        sendAll({
          type: MSG.SPONSOR_ASSIGN,
          v: KOTH_PROTOCOL_VERSION,
          matchId,
          userId: msg.from,
          sponsorId: node.sponsorId,
          depth: node.depth,
        });
      }
    }
    // L2+ must not pull from players — only the assigned sponsor answers.
    if (!canServeCatchUpFor(msg.from, msg.sponsorId)) return;

    const tipTick = session.confirmedTick;
    let cached = session.getCachedCheckpoint?.();
    const soloLive = countActive(roster) <= 1;
    if (
      shouldExportFreshCatchupCheckpoint({
        activeCount: countActive(roster),
        cachedTick: cached?.tick ?? 0,
        tipTick,
      })
    ) {
      try {
        if (!catchupExportInFlight) {
          catchupExportInFlight = session.exportCheckpoint().finally(() => {
            catchupExportInFlight = null;
          });
        }
        await catchupExportInFlight;
        cached = session.getCachedCheckpoint?.();
        lastCheckpointTickPublished = Math.max(
          lastCheckpointTickPublished,
          cached?.tick ?? 0,
        );
      } catch (err) {
        console.warn('[KOTH] catch-up checkpoint export failed', err);
      }
    }

    const tick = session.confirmedTick;
    const checkpointTick = cached?.tick ?? 0;
    // Solo king: the fresh checkpoint above IS the tip, so ship that and skip the
    // ledger entirely. Full replay from tick 0 is what times out on long matches.
    const useCheckpoint = canUseCatchupCheckpoint({ cached, tipTick: tick });
    const ledger = useCheckpoint
      ? (soloLive ? [] : session.exportLedger(checkpointTick, tick))
      : session.exportLedger(0, tick);
    const offerTick = soloLive && useCheckpoint ? checkpointTick : tick;
    const offerChecksum = catchupOfferChecksum({
      offerTick,
      checkpointTick,
      useCheckpoint,
      cachedChecksum: cached?.checksum,
      tipChecksum: session._lastChecksum,
    });

    const responsePeerId = fromPeerId && connectedPeerIds().includes(fromPeerId)
      ? fromPeerId
      : connectedPeerIds().find((pid) => userIdsMatch(peerUserIds.get(pid) ?? pid, msg.from));

    // Both the world and the ledger always travel as chunks — over the data
    // channel when there is one, otherwise addressed over the broadcast relay.
    // A whole world (or a long ledger) inline on one relay message is dropped
    // silently, and the joiner has no way to tell that from "still arriving".
    const transferId = `cu:${msg.requestId || `${matchId}:${tick}`}`;
    const chunkTarget = responsePeerId ? { peerId: responsePeerId } : { toUserId: msg.from };
    const wire = catchupOfferLedger({ ledger, transferId });
    if (useCheckpoint && cached?.checkpoint) {
      sendCheckpointChunks({
        ...chunkTarget,
        checkpoint: cached.checkpoint,
        checksum: cached.checksum,
        tick: checkpointTick,
      });
    }
    if (wire.chunked) {
      sendLedgerChunks({
        ...chunkTarget,
        ledger,
        transferId,
        meta: {
          requestId: msg.requestId,
          tipTick: tick,
          tipChecksum: session._lastChecksum,
          checkpointTick,
          checkpointChecksum: useCheckpoint ? cached.checksum : undefined,
        },
      });
    }

    const offer = {
      type: MSG.SNAPSHOT_OFFER,
      v: KOTH_PROTOCOL_VERSION,
      matchId,
      to: msg.from,
      requestId: msg.requestId,
      tick: offerTick,
      checksum: offerChecksum,
      ledger: wire.ledger,
      ledgerFrameCount: wire.ledgerFrameCount,
      ledgerTransferId: wire.ledgerTransferId,
      checkpointTick: useCheckpoint ? checkpointTick : undefined,
      checkpointChecksum: useCheckpoint ? cached.checksum : undefined,
      matchConfig: matchConfig(),
      roster: authoritativeRoster(),
      viaBroadcast: !!msg.viaBroadcast,
      soloLive,
    };
    if (msg.viaBroadcast || !responsePeerId) {
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

    const parts = pendingCatchupParts.get(msg.requestId) ?? {};
    let { checkpoint, ledger } = resolveCatchupOfferWorld(
      msg,
      parts,
      session.getCachedCheckpoint?.(),
    );

    // Wait for advertised chunked parts. An empty tip ledger (frameCount 0)
    // is complete — 3rd+ joiners used to stall here after a fresh checkpoint.
    if (expectCatchupLedgerChunks(msg) && !parts.ledger) {
      pendingCatchupParts.set(msg.requestId, {
        ...parts,
        offer: msg,
        waitingLedger: true,
      });
      onStatus('Receiving catch-up ledger…');
      return;
    }
    if (needsCatchupCheckpoint(msg, checkpoint)) {
      pendingCatchupParts.set(msg.requestId, {
        ...parts,
        offer: msg,
        waitingCheckpoint: true,
      });
      onStatus('Receiving host world…');
      return;
    }
    ledger = ledger ?? [];

    catchupInFlight = true;
    clearCatchupOfferTimer();
    const acceptedRequestId = activeCatchupRequestId;
    const epoch = catchupEpoch;
    activeCatchupRequestId = '';
    catchUpReady = false;

    // Solo king: still apply the host checkpoint. Skipping used to leave the
    // spectator on the loading-screen 3-villager stub while the lobby HUD
    // already said they were watching. Ledger replay stays empty (attach at tip).
    if (isSoloLiveSpectatorOffer(msg, countActive(msg.roster ?? roster))) {
      if (!soloLiveOfferHasWorld({
        checkpoint,
        checkpointTick: msg.checkpointTick ?? checkpoint?.tick ?? 0,
      })) {
        catchupInFlight = false;
        catchUpReady = false;
        detachLiveSim();
        pendingCatchupParts.delete(acceptedRequestId);
        pauseStubSim();
        onStatus('Waiting for host world…');
        scheduleCatchupRetry(msg.tick ?? 0);
        return;
      }
    }

    const attachLive = !!(checkpoint && !(ledger?.length));
    onStatus(attachLive ? 'Attaching to live match…' : 'Replaying catch-up…');
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
          stayPaused: true,
          onProgress: ({ tick, targetTick }) => {
            const elapsed = formatMatchTime(matchSecondsFromTick(tick));
            const total = formatMatchTime(matchSecondsFromTick(targetTick));
            onStatus(
              attachLive
                ? `Attaching at ${elapsed}…`
                : `Replaying ${elapsed} / ${total}…`,
            );
          },
        },
      );
      if (epoch !== catchupEpoch) return;
      // Replay is complete. Stop diverting newly arriving live traffic before
      // flushing what accumulated during replay, otherwise a confirm replying
      // to REQUEST_TICK_CONFIRM can be held after the only flush.
      catchupInFlight = false;
      const keepJoin = shouldKeepSpectatorJoin({
        pendingLocalJoin: !!pendingLocalJoin,
        joining: appState === KOTH_APP_STATE.JOINING,
      });
      catchUpReady = true;
      catchUpReadyAt = performance.now();
      attachLiveSim();
      phase = SHARD_PHASE.LIVE;
      // Public KOTH is revolving: a caught-up spectator must remain live even if
      // its previous/loading world had already entered post-game observation.
      session.kothMatchOver = 0;
      session.matchWinner = -1;
      matchStartSlots = msg.matchConfig.activeSlots ?? matchStartSlots;
      if (msg.roster && countActive(msg.roster) > 0) roster = cloneSlots(msg.roster);
      matchHumanPlayers = (msg.matchConfig.humanPlayers ?? matchHumanPlayers)
        .filter((id) => roster[id]?.state === 'active' && !defeatedPlayers.has(id));
      if (msg.matchConfig.armyPerSide != null) armyPerSide = msg.matchConfig.armyPerSide | 0;
      session.setHumanPlayers?.(matchHumanPlayers);
      flushHeldCatchupLockstep(msg.tick ?? session.confirmedTick ?? 0);
      // Install the live roster and held traffic before the render pump can
      // commit against the just-replayed spectator state.
      session.pauseLockstep = false;
      sendAll({ type: MSG.REQUEST_TICK_CONFIRM, matchId });
      if (!keepJoin) {
        appState = KOTH_APP_STATE.SPECTATOR;
        localPlayerId = -1;
        session.setLocalPlayerId?.(-1);
        setRole('spectator');
        saveMatch({ matchId, userId: localUserId, slot: null });
      }
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
      if (keepJoin) {
        onStatus(`Joining at tick ${pendingLocalJoin.joinTick}…`);
        if (session.confirmedTick >= pendingLocalJoin.joinTick) {
          promoteLocalJoinIfReady(session.confirmedTick);
        }
      } else {
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
      }
      sendAll({ type: MSG.CATCHUP_READY, matchId, userId: localUserId, tick: msg.tick });
      catchupRetryAttempt = 0;
      if (isKing()) refreshSlotOffer([], { force: true });
    } catch (err) {
      if (epoch !== catchupEpoch) return;
      console.warn('[KOTH] catch-up failed', err);
      clearCatchupOfferTimer();
      activeCatchupRequestId = '';
      catchUpReady = false;
      session?.clearCachedCheckpoint?.();
      detachLiveSim();
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
    if (epoch !== catchupEpoch && !catchUpReady && role === 'spectator' && phase === SHARD_PHASE.LIVE) {
      const sponsor = pickSponsorUserId();
      if (sponsor) beginCatchup(sponsor);
    }
  }

  /**
   * Chunks are still landing, so the request is alive. Relayed worlds arrive in
   * many small pieces; letting the 8s retry fire mid-transfer makes the sponsor
   * re-export and start over instead of finishing.
   */
  function noteCatchupProgress(index, total, label) {
    if (!activeCatchupRequestId || catchUpReady) return;
    // Chunks land in bursts; re-arming a timer and repainting the HUD on each one
    // would cost more than the transfer.
    const now = performance.now();
    if (now - lastCatchupProgressAt < CATCHUP_PROGRESS_MS) return;
    lastCatchupProgressAt = now;
    // Tick 0: a retry must re-derive the live clock, never reuse the local stub's.
    scheduleCatchupOfferTimeout(0);
    const got = (index | 0) + 1;
    const want = total | 0;
    if (want > 1) onStatus(`${label} ${Math.min(got, want)}/${want}…`);
  }

  function handleCheckpointChunk(msg) {
    if (msg.matchId !== matchId) return;
    // Relayed chunks are addressed; every other observer on the firehose must
    // not cache a world that was cut for somebody else's tick.
    if (msg.to && !userIdsMatch(msg.to, localUserId)) return;
    noteCatchupProgress(msg.index, msg.total, 'Receiving host world');
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
    const storeCheckpoint = (requestId) => {
      if (!requestId) return null;
      const parts = pendingCatchupParts.get(requestId) ?? {};
      parts.checkpoint = assembled.checkpoint;
      pendingCatchupParts.set(requestId, parts);
      return parts;
    };
    const parts = storeCheckpoint(activeCatchupRequestId);
    if (parts?.offer && parts.waitingCheckpoint) {
      const offer = {
        ...parts.offer,
        checkpoint: assembled.checkpoint,
        ledger: parts.ledger ?? parts.offer.ledger,
      };
      parts.waitingCheckpoint = false;
      void handleSnapshotOffer(offer);
    }
  }

  function handleLedgerChunk(msg) {
    if (msg.matchId !== matchId) return;
    if (msg.to && !userIdsMatch(msg.to, localUserId)) return;
    noteCatchupProgress(msg.index, msg.total, 'Receiving catch-up ledger');
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
    emitListeners(dataListeners, msg, fromPeerId);
    if (!msg?.type) return;
    if (noteChat(msg, { requireMatchId: true })) return;
    if (msg.v !== KOTH_PROTOCOL_VERSION) return;
    if (msg._mid) {
      if (seenMessageIds.has(msg._mid)) return;
      rememberMessageId(msg._mid);
      relay(msg, fromPeerId);
    }
    if (msg.from) peerUserIds.set(fromPeerId, msg.from);
    if (msg.userId && msg.userId !== localUserId) presencePeers.set(msg.userId, msg.userId);
    if (msg.from && msg.skins && typeof msg.skins === 'object' && !Array.isArray(msg.skins)) {
      rememberUserSkins(msg.from, msg.skins);
    } else if (msg.from && Array.isArray(msg.dlc)) {
      rememberUserDlc(msg.from, msg.dlc);
    }
    if (msg.from && typeof msg.color === 'string' && rememberUserColor(msg.from, msg.color)) {
      if (phase === SHARD_PHASE.LIVE) notifyPresentationSync();
    }
    if (msg.ownerColors && typeof msg.ownerColors === 'object') {
      let learned = false;
      for (const s of roster) {
        if (s.state !== 'active' || !s.userId || userColors.has(s.userId)) continue;
        const hex = msg.ownerColors[s.playerId] ?? msg.ownerColors[String(s.playerId)];
        if (hex && rememberUserColor(s.userId, hex)) learned = true;
      }
      if (learned && phase === SHARD_PHASE.LIVE) notifyPresentationSync();
    }
    if (msg.ownerSkins && typeof msg.ownerSkins === 'object') {
      for (const s of roster) {
        if (s.state !== 'active' || !s.userId || userSkins.has(s.userId)) continue;
        const skins = msg.ownerSkins[s.playerId] ?? msg.ownerSkins[String(s.playerId)];
        if (skins) rememberUserSkins(s.userId, skins);
      }
    } else if (msg.ownerPacks && typeof msg.ownerPacks === 'object') {
      for (const s of roster) {
        if (s.state !== 'active' || !s.userId || userSkins.has(s.userId)) continue;
        const pack = msg.ownerPacks[s.playerId] ?? msg.ownerPacks[String(s.playerId)];
        if (typeof pack === 'string') rememberUserDlc(s.userId, [pack]);
      }
    }

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
          dlc: localDlc(),
          skins: localSkins(),
          color: localColor(),
          ownerSkins: ownerSkinsNow(),
          ownerColors: ownerColorsNow(),
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
        // discovering — otherwise a freshly-booted late joiner's stale staging
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
            detachLiveSim();
            onLeaveSolo();
            session?.setLocalPlayerId?.(-1);
            session?.setRole?.('spectator');
            pauseStubSim();
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
        if (msg.matchId !== matchId) break;
        ingestCommandFrame(msg.frame);
        break;

      case MSG.TICK_CONFIRM:
        ingestTickConfirm(msg);
        break;

      case MSG.REQUEST_TICK_CONFIRM:
        if (msg.matchId !== matchId) break;
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
        handleSlotDefeat(msg);
        break;

      case MSG.SHARD_GONE:
        handleShardGone(msg);
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

  function invalidateInFlightCatchup() {
    catchupEpoch += 1;
    activeCatchupRequestId = '';
    detachLiveSim();
    clearCatchupOfferTimer();
    // Partial worlds from the replaced match must not be spliced into the next one.
    pendingCatchupParts.clear();
    checkpointAssembler.clear();
    ledgerAssembler.clear();
    clearRelayChunkQueue();
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
        beginCatchup(peerId);
      }, delayMs);
    }
  }

  function beginCatchup(peerOrUserId, tick = 0) {
    if (pendingLocalJoin || appState === KOTH_APP_STATE.JOINING) return;
    if (canSkipCatchupRequest({ catchUpReady, liveSimAttached, catchupInFlight })) return;
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
      pendingCatchupParts.delete(activeCatchupRequestId);
      activeCatchupRequestId = '';
    }
    if (catchupRetryTimer) {
      clearTimeout(catchupRetryTimer);
      catchupRetryTimer = null;
    }
    const target = catchupRequestTick({
      requestedTick: tick,
      sessionTick: session.confirmedTick ?? 0,
      hostTick: liveMatches.get(matchId)?.tick ?? 0,
      liveSimAttached,
    });
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
    heldCatchupFrames.length = 0;
    heldCatchupConfirms.length = 0;
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
      // Explicit null means "no assignment reached me" — lets any player serve us.
      sponsorId: assignedSponsorId ?? null,
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
    // Tick confirms are a live-lockstep concept. A staging/matchmaking session
    // free-runs and would otherwise spam playerId-0 confirms to every peer (all
    // rejected), drowning out real signal and risking stale cross-match confirms.
    if (phase !== SHARD_PHASE.LIVE) return;
    if (userForPlayerId(session.localPlayerId) !== localUserId) return;
    sendAll({
      type: MSG.TICK_CONFIRM,
      matchId,
      tick,
      playerId: session.localPlayerId,
      userId: localUserId,
    });
  }

  // Tick 0 is the init snapshot and is never committed, so the commit-driven
  // confirm cascade has no seed. Once the freshly-reset live session is ready
  // (confirmedTick === 0 for THIS match — calling before reset would broadcast a
  // stale staging tick), nudge confirms until the sim leaves tick 0. Repeats
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
    emitListeners(peerConnectedListeners, peerId);
    if (DEBUG_KOTH) console.info('[KOTH] peer connected', shortId(peerId));
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
    emitListeners(peerDisconnectedListeners, peerId);
    const uid = peerUserIds.get(peerId);
    peerUserIds.delete(peerId);
    readyPeerIds.delete(peerId);
    if (phase === SHARD_PHASE.LIVE) {
      onStatus('Peer link lost — waiting for mesh gossip');
    }
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
      if (typeof data.name === 'string') notePeerName(data.from, data.name);
      if (data.skins && typeof data.skins === 'object' && !Array.isArray(data.skins)) {
        rememberUserSkins(data.from, data.skins);
      } else if (Array.isArray(data.dlc)) {
        rememberUserDlc(data.from, data.dlc);
      }
      if (typeof data.color === 'string' && rememberUserColor(data.from, data.color)) {
        if (phase === SHARD_PHASE.LIVE) notifyPresentationSync();
      }
      // Broadcast is a global firehose. Only peers live on THIS match count as
      // in-lobby; browsers and other shards stay in the discovery registry.
      if (isMatchLeavePresence(data, matchId) || data.gone) {
        dropSeatedLeaver(data.from);
        forgetMatchMember(data.from);
      } else if (isLiveMatchMember(data, matchId)) {
        touchMatchMember(data.from);
        if (data.role) peerPresenceRole.set(data.from, data.role);
        else if (data.appState === KOTH_APP_STATE.SPECTATOR) peerPresenceRole.set(data.from, 'spectator');
        if (isSpectatorMember(data, matchId)) {
          // The defeated client may observe its wipe before another peer does.
          // Its spectator heartbeat is authoritative for releasing its own seat
          // from quorum, preventing one stale roster from freezing the table.
          // JOINING also uses role=spectator until the spawn tick, so only the
          // stable spectator state relinquishes an already-active seat.
          if (
            liveSimAttached
            && catchUpReady
            && relinquishesActiveSeat(data, matchId)
          ) {
            dropSeatedLeaver(data.from);
          }
          matchLobbySpectators.add(data.from);
          if (data.sponsorId != null || (data.observerDepth | 0) > 0) {
            applySponsorAssignment(data.from, data.sponsorId ?? null, data.observerDepth ?? 0);
          }
          upsertNode(observerTree, data.from, {
            role: 'observer',
            joinedAt: observerTree.nodes.get(data.from)?.joinedAt ?? Date.now(),
          });
          if (typeof data.caughtUp === 'boolean') {
            noteObserverCaughtUpState(data.from, data.caughtUp);
          }
          if (isKing() && phase === SHARD_PHASE.LIVE) {
            if (!observerTree.nodes.get(data.from)?.sponsorId) kingAssignObserver(data.from);
            if (countActive(roster) < MAX_ACTIVE_PLAYERS) refreshSlotOffer();
          }
        } else {
          matchLobbySpectators.delete(data.from);
          ingestPresenceTick(data);
        }
        if (
          data.offerEpoch &&
          Array.isArray(data.offerEligible) &&
          isOfferAuthority(data.from)
        ) {
          applyLocalOfferState(data.offerEpoch, data.offerEligible, { from: data.from });
        }
      } else {
        dropSeatedLeaver(data.from);
        forgetMatchMember(data.from);
      }
    }
    recordLiveMatch(data);
    if (data.left || data.gone) return;
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
      // Relay fallback for a joiner with no working data channel.
      case MSG.CHECKPOINT_CHUNK:
        handleCheckpointChunk(msg);
        break;
      case MSG.LEDGER_CHUNK:
        handleLedgerChunk(msg);
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
        ingestTickConfirm(msg);
        break;
      case MSG.REQUEST_TICK_CONFIRM:
        if (msg.matchId !== matchId) break;
        if (session) sendTickConfirm(session.confirmedTick + 1);
        break;
      case MSG.COMMAND_FRAME:
        if (msg.matchId !== matchId) break;
        ingestCommandFrame(msg.frame);
        break;
      case MSG.SLOT_DEFEAT:
        handleSlotDefeat(msg);
        break;
      case MSG.SHARD_GONE:
        handleShardGone(msg);
        break;
      default:
        break;
    }
  }

  function onBroadcastMessage(raw) {
    const data = raw && raw.type === 'broadcast' && raw.content ? raw.content : raw;
    emitListeners(broadcastListeners, data, raw);
    if (!data?.type) return;
    if (noteChat(data, { requireMatchId: true })) return;
    if (data.type !== MSG.SHARD_PRESENCE) {
      onGameBroadcastMessage(data);
      return;
    }
    processPresenceBroadcast(data);
  }

  function onGameLobbyMessage(data, lobbyName) {
    emitListeners(lobbyMessageListeners, data, lobbyName);
    if (!data?.type) return;
    const shard = shardLobbyName(matchId);
    const lobbyChat = lobbyName === shard
      || (lobbyName === MATCHMAKING_LOBBY && appState === KOTH_APP_STATE.MATCHMAKING);
    if (lobbyChat && noteChat(data)) return;
    // Discovery lobby — track nothing, never RTC here.
    if (lobbyName === MATCHMAKING_LOBBY) return;
    if (data.type === CHAT_TYPE) return;
    if (data.type === 'player_join' || data.type === 'player_rejoin') {
      if (userIdsMatch(data.from, localUserId)) {
        broadcastPresence();
        return;
      }
      if (phase === SHARD_PHASE.LIVE && lobbyName === shardLobbyName(matchId)) {
        lobbyPeers.add(data.from);
        touchMatchMember(data.from);
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
    // staging while pinging for presence). This is what lets peers mesh and
    // discover the live match before anyone elects to join; without it, tabs
    // can only requestMatch inside their own per-match lobby and never find
    // each other.
    joinMatchmakingLobby();

    setPhase(SHARD_PHASE.SANDBOX);
    onStatus(
      role === 'spectator'
        ? 'Looking for live shard…'
        : 'Staging — waiting for challengers',
    );

    bootResolve?.({
      mode: 'staging',
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
        if (lobbyMatchHold) return prevSubmit(command);
        if (role !== 'player') return null;
        if (userForPlayerId(session.localPlayerId) !== localUserId) return null;
        const frame = prevSubmit(command);
        if (frame) {
          frame.userId = localUserId;
          sendAll({ type: MSG.COMMAND_FRAME, matchId, frame });
        }
        return frame;
      };

      const prevCommit = session.onCommit;
      session.onCommit = (tick, checksum) => {
        if (lobbyMatchHold) {
          prevCommit?.(tick, checksum);
          return;
        }
        activateAcceptedJoinsAtTick(tick);
        promoteLocalJoinIfReady(tick);
        syncJoinedPresentationIfReady(tick);
        releaseJoinerInputIfReady(tick);
        retireCombatWipes();
        sendTickConfirm(tick + 1);
        void maybePublishCheckpoint(tick);
        syncOfferAuthority();
        pumpQueuedClaim();
        // There is always an open-seat offer while a seat is free. This is
        // throttled and de-duplicated inside refreshSlotOffer.
        if (isKing() && countActive(roster) < MAX_ACTIVE_PLAYERS) refreshSlotOffer();
        prevCommit?.(tick, checksum);
        // Time-based, not per-tick: commits come in bursts while a joiner burns
        // down its catch-up backlog, and peers only need the live tick a few
        // times a second for liveness / discovery.
        if (phase === SHARD_PHASE.LIVE) {
          const now = performance.now();
          if (now - lastTickPresenceAt >= TICK_PRESENCE_MS) {
            lastTickPresenceAt = now;
            broadcastPresence({ tick });
          }
        }
      };

      sendTickConfirm(1);
    },

    setLobbyMatchHold(on) {
      const next = !!on;
      if (next === lobbyMatchHold) return;
      if (next) {
        if (phase === SHARD_PHASE.LIVE) leaveLiveLobby();
        lobbyMatchHold = true;
        parkKothDiscovery();
        return;
      }
      lobbyMatchHold = false;
      joinMatchmakingLobby();
      broadcastPresence();
    },

    getP2p: () => p2p,
    getUserId: () => localUserId,
    sendChat,
    getChatLog: () => chatLog.list(),
    isChatActive,
    subscribeChat: (fn) => addListener(chatListeners, fn),
    subscribeBroadcast: (fn) => addListener(broadcastListeners, fn),
    subscribeLobbyMessage: (fn) => addListener(lobbyMessageListeners, fn),
    subscribeDataMessage: (fn) => addListener(dataListeners, fn),
    subscribePeerConnected: (fn) => addListener(peerConnectedListeners, fn),
    subscribePeerDisconnected: (fn) => addListener(peerDisconnectedListeners, fn),
    subscribeMatchLobbyConnected: (fn) => addListener(matchLobbyConnectedListeners, fn),

    listLiveLobbies,

    joinLiveLobby(id, from) {
      if (!id) return false;
      const live = liveMatches.get(id);
      const host = live?.from || from;
      if (!host) return false;
      pinnedMatchId = id;
      return followLivePresence({
        matchId: id,
        from: host,
        phase: SHARD_PHASE.LIVE,
      });
    },

    startLiveLobby() {
      if (phase === SHARD_PHASE.LIVE) return;
      cancelDiscoverStart();
      // The lobby list is how you join. This button always opens a new lobby,
      // even when other King of the Hill matches are already visible.
      clearSavedMatch();
      matchId = generateMatchId();
      seed = hashSeed(matchId);
      pinnedMatchId = matchId;
      aetherSteam.notifyKothLobbyCreated();
      return startSoloLive();
    },

    leaveLiveLobby,
    getLobbyPresence,

    startOrJoinLive() {
      if (phase === SHARD_PHASE.LIVE) return;
      // Already discovered a live match? Join it.
      const known = bestLiveMatch();
      if (known?.matchId && known.from) {
        followLivePresence({ matchId: known.matchId, from: known.from, phase: SHARD_PHASE.LIVE });
        return;
      }
      // Otherwise listen in the matchmaking lobby for an existing match before
      // creating one. Leaving the private staging lets live presence arriving
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
      // Everyone parks at our quorum tick until we reach it, so claiming while
      // still draining a backlog would freeze the match for the whole table.
      if (!canClaimSeatNow(claimReadiness())) {
        claimWhenLevel = true;
        scheduleQueuedClaimRetry();
        if (DEBUG_KOTH) {
          const live = liveMatches.get(matchId);
          console.info('[KOTH] claim queued — not level yet', {
            ...claimReadiness(),
            ourTick: session?.confirmedTick ?? 0,
            ceiling: session?.liveTickCeiling?.() ?? 0,
            announcedTick: live?.tick ?? 0,
            announcedAgeMs: live?.lastTickAt ? Date.now() - live.lastTickAt : null,
          });
        }
        onStatus('Catching up to live — seat claim queued…');
        emitShard();
        return;
      }
      claimAttempts = 0;
      sendSlotClaim();
    },

    isSpectator() {
      return role === 'spectator';
    },

    isLiveSpectating() {
      return phase === SHARD_PHASE.LIVE && role === 'spectator';
    },

    /** Re-pull the host world after a leftover backdrop rebuild stomped catch-up. */
    retrySpectatorAttach() {
      if (phase !== SHARD_PHASE.LIVE || role !== 'spectator') return;
      if (catchupInFlight) return;
      catchUpReady = false;
      detachLiveSim();
      pauseStubSim();
      const sponsor = pickSponsorUserId();
      if (sponsor) beginCatchup(sponsor);
      else scheduleBroadcastCatchup(0);
    },

    canJoin() {
      return (
        catchUpReady &&
        !activeCatchupRequestId &&
        role === 'spectator' &&
        appState !== KOTH_APP_STATE.JOINING
      );
    },

    joinActionLabel,

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
      clearOfferExpandTimer();
      clearClaimTimer();
      clearRelayChunkQueue();
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
