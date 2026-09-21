import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD,
  STICK_DEADZONE,
  STICK_DEADZONE_LEAVE,
  STICK_ROT_DEADZONE,
  STICK_SPLIT_LOOK,
  STICK_SPLIT_MIN,
  STICK_SPLIT_YAW,
  STICK_SPLIT_ZOOM,
  activateMenuEl,
  isMenuTextField,
  activeMenuRoot,
  adjustMenuEl,
  buttonEdges,
  buttonReleased,
  canAdjustMenuEl,
  controlGroupIdFromPad,
  createGamepadAdapter,
  deadzone,
  lookStickPair,
  padCanReclaimFromPointer,
  padHasActivity,
  padShouldYield,
  STICK_RECLAIM,
  heldRepeat,
  rotStickPair,
  placePadIntent,
  playCastIntent,
  playConfirmIntent,
  playControlGroupIntent,
  playOrderIntent,
  playSelectBoth,
  playSelectHeld,
  stickHeld,
  stickMagnitude,
  radialMenuRead,
  stickCameraGesture,
  stickPlayAxes,
  stickSplitOppose,
  stickSplitRotate,
  stickSplitZoom,
  isMenuFocusable,
  listMenuFocusables,
  menuNavIntent,
  osKbdBackspaceHeld,
  osKbdNavIntent,
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
    select() { node.didSelect = true; },
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

describe('lookStickPair', () => {
  it('keeps a slow diagonal live when each axis is inside the hole', () => {
    const axis = STICK_DEADZONE - 0.03;
    assert.equal(deadzone(axis), 0);
    const pair = lookStickPair(axis, axis);
    assert.equal(pair.live, true);
    assert.ok(pair.x > 0 && pair.y > 0);
    assert.ok(stickMagnitude(axis, axis) > STICK_DEADZONE);
  });

  it('zeros a throw inside the circular hole and remaps full throw to 1', () => {
    assert.equal(lookStickPair(0.05, 0.05).live, false);
    const full = lookStickPair(1, 0);
    assert.equal(full.live, true);
    assert.ok(Math.abs(full.x - 1) < 1e-6);
    assert.ok(Math.abs(full.y) < 1e-6);
  });
});

describe('stickHeld', () => {
  it('enters at the look hole and leaves lower', () => {
    assert.equal(stickHeld(STICK_DEADZONE - 0.01, false), false);
    assert.equal(stickHeld(STICK_DEADZONE + 0.01, false), true);
    assert.equal(stickHeld(STICK_DEADZONE_LEAVE + 0.01, true), true);
    assert.equal(stickHeld(STICK_DEADZONE_LEAVE - 0.01, true), false);
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
    assert.equal(buttonReleased([], a)[PAD.A], true);
    assert.equal(buttonReleased(a, a)[PAD.A], false);
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
    assert.equal(menuNavIntent({ lx: 0, ly: 0, rx: 0, ry: 0.9, buttons: [] }, null).tab, 1);
    const range = el('input', { type: 'range' });
    const rb = [];
    rb[PAD.RB] = true;
    assert.equal(menuNavIntent({ lx: 0, ly: 0, buttons: rb }, range).adj, 1);
    assert.equal(canAdjustMenuEl(range), true);
  });
});

describe('osKbdNavIntent', () => {
  it('D-pad and both sticks walk the grid; bumpers are backspace', () => {
    const down = [];
    down[PAD.DOWN] = true;
    assert.deepEqual(osKbdNavIntent({ lx: 0, ly: 0, rx: 0, ry: 0, buttons: down }), { dx: 0, dy: 1 });
    const left = [];
    left[PAD.LEFT] = true;
    assert.deepEqual(osKbdNavIntent({ lx: 0, ly: 0, rx: 0, ry: 0, buttons: left }), { dx: -1, dy: 0 });
    assert.deepEqual(osKbdNavIntent({ lx: 0, ly: 0.9, rx: 0, ry: 0, buttons: [] }), { dx: 0, dy: 1 });
    assert.deepEqual(osKbdNavIntent({ lx: 0, ly: 0, rx: 0, ry: -0.9, buttons: [] }), { dx: 0, dy: -1 });
    const lb = [];
    lb[PAD.LB] = true;
    assert.equal(osKbdBackspaceHeld({ buttons: lb }), true);
    assert.equal(osKbdBackspaceHeld({ buttons: [] }), false);
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

    const name = el('input', { type: 'text', value: 'Cultivator' });
    name.doc = { activeElement: null };
    assert.equal(isMenuTextField(name), true);
    assert.equal(isMenuTextField(range), false);
    assert.equal(activateMenuEl(name), true);
    assert.equal(name.doc.activeElement, name);
    assert.equal(name.didSelect, true);
    assert.equal(name.clicks || 0, 0);
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
    const kbd = el('div', { id: 'os_kbd', hidden: false });
    const withKbd = {
      getElementById(id) {
        if (id === 'os_kbd') return kbd;
        return doc.getElementById(id);
      },
    };
    assert.equal(activeMenuRoot(withKbd), kbd);
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

  it('treats A and both triggers as confirm', () => {
    const a = [];
    a[PAD.A] = true;
    const lt = [];
    lt[PAD.LT] = true;
    const rt = [];
    rt[PAD.RT] = true;
    assert.equal(playConfirmIntent(a), true);
    assert.equal(playConfirmIntent(lt), true);
    assert.equal(playConfirmIntent(rt), true);
    assert.equal(playConfirmIntent([]), false);
  });

  it('maps place A/B to stamp / cancel; yaw is a bumper hold, not a tap', () => {
    const a = [];
    a[PAD.A] = true;
    assert.deepEqual(placePadIntent(a), { confirm: true, cancel: false });
    const b = [];
    b[PAD.B] = true;
    assert.deepEqual(placePadIntent(b), { confirm: false, cancel: true });
    const lb = [];
    lb[PAD.LB] = true;
    assert.deepEqual(placePadIntent(lb), { confirm: false, cancel: false });
  });

  it('holds select on either bumper', () => {
    const lb = [];
    lb[PAD.LB] = true;
    const rb = [];
    rb[PAD.RB] = true;
    const both = [];
    both[PAD.LB] = true;
    both[PAD.RB] = true;
    assert.equal(playSelectHeld(lb), true);
    assert.equal(playSelectHeld(rb), true);
    assert.equal(playSelectHeld(both), true);
    assert.equal(playSelectHeld([]), false);
    assert.equal(playSelectBoth(lb), false);
    assert.equal(playSelectBoth(rb), false);
    assert.equal(playSelectBoth(both), true);
    assert.equal(playSelectBoth([]), false);
  });
});

describe('play control groups / cast', () => {
  it('maps U/R/D to the left stack and Y/X/A to the right', () => {
    assert.equal(controlGroupIdFromPad(PAD.UP), 0);
    assert.equal(controlGroupIdFromPad(PAD.RIGHT), 1);
    assert.equal(controlGroupIdFromPad(PAD.DOWN), 4);
    assert.equal(controlGroupIdFromPad(PAD.Y), 2);
    assert.equal(controlGroupIdFromPad(PAD.X), 3);
    assert.equal(controlGroupIdFromPad(PAD.A), 5);
    assert.equal(controlGroupIdFromPad(PAD.B), null);
    assert.equal(controlGroupIdFromPad(PAD.LEFT), null);
  });

  it('collects group downs and ups; B and Left cast', () => {
    const down = [];
    down[PAD.UP] = true;
    down[PAD.Y] = true;
    const up = [];
    up[PAD.A] = true;
    assert.deepEqual(playControlGroupIntent(down, up), { downs: [0, 2], ups: [5] });
    const cast = [];
    cast[PAD.B] = true;
    assert.equal(playCastIntent(cast), true);
    const left = [];
    left[PAD.LEFT] = true;
    assert.equal(playCastIntent(left), true);
    assert.equal(playCastIntent([]), false);
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
    const diag = STICK_DEADZONE - 0.03;
    const slowDiag = stickPlayAxes({ lx: diag, ly: diag, rx: 0, ry: 0, buttons: [] });
    assert.ok(slowDiag.lookX > 0 && slowDiag.lookY > 0);
    const rotNudge = stickPlayAxes({ lx: 0.2, ly: 0, rx: 0, ry: 0, buttons: r3 });
    assert.ok(rotNudge.rotX > 0.2);

    const twist = stickPlayAxes({ lx: 0, ly: -0.5, rx: 0, ry: 0.5, buttons: [] });
    assert.ok(twist.splitYaw > 0);
    assert.equal(twist.splitZoom, 0);
    const open = stickPlayAxes({ lx: -0.5, ly: 0, rx: 0.5, ry: 0, buttons: [] });
    assert.ok(open.splitZoom < 0);
    assert.equal(open.splitYaw, 0);
    const pinch = stickPlayAxes({ lx: 0.5, ly: 0, rx: -0.5, ry: 0, buttons: [] });
    assert.ok(pinch.splitZoom > 0);
    const lean = stickPlayAxes({ lx: 0.7, ly: -0.5, rx: 0, ry: 0.5, buttons: [] });
    assert.ok(lean.splitYaw);
    assert.ok(Math.abs(lean.lookX) < 0.7 * STICK_SPLIT_LOOK + 1e-6);
    const same = stickPlayAxes({ lx: 1, ly: 0, rx: 1, ry: 0, buttons: [] });
    assert.equal(same.splitYaw, 0);
    assert.equal(same.splitZoom, 0);
  });
});

describe('stickSplitRotate / stickSplitZoom', () => {
  it('yaws on opposite up/down and zooms on out/in', () => {
    assert.ok(stickSplitRotate({ y: -0.5, live: true }, { y: 0.5, live: true }) > 0);
    assert.ok(stickSplitRotate({ y: 0.5, live: true }, { y: -0.5, live: true }) < 0);
    assert.equal(stickSplitRotate({ y: -0.5, live: true }, { y: 0, live: false }), 0);
    assert.equal(stickSplitRotate({ y: -0.5, live: true }, { y: -0.5, live: true }), 0);

    assert.ok(stickSplitZoom({ x: -0.5, live: true }, { x: 0.5, live: true }) < 0);
    assert.ok(stickSplitZoom({ x: 0.5, live: true }, { x: -0.5, live: true }) > 0);
    assert.equal(stickSplitZoom({ x: -0.2, live: true }, { x: 0.2, live: true }), 0);
    assert.equal(stickSplitZoom({ x: 1, live: true }, { x: 1, live: true }), 0);

    const half = Math.abs(stickSplitOppose(-0.35, 0.35, true));
    const mid = Math.abs(stickSplitOppose(-0.65, 0.65, true));
    const full = Math.abs(stickSplitOppose(-1, 1, true));
    assert.ok(half > 0 && mid > half && full > mid);
    assert.ok(full > half * 2);
    assert.ok(full - mid > mid - half);
    assert.ok(full <= 1);
    const uneven = Math.abs(stickSplitOppose(-0.35, 1, true));
    assert.ok(uneven > half);
  });

  it('treats splits, aligned look, and click-stick as camera gestures', () => {
    assert.equal(stickCameraGesture({ lx: 0.8, ly: 0, rx: 0, ry: 0, buttons: [] }), false);
    assert.equal(stickCameraGesture({ lx: 0, ly: 1, rx: 1, ry: 0, buttons: [] }), false);
    assert.equal(stickCameraGesture({ lx: 0.8, ly: 0, rx: 0.8, ry: 0, buttons: [] }), true);
    assert.equal(stickCameraGesture({ lx: -0.5, ly: 0, rx: 0.5, ry: 0, buttons: [] }), true);
    const l3 = [];
    l3[PAD.L3] = true;
    assert.equal(stickCameraGesture({ lx: 0, ly: 0, rx: 0, ry: 0, buttons: l3 }), true);
    const lone = radialMenuRead({ lx: 0, ly: -0.8, rx: 0, ry: 0, buttons: [] });
    assert.equal(lone.ly, -0.8);
    const both = radialMenuRead({ lx: 0.8, ly: 0, rx: 0.8, ry: 0, buttons: [] });
    assert.equal(both.lx, 0);
    assert.equal(both.rx, 0);
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

    const leftover = el('button');
    leftover.tagName = 'BUTTON';
    doc.activeElement = leftover;
    pans.length = 0;
    pad.tick();
    assert.equal(pans.length, 1);
    pad.dispose();
  });

  it('Start opens the menu and focuses the first control; a lone left stick does not pan', () => {
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

  it('two-stick camera gestures still move the camera while the menu is open', () => {
    const pans = [];
    const rotates = [];
    const zooms = [];
    const attacks = [];
    const { doc, side } = menuDoc();
    side.classList.add('is-open');
    let axes = [-0.5, 0, 0.5, 0];
    const pad = createGamepadAdapter({
      camera: {
        nudgeLookPan(x, z) { pans.push([x, z]); },
        nudgeRotate(a) { rotates.push(a); },
        nudgeZoom(z) { zooms.push(z); },
        zoomBy(z) { zooms.push(z); },
      },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      onAttackMove: () => attacks.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(zooms.length, 1);
    assert.ok(zooms[0] < 0);
    assert.equal(attacks.length, 0);

    zooms.length = 0;
    rotates.length = 0;
    axes = [0, -0.5, 0, 0.5];
    pad.tick();
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] < 0);
    assert.equal(zooms.length, 0);

    pans.length = 0;
    axes = [0, 0, 1, 0];
    pad.tick();
    assert.equal(pans.length, 0);

    pans.length = 0;
    axes = [1, 0, 1, 0];
    pad.tick();
    assert.equal(pans.length, 1);
    assert.ok(pans[0][0] < 0);
    pad.dispose();
  });

  it('both sticks still pan after a pointer yield while the menu is open', () => {
    const pans = [];
    const { doc, side } = menuDoc();
    side.classList.add('is-open');
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan(x, z) { pans.push([x, z]); } },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes: [1, 0, 1, 0], buttons: [] })],
      autoStart: false,
    });
    pad.yieldToPointer();
    pad.tick();
    assert.equal(pans.length, 1);
    assert.ok(pans[0][0] < 0);
    pad.dispose();
  });

  it('a two-stick yaw does not tab the menu', () => {
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
      camera: { nudgeLookPan() {}, nudgeRotate() {}, nudgeZoom() {} },
      root: doc,
      getGamepads: () => [stdPad({ axes: [0, 0.9, 0, -0.9], buttons: [] })],
      now: () => 50,
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(focused, []);
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

  it('B closes the in-game keyboard and leaves the side menu open', () => {
    const { doc, side } = menuDoc();
    const kbd = el('div', { id: 'os_kbd', hidden: false });
    const key = el('button');
    attach(kbd, key);
    side.classList.add('is-open');
    const inner = doc.getElementById;
    doc.getElementById = (id) => (id === 'os_kbd' ? kbd : inner(id));
    const b = [];
    b[PAD.B] = btn(true);
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => [stdPad({ buttons: b })],
      autoStart: false,
    });
    pad.tick();
    assert.equal(kbd.hidden, true);
    assert.equal(side.classList.contains('is-open'), true);
    pad.dispose();
  });

  it('D-pad and sticks move on the keyboard grid; bumpers backspace', () => {
    const { doc, side } = menuDoc();
    const kbd = el('div', { id: 'os_kbd', hidden: false });
    const q = el('button', { dataset: { osKbd: 'q', osKbdRow: '0', osKbdCol: '0' } });
    const aKey = el('button', { dataset: { osKbd: 'a', osKbdRow: '1', osKbdCol: '0' } });
    attach(kbd, q);
    attach(kbd, aKey);
    q.doc = doc;
    aKey.doc = doc;
    kbd.ownerDocument = doc;
    const field = { value: 'Hi', maxLength: 24, dispatchEvent() { return true; } };
    kbd._osKbd = { el: field, replaceAll: false };
    side.classList.add('is-open');
    const inner = doc.getElementById;
    doc.getElementById = (id) => (id === 'os_kbd' ? kbd : inner(id));
    doc.activeElement = q;

    const down = [];
    down[PAD.DOWN] = btn(true);
    let pads = [stdPad({ buttons: down })];
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => pads,
      now: () => 50,
      autoStart: false,
    });
    pad.tick();
    assert.equal(doc.activeElement, aKey);

    pads = [stdPad({ axes: [0, 0, 0, -0.9], buttons: [] })];
    pad.tick();
    assert.equal(doc.activeElement, q);

    const lb = [];
    lb[PAD.LB] = btn(true);
    pads = [stdPad({ buttons: lb })];
    pad.tick();
    assert.equal(field.value, 'H');
    pad.dispose();
  });

  it('A on a focused text field focuses it and asks for a system keyboard', () => {
    const edits = [];
    const { doc, side, page } = menuDoc();
    const name = el('input', { type: 'text', id: 'name_input', value: 'Cultivator' });
    name.doc = doc;
    attach(page, name);
    side.classList.add('is-open');
    doc.activeElement = name;
    const a = [];
    a[PAD.A] = btn(true);
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => [stdPad({ buttons: a })],
      onTextEdit: (el) => edits.push(el),
      autoStart: false,
    });
    pad.tick();
    assert.equal(edits[0], name);
    assert.equal(name.didSelect, true);
    pad.dispose();
  });

  it('LT and RT also click the focused menu control', () => {
    const { doc, side, solo } = menuDoc();
    side.classList.add('is-open');
    doc.activeElement = solo;
    const lt = [];
    lt[PAD.LT] = btn(true);
    let pads = [stdPad({ buttons: lt })];
    const pad = createGamepadAdapter({
      camera: {},
      root: doc,
      getGamepads: () => pads,
      now: () => 50,
      autoStart: false,
    });
    pad.tick();
    assert.equal(solo.clicks, 1);

    const rt = [];
    rt[PAD.RT] = btn(true);
    pads = [stdPad({ buttons: rt })];
    pad.tick();
    assert.equal(solo.clicks, 2);
    pad.dispose();
  });

  it('yields the pad when the page is hidden, not merely unfocused', () => {
    assert.equal(padShouldYield({ hidden: true, hasFocus: () => true }), true);
    assert.equal(padShouldYield({ hidden: false, hasFocus: () => false }), false);
    assert.equal(padShouldYield({ hidden: false, hasFocus: () => true }), false);
  });

  it('parks the raf loop so yieldPad can resume later', () => {
    let yieldOn = true;
    let polled = 0;
    let resume;
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: menuDoc().doc,
      getGamepads: () => {
        polled += 1;
        return [stdPad({ axes: [1, 0, 0, 0], buttons: [] })];
      },
      yieldPad: () => yieldOn,
      interval: (fn) => { resume = fn; return 1; },
      clearInterval() {},
      autoStart: false,
    });
    pad.tick();
    assert.equal(polled, 0);
    yieldOn = false;
    resume();
    pad.tick();
    assert.equal(polled, 1);
    pad.dispose();
  });

  it('does not poll a pad while yieldPad is set', () => {
    const aims = [];
    let polled = 0;
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: menuDoc().doc,
      getGamepads: () => {
        polled += 1;
        return [stdPad({ axes: [1, 0, 0, 0], buttons: [] })];
      },
      yieldPad: () => true,
      onAim: (on) => aims.push(on),
      autoStart: false,
    });
    pad.tick();
    assert.equal(polled, 0);
    assert.equal(aims.at(-1), false);
    pad.dispose();
  });

  it('reports pad activity from sticks, triggers, and button edges', () => {
    assert.equal(padHasActivity({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, []), false);
    assert.equal(padHasActivity({ lx: STICK_DEADZONE + 0.02, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, []), true);
    const diag = STICK_DEADZONE - 0.03;
    assert.equal(padHasActivity({ lx: diag, ly: diag, rx: 0, ry: 0, lt: 0, rt: 0 }, []), true);
    assert.equal(padHasActivity({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0.8, rt: 0 }, []), true);
    const edges = [];
    edges[PAD.A] = true;
    assert.equal(padHasActivity({ lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, edges), true);
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

  it('notifies activity on stick throw, not an idle connected pad', () => {
    const hits = [];
    let pads = [stdPad({ axes: [0, 0, 0, 0], buttons: [] })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: menuDoc().doc,
      getGamepads: () => pads,
      onActivity: () => hits.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(hits.length, 0);

    pads = [stdPad({ axes: [0.9, 0, 0, 0], buttons: [] })];
    pad.tick();
    assert.equal(hits.length, 1);
    pad.dispose();
  });

  it('reclaims a mouse yield on a button or a fresh stick throw, not a held stick', () => {
    const idle = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    const held = { ...idle, lx: 0.95 };
    const rest = { ...idle, lx: STICK_DEADZONE + 0.02 };
    const edges = [];
    edges[PAD.B] = true;
    assert.equal(padCanReclaimFromPointer(held, [], false), false);
    assert.equal(padCanReclaimFromPointer(held, [], true), true);
    assert.equal(padCanReclaimFromPointer(held, edges, false), true);
    assert.equal(padCanReclaimFromPointer(idle, [], true), false);
    assert.equal(padCanReclaimFromPointer(rest, [], true), false);
    assert.ok(rest.lx < STICK_RECLAIM);
  });

  it('hides the field cursor on a pointer yield and ignores a held stick', () => {
    const aims = [];
    const hits = [];
    const cursors = [];
    let axes = [0.95, 0, 0, 0];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: menuDoc().doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onAim: (on) => aims.push(on),
      onActivity: () => hits.push(1),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    pad.tick();
    assert.equal(aims.at(-1), true);
    const activityBefore = hits.length;
    assert.ok(cursors.at(-1)[0] > 0);

    pad.yieldToPointer();
    assert.equal(aims.at(-1), false);
    assert.deepEqual(cursors.at(-1), [0, 0]);

    pad.tick();
    pad.tick();
    assert.equal(aims.at(-1), false);
    assert.equal(hits.length, activityBefore);
    assert.deepEqual(cursors.at(-1), [0, 0]);

    axes = [0, 0, 0, 0];
    pad.tick();
    assert.equal(aims.at(-1), false);

    axes = [0.95, 0, 0, 0];
    pad.tick();
    assert.equal(aims.at(-1), true);
    assert.ok(hits.length > activityBefore);
    pad.dispose();
  });

  it('reclaims a pointer yield on a button even if the stick is still held', () => {
    const aims = [];
    let buttons = [];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: menuDoc().doc,
      getGamepads: () => [stdPad({ axes: [0.95, 0, 0, 0], buttons })],
      onAim: (on) => aims.push(on),
      autoStart: false,
    });
    pad.tick();
    pad.yieldToPointer();
    assert.equal(aims.at(-1), false);
    const b = [];
    b[PAD.B] = btn(true);
    buttons = b;
    pad.tick();
    assert.equal(aims.at(-1), true);
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

  it('parks the leash when the stick recenters', () => {
    const cursors = [];
    const { doc } = menuDoc();
    let axes = [1, 0, 0, 0];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    pad.tick();
    const thrown = cursors.at(-1)[0];
    assert.ok(thrown > 0);

    axes = [0, 0, 0, 0];
    pad.tick();
    pad.tick();
    assert.equal(cursors.at(-1)[0], thrown);

    axes = [1, 0, 0, 0];
    pad.tick();
    assert.ok(cursors.at(-1)[0] > thrown);
    pad.dispose();
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

  it('opposite up/down yaws; out/in zooms; same-way throws do not', () => {
    const rotates = [];
    const zooms = [];
    const { doc } = menuDoc();
    let axes = [0, -0.5, 0, 0.5];
    const pad = createGamepadAdapter({
      camera: {
        nudgeLookPan() {},
        nudgeRotate(a) { rotates.push(a); },
        nudgeZoom(z) { zooms.push(z); },
      },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      autoStart: false,
    });
    pad.tick();
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] < 0);
    assert.ok(Math.abs(rotates[0]) >= STICK_SPLIT_YAW * STICK_SPLIT_MIN * 0.5);
    assert.equal(zooms.length, 0);

    rotates.length = 0;
    axes = [0, 0.5, 0, -0.5];
    pad.tick();
    assert.equal(rotates.length, 1);
    assert.ok(rotates[0] > 0);

    rotates.length = 0;
    axes = [-0.5, 0, 0.5, 0];
    pad.tick();
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 1);
    assert.ok(zooms[0] < 0);
    assert.ok(Math.abs(zooms[0]) >= STICK_SPLIT_ZOOM);

    zooms.length = 0;
    axes = [0.5, 0, -0.5, 0];
    pad.tick();
    assert.equal(zooms.length, 1);
    assert.ok(zooms[0] > 0);

    rotates.length = 0;
    zooms.length = 0;
    axes = [1, 0, 1, 0];
    pad.tick();
    assert.equal(rotates.length, 0);
    assert.equal(zooms.length, 0);
    pad.dispose();
  });

  it('homes the field target while a split is held', () => {
    const cursors = [];
    const { doc } = menuDoc();
    let axes = [1, 0, 0, 0];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {}, nudgeRotate() {}, nudgeZoom() {} },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      getViewport: () => ({ width: 800, height: 600 }),
      onCursor: (ox, oy) => cursors.push([ox, oy]),
      autoStart: false,
    });
    for (let i = 0; i < 8; i++) pad.tick();
    const thrown = Math.hypot(cursors.at(-1)[0], cursors.at(-1)[1]);
    assert.ok(thrown > 40);

    axes = [0, -0.8, 0, 0.8];
    for (let i = 0; i < 10; i++) pad.tick();
    const homed = Math.hypot(cursors.at(-1)[0], cursors.at(-1)[1]);
    assert.ok(homed < thrown * 0.25);
    pad.dispose();
  });

  it('reports both bumpers on the select chord', () => {
    const chords = [];
    const { doc } = menuDoc();
    const both = [];
    both[PAD.LB] = btn(true);
    both[PAD.RB] = btn(true);
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ buttons: both })],
      onSelectStart: (c) => chords.push(['start', !!c?.both]),
      onSelectHold: (c) => chords.push(['hold', !!c?.both]),
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(chords[0], ['start', true]);
    assert.deepEqual(chords[1], ['hold', true]);
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

  it('a lone stick still tabs the menu', () => {
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

  it('sticks aim an open radial; A confirms and B cancels', () => {
    const pans = [];
    const hovers = [];
    const confirms = [];
    const cancels = [];
    const { doc } = menuDoc();
    const targets = {
      inner: [{ kind: 'category', id: 'basic', ang: -Math.PI / 2 }],
      outer: [{ kind: 'building', id: 'house', ang: -Math.PI / 2 }],
    };
    const a = [];
    a[PAD.A] = btn(true);
    let pads = [stdPad({ axes: [0, -0.45, 0, 0], buttons: a })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() { pans.push(1); } },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      radialOpen: () => true,
      getRadialTargets: () => targets,
      onRadialHover: (pick) => hovers.push(pick),
      onRadialConfirm: (pick) => confirms.push(pick),
      onRadialCancel: () => cancels.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(pans, []);
    assert.equal(hovers.at(-1)?.kind, 'category');
    assert.equal(hovers.at(-1)?.id, 'basic');
    assert.equal(confirms.at(-1)?.id, 'basic');

    const b = [];
    b[PAD.B] = btn(true);
    pads = [stdPad({ axes: [0, -0.9, 0, 0], buttons: b })];
    pad.tick();
    assert.equal(hovers.at(-1)?.kind, 'building');
    assert.equal(cancels.length, 1);
    pad.dispose();
  });

  it('both sticks pan while a radial is open; a lone stick still aims', () => {
    const pans = [];
    const zooms = [];
    const hovers = [];
    const { doc } = menuDoc();
    const targets = {
      inner: [{ kind: 'category', id: 'basic', ang: -Math.PI / 2 }],
      outer: [{ kind: 'building', id: 'house', ang: 0 }],
    };
    let axes = [0, 0, 1, 0];
    const pad = createGamepadAdapter({
      camera: {
        nudgeLookPan() { pans.push(1); },
        zoomBy(z) { zooms.push(z); },
        nudgeZoom(z) { zooms.push(z); },
      },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes, buttons: [] })],
      radialOpen: () => true,
      getRadialTargets: () => targets,
      onRadialHover: (pick) => hovers.push(pick),
      autoStart: false,
    });
    pad.tick();
    assert.equal(pans.length, 0);
    assert.ok(hovers.at(-1));

    pans.length = 0;
    axes = [0, -0.45, 0, 0];
    pad.tick();
    assert.equal(pans.length, 0);
    assert.equal(hovers.at(-1)?.id, 'basic');

    pans.length = 0;
    axes = [1, 0, 1, 0];
    pad.tick();
    assert.equal(pans.length, 1);

    pans.length = 0;
    zooms.length = 0;
    axes = [-0.5, 0, 0.5, 0];
    pad.tick();
    assert.equal(zooms.length, 1);
    assert.ok(zooms[0] < 0);
    pad.dispose();
  });

  it('LT confirms an aimed radial slice', () => {
    const confirms = [];
    const { doc } = menuDoc();
    const targets = {
      inner: [{ kind: 'category', id: 'basic', ang: -Math.PI / 2 }],
      outer: [{ kind: 'building', id: 'house', ang: -Math.PI / 2 }],
    };
    const lt = [];
    lt[PAD.LT] = btn(true);
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => [stdPad({ axes: [0, -0.45, 0, 0], buttons: lt })],
      radialOpen: () => true,
      getRadialTargets: () => targets,
      onRadialConfirm: (pick) => confirms.push(pick),
      autoStart: false,
    });
    pad.tick();
    assert.equal(confirms.at(-1)?.id, 'basic');
    pad.dispose();
  });

  it('place overlay keeps pad aim after a pointer yield', () => {
    const aims = [];
    const confirms = [];
    const rotates = [];
    const { doc } = menuDoc();
    const a = [];
    a[PAD.A] = btn(true);
    const lb = [];
    lb[PAD.LB] = btn(true);
    let pads = [stdPad({ axes: [1, 0, 0, 0], buttons: [] })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      placing: () => true,
      onPlaceAim: () => aims.push(1),
      onPlaceConfirm: () => confirms.push(1),
      onPlaceRotateDrag: () => rotates.push(1),
      autoStart: false,
    });
    pad.yieldToPointer();
    pad.tick();
    assert.equal(aims.length, 1);
    assert.equal(confirms.length, 0);

    pads = [stdPad({ axes: [1, 0, 0, 0], buttons: a })];
    pad.tick();
    assert.equal(confirms.length, 1);

    pads = [stdPad({ axes: [1, 0, 0, 0], buttons: lb })];
    pad.tick();
    assert.deepEqual(rotates, [1]);
    pad.dispose();
  });

  it('while placing, sticks still aim; A/LT stamp, B cancels, bumpers drag-yaw', () => {
    const pans = [];
    const aims = [];
    const confirms = [];
    const cancels = [];
    const rotates = [];
    const attacks = [];
    const { doc } = menuDoc();
    const a = [];
    a[PAD.A] = btn(true);
    let pads = [stdPad({ axes: [1, 0, 0, 0], buttons: a })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() { pans.push(1); } },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      placing: () => true,
      onPlaceAim: () => aims.push(1),
      onPlaceConfirm: () => confirms.push(1),
      onPlaceCancel: () => cancels.push(1),
      onPlaceRotateDrag: () => rotates.push(1),
      onAttackMove: () => attacks.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(pans.length, 1);
    assert.equal(aims.length, 1);
    assert.equal(confirms.length, 1);
    assert.equal(attacks.length, 0);

    const b = [];
    b[PAD.B] = btn(true);
    pads = [stdPad({ buttons: b })];
    pad.tick();
    assert.equal(cancels.length, 1);
    assert.equal(aims.length, 2);

    const lb = [];
    lb[PAD.LB] = btn(true);
    pads = [stdPad({ axes: [1, 0, 0, 0], buttons: lb })];
    pad.tick();
    assert.deepEqual(rotates, [1]);
    assert.equal(aims.length, 2);

    const rt = [];
    rt[PAD.RT] = btn(true);
    pads = [stdPad({ buttons: rt })];
    pad.tick();
    assert.equal(confirms.length, 2);
    pad.dispose();
  });

  it('U/R/D and Y/X/A press and release control groups in play, not in the menu', () => {
    const downs = [];
    const ups = [];
    const { doc, side } = menuDoc();
    const up = [];
    up[PAD.UP] = btn(true);
    let pads = [stdPad({ buttons: up })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onControlGroupDown: (id) => downs.push(id),
      onControlGroupUp: (id) => ups.push(id),
      autoStart: false,
    });
    pad.tick();
    assert.deepEqual(downs, [0]);
    pads = [stdPad({ buttons: [] })];
    pad.tick();
    assert.deepEqual(ups, [0]);

    const face = [];
    face[PAD.Y] = btn(true);
    face[PAD.X] = btn(true);
    face[PAD.A] = btn(true);
    pads = [stdPad({ buttons: face })];
    pad.tick();
    assert.deepEqual(downs.slice(1), [2, 3, 5]);

    side.classList.add('is-open');
    const right = [];
    right[PAD.RIGHT] = btn(true);
    pads = [stdPad({ buttons: right })];
    pad.tick();
    assert.deepEqual(downs, [0, 2, 3, 5]);
    pad.dispose();
  });

  it('cancels a held control group when the menu opens', () => {
    const cancels = [];
    const { doc, side, menuBtn } = menuDoc();
    const y = [];
    y[PAD.Y] = btn(true);
    let pads = [stdPad({ buttons: y })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onControlGroupDown: () => {},
      onControlGroupCancel: () => cancels.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(cancels.length, 0);
    menuBtn.click();
    assert.equal(side.classList.contains('is-open'), true);
    pad.tick();
    assert.equal(cancels.length, 1);
    pad.dispose();
  });

  it('B and D-pad Left cast on press, not hold or in the menu', () => {
    const casts = [];
    const { doc, side } = menuDoc();
    const b = [];
    b[PAD.B] = btn(true);
    let pads = [stdPad({ buttons: b })];
    const pad = createGamepadAdapter({
      camera: { nudgeLookPan() {} },
      active: () => true,
      root: doc,
      getGamepads: () => pads,
      onCast: () => casts.push(1),
      autoStart: false,
    });
    pad.tick();
    assert.equal(casts.length, 1);
    pad.tick();
    assert.equal(casts.length, 1);

    const left = [];
    left[PAD.LEFT] = btn(true);
    pads = [stdPad({ buttons: left })];
    pad.tick();
    assert.equal(casts.length, 2);

    side.classList.add('is-open');
    const both = [];
    both[PAD.B] = btn(true);
    both[PAD.LEFT] = btn(true);
    pads = [stdPad({ buttons: both })];
    pad.tick();
    assert.equal(casts.length, 2);
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
