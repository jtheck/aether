import { XR_SWAP_TRIGGER_GRIP } from './controlMods.js';

/** Whether the select / lasso button is held on this XR input source. */
export function questSelectHeld(src) {
  if (!src) return false;
  if (XR_SWAP_TRIGGER_GRIP) return !!(src.gamepad?.buttons?.[0]?.pressed);
  return !!(src.gamepad?.buttons?.[1]?.pressed || src.squeezing);
}

/** Edge-pressed on the force-move / attack-move / pie-pick button. */
export function questActionDown(d) {
  return XR_SWAP_TRIGGER_GRIP ? !!d.grip : !!d.trigger;
}

export function questActionHeld(held) {
  return XR_SWAP_TRIGGER_GRIP ? held.grip : held.trigger;
}

export function questActionUp(u) {
  return XR_SWAP_TRIGGER_GRIP ? !!u.grip : !!u.trigger;
}

/** Edge-pressed on the select button (pie slice tap off-menu still goes through xrSelect). */
export function questSelectDown(d) {
  return XR_SWAP_TRIGGER_GRIP ? !!d.trigger : !!d.grip;
}

export function questSelectHeldPad(held) {
  return XR_SWAP_TRIGGER_GRIP ? held.trigger : held.grip;
}