import { getMode, isLobbyMode } from './modes.js';

export const LOBBY_PROTOCOL_VERSION = 1;
export const ANNOUNCE_MS = 3500;
export const ANNOUNCE_TTL_MS = 12000;
export const COUNTDOWN_MS = 3000;

export const MSG = {
  ANNOUNCE: 'lobby_announce',
  CLOSED: 'lobby_closed',
  STATE: 'lobby_state',
  JOIN: 'lobby_join',
  LEAVE: 'lobby_leave',
  READY: 'lobby_ready',
  SETTING: 'lobby_setting',
  START: 'lobby_start',
  ABORT: 'lobby_abort',
  FRAME: 'lobby_frame',
  CONFIRM: 'lobby_confirm',
  CHAPTER: 'lobby_chapter',
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
  for (const id of ['onevsone', 'teams', 'adventure']) {
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
