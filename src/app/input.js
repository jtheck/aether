// app/input.js — wires camera + game selection behind a single pointer hub.
// Mouse + touch + standard-mapping gamepad (leash cursor, LT/RT orders, LB/RB
// paint-select, B / D-pad Left cast, D-pad U/R/D + Y/X/A control groups).
// Place overlay: aim walks the ghost; A / LT / RT stamp, B cancels, bumpers yaw.
// Pad play hides the OS pointer and shows the field mark. Mouse motion or
// click yields both so a pad on the desk cannot steal the camera.
// Menu A on a text field opens the in-game keyboard.

import { createGameInput } from './input/gameInput.js';
import { setupPointerHub } from './input/pointerHub.js';
import { createTouchAdapter } from './input/touchAdapter.js';
import { canvasAimClient, setPadOsCursorHidden, shouldYieldPadToPointer } from './input/gamepadCursor.js';
import { createGamepadAdapter } from './input/gamepad.js';
import { openOsKbd } from './osKbd.js';
import { aetherSteam, createSteamOverlayGuard } from './steam.js';

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.renderer — must expose cameraController (from createRenderer)
 * @param {object|(() => object)} opts.world
 * @param {Uint8Array} opts.selected
 * @param {number} opts.localPlayerId
 * @param {(i: number, out: {x:number,y:number,z:number}) => {x:number,y:number,z:number}} opts.getUnitWorldPos
 * @param {(cmd: object) => void} opts.enqueueCommand
 * @param {() => void} [opts.onSelectionChanged]
 * @param {(x: number, z: number, y?: number) => void} [opts.onOrder]
 * @param {(x: number, z: number, y?: number) => void} [opts.onAbilityHold]
 * @param {() => boolean} [opts.canInteract]
 * @param {() => boolean} [opts.canIssueCommands] — when false, select/inspect only (no order markers)
 * @param {() => boolean} [opts.inputActive] — gates camera + game (boot splash)
 */
export function setupInput(opts) {
  const camera = opts.renderer.cameraController;
  if (!camera) {
    throw new Error('setupInput requires renderer.cameraController');
  }

  const game = createGameInput(opts);
  const touch = createTouchAdapter({ canvas: opts.canvas, camera, game });
  const renderer = opts.renderer;
  const canvas = opts.canvas;
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  let aimOx = 0;
  let aimOy = 0;
  let padAiming = false;
  function aimClient() {
    return canvasAimClient(canvas.getBoundingClientRect?.(), aimOx, aimOy);
  }
  function hideOsCursor() {
    setPadOsCursorHidden(true, doc);
  }
  function showOsCursor() {
    setPadOsCursorHidden(false, doc);
  }
  const overlay = createSteamOverlayGuard({
    steam: aetherSteam,
    window: win,
    root: win ?? globalThis,
  });
  const pad = createGamepadAdapter({
    camera,
    active: opts.inputActive,
    yieldPad: () => overlay.isActive(),
    getViewport: () => canvas.getBoundingClientRect?.(),
    onAim(on) {
      renderer.setGamepadCursorFollow?.(on);
      if (on && !padAiming) hideOsCursor();
      else if (!on && padAiming) showOsCursor();
      padAiming = !!on;
    },
    onActivity: hideOsCursor,
    onTextEdit(el) {
      openOsKbd(el);
    },
    onCursor(ox, oy) {
      aimOx = ox;
      aimOy = oy;
      renderer.setGamepadCursorOffset?.(ox, oy);
    },
    onAttackMove() {
      const c = aimClient();
      if (c) game.attackMoveAt?.(c.clientX, c.clientY);
    },
    onForceMove() {
      const c = aimClient();
      if (c) game.forceMoveAt?.(c.clientX, c.clientY);
    },
    onSelectStart(chord = {}) {
      const c = aimClient();
      if (c) game.beginSelectDrag?.(c.clientX, c.clientY, chord);
    },
    onSelectHold(chord = {}) {
      const c = aimClient();
      if (c) game.updateSelectDrag?.(c.clientX, c.clientY, chord);
    },
    onSelectEnd() {
      const c = aimClient();
      if (c) game.endSelectDrag?.(c.clientX, c.clientY);
    },
    onSelectCancel() {
      game.cancelSelectDrag?.();
    },
    onCast() {
      const c = aimClient();
      if (c) game.castAbilityAt?.(c.clientX, c.clientY);
    },
    onControlGroupDown(id) {
      game.handleControlGroupDown?.(id);
    },
    onControlGroupUp(id) {
      game.handleControlGroupUp?.(id);
    },
    onControlGroupCancel() {
      game.handleControlGroupCancel?.();
    },
    radialOpen: () => opts.isRadialOpen?.() ?? false,
    getRadialTargets: () => opts.getRadialStickTargets?.() ?? null,
    onRadialHover: (pick) => opts.onRadialStickHover?.(pick),
    onRadialConfirm: (pick) => {
      if (pick) opts.onRadialPick?.(pick);
    },
    onRadialCancel: () => opts.onRadialCancel?.(),
    placing: () => game.isPlacing?.() ?? false,
    onPlaceAim() {
      const c = aimClient();
      if (c) game.previewPlacementAt?.(c.clientX, c.clientY);
    },
    onPlaceConfirm() {
      const c = aimClient();
      if (c) game.confirmPlacementAt?.(c.clientX, c.clientY);
    },
    onPlaceCancel() {
      game.cancelPlacement?.();
    },
    onPlaceRotateDrag() {
      const c = aimClient();
      if (c) game.rotatePlacementAt?.(c.clientX, c.clientY);
    },
  });

  function onPointerYield(e) {
    if (!shouldYieldPadToPointer(e)) return;
    showOsCursor();
    pad.yieldToPointer();
  }
  win?.addEventListener?.('pointermove', onPointerYield, { passive: true });
  win?.addEventListener?.('pointerdown', onPointerYield, { passive: true });
  win?.addEventListener?.('wheel', onPointerYield, { passive: true });

  const hub = setupPointerHub({
    canvas: opts.canvas,
    camera,
    game,
    touch,
    active: opts.inputActive,
  });

  return {
    setLocalPlayerId: (id) => game.setLocalPlayerId(id),
    setSelectedBuffer: (buf) => game.setSelectedBuffer(buf),
    setInputEnabled: (enabled) => game.setInputEnabled(enabled),
    setRole: (role) => game.setRole(role),
    clearSelection: () => game.clearSelection(),
    clearControlGroups: () => game.clearControlGroups?.(),
    syncControlGroupMarks: () => game.syncControlGroupMarks?.(),
    handleControlGroupKeyDown: (e) => game.handleControlGroupKeyDown?.(e) ?? false,
    handleControlGroupKeyUp: (e) => game.handleControlGroupKeyUp?.(e) ?? false,
    deselectEntity: (i) => game.deselectEntity?.(i),
    cancelPlacement: () => game.cancelPlacement?.(),
    getSelectedBuilding: () => game.getSelectedBuilding?.(),
    setSelectedBuilding: (sel) => game.setSelectedBuilding?.(sel),
    dispose: () => {
      win?.removeEventListener?.('pointermove', onPointerYield);
      win?.removeEventListener?.('pointerdown', onPointerYield);
      win?.removeEventListener?.('wheel', onPointerYield);
      overlay.dispose();
      showOsCursor();
      renderer.setGamepadCursorFollow?.(false);
      pad.dispose();
      hub.dispose();
    },
  };
}
