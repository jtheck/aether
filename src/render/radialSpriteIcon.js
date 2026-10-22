// Portrait card for a radial pad. Faces the camera so the baked picture
// stays readable on the tilted ring. Falls back to the live mesh when the
// PNG is missing.

import {
  addToScene,
  createMeshFromData,
  loadTexture2D,
  setShaderTexture,
  setSubtreeVisible,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { bakedSpriteUrl } from './bakedAssets.js';
import { createRadialSpriteMaterial } from './radialIconMaterial.js';
import { RADIAL_ICON_RENDER_ORDER, radialIconBounds } from './radialPose.js';

const SPRITE_QUAD = (() => {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  // Local +X is screen-left once the camera basis is applied.
  const uvs = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
})();

/** Card edge relative to the pad radius. 3.5 is about twice the first fill. */
const SPRITE_FILL = 3.5;

/**
 * Edge length for a portrait card. The quad is one unit across.
 * @param {{ hx?: number, hy?: number, hz?: number } | null | undefined} bounds
 * @param {number} padOuter
 */
export function radialSpriteFit(bounds, padOuter) {
  const span = Math.max((bounds?.hx ?? 0) * 2, bounds?.hy ?? 0, (bounds?.hz ?? 0) * 2, 1e-6);
  return (padOuter * SPRITE_FILL) / span;
}

/** Top of the caption, just under the card, in HUD-scale-1 units. */
export function radialSpriteCaptionDown(bounds, padOuter) {
  return radialSpriteFit(bounds, padOuter) * 0.5 + 0.35;
}

/** Pad-center reach used to keep the caption on screen. */
export function radialSpriteCaptionReach(padOuter) {
  return padOuter * SPRITE_FILL * 0.5 + 2.2;
}

/**
 * Screen basis for a portrait quad. Local +X is screen-left, +Y screen-up,
 * +Z toward the camera.
 * @param {object | null | undefined} camera
 */
export function radialSpritePoseAxes(camera) {
  const w = camera?.worldMatrix;
  if (!w || w.length < 11) return null;
  const rlen = Math.hypot(w[0], w[1], w[2]);
  const ulen = Math.hypot(w[4], w[5], w[6]);
  const llen = Math.hypot(w[8], w[9], w[10]);
  if (rlen < 1e-4 || ulen < 1e-4 || llen < 1e-4) return null;
  return {
    rx: -w[0] / rlen,
    ry: -w[1] / rlen,
    rz: -w[2] / rlen,
    ux: w[4] / ulen,
    uy: w[5] / ulen,
    uz: w[6] / ulen,
    fx: -w[8] / llen,
    fy: -w[9] / llen,
    fz: -w[10] / llen,
  };
}

/**
 * One thin-instanced portrait, or null when the PNG is missing.
 * @param {object} engine
 * @param {object} scene
 * @param {string} name
 * @param {string | null | undefined} glbUrl
 */
export async function loadRadialSpriteIcon(engine, scene, name, glbUrl) {
  if (!glbUrl) return null;
  let tex = null;
  try {
    tex = await loadTexture2D(engine, bakedSpriteUrl(glbUrl), {
      mipMaps: true,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
      srgb: false,
    });
  } catch {
    return null;
  }
  const { positions, normals, uvs, indices } = SPRITE_QUAD;
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = RADIAL_ICON_RENDER_ORDER;
  const mat = createRadialSpriteMaterial();
  setShaderTexture(mat, 'sprite', tex);
  mesh.material = mat;
  const matrices = new Float32Array(16);
  setThinInstances(mesh, matrices, 1);
  const ti = mesh.thinInstances;
  if (ti) {
    ti.count = 0;
    ti._version = (ti._version ?? 0) + 1;
    ti._dirtyMin = 0;
    ti._dirtyMax = 0;
  }
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);
  const bounds = radialIconBounds([mesh]);
  return {
    sprite: true,
    layers: [{
      mesh,
      matrices,
      baseEmissive: [0.82, 0.82, 0.82],
      baseDiffuse: [1, 1, 1],
      visible: false,
    }],
    // Center the card on the pad. The mesh foot-anchor assumes world up.
    ...bounds,
    cx: 0,
    cy: 0,
    cz: 0,
  };
}
