import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD,
  STICK_DEADZONE,
  activateMenuEl,
  activeMenuRoot,
  adjustMenuEl,
  buttonEdges,
  canAdjustMenuEl,
  createGamepadAdapter,
  deadzone,
  heldRepeat,
  isMenuFocusable,
  listMenuFocusables,
  menuNavIntent,
  pickStandardGamepad,
  readStandardPad,
  stepMenuFocus,
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

function el(tag, props = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    hidden: false,
    disabled: false,
    type: '',
    id: '',
    classList: {
      _s: new Set(props.className ? String(props.className).split(/\s+/) : []),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
    },
    parentElement: null,
    children: [],
    dataset: { ...props.dataset },
    getAttribute(name) {
      if (name === 'aria-hidden') return this.ariaHidden ?? null;
      return null;
    },
    focus() { node.doc && (node.doc.activeElement = node); },
    blur() { if (node.doc?.activeElement === node) node.doc.activeElement = null; },
    click() { node.clicks = (node.clicks || 0) + 1; },
    contains(other) {
      let n = other;
      while (n) {
        if (n === node) return true;
        n = n.parentElement;
      }
      return false;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] ?? null;
    },
    querySelectorAll(sel) {
      const out = [];
      const wantBtn = sel.includes('button');
      const wantInput = sel.includes('input');
      const wantSelect = sel.includes('select');
      const wantSettings = sel.includes('#settings_b');
      const walk = (n) => {
        if (wantBtn && n.tagName === 'BUTTON') out.push(n);
        if (wantInput && n.tagName === 'INPUT') out.push(n);
        if (wantSelect && n.tagName === 'SELECT') out.push(n);
        if (wantSettings && n.id === 'settings_b') out.push(n);
        if (sel === '.page.is-active' && n.classList.contains('page') && n.classList.contains('is-active')) {
          out.push(n);
        }
        for (const c of n.children) walk(c);
      };
      for (const c of this.children) walk(c);
      return out;
    },
    ...props,
  };
  return node;
}

function attach(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

describe('pickStandardGamepad', () => {
  it('takes the first connected standard pad and skips the rest', () => {
    const keep = stdPad({ id: 'keep' });
    assert.equal(pickStandardGamepad([
      null,
      { mapping: '', connected: true, id: 'generic' },
      keep,
      stdPad({ id: 'second' }),
    ]), keep);
  });

  it('ignores disconnected standard pads', () => {
    assert.equal(pickStandardGamepad([stdPad({ connected: false })]), null);
  });
});

describe('deadzone', () => {
  it('zeros the hole and keeps full throw at 1', () => {
    assert.equal(deadzone(0), 0);
    assert.equal(deadzone(STICK_DEADZONE - 0.01), 0);
    assert.equal(deadzone(1), 1);
    assert.equal(deadzone(-1), -1);
    assert.ok(deadzone(0.5) > 0 && deadzone(0.5) < 0.5);
  });
});

describe('readStandardPad / buttonEdges', () => {
  it('reads 360-layout axes and button objects', () => {
    const read = readStandardPad(stdPad({
      axes: [0.9, -0.2, 0.1, 0.8],
      buttons: [btn(true), btn(false), , , , , , , , btn(true)],
    }));
    assert.equal(read.lx, 0.9);
    assert.equal(read.ly, -0.2);
    assert.equal(read.rx, 0.1);
    assert.equal(read.ry, 0.8);
    assert.equal(read.buttons[PAD.A], true);
    assert.equal(read.buttons[PAD.B], false);
    assert.equal(read.buttons[PAD.START], true);
    assert.equal(read.lt, 0);
    assert.equal(read.rt, 0);
  });

  it('edges only fire on press', () => {
    const a = [];
    a[PAD.A] = true;
    const e1 = buttonEdges(a, []);
    const e2 = buttonEdges(a, a);
    assert.equal(e1[PAD.A], true);
    assert.equal(e2[PAD.A], false);
  });
});

describe('menuNavIntent', () => {
  it('D-pad tabs; left/right adjust a range', () => {
    const buttons = [];
    buttons[PAD.DOWN] = true;
    assert.deepEqual(menuNavIntent({ lx: 0, ly: 0, buttons }, null), { tab: 1, adj: 0 });

    const range = el('input', { type: 'range' });
    const left = [];
    left[PAD.LEFT] = true;
    assert.deepEqual(menuNavIntent({ lx: 0, ly: 0, buttons: left }, range), { tab: 0, adj: -1 });
    assert.deepEqual(menuNavIntent({ lx: 0, ly: 0, buttons: left }, null), { tab: -1, adj: 0 });
  });

  it('left stick down tabs, and shoulders step a slider', () => {
    assert.equal(menuNavIntent({ lx: 0, ly: 0.9, buttons: [] }, null).tab, 1);
    const range = el('input', { type: 'range' });
    const rb = [];
    rb[PAD.RB] = true;
    assert.equal(menuNavIntent({ lx: 0, ly: 0, buttons: rb }, range).adj, 1);
    assert.equal(canAdjustMenuEl(range), true);
  });
});

describe('heldRepeat', () => {
  it('fires on the first press, then after the repeat delay', () => {
    const first = heldRepeat(1, 0, 100, 0, 0);
    assert.equal(first.fire, true);
    const held = heldRepeat(1, 1, 200, first.heldAt, first.lastAt);
    assert.equal(held.fire, false);
    const again = heldRepeat(1, 1, 100 + 320, first.heldAt, first.lastAt);
    assert.equal(again.fire, true);
  });
});

describe('menu focus helpers', () => {
  it('skips hidden pages, dimmed drawers, and disabled buttons', () => {
    const root = el('div');
    const live = el('div', { className: 'page is-active' });
    const dead = el('div', { className: 'page' });
    const dim = el('div', { className: 'is-dimmed' });
    const ok = el('button');
    const gone = el('button');
    const dimBtn = el('button');
    const off = el('button', { disabled: true });
    attach(root, live);
    attach(root, dead);
    attach(root, dim);
    attach(live, ok);
    attach(dead, gone);
    attach(dim, dimBtn);
    attach(live, off);
    assert.equal(isMenuFocusable(ok, root), true);
    assert.equal(isMenuFocusable(gone, root), false);
    assert.equal(isMenuFocusable(dimBtn, root), false);
    assert.equal(isMenuFocusable(off, root), false);
    assert.deepEqual(listMenuFocusables(root), [ok]);
  });

  it('wraps tab focus and activates / adjusts controls', () => {
    const a = el('button');
    const b = el('button');
    const focused = [];
    a.focus = () => focused.push('a');
    b.focus = () => focused.push('b');
    assert.equal(stepMenuFocus([a, b], a, 1), b);
    assert.equal(stepMenuFocus([a, b], b, 1), a);
    assert.deepEqual(focused, ['b', 'a']);

    activateMenuEl(a);
    assert.equal(a.clicks, 1);

    const range = el('input', { type: 'range', value: '1', min: '0', max: '3', step: '1' });
    adjustMenuEl(range, 1);
    assert.equal(range.value, '2');

    const sel = el('select', {
      selectedIndex: 0,
      value: 'red',
      options: [{ value: 'red' }, { value: 'blue' }],
    });
    activateMenuEl(sel);
    assert.equal(sel.selectedIndex, 1);
    assert.equal(sel.value, 'blue');
  });

  it('prefers the open side menu over a live lobby overlay', () => {
    const side = el('div', { id: 'side_menu' });
    side.classList.add('is-open');
    const lobby = el('div', { id: 'match-lobby-overlay', hidden: false });
    const doc = {
      getElementById(id) {
        if (id === 'side_menu') return side;
        if (id === 'match-lobby-overlay') return lobby;
        return null;
      },
    };
    assert.equal(activeMenuRoot(doc), side);
    side.classList.toggle('is-open', false);
    assert.equal(activeMenuRoot(doc), lobby);
    lobby.classList.add('is-parked');
    assert.equal(activeMenuRoot(doc), null);
  });
});

describe('createGamepadAdapter', () => {
  function menuDoc() {
    const doc = { activeElement: null };
    const side = el('div', { id: 'side_menu' });
    const page = el('div', { className: 'page is-active', dataset: { page: 'main' } });
    const solo = el('button', { id: 'solo_ai_b' });
    const gear = el('div', { id: 'settings_b' });
    const menuBtn = el('div', { id: 'menu_b', hidden: false });
    attach(side, page);
    attach(page, solo);
    attach(side, gear);
    solo.doc = doc;
    gear.doc = doc;
    menuBtn.click = () => {
      const open = side.classList.contains('is-open');
      side.classList.toggle('is-open', !open);
    };
    const lobby = el('div', { id: 'match-lobby-overlay', hidden: true });
    doc.getElementById = (id) => {
      if (id === 'side_menu') return side;
      if (id === 'menu_b') return menuBtn;
      if (id === 'settings_b') return gear;
      if (id === 'match-lobby-overlay') return lobby;
      return null;
    };
    return { doc, side, solo, menuBtn, page, gear };
  }

  it('left stick pans only on a standard pad while the menu is closed', () => {
    const pans = [];
    const rotates = [];
    const zooms = [];
    const { doc } = menuDoc();
    let pads = [];
    const pad = createGamepadAdapter({
      camera: {
        nudgeLookPan(x, z) { pans.push([x, z]); },
        nudgeRotate(a) { rotates.push(a); },
        nudgeZoom(z) { zooms.push(z); },
      },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      autoStart: false,
    });
    pads = [{ mapping: '', connected: true, axes: [1, 0, 0, 0], buttons: [] }];
    pad.tick();
    assert.deepEqual(pans, []);

    pads = [stdPad({ axes: [1, 0, 0.5, -0.5], buttons: [] })];
    pad.tick();
    assert.equal(pans.length, 1);
    assert.ok(pans[0][0] < 0);
    assert.equal(pans[0][1], 0);
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] < 0);
    assert.equal(zooms.length, 1);
    pad.dispose();
  });

  it('Start opens the menu and focuses the first control; sticks stop panning', () => {
    const pans = [];
    const { doc, side, solo } = menuDoc();
    const start = [];
    start[PAD.START] = btn(true);
    let pads = [stdPad({ buttons: start })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() { pans.push(1); } },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      now: () => 1000,
      autoStart: false,
    });
    pad.tick();
    assert.equal(side.classList.contains('is-open'), true);
    assert.equal(doc.activeElement, solo);

    pads = [stdPad({ axes: [1, 0, 0, 0], buttons: start })];
    pad.tick();
    assert.deepEqual(pans, []);
    pad.dispose();
  });

  it('A clicks the focused control; B closes the side menu', () => {
    const { doc, side, solo, menuBtn } = menuDoc();
    side.classList.add('is-open');
    doc.activeElement = solo;
    const a = [];
    a[PAD.A] = btn(true);
    let pads = [stdPad({ buttons: a })];
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => pads,
      now: () => 50,
      autoStart: false,
    });
    pad.tick();
    assert.equal(solo.clicks, 1);

    const b = [];
    b[PAD.B] = btn(true);
    pads = [stdPad({ buttons: b })];
    pad.tick();
    assert.equal(side.classList.contains('is-open'), false);
    assert.ok(menuBtn);
    pad.dispose();
  });

  it('does not pan while input is locked', () => {
    const pans = [];
    const { doc } = menuDoc();
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() { pans.push(1); } },
      active: () => false,
      root: doc,
      getGamepads: () => [stdPad({ axes: [1, 0, 0, 0] })],
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(pans, []);
    pad.dispose();
  });
});
