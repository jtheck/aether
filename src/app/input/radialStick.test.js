import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RADIAL_STICK_INNER,
  RADIAL_STICK_OUTER,
  angAbsDelta,
  nearestRadialSlice,
  radialStickPick,
  stickPolar,
} from './radialStick.js';

const agora = {
  inner: [
    { kind: 'category', id: 'basic', ang: -Math.PI / 2 },
    { kind: 'category', id: 'advanced', ang: -Math.PI / 2 + (Math.PI * 2) / 3 },
    { kind: 'category', id: 'elemental', ang: -Math.PI / 2 + (Math.PI * 4) / 3 },
  ],
  outer: [
    { kind: 'building', id: 'house', ang: -Math.PI / 2 },
    { kind: 'building', id: 'barracks', ang: -Math.PI / 2 + (Math.PI * 2) / 5 },
  ],
};

const action = {
  inner: [],
  outer: [
    { kind: 'unit', id: 'villager', ang: -Math.PI / 2 },
    { kind: 'pause', ang: Math.PI * 0.85 },
    { kind: 'cancel', ang: Math.PI * 0.15 },
  ],
};

describe('stickPolar', () => {
  it('matches radial layout: up is −π/2, right is π', () => {
    const up = stickPolar(0, -1, 0.1);
    assert.equal(up.live, true);
    assert.ok(angAbsDelta(up.ang, -Math.PI / 2) < 1e-6);
    const right = stickPolar(1, 0, 0.1);
    assert.ok(angAbsDelta(right.ang, Math.PI) < 1e-6);
    assert.equal(stickPolar(0.05, 0.05, 0.22).live, false);
  });
});

describe('nearestRadialSlice', () => {
  it('takes the closest angle', () => {
    const hit = nearestRadialSlice(-Math.PI / 2, agora.inner);
    assert.equal(hit.id, 'basic');
  });
});

describe('radialStickPick', () => {
  it('maps stick-right onto the clockwise / screen-right slice', () => {
    const half = RADIAL_STICK_INNER + 0.02;
    const pick = radialStickPick({ lx: half, ly: 0, rx: 0, ry: 0 }, agora);
    assert.equal(pick.kind, 'category');
    assert.equal(pick.id, 'elemental');
  });

  it('uses half throw for the agora inner pie and full throw for pads', () => {
    const half = RADIAL_STICK_INNER + 0.02;
    const inner = radialStickPick({ lx: 0, ly: -half, rx: 0, ry: 0 }, agora);
    assert.equal(inner.kind, 'category');
    assert.equal(inner.id, 'basic');

    const full = RADIAL_STICK_OUTER + 0.05;
    const outer = radialStickPick({ lx: 0, ly: -full, rx: 0, ry: 0 }, agora);
    assert.equal(outer.kind, 'building');
    assert.equal(outer.id, 'house');
  });

  it('lets the second stick at full throw take the outer ring', () => {
    const half = RADIAL_STICK_INNER + 0.02;
    const full = RADIAL_STICK_OUTER + 0.05;
    const pick = radialStickPick({ lx: 0, ly: -half, rx: 0, ry: -full }, agora);
    assert.equal(pick.kind, 'building');
    assert.equal(pick.id, 'house');
  });

  it('treats a one-ring menu as outer from half throw', () => {
    const half = RADIAL_STICK_INNER + 0.02;
    const pick = radialStickPick({ lx: 0, ly: -half, rx: 0, ry: 0 }, action);
    assert.equal(pick.kind, 'unit');
    assert.equal(pick.id, 'villager');
  });

  it('clears when both sticks are centered', () => {
    assert.equal(radialStickPick({ lx: 0, ly: 0, rx: 0, ry: 0 }, agora), null);
  });
});
