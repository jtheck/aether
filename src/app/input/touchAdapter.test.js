import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTouchAdapter, EDGE_ZONE_PX } from './touchAdapter.js';

function fakeCanvas(w = 800, h = 600) {
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
    },
  };
}

function makeHarness(hud = {}) {
  const rotates = [];
  const downs = [];
  const ups = [];
  const camera = {
    nudgeRotate(d) { rotates.push(d); },
    panByScreenDelta() {},
    getRadius: () => 80,
  };
  const game = {
    hitControlGroupHud: (x, y) => hud.ctrl?.(x, y) ?? false,
    hitSelectionHud: (x, y) => hud.sel?.(x, y) ?? false,
    isPlacing: () => false,
    hasBuildUi: () => false,
    handlePointerDown(e) { downs.push({ x: e.clientX, y: e.clientY }); },
    handlePointerUp(e) { ups.push({ x: e.clientX, y: e.clientY }); },
    handlePointerMove() {},
    cancelDrag() {},
    forceMoveAt() {},
    backOutBuildUi: () => false,
  };
  const touch = createTouchAdapter({ canvas: fakeCanvas(), camera, game });
  return { touch, rotates, downs, ups };
}

function ptr(partial) {
  return {
    pointerId: 1,
    pointerType: 'touch',
    type: 'pointerdown',
    ...partial,
  };
}

describe('touch edge band', () => {
  it('a still lift on the rim is a tap, not an orbit', () => {
    const { touch, rotates, downs, ups } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 18, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: 19, clientY: 301 }));
    assert.equal(rotates.length, 0);
    assert.equal(downs.length, 1);
    assert.equal(ups.length, 1);
  });

  it('a vertical drag on the left rim orbits', () => {
    const { touch, rotates, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 280 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 16, clientY: 220 }));
    assert.ok(rotates.length > 0);
    assert.ok(rotates.some((d) => d !== 0));
    assert.equal(downs.length, 0);
  });

  it('an inward drag from the left rim stays a play stroke', () => {
    const { touch, rotates, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 300 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 80, clientY: 300 }));
    assert.equal(rotates.length, 0);
    assert.ok(downs.length >= 1);
  });

  it('a stroke along the top near a corner still orbits', () => {
    const { touch, rotates, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 20, clientY: 18 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 90, clientY: 20 }));
    assert.ok(rotates.length > 0);
    assert.equal(downs.length, 0);
  });

  it('control-group pads are not the rim', () => {
    const { touch, rotates, downs, ups } = makeHarness({
      ctrl: (x, y) => x < 80 && y > 250 && y < 350,
    });
    touch.handlePointerDown(ptr({ clientX: 30, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: 30, clientY: 300 }));
    assert.equal(rotates.length, 0);
    assert.equal(downs.length, 1);
    assert.equal(ups.length, 1);
  });

  it('a start just inside the band is still a tap', () => {
    const { touch, rotates, downs } = makeHarness();
    const x = EDGE_ZONE_PX - 4;
    touch.handlePointerDown(ptr({ clientX: x, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: x + 1, clientY: 301 }));
    assert.equal(rotates.length, 0);
    assert.equal(downs.length, 1);
  });
});
