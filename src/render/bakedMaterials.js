// Reconstruct Lite PBR materials from offline bake metadata (no GLB parse).
// Match glTF loader packing: factor-only metallic/roughness live in the ORM
// 1×1; UBO metallicFactor/roughnessFactor stay at default 1 (do not set both).

import {
  createPbrMaterial,
  createTexture2DFromPixels,
  loadTexture2D,
  setPbrAlphaCutoff,
  setPbrEmissive,
} from '../vendor/lite/liteVendor.js';
import { bakedMeshStem } from './bakedAssets.js';

const WHITE_PIXELS = new Uint8Array([255, 255, 255, 255]);

/** @type {WeakMap<object, object>} */
const whiteByEngine = new WeakMap();

function whiteTex(engine) {
  let t = whiteByEngine.get(engine);
  if (!t) {
    t = createTexture2DFromPixels(engine, WHITE_PIXELS, 1, 1, {
      minFilter: 'linear',
      magFilter: 'linear',
    });
    whiteByEngine.set(engine, t);
  }
  return t;
}

/** glTF ORM packing: R=occlusion, G=roughness, B=metallic. */
function ormFactorTex(engine, roughness, metallic) {
  const clamp = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return createTexture2DFromPixels(
    engine,
    new Uint8Array([255, clamp(roughness), clamp(metallic), 255]),
    1,
    1,
    { minFilter: 'linear', magFilter: 'linear' },
  );
}

/**
 * @param {object} engine
 * @param {string} glbUrl
 * @param {object} matDesc
 * @param {{ file: string, mimeType?: string }[] | null} images
 */
export async function materialFromBakeDesc(engine, glbUrl, matDesc, images) {
  const stem = bakedMeshStem(glbUrl);
  const srgbOpts = {
    srgb: true,
    mipMaps: true,
    invertY: false,
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    minFilter: 'linear',
    magFilter: 'linear',
  };
  const linearOpts = { ...srgbOpts, srgb: false };

  async function loadImg(idx, opts) {
    if (idx == null || idx < 0) return null;
    const meta = images?.[idx];
    if (!meta?.file) return null;
    return loadTexture2D(engine, `/assets/baked/meshes/${stem}/${meta.file}`, opts);
  }

  const factor = matDesc.baseColorFactor ?? [1, 1, 1, 1];
  const metallic = matDesc.metallicFactor ?? 1;
  const roughness = matDesc.roughnessFactor ?? 1;
  const alphaMode = matDesc.alphaMode ?? 'OPAQUE';
  const hasOrmImage = matDesc.ormImage != null;

  const baseColorTexture = (await loadImg(matDesc.baseColorImage, srgbOpts)) || whiteTex(engine);
  const ormTexture = (await loadImg(matDesc.ormImage, linearOpts))
    || ormFactorTex(engine, roughness, metallic);
  const normalTexture = (await loadImg(matDesc.normalImage, linearOpts)) || undefined;
  const emissiveTexture = (await loadImg(matDesc.emissiveImage, srgbOpts)) || undefined;
  const ef = matDesc.emissiveFactor ?? [0, 0, 0];

  // Must use createPbrMaterial so `_buildGroup` is set — plain objects never draw.
  // When ORM is a factor 1×1 (no MR image), omit metallic/roughness factors —
  // shader does orm.channel * factor, and UBO defaults factor to 1.
  const mat = createPbrMaterial({
    name: matDesc.name || '',
    baseColorTexture,
    ormTexture,
    normalTexture,
    emissiveTexture,
    // Keep factor for TeamColor / scenery tweaks (white tex × factor).
    baseColorFactor: factor.slice(),
    ...(hasOrmImage ? { metallicFactor: metallic, roughnessFactor: roughness } : {}),
    doubleSided: !!matDesc.doubleSided,
    occlusionStrength: hasOrmImage ? 1 : 0,
    enableSpecularAA: true,
    alpha: alphaMode === 'BLEND' ? (factor[3] ?? 1) : 1,
    ...(alphaMode === 'BLEND' ? { alphaBlend: true } : {}),
  });
  // Lite 1.20+: emissive color / alpha-test are opt-in extensions.
  if (emissiveTexture || ef[0] || ef[1] || ef[2]) setPbrEmissive(mat, ef.slice());
  if (alphaMode === 'MASK') setPbrAlphaCutoff(mat, matDesc.alphaCutoff ?? 0.5);
  return mat;
}

/**
 * @param {object} engine
 * @param {string} glbUrl
 * @param {object} meta bake JSON (version >= 2 with materials[])
 */
export async function materialsFromBakeMeta(engine, glbUrl, meta) {
  const images = meta.images ?? [];
  const mats = meta.materials ?? [];
  return Promise.all(mats.map((m) => materialFromBakeDesc(engine, glbUrl, m, images)));
}
