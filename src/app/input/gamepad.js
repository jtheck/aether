// Standard-mapping gamepad (Xbox 360 indices). Camera sticks + menu tab only.
// DualSense / Switch / Series pads work when the browser sets mapping === 'standard'.

import { isCameraFollowTypingTarget } from './cameraFollow.js';

export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

export const STICK_DEADZONE = 0.18;
export const STICK_NAV_DEADZONE = 0.55;
export const NAV_INITIAL_MS = 320;
export const NAV_REPEAT_MS = 160;
const ROT_SENS = 0.08;
const ZOOM_SENS = 0.55;

export const MENU_FOCUS_SEL = 'button, input, select, textarea, #settings_b';

/**
 * @param {unknown} pads
 * @returns {Gamepad | null}
 */
export function pickStandardGamepad(pads) {
  if (!pads) return null;
  for (const pad of pads) {
    if (pad && pad.connected !== false && pad.mapping === 'standard') return pad;
  }
  return null;
}

/** Rescale a stick axis so the deadzone is zero and full throw is still 1. */
export function deadzone(v, dz = STICK_DEADZONE) {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

function buttonValue(b) {
  if (b == null) return 0;
  if (typeof b === 'boolean') return b ? 1 : 0;
  if (typeof b === 'number') return Number.isFinite(b) ? b : 0;
  if (typeof b.value === 'number') return b.value;
  return b.pressed ? 1 : 0;
}

function buttonOn(b) {
  return buttonValue(b) > 0.5;
}

/**
 * @param {Gamepad} pad
 * @returns {{ lx: number, ly: number, rx: number, ry: number, lt: number, rt: number, buttons: boolean[] }}
 */
export function readStandardPad(pad) {
  const axes = pad?.axes ?? [];
  const src = pad?.buttons ?? [];
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons[i] = buttonOn(src[i]);
  return {
    lx: axes[0] ?? 0,
    ly: axes[1] ?? 0,
    rx: axes[2] ?? 0,
    ry: axes[3] ?? 0,
    lt: buttonValue(src[PAD.LT]),
    rt: buttonValue(src[PAD.RT]),
    buttons,
  };
}

/** @param {boolean[]} cur @param {boolean[]} prev */
export function buttonEdges(cur, prev) {
  const down = [];
  const n = Math.max(cur?.length ?? 0, prev?.length ?? 0);
  for (let i = 0; i < n; i++) down[i] = !!(cur?.[i] && !prev?.[i]);
  return down;
}

export function canAdjustMenuEl(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'checkbox');
}

/**
 * D-pad + left stick → tab / slider step. Horizontal becomes adjust on range/select.
 * @param {{ lx: number, ly: number, buttons: boolean[] }} read
 * @param {Element | null} focused
 */
export function menuNavIntent(read, focused) {
  const horizAdjust = canAdjustMenuEl(focused);
  let tab = 0;
  let adj = 0;
  const b = read?.buttons ?? [];
  if (b[PAD.UP]) tab = -1;
  if (b[PAD.DOWN]) tab = 1;
  if (b[PAD.LEFT]) {
    if (horizAdjust) adj = -1;
    else tab = -1;
  }
  if (b[PAD.RIGHT]) {
    if (horizAdjust) adj = 1;
    else tab = 1;
  }
  const lx = deadzone(read?.lx ?? 0, STICK_NAV_DEADZONE);
  const ly = deadzone(read?.ly ?? 0, STICK_NAV_DEADZONE);
  if (Math.abs(ly) >= Math.abs(lx) && ly) tab = ly > 0 ? 1 : -1;
  else if (lx) {
    if (horizAdjust) adj = lx > 0 ? 1 : -1;
    else tab = lx > 0 ? 1 : -1;
  }
  if (horizAdjust) {
    if (b[PAD.LB]) adj = -1;
    if (b[PAD.RB]) adj = 1;
  }
  return { tab, adj };
}

/**
 * @param {number} dir
 * @param {number} prevDir
 * @param {number} t
 * @param {number} heldAt
 * @param {number} lastAt
 */
export function heldRepeat(dir, prevDir, t, heldAt, lastAt, initial = NAV_INITIAL_MS, repeat = NAV_REPEAT_MS) {
  if (!dir) return { fire: false, heldAt: 0, lastAt: 0 };
  if (dir !== prevDir) return { fire: true, heldAt: t, lastAt: t };
  if (t - heldAt >= initial && t - lastAt >= repeat) return { fire: true, heldAt, lastAt: t };
  return { fire: false, heldAt, lastAt };
}

export function isMenuFocusable(el, root) {
  if (!el || el.disabled) return false;
  if (el.hidden) return false;
  if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'file')) return false;
  let n = el;
  while (n) {
    if (n !== el && n.hidden) return false;
    if (n.getAttribute?.('aria-hidden') === 'true' && n !== root) return false;
    const cl = n.classList;
    if (cl?.contains?.('page') && !cl.contains('is-active')) return false;
    if (cl?.contains?.('is-dimmed')) return false;
    if (n === root) break;
    n = n.parentElement;
  }
  return true;
}

export function listMenuFocusables(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(MENU_FOCUS_SEL)].filter((el) => isMenuFocusable(el, root));
}

export function activeMenuRoot(doc) {
  if (!doc?.getElementById) return null;
  const side = doc.getElementById('side_menu');
  if (side?.classList?.contains('is-open')) return side;
  const lobby = doc.getElementById('match-lobby-overlay');
  if (lobby && !lobby.hidden && !lobby.classList?.contains('is-parked')) return lobby;
  return null;
}

function fire(el, type, Ev) {
  if (typeof el.dispatchEvent === 'function' && typeof Ev === 'function') {
    el.dispatchEvent(new Ev(type, { bubbles: true }));
  }
}

function cycleSelect(el, dir, Ev) {
  const n = el.options?.length | 0;
  if (!n) return false;
  const i = ((el.selectedIndex | 0) + dir + n) % n;
  el.selectedIndex = i;
  const opt = el.options[i];
  if (opt && typeof opt === 'object' && 'value' in opt) el.value = opt.value;
  fire(el, 'change', Ev);
  return true;
}

export function activateMenuEl(el, Ev = globalThis.Event) {
  if (!el) return false;
  if (el.tagName === 'SELECT') return cycleSelect(el, 1, Ev);
  if (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'text')) return false;
  el.click?.();
  return true;
}

export function adjustMenuEl(el, dir, Ev = globalThis.Event) {
  if (!el || !dir) return false;
  if (el.tagName === 'SELECT') return cycleSelect(el, dir, Ev);
  if (el.tagName === 'INPUT' && el.type === 'checkbox') {
    el.click?.();
    return true;
  }
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const step = Number(el.step) || 1;
    const min = Number(el.min);
    const max = Number(el.max);
    let v = Number(el.value) + dir * step;
    if (Number.isFinite(min)) v = Math.max(min, v);
    if (Number.isFinite(max)) v = Math.min(max, v);
    el.value = String(v);
    fire(el, 'input', Ev);
    fire(el, 'change', Ev);
    return true;
  }
  return false;
}

export function stepMenuFocus(items, current, dir) {
  if (!items?.length || !dir) return null;
  let i = items.indexOf(current);
  if (i < 0) i = dir > 0 ? -1 : 0;
  const next = items[(i + dir + items.length) % items.length];
  next?.focus?.();
  next?.scrollIntoView?.({ block: 'nearest' });
  return next ?? null;
}

function applyCamera(camera, read) {
  if (!camera) return;
  const lx = deadzone(read.lx);
  const ly = deadzone(read.ly);
  const rx = deadzone(read.rx);
  const ry = deadzone(read.ry);
  if (lx || ly) camera.nudgeLookPan?.(-lx || 0, -ly || 0);
  if (rx) camera.nudgeRotate?.(-rx * ROT_SENS);
  if (ry) camera.nudgeZoom?.(ry * ZOOM_SENS);
}

function clickMenuToggle(doc, open) {
  const menu = doc?.getElementById?.('side_menu');
  const isOpen = !!menu?.classList?.contains('is-open');
  if (open === isOpen) return isOpen;
  const btn = doc.getElementById('menu_b');
  if (btn && !btn.hidden) {
    btn.click();
    return !!menu?.classList?.contains('is-open');
  }
  doc.getElementById('graffiti_b')?.click?.();
  return !!menu?.classList?.contains('is-open');
}

function blurInside(root, doc) {
  const active = doc?.activeElement;
  if (active && root?.contains?.(active)) active.blur?.();
}

function showMenuMain(doc) {
  const gear = doc.getElementById('settings_b');
  const page = doc.querySelector?.('#side_menu .page.is-active')?.dataset?.page
    ?? doc.getElementById('side_menu')?.querySelector?.('.page.is-active')?.dataset?.page;
  if (page === 'settings') gear?.click?.();
}

/**
 * @param {object} [opts]
 * @param {object} [opts.camera]
 * @param {() => boolean} [opts.active]
 * @param {Document} [opts.root]
 * @param {() => ArrayLike<Gamepad | null>} [opts.getGamepads]
 * @param {() => number} [opts.now]
 * @param {(fn: FrameRequestCallback) => number} [opts.raf]
 * @param {(id: number) => void} [opts.caf]
 * @param {boolean} [opts.autoStart]
 * @param {(read: object) => void} [opts.applyPlay] — default RTS nudge* camera
 * @param {() => void} [opts.onIdle]
 * @param {(doc: Document) => Element | null} [opts.menuRoot]
 * @param {(root: Element | null) => Element[]} [opts.listFocusables]
 * @param {boolean} [opts.menuExclusive] — when true (default), sticks stop while a menu is open
 * @param {boolean} [opts.stickMenuNav] — left stick tabs (default true)
 * @param {(el: Element | null) => boolean} [opts.isTyping]
 */
export function createGamepadAdapter(opts = {}) {
  const camera = opts.camera;
  const active = opts.active;
  const applyPlay = opts.applyPlay ?? ((read) => applyCamera(camera, read));
  const menuExclusive = opts.menuExclusive !== false;
  const stickMenuNav = opts.stickMenuNav !== false;
  const isTyping = opts.isTyping ?? isCameraFollowTypingTarget;
  const root = opts.root ?? (typeof document !== 'undefined' ? document : null);
  const resolveMenuRoot = opts.menuRoot ?? (() => activeMenuRoot(root));
  const listFocusables = opts.listFocusables ?? listMenuFocusables;
  const getGamepads = opts.getGamepads ?? (() => (
    typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  ));
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const raf = opts.raf ?? ((fn) => (
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0
  ));
  const caf = opts.caf ?? ((id) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  });

  let prevButtons = [];
  let prevTab = 0;
  let prevAdj = 0;
  let tabHeldAt = 0;
  let tabLastAt = 0;
  let adjHeldAt = 0;
  let adjLastAt = 0;
  let rafId = 0;

  function resetEdges() {
    prevButtons = [];
    prevTab = 0;
    prevAdj = 0;
    tabHeldAt = 0;
    tabLastAt = 0;
    adjHeldAt = 0;
    adjLastAt = 0;
  }

  function handleMenu(menuRoot, read, edges, t) {
    if (edges[PAD.START] || edges[PAD.BACK]) {
      blurInside(menuRoot, root);
      clickMenuToggle(root, false);
      return;
    }
    if (edges[PAD.B]) {
      const page = menuRoot.querySelector?.('.page.is-active')?.dataset?.page;
      if (page === 'settings') {
        showMenuMain(root);
        return;
      }
      if (menuRoot.id === 'side_menu') {
        blurInside(menuRoot, root);
        clickMenuToggle(root, false);
      }
      return;
    }

    const items = listFocusables(menuRoot);
    const focused = items.includes(root?.activeElement) ? root.activeElement : null;
    const navRead = stickMenuNav ? read : { ...read, lx: 0, ly: 0 };
    const intent = menuNavIntent(navRead, focused);
    const tabRep = heldRepeat(intent.tab, prevTab, t, tabHeldAt, tabLastAt);
    const adjRep = heldRepeat(intent.adj, prevAdj, t, adjHeldAt, adjLastAt);
    prevTab = intent.tab;
    prevAdj = intent.adj;
    tabHeldAt = tabRep.heldAt;
    tabLastAt = tabRep.lastAt;
    adjHeldAt = adjRep.heldAt;
    adjLastAt = adjRep.lastAt;

    if (tabRep.fire) stepMenuFocus(items, focused ?? root?.activeElement, intent.tab);
    if (adjRep.fire && focused) adjustMenuEl(focused, intent.adj);

    if (edges[PAD.A]) {
      const after = listFocusables(menuRoot);
      const cur = after.includes(root?.activeElement) ? root.activeElement : null;
      if (!cur) stepMenuFocus(after, null, 1);
      else activateMenuEl(cur);
    }
  }

  function tick() {
    const pad = pickStandardGamepad(getGamepads());
    if (!pad) {
      resetEdges();
      opts.onIdle?.();
      return;
    }
    const read = readStandardPad(pad);
    const edges = buttonEdges(read.buttons, prevButtons);
    prevButtons = read.buttons;
    const t = now();
    const menuRoot = resolveMenuRoot(root);

    if (menuRoot) {
      handleMenu(menuRoot, read, edges, t);
      if (menuExclusive) return;
    }

    if (!menuRoot && (edges[PAD.START] || edges[PAD.BACK])) {
      const opened = clickMenuToggle(root, true);
      if (opened) {
        const openedRoot = resolveMenuRoot(root);
        const items = listFocusables(openedRoot);
        if (items[0]) items[0].focus?.();
        if (menuExclusive) return;
      }
    }

    if (!(active?.() ?? true)) return;
    if (isTyping(root?.activeElement)) return;
    applyPlay(read);
  }

  function loop() {
    rafId = raf(loop);
    tick();
  }

  function onLost() {
    resetEdges();
  }

  if (opts.autoStart !== false) loop();

  const win = opts.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = root && typeof root.addEventListener === 'function' ? root : null;
  win?.addEventListener?.('gamepaddisconnected', onLost);
  win?.addEventListener?.('blur', onLost);
  doc?.addEventListener?.('visibilitychange', onLost);

  return {
    tick,
    dispose() {
      if (rafId) caf(rafId);
      rafId = 0;
      win?.removeEventListener?.('gamepaddisconnected', onLost);
      win?.removeEventListener?.('blur', onLost);
      doc?.removeEventListener?.('visibilitychange', onLost);
      resetEdges();
    },
  };
}
