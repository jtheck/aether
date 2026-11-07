// TeamColor patches: white albedo × thin-instance owner tint.
// Shared by VAT shirts, static units, buildings, and flags.
// Unlit so outdoor PBR does not grade the swatch. The picker hex is display
// sRGB (name row, health bar). The mesh shader still applies exposure, gamma,
// and contrast, so the instance color is the inverse of that grade.
// A fragment plugin runs a soft sheen across the swatch. VAT stays on the
// PBR vertex shader.

import {
  createTexture2DFromPixels,
  markMaterialUboDirty,
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

// One wash across the part, in the part's own bounds. A world grid tiled
// through buildings and stretched a vertical flag. The thin axis is dropped
// so cloth sheens across its face. Instance origin only staggers the clock.
const GLIMMER_VERT = `
out.gLocal = position.xyz;
out.gOrigin = world3.xz;
`;
const GLIMMER = `
let ext = max(material.gSize, vec3<f32>(0.001));
let p = saturate((input.gLocal - material.gMin) / ext);
let span = max(max(ext.x, ext.y), ext.z);
let axis = vec3<f32>(0.72, 0.64, 0.26) * (ext / span);
let along = dot(p, axis) / max(dot(vec3<f32>(1.0), axis), 0.001);
let travel = 0.5 + 0.5 * sin(material.glimmerT * 0.55 + dot(input.gOrigin, vec2<f32>(0.017, 0.013)));
let band = saturate(1.0 - abs(along - travel) * 2.2);
let sheen = band;
let gH = normalize(V + vec3<f32>(0.2, 0.75, 0.35));
let gFacing = pow(saturate(dot(normalize(N), gH)), 4.0);
let wash = sheen * (0.45 + 0.55 * gFacing);
color = min(color + color * wash * 0.85 + vec3<f32>(wash * 0.12), vec3<f32>(1.0));
`;

/** @type {Set<object>} */
const glimmerMaterials = new Set();
let glimmerTime = 0;

function sheenBounds(mesh) {
  let min = mesh.boundMin;
  let max = mesh.boundMax;
  const pos = !min || !max ? mesh._cpuPositions : null;
  if (pos?.length >= 3) {
    min = [pos[0], pos[1], pos[2]];
    max = [pos[0], pos[1], pos[2]];
    for (let i = 3; i < pos.length; i += 3) {
      if (pos[i] < min[0]) min[0] = pos[i];
      if (pos[i + 1] < min[1]) min[1] = pos[i + 1];
      if (pos[i + 2] < min[2]) min[2] = pos[i + 2];
      if (pos[i] > max[0]) max[0] = pos[i];
      if (pos[i + 1] > max[1]) max[1] = pos[i + 1];
      if (pos[i + 2] > max[2]) max[2] = pos[i + 2];
    }
  }
  if (!min || !max) return { min: [0, 0, 0], size: [1, 1, 1] };
  return {
    min: [min[0], min[1], min[2]],
    size: [
      Math.max(max[0] - min[0], 1e-3),
      Math.max(max[1] - min[1], 1e-3),
      Math.max(max[2] - min[2], 1e-3),
    ],
  };
}

function createTeamGlimmerPlugin(bounds) {
  const min = bounds.min;
  const size = bounds.size;
  return {
    name: 'team-glimmer',
    getUniforms: () => ({
      ubo: [
        { name: 'glimmerT', type: 'f32' },
        { name: 'gMin', type: 'vec3<f32>' },
        { name: 'gSize', type: 'vec3<f32>' },
      ],
    }),
    getVaryings: () => [
      { name: 'gLocal', type: 'vec3<f32>' },
      { name: 'gOrigin', type: 'vec2<f32>' },
    ],
    getCustomCode(shaderType) {
      if (shaderType === 'vertex') return { CUSTOM_VERTEX_MAIN_END: GLIMMER_VERT };
      if (shaderType === 'fragment') return { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: GLIMMER };
      return null;
    },
    writeUbo(data, offsets) {
      const t = offsets.get('glimmerT');
      if (t != null) data[t / 4] = glimmerTime;
      const m = offsets.get('gMin');
      if (m != null) {
        const o = m / 4;
        data[o] = min[0];
        data[o + 1] = min[1];
        data[o + 2] = min[2];
      }
      const s = offsets.get('gSize');
      if (s != null) {
        const o = s / 4;
        data[o] = size[0];
        data[o + 1] = size[1];
        data[o + 2] = size[2];
      }
    },
  };
}

/** Once per frame. No-op until a TeamColor material exists. */
export function tickTeamColorGlimmer() {
  if (!glimmerMaterials.size) return;
  glimmerTime = performance.now() / 1000;
  for (const mat of glimmerMaterials) markMaterialUboDirty(mat);
}

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
    plugins: [createTeamGlimmerPlugin(sheenBounds(mesh))],
  };
  glimmerMaterials.add(mesh.material);
  const u = TEAM_COLOR_UNLIT;
  setPbrUnlit(mesh.material, [u, u, u]);
  return true;
}
