// Models that get a portrait sprite: units, buildings, upgrades, and DLC skins.
// Scenery and props stay out — those are not selection or help icons.

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

/** @returns {{ url: string, zoom: number }[]} */
export function spriteBakeEntries() {
  const urls = new Set([
    ...Object.values(UNIT_MODEL_URLS),
    ...Object.values(VAT_UNIT_DEFS).map((def) => def.url),
    ...Object.values(BUILDING_MODEL_URLS),
    ...Object.values(UPGRADE_MODEL_URLS),
    ...allDlcMeshUrls(),
    ...allDlcVatDefs().map((def) => def.url),
  ]);
  return [...urls].sort().map((url) => ({
    url,
    zoom: ZOOM_BY_STEM[bakedMeshStem(url)] ?? 1,
  }));
}
