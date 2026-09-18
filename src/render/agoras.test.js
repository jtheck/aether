import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGORA_FLAG_DISINTEGRATE,
  AGORA_FLAG_DISINTEGRATE_MS,
  AGORA_FLAG_GONE,
  AGORA_FLAG_PLANTED,
  AGORA_FLAG_SLAM,
  AGORA_FLAG_SLAM_DROP_MS,
  AGORA_FLAG_SLAM_HEIGHT,
  AGORA_FLAG_SLAM_RING,
  AGORA_FLAG_SLAM_TOTAL_MS,
  agoraFlagDisintegratePose,
  agoraFlagDrawPose,
  agoraFlagSlamPose,
  emitAgoraFlagDisintegrate,
  emitAgoraFlagSlam,
  stepAgoraFlagAct,
} from './agoras.js';
import { AGORA_PHASE_LOCK, AGORA_PHASE_TUG, AGORA_RITE_FINALE, AGORA_RITE_UNLOCK } from '../sim/agora.js';

describe('agora ownership flags', () => {
  it('plants quietly on first sight of a locked pad', () => {
    const act = stepAgoraFlagAct(null, { phase: AGORA_PHASE_LOCK, owner: 0 }, 0);
    assert.equal(act.mode, AGORA_FLAG_PLANTED);
    assert.equal(act.owner, 0);
    assert.equal(act.fx, null);
    assert.equal(agoraFlagDrawPose(act, 0).visible, true);
  });

  it('tears the flag up when the pad goes neutral', () => {
    const planted = stepAgoraFlagAct(null, { phase: AGORA_PHASE_LOCK, owner: 2 }, 0);
    const next = stepAgoraFlagAct(planted, {
      phase: AGORA_PHASE_TUG,
      owner: 2,
      rite: AGORA_RITE_UNLOCK,
    }, 40);
    assert.equal(next.mode, AGORA_FLAG_DISINTEGRATE);
    assert.equal(next.owner, 2);
    assert.equal(next.fx, 'disintegrate');
    assert.ok(next.wind);
    const sail = agoraFlagDrawPose(next, 40);
    assert.equal(sail.visible, true);
    assert.ok(sail.y > 0);
    const gone = stepAgoraFlagAct(next, {
      phase: AGORA_PHASE_TUG,
      owner: 2,
      rite: 0,
    }, 40 + AGORA_FLAG_DISINTEGRATE_MS);
    assert.equal(gone.mode, AGORA_FLAG_GONE);
    assert.equal(gone.fx, null);
  });

  it('slams the capturer flag when the finale starts', () => {
    const gone = { mode: AGORA_FLAG_GONE, owner: -1, t0: 0, impact: false, fx: null };
    const slam = stepAgoraFlagAct(gone, {
      phase: AGORA_PHASE_TUG,
      owner: 0,
      capturer: 1,
      rite: AGORA_RITE_FINALE,
    }, 100);
    assert.equal(slam.mode, AGORA_FLAG_SLAM);
    assert.equal(slam.owner, 1);
    assert.equal(slam.fx, 'slam');
    const mid = agoraFlagDrawPose(slam, 100 + AGORA_FLAG_SLAM_DROP_MS * 0.4);
    assert.equal(mid.visible, true);
    assert.ok(mid.y > 2);
    const planted = stepAgoraFlagAct(slam, {
      phase: AGORA_PHASE_LOCK,
      owner: 1,
      rite: 0,
    }, 100 + AGORA_FLAG_SLAM_TOTAL_MS);
    assert.equal(planted.mode, AGORA_FLAG_PLANTED);
    assert.equal(planted.owner, 1);
  });

  it('does not restart a slam that already landed during the finale', () => {
    const planted = {
      mode: AGORA_FLAG_PLANTED,
      owner: 1,
      t0: 0,
      impact: true,
      fx: null,
    };
    const stay = stepAgoraFlagAct(planted, {
      phase: AGORA_PHASE_TUG,
      owner: 0,
      capturer: 1,
      rite: AGORA_RITE_FINALE,
    }, 800);
    assert.equal(stay.mode, AGORA_FLAG_PLANTED);
    assert.equal(stay.fx, null);
  });

  it('stops on the deck instead of squashing through it', () => {
    const start = agoraFlagSlamPose(0);
    assert.ok(start.y > AGORA_FLAG_SLAM_HEIGHT * 0.9);
    assert.equal(start.hit, false);
    const hit = agoraFlagSlamPose((AGORA_FLAG_SLAM_DROP_MS + 12) / AGORA_FLAG_SLAM_TOTAL_MS);
    assert.equal(hit.y, 0);
    assert.equal(hit.hit, true);
    assert.ok(hit.sy > 0.9);
    assert.ok(Math.abs(hit.sx - 1) < 0.08);
    const rest = agoraFlagSlamPose(1);
    assert.equal(rest.y, 0);
    assert.equal(rest.sx, 1);
    assert.equal(rest.sy, 1);
  });

  it('sails the lost flag on a breeze instead of dropping it', () => {
    const wind = { x: 6, y: 2, z: 1 };
    const mid = agoraFlagDisintegratePose(0.45, wind);
    assert.equal(mid.visible, true);
    assert.ok(mid.y > 3);
    assert.ok(mid.x > 2);
    assert.ok(mid.y > 0);
    const end = agoraFlagDisintegratePose(1, wind);
    assert.equal(end.visible, false);
    const vys = [];
    const vxs = [];
    const n = emitAgoraFlagDisintegrate((p) => {
      vys.push(p.velocity[1]);
      vxs.push(p.velocity[0]);
      assert.ok(p.position[1] > 2);
    }, 0, 1, 0, [0.2, 0.4, 0.9], 2.2, wind);
    assert.equal(n, 16);
    assert.ok(vys.every((vy) => vy > 1));
    assert.ok(vxs.every((vx) => vx > 2));
    assert.equal(emitAgoraFlagDisintegrate(null, 0, 0, 0, [1, 1, 1]), 0);
    const ring = [];
    emitAgoraFlagSlam((p) => ring.push(p), null, 0, 0, 0);
    assert.ok(ring.length >= AGORA_FLAG_SLAM_RING);
    assert.ok(ring.some((p) => p.sprite === 'puff'));
    assert.ok(ring.every((p) => Math.hypot(p.velocity[0], p.velocity[2]) > p.velocity[1] * 6));
  });
});
