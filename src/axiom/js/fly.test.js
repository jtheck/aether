import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_FLY,
  attachAxiomFly,
  flyIntentFromKeys,
  mergeFlyIntents,
  wheelFlyMx,
  wheelFlyMz,
} from './fly.js';

describe('flyIntentFromKeys', () => {
  it('maps ESDF / arrows / R C', () => {
    const fly = flyIntentFromKeys(new Set(['KeyE', 'KeyF', 'KeyR']));
    assert.ok(fly.mz > 0);
    assert.ok(fly.mx > 0);
    assert.ok(fly.my > 0);
  });

  it('treats D as back', () => {
    assert.equal(flyIntentFromKeys(new Set(['KeyD'])).mz, -1);
    assert.equal(flyIntentFromKeys(new Set(['ArrowDown'])).mz, -1);
  });
});

describe('wheelFlyMz', () => {
  it('scroll up is forward', () => {
    assert.equal(wheelFlyMz({ deltaY: -100, deltaMode: 0 }), 1);
  });

  it('scroll down is back', () => {
    assert.equal(wheelFlyMz({ deltaY: 100, deltaMode: 0 }), -1);
  });

  it('scales line mode', () => {
    assert.equal(wheelFlyMz({ deltaY: -1, deltaMode: 1 }), 0.16);
  });
});

describe('wheelFlyMx', () => {
  it('tilt right is strafe right', () => {
    assert.equal(wheelFlyMx({ deltaX: 100, deltaMode: 0 }), 2.5);
  });

  it('tilt left is strafe left', () => {
    assert.equal(wheelFlyMx({ deltaX: -100, deltaMode: 0 }), -2.5);
  });
});

describe('mergeFlyIntents', () => {
  it('adds pad and keys and caps wheel', () => {
    const merged = mergeFlyIntents(
      flyIntentFromKeys(new Set(['KeyE'])),
      { mx: 0.5, mz: 0 },
      { wheelZ: 6 },
      { wheelZ: 6 },
    );
    assert.equal(merged.mz, 1);
    assert.equal(merged.mx, 0.5);
    assert.equal(merged.wheelZ, 8);
  });

  it('skips null parts', () => {
    assert.deepEqual(mergeFlyIntents(null, IDLE_FLY), { ...IDLE_FLY });
  });
});

describe('attachAxiomFly', () => {
  it('reads held keys and consumes wheel / look', () => {
    const listeners = new Map();
    const on = (map) => (type, fn) => {
      const list = map.get(type) ?? [];
      list.push(fn);
      map.set(type, list);
    };
    const fire = (type, e) => {
      for (const fn of listeners.get(type) ?? []) fn(e);
    };
    const canvas = {
      tabIndex: 0,
      style: {},
      focus() {},
      addEventListener: on(listeners),
      removeEventListener() {},
    };
    const win = {
      addEventListener(type, fn) {
        on(listeners)(`win:${type}`, fn);
      },
      removeEventListener() {},
      matchMedia: () => ({ matches: false }),
    };
    const fly = attachAxiomFly(canvas, { window: win, document: { activeElement: null } });
    fire('win:keydown', { code: 'KeyE' });
    fire('wheel', { deltaX: 100, deltaY: -100, deltaMode: 0, preventDefault() {} });
    fire('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fire('pointermove', { clientX: 20, clientY: 10, pointerId: 1 });
    const a = fly.read();
    assert.ok(a.mz > 0);
    assert.equal(a.wheelZ, 1);
    assert.equal(a.wheelX, 2.5);
    assert.ok(a.lookYaw > 0);
    const b = fly.read();
    assert.ok(b.mz > 0);
    assert.equal(b.wheelZ, 0);
    assert.equal(b.wheelX, 0);
    assert.equal(b.lookYaw, 0);
    fly.dispose();
  });
});
