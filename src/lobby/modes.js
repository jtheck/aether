// Pre-match lobby mode constraints. Same room shell; only seats / defaults change.

import { adventureChapters } from './adventureCampaign.js';

export const FIELD_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];

/** Ranked 1v1 rotates the default board and the next two sizes. */
export const LADDER_FIELD_SIZES = ['tiny', 'small', 'medium'];

/** Ranked teams rotates the teams default and the next two sizes. */
export const TEAMS_LADDER_FIELD_SIZES = ['small', 'medium', 'large'];

/** Live chapters from maps/adventure/adventure.campaign. Empty until that file loads. */
export function selectableAdventureChapters() {
  return adventureChapters();
}

/** Official chapter id, a workshop ref, a web pack chapter, or the session garden. */
export function gardenUrlForChapter(chapterId) {
  const raw = String(chapterId || '');
  const ch = adventureChapters().find((c) => c.id === raw);
  if (ch?.garden) return ch.garden;
  const lower = raw.toLowerCase();
  if (lower === 'session' || lower.startsWith('workshop:') || lower.startsWith('pack:')) return raw;
  if (raw.startsWith('/maps/')) return raw;
  return '';
}

/** Host must embed the garden: web guests cannot fetch Workshop, pack, or session maps. */
export function chapterRefNeedsHostGarden(chapterId) {
  const raw = String(chapterId || '').toLowerCase();
  return raw === 'session' || raw.startsWith('workshop:') || raw.startsWith('pack:');
}

export function chapterIdForGardenUrl(url) {
  return adventureChapters().find((c) => c.garden === url)?.id || '';
}

/** Corner mark for story mode — "Ch 1" from id, garden url, or name. */
export function chapterLabelFor(ref = {}) {
  const id = String(ref.chapter || '');
  const url = String(ref.gardenUrl || ref.url || '');
  const name = String(ref.name || ref.n || '');
  const ch = adventureChapters().find((c) => c.id === id || (url && c.garden === url));
  const label = ch?.name || name;
  const num = label.match(/chapter\s*(\d+)/i)?.[1]
    || String(ch?.id || id || url).match(/chapter(\d+)/i)?.[1]
    || String(ch?.id || id).match(/^ch(\d+)$/i)?.[1];
  if (num) return `Ch ${num}`;
  if (ch?.name) return ch.name;
  if (id.toLowerCase().startsWith('workshop:') || url.toLowerCase().startsWith('workshop:')) {
    return name.trim() || 'Workshop';
  }
  if (id.toLowerCase().startsWith('pack:') || url.toLowerCase().startsWith('pack:')) {
    return name.trim() || 'Custom';
  }
  if (id === 'session' || url === 'session') return name.trim() || 'Custom';
  return name.trim();
}

/** Ranked hill rotates the larger boards. The drop wants room around five pads. */
export const KOTH_LADDER_FIELD_SIZES = ['medium', 'large', 'huge'];

/** @typedef {'onevsone' | 'teams' | 'adventure' | 'koth'} LobbyModeId */

/** @type {Record<LobbyModeId, {
 *   id: LobbyModeId,
 *   name: string,
 *   typeChannel: string,
 *   maxPlayers: number,
 *   teams: boolean,
 *   defaultFieldSize: string,
 *   allowAi: boolean,
 *   minHumans: number,
 *   hasChapter: boolean,
 *   customMap: boolean,
 *   spectators: boolean,
 * }>} */
export const MODES = {
  onevsone: {
    id: 'onevsone',
    name: '1 vs 1',
    typeChannel: 'aether-v2-1v1',
    maxPlayers: 2,
    teams: false,
    defaultFieldSize: 'tiny',
    allowAi: true,
    minHumans: 2,
    hasChapter: false,
    customMap: true,
    spectators: true,
  },
  teams: {
    id: 'teams',
    name: 'Teams',
    typeChannel: 'aether-v2-teams',
    maxPlayers: 4,
    teams: true,
    defaultFieldSize: 'small',
    allowAi: true,
    minHumans: 2,
    hasChapter: false,
    customMap: true,
    spectators: true,
  },
  adventure: {
    id: 'adventure',
    name: 'Adventure',
    typeChannel: 'aether-v2-adventure',
    maxPlayers: 4,
    teams: false,
    defaultFieldSize: 'small',
    allowAi: false,
    minHumans: 1,
    hasChapter: true,
    customMap: false,
    spectators: false,
  },
  koth: {
    id: 'koth',
    name: 'King of the Hill',
    typeChannel: 'aether-v2-koth',
    maxPlayers: 5,
    teams: false,
    defaultFieldSize: 'medium',
    allowAi: false,
    minHumans: 3,
    hasChapter: false,
    customMap: false,
    spectators: true,
  },
};

export const MODE_IDS = /** @type {LobbyModeId[]} */ (Object.keys(MODES));

/** @param {string} id */
export function isLobbyMode(id) {
  return Object.prototype.hasOwnProperty.call(MODES, id);
}

/** @param {string} id */
export function getMode(id) {
  return isLobbyMode(id) ? MODES[id] : null;
}

/** Odd table chunks → tiles (16 tiles per chunk). */
export const FIELD_CHUNKS = {
  tiny: 5,
  small: 9,
  medium: 13,
  large: 17,
  huge: 21,
};

const TILES_PER_CHUNK = 16;

/** @param {string} [fieldSize] */
export function mapTilesForField(fieldSize) {
  const chunks = FIELD_CHUNKS[fieldSize] ?? FIELD_CHUNKS.small;
  const tiles = chunks * TILES_PER_CHUNK;
  return { mapW: tiles, mapH: tiles };
}

/** @param {string} modeId */
export function isLobbyPlayMode(modeId) {
  return isLobbyMode(modeId);
}

/**
 * A declared garden type may sit in this lobby. Blank matches either competitive mode.
 * Adventure and King of the Hill maps stay out of 1v1 and teams.
 * @param {unknown} mapType
 * @param {string} modeId
 */
export function mapTypeFitsLobby(mapType, modeId) {
  const raw = String(mapType || '').trim().toLowerCase();
  if (!raw) return true;
  const id = raw === '1v1' || raw === '1vs1' || raw === 'ffa' ? 'onevsone' : raw;
  return id === modeId;
}

/** Mode can host watchers, and this room has the box checked. */
export function lobbyAllowsSpectators(modeId, settings) {
  if (!getMode(modeId)?.spectators) return false;
  return settings?.allowSpectators !== false;
}

/** @param {string} modeId */
export function defaultSettings(modeId, fieldSize) {
  const mode = getMode(modeId);
  if (!mode) return { fieldSize: 'small', seed: 0, chapter: '', allowSpectators: false };
  return {
    fieldSize: fieldSize && FIELD_SIZES.includes(fieldSize) ? fieldSize : mode.defaultFieldSize,
    seed: (Math.random() * 0xffffffff) >>> 0,
    chapter: mode.hasChapter ? (adventureChapters()[0]?.id || '') : '',
    allowSpectators: Boolean(mode.spectators),
  };
}
