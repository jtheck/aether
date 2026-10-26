import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BALLOON_MS,
  DEATH_KIND,
  DEATH_SHRINK_MS,
  FLEE_MS,
  deathDurationMs,
  deathKindForType,
  sampleBalloon,
  sampleFlee,
} from './deathBehavior.js';
import { UNIT } from '../sim/unitTypes.js';

function angle(ax, az, bx, bz) {
  const al = Math.hypot(ax, az);
  const bl = Math.hypot(bx, bz);
  const c = (ax * bx + az * bz) / (al * bl);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

describe('death behavior', () => {
  it('picks a balloon for dirigibles and a sprint for villagers and brigands', () => {
    assert.equal(deathKindForType(UNIT.DIRIGIBLE), DEATH_KIND.BALLOON);
    assert.equal(deathKindForType(UNIT.VILLAGER), DEATH_KIND.FLEE);
    assert.equal(deathKindForType(UNIT.BRIGAND), DEATH_KIND.FLEE);
    assert.equal(deathKindForType(UNIT.WARRIOR), DEATH_KIND.SHRINK);
    assert.equal(deathDurationMs(DEATH_KIND.BALLOON), BALLOON_MS);
    assert.equal(deathDurationMs(DEATH_KIND.FLEE), FLEE_MS);
    assert.equal(deathDurationMs(DEATH_KIND.SHRINK), DEATH_SHRINK_MS);
  });

  it('shoots a dirigible off on a kinked path, then up, then fades', () => {
    for (const seed of [1, 2, 7, 99]) {
      const origin = sampleBalloon(0, seed);
      assert.equal(origin.x, 0);
      assert.equal(origin.y, 0);
      assert.equal(origin.z, 0);
      assert.equal(origin.alpha, 1);

      const shot = sampleBalloon(0.10, seed);
      const shotH = Math.hypot(shot.x, shot.z);
      assert.ok(shotH > 100, `seed ${seed} early travel ${shotH}`);
      assert.ok(shotH > shot.y * 2, `seed ${seed} early climb`);

      const mid = sampleBalloon(0.22, seed);
      const turn = angle(shot.x, shot.z, mid.x - shot.x, mid.z - shot.z);
      assert.ok(turn > 0.8, `seed ${seed} turn ${turn}`);

      const beforeSky = sampleBalloon(0.64, seed);
      const sky = sampleBalloon(0.88, seed);
      const rise = sky.y - beforeSky.y;
      const drift = Math.hypot(sky.x - beforeSky.x, sky.z - beforeSky.z);
      assert.ok(rise > 150, `seed ${seed} sky rise ${rise}`);
      assert.ok(rise > drift * 3, `seed ${seed} sky vs drift ${rise} ${drift}`);
      assert.equal(sky.alpha, 1);

      assert.ok(sampleBalloon(0.5, seed).y > -0.01);
      assert.ok(sampleBalloon(0.97, seed).alpha < 0.5);
      assert.equal(sampleBalloon(1, seed).alpha, 0);
      assert.equal(sampleBalloon(1, seed).scale, 0);
    }
  });

  it('bolts villagers off the map at a steady run', () => {
    const early = sampleFlee(0.2, -1, 0);
    assert.ok(early.x < -140);
    assert.ok(Math.abs(early.z) < 1e-6);
    assert.equal(early.alpha, 1);
    assert.equal(early.moving, true);
    assert.equal(early.yaw, Math.atan2(-1, 0));

    const a = sampleFlee(0.4, 0, 1);
    const b = sampleFlee(0.8, 0, 1);
    const first = a.z;
    const second = b.z - a.z;
    assert.ok(Math.abs(first - second) / first < 0.15, `speed dipped ${first} then ${second}`);
    assert.ok(b.z > 600);

    const gone = sampleFlee(1, 0, 1);
    assert.equal(gone.alpha, 0);
    assert.equal(gone.scale, 0);
    assert.ok(gone.z > 800);
  });
});
