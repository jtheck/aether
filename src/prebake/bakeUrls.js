// Canonical GLB URL list for offline prebake (mesh + sockets). VAT is separate.

import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import { VAT_UNIT_DEFS } from '../render/vatUnits.js';
import { BUILDING_MODEL_URLS, UPGRADE_MODEL_URLS } from '../sim/buildings.js';
import { allDlcMeshUrls, allDlcVatDefs } from '../app/dlcCatalog.js';

const EXTRA = [
  '/assets/models/collar.glb',
  '/assets/models/target.glb',
  '/assets/models/frog.glb',
  '/assets/models/mushroom.glb',
  '/assets/models/agora.glb',
  '/assets/models/flag.glb',
  '/assets/models/trees.glb',
  '/assets/models/rocks_plain.glb',
  '/assets/models/rocks_moss.glb',
  '/assets/models/rocks_snow.glb',
];

/** @returns {string[]} */
export function allMeshBakeUrls() {
  const urls = new Set([
    ...Object.values(UNIT_MODEL_URLS),
    ...allDlcMeshUrls(),
    ...Object.values(BUILDING_MODEL_URLS),
    ...Object.values(UPGRADE_MODEL_URLS),
    ...EXTRA,
  ]);
  return [...urls].sort();
}

/** @returns {{ url: string, idleClip: string, walkClip: string, carryClip?: string, chopClip?: string, attackClip?: string }[]} */
export function allVatBakeDefs() {
  return [
    ...Object.values(VAT_UNIT_DEFS).map((d) => ({
      url: d.url,
      idleClip: d.idleClip,
      walkClip: d.walkClip,
      carryClip: d.carryClip,
      chopClip: d.chopClip,
      attackClip: d.attackClip,
    })),
    ...allDlcVatDefs(),
  ];
}
