import { isCameraFollowTypingTarget } from './cameraFollow.js';

// Sole pointer/wheel surface for mouse and touch.
// Document-level move/up like v1 — no pointer capture.
// Touch is fully owned by the touch adapter (its own multi-finger bookkeeping);
// it drives camera + game through the same surfaces mouse uses. Gamepad: call
// nudge* / command helpers directly, same idea.
//
// Boot/match splash gates camera+game via `active`. Held pointers are still
// tracked while locked; on unlock we adopt current positions as a fresh
// gesture baseline so a drag started under the splash doesn't jerk the camera.

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {ReturnType<import('../../render/cameraController.js').createCameraController>} opts.camera
 * @param {ReturnType<import('./gameInput.js').createGameInput>} opts.game
 * @param {ReturnType<import('./touchAdapter.js').createTouchAdapter>} [opts.touch]
 * @param {() => boolean} [opts.active] — when false, camera + game ignore input (boot splash)
 */
export function setupPointerHub({ canvas, camera, game, touch, active }) {
  const isActive = () => active?.() ?? true;
  let wasActive = isActive();

  /**
   * Pointers currently down (tracked even while input is locked).
   * @type {Map<number, { clientX: number, clientY: number, pointerType: string, buttons: number, button: number }>}
   */
  const held = new Map();

  function noteHeldDown(e) {
    held.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
      pointerType: e.pointerType || 'mouse',
      buttons: e.buttons,
      button: e.button,
    });
  }

  function noteHeldMove(e) {
    const h = held.get(e.pointerId);
    if (!h) {
      if (e.buttons) {
        held.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
          pointerType: e.pointerType || 'mouse',
          buttons: e.buttons,
          button: e.buttons & 2 ? 2 : e.buttons & 1 ? 0 : -1,
        });
      }
      return;
    }
    h.clientX = e.clientX;
    h.clientY = e.clientY;
    h.buttons = e.buttons;
  }

  function noteHeldUp(e) {
    held.delete(e.pointerId);
  }

  function synthFromHeld(h, pointerId, type, button) {
    return {
      type,
      clientX: h.clientX,
      clientY: h.clientY,
      button,
      buttons: h.buttons,
      pointerId,
      pointerType: h.pointerType,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
    };
  }

  /**
   * Splash just dropped — drop any in-flight deltas, then re-begin gestures
   * from where the fingers/mouse are right now.
   */
  function resumeFromHeld() {
    camera.clearVelocity?.();
    camera.clearKeyStates?.();
    if (camera.isRmbPanning()) {
      camera.handlePointerUp({ button: 2, type: 'pointercancel', pointerId: -1 });
    }
    game.cancelDrag();
    touch?.reset();

    for (const [id, h] of held) {
      if (h.pointerType === 'touch') {
        touch?.handlePointerDown(synthFromHeld(h, id, 'pointerdown', 0));
        continue;
      }
      if (h.buttons & 2) {
        camera.handlePointerDown(synthFromHeld(h, id, 'pointerdown', 2));
      }
      if (h.buttons & 1) {
        game.handlePointerDown(synthFromHeld(h, id, 'pointerdown', 0));
      }
    }
  }

  /** @returns {{ active: boolean, justUnlocked: boolean }} */
  function syncActive() {
    const on = isActive();
    const justUnlocked = on && !wasActive;
    if (justUnlocked) resumeFromHeld();
    if (!on && wasActive) {
      camera.clearVelocity?.();
      camera.clearKeyStates?.();
      if (camera.isRmbPanning()) {
        camera.handlePointerUp({ button: 2, type: 'pointercancel', pointerId: -1 });
      }
      game.cancelDrag();
      touch?.reset();
    }
    wasActive = on;
    return { active: on, justUnlocked };
  }

  function onPointerDown(e) {
    // Track even over the splash overlay so unlock can re-base from the real hold.
    noteHeldDown(e);
    const { active: on, justUnlocked } = syncActive();
    // Unlock already synthesized downs from `held` (includes this pointer).
    if (!on || justUnlocked) return;
    if (e.target !== canvas && !canvas.contains(/** @type {Node} */ (e.target))) return;

    if (e.pointerType === 'touch') {
      touch?.handlePointerDown(e);
      return;
    }

    if (e.button === 2) {
      game.cancelDrag();
      camera.handlePointerDown(e);
      return;
    }
    if (e.button === 0) {
      game.handlePointerDown(e);
    }
  }

  function onPointerMove(e) {
    noteHeldMove(e);
    const { active: on } = syncActive();
    if (!on) return;
    if (e.pointerType === 'touch') {
      touch?.handlePointerMove(e);
      return;
    }
    if (camera.isRmbPanning()) camera.handlePointerMove(e);
    game.handlePointerMove(e);
  }

  function onPointerUp(e) {
    noteHeldUp(e);
    const { active: on, justUnlocked } = syncActive();
    // If we just unlocked on an up, resume already ran with this id removed — nothing to end.
    if (!on || justUnlocked) return;
    if (e.pointerType === 'touch') {
      touch?.handlePointerUp(e);
      return;
    }

    if (e.type === 'pointercancel') {
      camera.handlePointerUp(e);
      game.handlePointerUp(e);
      return;
    }
    if (e.button === 2) {
      const didPan = camera.handlePointerUp(e);
      if (!didPan) {
        if (game.dismissMenus?.()) return;
        game.forceMoveAt?.(e.clientX, e.clientY);
      }
      return;
    }
    if (e.button === 0) {
      game.handlePointerUp(e);
    }
  }

  function onWheel(e) {
    if (!syncActive().active) return;
    if (e.target !== canvas && !canvas.contains(/** @type {Node} */ (e.target))) return;
    camera.handleWheel(e);
  }

  function onContextMenu(e) {
    if (!isActive()) return;
    if (e.target === canvas || canvas.contains(/** @type {Node} */ (e.target))) {
      e.preventDefault();
    }
  }

  function onKeyDown(e) {
    if (!syncActive().active) return;
    camera.handleKeyDown(e);
  }

  function onKeyUp(e) {
    syncActive();
    // Always release, even while splash/story has input locked — otherwise a
    // keyup during the lock leaves keyStates stuck on.
    camera.handleKeyUp(e);
  }

  function onFocusIn(e) {
    if (!isCameraFollowTypingTarget(e.target)) return;
    camera.clearKeyStates();
    camera.clearVelocity?.();
  }

  function hardClearTouch() {
    held.clear();
    camera.clearKeyStates();
    camera.clearVelocity?.();
    if (camera.isRmbPanning()) {
      camera.handlePointerUp({ button: 2, type: 'pointercancel', pointerId: -1 });
    }
    game.cancelDrag();
    touch?.reset();
  }

  function onBlur() {
    hardClearTouch();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') hardClearTouch();
  }

  // Catch setInteractive(true) even when no pointer event is in flight.
  let raf = 0;
  function pollActive() {
    syncActive();
    raf = requestAnimationFrame(pollActive);
  }
  raf = requestAnimationFrame(pollActive);

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  // Capture so menu/lobby field stopPropagation cannot swallow a release.
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('focusin', onFocusIn);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      touch?.dispose?.();
    },
  };
}
