// Pre-match lobby mode constraints. Same room shell; only seats / defaults change.

import { CHAPTER_CATALOG } from '../story/campaign.js';

export const FIELD_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];

/** Playable adventure chapters in the lobby. Full 5-episode campaign stays off the UI for now. */
export const LEGACY_CHAPTERS = [
  { id: 'ch1', name: 'Chapter 1', garden: '/maps/chapter1.garden' },
  { id: 'ch2', name: 'Chapter 2', garden: '/maps/chapter2.garden' },
  { id: 'ch3', name: 'Chapter 3', garden: '/maps/chapter3.garden' },
];

const CAMPAIGN_CHAPTER_OPTIONS = CHAPTER_CATALOG.map(({ id, name, garden }) => ({ id, name, garden }));

/** Every official garden the sim can start — picker is a subset. */
const KNOWN_CHAPTERS = [...LEGACY_CHAPTERS, ...CAMPAIGN_CHAPTER_OPTIONS];

/** Selectable adventure chapters: the old grove three. */
export const ADVENTURE_CHAPTERS = [...LEGACY_CHAPTERS];

function pageHostname() {
  return typeof location !== 'undefined' ? location.hostname : '';
}

function pageSearch() {
  return typeof location !== 'undefined' ? location.search : '';
}

/** Same loopback gate as `?dlc=` — ignored on aether.garden. */
export function isLocalStoryHost(hostname = pageHostname()) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Local `?story=1` unlocks the 5-episode catalog in the adventure picker. */
export function showFullStoryPicker(search = pageSearch(), hostname = pageHostname()) {
  if (!isLocalStoryHost(hostname)) return false;
  const q = new URLSearchParams(search).get('story');
  return q === '1' || q === 'all' || q === 'true';
}

export function selectableAdventureChapters(search = pageSearch(), hostname = pageHostname()) {
  if (showFullStoryPicker(search, hostname)) return [...LEGACY_CHAPTERS, ...CAMPAIGN_CHAPTER_OPTIONS];
  return ADVENTURE_CHAPTERS;
}

/** Official chapter id, or a workshop:<id>[/file] ref. */
export function gardenUrlForChapter(chapterId) {
  const raw = String(chapterId || '');
  const ch = KNOWN_CHAPTERS.find((c) => c.id === raw);
  if (ch?.garden) return ch.garden;
  return raw.toLowerCase().startsWith('workshop:') ? raw : '';
}

export function chapterIdForGardenUrl(url) {
  return KNOWN_CHAPTERS.find((c) => c.garden === url)?.id || '';
}

/** Corner mark for story mode — "Ch 1" from id, garden url, or name. */
export function chapterLabelFor(ref = {}) {
  const id = String(ref.chapter || '');
  const url = String(ref.gardenUrl || ref.url || '');
  const name = String(ref.name || ref.n || '');
  const ch = KNOWN_CHAPTERS.find((c) => c.id === id || (url && c.garden === url));
  const num = ch?.id.match(/\d+/)?.[0]
    || name.match(/chapter\s*(\d+)/i)?.[1]
    || url.match(/chapter(\d+)/i)?.[1];
  if (num) return `Ch ${num}`;
  if (id.toLowerCase().startsWith('workshop:') || url.toLowerCase().startsWith('workshop:')) {
    return name.trim() || 'Workshop';
  }
  return name.trim();
}

/** @typedef {'onevsone' | 'teams' | 'adventure'} LobbyModeId */

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

/** @param {string} modeId */
export function defaultSettings(modeId, fieldSize) {
  const mode = getMode(modeId);
  if (!mode) return { fieldSize: 'small', seed: 0, chapter: '' };
  return {
    fieldSize: fieldSize && FIELD_SIZES.includes(fieldSize) ? fieldSize : mode.defaultFieldSize,
    seed: (Math.random() * 0xffffffff) >>> 0,
    chapter: mode.hasChapter ? ADVENTURE_CHAPTERS[0].id : '',
  };
}
