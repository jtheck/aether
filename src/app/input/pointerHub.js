// Sole pointer/wheel surface for mouse and touch.
// Document-level move/up like v1 — no pointer capture.
// Touch is fully owned by the touch adapter (its own multi-finger bookkeeping);
// it drives camera + game through the same surfaces mouse uses. Gamepad: call
// nudge* / command helpers directly, same idea.

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

  function onPointerDown(e) {
    if (!isActive()) return;
    if (e.target !== canvas && !canvas.contains(/** @type {Node} */ (e.target))) return;

    if (e.pointerType === 'touch') {
      touch?.handlePointerDown(e);
      return;
    }

    if (e.button === 2) {
      game.cancelDrag();
      // Always allow camera pan while placing — cancel placement only on a
      // click (no drag) in pointerup, not here on down.
      camera.handlePointerDown(e);
      return;
    }
    if (e.button === 0) {
      game.handlePointerDown(e);
    }
  }

  function onPointerMove(e) {
    if (!isActive()) return;
    if (e.pointerType === 'touch') {
      touch?.handlePointerMove(e);
      return;
    }
    if (camera.isRmbPanning()) camera.handlePointerMove(e);
    game.handlePointerMove(e);
  }

  function onPointerUp(e) {
    if (!isActive()) return;
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
      // RMB drag pans; RMB tap = dismiss build menus / ghost, else force-move.
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
    if (!isActive()) return;
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
    if (!isActive()) return;
    camera.handleKeyDown(e);
  }

  function onKeyUp(e) {
    if (!isActive()) return;
    camera.handleKeyUp(e);
  }

  function onBlur() {
    camera.clearKeyStates();
    if (camera.isRmbPanning()) {
      camera.handlePointerUp({ button: 2, type: 'pointercancel', pointerId: -1 });
    }
    game.cancelDrag();
    touch?.reset();
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    dispose() {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
