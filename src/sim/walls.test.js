import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildField, createField, findPath, TERRAIN } from './field.js';
import * as fx from './fixed.js';
import {
  DEFAULT_WALL_STYLE,
  DOOR_HEIGHT,
  DOOR_SPAN,
  GATE_HEIGHT,
  applyWallOccupancy,
  clampWallStyle,
  decodeWalls,
  encodeWalls,
  emptyWalls,
  nearestWallRun,
  normalizeWallRuns,
  openingHeight,
  placeWallOpening,
  removeNearestOpening,
  removeWallSection,
  sameWallCorner,
  snapWallCorner,
} from './walls.js';

describe('wall runs', () => {
  it('snaps ground hits to tile corners on the board', () => {
    const field = buildField(1, { width: 32, height: 32 });
    const mid = snapWallCorner(field, 0.2, -0.2);
    assert.equal(mid.x, 0);
    assert.equal(mid.z, 0);
    const edge = snapWallCorner(field, 1e6, -1e6);
    assert.equal(edge.x, 64);
    assert.equal(edge.z, -64);
    assert.equal(sameWallCorner(mid, { x: 0, z: 0 }), true);
  });

  it('drops stubs and a repeated closing corner', () => {
    const runs = normalizeWallRuns([
      { closed: true, points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }, { x: 0, z: 0 }] },
      { closed: false, points: [{ x: 0, z: 0 }] },
      { closed: false, points: [{ x: 1, z: 1 }, { x: 1.01, z: 1 }] },
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].closed, true);
    assert.equal(runs[0].points.length, 3);
  });

  it('clamps a wild style and finds the nearest run', () => {
    const style = clampWallStyle({ height: 100, thickness: 0, pier: -2 });
    assert.equal(style.height, 16);
    assert.equal(style.thickness, 0.4);
    assert.equal(style.pier, 0);
    assert.equal(style.merlonWidth, DEFAULT_WALL_STYLE.merlonWidth);
    const runs = [
      { closed: false, points: [{ x: 0, z: 0 }, { x: 12, z: 0 }] },
      { closed: false, points: [{ x: 0, z: 8 }, { x: 12, z: 8 }] },
    ];
    assert.equal(nearestWallRun(runs, 4, 1.2, 2.5), 0);
    assert.equal(nearestWallRun(runs, 4, 4, 2.5), -1);
  });

  it('roundtrips style and runs, and ignores junk', () => {
    const walls = emptyWalls();
    walls.style.height = 7.25;
    walls.runs = [
      { closed: true, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 12 }] },
    ];
    const packed = encodeWalls(walls);
    const back = decodeWalls(packed);
    assert.equal(back.style.height, 7.25);
    assert.equal(back.runs.length, 1);
    assert.equal(back.runs[0].closed, true);
    assert.deepEqual(back.runs[0].points[1], { x: 16, z: 0 });
    assert.equal(encodeWalls(emptyWalls()), null);
    const junk = decodeWalls({ s: ['nope'], r: [1, [0], null] });
    assert.equal(junk.runs.length, 0);
    assert.equal(junk.style.height, DEFAULT_WALL_STYLE.height);
  });

  it('roundtrips dungeon brick and a gate', () => {
    const walls = emptyWalls();
    walls.runs = [{
      kind: 'dungeon',
      closed: false,
      points: [{ x: 0, z: 0 }, { x: 16, z: 0 }],
      openings: [{ d: 8, gate: 1 }],
    }];
    const back = decodeWalls(encodeWalls(walls));
    assert.equal(back.runs[0].kind, 'dungeon');
    assert.equal(back.runs[0].openings.length, 1);
    assert.equal(back.runs[0].openings[0].gate, 1);
    assert.equal(back.runs[0].openings[0].open, 0);
    const opened = emptyWalls();
    opened.runs = [{
      closed: false,
      points: [{ x: 0, z: 0 }, { x: 8, z: 0 }],
      openings: [{ d: 4, gate: 0, open: 1 }],
    }];
    const again = decodeWalls(encodeWalls(opened));
    assert.equal(again.runs[0].openings[0].open, 1);
    assert.equal(again.runs[0].openings[0].gate, 0);
    assert.equal(back.runs[0].openings[0].span, 8);
  });

  it('stores a size on each run and sizes openings to that curtain', () => {
    const walls = emptyWalls();
    walls.runs = [
      { size: 'small', points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 16, z: 0 }] },
      { size: 'large', points: [{ x: 0, z: 12 }, { x: 16, z: 12 }] },
    ];
    const back = decodeWalls(encodeWalls(walls));
    assert.equal(back.runs[0].size, 'small');
    assert.equal(back.runs[0].style.height, 5);
    assert.equal(back.runs[0].style.thickness, 1.5);
    assert.equal(back.runs[0].style.footing, 0.2);
    assert.equal(back.runs[0].style.merlonHeight, 0);
    assert.equal(back.runs[0].style.pier, 0);
    assert.equal(back.runs[1].size, 'large');
    assert.equal(back.runs[1].style.height, 16);
    assert.equal(back.runs[1].style.thickness, 3);
    assert.equal(back.runs[1].style.merlonHeight, 3);
    assert.equal(openingHeight(false, back.runs[0].style.height), 5);
    assert.equal(openingHeight(true, back.runs[0].style.height), 5);
    assert.equal(openingHeight(false, DEFAULT_WALL_STYLE.height), DOOR_HEIGHT);
    assert.equal(openingHeight(true, DEFAULT_WALL_STYLE.height), GATE_HEIGHT);
    assert.ok(openingHeight(false, 16) > DOOR_HEIGHT);
    assert.ok(openingHeight(true, 16) > GATE_HEIGHT);
    assert.ok(openingHeight(true, 16) < 16);
    assert.equal(removeWallSection(back.runs, 4, 0), true);
    assert.equal(back.runs[0].size, 'small');
    assert.equal(back.runs[0].style.height, 5);
    const legacy = decodeWalls({ s: [7.25, 1.2, 1, 0.8, 0.6, 0.2, 0.5], r: [[0, 0, 0, 16, 0]] });
    assert.equal(legacy.runs[0].size, undefined);
    assert.equal(legacy.style.height, 7.25);
    assert.equal(openingHeight(false, legacy.style.height), DOOR_HEIGHT);
  });
});

function openField() {
  const field = createField(1, { width: 16, height: 16 });
  field.pass.fill(1);
  field.activeMask.fill(1);
  field.terrainTypes.fill(TERRAIN.GRASS);
  field.tileType.fill(0);
  return field;
}

function passAt(field, tx, tz) {
  return field.pass[tz * field.width + tx];
}

describe('wall occupancy', () => {
  const run = { closed: false, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }] };

  it('blocks both tiles that share the wall edge', () => {
    const field = openField();
    applyWallOccupancy(field, { style: DEFAULT_WALL_STYLE, runs: [run] });
    assert.equal(passAt(field, 9, 7), 0);
    assert.equal(passAt(field, 9, 8), 0);
    assert.equal(passAt(field, 2, 2), 1);
  });

  it('leaves an open door passable and a shut door blocked', () => {
    const open = openField();
    applyWallOccupancy(open, {
      style: DEFAULT_WALL_STYLE,
      runs: [{ ...run, openings: [{ d: 6, span: DOOR_SPAN, gate: 0, open: 1 }] }],
    });
    assert.equal(passAt(open, 9, 7), 1, 'south side of the open door');
    assert.equal(passAt(open, 9, 8), 1, 'north side of the open door');
    assert.equal(passAt(open, 10, 7), 0);
    assert.equal(passAt(open, 10, 8), 0);

    const shut = openField();
    applyWallOccupancy(shut, {
      style: DEFAULT_WALL_STYLE,
      runs: [{ ...run, openings: [{ d: 6, span: DOOR_SPAN, gate: 0, open: 0 }] }],
    });
    assert.equal(passAt(shut, 9, 7), 0);
    assert.equal(passAt(shut, 9, 8), 0);
  });

  it('opens both tiles of an open gate and none of a shut gate', () => {
    const open = openField();
    applyWallOccupancy(open, {
      style: DEFAULT_WALL_STYLE,
      runs: [{ ...run, openings: [{ d: 8, span: 8, gate: 1, open: 1 }] }],
    });
    assert.equal(passAt(open, 9, 7), 1);
    assert.equal(passAt(open, 9, 8), 1);
    assert.equal(passAt(open, 10, 7), 1);
    assert.equal(passAt(open, 10, 8), 1);
    assert.equal(passAt(open, 8, 7), 0);
    assert.equal(passAt(open, 11, 8), 0);

    const shut = openField();
    applyWallOccupancy(shut, {
      style: DEFAULT_WALL_STYLE,
      runs: [{ ...run, openings: [{ d: 8, span: 8, gate: 1, open: 0 }] }],
    });
    assert.equal(passAt(shut, 9, 7), 0);
    assert.equal(passAt(shut, 9, 8), 0);
    assert.equal(passAt(shut, 10, 7), 0);
    assert.equal(passAt(shut, 10, 8), 0);
  });

  it('keeps a gate open through the corner tile and a shut gate sealed', () => {
    const square = [
      { x: -16, z: -16 },
      { x: 16, z: -16 },
      { x: 16, z: 16 },
      { x: -16, z: 16 },
    ];
    function court(openGate) {
      const field = createField(1, { width: 32, height: 32 });
      field.pass.fill(1);
      field.activeMask.fill(1);
      field.terrainTypes.fill(TERRAIN.GRASS);
      field.tileType.fill(0);
      const runs = [{ closed: true, points: square.map((p) => ({ ...p })) }];
      placeWallOpening(runs, 12, -16, true, 8, openGate);
      applyWallOccupancy(field, { runs });
      return field;
    }
    const opened = court(true);
    assert.equal(passAt(opened, 18, 11), 1);
    assert.equal(passAt(opened, 18, 12), 1);
    assert.equal(passAt(opened, 19, 11), 1, 'corner tile of the gate');
    assert.equal(passAt(opened, 19, 12), 1, 'corner tile of the gate');
    assert.equal(passAt(opened, 20, 12), 0, 'return wall stays shut');
    const wx = new Int32Array(32);
    const wy = new Int32Array(32);
    assert.ok(findPath(
      opened,
      fx.fromFloat(12),
      fx.fromFloat(-24),
      fx.fromFloat(12),
      fx.fromFloat(-8),
      wx,
      wy,
      32,
    ) > 0);

    const shut = court(false);
    assert.equal(passAt(shut, 18, 11), 0);
    assert.equal(passAt(shut, 19, 12), 0);
    assert.equal(findPath(
      shut,
      fx.fromFloat(0),
      fx.fromFloat(-24),
      fx.fromFloat(0),
      fx.fromFloat(-8),
      wx,
      wy,
      32,
    ), 0);
  });

  it('releases a deleted wall without reopening solid water', () => {
    const field = openField();
    applyWallOccupancy(field, { style: DEFAULT_WALL_STYLE, runs: [run] });
    const wet = 8 * field.width + 10;
    field.terrainTypes[wet] = TERRAIN.WATER;
    field.tileType[wet] = 12;
    field.pass[wet] = 0;
    field.wallBlock[wet] = 1;
    applyWallOccupancy(field, { style: DEFAULT_WALL_STYLE, runs: [] });
    assert.equal(passAt(field, 9, 7), 1);
    assert.equal(field.pass[wet], 0);
  });

  it('snaps a click to a door slot and can remove it', () => {
    const runs = [{ closed: false, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }] }];
    assert.equal(placeWallOpening(runs, 6.2, 0.4, false), true);
    assert.equal(runs[0].openings[0].d, 6);
    const nearStart = [{ closed: false, points: [{ x: 0, z: 0 }, { x: 16, z: 0 }] }];
    assert.equal(placeWallOpening(nearStart, 1, 0.2, false), true);
    assert.equal(nearStart[0].openings[0].d, 2);
    const oneTile = [{ closed: false, points: [{ x: 0, z: 0 }, { x: 4, z: 0 }] }];
    assert.equal(placeWallOpening(oneTile, 2, 0.2, false), true);
    assert.equal(placeWallOpening(oneTile, 2, 0.2, false), false);
    assert.equal(removeNearestOpening(runs, 6, 0.2), true);
    assert.equal(runs[0].openings.length, 0);
  });

  it('cuts a gate across collinear tile steps, and from beside the wall', () => {
    const runs = [{
      closed: false,
      points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 8, z: 0 }, { x: 12, z: 0 }],
    }];
    assert.equal(placeWallOpening(runs, 6, 5, true), true);
    assert.equal(runs[0].openings[0].gate, 1);
    assert.equal(runs[0].openings[0].d, 4);
    assert.equal(placeWallOpening(runs, 6, 40, true), false);
  });

  it('removes one section and opens a closed run at that side', () => {
    const line = [{
      closed: false,
      kind: 'dungeon',
      points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }, { x: 16, z: 8 }],
      openings: [{ d: 2, gate: 0 }, { d: 20, gate: 0, open: 1 }],
    }];
    assert.equal(removeWallSection(line, 8, 4), true);
    assert.equal(line.length, 2);
    assert.deepEqual(line[0].points, [{ x: 0, z: 0 }, { x: 8, z: 0 }]);
    assert.deepEqual(line[1].points, [{ x: 8, z: 8 }, { x: 16, z: 8 }]);
    assert.equal(line[0].openings[0].d, 2);
    assert.equal(line[1].openings[0].d, 4);
    assert.equal(line[1].openings[0].open, 1);
    assert.equal(line[0].kind, 'dungeon');

    const keep = [{
      closed: true,
      points: [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 8 }, { x: 0, z: 8 }],
      openings: [{ d: 2, gate: 0 }, { d: 10, gate: 1 }],
    }];
    assert.equal(removeWallSection(keep, 4, 0.2), true);
    assert.equal(keep.length, 1);
    assert.equal(keep[0].closed, false);
    assert.deepEqual(keep[0].points[0], { x: 8, z: 0 });
    assert.deepEqual(keep[0].points[3], { x: 0, z: 0 });
    assert.equal(keep[0].openings.length, 1);
    assert.equal(keep[0].openings[0].d, 2);
    assert.equal(keep[0].openings[0].gate, 1);
  });
});
