import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIREBALL_TRAIL_CULL,
  FLY_ARMS,
  FLY_BEADS,
  FLY_GAP,
  createFireballFx,
  fireballFlyArms,
} from './fireballFx.js';

describe('fireball fx cost', () => {
  it('samples the streak often enough to overlap', () => {
    assert.equal(fireballFlyArms(1), FLY_ARMS);
    assert.equal(fireballFlyArms(4), FLY_ARMS);
    assert.ok(FLY_GAP <= 0.016);
    assert.equal(FLY_BEADS, 1);
    const perSec = (FLY_ARMS * FLY_BEADS) / FLY_GAP;
    assert.ok(perSec < 200, `lone orb ${perSec.toFixed(0)}/s`);
    assert.ok(perSec > 80, `lone orb ${perSec.toFixed(0)}/s`);
  });

  it('thins a volley by dropping a bead, not by opening gaps', () => {
    assert.equal(fireballFlyArms(8), 1);
    assert.ok(fireballFlyArms(8) < fireballFlyArms(1));
  });

  it('keeps the trail past the spark cull cap', () => {
    /** @type {object[]} */
    const spawned = [];
    const fx = createFireballFx((init) => { spawned.push(init); });
    fx.track(1, 1, 0, 1, 0, 0.2, 0, 0.1, false);
    fx.update(16);
    assert.ok(spawned.length > 0);
    for (const puff of spawned) assert.equal(puff.cullMin, FIREBALL_TRAIL_CULL);
  });

  it('a flying orb emits hundreds of puffs a second, not a thousand', () => {
    let n = 0;
    const fx = createFireballFx(() => { n += 1; });
    fx.track(1, 1, 0, 1, 0, 0.2, 0, 0.1, false);
    for (let i = 0; i < 60; i++) fx.update(16);
    assert.ok(n < 400, `emitted ${n}`);
    assert.ok(n > 80, `emitted ${n}`);
  });

  it('eight orbs together stay under the cost of two old helixes', () => {
    let n = 0;
    const fx = createFireballFx(() => { n += 1; });
    for (let i = 0; i < 8; i++) {
      fx.track(i, 1, i, 1, 0, 0.2, 0, 0.1, false);
    }
    for (let frame = 0; frame < 60; frame++) fx.update(16);
    // Old body was 15 puffs every frame at 60fps: 8 * 15 * 60 = 7200.
    assert.ok(n < 1200, `volley emitted ${n}`);
    assert.ok(n > 200, `volley emitted ${n}`);
  });
});
