// Pre-match lobby mode constraints. Same room shell; only seats / defaults change.

export const FIELD_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];

export const ADVENTURE_CHAPTERS = [
  { id: 'ch1', name: 'Chapter 1', garden: '/maps/chapter1.garden' },
  { id: 'ch2', name: 'Chapter 2' },
];

/** @param {string} [chapterId] */
export function gardenUrlForChapter(chapterId) {
  const ch = ADVENTURE_CHAPTERS.find((c) => c.id === chapterId);
  return ch?.garden || '';
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
