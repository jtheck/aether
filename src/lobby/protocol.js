import { MODE_IDS, getMode, isLobbyMode } from './modes.js';

export const LOBBY_PROTOCOL_VERSION = 1;
export const ANNOUNCE_MS = 3500;
export const ANNOUNCE_TTL_MS = 12000;
export const COUNTDOWN_MS = 3000;
/** Versus card after the quiet lobby countdown. Ranked already spends its countdown on that card. */
export const MATCH_CARD_MS = 3000;

/** Unranked skirmish lobbies: quiet countdown, then the match card. Adventure stays quiet only. */
export function lobbyStartMs(mode, ranked) {
  if (ranked || mode === 'adventure') return COUNTDOWN_MS;
  return COUNTDOWN_MS + MATCH_CARD_MS;
}

/** Milliseconds of match card at the end of an unranked skirmish countdown. */
export function matchCardMs(state) {
  if (!state || state.ranked || state.mode === 'adventure') return 0;
  return MATCH_CARD_MS;
}

/** Time left on the quiet "Starting in N" line. */
export function quietCountdownMs(state, fullMs) {
  const card = matchCardMs(state);
  if (!card || state?.phase !== 'countdown') return fullMs;
  return Math.max(0, fullMs - card);
}

/** True once the quiet line is done and the versus card should cover the lobby. */
export function matchCardOpen(state, fullMs) {
  const card = matchCardMs(state);
  if (!card) return false;
  if (state.phase === 'starting') return true;
  if (state.phase !== 'countdown') return false;
  return fullMs <= card;
}

export const MSG = {
  ANNOUNCE: 'lobby_announce',
  CLOSED: 'lobby_closed',
  STATE: 'lobby_state',
  JOIN: 'lobby_join',
  SPECTATE: 'lobby_spectate',
  LEAVE: 'lobby_leave',
  CONCEDE: 'lobby_concede',
  PAUSE: 'lobby_pause',
  READY: 'lobby_ready',
  REPLAY: 'lobby_replay',
  SETTING: 'lobby_setting',
  START: 'lobby_start',
  ABORT: 'lobby_abort',
  FRAME: 'lobby_frame',
  CONFIRM: 'lobby_confirm',
  CHAPTER: 'lobby_chapter',
  CHAT: 'chat',
};

/** @param {string} mode */
export function typeChannel(mode) {
  return getMode(mode)?.typeChannel ?? '';
}

/** @param {string} mode @param {string} roomId */
export function matchChannel(mode, roomId) {
  const base = typeChannel(mode);
  return base && roomId ? `${base}:${roomId}` : '';
}

/** @param {string | undefined} lobbyName */
export function parseMatchChannel(lobbyName) {
  if (!lobbyName) return null;
  for (const id of MODE_IDS) {
    const prefix = `${typeChannel(id)}:`;
    if (lobbyName.startsWith(prefix)) {
      return { mode: id, roomId: lobbyName.slice(prefix.length) };
    }
  }
  return null;
}

export function generateRoomId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `lobby-${t}-${r}`;
}

/** @param {string} [id] */
export function shortRoomId(id) {
  if (!id) return '?';
  return id.length <= 8 ? id : id.slice(-8);
}

export { isLobbyMode };
