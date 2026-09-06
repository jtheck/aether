import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CENTER_PAN_HOLD_MS,
  createTouchAdapter,
  EDGE_FADE_PX,
  EDGE_ZONE_PX,
  edgeCommandWeight,
} from './touchAdapter.js';

function fakeCanvas(w = 800, h = 600) {
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
    },
  };
}

function makeHarness(hud = {}) {
  const rotates = [];
  const zooms = [];
  const pans = [];
  const downs = [];
  const ups = [];
  const camera = {
    rotateBy(d) { rotates.push(d); },
    nudgeRotate(d) { rotates.push(d); },
    zoomBy(d) { zooms.push(d); },
    nudgeZoom(d) { zooms.push(d); },
    panByScreenDelta(dx, dy) { pans.push({ dx, dy }); },
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
  return { touch, rotates, zooms, pans, downs, ups };
}

function ptr(partial) {
  return {
    pointerId: 1,
    pointerType: 'touch',
    type: 'pointerdown',
    ...partial,
  };
}

describe('edgeCommandWeight', () => {
  it('is full in the rim and dies after a 2× fade', () => {
    assert.equal(edgeCommandWeight(0), 1);
    assert.equal(edgeCommandWeight(EDGE_ZONE_PX), 1);
    assert.equal(edgeCommandWeight(EDGE_ZONE_PX + EDGE_FADE_PX), 0);
    assert.equal(edgeCommandWeight(EDGE_ZONE_PX + EDGE_FADE_PX + 40), 0);
    const mid = edgeCommandWeight(EDGE_ZONE_PX + EDGE_FADE_PX * 0.5);
    assert.ok(mid > 0.4 && mid < 0.6);
    assert.ok(edgeCommandWeight(EDGE_ZONE_PX + 8) < 1);
    assert.ok(edgeCommandWeight(EDGE_ZONE_PX + 8) > edgeCommandWeight(EDGE_ZONE_PX + 48));
  });
});

describe('touch edge band', () => {
  it('a still lift on the rim is a tap, not a camera grab', () => {
    const { touch, rotates, zooms, downs, ups } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 18, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: 19, clientY: 301 }));
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 1);
    assert.equal(ups.length, 1);
  });

  it('a vertical drag on the left rim zooms', () => {
    const { touch, rotates, zooms, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 280 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 16, clientY: 220 }));
    assert.equal(rotates.length, 0);
    assert.ok(zooms.length > 0);
    assert.ok(zooms.some((d) => d !== 0));
    assert.equal(downs.length, 0);
  });

  it('a horizontal drag on the top rim orbits', () => {
    const { touch, rotates, zooms, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 400, clientY: 18 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 470, clientY: 18 }));
    assert.ok(rotates.length > 0);
    assert.ok(rotates.some((d) => d !== 0));
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 0);
  });

  it('an inward drag from the left rim stays a play stroke', () => {
    const { touch, rotates, zooms, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 300 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 80, clientY: 300 }));
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    assert.ok(downs.length >= 1);
  });

  it('a stroke along the top near a corner still orbits', () => {
    const { touch, rotates, zooms, downs } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 20, clientY: 18 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 90, clientY: 20 }));
    assert.ok(rotates.length > 0);
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 0);
  });

  it('does not carry a committed zoom into the open field', () => {
    const { touch, zooms } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 300 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 16, clientY: 250 }));
    assert.ok(zooms.length > 0);
    zooms.length = 0;
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 400, clientY: 200 }));
    assert.equal(zooms.length, 0);
  });

  it('gently drops zoom across the fade buffer', () => {
    const { touch, zooms } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 400 }));
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 16, clientY: 360 }));
    const full = Math.abs(zooms.at(-1) ?? 0);
    assert.ok(full > 0);
    zooms.length = 0;
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 96, clientY: 320 }));
    const faded = Math.abs(zooms.at(-1) ?? 0);
    assert.ok(faded > 0);
    assert.ok(faded < full);
  });

  it('control-group pads are not the rim', () => {
    const { touch, rotates, zooms, downs, ups } = makeHarness({
      ctrl: (x, y) => x < 80 && y > 250 && y < 350,
    });
    touch.handlePointerDown(ptr({ clientX: 30, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: 30, clientY: 300 }));
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 1);
    assert.equal(ups.length, 1);
  });

  it('a still hold on the rim becomes pan, not a tap or camera grab', async () => {
    const { touch, rotates, zooms, pans, downs, ups } = makeHarness();
    touch.handlePointerDown(ptr({ clientX: 16, clientY: 300 }));
    await sleep(CENTER_PAN_HOLD_MS + 20);
    touch.handlePointerMove(ptr({ type: 'pointermove', clientX: 48, clientY: 318 }));
    assert.ok(pans.length > 0);
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 0);
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: 48, clientY: 318 }));
    assert.equal(downs.length, 0);
    assert.equal(ups.length, 0);
  });

  it('a start just inside the band is still a tap', () => {
    const { touch, rotates, zooms, downs, ups } = makeHarness();
    const x = EDGE_ZONE_PX - 4;
    touch.handlePointerDown(ptr({ clientX: x, clientY: 300 }));
    touch.handlePointerUp(ptr({ type: 'pointerup', clientX: x + 1, clientY: 301 }));
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    assert.equal(downs.length, 1);
    assert.equal(ups.length, 1);
  });
});
