import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLAY_POSE_KEEP,
  applyReplayPose,
  captureReplayPose,
  presentReplayPose,
  replayReverseFill,
  trimReplayPoses,
} from './replayPose.js';

function viewsOf(count, px) {
  const header = new Int32Array(6);
  header[1] = count;
  header[5] = 1;
  const slot = (Ctor, values) => {
    const out = new Ctor(4);
    for (let i = 0; i < values.length; i++) out[i] = values[i];
    return out;
  };
  return {
    header,
    px: slot(Int32Array, px),
    py: slot(Int32Array, [0, 0]),
    faceX: slot(Int32Array, [0, 0]),
    faceY: slot(Int32Array, [65536, 65536]),
    hp: slot(Int32Array, [10, 4]),
    carriedBy: slot(Int32Array, [-1, -1]),
    carriedAmt: slot(Int32Array, [0, 0]),
    shieldHp: slot(Int16Array, [0, 0]),
    frostTicks: slot(Int16Array, [0, 0]),
    dotTicks: slot(Int16Array, [0, 0]),
    locustStacks: slot(Int16Array, [0, 0]),
    mana: slot(Int16Array, [0, 0]),
    alive: slot(Uint8Array, [1, 1]),
    owner: slot(Uint8Array, [0, 1]),
    type: slot(Uint8Array, [2, 3]),
    order: slot(Uint8Array, [0, 1]),
    carriedKind: slot(Uint8Array, [0, 0]),
    gatherAct: slot(Uint8Array, [0, 0]),
    projectiles: {
      get highWater() { return header[5]; },
      get activeCount() { return header[3]; },
      px: slot(Int32Array, [32768]),
      py: slot(Int32Array, [65536]),
      vx: slot(Int32Array, [1000]),
      vy: slot(Int32Array, [0]),
      generation: slot(Uint32Array, [7]),
      age: slot(Uint16Array, [3]),
      lifetime: slot(Uint16Array, [20]),
      alive: slot(Uint8Array, [1]),
      type: slot(Uint8Array, [1]),
      owner: slot(Uint8Array, [0]),
      despawnReason: slot(Uint8Array, [0]),
    },
  };
}

describe('replay poses', () => {
  it('round-trips the live prefix back onto the shared view', () => {
    const views = viewsOf(2, [65536, 131072]);
    const pose = captureReplayPose(views, 40);
    assert.equal(pose.count, 2);
    assert.equal(pose.tick, 40);
    assert.equal(pose.x[0], 1);
    assert.equal(pose.x[1], 2);
    assert.equal(pose.projectiles.highWater, 1);
    views.header[1] = 0;
    views.px[0] = 0;
    views.alive[1] = 0;
    views.projectiles.px[0] = 0;
    applyReplayPose(views, pose);
    assert.equal(views.header[1], 2);
    assert.equal(views.header[2], 40);
    assert.equal(views.px[0], 65536);
    assert.equal(views.alive[1], 1);
    assert.equal(views.projectiles.px[0], 32768);
  });

  it('presents a fractional tick from the tape', () => {
    const views = viewsOf(1, [65536]);
    views.header[5] = 0;
    const poses = new Map([
      [10, captureReplayPose(views, 10)],
    ]);
    views.px[0] = 0;
    const session = {
      client: { views },
      snapshots: new Map(),
      projectileSnapshots: new Map(),
      _replayPoseSample: null,
    };
    assert.equal(presentReplayPose(session, 10, poses), true);
    assert.equal(session._replayPoseSample.tick, 10);
    assert.equal(session._replayPoseSample.alpha, 1);
    assert.equal(session.replayClockTick, 10);
    assert.equal(session.snapshots.get(10).x[0], 1);
    assert.equal(views.px[0], 65536);
  });

  it('keeps the poses nearest the anchor', () => {
    const poses = new Map();
    for (let tick = 0; tick <= 10; tick++) poses.set(tick, { tick });
    trimReplayPoses(poses, 4, 10);
    assert.deepEqual([...poses.keys()], [7, 8, 9, 10]);
    const mid = new Map();
    for (let tick = 0; tick <= 10; tick++) mid.set(tick, { tick });
    trimReplayPoses(mid, 4, 5);
    assert.deepEqual([...mid.keys()], [3, 4, 5, 6]);
  });

  it('plans a reverse fill from the nearest checkpoint', () => {
    assert.equal(REPLAY_POSE_KEEP, 200);
    assert.equal(replayReverseFill(100, 150, [50], 200), null);
    assert.deepEqual(
      replayReverseFill(null, 5000, [4800, 5000], 200),
      { from: 4800, to: 5000, keepFrom: 4800 },
    );
    assert.deepEqual(
      replayReverseFill(4800, 4790, [4600, 4800], 200),
      { from: 4600, to: 4790, keepFrom: 4600 },
    );
    assert.deepEqual(
      replayReverseFill(null, 50, [], 200),
      { from: 0, to: 50, keepFrom: 0 },
    );
    assert.deepEqual(replayReverseFill(8, 0, [], 200), { from: 0, to: 0, keepFrom: 0 });
    assert.equal(replayReverseFill(0, 0, [], 200), null);
  });
});
