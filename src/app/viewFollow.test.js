import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFollowMode,
  createCameraGlide,
  createViewFollow,
  packView,
  replayFollowPlan,
  rosterStatusLabel,
  shouldSendView,
  unpackBuildings,
  unwrapView,
  viewChanged,
} from './viewFollow.js';

describe('view follow packets', () => {
  const sample = {
    from: 'ada',
    playerId: 1,
    pose: { x: 10.2, z: -3.1, radius: 80.2, alpha: 1.004 },
    units: [4, 9],
    buildings: [{ kind: 'agora', index: 0 }, { kind: 'building', index: 2 }],
    replay: { tick: 40, speed: 1 },
  };

  it('quantizes the camera and caps the payload', () => {
    const msg = packView(sample, 3);
    assert.equal(msg.x, 10.25);
    assert.equal(msg.z, -3);
    assert.equal(msg.r, 80);
    assert.equal(msg.a, 1);
    assert.deepEqual(msg.u, [4, 9]);
    assert.deepEqual(msg.b, [[1, 0], [0, 2]]);
    assert.equal(msg.rt, 40);
    assert.equal(msg.rs, 1);
    assert.equal(msg.n, 3);
    assert.deepEqual(unpackBuildings(msg.b), [
      { kind: 'agora', index: 0 },
      { kind: 'building', index: 2 },
    ]);
  });

  it('sends the first view, then only changes, and not faster than the cap', () => {
    const first = packView(sample, 1);
    const again = packView(sample, 2);
    const moved = packView({ ...sample, pose: { ...sample.pose, x: 30 } }, 3);
    assert.equal(viewChanged(null, first), true);
    assert.equal(viewChanged(first, again), false);
    assert.equal(shouldSendView(null, first, 1000, 0), true);
    assert.equal(shouldSendView(first, again, 1100, 1000), false);
    assert.equal(shouldSendView(first, moved, 1100, 1000), false);
    assert.equal(shouldSendView(first, moved, 1300, 1000), true);
  });

  it('unwraps a lobby content wrapper and ignores other traffic', () => {
    const msg = packView(sample, 1);
    assert.equal(unwrapView({ type: 'chat', text: 'hi' }), null);
    assert.equal(unwrapView({ type: 'view', content: msg }).from, 'ada');
    assert.equal(unwrapView({ type: 'view', content: JSON.stringify(msg) }).pid, 1);
  });
});

describe('replay follow plan', () => {
  it('matches speed while the tape is close and seeks when it is not', () => {
    assert.equal(replayFollowPlan({
      localTick: 100, remoteTick: 104, localSpeed: 0, remoteSpeed: 1,
    }).speed, 1);
    assert.equal(replayFollowPlan({
      localTick: 100, remoteTick: 104, localSpeed: 0, remoteSpeed: 1,
    }).seek, undefined);
    const scrub = replayFollowPlan({
      localTick: 100, remoteTick: 40, localSpeed: 1, remoteSpeed: 0,
    });
    assert.equal(scrub.seek, 40);
    assert.equal(scrub.speed, 0);
    assert.equal(replayFollowPlan({
      localTick: 100, remoteTick: 108, localSpeed: 1, remoteSpeed: 1, busy: true,
    }), null);
    assert.equal(replayFollowPlan({
      localTick: 100, remoteTick: 400, localSpeed: 1, remoteSpeed: 1, busy: true,
    }).seek, 400);
  });
});

describe('camera glide', () => {
  it('travels the pan between updates instead of cutting to each one', () => {
    const glide = createCameraGlide();
    const pose = (x, radius = 80, alpha = 0) => ({ x, z: 0, r: radius, a: alpha });
    assert.equal(glide.push(pose(0), 0).snap, true);
    assert.equal(glide.step(100).x, 0);

    assert.equal(glide.push(pose(10, 100, 0.4), 250), null);
    assert.ok(glide.step(250).x < 0.05);
    const mid = glide.step(375);
    assert.ok(Math.abs(mid.x - 5) < 0.05);
    assert.ok(Math.abs(mid.radius - 90) < 0.05);
    assert.ok(Math.abs(mid.alpha - 0.2) < 0.02);
    assert.ok(Math.abs(glide.step(500).x - 10) < 0.05);

    glide.push(pose(20), 500);
    let prev = glide.step(500).x;
    let maxStep = 0;
    for (let t = 516; t <= 740; t += 16) {
      const x = glide.step(t).x;
      assert.ok(x >= prev - 1e-6);
      maxStep = Math.max(maxStep, x - prev);
      prev = x;
    }
    assert.ok(maxStep < 1.2);
    assert.ok(prev > 18);
  });

  it('plays a late move across one cadence and cuts a map recall', () => {
    const glide = createCameraGlide();
    const pose = (x) => ({ x, z: 0, r: 80, a: 0 });
    glide.push(pose(0), 0);
    assert.equal(glide.push(pose(12), 1000), null);
    assert.ok(glide.step(1000).x < 0.05);
    assert.ok(Math.abs(glide.step(1125).x - 6) < 0.05);
    assert.ok(Math.abs(glide.step(1250).x - 12) < 0.05);

    const recall = glide.push(pose(400), 1500);
    assert.equal(recall.snap, true);
    assert.equal(glide.step(1500).x, 400);
  });

  it('takes the short way around a rotation', () => {
    const glide = createCameraGlide();
    glide.push({ x: 0, z: 0, r: 80, a: 3 }, 0);
    glide.push({ x: 0, z: 0, r: 80, a: -3 }, 250);
    const mid = glide.step(375).alpha;
    const turn = Math.PI * 2;
    const wrapped = Math.atan2(Math.sin(mid), Math.cos(mid));
    assert.ok(Math.abs(wrapped - Math.PI) < 0.15 || Math.abs(wrapped + Math.PI) < 0.15);
    assert.ok(Math.abs(mid) > 2);
    assert.ok(Math.abs(mid) < turn);
  });
});

describe('camera follow mode', () => {
  it('holds a tiny step, eases a pan, and snaps a jump', () => {
    const here = { x: 0, z: 0, radius: 80, alpha: 0 };
    assert.equal(cameraFollowMode(here, { x: 0.2, z: 0, radius: 80, alpha: 0 }), 'hold');
    assert.equal(cameraFollowMode(here, { x: 8, z: 0, radius: 80, alpha: 0 }), 'ease');
    assert.equal(cameraFollowMode(here, { x: 90, z: 0, radius: 80, alpha: 0 }), 'snap');
  });
});

describe('roster status', () => {
  it('prefers the replay mark over ready', () => {
    assert.equal(rosterStatusLabel({ replay: true, ready: true }), 'watching replay');
    assert.equal(rosterStatusLabel({ replay: true }), 'watching replay');
    assert.equal(rosterStatusLabel({ watching: true }), 'Watching');
    assert.equal(rosterStatusLabel({ ready: true }), 'Ready');
    assert.equal(rosterStatusLabel({ ready: true, lagging: true }), 'lagging');
    assert.equal(rosterStatusLabel({}), 'Not ready');
  });
});

describe('view follow session', () => {
  it('applies the followed player once and drops while publishing', () => {
    const applied = [];
    const sent = [];
    let owner = -1;
    const follow = createViewFollow({
      sample: () => ({
        from: 'me',
        playerId: 0,
        pose: { x: 1, z: 2, radius: 70, alpha: 0 },
      }),
      send: (msg) => sent.push(msg),
      shouldPublish: () => true,
      localUserId: () => 'me',
      localOwner: () => owner,
      applyCamera: (msg) => applied.push(msg.x),
      applySelection: () => applied.push('sel'),
    });
    follow.toggleOwner(1);
    follow.publish(1000);
    assert.equal(sent.length, 0);
    const packet = packView({
      from: 'ada',
      playerId: 1,
      pose: { x: 12, z: 0, radius: 70, alpha: 0 },
    }, 4);
    assert.equal(follow.receive(packet), true);
    assert.equal(follow.receive(packet), false);
    assert.deepEqual(applied, [12, 'sel']);
    follow.receive(packView({
      from: 'bea',
      playerId: 2,
      pose: { x: 0, z: 0, radius: 70, alpha: 0 },
    }, 1));
    assert.equal(applied.length, 2);
    follow.userSteered();
    assert.equal(follow.isFollowing(), false);
    follow.publish(1000);
    assert.equal(sent.length, 1);
    owner = 0;
    follow.toggleOwner(0);
    assert.equal(follow.isFollowing(), false);
  });

  it('enters follow for an owner and stays when that owner is pressed again', () => {
    let mine = -1;
    const follow = createViewFollow({
      sample: () => ({}),
      send: () => {},
      localOwner: () => mine,
    });
    follow.followOwner(2);
    assert.equal(follow.ownerTarget(), 2);
    follow.followOwner(2);
    assert.equal(follow.ownerTarget(), 2);
    follow.followOwner(0);
    assert.equal(follow.ownerTarget(), 0);
    mine = 1;
    follow.followOwner(1);
    assert.equal(follow.ownerTarget(), 0);
  });

  it('follows a replay viewer by user id, including the tape', () => {
    const tapes = [];
    const follow = createViewFollow({
      sample: () => ({}),
      send: () => {},
      localUserId: () => 'me',
      roomId: () => 'room',
      lobbyActive: () => true,
      applyReplay: (msg) => tapes.push(msg.rt),
    });
    follow.toggleUser('ada');
    const msg = packView({
      from: 'ada',
      playerId: 1,
      pose: { x: 0, z: 0, radius: 70, alpha: 0 },
      replay: { tick: 80, speed: 2 },
    }, 1);
    msg.roomId = 'room';
    assert.equal(follow.receive(msg), true);
    assert.deepEqual(tapes, [80]);
    follow.toggleUser('ada');
    assert.equal(follow.isFollowing(), false);
  });
});
