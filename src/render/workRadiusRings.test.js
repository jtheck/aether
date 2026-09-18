import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RING_SEGMENTS,
  RESOURCE_RIM_RGB,
  RIM_WHITE,
  buildUnionLoops,
  circleIntersections,
  diskContains,
  groupDisksByRimKey,
  pointInsideOtherDisk,
  rimKeyForBuildingType,
  rimKeyForSpec,
  rimRgbForKey,
  ringSegmentOuterMid,
  ringSegmentVisible,
  sampleUnionLoop,
  sharedRimKey,
  visibleArcsOnDisk,
} from './workRadiusRings.js';

function countVisible(disks, selfIndex) {
  let n = 0;
  for (let i = 0; i < RING_SEGMENTS; i++) {
    if (ringSegmentVisible(disks[selfIndex], i, disks, selfIndex)) n++;
  }
  return n;
}

describe('work radius union clip', () => {
  it('keeps every segment of a lone disk', () => {
    const disks = [{ x: 0, z: 0, radius: 28 }];
    assert.equal(countVisible(disks, 0), RING_SEGMENTS);
  });

  it('keeps every segment when disks sit far apart', () => {
    const disks = [
      { x: 0, z: 0, radius: 10 },
      { x: 40, z: 0, radius: 10 },
    ];
    assert.equal(countVisible(disks, 0), RING_SEGMENTS);
    assert.equal(countVisible(disks, 1), RING_SEGMENTS);
  });

  it('hides the interior arc where two equal disks overlap', () => {
    const disks = [
      { x: 0, z: 0, radius: 10 },
      { x: 12, z: 0, radius: 10 },
    ];
    // Toward the partner (angle 0) sits inside the other disk.
    assert.equal(diskContains(10, 0, disks[1]), true);
    assert.equal(pointInsideOtherDisk(10, 0, disks, 0), true);
    // Far side stays outside.
    assert.equal(pointInsideOtherDisk(-10, 0, disks, 0), false);

    const left = countVisible(disks, 0);
    const right = countVisible(disks, 1);
    assert.ok(left < RING_SEGMENTS, `left hid interior segs (kept ${left})`);
    assert.ok(right < RING_SEGMENTS, `right hid interior segs (kept ${right})`);
    assert.ok(left > RING_SEGMENTS * 0.4, `left kept the outer envelope (${left})`);
    assert.equal(left, right);
  });

  it('drops a nested disk and leaves the outer rim whole', () => {
    const disks = [
      { x: 0, z: 0, radius: 20 },
      { x: 2, z: 0, radius: 6 },
    ];
    assert.equal(countVisible(disks, 1), 0, 'inner rim is entirely inside');
    assert.equal(countVisible(disks, 0), RING_SEGMENTS, 'outer rim is untouched');
  });

  it('tests the outer-arc midpoint, not the chord', () => {
    const disk = { x: 0, z: 0, radius: 10 };
    const mid = ringSegmentOuterMid(disk, 0);
    const dist = Math.hypot(mid.x - disk.x, mid.z - disk.z);
    assert.ok(Math.abs(dist - 10) < 1e-9);
  });
});

describe('work radius union loops', () => {
  it('finds the two crossings of equal overlapping disks', () => {
    const hits = circleIntersections(
      { x: 0, z: 0, radius: 10 },
      { x: 12, z: 0, radius: 10 },
    );
    assert.equal(hits.length, 2);
    const ys = hits.map((p) => p.z).sort((a, b) => a - b);
    assert.ok(Math.abs(hits[0].x - 6) < 1e-9);
    assert.ok(Math.abs(hits[1].x - 6) < 1e-9);
    assert.ok(Math.abs(ys[0] + 8) < 1e-9);
    assert.ok(Math.abs(ys[1] - 8) < 1e-9);
  });

  it('returns no crossings for separate or nested disks', () => {
    assert.equal(circleIntersections({ x: 0, z: 0, radius: 10 }, { x: 40, z: 0, radius: 10 }).length, 0);
    assert.equal(circleIntersections({ x: 0, z: 0, radius: 20 }, { x: 2, z: 0, radius: 6 }).length, 0);
  });

  it('chains two overlapping disks into one closed peanut', () => {
    const disks = [
      { x: 0, z: 0, radius: 10 },
      { x: 12, z: 0, radius: 10 },
    ];
    assert.equal(visibleArcsOnDisk(disks, 0).length, 1);
    assert.equal(visibleArcsOnDisk(disks, 1).length, 1);
    const loops = buildUnionLoops(disks);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].length, 2);
    const samples = sampleUnionLoop(loops[0], disks);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const join = Math.hypot(first.ox - last.ox, first.oz - last.oz);
    assert.ok(join < 1e-6, `loop ends meet (${join})`);
    assert.ok(samples.length > RING_SEGMENTS, 'both outer arcs are sampled');
  });

  it('keeps separate disks as two full loops', () => {
    const disks = [
      { x: 0, z: 0, radius: 10 },
      { x: 40, z: 0, radius: 10 },
    ];
    const loops = buildUnionLoops(disks);
    assert.equal(loops.length, 2);
    assert.equal(loops[0][0].closed, true);
    assert.equal(loops[1][0].closed, true);
  });

  it('drops a nested disk from the outline', () => {
    const disks = [
      { x: 0, z: 0, radius: 20 },
      { x: 2, z: 0, radius: 6 },
    ];
    const loops = buildUnionLoops(disks);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].length, 1);
    assert.equal(loops[0][0].diskIndex, 0);
    assert.equal(loops[0][0].closed, true);
  });
});

describe('work radius resource rims', () => {
  it('maps drop-off buildings to resource rim keys', () => {
    assert.equal(rimKeyForBuildingType('camp'), 'wood');
    assert.equal(rimKeyForBuildingType('mine'), 'stone');
    assert.equal(rimKeyForBuildingType('farm'), 'food');
    assert.equal(rimKeyForBuildingType('silo'), 'white');
    assert.equal(rimKeyForBuildingType('agora'), 'white');
  });

  it('resolves rim RGB for each resource and falls back to white', () => {
    assert.deepEqual(rimRgbForKey('wood'), RESOURCE_RIM_RGB.wood);
    assert.deepEqual(rimRgbForKey('food'), RESOURCE_RIM_RGB.food);
    assert.deepEqual(rimRgbForKey('white'), RIM_WHITE);
    assert.deepEqual(rimRgbForKey('nope'), RIM_WHITE);
    assert.equal(rimKeyForSpec({ rimKey: 'food' }), 'food');
    assert.equal(rimKeyForSpec({ kind: 'mineral' }), 'mineral');
    assert.equal(rimKeyForSpec({}), 'white');
  });

  it('groups mixed disks by rim so different resources do not union', () => {
    const disks = [
      { x: 0, z: 0, radius: 10, rimKey: 'wood' },
      { x: 12, z: 0, radius: 10, rimKey: 'food' },
    ];
    const groups = groupDisksByRimKey(disks);
    assert.equal(groups.get('wood')?.length, 1);
    assert.equal(groups.get('food')?.length, 1);
    assert.equal(buildUnionLoops(groups.get('wood')).length, 1);
    assert.equal(buildUnionLoops(groups.get('food')).length, 1);
    assert.equal(buildUnionLoops(disks).length, 1, 'ungrouped mixed disks would still merge');
  });

  it('sharedRimKey stays typed only when every source agrees', () => {
    assert.equal(sharedRimKey(['wood', 'wood']), 'wood');
    assert.equal(sharedRimKey(['food']), 'food');
    assert.equal(sharedRimKey(['wood', 'food']), 'white');
    assert.equal(sharedRimKey([]), 'white');
  });
});
