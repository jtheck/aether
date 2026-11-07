// Match-channel waiting room: host snapshot, ready, RTC mesh, countdown.

import { sameUserId, senderUserId } from '../lobby/ids.js';
import { cleanMapName, defaultSettings, getMode, chapterRefNeedsHostGarden, lobbyAllowsSpectators } from '../lobby/modes.js';
import { ladderMatchDeal } from '../lobby/ladderMap.js';
import { lobbyOptionsFromHouseIndex, peekSkirmishCatalog, skirmishCatalogInflight } from '../houseMapCatalog.js';
import {
  ANNOUNCE_MS,
  lobbyStartMs,
  LOBBY_PROTOCOL_VERSION,
  MSG,
  generateRoomId,
  matchChannel,
} from '../lobby/protocol.js';
import {
  addSpectator,
  canStart,
  claimSeat,
  cloneRoster,
  countHumans,
  createRoster,
  moveRosterPerson,
  releaseSeat,
  removeSpectator,
  seatOf,
  setSeatReady,
  setSeatReplay,
  spectatorOf,
  startBlockReason,
} from '../lobby/roster.js';
import {
  CHAT_MIN_INTERVAL_MS,
  chatSpeakPayload,
  createChatLog,
  ingestChat,
  makeChatMessage,
} from '../lobby/chat.js';
import { getPlayerColor, getPlayerName, getUnitSkins } from './settings.js';
import { localOwnedPacks, selectedSkins } from './dlcCatalog.js';
import { aetherSteam } from './steam.js';
import { loadGardenRef, parseWorkshopRef } from './workshop.js';
import { CMD } from '../sim/commands.js';
import {
  SIM_GENERATION,
  SIM_RULES_ID,
  hasCurrentSimGeneration,
  hasCurrentSimRules,
} from '../sim/generation.js';
import { compactFrameForTransport, expandTransportFrame } from '../network/lockstepWire.js';
import { LOCKSTEP_STALL_UI_MS } from './simSession.js';

/** A closed tab often never fires a peer disconnect. Forfeit once confirms have been missing this long. */
const LOCKSTEP_FORFEIT_MS = 8000;
/** Ranked splash: give up if the other player never reaches the countdown. */
const RANKED_CONNECT_MS = 12000;

function unrefTimer(timer) {
  timer?.unref?.();
  return timer;
}

/**
 * @param {object} opts
 * @param {() => object | null} opts.getP2p
 * @param {() => string | null} [opts.getUserId]
 * @param {object} opts.gameLobby
 * @param {(fn: Function) => () => void} [opts.subscribeBroadcast]
 * @param {(fn: Function) => () => void} [opts.subscribeLobbyMessage]
 * @param {(fn: Function) => () => void} [opts.subscribeDataMessage]
 * @param {(fn: Function) => () => void} [opts.subscribePeerConnected]
 * @param {(fn: Function) => () => void} [opts.subscribePeerDisconnected]
 * @param {(fn: Function) => () => void} [opts.subscribeMatchLobbyConnected]
 * @param {() => void} [opts.onChange]
 * @param {(active: boolean) => void} [opts.onActiveChange]
 * @param {(cfg: object) => void | Promise<void>} [opts.onStartMatch]
 * @param {() => void} [opts.onLeaveMatch]
 * @param {(reason: string) => void | Promise<void>} [opts.onAbortMatch]
 * @param {() => void} [opts.onRankedPregameEnd] - opponent left before the match; requeue
 */
export function createMatchLobby({
  getP2p,
  getUserId,
  gameLobby,
  subscribeBroadcast,
  subscribeLobbyMessage,
  subscribeDataMessage,
  subscribePeerConnected,
  subscribePeerDisconnected,
  subscribeMatchLobbyConnected,
  onChange,
  onActiveChange,
  onStartMatch,
  onLeaveMatch,
  onAbortMatch,
  onRankedLeave,
  onRankedDisconnect,
  onRankedDisconnectClear,
  onRankedDisconnectLoss,
  onRankedForfeit,
  onRankedForfeitBy,
  onRankedPregameEnd,
  onChapter,
  onChat,
  loadGarden,
  ladderMaps,
} = {}) {
  let mode = null;
  let roomId = null;
  let hosting = false;
  let phase = 'idle';
  let seats = [];
  /** Watchers in this room. They are not seats and not lockstep peers. */
  let spectators = [];
  /** This client entered as a watcher, not a seated player. */
  let watching = false;
  /** Ranked hides the lobby and starts itself when the table is full and ready. */
  let ranked = false;
  /** Assigned players for a ranked teams match. Seat is the owner index. */
  let rankedRoster = null;
  let settings = defaultSettings('onevsone');
  let hostId = null;
  let hostName = '';
  let hostColor = '';
  let countdownEndsAt = 0;
  let announceTimer = null;
  let countdownTimer = null;
  let rankedHelloTimer = null;
  let hostFromHint = null;
  /** peerId → userId. Disconnects arrive as peer ids; seats are keyed by userId. */
  const peerUser = new Map();
  /** Player ids already forfeited this room. A drop during load still eliminates on attach. */
  const forfeited = new Set();
  /** Both clients hold the sim. A one-sided freeze stops tick confirms and looks like a drop. */
  let matchPaused = false;
  /** Human link drops wait out reconnect grace. userId -> first missing timestamp. */
  const linkGone = new Map();
  let stallClaimed = false;
  let session = null;
  let prevSubmit = null;
  let prevCommit = null;
  let bootstrapTimer = null;
  let lockstepOn = false;
  /** Bumped on each chapter reset so leftover FRAME/CONFIRM from the old map are dropped. */
  let lockstepEpoch = 0;
  /** True after a match table was loaded - Leave must restore the sandbox. */
  let hadMatch = false;
  /** When this ranked room entered waiting, before the first countdown. */
  let rankedWaitSince = 0;
  const chatLog = createChatLog();
  let lastChatSendAt = 0;
  /** Raw garden JSON embedded on START so web guests can play Workshop maps. */
  let startGarden = null;
  let startBusy = false;
  /** Host roster generation. A delayed announce from before a rejoin must not clobber the new seat. */
  let rosterRev = 0;
  /** Stable for this page. A refreshed client has a new token, so its join replaces the old visit. */
  const clientToken = generateRoomId();
  let presenceSeq = 0;
  let compatibilityProblem = '';
  /** userId -> { token, seq } of the latest membership message accepted. */
  const presenceSeen = new Map();

  function emit() {
    onChange?.();
  }

  function localId() {
    return getUserId?.() ?? getP2p?.()?.getUserId?.() ?? null;
  }

  function profile() {
    return {
      userId: localId(),
      name: getPlayerName(),
      color: getPlayerColor(),
      dlc: localOwnedPacks(aetherSteam.ownedPacks()),
      skins: selectedSkins(localOwnedPacks(aetherSteam.ownedPacks()), getUnitSkins()),
    };
  }

  function channel() {
    return mode && roomId ? matchChannel(mode, roomId) : '';
  }

  function snapshot() {
    const userId = localId();
    return {
      v: LOBBY_PROTOCOL_VERSION,
      sim: SIM_GENERATION,
      simRules: SIM_RULES_ID,
      type: MSG.STATE,
      mode,
      roomId,
      hosting,
      phase,
      seats: cloneRoster(seats),
      spectators: spectators.map((s) => ({ ...s })),
      watching,
      settings: { ...settings },
      hostId,
      hostName,
      hostColor,
      playerCount: countHumans(seats),
      maxPlayers: getMode(mode)?.maxPlayers ?? seats.length,
      countdownEndsAt,
      userId,
      ranked,
      garden: startGarden,
      loadingMap: startBusy,
      rev: rosterRev,
      epoch: lockstepEpoch,
    };
  }

  function announcePayload(type = MSG.ANNOUNCE) {
    const snap = snapshot();
    const userId = localId();
    return {
      type,
      v: LOBBY_PROTOCOL_VERSION,
      sim: SIM_GENERATION,
      simRules: SIM_RULES_ID,
      mode,
      roomId,
      userId,
      hostId,
      hostName,
      hostColor,
      playerCount: snap.playerCount,
      maxPlayers: snap.maxPlayers,
      spectatorCount: spectators.length,
      spectators: snap.spectators,
      settings: snap.settings,
      seats: snap.seats,
      phase,
      countdownEndsAt: snap.countdownEndsAt,
      rev: rosterRev,
      epoch: lockstepEpoch,
    };
  }

  function bumpRev() {
    if (hosting) rosterRev += 1;
  }

  /** One roster generation, then the data snapshot and the browse announce. */
  function publishRoom() {
    bumpRev();
    sendData(snapshot());
    startAnnounce();
    emit();
  }

  function membership(msg) {
    presenceSeq += 1;
    return { ...msg, client: clientToken, seq: presenceSeq };
  }

  /**
   * Ignore a membership message from an earlier visit.
   * A claim (join / spectate) from a new page replaces the stored visit.
   * A leave from that old page must not undo the new one.
   */
  function admit(msg, claim) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    const token = typeof msg.client === 'string' && msg.client ? msg.client : '';
    const seq = Number(msg.seq);
    if (!token || !Number.isFinite(seq)) return true;
    const prev = presenceSeen.get(userId);
    if (prev && prev.token === token && seq < prev.seq) return false;
    if (prev && prev.token !== token && !claim) return false;
    if (!prev || prev.token !== token || seq > prev.seq) {
      presenceSeen.set(userId, { token, seq });
    }
    return true;
  }

  function noteEpoch(msg) {
    if (msg?.epoch == null) return;
    const n = msg.epoch | 0;
    if (n > lockstepEpoch) lockstepEpoch = n;
  }

  function noteRev(msg) {
    const rev = Number(msg?.rev);
    if (!Number.isFinite(rev)) return true;
    if (rev < rosterRev) return false;
    rosterRev = rev;
    return true;
  }

  function forgetPeerUser(userId) {
    if (!userId) return;
    for (const [peerId, mapped] of peerUser) {
      if (sameUserId(mapped, userId)) peerUser.delete(peerId);
    }
  }

  function stamp(msg) {
    const userId = localId();
    return {
      v: LOBBY_PROTOCOL_VERSION,
      roomId,
      mode,
      ...msg,
      sim: SIM_GENERATION,
      simRules: SIM_RULES_ID,
      userId,
    };
  }

  function acceptsPeerRules(msg) {
    const compatible = hasCurrentSimGeneration(msg?.sim) && hasCurrentSimRules(msg?.simRules);
    if (compatible) {
      if (compatibilityProblem) {
        compatibilityProblem = '';
        emit();
      }
      return true;
    }
    const next = 'Version mismatch — hard refresh both players';
    if (compatibilityProblem !== next) {
      compatibilityProblem = next;
      emit();
    }
    return false;
  }

  function sendData(msg, peerId = null) {
    const p2p = getP2p?.();
    if (!p2p?.sendData) return;
    const payload =
      msg?.type === MSG.FRAME && msg.frame
        ? { ...msg, frame: compactFrameForTransport(msg.frame) }
        : msg;
    p2p.sendData(stamp(payload), peerId);
  }

  /** Waiting-room presence rides the type broadcast so seats do not wait on RTC. */
  function sendType(msg) {
    if (!mode || !roomId) return;
    gameLobby?.announce?.(stamp(msg));
  }

  function noteChat(raw) {
    if (ingestChat(chatLog, raw)) {
      onChat?.();
      return true;
    }
    return false;
  }

  /** Chat over the match room. Local paint first; wire uses GetFire `content`
   *  plus RTC/broadcast backups so other clients see the line. */
  function sendChat(text) {
    if (phase === 'idle') return false;
    const now = Date.now();
    if (now - lastChatSendAt < CHAT_MIN_INTERVAL_MS) return false;
    const me = profile();
    const msg = makeChatMessage({
      from: me.userId, name: me.name, color: me.color, text, watching,
    });
    if (!msg) return false;
    lastChatSendAt = now;
    if (chatLog.add(msg)) onChat?.();
    const ch = channel();
    const p2p = getP2p?.();
    if (ch && p2p?.sendLobbyMessage) p2p.sendLobbyMessage(ch, chatSpeakPayload(msg));
    sendData(msg);
    if (mode && roomId) {
      gameLobby?.announce?.({ type: MSG.CHAT, mode, roomId, ...msg });
    }
    return true;
  }

  function notePeerUser(peerId, userId) {
    if (peerId && userId) peerUser.set(peerId, String(userId));
  }

  function dial(peerId) {
    if (!peerId || sameUserId(peerId, localId())) return;
    const ch = channel();
    if (!ch) return;
    getP2p?.()?.requestMatch?.(peerId, ch);
  }

  function joinMatchChannel() {
    const ch = channel();
    const p2p = getP2p?.();
    if (!ch || !p2p?.joinMatchLobby) return;
    p2p.joinMatchLobby(ch, { autoMatch: true });
  }

  function leaveMatchChannel() {
    const ch = channel();
    if (ch) getP2p?.()?.leaveMatchLobby?.(ch);
  }

  function stopRankedHello() {
    if (rankedHelloTimer) {
      clearInterval(rankedHelloTimer);
      rankedHelloTimer = null;
    }
  }

  /** Guest keeps saying it is here until the countdown starts. One broadcast is easy to miss. */
  function startRankedHello() {
    stopRankedHello();
    if (!ranked || hosting) return;
    rankedHelloTimer = unrefTimer(setInterval(() => {
      if (!ranked || hosting || phase !== 'waiting') {
        stopRankedHello();
        return;
      }
      const hello = presenceHello();
      sendType(hello);
      sendData(hello);
      if (hostFromHint) dial(hostFromHint);
    }, 500));
  }

  function stopAnnounce() {
    if (announceTimer) {
      clearInterval(announceTimer);
      announceTimer = null;
    }
  }

  function startAnnounce() {
    stopAnnounce();
    if (!hosting || !mode) return;
    gameLobby?.hold?.(mode);
    if (ranked) return;
    const tick = () => gameLobby?.announce?.(announcePayload());
    tick();
    announceTimer = unrefTimer(setInterval(tick, ANNOUNCE_MS));
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    countdownEndsAt = 0;
  }

  function seatedUserIds() {
    return seats.filter((s) => s.kind === 'human' && s.userId).map((s) => s.userId);
  }

  function seatedPeersConnected() {
    const me = localId();
    const connected = getP2p?.()?.getConnectedPeers?.() ?? [];
    return seatedUserIds().every((userId) => (
      sameUserId(userId, me)
      || connected.some((peerId) => (
        sameUserId(peerId, userId)
        || sameUserId(peerUser.get(peerId), userId)
      ))
    ));
  }

  function meshStartBlockReason() {
    if (countHumans(seats) < 2 || seatedPeersConnected()) return '';
    return 'Waiting for peer connection…';
  }

  function dialSeatedPeers() {
    const me = localId();
    for (const uid of seatedUserIds()) {
      if (!sameUserId(uid, me)) dial(uid);
    }
  }

  function sendTickConfirm(tick) {
    if (!lockstepOn || !session) return;
    sendData({ type: MSG.CONFIRM, tick, playerId: session.localPlayerId, epoch: lockstepEpoch });
  }

  function sameEpoch(msg) {
    return (msg?.epoch | 0) === lockstepEpoch;
  }

  function kickstartLockstep() {
    if (bootstrapTimer) clearInterval(bootstrapTimer);
    const pump = () => {
      if (!lockstepOn || !session || (session.confirmedTick ?? 0) > 0) {
        if (bootstrapTimer) clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        return;
      }
      sendTickConfirm((session.confirmedTick ?? 0) + 1);
    };
    pump();
    bootstrapTimer = unrefTimer(setInterval(pump, 300));
  }

  function attachSession(simSession) {
    detachSession();
    if (!simSession) return;
    session = simSession;
    lockstepOn = true;
    prevSubmit = session.submitCommand.bind(session);
    session.submitCommand = (command) => {
      if (session.role !== 'player') return null;
      const frame = prevSubmit(command);
      if (frame) sendData({ type: MSG.FRAME, frame, epoch: lockstepEpoch });
      return frame;
    };
    prevCommit = session.onCommit;
    session.onCommit = (tick, checksum) => {
      if (session.role === 'player' && (session.localPlayerId ?? -1) >= 0) sendTickConfirm(tick + 1);
      prevCommit?.(tick, checksum);
    };
    dialSeatedPeers();
    if (session.role === 'player') kickstartLockstep();
    if (matchPaused) holdSimPaused();
    for (const playerId of forfeited) submitForfeit(playerId, 0);
  }

  function detachSession() {
    lockstepOn = false;
    if (bootstrapTimer) {
      clearInterval(bootstrapTimer);
      bootstrapTimer = null;
    }
    if (session && prevSubmit) session.submitCommand = prevSubmit;
    if (session) session.onCommit = prevCommit;
    session = null;
    prevSubmit = null;
    prevCommit = null;
  }

  function enterPlaying() {
    stopRankedHello();
    if (phase !== 'starting') return;
    phase = 'playing';
    hadMatch = true;
    stopAnnounce();
    if (hosting) gameLobby?.announce?.(announcePayload(MSG.CLOSED));
    emit();
  }

  function unreadyGuests() {
    seats = cloneRoster(seats);
    for (const seat of seats) {
      if (seat.kind === 'human' && !sameUserId(seat.userId, hostId)) seat.ready = false;
    }
  }

  function presenceHello() {
    const me = profile();
    if (watching) return membership({ type: MSG.SPECTATE, name: me.name, color: me.color });
    return membership({
      type: MSG.JOIN,
      name: me.name,
      color: me.color,
      dlc: me.dlc,
      skins: me.skins,
      ready: Boolean(seatOf(seats, me.userId)?.ready),
    });
  }

  /** Frozen board stays up; room goes back to ready-up and type-channel browse. */
  function endMatchStay() {
    matchPaused = false;
    forfeited.clear();
    linkGone.clear();
    if (stallClaimed) onRankedDisconnectClear?.();
    stallClaimed = false;
    if (session) {
      session.playPaused = false;
      session.pauseLockstep = false;
    }
    detachSession();
    clearCountdown();
    lockstepEpoch = (lockstepEpoch + 1) | 0;
    phase = 'waiting';
    unreadyGuests();
    if (hosting) publishRoom();
    else {
      const hello = presenceHello();
      sendType(hello);
      sendData(hello);
    }
    emit();
    return true;
  }

  function returnToWaiting() {
    if (phase !== 'playing') return false;
    return endMatchStay();
  }

  /** Resign this seat. The match plays on to the score card. Ranked leave is the ladder forfeit. */
  function concede() {
    if (ranked || watching) return false;
    if (phase !== 'playing') return false;
    if (session?.kothMatchOver) return false;
    const seat = seatOf(seats, localId());
    const playerId = session?.localPlayerId ?? seat?.index ?? -1;
    if (playerId < 0 || forfeited.has(playerId)) return false;
    const tick = (session?.confirmedTick ?? 0) + 2;
    const payload = { type: MSG.CONCEDE, playerId, tick };
    sendType(payload);
    sendData(payload);
    queueForfeit(playerId, tick);
    emit();
    return true;
  }

  function acceptConcede(msg) {
    if (ranked || (phase !== 'playing' && phase !== 'starting')) return false;
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    const seat = seatOf(seats, userId);
    if (!seat || seat.kind !== 'human') return false;
    const playerId = seat.index | 0;
    if (msg?.playerId != null && (msg.playerId | 0) !== playerId) return false;
    queueForfeit(playerId, msg?.tick | 0);
    emit();
    return true;
  }

  function localHasForfeited() {
    const seat = seatOf(seats, localId());
    const playerId = session?.localPlayerId ?? seat?.index ?? -1;
    return playerId >= 0 && forfeited.has(playerId);
  }

  function finishCountdown() {
    countdownTimer = null;
    if (phase !== 'countdown') return;
    if (!seatedPeersConnected()) {
      abortCountdown(hosting);
      return;
    }
    phase = 'starting';
    emit();
    const snap = snapshot();
    Promise.resolve(onStartMatch?.(snap))
      .then(() => {
        if (phase !== 'starting' || roomId !== snap.roomId) return;
        enterPlaying();
      })
      .catch((err) => {
        console.error('[lobby] match start failed', err);
        if (phase === 'starting') {
          phase = 'waiting';
          emit();
        }
      });
  }

  function armCountdown(endsAt) {
    clearCountdown();
    countdownEndsAt = endsAt;
    phase = 'countdown';
    const pulse = () => {
      if (phase !== 'countdown') return;
      if (Date.now() >= countdownEndsAt) {
        finishCountdown();
        return;
      }
      emit();
      countdownTimer = unrefTimer(setTimeout(pulse, 200));
    };
    countdownTimer = unrefTimer(setTimeout(pulse, 0));
  }

  function abortCountdown(broadcast = false) {
    if (phase !== 'countdown') return;
    clearCountdown();
    phase = 'waiting';
    if (broadcast && hosting) {
      sendData({ type: MSG.ABORT });
      sendType({ type: MSG.ABORT });
    }
    emit();
  }

  function applyState(msg) {
    if (!msg || (msg.roomId && roomId && msg.roomId !== roomId)) return;
    if (phase === 'starting' || phase === 'playing') return;
    if (!noteRev(msg)) return;
    noteEpoch(msg);
    if (msg.seats) seats = cloneRoster(msg.seats);
    if (Array.isArray(msg.spectators)) {
      spectators = msg.spectators.map((s) => ({ ...s }));
    }
    if (msg.settings) settings = { ...settings, ...msg.settings };
    if (!hosting) {
      const me = localId();
      const seated = Boolean(seatOf(seats, me));
      const listed = Boolean(spectatorOf(spectators, me));
      const wasWatching = watching;
      watching = Boolean(me && !seated && listed);
      if (wasWatching && !watching && settings.allowSpectators === false) {
        leaveRoom();
        return;
      }
    }
    if (msg.garden && typeof msg.garden === 'object') startGarden = msg.garden;
    if (msg.hostId) hostId = msg.hostId;
    if (msg.hostName) hostName = msg.hostName;
    if (msg.hostColor) hostColor = msg.hostColor;
    if (msg.phase === 'countdown' && msg.countdownEndsAt) {
      armCountdown(msg.countdownEndsAt);
    } else if (msg.phase && msg.phase !== 'countdown') {
      if (phase === 'countdown' && msg.phase === 'waiting') abortCountdown(false);
      else if (msg.phase !== 'idle') phase = msg.phase;
    }
    emit();
  }

  function takeSeat(roster, person, at) {
    if (Number.isInteger(at)) {
      const placed = claimSeat(roster, person, at);
      if (placed.ok) return placed.seats;
    }
    return claimSeat(roster, person).seats;
  }

  function hostClaim(msg, extra = {}) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    const player = {
      userId,
      name: msg.name,
      color: msg.color,
      dlc: msg.dlc,
      skins: msg.skins,
      ready: Boolean(extra.ready ?? msg.ready),
    };
    const assigned = Array.isArray(rankedRoster) && rankedRoster.some((row) => Number.isInteger(row?.seat))
      ? rankedRoster.find((row) => sameUserId(row.userId, userId))
      : null;
    if (ranked && Array.isArray(rankedRoster) && rankedRoster.some((row) => Number.isInteger(row?.seat))) {
      if (!assigned) return false;
      const claimed = claimSeat(seats, player, assigned.seat);
      seats = claimed.seats;
      return claimed.ok;
    }
    const claimed = claimSeat(seats, player);
    seats = claimed.seats;
    return claimed.ok;
  }

  function hostRelease(msg) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    if (!seatOf(seats, userId)) return false;
    seats = releaseSeat(seats, userId);
    return true;
  }

  function hostSetReady(msg) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    seats = setSeatReady(seats, userId, Boolean(msg.ready));
    return true;
  }

  function resetRoom() {
    if (session && (matchPaused || session.playPaused)) {
      session.playPaused = false;
      session.pauseLockstep = false;
    }
    matchPaused = false;
    detachSession();
    stopAnnounce();
    stopRankedHello();
    clearCountdown();
    leaveMatchChannel();
    if (mode) gameLobby?.release?.(mode);
    mode = null;
    roomId = null;
    hosting = false;
    phase = 'idle';
    seats = [];
    spectators = [];
    watching = false;
    hostId = null;
    hostName = '';
    hostColor = '';
    hostFromHint = null;
    ranked = false;
    rankedRoster = null;
    peerUser.clear();
    forfeited.clear();
    linkGone.clear();
    presenceSeen.clear();
    rosterRev = 0;
    if (stallClaimed) onRankedDisconnectClear?.();
    stallClaimed = false;
    rankedWaitSince = 0;
    compatibilityProblem = '';
    settings = defaultSettings('onevsone');
    hadMatch = false;
    startGarden = null;
    startBusy = false;
    chatLog.clear();
    onActiveChange?.(false);
    emit();
  }

  function createRoom(nextMode, opts = {}) {
    if (!getMode(nextMode)) return false;
    if (phase !== 'idle') leaveRoom();
    const me = profile();
    if (!me.userId) return false;
    mode = nextMode;
    roomId = opts.roomId || generateRoomId();
    ranked = Boolean(opts.ranked);
    rankedRoster = Array.isArray(opts.roster) ? opts.roster : null;
    compatibilityProblem = '';
    hosting = true;
    phase = 'waiting';
    onActiveChange?.(true);
    settings = defaultSettings(nextMode);
    if (opts.seed != null) settings.seed = (Number(opts.seed) || 0) >>> 0;
    hostId = me.userId;
    hostName = me.name;
    hostColor = me.color;
    watching = false;
    spectators = [];
    seats = createRoster(nextMode);
    const mine = rankedRoster?.find((row) => sameUserId(row.userId, me.userId));
    seats = takeSeat(seats, { ...me, ready: true }, mine?.seat);
    rosterRev = 0;
    lockstepEpoch = 0;
    joinMatchChannel();
    bumpRev();
    startAnnounce();
    emit();
    return true;
  }

  function joinRoom(nextMode, nextRoomId, from, opts = {}) {
    const spectate = Boolean(opts.spectate);
    const modeInfo = getMode(nextMode);
    if (!modeInfo || !nextRoomId) return false;
    if (spectate && !modeInfo.spectators) return false;
    if (phase !== 'idle') leaveRoom();
    const me = profile();
    if (!me.userId) return false;
    mode = nextMode;
    roomId = nextRoomId;
    ranked = Boolean(opts.ranked);
    compatibilityProblem = '';
    hosting = false;
    watching = spectate;
    phase = 'waiting';
    onActiveChange?.(true);
    settings = defaultSettings(nextMode);
    if (opts.seed != null) settings.seed = (Number(opts.seed) || 0) >>> 0;
    hostFromHint = from ?? null;
    hostId = from ?? null;
    rosterRev = 0;
    lockstepEpoch = 0;
    seats = createRoster(nextMode);
    spectators = [];
    if (spectate) spectators = addSpectator([], me).spectators;
    else seats = takeSeat(seats, { ...me, ready: Boolean(opts.ranked) }, opts.seat);
    gameLobby?.hold?.(nextMode);
    joinMatchChannel();
    sendType(presenceHello());
    if (from) dial(from);
    startRankedHello();
    emit();
    return true;
  }

  function spectateRoom(nextMode, nextRoomId, from) {
    return joinRoom(nextMode, nextRoomId, from, { spectate: true });
  }

  function allowsSpectators() {
    return lobbyAllowsSpectators(mode, settings);
  }

  function hostAddSpectator(msg) {
    if (!allowsSpectators()) return false;
    if (phase === 'starting' || phase === 'playing') return false;
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    if (seatOf(seats, userId)) return false;
    const added = addSpectator(spectators, { userId, name: msg.name, color: msg.color });
    if (!added.ok) return false;
    spectators = added.spectators;
    return true;
  }

  function applyPlayLeave(userId, msg = {}) {
    if (phase !== 'playing' && phase !== 'starting') return false;
    if (spectatorOf(spectators, userId)) {
      spectators = removeSpectator(spectators, userId);
      forgetPeerUser(userId);
      emit();
      return true;
    }
    const seat = seatOf(seats, userId);
    if (!seat || seat.kind !== 'human') return false;
    const playerId = msg.playerId != null ? (msg.playerId | 0) : seat.index;
    forgetPeerUser(userId);
    seats = releaseSeat(seats, userId);
    queueForfeit(playerId, msg.tick | 0);
    emit();
    return true;
  }

  function holdSimPaused() {
    if (!session) return;
    session.playPaused = true;
    session.pauseLockstep = true;
    session.simAcc = 0;
  }

  function applyMatchPause(on) {
    const next = Boolean(on);
    const changed = matchPaused !== next
      || Boolean(session?.playPaused) !== next
      || Boolean(session?.pauseLockstep) !== next;
    matchPaused = next;
    if (session) {
      session.playPaused = next;
      session.pauseLockstep = next;
      if (next) session.simAcc = 0;
    }
    if (!next && changed && lockstepOn && session) {
      sendTickConfirm((session.confirmedTick ?? 0) + 1);
    }
    if (changed) emit();
    return changed;
  }

  /** Drop a player pause so a forfeit tick can commit. Peers unpause with us. */
  function releaseMatchPause() {
    if (!matchPaused && !session?.playPaused) return;
    applyMatchPause(false);
    const payload = { type: MSG.PAUSE, paused: false };
    sendType(payload);
    sendData(payload);
  }

  /**
   * P while a match is on. Spectators keep simulating.
   * Returns true when this room owns the key, including a no-op for spectators.
   */
  function toggleMatchPause() {
    if (phase !== 'playing' || !session) return false;
    if (watching || session.role === 'spectator') return true;
    const next = !matchPaused;
    applyMatchPause(next);
    const payload = { type: MSG.PAUSE, paused: next };
    sendType(payload);
    sendData(payload);
    return true;
  }

  function acceptPause(msg) {
    if (phase !== 'playing' && phase !== 'starting') return false;
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    applyMatchPause(Boolean(msg.paused));
    return true;
  }

  function queueForfeit(playerId, tickHint) {
    const id = playerId | 0;
    if (id < 0 || forfeited.has(id)) return;
    releaseMatchPause();
    forfeited.add(id);
    submitForfeit(id, tickHint);
  }

  function submitForfeit(playerId, tickHint) {
    if (!session) return;
    const id = playerId | 0;
    // Dropping the local seat first hides the eliminate from the next tick,
    // so your own forfeit never reaches the score card.
    if (id !== (session.localPlayerId ?? -1)) session.removeHumanPlayer?.(id);
    const confirmed = session.confirmedTick ?? 0;
    const hinted = tickHint | 0;
    const tick = hinted > confirmed ? hinted : confirmed + 2;
    const eventId = `forfeit:${roomId}:${playerId}`;
    const frame = session.submitAtTick?.(
      tick,
      { type: CMD.FORCE_ELIMINATE, playerId },
      { commandId: eventId },
    );
    if (frame) sendData({ type: MSG.FRAME, frame, epoch: lockstepEpoch });
  }

  /** Ranked rooms do not refill. A missing player before the match ends the lobby. */
  function abandonRankedIfShort() {
    if (!ranked || phase === 'idle' || phase === 'playing' || phase === 'starting') return false;
    const need = rankedRoster?.length || getMode(mode)?.maxPlayers || 0;
    if (!need || countHumans(seats) >= need) return false;
    if (hosting) gameLobby?.announce?.(announcePayload(MSG.CLOSED));
    const restoreWorld = hadMatch;
    const requeue = !hadMatch;
    resetRoom();
    if (restoreWorld) onLeaveMatch?.();
    if (requeue) onRankedPregameEnd?.();
    return true;
  }

  function seatForPlayer(playerId) {
    const id = playerId | 0;
    return seats.find((s) => s.kind === 'human' && (s.index | 0) === id) || null;
  }

  function rankedHumansDown(userId) {
    if (!ranked || !userId || sameUserId(userId, localId())) return;
    if (phase !== 'starting' && phase !== 'playing') return;
    if (linkGone.has(userId)) return;
    linkGone.set(userId, Date.now());
    onRankedDisconnect?.(userId);
  }

  function customHumanDown(userId) {
    if (ranked || !userId || sameUserId(userId, localId())) return;
    if (phase !== 'starting' && phase !== 'playing') return;
    if (!linkGone.has(userId)) linkGone.set(userId, Date.now());
  }

  function clearLinkGone(userId) {
    if (!userId || !linkGone.delete(userId)) return;
    if (ranked && linkGone.size === 0 && !stallClaimed) onRankedDisconnectClear?.();
  }

  function abortCustomTransportLoss() {
    if (ranked || (phase !== 'starting' && phase !== 'playing')) return false;
    const reason = 'Connection lost — match aborted';
    resetRoom();
    try {
      void Promise.resolve((onAbortMatch ?? onLeaveMatch)?.(reason)).catch((err) => {
        console.error('[lobby] match abort cleanup failed', err);
      });
    } catch (err) {
      console.error('[lobby] match abort cleanup failed', err);
    }
    return true;
  }

  function expireLinkGone() {
    if (!linkGone.size) return;
    const nowMs = Date.now();
    for (const [userId, since] of linkGone) {
      if (nowMs - since < LOCKSTEP_FORFEIT_MS) continue;
      linkGone.delete(userId);
      if (!ranked) {
        abortCustomTransportLoss();
        return;
      }
      onRankedDisconnectLoss?.(userId);
      applyPlayLeave(userId);
    }
  }

  function forfeitStalledPlayers() {
    if (phase !== 'playing' || !lockstepOn || !session) return;
    if (matchPaused || session.pauseLockstep || session.playPaused) {
      if (stallClaimed) {
        stallClaimed = false;
        if (linkGone.size === 0) onRankedDisconnectClear?.();
      }
      return;
    }
    const blocked = session.lockstepBlockedMs?.() ?? 0;
    const waiters = session.lockstepWaiters?.() ?? [];
    // Tick 0 is the opening handshake. Missing confirms there are the channel
    // still coming up, not a player who left. Forfeiting now crowns both sides.
    if (blocked <= 0 || (session.confirmedTick | 0) === 0) {
      if (stallClaimed) {
        stallClaimed = false;
        if (linkGone.size === 0) onRankedDisconnectClear?.();
      }
      return;
    }
    if (waiters.length === 0) return;
    if (ranked && !stallClaimed) {
      stallClaimed = true;
      for (const playerId of waiters) {
        const seat = seatForPlayer(playerId);
        if (seat?.userId) onRankedDisconnect?.(seat.userId);
      }
    }
    if (blocked < LOCKSTEP_FORFEIT_MS) return;
    stallClaimed = false;
    if (!ranked) {
      abortCustomTransportLoss();
      return;
    }
    for (const playerId of waiters) {
      const id = playerId | 0;
      const seat = seatForPlayer(id);
      if (ranked && seat?.userId) onRankedDisconnectLoss?.(seat.userId);
      if (seat?.userId) applyPlayLeave(seat.userId, { playerId: id });
      else queueForfeit(id, 0);
    }
  }

  function watchOpponents() {
    if (phase === 'idle') {
      rankedWaitSince = 0;
      return;
    }
    if (ranked && !hadMatch && phase === 'waiting') {
      if (!rankedWaitSince) rankedWaitSince = Date.now();
      else if (Date.now() - rankedWaitSince >= RANKED_CONNECT_MS) {
        resetRoom();
        onRankedPregameEnd?.();
      }
      return;
    }
    rankedWaitSince = 0;
    expireLinkGone();
    forfeitStalledPlayers();
  }

  function userIdForPeer(peerId) {
    const mapped = peerUser.get(peerId);
    if (mapped) return mapped;
    if (seatOf(seats, peerId) || spectatorOf(spectators, peerId)) return String(peerId);
    return '';
  }

  function leaveRoom() {
    if (phase === 'idle') return;
    const wasPlaying = phase === 'playing' || phase === 'starting';
    const restoreWorld = hadMatch || wasPlaying;
    if (wasPlaying && !watching) {
      const me = localId();
      const seat = seatOf(seats, me);
      const playerId = session?.localPlayerId ?? seat?.index ?? -1;
      // Stay through the wipe so the score card can open. Done leaves after that.
      if (ranked && !session?.kothMatchOver) {
        if (playerId >= 0 && !forfeited.has(playerId)) {
          onRankedForfeit?.();
          const tick = (session?.confirmedTick ?? 0) + 2;
          const payload = membership({ type: MSG.LEAVE, playerId, tick });
          sendType(payload);
          sendData(payload);
          queueForfeit(playerId, tick);
        }
        return;
      }
      if (!(ranked && forfeited.has(playerId | 0))) {
        const tick = (session?.confirmedTick ?? 0) + 2;
        const payload = membership({ type: MSG.LEAVE, playerId, tick });
        sendType(payload);
        sendData(payload);
      }
    } else if (hosting) {
      gameLobby?.announce?.(announcePayload(MSG.CLOSED));
    } else {
      const payload = membership({ type: MSG.LEAVE });
      sendType(payload);
      sendData(payload);
    }
    resetRoom();
    if (restoreWorld) onLeaveMatch?.();
  }

  function movePerson(userId, dir) {
    if (!hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return false;
    if (!userId) return false;
    const moved = moveRosterPerson(seats, spectators, userId, dir, {
      hostId,
      allowSpectators: allowsSpectators(),
      teams: Boolean(getMode(mode)?.teams),
    });
    if (!moved.ok) return false;
    seats = moved.seats;
    spectators = moved.spectators;
    if (phase === 'countdown') abortCountdown(true);
    publishRoom();
    return true;
  }

  function markReplay(userId, on) {
    const flag = Boolean(on);
    if (seatOf(seats, userId)) {
      if (Boolean(seatOf(seats, userId).replay) === flag) return false;
      seats = setSeatReplay(seats, userId, flag);
      return true;
    }
    if (!spectatorOf(spectators, userId)) return false;
    if (Boolean(spectatorOf(spectators, userId).replay) === flag) return false;
    spectators = spectators.map((s) => (
      sameUserId(s.userId, userId) ? { ...s, replay: flag } : s
    ));
    return true;
  }

  function hostSetReplay(msg) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    return markReplay(userId, msg.replay);
  }

  /** Lobby column shows Replay while this client has the replay bar open. */
  function setReplayWatch(on) {
    if (phase === 'idle') return false;
    const me = localId();
    if (!me || !markReplay(me, on)) return false;
    const msg = membership({ type: MSG.REPLAY, replay: Boolean(on) });
    sendType(msg);
    sendData(msg);
    if (hosting) publishRoom();
    emit();
    return true;
  }

  /** Camera/selection/replay head. Mesh plus the match room, same path as chat. */
  function sendView(body) {
    if (phase === 'idle' || !body) return;
    const msg = stamp(body);
    const ch = channel();
    const p2p = getP2p?.();
    if (ch) p2p?.sendLobbyMessage?.(ch, { type: body.type, content: msg });
    p2p?.sendData?.(msg);
  }

  function setReady(ready) {
    if (watching || hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return;
    const me = localId();
    if (!me) return;
    seats = setSeatReady(seats, me, ready);
    if (phase === 'countdown' && !ready) abortCountdown(false);
    const readyMsg = membership({ type: MSG.READY, ready: Boolean(ready) });
    sendType(readyMsg);
    sendData(readyMsg);
    emit();
  }

  function setSetting(key, value) {
    if (!hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return;
    if (key === 'seed') settings.seed = (Number(value) || 0) >>> 0;
    else if (key === 'fieldSize') settings.fieldSize = String(value);
    else if (key === 'chapter') {
      settings.chapter = String(value);
      settings.mapName = '';
      startGarden = null;
    }
    else if (key === 'allowSpectators') {
      settings.allowSpectators = Boolean(value);
      if (!settings.allowSpectators) spectators = [];
    }
    else return;
    const msg = { type: MSG.SETTING, key, value: settings[key] };
    if (key === 'chapter') msg.mapName = settings.mapName;
    sendData(msg);
    bumpRev();
    startAnnounce();
    emit();
  }

  /** Chapter plus the name the lobby browser should show. */
  function setMap(chapter, mapName = '') {
    if (!hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return;
    settings.chapter = String(chapter ?? '');
    settings.mapName = settings.chapter ? cleanMapName(mapName) : '';
    startGarden = null;
    sendData({
      type: MSG.SETTING,
      key: 'chapter',
      value: settings.chapter,
      mapName: settings.mapName,
    });
    bumpRev();
    startAnnounce();
    emit();
  }

  async function defaultLoadGarden(nextSettings) {
    if (typeof loadGarden === 'function') return loadGarden(nextSettings);
    const chapter = String(nextSettings?.chapter || '');
    if (!chapterRefNeedsHostGarden(chapter)) return null;
    const parsed = parseWorkshopRef(chapter);
    if (parsed) return aetherSteam.loadWorkshopGarden(parsed.id, parsed.file);
    return loadGardenRef(chapter);
  }

  function maybeRankedStart() {
    if (!ranked || !hosting || phase !== 'waiting' || startBusy) return;
    const need = rankedRoster?.length || getMode(mode)?.maxPlayers || 0;
    if (countHumans(seats) < need) return;
    if (!canStart(mode, seats)) return;
    requestStart();
  }

  function noteRankedLeave(userId) {
    if (!ranked || !userId || sameUserId(userId, localId())) return;
    if (phase !== 'countdown' && phase !== 'starting' && phase !== 'playing') return;
    onRankedLeave?.(userId);
  }

  function startMessage() {
    return {
      type: MSG.START,
      countdownEndsAt,
      garden: startGarden,
      seed: settings.seed,
      settings: { ...settings },
      seats: cloneRoster(seats),
      rev: rosterRev,
      epoch: lockstepEpoch,
    };
  }

  /** Guest must build the same table the host has: seed and both seats. */
  function acceptStart(msg) {
    if (!msg?.countdownEndsAt || hosting) return;
    if (!noteRev(msg)) return;
    noteEpoch(msg);
    if (msg.settings && typeof msg.settings === 'object') settings = { ...settings, ...msg.settings };
    if (msg.seed != null) settings.seed = (Number(msg.seed) || 0) >>> 0;
    if (Array.isArray(msg.seats)) seats = cloneRoster(msg.seats);
    if (msg.garden && typeof msg.garden === 'object') startGarden = msg.garden;
    armCountdown(msg.countdownEndsAt);
  }

  function cancelCountdown() {
    if (!hosting || phase !== 'countdown') return false;
    abortCountdown(true);
    return true;
  }

  function beginCountdown() {
    startBusy = false;
    armCountdown(Date.now() + lobbyStartMs(mode, ranked));
    bumpRev();
    const startMsg = startMessage();
    sendData(startMsg);
    sendType(startMsg);
    startAnnounce();
    emit();
  }

  function rankedMapRows() {
    if (typeof ladderMaps === 'function') {
      const rows = ladderMaps(mode);
      return Array.isArray(rows) ? rows : [];
    }
    const cat = peekSkirmishCatalog();
    if (!cat || (mode !== 'onevsone' && mode !== 'teams')) return [];
    return lobbyOptionsFromHouseIndex(cat, mode);
  }

  /** Hold the ranked start until the official list is in, then deal once. */
  function awaitingLadderMaps() {
    if (!ranked || settings.chapter) return false;
    if (mode !== 'onevsone' && mode !== 'teams') return false;
    if (typeof ladderMaps === 'function') return false;
    return !peekSkirmishCatalog() && Boolean(skirmishCatalogInflight());
  }

  /** Ranked: official maps and auto sizes share the queue seed. */
  function prepareRankedLadder() {
    if (!ranked || (mode !== 'onevsone' && mode !== 'teams' && mode !== 'koth')) return;
    if (settings.chapter) return;
    const deal = ladderMatchDeal(settings.seed, mode, rankedMapRows());
    settings.fieldSize = deal.fieldSize;
    settings.seed = deal.seed;
    settings.chapter = deal.chapter || '';
    settings.mapName = deal.mapName || '';
  }

  function requestStart() {
    if (!hosting || phase !== 'waiting' || startBusy) return false;
    if (!canStart(mode, seats)) return false;
    if (!seatedPeersConnected()) return false;
    if (awaitingLadderMaps()) {
      const pending = skirmishCatalogInflight();
      const room = roomId;
      startBusy = true;
      emit();
      void pending.then(() => {
        if (!hosting || phase !== 'waiting' || roomId !== room) {
          startBusy = false;
          emit();
          return;
        }
        startBusy = false;
        requestStart();
      }).catch(() => {
        startBusy = false;
        if (hosting && phase === 'waiting' && roomId === room) requestStart();
        else emit();
      });
      return true;
    }
    prepareRankedLadder();
    // The garden file's own seed never changes, so a custom map would deal the
    // same pads forever. Roll a match seed and send it with the start.
    // Ranked already dealt its seed, including an official map.
    if (settings.chapter && !ranked) settings.seed = (Math.random() * 0xffffffff) >>> 0;
    if (chapterRefNeedsHostGarden(settings.chapter)) {
      const room = roomId;
      startBusy = true;
      emit();
      void (async () => {
        try {
          const garden = await defaultLoadGarden(settings);
          if (!hosting || phase !== 'waiting' || roomId !== room) return;
          if (!garden || typeof garden !== 'object') {
            startBusy = false;
            emit();
            return;
          }
          startGarden = garden;
          beginCountdown();
        } catch {
          startBusy = false;
          emit();
        }
      })();
      return true;
    }
    startGarden = null;
    beginCountdown();
    return true;
  }

  function onGuestLeave(msg) {
    if (!admit(msg, false)) return;
    if (phase === 'starting' || phase === 'playing') {
      const userId = senderUserId(msg);
      if (ranked) onRankedForfeitBy?.(userId);
      else noteRankedLeave(userId);
      applyPlayLeave(userId, msg);
      return;
    }
    if (!hosting) return;
    const userId = senderUserId(msg);
    if (spectatorOf(spectators, userId)) {
      spectators = removeSpectator(spectators, userId);
      forgetPeerUser(userId);
      publishRoom();
      return;
    }
    if (hostRelease(msg)) {
      forgetPeerUser(userId);
      noteRankedLeave(userId);
      if (abandonRankedIfShort()) return;
      if (phase === 'countdown') abortCountdown(true);
      publishRoom();
    }
  }

  function onGuestSpectate(msg) {
    if (!admit(msg, true)) return;
    if (hostAddSpectator(msg)) publishRoom();
  }

  function onGuestJoin(msg) {
    if (!admit(msg, true)) return;
    const seated = phase !== 'countdown' && hostClaim(msg);
    if (!seated && !hostAddSpectator(msg)) return;
    if (seated && ranked) dial(senderUserId(msg));
    publishRoom();
    if (seated) maybeRankedStart();
  }

  function onGuestReady(msg) {
    if (!admit(msg, false)) return;
    if (!hostSetReady(msg)) return;
    if (phase === 'countdown' && !msg.ready) abortCountdown(true);
    publishRoom();
    if (msg.ready) maybeRankedStart();
  }

  function onGuestReplay(msg) {
    if (!admit(msg, false)) return;
    if (hostSetReplay(msg)) publishRoom();
  }

  subscribeBroadcast?.((data) => {
    if (!data || data.v !== LOBBY_PROTOCOL_VERSION) return;
    if (phase === 'idle' || !roomId || data.roomId !== roomId || data.mode !== mode) return;
    if (!acceptsPeerRules(data)) return;
    if (noteChat(data)) return;
    if (data.type === MSG.CLOSED && !hosting) {
      if (phase === 'starting' || phase === 'playing') return;
      // Match start also broadcasts CLOSED. That one carries phase playing.
      if (phase === 'countdown' && (data.phase === 'playing' || data.phase === 'starting')) return;
      const requeue = ranked && !hadMatch;
      const restoreWorld = hadMatch;
      resetRoom();
      if (restoreWorld) onLeaveMatch?.();
      if (requeue) onRankedPregameEnd?.();
      return;
    }
    if (data.type === MSG.START && data.countdownEndsAt && !hosting) {
      acceptStart(data);
      return;
    }
    if (data.type === MSG.JOIN && ranked && hosting && phase === 'countdown') {
      if (admit(data, true)) sendType(startMessage());
      return;
    }
    if (data.type === MSG.ANNOUNCE && !hosting) {
      if (phase === 'starting' || phase === 'playing') return;
      applyState(data);
      return;
    }
    if (data.type === MSG.CONCEDE) {
      acceptConcede(data);
      return;
    }
    if (data.type === MSG.PAUSE) {
      acceptPause(data);
      return;
    }
    if (data.type === MSG.LEAVE) {
      onGuestLeave(data);
      return;
    }
    if (!hosting) return;
    if (phase === 'starting' || phase === 'playing') return;
    if (data.type === MSG.SPECTATE) {
      onGuestSpectate(data);
      return;
    }
    if (data.type === MSG.JOIN) {
      onGuestJoin(data);
      return;
    }
    if (data.type === MSG.READY) {
      onGuestReady(data);
      return;
    }
    if (data.type === MSG.REPLAY) onGuestReplay(data);
  });

  subscribeLobbyMessage?.((data, lobbyName) => {
    if (phase === 'idle') return;
    const ch = channel();
    if (!ch || lobbyName !== ch) return;
    if (noteChat(data)) return;
    if (data?.type !== 'player_join' && data?.type !== 'player_rejoin') return;
    if (data.from && !sameUserId(data.from, localId())) dial(data.from);
  });

  subscribeMatchLobbyConnected?.((lobbyName) => {
    if (phase === 'idle') return;
    const ch = channel();
    if (!ch || lobbyName !== ch) return;
    getP2p?.()?.announcePresence?.(ch);
    if (!hosting && hostFromHint) dial(hostFromHint);
  });

  subscribePeerConnected?.((peerId) => {
    if (phase === 'idle' || !peerId) return;
    clearLinkGone(userIdForPeer(peerId));
    if (hosting) sendData(snapshot(), peerId);
    else sendData(presenceHello(), peerId);
    if (lockstepOn && session?.role === 'player' && (session.localPlayerId ?? -1) >= 0) {
      sendTickConfirm((session.confirmedTick ?? 0) + 1);
    }
    if (hosting) maybeRankedStart();
  });

  subscribePeerDisconnected?.((peerId) => {
    if (phase === 'idle' || !peerId) return;
    const userId = userIdForPeer(peerId);
    if (!userId || sameUserId(userId, localId())) {
      peerUser.delete(peerId);
      return;
    }
    if (phase === 'starting' || phase === 'playing') {
      const seat = seatOf(seats, userId);
      if (seat?.kind === 'human') {
        if (ranked) rankedHumansDown(userId);
        else customHumanDown(userId);
        return;
      }
      peerUser.delete(peerId);
      if (spectatorOf(spectators, userId)) {
        spectators = removeSpectator(spectators, userId);
        emit();
      }
      return;
    }
    peerUser.delete(peerId);
    if (!hosting) {
      if (sameUserId(userId, hostId) || sameUserId(userId, hostFromHint)) {
        if (seatOf(seats, userId)?.kind === 'human') noteRankedLeave(userId);
        const requeue = ranked && !hadMatch;
        const restoreWorld = hadMatch;
        resetRoom();
        if (restoreWorld) onLeaveMatch?.();
        if (requeue) onRankedPregameEnd?.();
      }
      return;
    }
    if (spectatorOf(spectators, userId)) {
      spectators = removeSpectator(spectators, userId);
      forgetPeerUser(userId);
      publishRoom();
      return;
    }
    if (!seatOf(seats, userId)) return;
    noteRankedLeave(userId);
    seats = releaseSeat(seats, userId);
    forgetPeerUser(userId);
    if (abandonRankedIfShort()) return;
    if (phase === 'countdown') abortCountdown(true);
    publishRoom();
  });

  subscribeDataMessage?.((msg, fromPeerId) => {
    if (!msg || msg.v !== LOBBY_PROTOCOL_VERSION) return;
    if (phase === 'idle') return;
    if (msg.roomId !== roomId || msg.mode !== mode) return;
    if (!acceptsPeerRules(msg)) return;
    if (noteChat(msg)) return;
    notePeerUser(fromPeerId, senderUserId(msg));

    if (msg.type === MSG.SETTING && !hosting && msg.key) {
      if (msg.key === 'seed') settings.seed = (Number(msg.value) || 0) >>> 0;
      else if (msg.key === 'fieldSize') settings.fieldSize = String(msg.value);
      else if (msg.key === 'chapter') {
        settings.chapter = String(msg.value);
        settings.mapName = msg.mapName != null ? cleanMapName(msg.mapName) : '';
        startGarden = null;
      } else if (msg.key === 'allowSpectators') {
        settings.allowSpectators = Boolean(msg.value);
      } else return;
      emit();
      return;
    }
    if (msg.type === MSG.STATE) {
      applyState(msg);
      return;
    }
    if (msg.type === MSG.START && msg.countdownEndsAt) {
      acceptStart(msg);
      return;
    }
    if (msg.type === MSG.JOIN && ranked && hosting && phase === 'countdown') {
      if (admit(msg, true)) sendData(startMessage(), fromPeerId);
      return;
    }
    if (msg.type === MSG.ABORT) {
      abortCountdown(false);
      return;
    }
    if (msg.type === MSG.FRAME && msg.frame) {
      if (sameEpoch(msg)) session?.bufferRemoteFrame(expandTransportFrame(msg.frame));
      return;
    }
    if (msg.type === MSG.CONFIRM && msg.tick != null) {
      if (!sameEpoch(msg)) return;
      const pid = msg.playerId;
      if (session && pid != null && pid !== session.localPlayerId) {
        session.setPeerConfirmedTick(pid, msg.tick);
      }
      return;
    }
    if (msg.type === MSG.CHAPTER) {
      onChapter?.(msg);
      return;
    }
    if (msg.type === MSG.CONCEDE) {
      acceptConcede(msg);
      return;
    }
    if (msg.type === MSG.PAUSE) {
      acceptPause(msg);
      return;
    }
    if (msg.type === MSG.LEAVE) {
      onGuestLeave(msg);
      return;
    }
    if (!hosting) return;
    if (phase === 'starting' || phase === 'playing') return;

    if (msg.type === MSG.SPECTATE) {
      onGuestSpectate(msg);
      return;
    }
    if (msg.type === MSG.JOIN) {
      onGuestJoin(msg);
      return;
    }
    if (msg.type === MSG.READY) {
      onGuestReady(msg);
      return;
    }
    if (msg.type === MSG.REPLAY) onGuestReplay(msg);
  });

  unrefTimer(setInterval(watchOpponents, 500));
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (phase !== 'idle') leaveRoom();
    });
  }

  return {
    createRoom,
    joinRoom,
    spectateRoom,
    leaveRoom,
    setReady,
    setReplayWatch,
    sendView,
    movePerson,
    setSetting,
    setMap,
    requestStart,
    cancelCountdown,
    attachSession,
    detachSession,
    returnToWaiting,
    concede,
    toggleMatchPause,
    hasForfeited: localHasForfeited,
    sendChapter(payload) {
      sendData({ type: MSG.CHAPTER, ...payload });
    },
    sendChat,
    getChatLog: () => chatLog.list(),
    setLockstepEpoch(n) {
      lockstepEpoch = n | 0;
    },
    getLockstepEpoch: () => lockstepEpoch,
    kickstartLockstep,
    lockstepStalled() {
      if (!lockstepOn || !session || phase !== 'playing') return false;
      return (session.lockstepBlockedMs?.() ?? 0) >= LOCKSTEP_STALL_UI_MS;
    },
    /** Player ids whose tick confirm lockstep is parked on, once the stall card is up. */
    lockstepWaiters() {
      if (!lockstepOn || !session || phase !== 'playing') return [];
      if ((session.lockstepBlockedMs?.() ?? 0) < LOCKSTEP_STALL_UI_MS) return [];
      return session.lockstepWaiters?.() ?? [];
    },
    getState: snapshot,
    isActive: () => phase !== 'idle',
    hasPlayed: () => hadMatch,
    isHosting: () => hosting,
    startBlockReason: () => (
      startBusy
        ? 'Loading map…'
        : (mode ? (compatibilityProblem || startBlockReason(mode, seats) || meshStartBlockReason()) : '')
    ),
    canStart: () => (
      !startBusy
      && !compatibilityProblem
      && (mode ? canStart(mode, seats) : false)
      && seatedPeersConnected()
    ),
    countdownMs: () => (phase === 'countdown' ? Math.max(0, countdownEndsAt - Date.now()) : 0),
  };
}
