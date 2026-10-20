import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitFallingFrost } from './frostFx.js';

function capture(kind, motion) {
  const spawned = [];
  let n = 0;
  const rng = () => {
    n = (n * 17 + 3) % 1000;
    return n / 1000;
  };
  emitFallingFrost((init) => spawned.push(init), 10, 4, -3, kind, motion, rng);
  return spawned;
}

function side(size) {
  return Array.isArray(size) ? size : [size, size];
}

function assertFalls(spawned, label) {
  assert.ok(spawned.length >= 3, `${label} sheds several stars`);
  for (const p of spawned) {
    assert.equal(p.shape, 'star', `${label} uses the staff star`);
    assert.equal(p.blend, 'alpha');
    const [w, h] = side(p.startSize);
    assert.ok(Math.abs(w - h) < 1e-4, `${label} star stays square`);
    const [r, g, b] = p.color;
    assert.ok(b >= 0.9 && b >= g && g + 0.02 >= r, `${label} stays white or ice-blue`);
    assert.ok(p.velocity[1] < 0, `${label} star starts downward`);
    assert.ok(p.gravity[1] < 0, `${label} star keeps falling`);
  }
}

describe('falling frost', () => {
  it('sheds downward off an ice bolt', () => {
    const spawned = capture('bolt', { vx: 5.5, vz: 0 });
    assertFalls(spawned, 'bolt');
    for (const p of spawned) {
      assert.ok(p.velocity[0] < 0, 'flakes trail behind the shot');
    }
  });

  it('rains frost down over a slowed unit', () => {
    const spawned = capture('chill');
    assertFalls(spawned, 'chill');
    const above = spawned.filter((p) => p.position[1] > 4);
    const through = spawned.filter((p) => p.position[1] < 4);
    assert.ok(above.length > 0, 'some flakes start above the unit');
    assert.ok(through.length > 0, 'some flakes start across the body');
  });
});
