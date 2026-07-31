// Sole pointer/wheel surface for mouse (now).
// Document-level move/up like v1 — no pointer capture.
// Touch later: synthesize into this hub. Gamepad: call nudge* / command helpers.

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {ReturnType<import('../../render/cameraController.js').createCameraController>} opts.camera
 * @param {ReturnType<import('./gameInput.js').createGameInput>} opts.game
 */
export function setupPointerHub({ canvas, camera, game }) {
  function onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (e.target !== canvas && !canvas.contains(/** @type {Node} */ (e.target))) return;

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
    if (e.pointerType === 'touch') return;
    if (camera.isRmbPanning()) camera.handlePointerMove(e);
    game.handlePointerMove(e);
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') return;

    if (e.type === 'pointercancel') {
      camera.handlePointerUp(e);
      game.handlePointerUp(e);
      return;
    }
    if (e.button === 2) {
      camera.handlePointerUp(e);
      return;
    }
    if (e.button === 0) {
      game.handlePointerUp(e);
    }
  }

  function onWheel(e) {
    if (e.target !== canvas && !canvas.contains(/** @type {Node} */ (e.target))) return;
    camera.handleWheel(e);
  }

  function onContextMenu(e) {
    if (e.target === canvas || canvas.contains(/** @type {Node} */ (e.target))) {
      e.preventDefault();
    }
  }

  function onKeyDown(e) {
    camera.handleKeyDown(e);
  }

  function onKeyUp(e) {
    camera.handleKeyUp(e);
  }

  function onBlur() {
    camera.clearKeyStates();
    if (camera.isRmbPanning()) {
      camera.handlePointerUp({ button: 2, type: 'pointercancel', pointerId: -1 });
    }
    game.cancelDrag();
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
