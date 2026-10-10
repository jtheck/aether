import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STROKE_MAX_PTS,
  controllerRay,
  createXrSelect,
  noteStrokePoint,
  strokeLoop,
  strokeReach,
} from './xrSelect.js';

function rayMatrix(ox, oy, oz, dx, dy, dz) {
  const m = new Float32Array(16);
  m[0] = m[5] = m[15] = 1;
  m[8] = dx;
  m[9] = dy;
  m[10] = dz;
  m[12] = ox;
  m[13] = oy;
  m[14] = oz;
  return m;
}

describe('xr stroke helpers', () => {
  it('reads the target ray off the matrix and normalizes it', () => {
    const ray = controllerRay(rayMatrix(1, 2, 3, 0, -2, 0));
    assert.deepEqual(ray, { ox: 1, oy: 2, oz: 3, dx: 0, dy: -1, dz: 0 });
  });

  it('samples by spacing and keeps tracking once full', () => {
    const stroke = [];
    noteStrokePoint(stroke, 0, 0, 1);
    noteStrokePoint(stroke, 0.5, 0, 1);
    noteStrokePoint(stroke, 2, 0, 1);
    assert.equal(stroke.length, 2);
    for (let i = 0; i < STROKE_MAX_PTS + 10; i++) noteStrokePoint(stroke, 3 + i * 2, 0, 1);
    assert.equal(stroke.length, STROKE_MAX_PTS);
    assert.equal(stroke.at(-1).x, 3 + (STROKE_MAX_PTS + 9) * 2);
  });

  it('measures reach from the first sample and hulls in world XZ', () => {
    const stroke = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 5, z: 5 }, { x: 0, z: 10 }];
    assert.equal(strokeReach(stroke), Math.hypot(10, 10));
    const loop = strokeLoop(stroke);
    assert.equal(loop.length, 4);
    assert.ok(loop.every((p) => 'z' in p && !(p.x === 5 && p.z === 5)));
  });
});

describe('createXrSelect', () => {
  const EYE_Y = 100;

  function makeHand(handedness) {
    const pad = { buttons: [{ pressed: false }, { pressed: false }] };
    const src = {
      source: {},
      handedness,
      targetRayTracked: true,
      targetRayMatrix: rayMatrix(0, EYE_Y, 0, 0, -1, 0),
      selecting: false,
      gamepad: pad,
    };
    return {
      src,
      pad,
      trigger(on) { pad.buttons[0].pressed = on; },
      grip(on) { pad.buttons[1].pressed = on; },
      /** Point the beam from overhead at a spot on the y = 0 field. */
      aim(x, z) {
        const len = Math.hypot(x, EYE_Y, z);
        src.targetRayMatrix = rayMatrix(0, EYE_Y, 0, x / len, -EYE_Y / len, z / len);
      },
    };
  }

  function harness() {
    const shown = [];
    const calls = [];
    const renderer = {
      groundHeight: () => 0,
      rayToGround: (ray) => {
        if (!(ray.dy < 0)) return null;
        const t = -ray.oy / ray.dy;
        return { x: ray.ox + ray.dx * t, y: 0, z: ray.oz + ray.dz * t };
      },
      setXrSelect: (hand, s) => shown.push({ hand, s }),
    };
    const input = {
      groundLoopSelect: (loop, add) => calls.push({ kind: 'loop', loop, add }),
      selectAtRay: (ray, add, assist) => calls.push({ kind: 'ray', ray, add, assist }),
    };
    const select = createXrSelect({ renderer, getInput: () => input });
    const right = makeHand('right');
    const left = makeHand('left');
    const ctx = { input: { inputSources: [right.src] } };
    return {
      select, ctx, right, left, shown, calls,
      step: () => select.step(ctx),
      withLeft() { ctx.input.inputSources.push(left.src); },
      lastShown: (hand) => shown.filter((e) => e.hand === hand).at(-1)?.s,
    };
  }

  function sweepSquare(h, hand) {
    for (const [x, z] of [[0, 0], [20, 0], [20, 20], [0, 20]]) {
      hand.aim(x, z);
      h.step();
    }
  }

  it('hides the beam until the trigger is pressed', () => {
    const h = harness();
    h.step();
    assert.equal(h.shown.length, 0);
    h.right.trigger(true);
    h.step();
    assert.ok(h.lastShown('right')?.ray);
  });

  it('a tap selects with the press aim, even if the release flicks', () => {
    const h = harness();
    h.right.aim(10, 0);
    h.right.trigger(true);
    h.step();
    // About 1.7° of wobble: a far-off ground point moves, but this is still a tap.
    h.right.aim(13, 0);
    h.step();
    h.right.trigger(false);
    h.step();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].kind, 'ray');
    assert.ok(Math.abs(h.calls[0].assist.x - 10) < 1e-6);
    assert.ok(h.calls[0].assist.slop > 0);
    assert.equal(h.lastShown('right'), null);
  });

  it('a sweep lassoes, and grip makes it additive', () => {
    const h = harness();
    h.right.trigger(true);
    h.right.grip(true);
    sweepSquare(h, h.right);
    assert.ok(h.lastShown('right')?.loop?.length >= 3);
    assert.equal(h.calls.length, 0);
    h.right.trigger(false);
    h.step();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].kind, 'loop');
    assert.equal(h.calls[0].add, true);
    assert.equal(h.calls[0].loop.length, 4);
  });

  it('both hands lasso at once; the later release adds to the earlier', () => {
    const h = harness();
    h.withLeft();
    h.right.trigger(true);
    h.left.trigger(true);
    h.step();
    sweepSquare(h, h.right);
    for (const [x, z] of [[-30, 0], [-50, 0], [-50, -20], [-30, -20]]) {
      h.left.aim(x, z);
      h.step();
    }
    assert.ok(h.lastShown('right')?.loop);
    assert.ok(h.lastShown('left')?.loop);
    h.right.trigger(false);
    h.step();
    h.left.trigger(false);
    h.step();
    assert.deepEqual(h.calls.map((c) => [c.kind, c.add]), [['loop', false], ['loop', true]]);
  });

  it('separate taps one after another each replace the selection', () => {
    const h = harness();
    h.withLeft();
    h.right.trigger(true);
    h.step();
    h.right.trigger(false);
    h.step();
    h.left.trigger(true);
    h.step();
    h.left.trigger(false);
    h.step();
    assert.deepEqual(h.calls.map((c) => c.add), [false, false]);
  });

  it('a lost controller drops its gesture without selecting', () => {
    const h = harness();
    h.withLeft();
    h.left.trigger(true);
    h.step();
    h.ctx.input.inputSources.pop();
    h.step();
    assert.equal(h.calls.length, 0);
    assert.equal(h.lastShown('left'), null);
  });
});
