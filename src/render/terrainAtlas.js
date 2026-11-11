// GPU side of terrain layering: atlas sheets, per-sheet emissive look maps,
// and composite pages for junction cells (see terrainLayers.js).

import {
  createStandardMaterial,
  createTexture2DFromPixels,
  getOrCreateSampler,
  loadTexture2D as loadLiteTexture2D,
  markMaterialUboDirty,
  setStandardEmissiveTexture,
  setStandardSpecularTexture,
} from '../vendor/lite/liteVendor.js';
import { ATLAS, isBlendAtlas, layerCell, layerSheet } from '../sim/field.js';
import { assetFetch, assetUrl } from './assetRev.js';
import {
  ATLAS_GRID,
  PAVE_DIFFUSE,
  SHEET_BURN_JUNCTION,
  SHEET_DIRT_JUNCTION,
  TERRAIN_DIFFUSE_LEVEL,
  blobMask,
  compositeBurnJunction,
  compositeDirtJunction,
  compositeJunction,
  junctionLookBlock,
  paveLookBytes,
  sheetLookMap,
  srgbMipChain,
  terrainLookColors,
} from './terrainLayers.js';

const NATURAL_ATLAS_URLS = {
  [ATLAS.GRASS_DIRT]: '/assets/textures/atlas-grass-dirt.png',
  [ATLAS.GRASS_WATER]: '/assets/textures/atlas-grass-water.png',
  [ATLAS.DIRT_WATER]: '/assets/textures/atlas-dirt-water.png',
};
/** Side sets. A third pave member adds its pair sheets here. */
const BLEND_ATLAS_URLS = {
  [ATLAS.TILE_GRAVEL]: '/assets/textures/atlas-tile-gravel.png',
  [ATLAS.DECORATIVE_TILE]: '/assets/textures/atlas-decorative-tile.png',
  [ATLAS.CHARRED_SCORCHED]: '/assets/textures/atlas-charred-scorched.png',
  [ATLAS.LAVA_CHARRED]: '/assets/textures/atlas-lava-charred.png',
};
/** Overlay blobs on dirt. Decoded with the natural sheets for shared-corner composites. */
const DIRT_OVERLAY_URLS = {
  [ATLAS.GRAVEL_DIRT]: '/assets/textures/atlas-gravel-dirt.png',
  [ATLAS.SCORCHED_DIRT]: '/assets/textures/atlas-scorched-dirt.png',
};
const ATLAS_URLS = { ...NATURAL_ATLAS_URLS, ...BLEND_ATLAS_URLS, ...DIRT_OVERLAY_URLS };
/** Emissive maps are smooth; a quarter of the atlas resolution is plenty. */
const LOOK_SCALE = 4;
const PAGE_SLOTS = ATLAS_GRID * ATLAS_GRID;
/** Mesh bucket id of composite page N. Sheet ids stay below this. */
export const PAGE_BUCKET_BASE = 32;
/** Full-res pixels stay this long after the last user, for back-to-back builds. */
const SOURCE_IDLE_MS = 15000;
const TERRAIN_SPECULAR_POWER = 10;

const LOOK = terrainLookColors();

/** @type {WeakMap<object, Promise<ReturnType<typeof createTerrainAtlas>>>} */
const atlasCache = new WeakMap();

/** Shared per engine. Composite slots persist across terrain rebuilds. */
export function loadTerrainAtlas(engine) {
  let p = atlasCache.get(engine);
  if (!p) {
    p = createTerrainAtlas(engine);
    atlasCache.set(engine, p);
    p.catch(() => atlasCache.delete(engine));
  }
  return p;
}

async function createTerrainAtlas(engine) {
  /** @type {Map<number, object>} */
  const sheets = new Map();
  /** @type {Map<number, object>} */
  const looks = new Map();
  /** @type {{ sheets: { gd: Uint8ClampedArray, gw: Uint8ClampedArray, dw: Uint8ClampedArray, gv: Uint8ClampedArray, sd: Uint8ClampedArray }, mask: Float32Array, size: number } | null} */
  let source = null;
  let sourcePromise = null;
  let sourceUsers = 0;
  let idleTimer = 0;
  const pages = [];
  /** @type {Map<number, { page: number, cell: number }>} */
  const slots = new Map();

  function loadSource() {
    if (source) return Promise.resolve(source);
    if (!sourcePromise) {
      sourcePromise = Promise.all([
        decodeSheet(NATURAL_ATLAS_URLS[ATLAS.GRASS_DIRT]),
        decodeSheet(NATURAL_ATLAS_URLS[ATLAS.GRASS_WATER]),
        decodeSheet(NATURAL_ATLAS_URLS[ATLAS.DIRT_WATER]),
        decodeSheet(DIRT_OVERLAY_URLS[ATLAS.GRAVEL_DIRT]),
        decodeSheet(DIRT_OVERLAY_URLS[ATLAS.SCORCHED_DIRT]),
      ]).then(([gd, gw, dw, gv, sd]) => {
        const size = gw.size;
        if (gd.size !== size || dw.size !== size || gv.size !== size || sd.size !== size) {
          throw new Error('terrain atlas sheets differ in size');
        }
        const px = { gd: gd.rgba, gw: gw.rgba, dw: dw.rgba, gv: gv.rgba, sd: sd.rgba };
        source = { sheets: px, mask: blobMask(px, size), size };
        return source;
      }).finally(() => {
        sourcePromise = null;
      });
    }
    return sourcePromise;
  }

  async function retainSource() {
    sourceUsers++;
    clearTimeout(idleTimer);
    try {
      return await loadSource();
    } catch (err) {
      releaseSource();
      throw err;
    }
  }

  function releaseSource() {
    sourceUsers = Math.max(0, sourceUsers - 1);
    if (sourceUsers > 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (sourceUsers === 0) source = null;
    }, SOURCE_IDLE_MS);
  }

  function lookTexture(pixels, size) {
    const tex = createTexture2DFromPixels(engine, pixels, size, size, {
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    tex.sampler = getOrCreateSampler(engine, {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      minFilter: 'linear',
      magFilter: 'linear',
    });
    return tex;
  }

  function createPage() {
    const device = engine?._device;
    const usage = globalThis.GPUTextureUsage;
    if (!device || !usage || !source) return null;
    const cellPx = source.size / ATLAS_GRID;
    const size = source.size;
    const mipLevelCount = Math.floor(Math.log2(size)) + 1;
    let texture;
    try {
      texture = device.createTexture({
        size: { width: size, height: size },
        format: 'rgba8unorm-srgb',
        mipLevelCount,
        usage: usage.TEXTURE_BINDING | usage.COPY_DST,
      });
    } catch (err) {
      console.warn('[terrain] composite page failed', err);
      return null;
    }
    const lookSize = size / LOOK_SCALE;
    const page = {
      diffuse: {
        texture,
        view: texture.createView(),
        sampler: atlasSampler(engine),
        width: size,
        height: size,
      },
      look: lookTexture(new Uint8Array(lookSize * lookSize * 4), lookSize),
      cellPx,
      mipLevelCount,
      used: 0,
      /** Each slot's 1×1 mip (RGBA), for the page's top mip levels. */
      tails: new Uint8Array(PAGE_SLOTS * 4),
    };
    pages.push(page);
    return page;
  }

  function writePageTail(device, page) {
    const slotLevels = Math.log2(page.cellPx) + 1;
    let src = page.tails;
    let n = ATLAS_GRID;
    for (let level = slotLevels; level < page.mipLevelCount; level++) {
      const h = n >> 1;
      const dst = new Uint8Array(h * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < h; x++) {
          for (let c = 0; c < 4; c++) {
            const a = ((2 * y) * n + 2 * x) * 4 + c;
            dst[(y * h + x) * 4 + c] = (src[a] + src[a + 4] + src[a + n * 4] + src[a + n * 4 + 4] + 2) >> 2;
          }
        }
      }
      device.queue.writeTexture(
        { texture: page.diffuse.texture, mipLevel: level },
        dst,
        { bytesPerRow: h * 4, rowsPerImage: h },
        { width: h, height: h, depthOrArrayLayers: 1 },
      );
      src = dst;
      n = h;
    }
  }

  /** Composite `key` into a free slot. Needs `source`. */
  function fillSlot(key) {
    const device = engine?._device;
    if (!device || !source) return null;
    let pageIndex = pages.findIndex((p) => p.used < PAGE_SLOTS);
    let page = pageIndex >= 0 ? pages[pageIndex] : null;
    if (!page) {
      page = createPage();
      if (!page) return null;
      pageIndex = pages.length - 1;
    }
    const cell = page.used++;
    const { cellPx } = page;
    const col = cell % ATLAS_GRID;
    const row = (cell / ATLAS_GRID) | 0;
    const rgba = new Uint8Array(cellPx * cellPx * 4);
    const weights = new Float32Array(cellPx * cellPx * 3);
    const cellKey = layerCell(key);
    const kind = layerSheet(key);
    const paveLook = kind === SHEET_DIRT_JUNCTION || kind === SHEET_BURN_JUNCTION;
    if (kind === SHEET_BURN_JUNCTION) compositeBurnJunction(source.sheets, source.mask, source.size, cellKey, rgba, weights);
    else if (kind === SHEET_DIRT_JUNCTION) compositeDirtJunction(source.sheets, source.mask, source.size, cellKey, rgba, weights);
    else compositeJunction(source.sheets, source.mask, source.size, cellKey, rgba, weights);
    const levels = srgbMipChain(rgba, cellPx);
    for (let level = 0; level < levels.length; level++) {
      const s = cellPx >> level;
      device.queue.writeTexture(
        { texture: page.diffuse.texture, mipLevel: level, origin: { x: col * s, y: row * s } },
        levels[level],
        { bytesPerRow: s * 4, rowsPerImage: s },
        { width: s, height: s, depthOrArrayLayers: 1 },
      );
    }
    page.tails.set(levels[levels.length - 1], cell * 4);
    writePageTail(device, page);
    const lookPx = cellPx / LOOK_SCALE;
    device.queue.writeTexture(
      { texture: page.look.texture, origin: { x: col * lookPx, y: row * lookPx } },
      junctionLookBlock(weights, cellPx, LOOK_SCALE, LOOK.emissive, paveLook),
      { bytesPerRow: lookPx * 4, rowsPerImage: lookPx },
      { width: lookPx, height: lookPx, depthOrArrayLayers: 1 },
    );
    const slot = { page: pageIndex, cell };
    slots.set(key, slot);
    return slot;
  }

  await Promise.all(
    Object.entries(ATLAS_URLS).map(async ([id, url]) => {
      sheets.set(Number(id), await loadAtlasTexture(engine, url));
    }),
  );
  const src = await retainSource();
  try {
    const lookSize = src.size / LOOK_SCALE;
    const paveLook = lookTexture(paveLookBytes(), 1);
    for (const id of sheets.keys()) {
      if (isBlendAtlas(id)) {
        looks.set(id, paveLook);
        continue;
      }
      looks.set(id, lookTexture(sheetLookMap(id, src.mask, src.size, LOOK_SCALE, LOOK.emissive), lookSize));
    }
  } finally {
    releaseSource();
  }

  return {
    retainSource,
    releaseSource,
    /** Slot for a junction key, compositing it now if the source is loaded. */
    junctionSlot(key) {
      return slots.get(key) ?? (source ? fillSlot(key) : null);
    },
    /** Composite every key in `keys` that has no slot yet. */
    async prepareJunctions(keys) {
      const missing = [...keys].filter((k) => !slots.has(k));
      if (!missing.length) return;
      await retainSource();
      try {
        for (const key of missing) if (!slots.has(key)) fillSlot(key);
      } finally {
        releaseSource();
      }
    },
    diffuseFor(bucket) {
      if (bucket >= PAGE_BUCKET_BASE) return pages[bucket - PAGE_BUCKET_BASE]?.diffuse ?? null;
      return sheets.get(bucket) ?? null;
    },
    lookFor(bucket) {
      if (bucket >= PAGE_BUCKET_BASE) return pages[bucket - PAGE_BUCKET_BASE]?.look ?? null;
      return looks.get(bucket) ?? null;
    },
  };
}

/** One material per sheet or composite page, sharing a diffuse colour. */
export function createTerrainMaterials(atlas, specTexture) {
  /** @type {Map<number, object>} */
  const materials = new Map();
  let spec = specTexture;

  const bare = new Set();

  function bindSpec(mat) {
    if (!spec || bare.has(mat)) return;
    mat.specularCoordIndex = 1;
    setStandardSpecularTexture(mat, spec);
    markMaterialUboDirty?.(mat);
  }

  function get(bucket) {
    let mat = materials.get(bucket);
    if (mat) return mat;
    const diffuse = atlas.diffuseFor(bucket);
    if (!diffuse && bucket !== ATLAS.GRASS_DIRT) return get(ATLAS.GRASS_DIRT);
    mat = createStandardMaterial();
    mat.diffuseColor = isBlendAtlas(bucket) ? PAVE_DIFFUSE : LOOK.diffuse;
    // Ground tint and ambient live in the emissive map.
    mat.ambientColor = [0, 0, 0];
    mat.emissiveColor = [0, 0, 0];
    mat.specularColor = [0, 0, 0];
    mat.specularPower = TERRAIN_SPECULAR_POWER;
    mat.specularCoordIndex = 1;
    mat.diffuseTexture = diffuse;
    // Sheets, composite pages, and look maps share this grid. See build-lite.mjs.
    mat.atlasGrid = ATLAS_GRID;
    // Atlas only. Rails and haul props leave this unset and stay at full grade.
    mat.diffuseLevel = TERRAIN_DIFFUSE_LEVEL;
    mat.backFaceCulling = true;
    const look = atlas.lookFor(bucket);
    if (look) setStandardEmissiveTexture(mat, look);
    // The glint mask paints a red mark on lava. This sheet would phong it.
    if (bucket === ATLAS.LAVA_CHARRED) bare.add(mat);
    else bindSpec(mat);
    materials.set(bucket, mat);
    return mat;
  }

  return {
    get,
    bindSpecMap(texture) {
      if (!texture) return;
      spec = texture;
      for (const mat of materials.values()) bindSpec(mat);
    },
  };
}

function atlasSampler(engine) {
  return getOrCreateSampler(engine, {
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
    mipmapFilter: 'linear',
    maxAnisotropy: 8,
  });
}

async function loadAtlasTexture(engine, url) {
  // Mipmaps remove minification shimmer; anisotropy keeps oblique terrain sharp.
  // UVs use image-space V, so preserve the PNG's top-to-bottom orientation.
  const texture = await loadLiteTexture2D(engine, assetUrl(url), {
    srgb: true,
    mipMaps: true,
    invertY: false,
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  texture.sampler = atlasSampler(engine);
  return texture;
}

async function decodeSheet(url) {
  const blob = await (await assetFetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const size = bitmap.width;
  const canvas = new OffscreenCanvas(size, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { size, rgba: ctx.getImageData(0, 0, size, size).data };
}
