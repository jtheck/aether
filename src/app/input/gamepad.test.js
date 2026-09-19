import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD,
  STICK_DEADZONE,
  STICK_ROT_DEADZONE,
  activateMenuEl,
  activeMenuRoot,
  adjustMenuEl,
  buttonEdges,
  canAdjustMenuEl,
  createGamepadAdapter,
  deadzone,
  heldRepeat,
  rotStickPair,
  playOrderIntent,
  playSelectHeld,
  stickPlayAxes,
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

describe('rotStickPair', () => {
  it('gates on magnitude, keeps full throw, and lifts a light deflection', () => {
    assert.deepEqual(rotStickPair(0.04, 0.04), { x: 0, y: 0 });
    const full = rotStickPair(1, 0);
    assert.ok(Math.abs(full.x - 1) < 1e-6);
    assert.equal(full.y, 0);
    const light = rotStickPair(0.2, 0);
    assert.ok(light.x > 0.2);
    assert.ok(light.x < 1);
    const diag = rotStickPair(0.07, 0.07);
    assert.ok(Math.hypot(diag.x, diag.y) > 0);
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

describe('playOrderIntent', () => {
  it('maps LT to attack-move and RT to force-move', () => {
    const lt = [];
    lt[PAD.LT] = true;
    const rt = [];
    rt[PAD.RT] = true;
    assert.deepEqual(playOrderIntent(lt), { attackMove: true, forceMove: false });
    assert.deepEqual(playOrderIntent(rt), { attackMove: false, forceMove: true });
    assert.deepEqual(playOrderIntent([]), { attackMove: false, forceMove: false });
  });

  it('holds select on either bumper', () => {
    const lb = [];
    lb[PAD.LB] = true;
    const rb = [];
    rb[PAD.RB] = true;
    assert.equal(playSelectHeld(lb), true);
    assert.equal(playSelectHeld(rb), true);
    assert.equal(playSelectHeld([]), false);
  });
});

describe('stickPlayAxes', () => {
  it('both sticks look; L3 or R3 puts both into rotate/zoom', () => {
    const both = stickPlayAxes({ lx: 1, ly: 0, rx: 0, ry: 1, buttons: [] });
    assert.equal(both.lookX, 1);
    assert.equal(both.lookY, 1);
    assert.equal(both.rotX, 0);
    assert.equal(both.rotY, 0);
    assert.equal(both.bothLook, true);
    const one = stickPlayAxes({ lx: 1, ly: 0, rx: 0, ry: 0, buttons: [] });
    assert.equal(one.bothLook, false);

    const l3 = [];
    l3[PAD.L3] = true;
    const clickLeft = stickPlayAxes({ lx: 1, ly: 0, rx: 0, ry: -1, buttons: l3 });
    assert.equal(clickLeft.lookX, 0);
    assert.equal(clickLeft.lookY, 0);
    assert.equal(clickLeft.rotX, 1);
    assert.equal(clickLeft.rotY, -1);

    const r3 = [];
    r3[PAD.R3] = true;
    const clickRight = stickPlayAxes({ lx: 1, ly: 0, rx: 0, ry: -1, buttons: r3 });
    assert.equal(clickRight.lookX, 0);
    assert.equal(clickRight.lookY, 0);
    assert.equal(clickRight.rotX, 1);
    assert.equal(clickRight.rotY, -1);

    const lookNudge = stickPlayAxes({ lx: STICK_ROT_DEADZONE + 0.01, ly: 0, rx: 0, ry: 0, buttons: [] });
    assert.equal(lookNudge.lookX, 0);
    const rotNudge = stickPlayAxes({ lx: 0.2, ly: 0, rx: 0, ry: 0, buttons: r3 });
    assert.ok(rotNudge.rotX > 0.2);
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

  it('both sticks pan on a standard pad while the menu is closed', () => {
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

    pads = [stdPad({ axes: [1, 0, 0.5, 0], buttons: [] })];
    pad.tick();
    assert.equal(pans.length, 1);
    assert.ok(pans[0][0] < 0);
    assert.equal(pans[0][1], 0);
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
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

  it('aims the field cursor while a pad can play and hides it in the menu', () => {
    const aims = [];
    const { doc, side } = menuDoc();
    let pads = [stdPad({ axes: [0, 0, 0, 0], buttons: [] })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onAim: (on) => aims.push(on),
      autoStart: false,
    });
    pad.tick();
    assert.equal(aims.at(-1), true);

    side.classList.add('is-open');
    pad.tick();
    assert.equal(aims.at(-1), false);

    side.classList.toggle('is-open', false);
    pads = [];
    pad.tick();
    assert.equal(aims.at(-1), false);
    pad.dispose();
  });

  it('LT attack-moves and RT force-moves on press, not hold or in the menu', () => {
    const attacks = [];
    const moves = [];
    const { doc, side } = menuDoc();
    const lt = [];
    lt[PAD.LT] = btn(true);
    let pads = [stdPad({ buttons: lt })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onAttackMove: () => attacks.push(1),
      onForceMove: () => moves.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(attacks.length, 1);
    assert.equal(moves.length, 0);

    pad.tick();
    assert.equal(attacks.length, 1);

    const rt = [];
    rt[PAD.RT] = btn(true);
    pads = [stdPad({ buttons: rt })];
    pad.tick();
    assert.equal(moves.length, 1);

    side.classList.add('is-open');
    const both = [];
    both[PAD.LT] = btn(true);
    both[PAD.RT] = btn(true);
    pads = [stdPad({ buttons: both })];
    pad.tick();
    assert.equal(attacks.length, 1);
    assert.equal(moves.length, 1);
    pad.dispose();
  });

  it('either stick roams the view before leftover pans the camera', () => {
    const pans = [];
    const cursors = [];
    const { doc } = menuDoc();
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan(x, z) { pans.push([x, z]); } },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes: [1, 0, 0, 0], buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    pad.tick();
    assert.equal(pans.length, 0);
    assert.ok(cursors.at(-1)[0] > 0);
    for (let i = 0; i < 6; i++) pad.tick();
    assert.equal(pans.length, 0);
    for (let i = 0; i < 20; i++) pad.tick();
    assert.ok(pans.length >= 1);
    pad.dispose();

    pans.length = 0;
    cursors.length = 0;
    const right = createGamepadAdapter({
      camera: { nudgeLookPan(x, z) { pans.push([x, z]); } },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes: [0, 0, 1, 0], buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    right.tick();
    assert.equal(pans.length, 0);
    assert.ok(cursors.at(-1)[0] > 0);
    right.dispose();
  });

  it('two look sticks pan immediately while the cursor still roams', () => {
    const pans = [];
    const cursors = [];
    const { doc } = menuDoc();
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan(x, z) { pans.push([x, z]); } },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes: [1, 0, 0, 1], buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    pad.tick();
    assert.ok(pans.length >= 1);
    assert.ok(cursors.at(-1)[0] > 0);
    assert.ok(cursors.at(-1)[1] > 0);
    pad.dispose();
  });

  it('LB and RB hold the same select drag', () => {
    const phases = [];
    const { doc } = menuDoc();
    const lb = [];
    lb[PAD.LB] = btn(true);
    let pads = [stdPad({ buttons: lb })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onSelectStart: () => phases.push('start'),
      onSelectHold: () => phases.push('hold'),
      onSelectEnd: () => phases.push('end'),
      onSelectCancel: () => phases.push('cancel'),
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(phases, ['start', 'hold']);
    pad.tick();
    assert.deepEqual(phases, ['start', 'hold', 'hold']);
    pads = [stdPad({ buttons: [] })];
    pad.tick();
    assert.equal(phases.at(-1), 'end');

    phases.length = 0;
    const rb = [];
    rb[PAD.RB] = btn(true);
    pads = [stdPad({ buttons: rb })];
    pad.tick();
    assert.deepEqual(phases, ['start', 'hold']);
    pads = [stdPad({ buttons: [] })];
    pad.tick();
    assert.equal(phases.at(-1), 'end');
    pad.dispose();
  });

  it('L3 or R3 puts both sticks into rotate/zoom', () => {
    const pans = [];
    const rotates = [];
    const zooms = [];
    const cursors = [];
    const { doc } = menuDoc();
    const l3 = [];
    l3[PAD.L3] = btn(true);
    let pads = [stdPad({ axes: [1, 0, 0, -1], buttons: l3 })];
    const pad = createGamepadAdapter({
      camera: {
        nudgeLookPan(x, z) { pans.push([x, z]); },
        nudgeRotate(a) { rotates.push(a); },
        nudgeZoom(z) { zooms.push(z); },
      },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    pad.tick();
    assert.equal(pans.length, 0);
    assert.equal(cursors.at(-1)[0], 0);
    assert.equal(cursors.at(-1)[1], 0);
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] < 0);
    assert.ok(zooms.length >= 1);

    pans.length = 0;
    rotates.length = 0;
    zooms.length = 0;
    const r3 = [];
    r3[PAD.R3] = btn(true);
    pads = [stdPad({ axes: [1, 0, 0, -1], buttons: r3 })];
    pad.tick();
    assert.equal(pans.length, 0);
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] < 0);
    assert.ok(zooms.length >= 1);
    pad.dispose();
  });

  it('menu tab stays on the physical left stick', () => {
    const focused = [];
    const { doc, side, solo } = menuDoc();
    const next = el('button', { id: 'next_b' });
    attach(side.querySelector('.page.is-active') ?? side, next);
    next.focus = () => {
      focused.push('next');
      doc.activeElement = next;
    };
    solo.focus = () => {
      focused.push('solo');
      doc.activeElement = solo;
    };
    side.classList.add('is-open');
    doc.activeElement = solo;
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => [stdPad({ axes: [0, 1, 1, 0], buttons: [] })],
      now: () => 50,
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(focused, ['next']);
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
