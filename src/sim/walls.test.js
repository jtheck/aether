import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildField, createField, TERRAIN } from './field.js';
import {
  DEFAULT_WALL_STYLE,
  DOOR_SPAN,
  applyWallOccupancy,
  clampWallStyle,
  decodeWalls,
  encodeWalls,
  emptyWalls,
  nearestWallRun,
  normalizeWallRuns,
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

  it('leaves a door passable and keeps the next edge blocked', () => {
    const field = openField();
    const walls = { style: DEFAULT_WALL_STYLE, runs: [{ ...run, openings: [{ d: 6, span: DOOR_SPAN, gate: 0 }] }] };
    applyWallOccupancy(field, walls);
    assert.equal(passAt(field, 9, 7), 1, 'south side of the door');
    assert.equal(passAt(field, 9, 8), 1, 'north side of the door');
    assert.equal(passAt(field, 10, 7), 0);
    assert.equal(passAt(field, 10, 8), 0);
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
