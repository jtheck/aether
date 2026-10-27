// Models that get a portrait sprite: units, buildings, upgrades, DLC skins,
// and the field resources shown in the manual. Other props stay out.

/** Trees and the three rocks. Portraits are for the manual. */
export const RESOURCE_SPRITE_URLS = Object.freeze([
  '/assets/models/trees.glb',
  '/assets/models/rocks_plain.glb',
  '/assets/models/rocks_moss.glb',
  '/assets/models/rocks_snow.glb',
]);

import { allDlcMeshUrls, allDlcVatDefs } from '../app/dlcCatalog.js';
import { bakedMeshStem } from '../render/bakedAssets.js';
import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import { VAT_UNIT_DEFS } from '../render/vatUnits.js';
import { BUILDING_MODEL_URLS, UPGRADE_MODEL_URLS } from '../sim/buildings.js';

/** Tighter crop for wide or tall meshes. Higher fills more of the cell. */
const ZOOM_BY_STEM = {
  agora: 1.6,
  camp: 1.5,
  village: 1.6,
  farm: 1.6,
  silo: 1.4,
  tower: 1.4,
  mine: 1.5,
  tavern: 1.5,
  moonwell: 1.4,
  barracks: 1.6,
  lab: 1.6,
  workshop: 1.5,
  factory: 1.6,
  church: 1.4,
  well: 1.4,
  perch: 1.4,
  derrick: 1.4,
  grove: 1.4,
  wagon: 1.3,
  siegewagon: 1.3,
  dirigible: 1.3,
  apc: 1.3,
};

/** Three-quarter portrait. Alpha is the orbit, beta is the height (π/2 is level). */
const VIEW_ALPHA = -Math.PI * 0.75;
const VIEW_BETA = Math.PI / 3;

/**
 * Upgrades are flat icons. Eighteen degrees off the face, and the same above
 * the horizon, so the front reads instead of the edge.
 */
const UPGRADE_ALPHA = -Math.PI / 2 - Math.PI / 10;
const UPGRADE_BETA = Math.PI / 2 - Math.PI / 10;

/** @returns {{ url: string, zoom: number, alpha: number, beta: number }[]} */
export function spriteBakeEntries() {
  const upgradeUrls = new Set(Object.values(UPGRADE_MODEL_URLS));
  const urls = new Set([
    ...Object.values(UNIT_MODEL_URLS),
    ...Object.values(VAT_UNIT_DEFS).map((def) => def.url),
    ...Object.values(BUILDING_MODEL_URLS),
    ...upgradeUrls,
    ...allDlcMeshUrls(),
    ...allDlcVatDefs().map((def) => def.url),
    ...RESOURCE_SPRITE_URLS,
  ]);
  return [...urls].sort().map((url) => ({
    url,
    zoom: ZOOM_BY_STEM[bakedMeshStem(url)] ?? 1,
    alpha: upgradeUrls.has(url) ? UPGRADE_ALPHA : VIEW_ALPHA,
    beta: upgradeUrls.has(url) ? UPGRADE_BETA : VIEW_BETA,
  }));
}
