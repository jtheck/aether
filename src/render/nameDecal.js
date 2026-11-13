// A name or logo laid on the terrain. Half-tile quads follow the board, and
// the picture side faces up. Nothing draws until place() is given stamps.
// Local +X is the viewer's right when yaw matches an agora (atan2(-x, -z)).
// U runs backwards across that axis so the word reads left to right.

import {
  addToScene,
  createMeshFromData,
  createStandardMaterial,
  invalidateRenderBundles,
  loadTexture2D,
  markMaterialUboDirty,
  setStandardOpacityTexture,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';
import { assetUrl } from './assetRev.js';
import { TILE_SIZE_F } from '../sim/field.js';
import { softDetachMesh } from './meshLifecycle.js';

/** Clear of the felt so the ink does not sink into the tiles. */
export const NAME_DECAL_LIFT = 0.2;
/** Half a terrain tile, the same surface the board is built from. */
export const NAME_DECAL_STEP = TILE_SIZE_F * 0.5;

function segments(span) {
  return Math.max(1, Math.ceil(span / NAME_DECAL_STEP - 1e-4));
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {{ url: string, width: number, height: number, capacity?: number }} opts
 */
export async function createNameDecal(engine, scene, groundYAt, opts) {
  const width = opts.width;
  const height = opts.height;
  const capacity = Math.max(1, opts.capacity ?? 8);
  const cols = segments(width);
  const rows = segments(height);
  const vertStride = cols + 1;
  const vertsPer = vertStride * (rows + 1);
  const idxPer = cols * rows * 6;
  const empty = { place() {}, clear() {}, dispose() {} };
  if (!(width > 0) || !(height > 0) || !opts.url) return empty;

  let tex;
  try {
    tex = await loadTexture2D(engine, assetUrl(opts.url), {
      srgb: true,
      invertY: false,
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });
  } catch (err) {
    console.warn('[nameDecal] texture failed', err);
    return empty;
  }

  const positions = new Float32Array(capacity * vertsPer * 3);
  const normals = new Float32Array(capacity * vertsPer * 3);
  const uvs = new Float32Array(capacity * vertsPer * 2);
  const indices = new Uint32Array(capacity * idxPer);
  for (let slot = 0; slot < capacity; slot++) {
    const base = slot * vertsPer;
    for (let iz = 0; iz <= rows; iz++) {
      const v = iz / rows;
      for (let ix = 0; ix <= cols; ix++) {
        const vi = base + iz * vertStride + ix;
        normals[vi * 3 + 1] = 1;
        uvs[vi * 2] = 1 - ix / cols;
        uvs[vi * 2 + 1] = v;
      }
    }
    let k = slot * idxPer;
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i00 = base + iz * vertStride + ix;
        const i10 = i00 + 1;
        const i01 = i00 + vertStride;
        const i11 = i01 + 1;
        indices[k++] = i00;
        indices[k++] = i10;
        indices[k++] = i11;
        indices[k++] = i00;
        indices[k++] = i11;
        indices[k++] = i01;
      }
    }
  }

  const mesh = createMeshFromData(engine, 'name-decal', positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  const mat = createStandardMaterial();
  mat.diffuseTexture = tex;
  setStandardOpacityTexture(mat, tex);
  mat.opacityFromRGB = false;
  mat.alphaCutOff = 0.08;
  mat.diffuseColor = [1, 1, 1];
  mat.ambientColor = [1, 1, 1];
  mat.emissiveColor = [1, 1, 1];
  mat.specularColor = [0, 0, 0];
  mat.backFaceCulling = true;
  mat.disableLighting = true;
  mesh.material = mat;
  markMaterialUboDirty(mat);
  mesh.visible = false;
  addToScene(scene, mesh);

  /**
   * @param {{ x: number, z: number, yaw?: number }[]} list
   * yaw 0 lays local +Z on world +Z. Agora yaw (atan2(-x, -z)) faces the word
   * back toward the map center.
   */
  function place(list) {
    const n = Math.min(capacity, list?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const stamp = list[i];
      const yaw = stamp.yaw || 0;
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      const base = i * vertsPer;
      for (let iz = 0; iz <= rows; iz++) {
        const lz = (iz / rows - 0.5) * height;
        for (let ix = 0; ix <= cols; ix++) {
          const lx = (ix / cols - 0.5) * width;
          const wx = stamp.x + c * lx + s * lz;
          const wz = stamp.z - s * lx + c * lz;
          const vi = (base + iz * vertStride + ix) * 3;
          positions[vi] = wx;
          positions[vi + 1] = groundYAt(wx, wz) + NAME_DECAL_LIFT;
          positions[vi + 2] = wz;
        }
      }
    }
    const verts = n * vertsPer;
    if (verts > 0) updateMeshPositions(engine, mesh, positions, 0, verts);
    mesh.boundMin = [-1e5, -1e5, -1e5];
    mesh.boundMax = [1e5, 1e5, 1e5];
    const idx = n * idxPer;
    if (mesh._gpu && mesh._gpu.indexCount !== idx) mesh._gpu.indexCount = idx;
    mesh.visible = n > 0;
    invalidateRenderBundles(engine);
  }

  return {
    place,
    clear() {
      place([]);
    },
    dispose() {
      mesh.visible = false;
      softDetachMesh(scene, mesh);
    },
  };
}
