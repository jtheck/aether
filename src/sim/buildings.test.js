import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn, ORDER } from './world.js';
import { applyCommands, CMD } from './commands.js';
import {
  buildField,
  isPassable,
  isSlowTile,
  TILE_SIZE_F,
  worldToTile,
  tileCenterX,
  tileCenterY,
} from './field.js';
import * as fx from './fixed.js';
import {
  serializeBuildings,
  isPlaceableBuilding,
  applyStructureOccupancyAt,
  applyWorldStructureOccupancy,
  canPlaceBuildingAt,
  buildingFootprintBounds,
  snapBuildingWorld,
  BUILDING_FOOTPRINTS,
  getBuildingDisplayName,
  buildingCanRally,
  TRAIN_TICKS,
} from './buildings.js';
import { buildingProductionSystem } from './buildingProduction.js';
import { createAgoras } from './agora.js';
import { UNIT } from './unitTypes.js';
import { planPathBudget } from './path.js';
import { step } from './step.js';

function snapFloat(type, xF, zF) {
  const s = snapBuildingWorld(type, fx.fromFloat(xF), fx.fromFloat(zF));
  return { x: fx.toFloat(s.x), z: fx.toFloat(s.z), xFixed: s.x, zFixed: s.z };
}

function clearClaim(field, type, xF, zF) {
  const { xFixed, zFixed } = snapFloat(type, xF, zF);
  const b = buildingFootprintBounds(type, xFixed, zFixed);
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

function footprintTiles(type, xF, zF) {
  const { xFixed, zFixed } = snapFloat(type, xF, zF);
  const b = buildingFootprintBounds(type, xFixed, zFixed);
  const tiles = [];
  for (let dz = 0; dz < b.coreH; dz++) {
    for (let dx = 0; dx < b.coreW; dx++) {
      tiles.push({ tx: b.coreX0 + dx, tz: b.coreZ0 + dz });
    }
  }
  return tiles;
}

describe('buildings place', () => {
  it('PLACE_BUILDING snaps odd footprints to tile centers', () => {
    const w = createWorld(1);
    w.buildings = [];
    const field = buildField(1, { width: 64, height: 64 });
    // Off-center hit; barracks is 3×3 (odd).
    const hitX = 10.7;
    const hitZ = 20.2;
    clearClaim(field, 'barracks', hitX, hitZ);
    const expected = snapFloat('barracks', hitX, hitZ);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'barracks',
        tx: fx.fromFloat(hitX),
        ty: fx.fromFloat(hitZ),
        yaw: 0,
      },
    ]);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.buildings[0].type, 'barracks');
    assert.equal(w.buildings[0].owner, 0);
    const ser = serializeBuildings(w.buildings);
    assert.ok(Math.abs(ser[0].x - expected.x) < 1e-4);
    assert.ok(Math.abs(ser[0].z - expected.z) < 1e-4);
    // Odd snap lands on tile centers (… + 2 mod 4).
    const mod = (v) => ((v % TILE_SIZE_F) + TILE_SIZE_F) % TILE_SIZE_F;
    assert.ok(Math.abs(mod(expected.x) - TILE_SIZE_F / 2) < 1e-4);
    assert.ok(Math.abs(mod(expected.z) - TILE_SIZE_F / 2) < 1e-4);
  });

  it('PLACE_BUILDING snaps even footprints to tile intersections', () => {
    const w = createWorld(11);
    w.buildings = [];
    const field = buildField(11, { width: 64, height: 64 });
    const hitX = 41.3;
    const hitZ = 39.1;
    // Mine is 2×2 (even); farm is 3×3 (odd).
    clearClaim(field, 'mine', hitX, hitZ);
    const expected = snapFloat('mine', hitX, hitZ);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'mine',
        tx: fx.fromFloat(hitX),
        ty: fx.fromFloat(hitZ),
      },
    ]);
    assert.equal(w.buildings.length, 1);
    const ser = serializeBuildings(w.buildings);
    assert.ok(Math.abs(ser[0].x - expected.x) < 1e-4);
    assert.ok(Math.abs(ser[0].z - expected.z) < 1e-4);
    const mod = (v) => ((v % TILE_SIZE_F) + TILE_SIZE_F) % TILE_SIZE_F;
    assert.ok(mod(expected.x) < 1e-4);
    assert.ok(mod(expected.z) < 1e-4);
    const b = buildingFootprintBounds('mine', expected.xFixed, expected.zFixed);
    assert.equal(b.coreW, 2);
    assert.equal(b.coreH, 2);
    assert.equal(footprintTiles('mine', hitX, hitZ).length, 4);
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

  it('barracks footprint blocks core only (no slow pad)', () => {
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
    const core = footprintTiles('barracks', x, z);
    assert.equal(core.length, 9);
    for (const { tx, tz } of core) {
      assert.equal(isPassable(field, tx, tz), false, `blocked ${tx},${tz}`);
    }
    const snapped = snapFloat('barracks', x, z);
    const b = buildingFootprintBounds('barracks', snapped.xFixed, snapped.zFixed);
    assert.equal(b.w, 3);
    assert.equal(b.h, 3);
    // Neighbors stay passable and are not structure-slow.
    for (const [dx, dz] of [
      [-1, 0],
      [3, 0],
      [0, -1],
      [0, 3],
    ]) {
      const tx = b.coreX0 + dx;
      const tz = b.coreZ0 + dz;
      assert.equal(isPassable(field, tx, tz), true, `neighbor passable ${tx},${tz}`);
      assert.equal(
        field.structureSlowMask?.[tz * field.width + tx] ?? 0,
        0,
        `neighbor not structure-slow ${tx},${tz}`,
      );
    }
  });

  it('ejects units standing in a newly blocked footprint', () => {
    const w = createWorld(11);
    w.buildings = [];
    const field = buildField(11, { width: 64, height: 64 });
    const x = 32;
    const z = 32;
    clearClaim(field, 'tower', x, z);
    const tiles = footprintTiles('tower', x, z);
    assert.ok(tiles.length >= 1);
    const stand = tiles[0];
    const u = spawn(w, {
      x: tileCenterX(stand.tx),
      y: tileCenterY(stand.tz),
      type: UNIT.WARRIOR,
      owner: 0,
    });
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'tower',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 1);
    assert.equal(w.order[u], ORDER.MOVE);
    assert.equal(w.hasTarget[u], 1);
    // Path + a few steps should leave the blocked core.
    planPathBudget(w, field);
    for (let t = 0; t < 40; t++) step(w, field);
    const tx = worldToTile(w.px[u]);
    const tz = worldToTile(w.py[u]);
    assert.equal(isPassable(field, tx, tz), true, `escaped to ${tx},${tz}`);
    assert.equal(
      tiles.some((c) => c.tx === tx && c.tz === tz),
      false,
      'left the footprint',
    );
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
    const tiles = footprintTiles('farm', x, z);
    assert.equal(tiles.length, 9);
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
    const tiles = footprintTiles('agora', x, z);
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
    const tiles = footprintTiles('farm', x, z);
    const farmSnap = snapFloat('farm', x, z);
    field.pass[tiles[0].tz * field.width + tiles[0].tx] = 0;
    assert.equal(
      canPlaceBuildingAt(field, 'farm', farmSnap.xFixed, farmSnap.zFixed),
      false,
    );
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
    const barracksTiles = footprintTiles('barracks', x, z);
    const barracksSnap = snapFloat('barracks', x, z);
    // Tree / shore yellow alone must NOT block placement.
    field.slowMask[barracksTiles[0].tz * field.width + barracksTiles[0].tx] = 1;
    assert.equal(
      canPlaceBuildingAt(field, 'barracks', barracksSnap.xFixed, barracksSnap.zFixed),
      true,
    );
    // Structure yellow (farm/agora/slow building) does block.
    field.structureSlowMask[barracksTiles[0].tz * field.width + barracksTiles[0].tx] = 1;
    assert.equal(
      canPlaceBuildingAt(field, 'barracks', barracksSnap.xFixed, barracksSnap.zFixed),
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
    const snapped = snapFloat('farm', x, z);
    assert.equal(
      canPlaceBuildingAt(field, 'farm', snapped.xFixed, snapped.zFixed),
      false,
    );
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
    const tiles = footprintTiles('farm', x, z);
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
    const snapped = snapFloat('church', 24, 24);
    applyStructureOccupancyAt(field, 'church', snapped.xFixed, snapped.zFixed);
    applyStructureOccupancyAt(field, 'church', snapped.xFixed, snapped.zFixed);
    const tiles = footprintTiles('church', 24, 24);
    assert.equal(tiles.length, 9);
    for (const { tx, tz } of tiles) {
      assert.equal(field.pass[tz * field.width + tx], 0);
    }
  });

  it('1×1 and 6×6 centering math is size-agnostic', () => {
    buildField(12, { width: 64, height: 64 });
    BUILDING_FOOTPRINTS.__wall = { w: 1, h: 1, mode: 'block' };
    BUILDING_FOOTPRINTS.__keep = { w: 6, h: 6, mode: 'block' };
    try {
      const mod = (v) => ((v % TILE_SIZE_F) + TILE_SIZE_F) % TILE_SIZE_F;
      const wall = snapFloat('__wall', 12.4, -3.1);
      const wallB = buildingFootprintBounds('__wall', wall.xFixed, wall.zFixed);
      assert.equal(wallB.coreW, 1);
      assert.equal(wallB.coreH, 1);
      assert.ok(Math.abs(mod(wall.x) - TILE_SIZE_F / 2) < 1e-4);

      const keep = snapFloat('__keep', 8.9, 8.1);
      const keepB = buildingFootprintBounds('__keep', keep.xFixed, keep.zFixed);
      assert.equal(keepB.coreW, 6);
      assert.equal(keepB.coreH, 6);
      assert.ok(mod(keep.x) < 1e-4);
      assert.ok(mod(keep.z) < 1e-4);
      // Six tiles centered on the intersection: indices i-3 .. i+2.
      assert.equal(keepB.coreX0 + keepB.coreW / 2, keepB.coreX0 + 3);
      assert.equal(keepB.coreZ0 + keepB.coreH / 2, keepB.coreZ0 + 3);
    } finally {
      delete BUILDING_FOOTPRINTS.__wall;
      delete BUILDING_FOOTPRINTS.__keep;
    }
  });
});

describe('getBuildingDisplayName', () => {
  it('names agora and placeables, and falls back to the type id', () => {
    assert.equal(getBuildingDisplayName('agora'), 'Agora');
    assert.equal(getBuildingDisplayName('moonwell'), 'Moon Well');
    assert.equal(getBuildingDisplayName('camp'), 'Camp');
    assert.equal(getBuildingDisplayName('unknown-keep'), 'unknown-keep');
  });
});

describe('building rally order', () => {
  it('only production buildings that train units can rally', () => {
    assert.equal(buildingCanRally('camp'), true);
    assert.equal(buildingCanRally('barracks'), true);
    assert.equal(buildingCanRally('lab'), false);
    assert.equal(buildingCanRally('moonwell'), false);
    assert.equal(buildingCanRally('agora'), false);
  });

  it('SET_RALLY stores attack-move and trains walk out on that order', () => {
    const w = createWorld(21);
    w.buildings = [];
    const field = buildField(21, { width: 64, height: 64 });
    const x = 32;
    const z = 32;
    clearClaim(field, 'camp', x, z);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'camp',
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      },
    ]);
    assert.equal(w.buildings.length, 1);
    const b = w.buildings[0];
    const rx = fx.fromFloat(fx.toFloat(b.x) + 16);
    const rz = fx.fromFloat(fx.toFloat(b.z) + 16);
    applyCommands(w, field, [
      {
        type: CMD.SET_RALLY,
        playerId: 0,
        buildingIndex: 0,
        tx: rx,
        ty: rz,
        order: ORDER.ATTACK_MOVE,
      },
    ]);
    assert.equal(w.buildings[0].hasRally, 1);
    assert.equal(w.buildings[0].rallyOrder, ORDER.ATTACK_MOVE);
    const ser = serializeBuildings(w.buildings);
    assert.equal(ser[0].rallyOrder, ORDER.ATTACK_MOVE);

    applyCommands(w, field, [
      {
        type: CMD.QUEUE_TRAIN,
        playerId: 0,
        buildingIndex: 0,
        unitKey: 'myco',
      },
    ]);
    for (let i = 0; i < TRAIN_TICKS + 2; i++) buildingProductionSystem(w, field);
    assert.ok(w.count >= 1);
    const spawned = w.count - 1;
    assert.equal(w.order[spawned], ORDER.ATTACK_MOVE);
  });

  it('SET_RALLY without order defaults to force-move', () => {
    const w = createWorld(22);
    w.buildings = [];
    const field = buildField(22, { width: 64, height: 64 });
    clearClaim(field, 'camp', 32, 32);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'camp',
        tx: fx.fromFloat(32),
        ty: fx.fromFloat(32),
      },
    ]);
    const b = w.buildings[0];
    applyCommands(w, field, [
      {
        type: CMD.SET_RALLY,
        playerId: 0,
        buildingIndex: 0,
        tx: fx.fromFloat(fx.toFloat(b.x) + 16),
        ty: fx.fromFloat(fx.toFloat(b.z) + 16),
      },
    ]);
    assert.equal(w.buildings[0].rallyOrder, ORDER.MOVE);
  });
});

describe('building production pause', () => {
  function placeCamp(w, field) {
    clearClaim(field, 'camp', 32, 32);
    applyCommands(w, field, [
      {
        type: CMD.PLACE_BUILDING,
        playerId: 0,
        buildingType: 'camp',
        tx: fx.fromFloat(32),
        ty: fx.fromFloat(32),
      },
    ]);
    applyCommands(w, field, [
      {
        type: CMD.QUEUE_TRAIN,
        playerId: 0,
        buildingIndex: 0,
        unitKey: 'myco',
      },
    ]);
  }

  it('PAUSE_TRAIN freezes progress until resumed', () => {
    const w = createWorld(23);
    w.buildings = [];
    const field = buildField(23, { width: 64, height: 64 });
    placeCamp(w, field);
    const before = w.count;
    applyCommands(w, field, [
      {
        type: CMD.PAUSE_TRAIN,
        playerId: 0,
        buildingIndex: 0,
        paused: 1,
      },
    ]);
    assert.equal(w.buildings[0].prodPaused, 1);
    assert.equal(serializeBuildings(w.buildings)[0].prodPaused, 1);
    for (let i = 0; i < TRAIN_TICKS + 4; i++) buildingProductionSystem(w, field);
    assert.equal(w.count, before);
    assert.ok((w.buildings[0].tracks?.[0]?.count | 0) >= 1);
    applyCommands(w, field, [
      {
        type: CMD.PAUSE_TRAIN,
        playerId: 0,
        buildingIndex: 0,
        paused: 0,
      },
    ]);
    assert.equal(w.buildings[0].prodPaused, 0);
    for (let i = 0; i < TRAIN_TICKS + 4; i++) buildingProductionSystem(w, field);
    assert.ok(w.count > before);
  });

  it('CANCEL_TRAIN clears a paused queue', () => {
    const w = createWorld(24);
    w.buildings = [];
    const field = buildField(24, { width: 64, height: 64 });
    placeCamp(w, field);
    applyCommands(w, field, [
      {
        type: CMD.PAUSE_TRAIN,
        playerId: 0,
        buildingIndex: 0,
        paused: 1,
      },
    ]);
    applyCommands(w, field, [
      { type: CMD.CANCEL_TRAIN, playerId: 0, buildingIndex: 0 },
    ]);
    assert.equal(w.buildings[0].tracks.length, 0);
    assert.equal(w.buildings[0].prodPaused, 0);
  });
});
