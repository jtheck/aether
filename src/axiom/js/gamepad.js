// Axiom fly pad — standard mapping. Left stick fly, right stick look, LT/RT rise.

import {
  buttonEdges,
  createGamepadAdapter,
  deadzone,
  PAD,
} from '../../app/input/gamepad.js';

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
 */
export function attachAxiomGamepad(renderer, opts = {}) {
  const idle = { mx: 0, my: 0, mz: 0, lookRight: 0, lookUp: 0, lookYaw: 0, lookPitch: 0 };
  const { onShape, ...rest } = opts;
  let prevButtons = [];
  return createGamepadAdapter({
    applyPlay(read) {
      const overlay = axiomMenuRoot(rest.root ?? (typeof document !== 'undefined' ? document : null));
      const step = shapeStepFromPad(read.buttons, prevButtons, { dpad: !overlay });
      prevButtons = read.buttons;
      if (step) onShape?.(step);
      renderer.applyGamepadFly?.(flyIntentFromPad(read));
    },
    onIdle() {
      prevButtons = [];
      renderer.applyGamepadFly?.(idle);
    },
    menuRoot: axiomMenuRoot,
    listFocusables: listAxiomFocusables,
    menuExclusive: false,
    stickMenuNav: false,
    isTyping: isTextField,
    ...rest,
  });
}
