import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TINY_MAP_W,
  TABLE_CHUNK_TILES,
  TERRAIN,
  ATLAS,
  clampForgeChunks,
  forgeTilesForChunks,
  worldToTile,
  worldToTileZ,
  findPath,
  tileCenterX,
  tileCenterY,
  buildField,
  applySeededHeight,
  composeHeightMap,
  createField,
  generateHeightMap,
  consumeWaterDirty,
  paintRegionLift,
  rebuildWaterSurface,
  refreshTerrainDerived,
  terrainCornerCell,
  tileHeightWorld,
} from './field.js';
import { encodeGarden, fieldFromGarden } from './garden.js';
import { applyTableSilhouette, createFullCellMask, createFullCellRadius, paintTerrainBrush, tableCenterVertex } from './tableShape.js';

function chunkCenterHeight(field, cx, cz) {
  const tx = cx * TABLE_CHUNK_TILES + (TABLE_CHUNK_TILES >> 1);
  const tz = cz * TABLE_CHUNK_TILES + (TABLE_CHUNK_TILES >> 1);
  return field.heightMap[tz * field.width + tx];
}

function fullSilhouette(field) {
  applyTableSilhouette(field, {
    cellSize: TABLE_CHUNK_TILES,
    cellMask: createFullCellMask(field.width, field.height, TABLE_CHUNK_TILES),
    cellRadius: createFullCellRadius(field.width, field.height, TABLE_CHUNK_TILES, 0),
  });
}

describe('chunk-scale relief', () => {
  it('varies height at chunk centers more than tiles inside one chunk', () => {
    const field = buildField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    const chunks = TINY_MAP_W / TABLE_CHUNK_TILES;
    const centers = [];
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) centers.push(chunkCenterHeight(field, cx, cz));
    }
    const centerRange = Math.max(...centers) - Math.min(...centers);

    const cx = 2;
    const cz = 2;
    const x0 = cx * TABLE_CHUNK_TILES;
    const z0 = cz * TABLE_CHUNK_TILES;
    let localMin = Infinity;
    let localMax = -Infinity;
    for (let z = z0 + 2; z < z0 + TABLE_CHUNK_TILES - 2; z++) {
      for (let x = x0 + 2; x < x0 + TABLE_CHUNK_TILES - 2; x++) {
        const h = field.heightMap[z * field.width + x];
        if (h < localMin) localMin = h;
        if (h > localMax) localMax = h;
      }
    }
    assert.ok(centerRange > 0.2);
    assert.ok(centerRange > (localMax - localMin) * 1.15);
  });

  it('adds chunk terraces on top of the tile-ripple height', () => {
    const ripples = createField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    generateHeightMap(ripples);
    const terraced = createField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    applySeededHeight(terraced);
    assert.notEqual(ripples.heightMap[40 * TINY_MAP_W + 40], terraced.heightMap[40 * TINY_MAP_W + 40]);
  });

  it('locks extra lift at the table rim', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    field.regionLift.fill(1);
    composeHeightMap(field);
    const rim = 8; // south-edge tile, locked to the rails
    const edgeHi = 9.5 / 14;
    const rimDetail = field.detailHeight[rim];
    const rimExpected = rimDetail > edgeHi ? edgeHi : rimDetail;
    assert.ok(Math.abs(field.heightMap[rim] - rimExpected) < 0.04);
    assert.ok(field.heightMap[rim] <= edgeHi + 1e-4);
    const inland = 20 * TINY_MAP_W + 20;
    const detail = field.detailHeight[inland];
    assert.ok(Math.abs(field.heightMap[inland] - (detail * 0.4 + 0.6)) < 0.02);
  });

  it('flattens a pond in place instead of dropping it to the map floor', () => {
    const field = createField(1, { width: 48, height: 28 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.heightMap.fill(0.5);
    const stamp = (cx, cz, radius, base) => {
      for (let z = cz - radius; z <= cz + radius; z++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if ((x - cx) ** 2 + (z - cz) ** 2 > radius * radius) continue;
          const i = z * field.width + x;
          field.terrainTypes[i] = TERRAIN.WATER;
          field.heightMap[i] = base + 0.16 * Math.sin(x * 0.85) * Math.cos(z * 0.75);
        }
      }
    };
    stamp(10, 14, 8, 0.28);
    stamp(36, 14, 8, 0.82);
    refreshTerrainDerived(field);

    const stats = (cx, cz, radius) => {
      let n = 0;
      let level = 0;
      let feltLo = Infinity;
      let feltHi = -Infinity;
      for (let z = cz - radius; z <= cz + radius; z++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (!isOpenWater(field, x, z)) continue;
          const i = z * field.width + x;
          const felt = field.heightMap[i];
          n++;
          level += field.waterLevel[i];
          if (felt < feltLo) feltLo = felt;
          if (felt > feltHi) feltHi = felt;
        }
      }
      return { n, mean: level / n, feltRange: feltHi - feltLo };
    };

    const low = stats(10, 14, 8);
    const high = stats(36, 14, 8);
    assert.ok(low.n > 20 && high.n > 20);
    assert.ok(low.feltRange > 0.12, `expected ripples, got ${low.feltRange}`);
    const span = (cx, cz) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const h = field.waterLevel[(cz + dz) * field.width + (cx + dx)];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      return { mid: field.waterLevel[cz * field.width + cx], range: hi - lo };
    };
    const lowMid = span(10, 14);
    const highMid = span(36, 14);
    assert.ok(lowMid.range < 0.04, `low pond center still rolling (${lowMid.range})`);
    assert.ok(highMid.range < 0.04, `high pond center still rolling (${highMid.range})`);
    assert.ok(Math.abs(lowMid.mid - 0.28) < 0.08, `low pond left its elevation (${lowMid.mid})`);
    assert.ok(Math.abs(highMid.mid - 0.82) < 0.08, `high pond left its elevation (${highMid.mid})`);
    assert.ok(highMid.mid - lowMid.mid > 0.4);
    assert.ok(high.mean > 0.55, `high pond sank toward the floor (${high.mean})`);
  });

  it('keeps water a shallow dish instead of a scaled cliff', () => {
    const field = buildField(12345, { width: TINY_MAP_W, height: TINY_MAP_W });
    let found = false;
    let worst = -Infinity;
    for (let z = 1; z < field.height - 1; z++) {
      for (let x = 1; x < field.width - 1; x++) {
        if (field.terrainTypes[z * field.width + x] !== TERRAIN.WATER) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (field.terrainTypes[nz * field.width + nx] === TERRAIN.WATER) continue;
          const drop = tileHeightWorld(field, nx, nz) - tileHeightWorld(field, x, z);
          if (drop > worst) worst = drop;
          found = true;
        }
      }
    }
    assert.ok(found);
    assert.ok(worst < 4, `shore drop ${worst}`);
  });

  it('keeps water seated on the felt where it meets a plinth or table edge', () => {
    const field = createField(1, { width: 48, height: 40 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.35);
    field.regionLift.fill(1);
    field.activeMask.fill(1);
    for (let z = 12; z <= 28; z++) {
      for (let x = 16; x <= 32; x++) field.terrainTypes[z * field.width + x] = TERRAIN.WATER;
    }
    const plinth = 20 * field.width + 24;
    field.terrainTypes[plinth] = TERRAIN.GRASS;
    field.tableEdge = new Uint8Array(field.width * field.height);
    field.tableEdge[plinth] = 1;
    composeHeightMap(field);
    const beside = 20 * field.width + 25;
    assert.equal(field.terrainTypes[beside], TERRAIN.WATER);
    assert.ok(field.edgeLock[beside] < 0.08);
    assert.ok(
      Math.abs(field.waterLevel[beside] - field.heightMap[beside]) < 0.02,
      `water pulled off the plinth (${field.waterLevel[beside]} vs ${field.heightMap[beside]})`,
    );
    const gap = () => tileHeightWorld(field, 24, 20) - tileHeightWorld(field, 25, 20);
    const before = gap();
    assert.ok(Math.abs(before) < 0.35, `plinth seam ${before}`);
    const plinthH = field.heightMap[plinth];
    paintRegionLift(field, 24, 20, 0.45, 0);
    paintRegionLift(field, 25, 20, 0.45, 0);
    assert.ok(field.heightMap[plinth] > plinthH + 0.08, 'plinth footprint did not rise');
    assert.ok(Math.abs(gap()) < 1.2, `raise opened the plinth seam (${before} -> ${gap()})`);
  });

  it('raise paint lifts water with the felt and leaves the rest of the pond seated', () => {
    const field = createField(1, { width: 48, height: 28 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.heightMap.fill(0.55);
    field.detailHeight.fill(0.55);
    field.regionLift.fill(0.4);
    for (let z = 10; z <= 18; z++) {
      for (let x = 20; x <= 28; x++) {
        if ((x - 24) ** 2 + (z - 14) ** 2 > 16) continue;
        field.terrainTypes[z * field.width + x] = TERRAIN.WATER;
      }
    }
    const far = 14 * field.width + 40;
    field.terrainTypes[far] = TERRAIN.WATER;
    refreshTerrainDerived(field);
    composeHeightMap(field);
    const center = 14 * field.width + 24;
    const dish = field.waterLevel[center] - field.heightMap[center];
    const farLevel = field.waterLevel[far];
    let shore = null;
    for (let z = 10; z <= 18 && !shore; z++) {
      for (let x = 20; x <= 28; x++) {
        const i = z * field.width + x;
        if (field.terrainTypes[i] !== TERRAIN.WATER) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (field.terrainTypes[nz * field.width + nx] === TERRAIN.WATER) continue;
          shore = { wx: x, wz: z, lx: nx, lz: nz };
          break;
        }
        if (shore) break;
      }
    }
    const gap = () => tileHeightWorld(field, shore.lx, shore.lz) - tileHeightWorld(field, shore.wx, shore.wz);
    const gapBefore = gap();
    paintRegionLift(field, shore.wx, shore.wz, 0.2, 0);
    paintRegionLift(field, shore.lx, shore.lz, 0.2, 0);
    assert.ok(Math.abs(gap() - gapBefore) < 1e-4, `shore gap opened (${gapBefore} -> ${gap()})`);
    paintRegionLift(field, 24, 14, 0.25, 2);
    assert.ok(Math.abs((field.waterLevel[center] - field.heightMap[center]) - dish) < 1e-4);
    assert.ok(field.waterLevel[center] > farLevel);
    assert.ok(Math.abs(field.waterLevel[far] - farLevel) < 1e-4);
  });

  it('raise paint moves the table rim while seeded hills stay locked', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    const rim = 8;
    field.detailHeight[rim] = 0.4;
    field.regionLift[rim] = 1;
    composeHeightMap(field);
    const before = field.heightMap[rim];
    assert.ok(Math.abs(before - 0.4) < 0.05, `seeded lift leaked onto the rim (${before})`);
    const dirty = paintRegionLift(field, 8, 0, 0.5, 0);
    assert.ok(dirty.some((t) => t.x === 8 && t.z === 0));
    assert.ok(field.heightMap[rim] > before + 0.08, `rim did not rise (${before} -> ${field.heightMap[rim]})`);
    const raised = field.heightMap[rim];
    paintRegionLift(field, 8, 0, -0.5, 0);
    assert.ok(field.heightMap[rim] < raised);
  });

  it('saves a rim raise with the garden', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    const rim = 8;
    paintRegionLift(field, 8, 0, 0.5, 0);
    const again = fieldFromGarden(encodeGarden(field));
    assert.ok(Math.abs(again.heightMap[rim] - field.heightMap[rim]) < 0.02);
    assert.ok(Math.abs(again.paintedLift[rim] - field.paintedLift[rim]) < 0.02);
  });

  it('raise paint flattens the brush onto the high tile', () => {
    const field = createField(1, { width: 16, height: 16 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.35);
    field.regionLift.fill(0.2);
    field.activeMask.fill(1);
    field.regionLift[8 * 16 + 8] = 0.95;
    field.regionLift[8 * 16 + 9] = 0.02;
    field.regionLift[2 * 16 + 2] = 0.02;
    composeHeightMap(field);
    const outside = tileHeightWorld(field, 2, 2);
    const highBefore = tileHeightWorld(field, 8, 8);
    const lowBefore = tileHeightWorld(field, 9, 8);
    assert.ok(highBefore - lowBefore > 2, `expected a step (${highBefore - lowBefore})`);
    paintRegionLift(field, 8, 8, 0.07, 1);
    const high = tileHeightWorld(field, 8, 8);
    const low = tileHeightWorld(field, 9, 8);
    assert.ok(high >= highBefore - 0.05);
    assert.ok(low > lowBefore);
    assert.ok(high - low < highBefore - lowBefore);
    assert.ok(Math.abs(tileHeightWorld(field, 2, 2) - outside) < 0.02);
  });

  it('lower paint flattens the brush onto the low tile', () => {
    const field = createField(1, { width: 16, height: 16 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.35);
    field.regionLift.fill(0.2);
    field.activeMask.fill(1);
    field.regionLift[8 * 16 + 8] = 0.95;
    field.regionLift[8 * 16 + 9] = 0.02;
    composeHeightMap(field);
    const lowBefore = tileHeightWorld(field, 9, 8);
    const highBefore = tileHeightWorld(field, 8, 8);
    paintRegionLift(field, 8, 8, -0.07, 1);
    const high = tileHeightWorld(field, 8, 8);
    const low = tileHeightWorld(field, 9, 8);
    assert.ok(low < lowBefore);
    assert.ok(high < highBefore);
    const drop = highBefore - high;
    const edgeDrop = lowBefore - low;
    assert.ok(drop > edgeDrop && edgeDrop > 0.05, `edge did not ease (${edgeDrop} vs ${drop})`);
  });

  it('raise paint brings water up to the land in the brush', () => {
    const field = createField(1, { width: 24, height: 24 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.55);
    field.regionLift.fill(0.4);
    field.activeMask.fill(1);
    const water = 12 * 24 + 12;
    field.terrainTypes[water] = TERRAIN.WATER;
    field.detailHeight[water] = 0.12;
    composeHeightMap(field);
    const landBefore = tileHeightWorld(field, 13, 12);
    const waterBefore = tileHeightWorld(field, 12, 12);
    assert.ok(landBefore - waterBefore > 1, `expected water below the bank (${landBefore - waterBefore})`);
    paintRegionLift(field, 12, 12, 0.07, 1);
    const land = tileHeightWorld(field, 13, 12);
    const waterY = tileHeightWorld(field, 12, 12);
    assert.ok(waterY > waterBefore + (landBefore - waterBefore) * 0.7, `water stayed low (${waterY})`);
    assert.ok(land > landBefore);
    assert.ok(land < waterY, `bank jumped with the center (${land} vs ${waterY})`);
  });

  it('table edge eases to the rail cap and the middle can pass it', () => {
    const field = buildField(2, { width: 48, height: 48 });
    fullSilhouette(field);
    let rimHi = -Infinity;
    let inlandHi = -Infinity;
    let edge = null;
    let mid = null;
    let inner = null;
    for (let z = 0; z < field.height; z++) {
      for (let x = 0; x < field.width; x++) {
        const i = z * field.width + x;
        if (field.activeMask[i] === 0) continue;
        const e = field.edgeLock[i];
        const y = tileHeightWorld(field, x, z);
        if (e < 0.02) {
          if (y > rimHi) rimHi = y;
          if (!edge) edge = { x, z };
        } else if (e > 0.98) {
          if (y > inlandHi) inlandHi = y;
          if (!inner) inner = { x, z };
        } else if (!mid && e > 0.45 && e < 0.55) {
          mid = { x, z, e };
        }
      }
    }
    assert.ok(edge && mid && inner);
    assert.ok(rimHi <= 9.55, `generated rim rose past the rail (${rimHi})`);
    assert.ok(inlandHi > 9.5, `generated middle stayed under the rail cap (${inlandHi})`);
    for (let n = 0; n < 24; n++) paintRegionLift(field, edge.x, edge.z, 0.35, 3);
    for (let n = 0; n < 36; n++) paintRegionLift(field, inner.x, inner.z, 0.35, 8);
    const edgeY = tileHeightWorld(field, edge.x, edge.z);
    const innerY = tileHeightWorld(field, inner.x, inner.z);
    assert.ok(edgeY <= 9.7, `edge rose over the rail (${edgeY})`);
    assert.ok(innerY > 16, `middle did not get extra height (${innerY})`);
    const step = Math.abs(tileHeightWorld(field, inner.x, inner.z) - tileHeightWorld(field, inner.x + 1, inner.z));
    assert.ok(step <= 2.8 + 0.2, `slope went vertical (${step})`);
  });

  it('a water shore cannot stay a cliff against raised land', () => {
    const field = createField(3, { width: 24, height: 24 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.45);
    field.regionLift.fill(0.2);
    field.activeMask.fill(1);
    field.terrainTypes[12 * 24 + 11] = TERRAIN.WATER;
    field.detailHeight[12 * 24 + 11] = 0.2;
    composeHeightMap(field);
    for (let n = 0; n < 12; n++) paintRegionLift(field, 12, 12, 0.4, 0);
    refreshTerrainDerived(field);
    const land = tileHeightWorld(field, 12, 12);
    const water = tileHeightWorld(field, 11, 12);
    assert.ok(land > water);
    assert.ok(land - water <= 2.8 + 0.25, `shore cliff ${land - water}`);
  });

  it('releveling a pond marks distant water so the sheet does not tear', () => {
    const field = createField(1, { width: 32, height: 16 });
    field.terrainTypes.fill(TERRAIN.GRASS);
    field.detailHeight.fill(0.5);
    field.regionLift.fill(0.3);
    field.activeMask.fill(1);
    for (let x = 4; x <= 28; x++) field.terrainTypes[8 * 32 + x] = TERRAIN.WATER;
    composeHeightMap(field);
    consumeWaterDirty(field);
    field.heightMap[8 * 32 + 4] += 0.25;
    field.waterSurfaceReady = false;
    rebuildWaterSurface(field);
    const dirty = consumeWaterDirty(field);
    assert.ok(dirty.some((t) => t.x >= 24 && t.z === 8), 'far water releveled without a rebuild mark');
  });

  it('raise paint keeps terrain types and lifts the felt', () => {
    const field = buildField(1, { width: TINY_MAP_W, height: TINY_MAP_W });
    fullSilhouette(field);
    const i = 20 * TINY_MAP_W + 20;
    const kind = field.terrainTypes[i];
    const before = field.heightMap[i];
    const dirty = paintRegionLift(field, 20, 20, 0.35, 2);
    assert.ok(dirty.length > 0);
    assert.equal(field.terrainTypes[i], kind);
    assert.ok(field.heightMap[i] > before);
  });

  it('painting land keeps the lake surface instead of the basin', () => {
    const field = buildField(2, { width: 96, height: 96 });
    fullSilhouette(field);
    let pick = null;
    for (let z = 2; z < field.height - 2; z++) {
      for (let x = 2; x < field.width - 2; x++) {
        const i = z * field.width + x;
        if (field.terrainTypes[i] !== TERRAIN.WATER) continue;
        const vis = tileHeightWorld(field, x, z);
        const felt = field.heightMap[i] * 14;
        if (vis - felt > 2 && (!pick || vis - felt > pick.gap)) {
          pick = { x, z, vis, gap: vis - felt };
        }
      }
    }
    assert.ok(pick, 'expected a water tile held above its basin');
    let land = null;
    for (let z = 2; z < field.height - 2 && !land; z++) {
      for (let x = 2; x < field.width - 2; x++) {
        if (field.terrainTypes[z * field.width + x] === TERRAIN.WATER) continue;
        if (Math.abs(x - pick.x) + Math.abs(z - pick.z) < 6) continue;
        land = { x, z };
        break;
      }
    }
    assert.ok(land, 'expected land away from the painted lake');
    paintRegionLift(field, pick.x, pick.z, 0.28, 1);
    const landBefore = tileHeightWorld(field, land.x, land.z);
    const raised = new Map();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx * dx + dz * dz > 1) continue;
        const x = pick.x + dx;
        const z = pick.z + dz;
        const i = z * field.width + x;
        if (field.terrainTypes[i] !== TERRAIN.WATER) continue;
        raised.set(i, tileHeightWorld(field, x, z));
      }
    }
    assert.ok(raised.size > 0);
    paintTerrainBrush(field, pick.x, pick.z, TERRAIN.DIRT, 1);
    for (const [i, vis] of raised) {
      const x = i % field.width;
      const z = (i / field.width) | 0;
      assert.equal(field.terrainTypes[i], TERRAIN.DIRT);
      const after = tileHeightWorld(field, x, z);
      assert.ok(Math.abs(after - vis) < 0.02, `dirt dropped into the basin (${vis} -> ${after})`);
    }
    assert.ok(Math.abs(tileHeightWorld(field, land.x, land.z) - landBefore) < 0.02);
    const again = fieldFromGarden(encodeGarden(field));
    const saved = tileHeightWorld(again, pick.x, pick.z);
    const live = tileHeightWorld(field, pick.x, pick.z);
    assert.ok(Math.abs(saved - live) < 0.12, `garden dropped the filled lake (${live} -> ${saved})`);
  });

  it('restores seeded height when a garden only stores terrain types', () => {
    const src = buildField(77, { width: 32, height: 32 });
    fullSilhouette(src);
    const again = fieldFromGarden(encodeGarden(src));
    assert.ok(Math.abs(again.heightMap[8 * 32 + 8] - src.heightMap[8 * 32 + 8]) < 0.02);
    assert.ok(again.heightMap.some((h) => h > 0));
  });
});

function isOpenWater(field, x, z) {
  const { width, height, terrainTypes } = field;
  if (x < 0 || z < 0 || x >= width || z >= height) return false;
  if (terrainTypes[z * width + x] !== TERRAIN.WATER) return false;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) return false;
      if (terrainTypes[nz * width + nx] !== TERRAIN.WATER) return false;
    }
  }
  return true;
}

function paintTerrain(field, type) {
  field.terrainTypes.fill(type);
}

function at(field, x, z) {
  return z * field.width + x;
}

describe('terrain atlases', () => {
  it('makes a straight water–dirt shore walkable on the dirt–water sheet', () => {
    const field = createField(1, { width: 6, height: 6 });
    paintTerrain(field, TERRAIN.DIRT);
    for (let z = 3; z < 6; z++) {
      for (let x = 0; x < 6; x++) field.terrainTypes[at(field, x, z)] = TERRAIN.WATER;
    }
    refreshTerrainDerived(field);
    const dirt = at(field, 2, 2);
    const water = at(field, 2, 3);
    const deep = at(field, 2, 5);
    assert.equal(field.tileType[dirt], 12);
    assert.equal(field.atlasId[water], ATLAS.DIRT_WATER);
    assert.notEqual(field.tileType[water], 12);
    assert.equal(field.tileType[water], terrainCornerCell(field.terrainTypes, 6, 6, 2, 3, TERRAIN.DIRT));
    assert.equal(field.pass[water], 1);
    assert.equal(field.tileType[deep], 12);
    assert.equal(field.pass[deep], 0);
  });

  it('keeps grass–water shores and solid cells', () => {
    const field = createField(1, { width: 6, height: 6 });
    paintTerrain(field, TERRAIN.GRASS);
    for (let z = 3; z < 6; z++) {
      for (let x = 0; x < 6; x++) field.terrainTypes[at(field, x, z)] = TERRAIN.WATER;
    }
    refreshTerrainDerived(field);
    const grass = at(field, 2, 2);
    const water = at(field, 2, 3);
    const deep = at(field, 2, 5);
    assert.equal(field.tileType[grass], 6);
    assert.equal(field.atlasId[water], ATLAS.GRASS_WATER);
    assert.notEqual(field.tileType[water], 12);
    assert.equal(field.pass[water], 1);
    assert.equal(field.tileType[deep], 12);
    assert.equal(field.pass[deep], 0);
  });

  it('keeps painted terrain at a triple corner and shores on all land', () => {
    const field = createField(1, { width: 8, height: 3 });
    paintTerrain(field, TERRAIN.DIRT);
    for (let x = 0; x < 4; x++) field.terrainTypes[at(field, x, 0)] = TERRAIN.GRASS;
    for (let z = 1; z < 3; z++) {
      for (let x = 0; x < 8; x++) field.terrainTypes[at(field, x, z)] = TERRAIN.WATER;
    }
    refreshTerrainDerived(field);
    const rev = { [TERRAIN.GRASS]: 'G', [TERRAIN.DIRT]: 'D', [TERRAIN.WATER]: 'W' };
    let top = '';
    for (let x = 0; x < 8; x++) top += rev[field.terrainTypes[at(field, x, 0)]];
    assert.equal(top, 'GGGGDDDD');
    for (let x = 0; x < 8; x++) {
      const shore = at(field, x, 1);
      assert.equal(field.terrainTypes[shore], TERRAIN.WATER);
      assert.notEqual(field.tileType[shore], 12, `shore ${x}`);
      assert.equal(field.pass[shore], 1);
      assert.equal(field.tileType[at(field, x, 2)], 12);
    }
    // Both land kinds touch the junction water, so it is a grass–water shore
    // with dirt layered under the grass.
    const junction = at(field, 4, 1);
    assert.equal(field.atlasId[junction], ATLAS.GRASS_WATER);
    assert.notEqual(terrainCornerCell(field.terrainTypes, 8, 3, 4, 1, TERRAIN.GRASS), 12);
    assert.notEqual(terrainCornerCell(field.terrainTypes, 8, 3, 4, 1, TERRAIN.DIRT), 12);
    assert.equal(field.atlasId[at(field, 5, 1)], ATLAS.DIRT_WATER);
  });

  it('reports which corners a terrain touches', () => {
    const W = TERRAIN.WATER;
    const D = TERRAIN.DIRT;
    // Row-major from z = 0. Only the tile at (0, 0) is dirt.
    const types = Uint8Array.from([D, W, W, W]);
    assert.equal(terrainCornerCell(types, 2, 2, 0, 0, D), 6);
    assert.equal(terrainCornerCell(types, 2, 2, 1, 1, TERRAIN.GRASS), 12);
    const cells = new Set([
      terrainCornerCell(types, 2, 2, 1, 0, D),
      terrainCornerCell(types, 2, 2, 0, 1, D),
      terrainCornerCell(types, 2, 2, 1, 1, D),
    ]);
    assert.equal(cells.size, 3);
    assert.ok(![...cells].includes(12) && ![...cells].includes(6));
  });
});

describe('forge map size', () => {
  it('snaps custom width and depth onto odd chunks', () => {
    assert.equal(clampForgeChunks(9), 9);
    assert.equal(clampForgeChunks(8), 9);
    assert.equal(clampForgeChunks(2), 5);
    assert.equal(clampForgeChunks(40), 41);
    assert.equal(clampForgeChunks(80), 63);
    assert.equal(forgeTilesForChunks(63), 1008);
    assert.equal(forgeTilesForChunks(5), 80);
    assert.equal(forgeTilesForChunks(13), 208);
  });

  it('centers a rectangular board on the origin', () => {
    const width = forgeTilesForChunks(5);
    const height = forgeTilesForChunks(9);
    const field = buildField(1, { width, height });
    assert.equal(field.width, 80);
    assert.equal(field.height, 144);
    assert.equal(worldToTile(0), 40);
    assert.equal(worldToTileZ(0), 72);
    const center = tableCenterVertex(field);
    assert.equal(center.x, 0);
    assert.equal(center.z, 0);
  });

  it('paths on a board larger than the stress A* grid', () => {
    const tiles = forgeTilesForChunks(33);
    const field = createField(1, { width: tiles, height: tiles });
    field.pass.fill(1);
    const tx = tiles - 3;
    const tz = tiles - 2;
    field.pass[tz * tiles + (tx + 1)] = 0;
    const wx = new Int32Array(8);
    const wy = new Int32Array(8);
    const n = findPath(
      field,
      tileCenterX(tx),
      tileCenterY(tz),
      tileCenterX(tx + 2),
      tileCenterY(tz),
      wx,
      wy,
    );
    assert.ok(n > 0);
  });
});
