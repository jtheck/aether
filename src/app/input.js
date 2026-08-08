// app/input.js — wires camera + game selection behind a single pointer hub.
// Mouse + touch now; gamepad adapters plug into the same surfaces later.

import { createGameInput } from './input/gameInput.js';
import { setupPointerHub } from './input/pointerHub.js';
import { createTouchAdapter } from './input/touchAdapter.js';

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
 * @param {() => boolean} [opts.inputActive] — gates camera + game (boot splash)
 */
export function setupInput(opts) {
  const camera = opts.renderer.cameraController;
  if (!camera) {
    throw new Error('setupInput requires renderer.cameraController');
  }

  const game = createGameInput(opts);
  const touch = createTouchAdapter({ canvas: opts.canvas, camera, game });

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
    deselectEntity: (i) => game.deselectEntity?.(i),
    cancelPlacement: () => game.cancelPlacement?.(),
    getSelectedBuilding: () => game.getSelectedBuilding?.(),
    setSelectedBuilding: (sel) => game.setSelectedBuilding?.(sel),
    dispose: () => hub.dispose(),
  };
}
