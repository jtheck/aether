import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  installNavGuard,
  isBrowserNavKey,
  isBrowserNavMouseButton,
  isTextEntryTarget,
} from './navGuard.js';

function fakeEvent(partial = {}) {
  let prevented = false;
  return {
    button: 0,
    key: '',
    code: '',
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...partial,
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

function fakeRoot() {
  const listeners = new Map();
  const doc = { activeElement: null };
  const win = {
    document: doc,
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      listeners.set(type, list.filter((h) => h !== fn));
    },
    dispatch(type, e) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
  return { root: { window: win, document: doc }, win, doc, listeners };
}

describe('isBrowserNavMouseButton', () => {
  it('flags X1 / X2 only', () => {
    assert.equal(isBrowserNavMouseButton(0), false);
    assert.equal(isBrowserNavMouseButton(1), false);
    assert.equal(isBrowserNavMouseButton(2), false);
    assert.equal(isBrowserNavMouseButton(3), true);
    assert.equal(isBrowserNavMouseButton(4), true);
  });
});

describe('isTextEntryTarget', () => {
  it('treats fields as typing, not canvas or buttons', () => {
    assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'SELECT' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isTextEntryTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isTextEntryTarget({ tagName: 'CANVAS' }), false);
    assert.equal(isTextEntryTarget(null), false);
  });
});

describe('isBrowserNavKey', () => {
  it('blocks Backspace, Alt/Meta arrows, and chorded brackets', () => {
    assert.equal(isBrowserNavKey({ key: 'Backspace', code: 'Backspace' }), true);
    assert.equal(isBrowserNavKey({ key: 'BrowserBack' }), true);
    assert.equal(isBrowserNavKey({ key: 'BrowserForward' }), true);
    assert.equal(isBrowserNavKey({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }), true);
    assert.equal(isBrowserNavKey({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true }), true);
    assert.equal(isBrowserNavKey({ key: '[', code: 'BracketLeft', metaKey: true }), true);
    assert.equal(isBrowserNavKey({ key: ']', code: 'BracketRight', ctrlKey: true }), true);
  });

  it('leaves game keys and typing alone', () => {
    assert.equal(isBrowserNavKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), false);
    assert.equal(isBrowserNavKey({ key: 'Escape', code: 'Escape' }), false);
    assert.equal(isBrowserNavKey({ key: 'Backspace', code: 'Backspace' }, true), false);
    assert.equal(isBrowserNavKey({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }, true), false);
    assert.equal(isBrowserNavKey({ key: 'b', code: 'KeyB' }), false);
  });
});

describe('installNavGuard', () => {
  it('prevents mouse back / forward and Alt+Left, then uninstalls', () => {
    const { root, win, doc } = fakeRoot();
    const dispose = installNavGuard(root);

    const back = fakeEvent({ button: 3 });
    win.dispatch('mousedown', back);
    assert.equal(back.defaultPrevented, true);

    const forward = fakeEvent({ button: 4 });
    win.dispatch('auxclick', forward);
    assert.equal(forward.defaultPrevented, true);

    const lmb = fakeEvent({ button: 0 });
    win.dispatch('pointerdown', lmb);
    assert.equal(lmb.defaultPrevented, false);

    const altLeft = fakeEvent({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    win.dispatch('keydown', altLeft);
    assert.equal(altLeft.defaultPrevented, true);

    doc.activeElement = { tagName: 'INPUT' };
    const typed = fakeEvent({ key: 'Backspace', code: 'Backspace' });
    win.dispatch('keydown', typed);
    assert.equal(typed.defaultPrevented, false);

    dispose();
    const after = fakeEvent({ button: 3 });
    win.dispatch('mousedown', after);
    assert.equal(after.defaultPrevented, false);
  });
});
