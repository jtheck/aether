import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createXrControls } from './xrControls.js';

const EYE_Y = 100;

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

/** Quest Touch: trigger, grip, stick click, X / A, Y / B. Stick on axes 2 and 3. */
function makeHand(handedness) {
  const buttons = [0, 1, 2, 3, 4].map(() => ({ pressed: false, touched: false, value: 0 }));
  const pad = { buttons, axes: [0, 0, 0, 0] };
  const src = {
    source: {},
    handedness,
    targetRayTracked: true,
    targetRayMatrix: rayMatrix(0, EYE_Y, 0, 0, -1, 0),
    gamepad: pad,
  };
  const set = (i) => (on) => { buttons[i].pressed = on; };
  return {
    src,
    trigger: set(0),
    grip: set(1),
    stickClick: set(2),
    primary: set(3),
    secondary: set(4),
    touch(on) { buttons[0].touched = on; },
    stick(x, y) {
      pad.axes[2] = x;
      pad.axes[3] = y;
    },
    aim(x, z) {
      const len = Math.hypot(x, EYE_Y, z);
      src.targetRayMatrix = rayMatrix(0, EYE_Y, 0, x / len, -EYE_Y / len, z / len);
    },
  };
}

function harness(spots = {}) {
  const shown = [];
  const calls = [];
  const jumped = [];
  const note = (kind) => (...args) => {
    calls.push({ kind, args });
    return true;
  };
  const state = { placing: false, radial: false, anchor: null, beamPick: null };
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
    groundLoopSelect: note('loop'),
    selectAtRay: note('select'),
    attackMoveAtRay: note('attackMove'),
    forceMoveAtRay: note('forceMove'),
    castAbilityAtRay: note('cast'),
    clearSelection: note('clear'),
    isPlacing: () => state.placing,
    previewPlacementAtRay: note('preview'),
    rotatePlacementAtRay: note('rotate'),
    confirmPlacementAtRay: note('confirmPlace'),
    cancelPlacement: note('cancelPlace'),
    getPlacementAnchor: () => state.anchor,
    isRadialOpen: () => state.radial,
    getRadialStickTargets: () => ({
      outer: [
        { kind: 'building', id: 'top', ang: -Math.PI / 2 },
        { kind: 'building', id: 'bottom', ang: Math.PI / 2 },
      ],
    }),
    pickRadialAtRay: () => state.beamPick,
    hoverRadialPick: note('hover'),
    confirmRadialPick: note('confirmRadial'),
    cancelRadial: note('cancelRadial'),
  };
  const controls = createXrControls({
    renderer,
    getInput: () => input,
    jumps: { home: () => spots.home ?? null, selection: () => spots.selection ?? null },
    onJump: (x, z) => jumped.push([x, z]),
  });
  const left = makeHand('left');
  const right = makeHand('right');
  const ctx = { input: { inputSources: [left.src, right.src] } };
  return {
    controls, state, left, right, shown, calls, ctx, jumped,
    step: () => controls.step(ctx),
    kinds: () => calls.map((c) => c.kind),
    of: (kind) => calls.filter((c) => c.kind === kind),
    lastShown: (hand) => shown.filter((e) => e.hand === hand).at(-1)?.s,
  };
}

/** Press, step, release, step. */
function tap(h, press) {
  press(true);
  h.step();
  press(false);
  h.step();
}

describe('xr controls: play', () => {
  it('left trigger force-moves and right trigger attack-moves at their own beams', () => {
    const h = harness();
    h.left.aim(-20, 0);
    h.right.aim(30, 0);
    tap(h, h.left.trigger);
    tap(h, h.right.trigger);
    assert.deepEqual(h.kinds(), ['forceMove', 'attackMove']);
    assert.ok(h.of('forceMove')[0].args[0].dx < 0);
    assert.ok(h.of('attackMove')[0].args[0].dx > 0);
  });

  it('a held trigger fires once', () => {
    const h = harness();
    h.right.trigger(true);
    h.step();
    h.step();
    h.step();
    assert.equal(h.of('attackMove').length, 1);
  });

  it('X and A use the unit ability at that hand', () => {
    const h = harness();
    h.left.aim(-20, 0);
    h.right.aim(30, 0);
    tap(h, h.left.primary);
    tap(h, h.right.primary);
    const casts = h.of('cast');
    assert.equal(casts.length, 2);
    assert.ok(casts[0].args[0].dx < 0);
    assert.ok(casts[1].args[0].dx > 0);
  });

  it('Y and B clear the selection', () => {
    const h = harness();
    tap(h, h.left.secondary);
    tap(h, h.right.secondary);
    assert.deepEqual(h.kinds(), ['clear', 'clear']);
  });
});

describe('xr controls: jumps', () => {
  it('left stick click jumps home and right stick click jumps to the selection', () => {
    const h = harness({ home: { x: -50, z: 10 }, selection: { x: 30, z: 40 } });
    tap(h, h.left.stickClick);
    tap(h, h.right.stickClick);
    assert.deepEqual(h.jumped, [[-50, 10], [30, 40]]);
  });

  it('stays put when there is nowhere to go, and a held click jumps once', () => {
    const h = harness({ home: null, selection: { x: 1, z: 2 } });
    tap(h, h.left.stickClick);
    h.right.stickClick(true);
    h.step();
    h.step();
    assert.deepEqual(h.jumped, [[1, 2]]);
  });

  it('jumps work while placing or in a pie menu', () => {
    const h = harness({ selection: { x: 5, z: 5 } });
    h.state.placing = true;
    tap(h, h.right.stickClick);
    h.state.placing = false;
    h.state.radial = true;
    tap(h, h.right.stickClick);
    assert.equal(h.jumped.length, 2);
  });

  it('grip selects; triggers never select', () => {
    const h = harness();
    tap(h, h.right.trigger);
    tap(h, h.right.grip);
    assert.deepEqual(h.kinds(), ['attackMove', 'select']);
  });
});

describe('xr controls: pie menu', () => {
  it('a trigger picks the slice under the beam, and the stick does not', () => {
    const h = harness();
    h.state.radial = true;
    h.state.beamPick = { kind: 'building', id: 'wall' };
    h.right.stick(0, -1);
    h.step();
    assert.equal(h.of('hover').at(-1).args[0].id, 'wall');
    h.state.beamPick = null;
    h.step();
    assert.equal(h.of('hover').at(-1).args[0], null);
    tap(h, h.left.trigger);
    assert.equal(h.of('confirmRadial').length, 0);
    assert.equal(h.of('attackMove').length, 0);
    h.state.beamPick = { kind: 'building', id: 'wall' };
    tap(h, h.left.trigger);
    assert.deepEqual(h.of('confirmRadial').map((c) => c.args[0].id), ['wall']);
  });

  it('a beam on a slice hovers and a grip on it picks without selecting', () => {
    const h = harness();
    h.state.radial = true;
    h.state.beamPick = { kind: 'category', id: 'basic' };
    h.right.stick(0, -1);
    h.step();
    assert.equal(h.of('hover').at(-1).args[0].id, 'basic');
    tap(h, h.right.grip);
    assert.deepEqual(h.of('confirmRadial').map((c) => c.args[0].id), ['basic']);
    assert.equal(h.of('select').length, 0);
  });

  it('a grip off the menu still selects', () => {
    const h = harness();
    h.state.radial = true;
    tap(h, h.right.grip);
    assert.equal(h.of('select').length, 1);
  });

  it('only re-sends hover when the pick changes', () => {
    const h = harness();
    h.state.radial = true;
    h.state.beamPick = { kind: 'building', id: 'top' };
    h.step();
    h.step();
    h.step();
    assert.equal(h.of('hover').length, 1);
  });

  it('Y / B backs out, and X / A do not cast', () => {
    const h = harness();
    h.state.radial = true;
    tap(h, h.right.primary);
    tap(h, h.right.secondary);
    assert.equal(h.of('cancelRadial').length, 1);
    assert.equal(h.of('cast').length, 0);
  });
});

describe('xr controls: ghost-place', () => {
  it('the beam walks the ghost and a trigger stamps it', () => {
    const h = harness();
    h.state.placing = true;
    h.step();
    assert.equal(h.of('preview').length, 1);
    tap(h, h.left.trigger);
    assert.equal(h.of('confirmPlace').length, 1);
    assert.equal(h.of('attackMove').length, 0);
  });

  it('grip does not select, and the beam keeps walking the ghost', () => {
    const h = harness();
    h.state.placing = true;
    h.right.grip(true);
    h.right.aim(40, 0);
    h.step();
    assert.equal(h.of('preview').length, 1);
    assert.equal(h.of('rotate').length, 0);
    assert.equal(h.of('select').length, 0);
    h.right.aim(80, 0);
    h.step();
    assert.equal(h.of('preview').length, 2);
    assert.equal(h.of('select').length, 0);
  });

  it('Y / B cancels the ghost', () => {
    const h = harness();
    h.state.placing = true;
    tap(h, h.left.secondary);
    assert.equal(h.of('cancelPlace').length, 1);
  });
});

describe('xr controls: beams', () => {
  it('a finger on the trigger shows the aim beam; lifting it hides it', () => {
    const h = harness();
    h.step();
    assert.equal(h.shown.length, 0);
    h.right.touch(true);
    h.step();
    assert.ok(h.lastShown('right')?.ray);
    h.right.touch(false);
    h.step();
    assert.equal(h.lastShown('right'), null);
  });

  it('a pie menu shows both beams', () => {
    const h = harness();
    h.state.radial = true;
    h.step();
    assert.ok(h.lastShown('left')?.ray);
    assert.ok(h.lastShown('right')?.ray);
  });
});
