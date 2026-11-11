// Terrain layering and atlas compositing. Pure functions; terrain.js owns the GPU side.
//
// Grass draws over dirt, dirt over water. Each tile shows the blobs of higher
// terrain touching its corners. Single-pair tiles use a sheet cell as-is. A
// water tile touched by both grass and dirt (a junction) gets a composite cell
// built from the three sheets, which share one painting and blob layout.
// Gravel draws over dirt on atlas-gravel-dirt. Tile and decorative count as
// gravel there. Scorched draws over dirt on atlas-scorched-dirt, and charred
// and lava count as scorched. A dirt tile touched by grass and one of those
// blobs composites; scorched sits over gravel when both meet. Decorative draws
// over tile, charred over scorched, lava over charred. These sets meet grass
// and water on a hard edge. See TERRAIN_BLEND_SETS.

import {
  ATLAS,
  TERRAIN,
  blendCoverCornerCell,
  blendSetLayer,
  packLayer,
  terrainCornerCell,
} from '../sim/field.js';

export const ATLAS_GRID = 4;
export const CELL_FULL = 6;
export const CELL_EMPTY = 12;
/** Water composite pages. Cell is the junction key, see `junctionKey`. */
export const SHEET_JUNCTION = 3;
/** Dirt composite pages: gravel blob under a grass blob. Same key packing. */
export const SHEET_DIRT_JUNCTION = 6;
/** Dirt composite pages that include a scorched blob. Key is `burnJunctionKey`. */
export const SHEET_BURN_JUNCTION = 11;

/**
 * Per-ground look. Spec RGB is painted into a world-space map (UV2) so pond
 * and grass/dirt edges fade; the atlas on UV1 stays sharp.
 */
export const TERRAIN_LOOK = {
  [TERRAIN.DIRT]: {
    diffuseColor: [1.42, 1.14, 0.86],
    ambientColor: [0.28, 0.20, 0.14],
    specularColor: [0.008, 0.006, 0.004],
  },
  [TERRAIN.GRASS]: {
    diffuseColor: [1.12, 1.38, 1.08],
    ambientColor: [0.16, 0.24, 0.14],
    // Soft sheen only - shore atlas cells already look tiled; spec must not flash
    // them. Short of the sun-mirror value.
    specularColor: [0.027, 0.039, 0.018],
  },
  [TERRAIN.WATER]: {
    diffuseColor: [1.02, 1.16, 1.36],
    ambientColor: [0.26, 0.32, 0.36],
    // Glint is the additive welded sheet - tile spec makes pond squares.
    specularColor: [0, 0, 0],
  },
};

/** Kept small. Emissive is unshadowed, so it fills cast shadows on the grass. */
export const TERRAIN_EMISSIVE = [0.016, 0.018, 0.012];
/**
 * One neutral fill for every pave sheet. Tile and gravel (and a later third)
 * keep their contrast in the atlas art, so the blend does not step in the light.
 */
export const PAVE_DIFFUSE = [1.06, 1.06, 1.06];
const PAVE_AMBIENT = 0.16;

/** RGBA byte of the flat pave emissive texel (already divided by diffuse level). */
export function paveLookBytes() {
  const out = new Uint8Array(4);
  for (let c = 0; c < 3; c++) {
    const v = (TERRAIN_EMISSIVE[c] + PAVE_AMBIENT) / TERRAIN_DIFFUSE_LEVEL;
    out[c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  out[3] = 255;
  return out;
}
export const TERRAIN_DIFFUSE_LEVEL = 0.963;
/** Default hemi intensity. Shade under it matches the old per-ground tints. */
const SHADE_LIGHT = 0.34;

/**
 * One diffuse colour for every ground so lit terrain never steps at a tile
 * border. Per-ground tint moves into an emissive map: in sun the sum clamps
 * exactly as before, in shade it matches the old per-ground colour.
 */
export function terrainLookColors() {
  const kinds = [TERRAIN.GRASS, TERRAIN.DIRT, TERRAIN.WATER];
  const diffuse = [0, 1, 2].map((c) => Math.min(...kinds.map((t) => TERRAIN_LOOK[t].diffuseColor[c])));
  const emissive = {};
  for (const t of kinds) {
    const look = TERRAIN_LOOK[t];
    emissive[t] = [0, 1, 2].map((c) => (
      TERRAIN_EMISSIVE[c] + look.ambientColor[c] + SHADE_LIGHT * (look.diffuseColor[c] - diffuse[c])
    ));
  }
  // Gravel tiles use the pave material. On a dirt sheet the shared diffuse is
  // lower, so this makes the gravel blob match pave under the shade light.
  emissive[TERRAIN.GRAVEL] = [0, 1, 2].map((c) => (
    TERRAIN_EMISSIVE[c] + PAVE_AMBIENT + SHADE_LIGHT * (PAVE_DIFFUSE[c] - diffuse[c])
  ));
  return { diffuse, emissive };
}

/** High nibble is the under-blob (dirt on water, gravel on dirt). Low nibble is grass. */
export function junctionKey(underCell, grassCell) {
  return (underCell << 4) | grassCell;
}

/** Gravel, scorched, then grass, four bits each. An empty cell means that blob is absent. */
export function burnJunctionKey(gravelCell, scorchCell, grassCell) {
  return (gravelCell << 8) | (scorchCell << 4) | grassCell;
}

/**
 * Sheet and cell for tile (x, z), packed as `sheet << LAYER_SHIFT | cell`.
 * Water junctions return SHEET_JUNCTION. Dirt tiles touched by grass and
 * gravel return SHEET_DIRT_JUNCTION. A scorched blob on that tile returns
 * SHEET_BURN_JUNCTION.
 */
export function tileLayer(types, width, height, x, z) {
  const side = blendSetLayer(types, width, height, x, z);
  if (side != null) return side;
  const self = types[z * width + x];
  if (self === TERRAIN.WATER) {
    const grass = terrainCornerCell(types, width, height, x, z, TERRAIN.GRASS);
    if (grass === CELL_FULL) return packLayer(ATLAS.GRASS_DIRT, CELL_FULL);
    const dirt = terrainCornerCell(types, width, height, x, z, TERRAIN.DIRT);
    if (dirt === CELL_EMPTY) return packLayer(ATLAS.GRASS_WATER, grass);
    if (grass === CELL_EMPTY) return packLayer(ATLAS.DIRT_WATER, dirt);
    // Dirt under the whole tile: grass over dirt is the grass–dirt cell.
    if (dirt === CELL_FULL) return packLayer(ATLAS.GRASS_DIRT, grass);
    return packLayer(SHEET_JUNCTION, junctionKey(dirt, grass));
  }
  if (self === TERRAIN.DIRT) return dirtLayer(types, width, height, x, z);
  return packLayer(ATLAS.GRASS_DIRT, CELL_FULL);
}

/** Dirt shows grass, then scorched, then gravel. A full cover hides the blobs under it. */
function dirtLayer(types, width, height, x, z) {
  const grass = terrainCornerCell(types, width, height, x, z, TERRAIN.GRASS);
  const gravel = blendCoverCornerCell(types, width, height, x, z, TERRAIN.GRAVEL);
  const scorch = blendCoverCornerCell(types, width, height, x, z, TERRAIN.SCORCHED);
  if (grass === CELL_FULL) return packLayer(ATLAS.GRASS_DIRT, CELL_FULL);
  if (scorch === CELL_FULL) return packLayer(ATLAS.SCORCHED_DIRT, CELL_FULL);
  if (gravel === CELL_FULL) return packLayer(ATLAS.GRAVEL_DIRT, CELL_FULL);
  if (scorch === CELL_EMPTY && gravel === CELL_EMPTY) return packLayer(ATLAS.GRASS_DIRT, grass);
  if (scorch === CELL_EMPTY && grass === CELL_EMPTY) return packLayer(ATLAS.GRAVEL_DIRT, gravel);
  if (scorch === CELL_EMPTY) return packLayer(SHEET_DIRT_JUNCTION, junctionKey(gravel, grass));
  if (gravel === CELL_EMPTY && grass === CELL_EMPTY) return packLayer(ATLAS.SCORCHED_DIRT, scorch);
  return packLayer(SHEET_BURN_JUNCTION, burnJunctionKey(
    gravel === CELL_EMPTY ? CELL_EMPTY : gravel,
    scorch,
    grass === CELL_EMPTY ? CELL_EMPTY : grass,
  ));
}

/** Separable box blur that never crosses an atlas cell border. */
function blurWithinCells(src, size, radius) {
  const cs = size / ATLAS_GRID;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const c0 = x - (x % cs);
      const lo = Math.max(c0, x - radius);
      const hi = Math.min(c0 + cs - 1, x + radius);
      let s = 0;
      for (let k = lo; k <= hi; k++) s += src[row + k];
      tmp[row + x] = s / (hi - lo + 1);
    }
  }
  for (let y = 0; y < size; y++) {
    const r0 = y - (y % cs);
    const lo = Math.max(r0, y - radius);
    const hi = Math.min(r0 + cs - 1, y + radius);
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = lo; k <= hi; k++) s += tmp[k * size + x];
      out[y * size + x] = s / (hi - lo + 1);
    }
  }
  return out;
}

function rgbDistance(a, b, o) {
  const dr = a[o] - b[o];
  const dg = a[o + 1] - b[o + 1];
  const db = a[o + 2] - b[o + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Blob coverage 0–1 per pixel, shared by all three sheets (grass on the grass
 * sheets, dirt on dirt–water). Where the blob is, grass–water differs from
 * dirt–water; outside it, grass–water (water) differs from grass–dirt (dirt).
 * @param {{ gd: Uint8Array, gw: Uint8Array, dw: Uint8Array }} sheets RGBA, size² each
 */
export function blobMask(sheets, size) {
  const { gd, gw, dw } = sheets;
  const n = size * size;
  const outside = new Float32Array(n);
  const inside = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    outside[i] = Math.max(0, rgbDistance(gw, gd, o) - 4);
    inside[i] = Math.max(0, rgbDistance(dw, gw, o) - 3);
  }
  const radius = Math.max(1, Math.round((2 * size) / 2048));
  const a = blurWithinCells(outside, size, radius);
  const b = blurWithinCells(inside, size, radius);
  // Water–dirt is ~3.5× further apart than dirt–grass in the art; equalise.
  const k = 3.54;
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, ((k * b[i]) / (a[i] + k * b[i] + 1e-3) - 0.06) / 0.88));
    mask[i] = t * t * (3 - 2 * t);
  }
  return mask;
}

/** Pixel offset of an atlas cell's top-left corner (image row 0 = top). */
function cellOrigin(cell, cellPx) {
  return [(cell % ATLAS_GRID) * cellPx, ((cell / ATLAS_GRID) | 0) * cellPx];
}

/**
 * Junction cell: grass blob from grass–water/grass–dirt over the dirt blob
 * from dirt–water. Writes RGBA into `out` (cellPx² × 4) and the three ground
 * weights into `weights` (cellPx² × 3: grass, dirt, water) when given.
 */
export function compositeJunction(sheets, mask, size, key, out, weights = null) {
  const { gd, gw, dw } = sheets;
  const cellPx = size / ATLAS_GRID;
  const dirt = key >> 4;
  const grass = key & 15;
  const [gx, gy] = cellOrigin(grass, cellPx);
  const [dx, dy] = cellOrigin(dirt, cellPx);
  for (let y = 0; y < cellPx; y++) {
    for (let x = 0; x < cellPx; x++) {
      const gi = (gy + y) * size + gx + x;
      const di = (dy + y) * size + dx + x;
      const m = mask[gi];
      const md = mask[di];
      const go = gi * 4;
      const dO = di * 4;
      const o = (y * cellPx + x) * 4;
      for (let c = 0; c < 3; c++) {
        // Dirt blob as a delta on the water under it; grass covers both.
        const v = (1 - m) * (gw[go + c] + dw[dO + c] - dw[go + c]) + m * gd[go + c];
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      out[o + 3] = 255;
      if (weights) {
        const w = (y * cellPx + x) * 3;
        weights[w] = m;
        weights[w + 1] = (1 - m) * md;
        weights[w + 2] = (1 - m) * (1 - md);
      }
    }
  }
}

/**
 * Dirt tile touched by grass and gravel. Grass blob from grass–dirt over the
 * gravel blob from gravel–dirt; both sheets are already dirt outside the blob.
 * Writes RGBA into `out` and weights (grass, dirt, gravel) when given.
 */
export function compositeDirtJunction(sheets, mask, size, key, out, weights = null) {
  const { gd, gv } = sheets;
  const cellPx = size / ATLAS_GRID;
  const gravel = key >> 4;
  const grass = key & 15;
  const [gx, gy] = cellOrigin(grass, cellPx);
  const [vx, vy] = cellOrigin(gravel, cellPx);
  for (let y = 0; y < cellPx; y++) {
    for (let x = 0; x < cellPx; x++) {
      const gi = (gy + y) * size + gx + x;
      const vi = (vy + y) * size + vx + x;
      const mg = mask[gi];
      const mv = mask[vi];
      const keep = 1 - mg;
      const go = gi * 4;
      const vO = vi * 4;
      const o = (y * cellPx + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = mg * gd[go + c] + keep * gv[vO + c];
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      out[o + 3] = 255;
      if (weights) {
        const w = (y * cellPx + x) * 3;
        weights[w] = mg;
        weights[w + 1] = keep * (1 - mv);
        weights[w + 2] = keep * mv;
      }
    }
  }
}

/**
 * Dirt tile with a scorched blob, and maybe grass and gravel under it.
 * Grass wins, then scorched, then gravel. An empty cell contributes no blob.
 * Weights are grass, dirt, pave (scorched and gravel share the pave light).
 */
export function compositeBurnJunction(sheets, mask, size, key, out, weights = null) {
  const { gd, gv, sd } = sheets;
  const cellPx = size / ATLAS_GRID;
  const gravel = (key >> 8) & 15;
  const scorch = (key >> 4) & 15;
  const grass = key & 15;
  const [gx, gy] = cellOrigin(grass, cellPx);
  const [sx, sy] = cellOrigin(scorch, cellPx);
  const [vx, vy] = cellOrigin(gravel, cellPx);
  for (let y = 0; y < cellPx; y++) {
    for (let x = 0; x < cellPx; x++) {
      const gi = (gy + y) * size + gx + x;
      const si = (sy + y) * size + sx + x;
      const vi = (vy + y) * size + vx + x;
      const mg = mask[gi];
      const ms = mask[si];
      const mr = mask[vi];
      const keep = 1 - mg;
      const under = 1 - ms;
      const go = gi * 4;
      const sO = si * 4;
      const vO = vi * 4;
      const o = (y * cellPx + x) * 4;
      for (let c = 0; c < 3; c++) {
        const below = ms * sd[sO + c] + under * gv[vO + c];
        const v = mg * gd[go + c] + keep * below;
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      out[o + 3] = 255;
      if (weights) {
        const w = (y * cellPx + x) * 3;
        weights[w] = mg;
        weights[w + 1] = keep * under * (1 - mr);
        weights[w + 2] = keep * (1 - under * (1 - mr));
      }
    }
  }
}

/** Ground weights (grass, dirt, water, gravel) of a sheet pixel with blob coverage `m`. */
export function sheetWeights(sheet, m, into) {
  if (sheet === ATLAS.GRASS_WATER) {
    into[0] = m; into[1] = 0; into[2] = 1 - m; into[3] = 0;
  } else if (sheet === ATLAS.DIRT_WATER) {
    into[0] = 0; into[1] = m; into[2] = 1 - m; into[3] = 0;
  } else if (sheet === ATLAS.GRAVEL_DIRT || sheet === ATLAS.SCORCHED_DIRT) {
    into[0] = 0; into[1] = 1 - m; into[2] = 0; into[3] = m;
  } else {
    into[0] = m; into[1] = 1 - m; into[2] = 0; into[3] = 0;
  }
  return into;
}

/**
 * Emissive texel (RGBA bytes) for ground weights. The std shader multiplies
 * emissive maps by the texture level, so divide it back out.
 */
export function lookTexel(emissive, wg, wd, ww, out, o, wp = 0) {
  const g = emissive[TERRAIN.GRASS];
  const d = emissive[TERRAIN.DIRT];
  const w = emissive[TERRAIN.WATER];
  const p = emissive[TERRAIN.GRAVEL];
  for (let c = 0; c < 3; c++) {
    const v = (wg * g[c] + wd * d[c] + ww * w[c] + wp * p[c]) / TERRAIN_DIFFUSE_LEVEL;
    out[o + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  out[o + 3] = 255;
}

/**
 * Downsampled emissive map for one sheet (size / scale)².
 * @param {Float32Array} mask blob coverage, size²
 */
export function sheetLookMap(sheet, mask, size, scale, emissive) {
  const lw = size / scale;
  const out = new Uint8Array(lw * lw * 4);
  const wts = [0, 0, 0, 0];
  const inv = 1 / (scale * scale);
  for (let y = 0; y < lw; y++) {
    for (let x = 0; x < lw; x++) {
      let m = 0;
      for (let sy = 0; sy < scale; sy++) {
        const row = (y * scale + sy) * size + x * scale;
        for (let sx = 0; sx < scale; sx++) m += mask[row + sx];
      }
      sheetWeights(sheet, m * inv, wts);
      lookTexel(emissive, wts[0], wts[1], wts[2], out, (y * lw + x) * 4, wts[3]);
    }
  }
  return out;
}

/**
 * Downsampled emissive block (cellPx / scale)² from junction weights.
 * Weight 2 is water, or gravel when `gravelSlot` is set (dirt junctions).
 */
export function junctionLookBlock(weights, cellPx, scale, emissive, gravelSlot = false) {
  const lw = cellPx / scale;
  const out = new Uint8Array(lw * lw * 4);
  const inv = 1 / (scale * scale);
  for (let y = 0; y < lw; y++) {
    for (let x = 0; x < lw; x++) {
      let wg = 0;
      let wd = 0;
      let w3 = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const w = ((y * scale + sy) * cellPx + x * scale + sx) * 3;
          wg += weights[w];
          wd += weights[w + 1];
          w3 += weights[w + 2];
        }
      }
      const third = w3 * inv;
      lookTexel(
        emissive,
        wg * inv,
        wd * inv,
        gravelSlot ? 0 : third,
        out,
        (y * lw + x) * 4,
        gravelSlot ? third : 0,
      );
    }
  }
  return out;
}

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(l) {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * Box-filtered mip chain of a square sRGB RGBA image, averaged in linear
 * light like GPU mipgen on an -srgb texture. Level 0 is `pixels` itself.
 */
export function srgbMipChain(pixels, size) {
  const levels = [pixels];
  let src = pixels;
  let s = size;
  while (s > 1) {
    const h = s >> 1;
    const dst = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const o = (y * h + x) * 4;
        const a = ((2 * y) * s + 2 * x) * 4;
        const b = a + 4;
        const c = a + s * 4;
        const d = c + 4;
        for (let k = 0; k < 3; k++) {
          const l = SRGB_TO_LINEAR[src[a + k]] + SRGB_TO_LINEAR[src[b + k]]
            + SRGB_TO_LINEAR[src[c + k]] + SRGB_TO_LINEAR[src[d + k]];
          dst[o + k] = linearToSrgbByte(l * 0.25);
        }
        dst[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3] + 2) >> 2;
      }
    }
    levels.push(dst);
    src = dst;
    s = h;
  }
  return levels;
}
