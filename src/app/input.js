// app/input.js — wires camera + game selection behind a single pointer hub.
// Mouse + touch + standard-mapping gamepad (leash cursor, LT/RT orders, LB/RB select).

import { createGameInput } from './input/gameInput.js';
import { setupPointerHub } from './input/pointerHub.js';
import { createTouchAdapter } from './input/touchAdapter.js';
import { canvasAimClient } from './input/gamepadCursor.js';
import { createGamepadAdapter } from './input/gamepad.js';

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
  let aimOx = 0;
  let aimOy = 0;
  function aimClient() {
    return canvasAimClient(canvas.getBoundingClientRect?.(), aimOx, aimOy);
  }
  const pad = createGamepadAdapter({
    camera,
    active: opts.inputActive,
    getViewport: () => canvas.getBoundingClientRect?.(),
    onAim: (on) => renderer.setGamepadCursorFollow?.(on),
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
    onSelectStart() {
      const c = aimClient();
      if (c) game.beginSelectDrag?.(c.clientX, c.clientY);
    },
    onSelectHold() {
      const c = aimClient();
      if (c) game.updateSelectDrag?.(c.clientX, c.clientY);
    },
    onSelectEnd() {
      const c = aimClient();
      if (c) game.endSelectDrag?.(c.clientX, c.clientY);
    },
    onSelectCancel() {
      game.cancelSelectDrag?.();
    },
  });

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
      renderer.setGamepadCursorFollow?.(false);
      pad.dispose();
      hub.dispose();
    },
  };
}
