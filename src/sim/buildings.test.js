import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { applyCommands, CMD } from './commands.js';
import { buildField, worldToTile, isPassable, isSlowTile } from './field.js';
import * as fx from './fixed.js';
import {
  serializeBuildings,
  isPlaceableBuilding,
  applyStructureOccupancyAt,
  applyWorldStructureOccupancy,
  canPlaceBuildingAt,
  buildingFootprintBounds,
  BUILDING_FOOTPRINTS,
} from './buildings.js';
import { createAgoras } from './agora.js';

function clearClaim(field, type, xF, zF) {
  const b = buildingFootprintBounds(type, fx.fromFloat(xF), fx.fromFloat(zF));
  for (let dz = 0; dz < b.h; dz++) {
    for (let dx = 0; dx < b.w; dx++) {
      const tx = b.x0 + dx;
      const tz = b.z0 + dz;
      const i = tz * field.width + tx;
      field.pass[i] = 1;
      field.slowMask[i] = 0;
      if (field.structureSlowMask) field.structureSlowMask[i] = 0;
      if (field.activeMask) field.activeMask[i] = 1;
    }
  }
}

function footprintTiles(field, type, xF, zF) {
  const fp = BUILDING_FOOTPRINTS[type];
  const cx = worldToTile(fx.fromFloat(xF));
  const cz = worldToTile(fx.fromFloat(zF));
  const x0 = cx - ((fp.w - 1) >> 1);
  const z0 = cz - ((fp.h - 1) >> 1);
  const tiles = [];
  for (let dz = 0; dz < fp.h; dz++) {
    for (let dx = 0; dx < fp.w; dx++) {
      tiles.push({ tx: x0 + dx, tz: z0 + dz });
    }
  }
  return tiles;
}

describe('buildings place', () => {
  it('PLACE_BUILDING appends to w.buildings', () => {
    const w = createWorld(1);
    w.buildings = [];
    const field = buildField(1, { width: 64, height: 64 });
    clearClaim(field, 'barracks', 10, 20);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'barracks',
        tx: fx.fromFloat(10),
        ty: fx.fromFloat(20),
        yaw: 0,
      },
    ]);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.buildings[0].type, 'barracks');
    assert.equal(w.buildings[0].owner, 0);
    const ser = serializeBuildings(w.buildings);
    assert.ok(Math.abs(ser[0].x - 10) < 0.01);
    assert.ok(Math.abs(ser[0].z - 20) < 0.01);
  });

  it('rejects unknown types', () => {
    assert.equal(isPlaceableBuilding('nope'), false);
    const w = createWorld(2);
    w.buildings = [];
    const field = buildField(2, { width: 64, height: 64 });
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'castle',
        tx: 0,
        ty: 0,
      },
    ]);
    assert.equal(w.buildings.length, 0);
  });

  it('barracks footprint blocks core and slows pad', () => {
    const w = createWorld(3);
    w.buildings = [];
    const field = buildField(3, { width: 64, height: 64 });
    const x = 32;
    const z = 32;
    clearClaim(field, 'barracks', x, z);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'barracks',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    const core = footprintTiles(field, 'barracks', x, z);
    assert.equal(core.length, 9);
    for (const { tx, tz } of core) {
      assert.equal(isPassable(field, tx, tz), false, `blocked ${tx},${tz}`);
    }
    const b = buildingFootprintBounds('barracks', fx.fromFloat(x), fx.fromFloat(z));
    assert.equal(b.slowPad, 1);
    assert.equal(b.w, 5);
    assert.equal(b.h, 5);
    let slowPadTiles = 0;
    for (let dz = 0; dz < b.h; dz++) {
      for (let dx = 0; dx < b.w; dx++) {
        const tx = b.x0 + dx;
        const tz = b.z0 + dz;
        const inCore =
          tx >= b.coreX0 &&
          tx < b.coreX0 + b.coreW &&
          tz >= b.coreZ0 &&
          tz < b.coreZ0 + b.coreH;
        if (inCore) continue;
        assert.equal(isPassable(field, tx, tz), true, `pad passable ${tx},${tz}`);
        assert.equal(isSlowTile(field, tx, tz), true, `pad slow ${tx},${tz}`);
        slowPadTiles++;
      }
    }
    assert.equal(slowPadTiles, 5 * 5 - 9);
  });

  it('farm footprint is slow but passable', () => {
    const w = createWorld(4);
    w.buildings = [];
    const field = buildField(4, { width: 64, height: 64 });
    const x = 40;
    const z = 40;
    clearClaim(field, 'farm', x, z);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'farm',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    const tiles = footprintTiles(field, 'farm', x, z);
    assert.equal(tiles.length, 4);
    for (const { tx, tz } of tiles) {
      assert.equal(isPassable(field, tx, tz), true, `passable ${tx},${tz}`);
      assert.equal(isSlowTile(field, tx, tz), true, `slow ${tx},${tz}`);
      assert.equal(field.structureSlowMask[tz * field.width + tx], 1);
    }
  });

  it('agora footprint is slow', () => {
    const field = buildField(5, { width: 64, height: 64 });
    const x = 20;
    const z = 20;
    clearClaim(field, 'agora', x, z);
    const w = createWorld(5);
    w.agoras = createAgoras([{ owner: 0, x, z }]);
    w.buildings = [];
    applyWorldStructureOccupancy(field, w);
    const tiles = footprintTiles(field, 'agora', x, z);
    assert.equal(tiles.length, 16);
    for (const { tx, tz } of tiles) {
      assert.equal(isPassable(field, tx, tz), true);
      assert.equal(isSlowTile(field, tx, tz), true);
    }
  });

  it('rejects place on blocked or structure-slow tiles, allows tree slow', () => {
    const w = createWorld(7);
    w.buildings = [];
    const field = buildField(7, { width: 64, height: 64 });
    const x = 28;
    const z = 28;
    clearClaim(field, 'farm', x, z);
    const tiles = footprintTiles(field, 'farm', x, z);
    field.pass[tiles[0].tz * field.width + tiles[0].tx] = 0;
    assert.equal(canPlaceBuildingAt(field, 'farm', fx.fromFloat(x), fx.fromFloat(z)), false);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'farm',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 0);

    clearClaim(field, 'barracks', x, z);
    // Tree / shore yellow alone must NOT block placement.
    field.slowMask[tiles[0].tz * field.width + tiles[0].tx] = 1;
    assert.equal(
      canPlaceBuildingAt(field, 'barracks', fx.fromFloat(x), fx.fromFloat(z)),
      true,
    );
    // Structure yellow (farm/agora pad) does block.
    field.structureSlowMask[tiles[0].tz * field.width + tiles[0].tx] = 1;
    assert.equal(
      canPlaceBuildingAt(field, 'barracks', fx.fromFloat(x), fx.fromFloat(z)),
      false,
    );
  });

  it('rejects stacking on existing farm slow zone', () => {
    const w = createWorld(8);
    w.buildings = [];
    const field = buildField(8, { width: 64, height: 64 });
    const x = 36;
    const z = 36;
    clearClaim(field, 'farm', x, z);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'farm',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 1);
    assert.equal(canPlaceBuildingAt(field, 'farm', fx.fromFloat(x), fx.fromFloat(z)), false);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'farm',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 1);
  });

  it('clears trees under a placed footprint', () => {
    const w = createWorld(9);
    w.buildings = [];
    const field = buildField(9, { width: 64, height: 64 });
    const x = 44;
    const z = 44;
    clearClaim(field, 'farm', x, z);
    const tiles = footprintTiles(field, 'farm', x, z);
    for (const { tx, tz } of tiles) {
      const i = tz * field.width + tx;
      field.sceneryType[i] = 1; // TREE
      field.treeStock[i] = 40;
      field.slowMask[i] = 1;
    }
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'farm',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 1);
    for (const { tx, tz } of tiles) {
      const i = tz * field.width + tx;
      assert.equal(field.treeStock[i], 0, `tree cleared ${tx},${tz}`);
      assert.equal(field.sceneryType[i], 0, `scenery cleared ${tx},${tz}`);
      assert.equal(field.structureSlowMask[i], 1);
      assert.equal(field.slowMask[i], 1);
    }
  });

  it('applyStructureOccupancyAt is idempotent', () => {
    const field = buildField(6, { width: 64, height: 64 });
    clearClaim(field, 'church', 24, 24);
    const x = fx.fromFloat(24);
    const z = fx.fromFloat(24);
    applyStructureOccupancyAt(field, 'church', x, z);
    applyStructureOccupancyAt(field, 'church', x, z);
    const tiles = footprintTiles(field, 'church', 24, 24);
    assert.equal(tiles.length, 9);
    for (const { tx, tz } of tiles) {
      assert.equal(field.pass[tz * field.width + tx], 0);
    }
  });
});
