// Preview looks on the near tree mesh. Billboard cards are unchanged.
// Snow uses the same soft noise as the char stands' ash, biased up so it
// piles on the crown and outer fringe. No hard edge, so it does not speckle.
// Char stands keep the green, with ash in the body and blackened spots
// around the embers.
// A real option can drive setTreeSnow later; 0 restores the plain canopy.
//
// The foliage is a double-sided shell, so a normal mix greys every face.
// Patches come from the mesh shape (baked trees.glb: y 0.33–4.92,
// centroid xz, r max 3.94).

import { markMaterialUboDirty } from '../vendor/lite/liteVendor.js';

const SNOW_VERT = `
out.snowP = position;
out.treeXZ = finalWorld[3].xz;
`;

const SNOW_FNS = `
fn tHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn tNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(tHash(i), tHash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(tHash(i + vec2<f32>(0.0, 1.0)), tHash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}
fn tNoise3(p: vec3<f32>) -> f32 {
  return tNoise(p.xy) * 0.55 + tNoise(p.yz + vec2<f32>(19.2, 7.1)) * 0.45;
}
`;

const SNOW = `
let snowH = saturate((input.snowP.y - 0.33) / 4.59);
let snowR = saturate(length(input.snowP.xz - vec2<f32>(-0.35, -0.15)) / 3.94);
let coarse = tNoise3(input.snowP * 1.7);
let fine = tNoise3(input.snowP * 3.6 + vec3<f32>(5.2, 1.4, 2.8));
let charTree = tHash(floor(input.treeXZ / 28.0)) > 0.5;
let shade = clamp(
  max(input.vInstanceColor.r, max(input.vInstanceColor.g, input.vInstanceColor.b)) / 0.12,
  0.15,
  1.5
);
let soot = smoothstep(0.38, 0.78, coarse) * (1.0 - smoothstep(0.55, 0.92, snowH * 0.65 + snowR * 0.35));
if (charTree && material.snowAmt > 0.0) {
  let hot = fine * smoothstep(0.12, 0.38, snowH);
  let scorch = smoothstep(0.56, 0.72, hot);
  let ember = smoothstep(0.76, 0.9, hot);
  let emberPhase = tHash(floor(input.snowP.xz * 2.2)) * 6.28318;
  let flare = pow(saturate(sin(material.emberT * 0.28 + emberPhase)), 8.0);
  let gray = dot(baseColor, vec3<f32>(0.3, 0.59, 0.11));
  let ashy = mix(baseColor, vec3<f32>(gray * 1.15, gray, gray * 0.92) * 1.4, 0.82);
  baseColor = mix(baseColor, ashy, soot);
  baseColor = mix(baseColor, vec3<f32>(0.012, 0.009, 0.008), scorch);
  baseColor = mix(baseColor, mix(vec3<f32>(0.015, 0.006, 0.004), vec3<f32>(0.12, 0.025, 0.006), flare), ember);
  emissive = vec3<f32>(1.35, 0.055, 0.008) * ember * (0.04 + flare) * shade * material.snowAmt;
} else {
  let pile = snowH * 0.65 + snowR * 0.35;
  let drift = smoothstep(0.52, 0.64, coarse + (pile - 0.4) * 1.4);
  let snowy = mix(baseColor, vec3<f32>(0.72, 0.76, 0.82), 0.92);
  baseColor = mix(baseColor, snowy, drift * material.snowAmt);
}
`;

/** @type {Set<object>} */
const snowMaterials = new Set();
let snowAmount = 1;
let emberTime = 0;

const plugin = {
  name: 'tree-snow',
  getUniforms: () => ({
    ubo: [
      { name: 'snowAmt', type: 'f32' },
      { name: 'emberT', type: 'f32' },
    ],
  }),
  getVaryings: () => [
    { name: 'snowP', type: 'vec3<f32>' },
    { name: 'treeXZ', type: 'vec2<f32>' },
  ],
  getCustomCode(shaderType) {
    if (shaderType === 'vertex') return { CUSTOM_VERTEX_MAIN_END: SNOW_VERT };
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: SNOW_FNS,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: SNOW,
      };
    }
    return null;
  },
  writeUbo(data, offsets) {
    const o = offsets.get('snowAmt');
    if (o != null) data[o / 4] = snowAmount;
    const t = offsets.get('emberT');
    if (t != null) data[t / 4] = emberTime;
  },
};

/** Render clock only. Each ember stays dark, then flares for a short beat. */
export function tickTreeSnow() {
  if (!snowMaterials.size) return;
  emberTime = performance.now() / 1000;
  for (const mat of snowMaterials) markMaterialUboDirty(mat);
}

/** 1 = snow and char previews. 0 = current green. Takes effect next draw. */
export function setTreeSnow(amount) {
  snowAmount = Math.min(1, Math.max(0, Number(amount) || 0));
  for (const mat of snowMaterials) markMaterialUboDirty(mat);
}

/**
 * Tree model. Call before the first draw, same point as the wind plugin.
 * @param {object[]} meshes
 */
export function attachTreeSnow(meshes) {
  for (const mesh of meshes) {
    const mat = mesh.material;
    if (!mat) continue;
    const list = mat.plugins ?? (mat.plugins = []);
    if (!list.some((p) => p === plugin || p.name === plugin.name)) list.push(plugin);
    snowMaterials.add(mat);
  }
}
