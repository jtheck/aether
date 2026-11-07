import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clockwiseFromNine, menuHotkeyPick, orderedMenuOptions } from './menuHotkeys.js';

const KEYS = ['KeyA', 'KeyQ', 'KeyT', 'KeyG', 'KeyH'];

function ids(targets) {
  return KEYS.map((code) => menuHotkeyPick(targets, code)?.id ?? null);
}

describe('clockwiseFromNine', () => {
  it('walks left, top, right, bottom', () => {
    const nine = clockwiseFromNine(0);
    const noon = clockwiseFromNine(-Math.PI / 2);
    const three = clockwiseFromNine(Math.PI);
    const six = clockwiseFromNine(Math.PI / 2);
    assert.equal(nine, 0);
    assert.ok(nine < noon && noon < three && three < six);
  });
});

describe('menuHotkeyPick', () => {
  it('wraps the agora categories clockwise from the left', () => {
    const agora = {
      inner: [
        { kind: 'category', id: 'advanced', ang: 0.65 },
        { kind: 'category', id: 'basic', ang: -1.44 },
        { kind: 'category', id: 'elemental', ang: 2.75 },
      ],
      outer: [
        { kind: 'building', id: 'camp', ang: -2 },
      ],
    };
    const order = orderedMenuOptions(agora).map((s) => s.id);
    assert.deepEqual(order, ['basic', 'elemental', 'advanced']);
    assert.deepEqual(ids(agora), ['basic', 'elemental', 'advanced', 'basic', 'elemental']);
  });

  it('walks production pads clockwise from pause', () => {
    const menu = {
      inner: [],
      outer: [
        { kind: 'unit', id: 'right', ang: Math.PI },
        { kind: 'unit', id: 'top', ang: -Math.PI / 2 },
        { kind: 'unit', id: 'left', ang: 0 },
        { kind: 'unit', id: 'byCancel', ang: (Math.PI * 3) / 4 + 0.05 },
        { kind: 'pause', ang: Math.PI / 2 - 0.2 },
        { kind: 'cancel', ang: Math.PI / 2 + 0.2 },
      ],
    };
    assert.deepEqual(
      orderedMenuOptions(menu).map((s) => s.id),
      ['left', 'top', 'right', 'byCancel'],
    );
    assert.equal(menuHotkeyPick(menu, 'KeyX')?.kind, 'pause');
    assert.equal(menuHotkeyPick(menu, 'KeyC')?.kind, 'cancel');
  });

  it('sends every key to the only production option', () => {
    const menu = {
      inner: [],
      outer: [{ kind: 'unit', id: 'myco', ang: -1 }],
    };
    assert.deepEqual(ids(menu), ['myco', 'myco', 'myco', 'myco', 'myco']);
  });

  it('leaves the pad beside cancel without a key when six are showing', () => {
    const start = (Math.PI * 3) / 4;
    const span = Math.PI * 1.5;
    const outer = [];
    for (let i = 0; i < 6; i++) {
      outer.push({ kind: 'unit', id: `u${i}`, ang: start + ((i + 0.5) / 6) * span });
    }
    const menu = { inner: [], outer };
    assert.deepEqual(ids(menu), ['u5', 'u4', 'u3', 'u2', 'u1']);
    assert.equal(orderedMenuOptions(menu)[5].id, 'u0');
  });

  it('does nothing for these keys when no menu is open', () => {
    assert.equal(menuHotkeyPick(null, 'KeyA'), undefined);
    assert.equal(menuHotkeyPick(null, 'KeyX'), undefined);
  });
});
