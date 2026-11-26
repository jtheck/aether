// Headset control scheme for Quest Touch (two face buttons per hand,
// stick + click, grip, trigger). When XR_SWAP_TRIGGER_GRIP is on, trigger and
// grip swap the roles below.
//
//   Select button   tap picks under the beam, hold and sweep lassoes.
//                   Holding the other select button still makes a release additive.
//   Left action     force-move at the left beam; held repeats.
//   Right action    attack-move at the right beam; held repeats.
//                   A selected production building plants a train rally
//                   (force-move / attack-move) even while its action pie is open.
//   Face primary    unit ability at that hand's beam; held repeats (see controlMods).
//   Face secondary  cancel: back out of a pie or ghost-place, or clear the selection.
//   Sticks          either stick pans, no deadzone. Both the same way add.
//                   The stick already out keeps panning; the other turns.
//                   Pinch/spread: free crawl, four stepped heights (ground-run
//                   plus three floats), free roam above. Ground-run until a
//                   full deliberate pinch. Right stick click
//                   latches follow on the selection until a pan or another
//                   click. Left stick click (hold) steps those four heights on a repeat timer.
//                   Neither click takes the sticks off pan.
// Wrist pads: control-group triangles in a row up the arm, pause on that
// same face. The other hand's ray draws a dot on the row; its action
// button taps the pad. Face A/B/X/Y stay on the controller, not the bracer.
//
// Pie menu open (agora build / building actions): point a beam at a slice.
// Action or select on that slice picks it. Holding either on a unit keeps
// queuing. An action press that misses the pie issues the same order as in
// play (rally when buildings are selected).
// The sticks keep panning, turning, and lifting while a pie is open.
// Ghost-place: the beam walks the ghost. Facing is where the beam sits
// inside the plot. Either action button stamps. X / A backs out, and so does a
// select sweep that catches nothing. A select tap does not select.
// Bracer + a short aim stub stay on while controllers track; full beam length
// when the select button or trigger touch is down, or in a pie / ghost-place.

import { heldRepeat } from './input/gamepad.js';
import {
  XR_ALTITUDE_CLICK_INITIAL_MS,
  XR_ALTITUDE_CLICK_REPEAT_MS,
  XR_HELD_CAST_INITIAL_MS,
  XR_HELD_CAST_REPEAT_MS,
  XR_HELD_ORDER_INITIAL_MS,
  XR_HELD_ORDER_REPEAT_MS,
} from './controlMods.js';
import {
  questActionDown,
  questActionHeld,
  questActionUp,
  questSelectDown,
  questSelectHeldPad,
} from './xrQuestButtons.js';
import { readQuestTouch } from './xrRig.js';
import { beamState, createXrSelect, rayHeadHeight, sourceRay } from './xrSelect.js';
import { pickHandleButton, wristAimLocal, wristControlGroupId, XR_BEAM_STUB_FRAC } from '../render/xrLasso.js';
import { nextQueueHold, unitQueueKey } from './input/queueHold.js';

const HANDS = /** @type {const} */ (['left', 'right']);
const BUTTONS = /** @type {const} */ (['trigger', 'grip', 'primary', 'secondary', 'stickClick']);
/** Hold left stick click to walk altitude presets (see controlMods for ms). */
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
 *   onPauseToggle?: () => void,
 * }} opts
 */
export function createXrControls({
  renderer,
  getInput,
  onFollowToggle,
  onAltitude,
  onPauseToggle,
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
  /** Group id while the other trigger is down on a wrist pad (release needs hold assign). */
  const wristGroupHold = { left: null, right: null };
  let altitudeClickHold = 0;
  let altitudeClickHeldAt = 0;
  let altitudeClickLastAt = 0;
  const castHold = { left: 0, right: 0 };
  const castHeldAt = { left: 0, right: 0 };
  const castLastAt = { left: 0, right: 0 };
  const orderHold = { left: 0, right: 0 };
  const orderHeldAt = { left: 0, right: 0 };
  const orderLastAt = { left: 0, right: 0 };

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

  function bracerVisible(handRay) {
    return !!handRay;
  }

  function fullBeam(h, wideMenu) {
    return h.held.touch || questSelectHeldPad(h.held) || wideMenu;
  }

  /**
   * Other-hand trigger on a visible handle pad. The pad uses the laser it
   * sits on. A held trigger keeps that hand from also ordering or queuing.
   */
  function takeHandlePress(input, hands, placing, radialOpen) {
    const used = blankUsed();
    if (!input) return used;
    for (const hand of HANDS) {
      const otherName = hand === 'left' ? 'right' : 'left';
      const other = hands[otherName];
      if (questActionDown(other.down) || questActionUp(other.up)) {
        const heldId = wristGroupHold[otherName];
        if (questActionUp(other.up) && heldId != null) {
          input.handleControlGroupUp?.(heldId);
          wristGroupHold[otherName] = null;
          used[otherName] = true;
        }
      }
    }
    if (placing) return used;
    for (const hand of HANDS) {
      if (!bracerVisible(hands[hand].ray)) continue;
      const otherName = hand === 'left' ? 'right' : 'left';
      const other = hands[otherName];
      if (!other.ray) continue;
      const hit = pickHandleButton(hands[hand].ray, other.ray);
      if (hit == null) {
        if (!questActionHeld(other.held) && wristGroupHold[otherName] != null) {
          wristGroupHold[otherName] = null;
          input.handleControlGroupCancel?.();
        }
        continue;
      }
      if (questActionHeld(other.held) || questActionDown(other.down)) used[otherName] = true;
      if (!questActionDown(other.down)) continue;
      if (hit === 5) {
        onPauseToggle?.();
        continue;
      }
      const gid = wristControlGroupId(hand, hit);
      if (gid == null) continue;
      wristGroupHold[otherName] = gid;
      if (questSelectHeldPad(other.held)) input.handleControlGroupDown?.(gid, { addNow: true });
      else input.pressControlGroup?.(gid);
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
      const unitId = ((questActionHeld(h.held) && !used[hand]) || questSelectHeldPad(h.held))
        ? unitQueueKey(beam[hand])
        : null;
      if (unitId) {
        if (questSelectHeldPad(h.held)) claimed.add(h.src?.source);
        const next = nextQueueHold(trainHold, unitId, now());
        trainHold = { id: next.id, heldAt: next.heldAt, lastAt: next.lastAt };
        if (next.fire) input.confirmRadialPick?.(beam[hand]);
        return;
      }
      if (questSelectDown(d) && beam[hand]) {
        claimed.add(h.src?.source);
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
      if (questActionDown(d) && !used[hand] && beam[hand]) {
        input.confirmRadialPick?.(beam[hand]);
        return;
      }
    }
    clearTrainHold();
    issueTriggerOrders(input, hands, used);
  }

  /** Left force-moves, right attack-moves. Held action buttons repeat on a timer. */
  function issueTriggerOrders(input, hands, used) {
    const t = now();
    for (const hand of HANDS) {
      const h = hands[hand];
      const on = questActionHeld(h.held) && !used[hand] && h.ray ? 1 : 0;
      const rep = heldRepeat(
        on,
        orderHold[hand],
        t,
        orderHeldAt[hand],
        orderLastAt[hand],
        XR_HELD_ORDER_INITIAL_MS,
        XR_HELD_ORDER_REPEAT_MS,
      );
      orderHold[hand] = on;
      orderHeldAt[hand] = rep.heldAt;
      orderLastAt[hand] = rep.lastAt;
      if (!rep.fire) continue;
      if (hand === 'left') input.forceMoveAtRay?.(h.ray);
      else input.attackMoveAtRay?.(h.ray);
    }
  }

  /** Face primary held: repeat cast at each hand's beam (play mode only). */
  function stepCastRepeat(input, hands) {
    const t = now();
    for (const hand of HANDS) {
      const h = hands[hand];
      const on = h.held.primary && h.ray ? 1 : 0;
      const rep = heldRepeat(
        on,
        castHold[hand],
        t,
        castHeldAt[hand],
        castLastAt[hand],
        XR_HELD_CAST_INITIAL_MS,
        XR_HELD_CAST_REPEAT_MS,
      );
      castHold[hand] = on;
      castHeldAt[hand] = rep.heldAt;
      castLastAt[hand] = rep.lastAt;
      if (rep.fire) input.castAbilityAtRay?.(h.ray);
    }
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
      if (questActionDown(hands[hand].down) && !used[hand]) {
        input.confirmPlacementAtRay?.(hands[hand].ray);
        return;
      }
    }
  }

  function stepPlay(input, hands, used) {
    issueTriggerOrders(input, hands, used);
    for (const hand of HANDS) {
      if (hands[hand].down.secondary) {
        input.clearSelection?.();
        return;
      }
    }
    stepCastRepeat(input, hands);
  }

  function stepHolds(hands) {
    if (hands.right.down.stickClick) onFollowToggle?.();
    const t = now();
    const held = hands.left.held.stickClick ? 1 : 0;
    const rep = heldRepeat(
      held,
      altitudeClickHold,
      t,
      altitudeClickHeldAt,
      altitudeClickLastAt,
      XR_ALTITUDE_CLICK_INITIAL_MS,
      XR_ALTITUDE_CLICK_REPEAT_MS,
    );
    altitudeClickHold = held;
    altitudeClickHeldAt = rep.heldAt;
    altitudeClickLastAt = rep.lastAt;
    if (rep.fire) onAltitude?.();
  }

  function stepBeams(hands, wide) {
    for (const hand of HANDS) {
      const h = hands[hand];
      const want = bracerVisible(h.ray) && !select.isActive(hand);
      if (want) {
        const state = beamState(renderer, h.ray);
        if (!fullBeam(h, wide)) {
          const head = rayHeadHeight(renderer, h.ray);
          state.length = head * XR_BEAM_STUB_FRAC;
        }
        const other = hand === 'left' ? 'right' : 'left';
        const hot = hands[other].ray ? pickHandleButton(h.ray, hands[other].ray) : null;
        const poking = questActionHeld(hands[other].held);
        state.hot = hot;
        state.aim = hands[other].ray ? wristAimLocal(h.ray, hands[other].ray) : null;
        state.press = {
          pause: !!(poking && hot === 5),
          group: poking && hot != null && hot >= 2 && hot <= 4 ? hot : -1,
        };
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
