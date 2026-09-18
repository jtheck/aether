import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD,
  attachAxiomGamepad,
  axiomMenuRoot,
  flyIntentFromPad,
  listAxiomFocusables,
  mergePadReads,
  readXrControllers,
  shapeStepFromPad,
} from './gamepad.js';

function stdPad(partial = {}) {
  return {
    mapping: 'standard',
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: [],
    ...partial,
  };
}

function btn(pressed, value = pressed ? 1 : 0) {
  return { pressed, value };
}

describe('flyIntentFromPad', () => {
  it('keeps stick X and treats stick-up as forward / look-up', () => {
    const fly = flyIntentFromPad({ lx: 1, ly: -1, rx: 1, ry: -1, lt: 0.2, rt: 0.8 });
    assert.ok(fly.mx > 0);
    assert.ok(fly.mz > 0);
    assert.ok(fly.lookRight > 0);
    assert.ok(fly.lookUp > 0);
    assert.ok(fly.lookYaw > 0);
    assert.ok(fly.lookPitch > 0);
    assert.ok(Math.abs(fly.my - 0.6) < 1e-6);
  });

  it('deadzones a resting stick', () => {
    const fly = flyIntentFromPad({ lx: 0.05, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 });
    assert.deepEqual(fly, {
      mx: 0,
      mz: 0,
      my: 0,
      lookRight: 0,
      lookUp: 0,
      lookYaw: 0,
      lookPitch: 0,
    });
  });
});

describe('readXrControllers', () => {
  it('maps left stick / trigger and right stick / trigger', () => {
    const read = readXrControllers([
      {
        handedness: 'left',
        gamepad: { axes: [0, 0, 0.5, -1], buttons: [{ value: 0.25 }] },
      },
      {
        handedness: 'right',
        gamepad: { axes: [0, 0, 1, 0], buttons: [{ value: 0.8 }, { value: 1 }] },
      },
    ]);
    assert.equal(read.lx, 0.5);
    assert.equal(read.ly, -1);
    assert.equal(read.rx, 1);
    assert.equal(read.lt, 0.25);
    assert.equal(read.rt, 0.8);
    assert.equal(read.buttons[PAD.RB], true);
  });

  it('uses axes 0/1 when the controller has no touchpad pair', () => {
    const read = readXrControllers([
      { handedness: 'left', gamepad: { axes: [1, -1], buttons: [] } },
    ]);
    assert.equal(read.lx, 1);
    assert.equal(read.ly, -1);
  });
});

describe('mergePadReads', () => {
  it('lets a standard pad and headset sticks add', () => {
    const merged = mergePadReads(
      { lx: 0.4, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [] },
      { lx: 0.4, ly: 0, rx: 1, ry: 0, lt: 0, rt: 0.5, buttons: [] },
    );
    assert.ok(merged.lx > 0.7);
    assert.equal(merged.rx, 1);
    assert.equal(merged.rt, 0.5);
  });
});

describe('shapeStepFromPad', () => {
  it('steps back on LB / left and forward on RB / right', () => {
    const left = [];
    left[PAD.LB] = true;
    assert.equal(shapeStepFromPad(left, []), -1);
    const right = [];
    right[PAD.RIGHT] = true;
    assert.equal(shapeStepFromPad(right, []), 1);
    assert.equal(shapeStepFromPad(right, right), 0);
    assert.equal(shapeStepFromPad(right, [], { dpad: false }), 0);
  });
});

describe('axiom overlay tab targets', () => {
  it('only lists the XR button once it is shown', () => {
    const xr = {
      id: 'xr_button',
      hidden: false,
      style: { display: '' },
      getAttribute: () => null,
    };
    const doc = {
      getElementById: (id) => (id === 'xr_button' ? xr : null),
    };
    assert.equal(axiomMenuRoot(doc), null);
    assert.deepEqual(listAxiomFocusables(doc), []);
    xr.style.display = 'block';
    assert.equal(axiomMenuRoot(doc), xr);
    assert.deepEqual(listAxiomFocusables(doc), [xr]);
  });
});

describe('attachAxiomGamepad', () => {
  it('flies on a standard pad and keeps flying while the XR button is up', () => {
    const flies = [];
    const renderer = { applyGamepadFly(fly) { flies.push(fly); } };
    const xr = {
      id: 'xr_button',
      hidden: false,
      style: { display: 'block' },
      parentElement: null,
      getAttribute: () => null,
      focus() {},
      click() { this.clicks = (this.clicks || 0) + 1; },
    };
    xr.parentElement = xr;
    const doc = {
      activeElement: null,
      getElementById: (id) => (id === 'xr_button' ? xr : null),
      querySelector: (sel) => (sel === '#xr_button' ? xr : null),
    };
    let pads = [stdPad({ axes: [1, 0, 0, 0] })];
    const pad = attachAxiomGamepad(renderer, {
      root: doc,
      getGamepads: () => pads,
      autoStart: false,
    });
    pad.tick();
    assert.ok(flies.length >= 1);
    assert.ok(flies.at(-1).mx > 0);

    doc.activeElement = xr;
    const a = [];
    a[PAD.A] = btn(true);
    pads = [stdPad({ axes: [1, 0, 0, 0], buttons: a })];
    pad.tick();
    assert.ok(flies.at(-1).mx > 0);
    assert.equal(xr.clicks, 1);
    pad.dispose();
  });

  it('fires onShape from the shoulder / d-pad edges', () => {
    const steps = [];
    const renderer = { applyGamepadFly() {} };
    const rb = [];
    rb[PAD.RB] = btn(true);
    let pads = [stdPad({ buttons: rb })];
    const pad = attachAxiomGamepad(renderer, {
      root: { getElementById: () => null, activeElement: null },
      getGamepads: () => pads,
      onShape: (dir) => steps.push(dir),
      autoStart: false,
    });
    pad.tick();
    pad.tick();
    assert.deepEqual(steps, [1]);
    pad.dispose();
  });

  it('flies from xr-standard hand controllers without a standard pad', () => {
    const flies = [];
    const renderer = { applyGamepadFly(fly) { flies.push(fly); } };
    const sources = [
      {
        handedness: 'left',
        gamepad: { axes: [0, 0, 1, 0], buttons: [{ value: 0 }, { value: 0 }] },
      },
    ];
    const pad = attachAxiomGamepad(renderer, {
      root: { getElementById: () => null, activeElement: null },
      getGamepads: () => [],
      getXrInputSources: () => sources,
      autoStart: false,
    });
    pad.tick();
    assert.ok(flies.at(-1).mx > 0);
    pad.dispose();
  });

  it('can read without applying so app can merge desktop fly', () => {
    const flies = [];
    const renderer = { applyGamepadFly(fly) { flies.push(fly); } };
    const pad = attachAxiomGamepad(renderer, {
      root: { getElementById: () => null, activeElement: null },
      getGamepads: () => [stdPad({ axes: [1, 0, 0, 0] })],
      autoStart: false,
      apply: false,
    });
    pad.tick();
    assert.equal(flies.length, 0);
    assert.ok(pad.read().mx > 0);
    pad.dispose();
  });

  it('ignores an unmapped pad', () => {
    const flies = [];
    const renderer = { applyGamepadFly(fly) { flies.push(fly); } };
    const pad = attachAxiomGamepad(renderer, {
      root: { getElementById: () => null, activeElement: null },
      getGamepads: () => [{ mapping: '', connected: true, axes: [1, 0, 0, 0], buttons: [] }],
      autoStart: false,
    });
    pad.tick();
    assert.equal(flies.length, 1);
    assert.equal(flies[0].mx, 0);
    pad.dispose();
  });
});
