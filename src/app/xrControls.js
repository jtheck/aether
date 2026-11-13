// Headset control scheme for Quest Touch (two face buttons per hand,
// stick + click, grip, trigger).
//
//   Grip            select: tap picks under the beam, hold and sweep lassoes.
//                   Holding the other grip still makes a release additive.
//   Left trigger    force-move at the left beam.
//   Right trigger   attack-move at the right beam.
//                   A selected production building plants a train rally
//                   (force-move / attack-move) even while its action pie is open.
//   Y / B           unit ability at that hand's beam: cast, unload a
//                   loaded transport, or found an agora.
//   X / A           cancel: back out of a pie or ghost-place, or clear the selection.
//   Sticks          either stick pans, no deadzone. Both the same way add.
//                   The stick already out keeps panning; the other turns.
//                   Pinch lifts and spread lowers, and a hard pinch quiets
//                   the pan. Right stick click
//                   latches follow on the selection until a pan or another
//                   click. Left stick click cycles three altitudes and holds
//                   that band until a pinch. Neither click takes the sticks
//                   off pan.
// Control groups stay on the desktop and pad; the headset has no buttons for them.
//
// Pie menu open (agora build / building actions): point a beam at a slice.
// A trigger or a grip on that slice picks it. Holding either on a unit
// keeps queuing. A trigger that misses the pie
// issues the same order as in play (rally when buildings are selected).
// The sticks keep panning, turning, and lifting while a pie is open.
// Ghost-place: the beam walks the ghost. Facing is where the beam sits
// inside the plot. Either trigger stamps. X / A backs out, and so does a
// grip sweep that catches nothing. A grip tap does not select.
// A hand's aim beam shows while a finger rests on its trigger, and always in
// a pie menu or ghost-place. The beam carries a wire handle straight back
// from where it leaves the hand. Two pads on it — Move and Select on the
// left, Attack and Select on the right — fire that laser's aim when the
// other hand's trigger presses them.

import { readQuestTouch } from './xrRig.js';
import { beamState, createXrSelect, sourceRay } from './xrSelect.js';
import { pickHandleButton } from '../render/xrLasso.js';
import { nextQueueHold, unitQueueKey } from './input/queueHold.js';

const HANDS = /** @type {const} */ (['left', 'right']);
const BUTTONS = /** @type {const} */ (['trigger', 'grip', 'primary', 'secondary', 'stickClick']);
/** Pad 0 orders at that laser, pad 1 selects there. */
const HANDLE_ACTION = {
  left: ['move', 'select'],
  right: ['attack', 'select'],
};

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
 *   onFollowToggle?: () => void,
 *   onAltitude?: () => void,
 * }} opts
 */
export function createXrControls({
  renderer,
  getInput,
  onFollowToggle,
  onAltitude,
  now = () => performance.now(),
}) {
  const select = createXrSelect({ renderer, getInput });
  /** Last frame's buttons per hand. */
  const prev = { left: blankHand(), right: blankHand() };
  /** Hand that walks the ghost and wins pie hover. */
  let aimHand = 'right';
  /** Hands whose aim beam is up (not the select gesture's). */
  const beamUp = { left: false, right: false };
  let hoverKey = '';
  let trainHold = { id: null, heldAt: 0, lastAt: 0 };

  function clearTrainHold() {
    trainHold = { id: null, heldAt: 0, lastAt: 0 };
  }

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

  function blankUsed() {
    return { left: false, right: false };
  }

  function beamWanted(hands, hand, placing, radial) {
    const h = hands[hand];
    return !!h.ray && (h.held.touch || h.held.grip || placing || radial);
  }

  /**
   * Other-hand trigger on a visible handle pad. The pad uses the laser it
   * sits on. A held trigger keeps that hand from also ordering or queuing.
   */
  function takeHandlePress(input, hands, placing, radial) {
    const used = blankUsed();
    if (!input || placing) return used;
    for (const hand of HANDS) {
      if (!beamWanted(hands, hand, placing, radial)) continue;
      const otherName = hand === 'left' ? 'right' : 'left';
      const other = hands[otherName];
      if (!other.held.trigger || !other.ray) continue;
      const hit = pickHandleButton(hands[hand].ray, other.ray);
      if (hit == null) continue;
      used[otherName] = true;
      if (!other.down.trigger) continue;
      const kind = HANDLE_ACTION[hand][hit];
      if (kind === 'move') input.forceMoveAtRay?.(hands[hand].ray);
      else if (kind === 'attack') input.attackMoveAtRay?.(hands[hand].ray);
      else input.selectAtRay?.(hands[hand].ray);
    }
    return used;
  }

  /** Pie menu: the beam hovers a slice, trigger or grip on it picks. */
  function stepRadial(input, hands, claimed, used) {
    const beam = {
      left: hands.left.ray ? input.pickRadialAtRay?.(hands.left.ray) ?? null : null,
      right: hands.right.ray ? input.pickRadialAtRay?.(hands.right.ray) ?? null : null,
    };
    const other = aimHand === 'left' ? 'right' : 'left';
    hover(input, beam[aimHand] ?? beam[other] ?? null);
    for (const hand of HANDS) {
      const d = hands[hand].down;
      const h = hands[hand];
      if (d.secondary) {
        clearTrainHold();
        input.cancelRadial?.();
        return;
      }
      const unitId = ((h.held.trigger && !used[hand]) || h.held.grip) ? unitQueueKey(beam[hand]) : null;
      if (unitId) {
        if (h.held.grip) claimed.add(h.src?.source);
        const next = nextQueueHold(trainHold, unitId, now());
        trainHold = { id: next.id, heldAt: next.heldAt, lastAt: next.lastAt };
        if (next.fire) input.confirmRadialPick?.(beam[hand]);
        return;
      }
      if (d.grip && beam[hand]) {
        claimed.add(h.src?.source);
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
      if (d.trigger && !used[hand] && beam[hand]) {
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
    }
    clearTrainHold();
    issueTriggerOrders(input, hands, used);
  }

  /** Left force-moves, right attack-moves. Buildings turn those into rallies. */
  function issueTriggerOrders(input, hands, used) {
    const { left, right } = hands;
    if (left.down.trigger && !used.left && left.ray) input.forceMoveAtRay?.(left.ray);
    if (right.down.trigger && !used.right && right.ray) input.attackMoveAtRay?.(right.ray);
  }

  /** Ghost-place: the beam walks the ghost, either trigger stamps, X / A backs out. */
  function stepPlace(input, hands, used) {
    for (const hand of HANDS) {
      if (hands[hand].down.secondary) {
        input.cancelPlacement?.();
        return;
      }
    }
    if (hands[aimHand].ray) input.previewPlacementAtRay?.(hands[aimHand].ray);
    for (const hand of HANDS) {
      if (hands[hand].down.trigger && !used[hand]) {
        input.confirmPlacementAtRay?.(hands[hand].ray);
        return;
      }
    }
  }

  function stepPlay(input, hands, used) {
    issueTriggerOrders(input, hands, used);
    for (const hand of HANDS) {
      const h = hands[hand];
      if (h.down.secondary) {
        input.clearSelection?.();
        return;
      }
      if (h.down.primary && h.ray) input.castAbilityAtRay?.(h.ray);
    }
  }

  function stepHolds(hands) {
    if (hands.right.down.stickClick) onFollowToggle?.();
    if (hands.left.down.stickClick) onAltitude?.();
  }

  function stepBeams(hands, wide) {
    for (const hand of HANDS) {
      const h = hands[hand];
      const want = !!h.ray && !select.isActive(hand) && (h.held.touch || wide);
      if (want) {
        const state = beamState(renderer, h.ray);
        const other = hand === 'left' ? 'right' : 'left';
        state.hot = hands[other].ray ? pickHandleButton(h.ray, hands[other].ray) : null;
        renderer.setXrSelect(hand, state);
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
    if (!radial) {
      hoverKey = '';
      clearTrainHold();
    }
    /** @type {Set<object>} */
    const claimed = new Set();
    const used = input ? takeHandlePress(input, hands, placing, radial) : blankUsed();
    if (input && radial) stepRadial(input, hands, claimed, used);
    select.step(ctx, {
      suppressTap: placing,
      canBegin: (src) => !claimed.has(src.source),
    });
    if (input) {
      if (placing) stepPlace(input, hands, used);
      else if (!radial) stepPlay(input, hands, used);
    }
    stepHolds(hands);
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
