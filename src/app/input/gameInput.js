// Selection + orders (LMB). Camera/RMB owned by cameraController via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { getUnitDef } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { playVillagerMove } from '../audio.js';

/** v1 lasso drag threshold. */
export const DRAG_THRESHOLD_PX = 25;
/** Manual double-tap window — PointerEvent.detail is not a click count. */
const DOUBLE_MS = 350;
const DOUBLE_PX = 14;
/** Tap+hold on ground with selection → primary ability cast. */
const ABILITY_HOLD_MS = 400;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.renderer
 * @param {object|(() => object)} opts.world
 * @param {Uint8Array} opts.selected
 * @param {number} opts.localPlayerId
 * @param {(i: number) => {x:number,y:number,z:number}} opts.getUnitWorldPos
 * @param {(cmd: object) => void} opts.enqueueCommand
 * @param {() => void} [opts.onSelectionChanged]
 * @param {(x: number, z: number, y?: number) => void} [opts.onOrder]
 * @param {(x: number, z: number, y?: number) => void} [opts.onAbilityHold]
 * @param {() => boolean} [opts.canInteract]
 */
export function createGameInput(opts) {
  const {
    canvas,
    renderer,
    world: worldOrGetter,
    selected,
    localPlayerId: initialPlayerId,
    getUnitWorldPos,
    enqueueCommand,
    onSelectionChanged,
    onOrder,
    onAbilityHold,
    canInteract,
  } = opts;

  let localPlayerId = initialPlayerId;
  let selectedBuf = selected;
  let inputEnabled = true;
  const getWorld = typeof worldOrGetter === 'function' ? worldOrGetter : () => worldOrGetter;

  let boxStart = null;
  let dragPointerId = null;
  let lmbDownPos = null;
  /** Latched once pointer exceeds DRAG_THRESHOLD_PX — keeps box updating inside the grace. */
  let boxDragging = false;
  let selectionBox = null;
  /** @type {{ t: number, x: number, y: number, kind: 'unit' | 'ground', typeId?: number } | null} */
  let lastTap = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let abilityHoldTimer = null;
  let abilityHoldFired = false;
  let abilityHoldClientX = 0;
  let abilityHoldClientY = 0;

  ensureSelectionBox();

  function canUseInput() {
    return inputEnabled && localPlayerId >= 0 && (canInteract?.() ?? true);
  }

  function ensureSelectionBox() {
    if (selectionBox) return;
    selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.cssText =
      'position:fixed;display:none;border:1px solid rgba(255,230,80,0.9);background:rgba(255,230,80,0.12);pointer-events:none;z-index:10;';
    document.body.appendChild(selectionBox);
  }

  function showSelectionBox(x0, y0, x1, y1) {
    ensureSelectionBox();
    selectionBox.style.left = `${Math.min(x0, x1)}px`;
    selectionBox.style.top = `${Math.min(y0, y1)}px`;
    selectionBox.style.width = `${Math.abs(x1 - x0)}px`;
    selectionBox.style.height = `${Math.abs(y1 - y0)}px`;
    selectionBox.style.display = 'block';
  }

  function hideSelectionBox() {
    if (selectionBox) selectionBox.style.display = 'none';
  }

  function clearAbilityHold() {
    if (abilityHoldTimer != null) {
      clearTimeout(abilityHoldTimer);
      abilityHoldTimer = null;
    }
  }

  function buildSphereList(filter) {
    const world = getWorld();
    const list = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      if (filter && !filter(i)) continue;
      const def = getUnitDef(world.type[i]);
      const pos = getUnitWorldPos(i);
      // Sim `size` is a formation spacing hint, not mesh radius — keep picks body-sized.
      const r = def.pickRadius ?? 1.8;
      list.push({
        id: i,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        r,
      });
    }
    return list;
  }

  function pickUnit(clientX, clientY, filter) {
    return renderer.rayPickSpheres(clientX, clientY, buildSphereList(filter));
  }

  function selectedIds() {
    const world = getWorld();
    const ids = [];
    for (let i = 0; i < world.count; i++) {
      if (selectedBuf[i] && world.alive[i]) ids.push(i);
    }
    return ids;
  }

  function clearSelection() {
    selectedBuf.fill(0);
    onSelectionChanged?.();
  }

  function selectAllOfType(typeId, add) {
    const world = getWorld();
    if (!add) selectedBuf.fill(0);
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.type[i] === typeId) selectedBuf[i] = 1;
    }
    onSelectionChanged?.();
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {'unit' | 'ground'} kind
   * @param {{ typeId?: number }} [extra]
   */
  function consumeDoubleTap(clientX, clientY, kind, extra = {}) {
    const now = performance.now();
    const prev = lastTap;
    const matched =
      !!prev &&
      prev.kind === kind &&
      now - prev.t <= DOUBLE_MS &&
      Math.hypot(clientX - prev.x, clientY - prev.y) <= DOUBLE_PX &&
      (kind !== 'unit' || prev.typeId === extra.typeId);
    lastTap = { t: now, x: clientX, y: clientY, kind, typeId: extra.typeId };
    return matched;
  }

  function boxSelect(x0, y0, x1, y1, add) {
    if (!canUseInput()) return;
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1) - rect.left;
    const maxX = Math.max(x0, x1) - rect.left;
    const minY = Math.min(y0, y1) - rect.top;
    const maxY = Math.max(y0, y1) - rect.top;
    if (!add) selectedBuf.fill(0);
    const world = getWorld();
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      const pos = getUnitWorldPos(i);
      const p = renderer.worldToScreen(pos.x, pos.y, pos.z);
      if (!p) continue;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) selectedBuf[i] = 1;
    }
    onSelectionChanged?.();
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {number} cmdType
   */
  function orderAt(clientX, clientY, cmdType) {
    if (!canUseInput()) return;
    const ids = selectedIds();
    if (ids.length === 0) return;

    const world = getWorld();
    const enemy = pickUnit(clientX, clientY, (i) => isHostile(localPlayerId, world.owner[i]));
    // Force-move (CMD.MOVE) ignores enemies under the cursor; attack-move still hard-attacks.
    if (enemy >= 0 && cmdType === CMD.ATTACK_MOVE) {
      enqueueCommand({ type: CMD.ATTACK, entities: ids, target: enemy });
      return;
    }

    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;
    onOrder?.(g.x, g.z, g.y, cmdType);

    const n = ids.length;
    const tx = new Array(n);
    const ty = new Array(n);
    if (n === 1) {
      tx[0] = fx.fromFloat(g.x);
      ty[0] = fx.fromFloat(g.z);
    } else {
      const sorted = ids.slice().sort((a, b) => a - b);
      const slotOf = new Map();
      for (let s = 0; s < sorted.length; s++) slotOf.set(sorted[s], s);
      const spacing = 2.5;
      const unitsPerRow = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / unitsPerRow);
      for (let k = 0; k < n; k++) {
        const index = slotOf.get(ids[k]);
        const row = Math.floor(index / unitsPerRow);
        const col = index % unitsPerRow;
        const colOffset = Math.round((col - (unitsPerRow - 1) / 2) * spacing * 100) / 100;
        const rowOffset = Math.round((row - (rows - 1) / 2) * spacing * 100) / 100;
        tx[k] = fx.fromFloat(Math.round((g.x + colOffset) * 100) / 100);
        ty[k] = fx.fromFloat(Math.round((g.z + rowOffset) * 100) / 100);
      }
    }
    enqueueCommand({ type: cmdType, entities: ids, tx, ty });
    // Placeholder SFX — proves Howler works until real unit VO lands.
    playVillagerMove();
  }

  /** Tap+hold cast — always procs feedback; sim no-ops units without a live ability. */
  function castAbilityAt(clientX, clientY) {
    if (!canUseInput()) return;
    const ids = selectedIds();
    if (ids.length === 0) return;
    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;

    onAbilityHold?.(g.x, g.z, g.y);
    enqueueCommand({
      type: CMD.CAST,
      entities: ids,
      tx: fx.fromFloat(g.x),
      ty: fx.fromFloat(g.z),
    });
  }

  function armAbilityHold(clientX, clientY) {
    clearAbilityHold();
    abilityHoldFired = false;
    abilityHoldClientX = clientX;
    abilityHoldClientY = clientY;
    if (selectedIds().length === 0) return;
    // Don't arm over own units — that press is for selection.
    const world = getWorld();
    const own = pickUnit(clientX, clientY, (i) => world.owner[i] === localPlayerId);
    if (own >= 0) return;

    abilityHoldTimer = setTimeout(() => {
      abilityHoldTimer = null;
      if (boxDragging || dragPointerId == null) return;
      abilityHoldFired = true;
      castAbilityAt(abilityHoldClientX, abilityHoldClientY);
    }, ABILITY_HOLD_MS);
  }

  function handlePointerDown(e) {
    if (!canUseInput()) return false;
    if (e.pointerType === 'touch') return false;
    if (e.button !== 0) return false;

    boxStart = { x: e.clientX, y: e.clientY };
    lmbDownPos = { x: e.clientX, y: e.clientY };
    dragPointerId = e.pointerId;
    boxDragging = false;
    abilityHoldFired = false;
    hideSelectionBox();
    armAbilityHold(e.clientX, e.clientY);
    return true;
  }

  function handlePointerMove(e) {
    if (!canUseInput()) return false;
    if (dragPointerId !== e.pointerId || !boxStart) return false;
    const moved = Math.hypot(e.clientX - boxStart.x, e.clientY - boxStart.y);
    if (!boxDragging && moved > DRAG_THRESHOLD_PX) {
      boxDragging = true;
      clearAbilityHold();
    }
    if (boxDragging) showSelectionBox(boxStart.x, boxStart.y, e.clientX, e.clientY);
    else {
      abilityHoldClientX = e.clientX;
      abilityHoldClientY = e.clientY;
    }
    return true;
  }

  function handlePointerUp(e) {
    if (e.button !== 0 && e.type !== 'pointercancel') return false;
    if (dragPointerId === null) return false;
    if (e.pointerId !== dragPointerId && e.type !== 'pointercancel') return false;

    const d = lmbDownPos;
    lmbDownPos = null;
    const wasDragging = boxDragging;
    const holdCast = abilityHoldFired;
    boxDragging = false;
    abilityHoldFired = false;
    clearAbilityHold();

    if (canUseInput() && e.type !== 'pointercancel') {
      if (holdCast) {
        // Ability already issued on hold — swallow click so we don't also attack-move.
        lastTap = null;
      } else if (wasDragging && boxStart) {
        lastTap = null;
        boxSelect(boxStart.x, boxStart.y, e.clientX, e.clientY, e.shiftKey);
      } else if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_THRESHOLD_PX) {
        const world = getWorld();
        const hit = pickUnit(e.clientX, e.clientY, (i) => world.owner[i] === localPlayerId);
        if (hit >= 0) {
          const typeId = world.type[hit];
          const selectAll =
            e.ctrlKey || e.metaKey || consumeDoubleTap(e.clientX, e.clientY, 'unit', { typeId });
          if (selectAll) {
            selectAllOfType(typeId, e.shiftKey);
          } else {
            if (!e.shiftKey) selectedBuf.fill(0);
            selectedBuf[hit] = 1;
            onSelectionChanged?.();
          }
        } else if (selectedIds().length > 0) {
          // Immediate attack-move; double-tap upgrades to force-move (arrow reuses ping).
          if (consumeDoubleTap(e.clientX, e.clientY, 'ground')) {
            orderAt(e.clientX, e.clientY, CMD.MOVE);
          } else {
            orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE);
          }
        } else {
          lastTap = null;
        }
      }
    }

    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    return true;
  }

  function cancelDrag() {
    clearAbilityHold();
    abilityHoldFired = false;
    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    lmbDownPos = null;
    boxDragging = false;
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    cancelDrag,
    clearSelection,
    canUseInput,
    setLocalPlayerId(id) {
      localPlayerId = id;
    },
    setSelectedBuffer(buf) {
      selectedBuf = buf;
    },
    setInputEnabled(enabled) {
      inputEnabled = Boolean(enabled);
      if (!inputEnabled) {
        clearAbilityHold();
        clearSelection();
      }
    },
    setRole(role) {
      inputEnabled = role === 'player' || role === 'livePlayer' || role === 'sandboxPlayer';
      if (!inputEnabled) {
        clearAbilityHold();
        clearSelection();
      }
    },
  };
}
