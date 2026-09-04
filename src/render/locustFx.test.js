import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLocustFx, LOCUST_FX_INSECTS, LOCUST_FX_MAX_INSECTS, LOCUST_FX_REMNANT } from './locustFx.js';

function makeFx() {
  let emits = 0;
  const fx = createLocustFx(() => {
    emits++;
  });
  return {
    fx,
    emits: () => emits,
  };
}

function land(fx, keys) {
  fx.beginDots();
  for (const row of keys) fx.sustain(row[0], row[1], row[2], row[3], row[4] ?? 1);
  fx.endDots();
}

function insectsOn(snap, key) {
  return snap.packs.find((p) => p.key === key)?.insects ?? 0;
}

describe('locustFx hop', () => {
  it('does not grow a pack when stacks increase', () => {
    const { fx } = makeFx();
    land(fx, [['u:0', 0, 2, 0, 1]]);
    assert.equal(fx.snapshot().insects, LOCUST_FX_INSECTS);
    land(fx, [['u:0', 0, 2, 0, 3]]);
    const snap = fx.snapshot();
    assert.equal(snap.packs.length, 1);
    assert.equal(snap.insects, LOCUST_FX_INSECTS);
  });

  it('peels the same insects forward instead of cloning a second swarm', () => {
    const { fx } = makeFx();
    land(fx, [['u:0', 0, 2, 0, 1]]);
    land(fx, [
      ['u:0', 0, 2, 0, 1],
      ['u:1', 8, 2, 0, 1],
    ]);
    const snap = fx.snapshot();
    assert.equal(snap.insects, LOCUST_FX_INSECTS, 'swarm is conserved');
    assert.equal(insectsOn(snap, 'u:0'), LOCUST_FX_REMNANT);
    assert.equal(insectsOn(snap, 'u:1'), LOCUST_FX_INSECTS - LOCUST_FX_REMNANT);
  });

  it('splits one incoming shot across same-frame hop sites and drains the handoff', () => {
    const { fx } = makeFx();
    fx.beginFrame();
    fx.track(0, 1, 0, 2, 0, 1, 0);
    fx.endFrame();
    fx.beginFrame();
    fx.endFrame();
    assert.equal(fx.snapshot().handoff, 1);

    land(fx, [
      ['u:0', 2, 2, 0, 1],
      ['u:1', 8, 2, 0, 1],
      ['u:2', 4, 2, 6, 1],
    ]);
    const snap = fx.snapshot();
    assert.equal(snap.handoff, 0, 'incoming insects transfer onto the chew sites');
    assert.equal(snap.packs.length, 3);
    assert.equal(snap.insects, LOCUST_FX_INSECTS);
  });

  it('clusters a first-seen blob instead of 8 insects on every victim', () => {
    const { fx } = makeFx();
    const keys = [];
    for (let i = 0; i < 8; i++) keys.push([`u:${i}`, i * 3, 2, 0, 1]);
    land(fx, keys);
    const snap = fx.snapshot();
    assert.equal(snap.packs.length, 8);
    assert.equal(snap.insects, LOCUST_FX_INSECTS);
    assert.ok(insectsOn(snap, 'u:0') <= LOCUST_FX_INSECTS);
  });

  it('caps insects so a wide first-seen field cannot fill the particle pool', () => {
    const { fx } = makeFx();
    const keys = [];
    for (let i = 0; i < 40; i++) keys.push([`u:${i}`, i * 40, 2, 0, 1]);
    land(fx, keys);
    assert.ok(fx.snapshot().insects <= LOCUST_FX_MAX_INSECTS);
  });

  it('skips emits far from the camera', () => {
    let emits = 0;
    const fx = createLocustFx(() => {
      emits++;
    }, { getEye: () => ({ x: 8000, y: 0, z: 8000 }) });
    land(fx, [['u:0', 0, 2, 0, 1]]);
    emits = 0;
    fx.update(80);
    assert.equal(emits, 0);
  });

  it('still emits when the camera is on the swarm', () => {
    let emits = 0;
    const fx = createLocustFx(() => {
      emits++;
    }, { getEye: () => ({ x: 0, y: 4, z: 0 }) });
    land(fx, [['u:0', 0, 2, 0, 1]]);
    emits = 0;
    fx.update(80);
    assert.ok(emits > 0);
  });
});
