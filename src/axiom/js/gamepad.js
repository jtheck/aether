// Axiom fly pad — standard mapping. Left stick fly, right stick look, LT/RT rise.
// Self-contained: the garden pad helper lives under /app/ and is not on the /axiom/ deploy.

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

const STICK_DEADZONE = 0.18;

/** Rescale a stick axis so the deadzone is zero and full throw is still 1. */
export function deadzone(v, dz = STICK_DEADZONE) {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

/** @param {boolean[]} cur @param {boolean[]} prev */
export function buttonEdges(cur, prev) {
  const down = [];
  const n = Math.max(cur?.length ?? 0, prev?.length ?? 0);
  for (let i = 0; i < n; i++) down[i] = !!(cur?.[i] && !prev?.[i]);
  return down;
}

function pickStandardGamepad(pads) {
  if (!pads) return null;
  for (const pad of pads) {
    if (pad && pad.connected !== false && pad.mapping === 'standard') return pad;
  }
  return null;
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

function clamp1(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/** xr-standard: thumbstick is axes 2/3 when present, else 0/1 (no touchpad). */
function xrStickAxes(pad) {
  const a = pad?.axes ?? [];
  if (a.length >= 4) return { x: a[2] ?? 0, y: a[3] ?? 0 };
  return { x: a[0] ?? 0, y: a[1] ?? 0 };
}

/**
 * Quest / Index / etc. — each hand is its own xr-standard Gamepad.
 * Left stick fly, right stick look, triggers rise, grips / Y B change shape.
 * @param {Iterable<{ handedness?: string, gamepad?: object }> | null | undefined} sources
 */
export function readXrControllers(sources) {
  const buttons = [];
  let lx = 0;
  let ly = 0;
  let rx = 0;
  let ry = 0;
  let lt = 0;
  let rt = 0;
  let any = false;
  if (!sources) return null;
  for (const src of sources) {
    const pad = src?.gamepad;
    if (!pad || pad.connected === false) continue;
    any = true;
    const stick = xrStickAxes(pad);
    const trigger = buttonValue(pad.buttons?.[0]);
    const squeeze = buttonOn(pad.buttons?.[1]);
    const face = buttonOn(pad.buttons?.[4]);
    const hand = src.handedness;
    if (hand === 'right') {
      rx = stick.x;
      ry = stick.y;
      rt = trigger;
      if (squeeze || face) buttons[PAD.RB] = true;
    } else {
      lx = stick.x;
      ly = stick.y;
      lt = trigger;
      if (squeeze || face) buttons[PAD.LB] = true;
    }
  }
  if (!any) return null;
  return { lx, ly, rx, ry, lt, rt, buttons };
}

/** Combine a standard pad and headset controllers so both can fly at once. */
export function mergePadReads(a, b) {
  if (!a) return b;
  if (!b) return a;
  const buttons = [];
  const n = Math.max(a.buttons?.length ?? 0, b.buttons?.length ?? 0);
  for (let i = 0; i < n; i++) buttons[i] = !!(a.buttons?.[i] || b.buttons?.[i]);
  return {
    lx: clamp1((a.lx || 0) + (b.lx || 0)),
    ly: clamp1((a.ly || 0) + (b.ly || 0)),
    rx: clamp1((a.rx || 0) + (b.rx || 0)),
    ry: clamp1((a.ry || 0) + (b.ry || 0)),
    lt: Math.min(1, (a.lt || 0) + (b.lt || 0)),
    rt: Math.min(1, (a.rt || 0) + (b.rt || 0)),
    buttons,
  };
}

function readStandardPad(pad) {
  const axes = pad?.axes ?? [];
  const src = pad?.buttons ?? [];
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons[i] = buttonValue(src[i]) > 0.5;
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

function createAxiomPadAdapter(opts = {}) {
  const root = opts.root ?? (typeof document !== 'undefined' ? document : null);
  const resolveMenuRoot = opts.menuRoot ?? (() => null);
  const listFocusables = opts.listFocusables ?? (() => []);
  const isTyping = opts.isTyping ?? (() => false);
  const getGamepads = opts.getGamepads ?? (() => (
    typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
  ));
  const getXrInputSources = opts.getXrInputSources ?? (() => []);
  const raf = opts.raf ?? ((fn) => (
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0
  ));
  const caf = opts.caf ?? ((id) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  });

  let prevButtons = [];
  let rafId = 0;

  function tick() {
    const pad = pickStandardGamepad(getGamepads());
    const xrRead = readXrControllers(getXrInputSources());
    if (!pad && !xrRead) {
      prevButtons = [];
      opts.onIdle?.();
      return;
    }
    const read = mergePadReads(pad ? readStandardPad(pad) : null, xrRead);
    const edges = buttonEdges(read.buttons, prevButtons);
    prevButtons = read.buttons;
    const menuRoot = resolveMenuRoot(root);
    if (menuRoot && edges[PAD.A]) {
      const items = listFocusables(menuRoot);
      const cur = items.includes(root?.activeElement) ? root.activeElement : null;
      if (!cur) items[0]?.focus?.();
      else cur.click?.();
    }
    if (isTyping(root?.activeElement)) return;
    opts.applyPlay?.(read);
  }

  function loop() {
    rafId = raf(loop);
    tick();
  }

  function onLost() {
    prevButtons = [];
  }

  if (opts.autoStart !== false) loop();

  const win = opts.window ?? (typeof window !== 'undefined' ? window : null);
  win?.addEventListener?.('gamepaddisconnected', onLost);
  win?.addEventListener?.('blur', onLost);

  return {
    tick,
    dispose() {
      if (rafId) caf(rafId);
      rafId = 0;
      win?.removeEventListener?.('gamepaddisconnected', onLost);
      win?.removeEventListener?.('blur', onLost);
      prevButtons = [];
    },
  };
}

const LOOK_YAW = 0.045;
const LOOK_PITCH = 0.035;

function overlayShown(el) {
  if (!el || el.hidden) return false;
  if (el.getAttribute?.('aria-hidden') === 'true') return false;
  const display = el.style?.display;
  if (display === 'none' || !display) return false;
  return true;
}

/** @param {Document | null | undefined} doc */
export function axiomMenuRoot(doc) {
  const xr = doc?.getElementById?.('xr_button');
  if (!overlayShown(xr)) return null;
  return xr.parentElement ?? xr;
}

/** @param {Element | Document | null | undefined} root */
export function listAxiomFocusables(root) {
  if (!root) return [];
  const xr = root.id === 'xr_button'
    ? root
    : root.querySelector?.('#xr_button') ?? root.getElementById?.('xr_button');
  return overlayShown(xr) ? [xr] : [];
}

/**
 * Stick up is forward / look up. X is not inverted — fly felt opposite of the garden orbit pad.
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number, lt?: number, rt?: number }} read
 */
export function flyIntentFromPad(read) {
  const lx = deadzone(read?.lx ?? 0);
  const ly = deadzone(read?.ly ?? 0);
  const rx = deadzone(read?.rx ?? 0);
  const ry = deadzone(read?.ry ?? 0);
  return {
    mx: lx,
    mz: -ly || 0,
    my: (read?.rt ?? 0) - (read?.lt ?? 0),
    lookRight: rx,
    lookUp: -ry || 0,
    lookYaw: rx * LOOK_YAW,
    lookPitch: (-ry || 0) * LOOK_PITCH,
  };
}

function isTextField(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el.isContentEditable;
}

/**
 * LB / D-pad left = previous shape; RB / D-pad right = next (same as Y).
 * @param {boolean[]} buttons
 * @param {boolean[]} prev
 * @param {{ dpad?: boolean }} [opts]
 */
export function shapeStepFromPad(buttons, prev, opts = {}) {
  const edges = buttonEdges(buttons, prev);
  const dpad = opts.dpad !== false;
  if (edges[PAD.LB] || (dpad && edges[PAD.LEFT])) return -1;
  if (edges[PAD.RB] || (dpad && edges[PAD.RIGHT])) return 1;
  return 0;
}

/**
 * @param {{ applyGamepadFly?: (fly: object) => void }} renderer
 * @param {object} [opts]
 * @param {(dir: number) => void} [opts.onShape]
 * @param {boolean} [opts.apply=true]  // false = read-only; app merges with desktop fly
 */
export function attachAxiomGamepad(renderer, opts = {}) {
  const idle = { mx: 0, my: 0, mz: 0, lookRight: 0, lookUp: 0, lookYaw: 0, lookPitch: 0 };
  const { onShape, apply = true, ...rest } = opts;
  let prevButtons = [];
  let last = idle;
  const adapter = createAxiomPadAdapter({
    applyPlay(read) {
      const overlay = axiomMenuRoot(rest.root ?? (typeof document !== 'undefined' ? document : null));
      const step = shapeStepFromPad(read.buttons, prevButtons, { dpad: !overlay });
      prevButtons = read.buttons;
      if (step) onShape?.(step);
      last = flyIntentFromPad(read);
      if (apply) renderer.applyGamepadFly?.(last);
    },
    onIdle() {
      prevButtons = [];
      last = idle;
      if (apply) renderer.applyGamepadFly?.(idle);
    },
    menuRoot: axiomMenuRoot,
    listFocusables: listAxiomFocusables,
    isTyping: isTextField,
    ...rest,
  });
  return { ...adapter, read: () => last };
}
