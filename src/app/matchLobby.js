// Match-channel waiting room: host snapshot, ready, RTC mesh, countdown.

import { sameUserId, senderUserId } from '../lobby/ids.js';
import { defaultSettings, getMode } from '../lobby/modes.js';
import {
  ANNOUNCE_MS,
  COUNTDOWN_MS,
  LOBBY_PROTOCOL_VERSION,
  MSG,
  generateRoomId,
  matchChannel,
} from '../lobby/protocol.js';
import {
  canStart,
  claimSeat,
  cloneRoster,
  countHumans,
  createRoster,
  releaseSeat,
  seatOf,
  setSeatReady,
  startBlockReason,
} from '../lobby/roster.js';
import { getPlayerColor, getPlayerName } from './settings.js';

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
 * @param {(cfg: object) => void | Promise<void>} [opts.onStartMatch]
 * @param {() => void} [opts.onLeaveMatch]
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
  onStartMatch,
  onLeaveMatch,
} = {}) {
  let mode = null;
  let roomId = null;
  let hosting = false;
  let phase = 'idle';
  let seats = [];
  let settings = defaultSettings('onevsone');
  let hostId = null;
  let hostName = '';
  let hostColor = '';
  let countdownEndsAt = 0;
  let announceTimer = null;
  let countdownTimer = null;
  let hostFromHint = null;
  /** peerId → userId. Disconnects arrive as peer ids; seats are keyed by userId. */
  const peerUser = new Map();
  let session = null;
  let prevSubmit = null;
  let prevCommit = null;
  let bootstrapTimer = null;
  let lockstepOn = false;

  function emit() {
    onChange?.();
  }

  function localId() {
    return getUserId?.() ?? getP2p?.()?.getUserId?.() ?? null;
  }

  function profile() {
    return { userId: localId(), name: getPlayerName(), color: getPlayerColor() };
  }

  function channel() {
    return mode && roomId ? matchChannel(mode, roomId) : '';
  }

  function snapshot() {
    const userId = localId();
    return {
      v: LOBBY_PROTOCOL_VERSION,
      type: MSG.STATE,
      mode,
      roomId,
      hosting,
      phase,
      seats: cloneRoster(seats),
      settings: { ...settings },
      hostId,
      hostName,
      hostColor,
      playerCount: countHumans(seats),
      maxPlayers: getMode(mode)?.maxPlayers ?? seats.length,
      countdownEndsAt,
      userId,
    };
  }

  function announcePayload(type = MSG.ANNOUNCE) {
    const snap = snapshot();
    const userId = localId();
    return {
      type,
      v: LOBBY_PROTOCOL_VERSION,
      mode,
      roomId,
      userId,
      hostId,
      hostName,
      hostColor,
      playerCount: snap.playerCount,
      maxPlayers: snap.maxPlayers,
      settings: snap.settings,
      seats: snap.seats,
      phase,
    };
  }

  function stamp(msg) {
    const userId = localId();
    return {
      v: LOBBY_PROTOCOL_VERSION,
      roomId,
      mode,
      ...msg,
      userId,
    };
  }

  function sendData(msg, peerId = null) {
    const p2p = getP2p?.();
    if (!p2p?.sendData) return;
    p2p.sendData(stamp(msg), peerId);
  }

  /** Waiting-room presence rides the type broadcast so seats do not wait on RTC. */
  function sendType(msg) {
    if (!mode || !roomId) return;
    gameLobby?.announce?.(stamp(msg));
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
    const tick = () => gameLobby?.announce?.(announcePayload());
    tick();
    announceTimer = setInterval(tick, ANNOUNCE_MS);
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

  function dialSeatedPeers() {
    const me = localId();
    for (const uid of seatedUserIds()) {
      if (!sameUserId(uid, me)) dial(uid);
    }
  }

  function sendTickConfirm(tick) {
    if (!lockstepOn || !session) return;
    sendData({ type: MSG.CONFIRM, tick, playerId: session.localPlayerId });
  }

  function kickstartLockstep() {
    if (bootstrapTimer) clearInterval(bootstrapTimer);
    let tries = 0;
    sendTickConfirm((session?.confirmedTick ?? 0) + 1);
    bootstrapTimer = setInterval(() => {
      if (!lockstepOn || (session?.confirmedTick ?? 0) > 0 || ++tries > 16) {
        clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        return;
      }
      sendTickConfirm((session?.confirmedTick ?? 0) + 1);
    }, 300);
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
      if (frame) sendData({ type: MSG.FRAME, frame });
      return frame;
    };
    prevCommit = session.onCommit;
    session.onCommit = (tick, checksum) => {
      sendTickConfirm(tick + 1);
      prevCommit?.(tick, checksum);
    };
    dialSeatedPeers();
    kickstartLockstep();
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
    if (phase !== 'starting') return;
    phase = 'playing';
    stopAnnounce();
    if (hosting) gameLobby?.announce?.(announcePayload(MSG.CLOSED));
    emit();
  }

  function finishCountdown() {
    countdownTimer = null;
    if (phase !== 'countdown') return;
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
      countdownTimer = setTimeout(pulse, 200);
    };
    countdownTimer = setTimeout(pulse, 0);
  }

  function abortCountdown(broadcast = false) {
    if (phase !== 'countdown') return;
    clearCountdown();
    phase = 'waiting';
    if (broadcast && hosting) sendData({ type: MSG.ABORT });
    emit();
  }

  function applyState(msg) {
    if (!msg || (msg.roomId && roomId && msg.roomId !== roomId)) return;
    if (phase === 'starting' || phase === 'playing') return;
    if (msg.seats) {
      let next = cloneRoster(msg.seats);
      const me = localId();
      if (me && !hosting && !seatOf(next, me)) {
        const local = seatOf(seats, me);
        if (local) next = claimSeat(next, local).seats;
      }
      seats = next;
    }
    if (msg.settings) settings = { ...settings, ...msg.settings };
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

  function hostClaim(msg, extra = {}) {
    const userId = senderUserId(msg);
    if (!userId || sameUserId(userId, localId())) return false;
    const claimed = claimSeat(seats, {
      userId,
      name: msg.name,
      color: msg.color,
      ready: Boolean(extra.ready ?? msg.ready),
    });
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
    detachSession();
    stopAnnounce();
    clearCountdown();
    leaveMatchChannel();
    if (mode) gameLobby?.release?.(mode);
    mode = null;
    roomId = null;
    hosting = false;
    phase = 'idle';
    seats = [];
    hostId = null;
    hostName = '';
    hostColor = '';
    hostFromHint = null;
    peerUser.clear();
    settings = defaultSettings('onevsone');
    emit();
  }

  function createRoom(nextMode) {
    if (!getMode(nextMode)) return false;
    if (phase !== 'idle') leaveRoom();
    const me = profile();
    if (!me.userId) return false;
    mode = nextMode;
    roomId = generateRoomId();
    hosting = true;
    phase = 'waiting';
    settings = defaultSettings(nextMode);
    hostId = me.userId;
    hostName = me.name;
    hostColor = me.color;
    seats = createRoster(nextMode);
    seats = claimSeat(seats, { ...me, ready: true }).seats;
    joinMatchChannel();
    startAnnounce();
    emit();
    return true;
  }

  function joinRoom(nextMode, nextRoomId, from) {
    if (!getMode(nextMode) || !nextRoomId) return false;
    if (phase !== 'idle') leaveRoom();
    const me = profile();
    if (!me.userId) return false;
    mode = nextMode;
    roomId = nextRoomId;
    hosting = false;
    phase = 'waiting';
    settings = defaultSettings(nextMode);
    hostFromHint = from ?? null;
    hostId = from ?? null;
    seats = createRoster(nextMode);
    seats = claimSeat(seats, { ...me, ready: false }).seats;
    gameLobby?.hold?.(nextMode);
    joinMatchChannel();
    sendType({ type: MSG.JOIN, name: me.name, color: me.color, ready: false });
    if (from) dial(from);
    emit();
    return true;
  }

  function leaveRoom() {
    if (phase === 'idle') return;
    const wasPlaying = phase === 'playing' || phase === 'starting';
    if (hosting) {
      gameLobby?.announce?.(announcePayload(MSG.CLOSED));
    } else {
      sendType({ type: MSG.LEAVE });
      sendData({ type: MSG.LEAVE });
    }
    resetRoom();
    if (wasPlaying) onLeaveMatch?.();
  }

  function setReady(ready) {
    if (hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return;
    const me = localId();
    if (!me) return;
    seats = setSeatReady(seats, me, ready);
    if (phase === 'countdown' && !ready) abortCountdown(false);
    sendType({ type: MSG.READY, ready: Boolean(ready) });
    sendData({ type: MSG.READY, ready: Boolean(ready) });
    emit();
  }

  function setSetting(key, value) {
    if (!hosting || phase === 'idle' || phase === 'starting' || phase === 'playing') return;
    if (key === 'seed') settings.seed = (Number(value) || 0) >>> 0;
    else if (key === 'fieldSize') settings.fieldSize = String(value);
    else if (key === 'chapter') settings.chapter = String(value);
    else return;
    sendData({ type: MSG.SETTING, key, value: settings[key] });
    startAnnounce();
    emit();
  }

  function requestStart() {
    if (!hosting || phase !== 'waiting') return false;
    if (!canStart(mode, seats)) return false;
    armCountdown(Date.now() + COUNTDOWN_MS);
    sendData({ type: MSG.START, countdownEndsAt });
    startAnnounce();
    return true;
  }

  subscribeBroadcast?.((data) => {
    if (!data || data.v !== LOBBY_PROTOCOL_VERSION) return;
    if (phase === 'idle' || !roomId || data.roomId !== roomId) return;
    if (data.type === MSG.CLOSED && !hosting) {
      if (phase === 'countdown' || phase === 'starting' || phase === 'playing') return;
      resetRoom();
      return;
    }
    if (data.type === MSG.ANNOUNCE && !hosting) {
      if (phase === 'starting' || phase === 'playing') return;
      applyState(data);
      return;
    }
    if (!hosting) return;
    if (phase === 'starting' || phase === 'playing') return;
    if (data.type === MSG.JOIN) {
      if (phase === 'countdown') return;
      if (hostClaim(data)) {
        startAnnounce();
        sendData(snapshot());
        emit();
      }
      return;
    }
    if (data.type === MSG.LEAVE) {
      if (hostRelease(data)) {
        if (phase === 'countdown') abortCountdown(true);
        startAnnounce();
        sendData(snapshot());
        emit();
      }
      return;
    }
    if (data.type === MSG.READY) {
      if (hostSetReady(data)) {
        if (phase === 'countdown' && !data.ready) abortCountdown(true);
        startAnnounce();
        sendData(snapshot());
        emit();
      }
    }
  });

  subscribeLobbyMessage?.((data, lobbyName) => {
    if (phase === 'idle') return;
    const ch = channel();
    if (!ch || lobbyName !== ch) return;
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
    if (hosting) sendData(snapshot(), peerId);
    else {
      const me = profile();
      sendData({ type: MSG.JOIN, name: me.name, color: me.color, ready: Boolean(seatOf(seats, me.userId)?.ready) }, peerId);
    }
  });

  subscribePeerDisconnected?.((peerId) => {
    if (phase === 'idle' || !hosting || !peerId) return;
    if (phase === 'starting' || phase === 'playing') return;
    const userId = peerUser.get(peerId);
    peerUser.delete(peerId);
    if (!userId || !seatOf(seats, userId)) return;
    seats = releaseSeat(seats, userId);
    if (phase === 'countdown') abortCountdown(true);
    startAnnounce();
    sendData(snapshot());
    emit();
  });

  subscribeDataMessage?.((msg, fromPeerId) => {
    if (!msg || msg.v !== LOBBY_PROTOCOL_VERSION) return;
    if (phase === 'idle') return;
    if (msg.roomId && roomId && msg.roomId !== roomId) return;
    if (msg.mode && mode && msg.mode !== mode) return;
    notePeerUser(fromPeerId, senderUserId(msg));

    if (msg.type === MSG.STATE) {
      applyState(msg);
      return;
    }
    if (msg.type === MSG.START && msg.countdownEndsAt) {
      armCountdown(msg.countdownEndsAt);
      return;
    }
    if (msg.type === MSG.ABORT) {
      abortCountdown(false);
      return;
    }
    if (msg.type === MSG.FRAME && msg.frame) {
      session?.bufferRemoteFrame(msg.frame);
      return;
    }
    if (msg.type === MSG.CONFIRM && msg.tick != null) {
      const pid = msg.playerId;
      if (session && pid != null && pid !== session.localPlayerId) {
        session.setPeerConfirmedTick(pid, msg.tick);
      }
      return;
    }
    if (!hosting) return;
    if (phase === 'starting' || phase === 'playing') return;

    if (msg.type === MSG.JOIN) {
      if (phase === 'countdown') return;
      if (hostClaim(msg)) {
        sendData(snapshot());
        startAnnounce();
        emit();
      }
      return;
    }
    if (msg.type === MSG.LEAVE) {
      if (hostRelease(msg)) {
        if (phase === 'countdown') abortCountdown(true);
        sendData(snapshot());
        startAnnounce();
        emit();
      }
      return;
    }
    if (msg.type === MSG.READY) {
      if (hostSetReady(msg)) {
        if (phase === 'countdown' && !msg.ready) abortCountdown(true);
        sendData(snapshot());
        emit();
      }
    }
  });

  return {
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    setSetting,
    requestStart,
    attachSession,
    detachSession,
    getState: snapshot,
    isActive: () => phase !== 'idle',
    isHosting: () => hosting,
    startBlockReason: () => (mode ? startBlockReason(mode, seats) : ''),
    canStart: () => mode ? canStart(mode, seats) : false,
    countdownMs: () => (phase === 'countdown' ? Math.max(0, countdownEndsAt - Date.now()) : 0),
  };
}
