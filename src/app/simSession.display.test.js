import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TICK_MS, displayPoseSample, stepDisplayTick } from './simSession.js';

describe('displayPoseSample', () => {
  it('sits on an integer tick at the end of that segment', () => {
    assert.deepEqual(displayPoseSample(0), { tick: 0, alpha: 1 });
    assert.deepEqual(displayPoseSample(10), { tick: 10, alpha: 1 });
    const mid = displayPoseSample(10.25);
    assert.equal(mid.tick, 11);
    assert.ok(Math.abs(mid.alpha - 0.25) < 1e-9);
  });
});

describe('stepDisplayTick', () => {
  it('keeps walking through an early snapshot instead of restarting', () => {
    // 144Hz frames. Tick gaps alternate around one sim step — the old clock
    // restarted alpha on each snapshot and popped forward on the short ones.
    const frame = 1000 / 144;
    let t = 0;
    let max = 0;
    let blend = TICK_MS;
    let live = false;
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      const gap = i % 2 === 0 ? 48.6 : 55.6;
      max += 1;
      if (!live) {
        blend = gap;
        live = true;
      } else {
        blend = blend * 0.65 + gap * 0.35;
      }
      let left = gap;
      while (left > 1e-6) {
        const dt = Math.min(frame, left);
        const next = stepDisplayTick(t, dt, blend, max);
        const jumped = next - prev;
        assert.ok(jumped >= -1e-9, `rewound ${prev} -> ${next}`);
        assert.ok(jumped <= dt / blend + 1e-6, `surged ${jumped} on a ${dt.toFixed(2)}ms frame`);
        prev = next;
        t = next;
        left -= dt;
      }
    }
    assert.ok(t > 30, `clock should keep up, got ${t}`);
  });

  it('drops a hitch instead of replaying the missed ticks', () => {
    assert.equal(stepDisplayTick(10, 16, TICK_MS, 14), 13);
  });

  it('holds on the newest snapshot instead of running past it', () => {
    assert.equal(stepDisplayTick(4.9, 16, TICK_MS, 5), 5);
  });
});
