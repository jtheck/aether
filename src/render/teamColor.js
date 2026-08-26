// TeamColor patches: white albedo × thin-instance owner tint.
// Shared by VAT shirts, static units, buildings, and flags.
// Unlit so the colour-picker hex is what you see — outdoor PBR + gray
// emissive was washing that swatch into a chalk pastel.

import {
  createTexture2DFromPixels,
  setPbrUnlit,
} from '../vendor/lite/liteVendor.js';
import { EXPOSURE } from './celestial.js';

/** Undo the scene exposure lift so #FF0000 on a roof matches the menu row. */
export const TEAM_COLOR_UNLIT = 1 / EXPOSURE;

/** Shared 1×1 white + ORM so authored TeamColor maps cannot fight the tint. */
let teamColorMaps = null;

function getTeamColorMaps(engine) {
  if (teamColorMaps) return teamColorMaps;
  const white = createTexture2DFromPixels(engine, new Uint8Array([255, 255, 255, 255]), 1, 1, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  const orm = createTexture2DFromPixels(engine, new Uint8Array([255, 140, 0, 255]), 1, 1, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  teamColorMaps = { white, orm };
  return teamColorMaps;
}

export function isTeamColorName(name) {
  return String(name ?? '').toLowerCase().includes('teamcolor');
}

export function isTeamColorMaterial(mat) {
  return isTeamColorName(mat?.name);
}

/**
 * Replace the part's material so instance color is a solid team swatch.
 * Needs a Lite `_buildGroup` (from the part or a donor) or the mesh never draws.
 */
export function prepareTeamColorMaterial(engine, mesh, donorMat = null) {
  const build = donorMat?._buildGroup ?? mesh.material?._buildGroup;
  if (!build) return false;
  const maps = getTeamColorMaps(engine);
  mesh.material = {
    baseColorTexture: maps.white,
    ormTexture: maps.orm,
    name: 'TeamColor',
    baseColorFactor: [1, 1, 1, 1],
    doubleSided: true,
    alpha: 1,
    metallicFactor: 0,
    roughnessFactor: 0.55,
    occlusionStrength: 0,
    enableSpecularAA: true,
    _buildGroup: build,
    _uboVersion: 0,
  };
  const u = TEAM_COLOR_UNLIT;
  setPbrUnlit(mesh.material, [u, u, u]);
  return true;
}
