import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { noteReplayCam, packReplayCams, replayCamPose } from './replayCam.js';

describe('replay cameras', () => {
  it('keeps a sample only when the pose changes', () => {
    const list = [];
    noteReplayCam(list, { tick: 10, pid: 0, x: 1.1, z: -2, radius: 80.2, alpha: 0 });
    noteReplayCam(list, { tick: 14, pid: 0, x: 1.1, z: -2, radius: 80.2, alpha: 0 });
    noteReplayCam(list, { tick: 20, pid: 0, x: 8, z: -2, radius: 80, alpha: 0 });
    noteReplayCam(list, { tick: 12, pid: 1, x: 40, z: 4, radius: 70, alpha: 1 });
    assert.equal(list.length, 3);
    assert.deepEqual(packReplayCams(list), [
      [10, 0, 1, -2, 80, 0],
      [12, 1, 40, 4, 70, 1],
      [20, 0, 8, -2, 80, 0],
    ]);
  });

  it('plays the saved pose and eases between samples', () => {
    const cams = [
      [0, 0, 0, 0, 80, 0],
      [10, 0, 10, 0, 80, 0],
      [0, 1, 50, 4, 60, 0],
    ];
    assert.equal(replayCamPose(cams, 0, -1), null);
    assert.deepEqual(replayCamPose(cams, 0, 0), { x: 0, z: 0, radius: 80, alpha: 0 });
    assert.deepEqual(replayCamPose(cams, 0, 5), { x: 5, z: 0, radius: 80, alpha: 0 });
    assert.deepEqual(replayCamPose(cams, 0, 40), { x: 10, z: 0, radius: 80, alpha: 0 });
    assert.deepEqual(replayCamPose(cams, 1, 3), { x: 50, z: 4, radius: 60, alpha: 0 });
    assert.equal(replayCamPose(cams, 2, 3), null);
  });
});
