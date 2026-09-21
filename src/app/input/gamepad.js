// Standard-mapping gamepad (Xbox 360 indices). Camera sticks + menu tab.
// DualSense / Switch / Series pads work when the browser sets mapping === 'standard'.
// Both sticks look/aim. Opposite up/down yaws (LS up + RS down = right);
// pinch (LS→ RS←) zooms out, open (LS← RS→) zooms in. Both throws feed the speed.
// A split hold damps look and homes the field target.
// L3 or R3 puts both sticks into rotate/zoom. HUD menus keep those gestures:
// pan only when both sticks are in; a lone stick still tabs. An open agora /
// action radial aims with a lone stick (A / LT / RT confirm, B back); both
// sticks still pan. Ghost-place: aim walks the ghost, A / LT / RT stamp, B
// cancels, LB / RB + stick drag yaws (not bumper taps). Play reports onAim
// so a field cursor can roam the view
// (stick moves, release parks), then camera at the edges. Mouse / pointer
// use yields that mark until a new button or a fresh stick throw — a held
// stick or worn rest must not steal the camera back. LT / RT issue orders
// at that aim (A-move / force-move) unless a menu, radial, or place overlay
// owns them. LB / RB paint-select (brush lasso; both bumpers double the
// max radius).
// D-pad U/R/D and Y/X/A are the left/right control-group stacks (tap / hold /
// second-tap jump). B and D-pad Left cast at the aim. Menu A on a text field
// opens the in-game keyboard. On that keyboard, D-pad and both sticks walk the
// key grid; LB / RB backspace.

import { leashLimit, settleCursorLeash, stepCursorLeash } from './gamepadCursor.js';
import { radialStickPick } from './radialStick.js';
import { OS_KBD_ID, closeOsKbd, listOsKbdKeys, osKbdRoot, pressOsKbdAction, stepOsKbdFocus } from '../osKbd.js';

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
/** After a live throw, stay “held” down to this mag so a worn rest does not recenter. */
export const STICK_DEADZONE_LEAVE = 0.1;
/** Remapped |axis| — about a half throw after the look deadzone. */
export const STICK_SPLIT_HALF = 0.28;
/** Speed at the half gate; late throw opens up (squared). */
export const STICK_SPLIT_MIN = 0.32;
/** Yaw rad/frame once both sticks oppose on Y. */
export const STICK_SPLIT_YAW = 0.09;
/** Fraction of camera radius per frame once both sticks oppose on X. */
export const STICK_SPLIT_ZOOM = 0.024;
/** Look/aim scale while a split yaw or zoom is live. */
export const STICK_SPLIT_LOOK = 0.18;
/** Remain per frame while a split homes the field target. */
export const STICK_SPLIT_HOME = 0.82;
export const STICK_ROT_DEADZONE = 0.08;
export const STICK_NAV_DEADZONE = 0.55;
export const NAV_INITIAL_MS = 320;
export const NAV_REPEAT_MS = 160;
const ROT_SENS = 0.023;
const ZOOM_SENS = 0.85;

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

/** @param {number} [x] @param {number} [y] */
export function stickMagnitude(x, y) {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  return Math.hypot(ax, ay);
}

/**
 * Hysteresis around the look deadzone. Enter is the usual hole; leave is lower
 * so a sloppy spring-back does not count as a release.
 * @param {number} mag
 * @param {boolean} wasLive
 * @param {number} [enter]
 * @param {number} [leave]
 */
export function stickHeld(mag, wasLive, enter = STICK_DEADZONE, leave = STICK_DEADZONE_LEAVE) {
  return (Number.isFinite(mag) ? mag : 0) > (wasLive ? leave : enter);
}

/**
 * Circular look deadzone. Per-axis gating zeros a slow diagonal (each axis
 * under the hole, hypot still live) and yanks the leash home mid-draw.
 * @param {number} x
 * @param {number} y
 * @param {number} [dz]
 */
export function lookStickPair(x, y, dz = STICK_DEADZONE) {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(ax, ay);
  if (!(mag > dz)) return { x: 0, y: 0, mag, live: false };
  const t = (mag - dz) / (1 - dz);
  const scale = t / mag;
  return { x: ax * scale, y: ay * scale, mag, live: true };
}

/**
 * Radial rotate/zoom stick. Gate on magnitude, remap the remaining throw, then
 * sqrt so a light deflection uses more of the slow max rate.
 * @param {number} x
 * @param {number} y
 * @param {number} [dz]
 */
export function rotStickPair(x, y, dz = STICK_ROT_DEADZONE) {
  const ax = Number.isFinite(x) ? x : 0;
  const ay = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(ax, ay);
  if (!(mag > dz)) return { x: 0, y: 0 };
  const t = (mag - dz) / (1 - dz);
  const eased = Math.sqrt(t > 1 ? 1 : t < 0 ? 0 : t);
  const scale = eased / mag;
  return { x: ax * scale, y: ay * scale };
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

/** Play-order edges: LT = attack-move, RT = force-move. */
export function playOrderIntent(edges) {
  return {
    attackMove: !!edges?.[PAD.LT],
    forceMove: !!edges?.[PAD.RT],
  };
}

/** Tabbed / minimized. Do not use hasFocus — a pad cannot steal the document back. */
export function padShouldYield(doc) {
  return !!doc?.hidden;
}

/**
 * Stick throw, trigger pull, or a fresh button press — not a connected idle pad.
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number, lt?: number, rt?: number } | null | undefined} read
 * @param {boolean[] | null | undefined} edges
 */
export function padHasActivity(read, edges) {
  const n = edges?.length ?? 0;
  for (let i = 0; i < n; i++) if (edges[i]) return true;
  if (lookStickPair(read?.lx, read?.ly).live || lookStickPair(read?.rx, read?.ry).live) {
    return true;
  }
  return (read?.lt ?? 0) > 0.5 || (read?.rt ?? 0) > 0.5;
}

/** After a mouse yield, ignore a sloppy rest; a real throw still reclaims. */
export const STICK_RECLAIM = 0.4;

/**
 * Button press always takes the pad back. A stick / trigger only does after
 * the throw has recentered — the hold that was live when the mouse moved
 * must not keep driving the camera.
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number, lt?: number, rt?: number } | null | undefined} read
 * @param {boolean[] | null | undefined} edges
 * @param {boolean} stickArmed
 */
export function padCanReclaimFromPointer(read, edges, stickArmed) {
  const n = edges?.length ?? 0;
  for (let i = 0; i < n; i++) if (edges[i]) return true;
  if (!stickArmed) return false;
  if (lookStickPair(read?.lx, read?.ly, STICK_RECLAIM).live) return true;
  if (lookStickPair(read?.rx, read?.ry, STICK_RECLAIM).live) return true;
  return (read?.lt ?? 0) > 0.5 || (read?.rt ?? 0) > 0.5;
}

/**
 * Left HUD stack (red / green / black) then right (blue / yellow / white).
 * U/R/D skip D-pad Left; Y/X/A skip B — those two leftover buttons cast.
 */
export const PAD_CONTROL_GROUP_BUTTONS = [
  [PAD.UP, 0],
  [PAD.RIGHT, 1],
  [PAD.DOWN, 4],
  [PAD.Y, 2],
  [PAD.X, 3],
  [PAD.A, 5],
];

/** @param {number} button */
export function controlGroupIdFromPad(button) {
  for (let i = 0; i < PAD_CONTROL_GROUP_BUTTONS.length; i++) {
    const pair = PAD_CONTROL_GROUP_BUTTONS[i];
    if (pair[0] === button) return pair[1];
  }
  return null;
}

/** Falling edges — hold-to-assign control groups need the release. */
export function buttonReleased(cur, prev) {
  const up = [];
  const n = Math.max(cur?.length ?? 0, prev?.length ?? 0);
  for (let i = 0; i < n; i++) up[i] = !!(!cur?.[i] && prev?.[i]);
  return up;
}

/**
 * Play control-group edges. Several downs/ups can land in one frame.
 * @param {boolean[]} downEdges
 * @param {boolean[]} upEdges
 */
export function playControlGroupIntent(downEdges, upEdges) {
  const downs = [];
  const ups = [];
  for (let i = 0; i < PAD_CONTROL_GROUP_BUTTONS.length; i++) {
    const [btn, id] = PAD_CONTROL_GROUP_BUTTONS[i];
    if (downEdges?.[btn]) downs.push(id);
    if (upEdges?.[btn]) ups.push(id);
  }
  return { downs, ups };
}

/** B or D-pad Left — cast primary ability at the aim. */
export function playCastIntent(edges) {
  return !!(edges?.[PAD.B] || edges?.[PAD.LEFT]);
}

/** A / LT / RT — activate a menu button, radial slice, or place stamp. */
export function playConfirmIntent(edges) {
  return !!(edges?.[PAD.A] || edges?.[PAD.LT] || edges?.[PAD.RT]);
}

/**
 * Ghost-place: confirm / cancel. Yaw is LB/RB + stick drag, not a bumper tap.
 * @param {boolean[]} edges
 */
export function placePadIntent(edges) {
  return {
    confirm: playConfirmIntent(edges),
    cancel: !!edges?.[PAD.B],
  };
}

/** Either bumper held — paint-select at the aim. */
export function playSelectHeld(buttons) {
  return !!(buttons?.[PAD.LB] || buttons?.[PAD.RB]);
}

/** Both bumpers — brush jumps to double the single-bumper max. */
export function playSelectBoth(buttons) {
  return !!(buttons?.[PAD.LB] && buttons?.[PAD.RB]);
}

/**
 * Both sticks live, opposite on one axis, each about half out → −1..1.
 * Speed uses both throws (mean |axis|), squared from the half gate to full.
 * `dir` is sign(b − a).
 * @param {number} a
 * @param {number} b
 * @param {boolean} live
 */
export function stickSplitOppose(a, b, live) {
  if (!live) return 0;
  const ax = Number.isFinite(a) ? a : 0;
  const bx = Number.isFinite(b) ? b : 0;
  if (ax * bx >= 0) return 0;
  const aa = Math.abs(ax);
  const bb = Math.abs(bx);
  if (aa < STICK_SPLIT_HALF || bb < STICK_SPLIT_HALF) return 0;
  const dir = Math.sign(bx - ax);
  if (!dir) return 0;
  const t = ((aa + bb) * 0.5 - STICK_SPLIT_HALF) / (1 - STICK_SPLIT_HALF);
  const u = t > 1 ? 1 : t < 0 ? 0 : t;
  return dir * (STICK_SPLIT_MIN + (1 - STICK_SPLIT_MIN) * u * u);
}

/**
 * Opposite up/down → −1..1 yaw. LS up + RS down is turn right.
 * @param {{ y?: number, live?: boolean } | null | undefined} left
 * @param {{ y?: number, live?: boolean } | null | undefined} right
 */
export function stickSplitRotate(left, right) {
  return stickSplitOppose(left?.y, right?.y, !!(left?.live && right?.live));
}

/**
 * Opposite out/in → −1..1 zoom. Pinch (LS→ RS←) is zoom out.
 * @param {{ x?: number, live?: boolean } | null | undefined} left
 * @param {{ x?: number, live?: boolean } | null | undefined} right
 */
export function stickSplitZoom(left, right) {
  return 0 - stickSplitOppose(left?.x, right?.x, !!(left?.live && right?.live));
}

/**
 * Split yaw/zoom, L3/R3, or both sticks looking the same way. A lone stick
 * still tabs / aims the pie; both engaged is camera.
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number, buttons?: boolean[] } | null | undefined} read
 */
export function stickCameraGesture(read) {
  const buttons = read?.buttons ?? [];
  if (buttons[PAD.L3] || buttons[PAD.R3]) return true;
  const left = lookStickPair(read?.lx, read?.ly);
  const right = lookStickPair(read?.rx, read?.ry);
  if (stickSplitRotate(left, right) || stickSplitZoom(left, right)) return true;
  return !!(left.live && right.live && left.x * right.x + left.y * right.y > 0);
}

/** Both-stick camera leaves the pie; a lone throw still aims with either stick. */
export function radialMenuRead(read) {
  if (!stickCameraGesture(read)) return read;
  return { ...read, lx: 0, ly: 0, rx: 0, ry: 0 };
}

/**
 * Both sticks look/aim. Opposite Y yaws; opposite X zooms.
 * L3 or R3 puts both sticks into rotate/zoom. A lone stick still tabs.
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number, buttons?: boolean[] }} read
 */
export function stickPlayAxes(read) {
  const buttons = read?.buttons ?? [];
  const look = !(buttons[PAD.L3] || buttons[PAD.R3]);
  if (look) {
    const left = lookStickPair(read?.lx, read?.ly);
    const right = lookStickPair(read?.rx, read?.ry);
    const splitYaw = stickSplitRotate(left, right);
    const splitZoom = stickSplitZoom(left, right);
    const lookScale = splitYaw || splitZoom ? STICK_SPLIT_LOOK : 1;
    return {
      lookX: (left.x + right.x) * lookScale,
      lookY: (left.y + right.y) * lookScale,
      rotX: 0,
      rotY: 0,
      splitYaw,
      splitZoom,
      bothLook: !!(left.live && right.live),
    };
  }
  const left = rotStickPair(read?.lx, read?.ly);
  const right = rotStickPair(read?.rx, read?.ry);
  return { lookX: 0, lookY: 0, rotX: left.x + right.x, rotY: left.y + right.y, splitYaw: 0, splitZoom: 0, bothLook: false };
}

export function canAdjustMenuEl(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'checkbox');
}

/**
 * D-pad + either stick → tab / slider step. Horizontal becomes adjust on range/select.
 * @param {{ lx: number, ly: number, rx?: number, ry?: number, buttons: boolean[] }} read
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
  const rx = deadzone(read?.rx ?? 0, STICK_NAV_DEADZONE);
  const ry = deadzone(read?.ry ?? 0, STICK_NAV_DEADZONE);
  const x = lx + rx;
  const y = ly + ry;
  if (Math.abs(y) >= Math.abs(x) && y) tab = y > 0 ? 1 : -1;
  else if (x) {
    if (horizAdjust) adj = x > 0 ? 1 : -1;
    else tab = x > 0 ? 1 : -1;
  }
  if (horizAdjust) {
    if (b[PAD.LB]) adj = -1;
    if (b[PAD.RB]) adj = 1;
  }
  return { tab, adj };
}

/**
 * Keyboard grid: D-pad and either stick. Dominant axis wins so diagonals do not
 * skip a cell. Bumpers are backspace (see osKbdBackspaceHeld).
 */
export function osKbdNavIntent(read) {
  const b = read?.buttons ?? [];
  let dx = 0;
  let dy = 0;
  if (b[PAD.LEFT]) dx = -1;
  if (b[PAD.RIGHT]) dx = 1;
  if (b[PAD.UP]) dy = -1;
  if (b[PAD.DOWN]) dy = 1;
  const lx = deadzone(read?.lx ?? 0, STICK_NAV_DEADZONE);
  const ly = deadzone(read?.ly ?? 0, STICK_NAV_DEADZONE);
  const rx = deadzone(read?.rx ?? 0, STICK_NAV_DEADZONE);
  const ry = deadzone(read?.ry ?? 0, STICK_NAV_DEADZONE);
  const x = lx + rx;
  const y = ly + ry;
  if (Math.abs(y) >= Math.abs(x) && y) dy = y > 0 ? 1 : -1;
  else if (x) dx = x > 0 ? 1 : -1;
  return { dx, dy };
}

export function osKbdNavCode(dx, dy) {
  if (dy) return dy > 0 ? 2 : -2;
  if (dx) return dx > 0 ? 1 : -1;
  return 0;
}

export function osKbdBackspaceHeld(read) {
  const b = read?.buttons ?? [];
  return !!(b[PAD.LB] || b[PAD.RB]);
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
  const kbd = osKbdRoot(doc) ?? doc.getElementById(OS_KBD_ID);
  if (kbd && !kbd.hidden) return kbd;
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

/** Text fields that A should edit (Steam / system keyboard), not click. */
export function isMenuTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const t = String(el.type || 'text').toLowerCase();
  return t === 'text' || t === 'search' || t === 'url' || t === 'email' || t === 'tel' || t === 'number';
}

export function activateMenuEl(el, Ev = globalThis.Event) {
  if (!el) return false;
  if (el.tagName === 'SELECT') return cycleSelect(el, 1, Ev);
  if (el.tagName === 'INPUT' && el.type === 'range') return false;
  if (isMenuTextField(el)) {
    el.focus?.();
    el.select?.();
    return true;
  }
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

function applyLookRotateZoom(camera, camLx, camLy, rx, ry, splitYaw, splitZoom) {
  if (!camera) return;
  if (camLx || camLy) camera.nudgeLookPan?.(-camLx || 0, -camLy || 0);
  if (rx) camera.nudgeRotate?.(-rx * ROT_SENS);
  // Immediate — a “little” nudge dies under the camera rotate/zoom floors.
  if (splitYaw) {
    const yaw = -splitYaw * STICK_SPLIT_YAW;
    if (typeof camera.rotateBy === 'function') camera.rotateBy(yaw);
    else camera.nudgeRotate?.(yaw);
  }
  if (splitZoom) {
    const r = camera.getRadius?.() ?? camera.radius ?? 80;
    const z = splitZoom * STICK_SPLIT_ZOOM * (Number(r) > 1 ? r : 80);
    if (typeof camera.zoomBy === 'function') camera.zoomBy(z);
    else camera.nudgeZoom?.(z);
  }
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
 * @param {(on: boolean) => void} [opts.onAim] — field cursor: true while a pad can play and has not yielded to the mouse
 * @param {() => void} [opts.onActivity] — stick / trigger / button press (hide OS cursor)
 * @param {(el: Element) => void} [opts.onTextEdit] — A on a text field (in-game keyboard)
 * @param {(ox: number, oy: number) => void} [opts.onCursor] — leash offset from view center
 * @param {() => { width?: number, height?: number } | null} [opts.getViewport]
 * @param {() => void} [opts.onAttackMove] — LT press
 * @param {() => void} [opts.onForceMove] — RT press
 * @param {() => void} [opts.onCast] — B / D-pad Left press
 * @param {(id: number) => void} [opts.onControlGroupDown] — U/R/D / Y/X/A press
 * @param {(id: number) => void} [opts.onControlGroupUp] — matching release
 * @param {() => void} [opts.onControlGroupCancel] — menu / idle / disconnect mid-hold
 * @param {(chord?: { both: boolean }) => void} [opts.onSelectStart] — LB / RB press
 * @param {(chord?: { both: boolean }) => void} [opts.onSelectHold] — LB / RB held (after sticks this frame)
 * @param {(chord?: { both: boolean }) => void} [opts.onSelectEnd] — LB / RB release
 * @param {() => void} [opts.onSelectCancel] — menu / idle / disconnect mid-drag
 * @param {(doc: Document) => Element | null} [opts.menuRoot]
 * @param {(root: Element | null) => Element[]} [opts.listFocusables]
 * @param {boolean} [opts.menuExclusive] — when true (default), play orders stop while a menu is open; camera gestures still apply
 * @param {boolean} [opts.stickMenuNav] — a lone stick tabs (default true)
 * @param {boolean | (() => boolean)} [opts.radialOpen] — world pie menu (agora / action)
 * @param {() => { inner?: object[], outer?: object[] } | null} [opts.getRadialTargets]
 * @param {(pick: object | null) => void} [opts.onRadialHover]
 * @param {(pick: object) => void} [opts.onRadialConfirm]
 * @param {() => void} [opts.onRadialCancel]
 * @param {() => boolean} [opts.yieldPad] — extra park (page hidden is already covered)
 * @param {boolean | (() => boolean)} [opts.placing] — ghost / rally place overlay
 * @param {() => void} [opts.onPlaceAim] — after sticks, walk the ghost to the aim
 * @param {() => void} [opts.onPlaceConfirm] — A / LT / RT
 * @param {() => void} [opts.onPlaceCancel] — B
 * @param {() => void} [opts.onPlaceRotateDrag] — LB/RB held, aim yaws the ghost
 * @param {(el: Element | null) => boolean} [opts.isTyping]
 */
export function createGamepadAdapter(opts = {}) {
  const camera = opts.camera;
  const active = opts.active;
  const menuExclusive = opts.menuExclusive !== false;
  const stickMenuNav = opts.stickMenuNav !== false;
  const isTyping = opts.isTyping ?? isMenuTextField;
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
  const startInterval = opts.interval ?? ((fn, ms) => (
    typeof setInterval === 'function' ? setInterval(fn, ms) : 0
  ));
  const stopInterval = opts.clearInterval ?? ((id) => {
    if (typeof clearInterval === 'function') clearInterval(id);
  });

  let prevButtons = [];
  let prevTab = 0;
  let prevAdj = 0;
  let tabHeldAt = 0;
  let tabLastAt = 0;
  let adjHeldAt = 0;
  let adjLastAt = 0;
  let rafId = 0;
  let resumeWatch = 0;
  let parked = false;
  let aimOx = 0;
  let aimOy = 0;
  let padSelecting = false;
  let padGroupId = null;
  let radialHeldRing = null;
  let pointerYielded = false;
  let stickReclaimArmed = false;

  function resetEdges() {
    prevButtons = [];
    prevTab = 0;
    prevAdj = 0;
    tabHeldAt = 0;
    tabLastAt = 0;
    adjHeldAt = 0;
    adjLastAt = 0;
  }

  function resetAimOffset() {
    aimOx = 0;
    aimOy = 0;
    opts.onCursor?.(0, 0);
  }

  function cancelPadSelect() {
    if (!padSelecting) return;
    padSelecting = false;
    opts.onSelectCancel?.();
  }

  function cancelPadGroup() {
    if (padGroupId == null) return;
    padGroupId = null;
    opts.onControlGroupCancel?.();
  }

  function aim(on) {
    if (!on) resetAimOffset();
    opts.onAim?.(!!on);
  }

  function yieldToPointer() {
    stickReclaimArmed = false;
    if (pointerYielded) return;
    pointerYielded = true;
    cancelPadSelect();
    cancelPadGroup();
    aim(false);
  }

  function applyPlayDefault(read) {
    const { lookX, lookY, rotX, rotY, splitYaw, splitZoom, bothLook } = stickPlayAxes(read);
    const splitting = !!(splitYaw || splitZoom);
    const vp = opts.getViewport?.();
    const w = vp?.width ?? 0;
    const h = vp?.height ?? 0;
    let camLx = lookX;
    let camLy = lookY;
    if (w > 8 && h > 8) {
      const leash = leashLimit(w, h);
      if (splitting) {
        const home = settleCursorLeash(aimOx, aimOy, STICK_SPLIT_HOME);
        aimOx = home.ox;
        aimOy = home.oy;
      } else if (lookX || lookY) {
        const step = stepCursorLeash(aimOx, aimOy, lookX, lookY, leash);
        aimOx = step.ox;
        aimOy = step.oy;
        camLx = bothLook ? lookX : step.camLx;
        camLy = bothLook ? lookY : step.camLy;
      } else {
        aimOx = Math.max(-leash.x, Math.min(leash.x, aimOx));
        aimOy = Math.max(-leash.y, Math.min(leash.y, aimOy));
      }
      opts.onCursor?.(aimOx, aimOy);
    }
    applyLookRotateZoom(camera, camLx, camLy, rotX, rotY, splitYaw, splitZoom);
  }

  /** HUD / radial: rotate + zoom stay live. Pan only when both sticks are in. */
  function applyMenuCamera(read) {
    if (!(active?.() ?? true)) return;
    const { lookX, lookY, rotX, rotY, splitYaw, splitZoom, bothLook } = stickPlayAxes(read);
    applyLookRotateZoom(
      camera,
      bothLook ? lookX : 0,
      bothLook ? lookY : 0,
      rotX,
      rotY,
      splitYaw,
      splitZoom,
    );
  }

  function holdMenu(menuRoot, read) {
    cancelPadSelect();
    cancelPadGroup();
    aim(false);
    if (menuRoot?.id !== OS_KBD_ID) applyMenuCamera(read);
  }

  const applyPlay = opts.applyPlay ?? applyPlayDefault;

  function handleMenu(menuRoot, read, edges, t) {
    if (menuRoot?.id === OS_KBD_ID) {
      if (edges[PAD.START] || edges[PAD.BACK] || edges[PAD.B]) {
        closeOsKbd(root);
        return;
      }
      const nav = osKbdNavIntent(read);
      const navDir = osKbdNavCode(nav.dx, nav.dy);
      const tabRep = heldRepeat(navDir, prevTab, t, tabHeldAt, tabLastAt);
      prevTab = navDir;
      tabHeldAt = tabRep.heldAt;
      tabLastAt = tabRep.lastAt;
      if (tabRep.fire) stepOsKbdFocus(menuRoot, nav.dx, nav.dy);

      const back = osKbdBackspaceHeld(read) ? 1 : 0;
      const backRep = heldRepeat(back, prevAdj, t, adjHeldAt, adjLastAt);
      prevAdj = back;
      adjHeldAt = backRep.heldAt;
      adjLastAt = backRep.lastAt;
      if (backRep.fire) pressOsKbdAction(root, 'back');

      if (playConfirmIntent(edges)) {
        const keys = listOsKbdKeys(menuRoot);
        const cur = keys.includes(root?.activeElement) ? root.activeElement : null;
        if (!cur) keys[0]?.focus?.();
        else activateMenuEl(cur);
      }
      return;
    }
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
    const navRead = stickMenuNav && !stickCameraGesture(read)
      ? read
      : { ...read, lx: 0, ly: 0, rx: 0, ry: 0 };
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

    if (playConfirmIntent(edges)) {
      const after = listFocusables(menuRoot);
      const cur = after.includes(root?.activeElement) ? root.activeElement : null;
      if (!cur) stepMenuFocus(after, null, 1);
      else {
        activateMenuEl(cur);
        if (isMenuTextField(cur)) opts.onTextEdit?.(cur);
      }
    }
  }

  function bindLost() {
    win?.addEventListener?.('gamepaddisconnected', onLost);
    win?.addEventListener?.('blur', onLost);
    doc?.addEventListener?.('visibilitychange', onLost);
  }

  function unbindLost() {
    win?.removeEventListener?.('gamepaddisconnected', onLost);
    win?.removeEventListener?.('blur', onLost);
    doc?.removeEventListener?.('visibilitychange', onLost);
  }

  function shouldPark() {
    return !!(opts.yieldPad?.() || padShouldYield(root));
  }

  function parkPad() {
    parked = true;
    if (rafId) {
      caf(rafId);
      rafId = 0;
    }
    unbindLost();
    resetEdges();
    cancelPadSelect();
    cancelPadGroup();
    aim(false);
    opts.onIdle?.();
    if (!resumeWatch) {
      resumeWatch = startInterval(() => {
        if (!shouldPark()) unparkPad();
      }, 100);
    }
  }

  function unparkPad() {
    if (resumeWatch) {
      stopInterval(resumeWatch);
      resumeWatch = 0;
    }
    if (!parked && rafId) return;
    parked = false;
    bindLost();
    if (opts.autoStart !== false && !rafId) loop();
  }

  function tick() {
    if (shouldPark()) {
      parkPad();
      return;
    }
    const pad = pickStandardGamepad(getGamepads());
    if (!pad) {
      resetEdges();
      cancelPadSelect();
      cancelPadGroup();
      aim(false);
      opts.onIdle?.();
      return;
    }
    const read = readStandardPad(pad);
    const edges = buttonEdges(read.buttons, prevButtons);
    const released = buttonReleased(read.buttons, prevButtons);
    prevButtons = read.buttons;
    const placingNow = typeof opts.placing === 'function' ? !!opts.placing() : !!opts.placing;
    if (pointerYielded) {
      if (!padHasActivity(read, [])) stickReclaimArmed = true;
      // Ghost-place keeps the pad — a mouse pick of the building type used
      // to swallow aim / bumper-yaw / A until a full stick recenter.
      if (!placingNow && !padCanReclaimFromPointer(read, edges, stickReclaimArmed)) {
        const t = now();
        const menuRoot = resolveMenuRoot(root);
        if (menuRoot) {
          handleMenu(menuRoot, read, edges, t);
          if (menuExclusive) holdMenu(menuRoot, read);
        }
        return;
      }
      pointerYielded = false;
      stickReclaimArmed = false;
    }
    if (padHasActivity(read, edges)) opts.onActivity?.();
    const t = now();
    const menuRoot = resolveMenuRoot(root);

    if (menuRoot) {
      handleMenu(menuRoot, read, edges, t);
      if (menuExclusive) {
        holdMenu(menuRoot, read);
        return;
      }
    }

    if (!menuRoot && (edges[PAD.START] || edges[PAD.BACK])) {
      const opened = clickMenuToggle(root, true);
      if (opened) {
        const openedRoot = resolveMenuRoot(root);
        const items = listFocusables(openedRoot);
        if (items[0]) items[0].focus?.();
        if (menuExclusive) {
          cancelPadSelect();
          cancelPadGroup();
          aim(false);
          return;
        }
      }
    }

    if (!(active?.() ?? true)) {
      cancelPadSelect();
      cancelPadGroup();
      aim(false);
      return;
    }
    if (isTyping(root?.activeElement)) {
      cancelPadSelect();
      cancelPadGroup();
      aim(false);
      return;
    }

    const radialOpen = typeof opts.radialOpen === 'function' ? !!opts.radialOpen() : !!opts.radialOpen;
    if (radialOpen) {
      cancelPadSelect();
      cancelPadGroup();
      aim(false);
      applyMenuCamera(read);
      const pick = radialStickPick(radialMenuRead(read), opts.getRadialTargets?.() ?? null, radialHeldRing);
      radialHeldRing = pick?.ring ?? null;
      opts.onRadialHover?.(pick);
      if (edges[PAD.B]) opts.onRadialCancel?.();
      else if (playConfirmIntent(edges) && pick) opts.onRadialConfirm?.(pick);
      return;
    }
    radialHeldRing = null;

    const placing = typeof opts.placing === 'function' ? !!opts.placing() : !!opts.placing;
    if (placing) {
      cancelPadSelect();
      cancelPadGroup();
      aim(true);
      applyPlay(read);
      if (playSelectHeld(read.buttons)) opts.onPlaceRotateDrag?.();
      else opts.onPlaceAim?.();
      const place = placePadIntent(edges);
      if (place.cancel) opts.onPlaceCancel?.();
      else if (place.confirm) opts.onPlaceConfirm?.();
      return;
    }

    aim(true);
    const selectHeld = playSelectHeld(read.buttons);
    const chord = { both: playSelectBoth(read.buttons) };
    if (selectHeld && !padSelecting) {
      padSelecting = true;
      opts.onSelectStart?.(chord);
    }
    applyPlay(read);
    if (padSelecting && selectHeld) opts.onSelectHold?.(chord);
    if (padSelecting && !selectHeld) {
      padSelecting = false;
      opts.onSelectEnd?.(chord);
    }
    const orders = playOrderIntent(edges);
    if (orders.attackMove) opts.onAttackMove?.();
    if (orders.forceMove) opts.onForceMove?.();
    const groups = playControlGroupIntent(edges, released);
    for (let i = 0; i < groups.downs.length; i++) {
      padGroupId = groups.downs[i];
      opts.onControlGroupDown?.(groups.downs[i]);
    }
    for (let i = 0; i < groups.ups.length; i++) {
      const id = groups.ups[i];
      if (padGroupId === id) padGroupId = null;
      opts.onControlGroupUp?.(id);
    }
    if (playCastIntent(edges)) opts.onCast?.();
  }

  function loop() {
    if (parked) {
      rafId = 0;
      return;
    }
    rafId = raf(loop);
    tick();
  }

  const win = opts.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = root && typeof root.addEventListener === 'function' ? root : null;

  function onLost() {
    resetEdges();
    cancelPadSelect();
    cancelPadGroup();
    aim(false);
  }

  if (opts.autoStart !== false) loop();
  if (!parked) bindLost();

  return {
    tick,
    park: parkPad,
    unpark: unparkPad,
    yieldToPointer,
    dispose() {
      parked = true;
      if (rafId) caf(rafId);
      rafId = 0;
      if (resumeWatch) {
        stopInterval(resumeWatch);
        resumeWatch = 0;
      }
      unbindLost();
      resetEdges();
      cancelPadSelect();
      cancelPadGroup();
      aim(false);
    },
  };
}
