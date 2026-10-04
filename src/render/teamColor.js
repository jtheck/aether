// TeamColor patches: white albedo × thin-instance owner tint.
// Shared by VAT shirts, static units, buildings, and flags.
// Unlit so outdoor PBR does not grade the swatch. The picker hex is display
// sRGB (name row, health bar). The mesh shader still applies exposure, gamma,
// and contrast, so the instance color is the inverse of that grade.

import {
  createTexture2DFromPixels,
  setPbrUnlit,
} from '../vendor/lite/liteVendor.js';
import { CONTRAST, EXPOSURE } from './celestial.js';

/** Undo the scene exposure lift. Gamma and contrast are inverted per channel. */
export const TEAM_COLOR_UNLIT = 1 / EXPOSURE;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Inverse of the PBR contrast mix (identity below 1, smoothstep blend above). */
function undoContrast(display, contrast) {
  const c = clamp01(display);
  if (contrast < 1) {
    return contrast > 0 ? clamp01((c - 0.5 * (1 - contrast)) / contrast) : 0.5;
  }
  if (contrast === 1) return c;
  const mixAmount = contrast - 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) * 0.5;
    const high = mid * mid * (3 - 2 * mid);
    const out = mid + (high - mid) * mixAmount;
    if (out < c) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/**
 * Display sRGB 0–1 → instance color for an unlit TeamColor mesh.
 * Exposure is cancelled by TEAM_COLOR_UNLIT, so this only undoes contrast
 * and the shader's pow(color, 1/2.2).
 * @param {ArrayLike<number>} displayRgb
 * @param {number} [contrast]
 * @returns {[number, number, number]}
 */
export function sceneTeamRgb(displayRgb, contrast = CONTRAST) {
  return [
    undoContrast(displayRgb[0], contrast) ** 2.2,
    undoContrast(displayRgb[1], contrast) ** 2.2,
    undoContrast(displayRgb[2], contrast) ** 2.2,
  ];
}

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
