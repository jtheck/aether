import { sameUserId } from './ids.js';
import { getMode } from './modes.js';

/**
 * @typedef {{
 *   index: number,
 *   team: number,
 *   userId: string | null,
 *   name: string,
 *   color: string,
 *   dlc?: string[],
 *   skins?: Record<number, string>,
 *   ready: boolean,
 *   kind: 'empty' | 'human',
 * }} LobbySeat
 */

function copyDlc(list) {
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : [];
}

function copySkins(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<number | string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** @param {string} modeId @returns {LobbySeat[]} */
export function createRoster(modeId) {
  const mode = getMode(modeId);
  const n = mode?.maxPlayers ?? 0;
  const teams = Boolean(mode?.teams);
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    team: teams ? (i < 2 ? 0 : 1) : 0,
    userId: null,
    name: '',
    color: '',
    dlc: [],
    skins: {},
    ready: false,
    kind: 'empty',
  }));
}

/** @param {LobbySeat[]} seats */
export function cloneRoster(seats) {
  return seats.map((s) => ({ ...s, dlc: copyDlc(s.dlc), skins: copySkins(s.skins) }));
}

/** @param {LobbySeat[]} seats */
export function countHumans(seats) {
  let n = 0;
  for (const s of seats) if (s.kind === 'human') n += 1;
  return n;
}

/** @param {LobbySeat[]} seats @param {string | null | undefined} userId */
export function seatOf(seats, userId) {
  if (userId == null || userId === '') return null;
  return seats.find((s) => sameUserId(s.userId, userId)) ?? null;
}

/**
 * @param {LobbySeat[]} seats
 * @param {{ userId: string, name?: string, color?: string, dlc?: string[], skins?: Record<number, string>, ready?: boolean }} player
 */
export function claimSeat(seats, player) {
  const next = cloneRoster(seats);
  if (player?.userId == null || player.userId === '') {
    return { seats: next, index: -1, ok: false };
  }
  const existing = seatOf(next, player.userId);
  if (existing) {
    if (player.name != null) existing.name = player.name;
    if (player.color != null) existing.color = player.color;
    if (player.dlc != null) existing.dlc = copyDlc(player.dlc);
    if (player.skins != null) existing.skins = copySkins(player.skins);
    if (player.ready != null) existing.ready = player.ready;
    return { seats: next, index: existing.index, ok: true };
  }
  const empty = next.find((s) => s.kind === 'empty');
  if (!empty) return { seats: next, index: -1, ok: false };
  empty.userId = player.userId;
  empty.name = player.name ?? '';
  empty.color = player.color ?? '';
  empty.dlc = copyDlc(player.dlc);
  empty.skins = copySkins(player.skins);
  empty.ready = Boolean(player.ready);
  empty.kind = 'human';
  return { seats: next, index: empty.index, ok: true };
}

/** @param {LobbySeat[]} seats @param {string} userId */
export function releaseSeat(seats, userId) {
  const next = cloneRoster(seats);
  const s = seatOf(next, userId);
  if (!s) return next;
  s.userId = null;
  s.name = '';
  s.color = '';
  s.dlc = [];
  s.skins = {};
  s.ready = false;
  s.kind = 'empty';
  return next;
}

/** @param {LobbySeat[]} seats @param {string} userId @param {boolean} ready */
export function setSeatReady(seats, userId, ready) {
  const next = cloneRoster(seats);
  const s = seatOf(next, userId);
  if (s) s.ready = Boolean(ready);
  return next;
}

/** @param {LobbySeat[]} seats */
export function allHumansReady(seats) {
  const humans = seats.filter((s) => s.kind === 'human');
  return humans.length > 0 && humans.every((s) => s.ready);
}

/** @param {string} modeId @param {LobbySeat[]} seats */
export function canStart(modeId, seats) {
  const mode = getMode(modeId);
  if (!mode) return false;
  if (countHumans(seats) < mode.minHumans) return false;
  return allHumansReady(seats);
}

/** @param {string} modeId @param {LobbySeat[]} seats */
export function startBlockReason(modeId, seats) {
  const mode = getMode(modeId);
  if (!mode) return 'Unknown mode';
  const n = countHumans(seats);
  if (n < mode.minHumans) {
    return mode.minHumans <= 1 ? 'Need a player' : `Need ${mode.minHumans} players`;
  }
  if (!allHumansReady(seats)) return 'Waiting for ready';
  return '';
}
