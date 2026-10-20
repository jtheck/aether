// Headset control scheme for Quest Touch (two face buttons per hand,
// stick + click, grip, trigger).
//
//   Grip            select: tap picks under the beam, hold and sweep lassoes.
//                   Holding the other grip still makes a release additive.
//   Left trigger    force-move at the left beam.
//   Right trigger   attack-move at the right beam.
//   X / A           unit ability at that hand's beam: cast, unload a
//                   loaded transport, or found an agora.
//   Y / B           cancel: back out of a pie or ghost-place, or clear the selection.
//   Left stick      fly. Click jumps home (selects the agora, like a double B).
//   Right stick     yaws and lifts. Click jumps to the selection.
// Control groups stay on the desktop and pad; the headset has no buttons for them.
//
// Pie menu open (agora build / building actions): point a beam at a slice.
// A trigger or a grip on that slice picks it. The sticks keep flying and yawing.
// Ghost-place: the beam walks the ghost, either trigger stamps, grip held
// yaws the ghost toward the beam. After a yaw the ghost waits where it is
// until the beam comes back onto it.
// A hand's aim beam shows while a finger rests on its trigger, and always in
// a pie menu or ghost-place.

import { readQuestTouch } from './xrRig.js';
import { beamState, createXrSelect, sourceRay } from './xrSelect.js';

/** Beam back within this many world units of a yawed ghost picks it up again. */
const GHOST_PICKUP = 6;

const HANDS = /** @type {const} */ (['left', 'right']);
const BUTTONS = /** @type {const} */ (['trigger', 'grip', 'primary', 'secondary', 'stickClick']);

function blankHand() {
  return { trigger: false, grip: false, primary: false, secondary: false, stickClick: false, touch: false };
}

function pickKey(pick) {
  return pick ? `${pick.kind}:${pick.id ?? ''}:${pick.ring ?? ''}` : '';
}

/**
 * @param {{
 *   renderer: { rayToGround: Function, groundHeight: Function, setXrSelect: Function },
 *   getInput: () => object | null | undefined,
 *   jumps?: {
 *     home?: () => { x: number, z: number } | null,
 *     selection?: () => { x: number, z: number } | null,
 *   },
 *   onJump?: (x: number, z: number) => void,
 * }} opts
 */
export function createXrControls({ renderer, getInput, jumps = {}, onJump }) {
  const select = createXrSelect({ renderer, getInput });
  /** Last frame's buttons per hand. */
  const prev = { left: blankHand(), right: blankHand() };
  /** Hand that walks the ghost and wins pie hover. */
  let aimHand = 'right';
  /** Hands whose aim beam is up (not the select gesture's). */
  const beamUp = { left: false, right: false };
  /** Grip pressed during ghost-place: that hold yaws instead of selecting. */
  const gripYaw = { left: false, right: false };
  let ghostParked = false;
  let hoverKey = '';

  function radialOpen() {
    return !!getInput()?.isRadialOpen?.();
  }

  function readHands(sources) {
    /** @type {Record<'left' | 'right', { src: object | null, pad: ReturnType<typeof readQuestTouch>, ray: object | null, held: ReturnType<typeof blankHand>, down: Record<string, boolean>, up: Record<string, boolean> }>} */
    const out = {};
    for (const hand of HANDS) {
      let src = null;
      for (const s of sources) {
        if (s.handedness === hand) {
          src = s;
          break;
        }
      }
      const pad = readQuestTouch(src?.gamepad);
      const now = {
        trigger: pad.trigger.pressed,
        grip: pad.grip.pressed || !!src?.squeezing,
        primary: pad.primary.pressed,
        secondary: pad.secondary.pressed,
        stickClick: pad.stickClick.pressed,
        touch: pad.trigger.touched,
      };
      const was = prev[hand];
      const down = {};
      const up = {};
      for (const b of BUTTONS) {
        down[b] = now[b] && !was[b];
        up[b] = !now[b] && was[b];
      }
      down.touch = now.touch && !was.touch;
      prev[hand] = now;
      out[hand] = { src, pad, ray: sourceRay(src), down, up, held: now };
    }
    return out;
  }

  function noteAimHand(hands) {
    for (const hand of HANDS) {
      const d = hands[hand].down;
      if (d.touch || d.trigger || d.grip || d.primary || d.secondary) aimHand = hand;
    }
  }

  function hover(input, pick) {
    const key = pickKey(pick);
    if (key === hoverKey) return;
    hoverKey = key;
    input.hoverRadialPick?.(pick);
  }

  /** Pie menu: the beam hovers a slice, trigger or grip on it picks. */
  function stepRadial(input, hands, claimed) {
    const beam = {
      left: hands.left.ray ? input.pickRadialAtRay?.(hands.left.ray) ?? null : null,
      right: hands.right.ray ? input.pickRadialAtRay?.(hands.right.ray) ?? null : null,
    };
    const other = aimHand === 'left' ? 'right' : 'left';
    hover(input, beam[aimHand] ?? beam[other] ?? null);
    for (const hand of HANDS) {
      const d = hands[hand].down;
      if (d.secondary) {
        input.cancelRadial?.();
        return;
      }
      if (d.grip && beam[hand]) {
        claimed.add(hands[hand].src?.source);
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
      if (d.trigger && beam[hand]) {
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
    }
  }

  /** Ghost-place: beam walks, grip yaws, trigger stamps, Y / B backs out. */
  function stepPlace(input, hands) {
    for (const hand of HANDS) {
      if (hands[hand].down.grip) gripYaw[hand] = true;
      if (!hands[hand].held.grip) gripYaw[hand] = false;
    }
    for (const hand of HANDS) {
      if (hands[hand].down.secondary) {
        input.cancelPlacement?.();
        return;
      }
    }
    const yawHand = gripYaw[aimHand] ? aimHand : HANDS.find((h) => gripYaw[h]);
    if (yawHand && hands[yawHand].ray) {
      input.rotatePlacementAtRay?.(hands[yawHand].ray);
      ghostParked = true;
    } else if (hands[aimHand].ray) {
      const ray = hands[aimHand].ray;
      if (ghostParked) {
        const at = input.getPlacementAnchor?.();
        const g = renderer.rayToGround(ray);
        if (!at || (g && Math.hypot(g.x - at.x, g.z - at.z) <= GHOST_PICKUP)) ghostParked = false;
      }
      if (!ghostParked) input.previewPlacementAtRay?.(ray);
    }
    for (const hand of HANDS) {
      if (hands[hand].down.trigger) {
        input.confirmPlacementAtRay?.(hands[hand].ray);
        return;
      }
    }
  }

  function stepPlay(input, hands) {
    const { left, right } = hands;
    if (left.down.trigger && left.ray) input.forceMoveAtRay?.(left.ray);
    if (right.down.trigger && right.ray) input.attackMoveAtRay?.(right.ray);
    for (const hand of HANDS) {
      const h = hands[hand];
      if (h.down.secondary) {
        input.clearSelection?.();
        return;
      }
      if (h.down.primary && h.ray) input.castAbilityAtRay?.(h.ray);
    }
  }

  function stepJumps(hands) {
    const at = hands.left.down.stickClick
      ? jumps.home?.()
      : hands.right.down.stickClick ? jumps.selection?.() : null;
    if (at) onJump?.(at.x, at.z);
  }

  function stepBeams(hands, wide) {
    for (const hand of HANDS) {
      const h = hands[hand];
      const want = !!h.ray && !select.isActive(hand) && (h.held.touch || wide);
      if (want) {
        renderer.setXrSelect(hand, beamState(renderer, h.ray));
        beamUp[hand] = true;
      } else if (beamUp[hand]) {
        beamUp[hand] = false;
        if (!select.isActive(hand)) renderer.setXrSelect(hand, null);
      }
    }
  }

  /** Call once per XR frame after the rig has moved the reference space. */
  function step(ctx) {
    const sources = ctx.input?.inputSources ?? [];
    const hands = readHands(sources);
    noteAimHand(hands);
    const input = getInput();
    const placing = !!input?.isPlacing?.();
    const radial = !placing && radialOpen();
    if (!placing) {
      ghostParked = false;
      gripYaw.left = gripYaw.right = false;
    }
    if (!radial) hoverKey = '';
    /** @type {Set<object>} */
    const claimed = new Set();
    if (input && radial) stepRadial(input, hands, claimed);
    select.step(ctx, { blocked: placing, canBegin: (src) => !claimed.has(src.source) });
    if (input) {
      if (placing) stepPlace(input, hands);
      else if (!radial) stepPlay(input, hands);
    }
    stepJumps(hands);
    stepBeams(hands, placing || radial);
  }

  return {
    step,
    dispose() {
      select.dispose();
      for (const hand of HANDS) {
        if (beamUp[hand]) renderer.setXrSelect(hand, null);
        beamUp[hand] = false;
        prev[hand] = blankHand();
      }
    },
  };
}
