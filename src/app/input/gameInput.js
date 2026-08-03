// Selection + orders (LMB). Camera/RMB owned by cameraController via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { getUnitDef, isMechanical, isTransport, UNIT } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { canRideTransport, passengerCount } from '../../sim/transport.js';
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
      // Passengers ride inside — not independently pickable.
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
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
      if (!selectedBuf[i] || !world.alive[i]) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      ids.push(i);
    }
    return ids;
  }

  /** Push current selection into the sim so monks skip co-selected friendlies. */
  function syncSelectionSquad() {
    if (!canUseInput()) return;
    enqueueCommand({
      type: CMD.SELECT,
      playerId: localPlayerId,
      entities: selectedIds(),
    });
  }

  function clearSelection() {
    selectedBuf.fill(0);
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  function selectAllOfType(typeId, add) {
    const world = getWorld();
    if (!add) selectedBuf.fill(0);
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      if (world.type[i] === typeId) selectedBuf[i] = 1;
    }
    syncSelectionSquad();
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
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      const pos = getUnitWorldPos(i);
      const p = renderer.worldToScreen(pos.x, pos.y, pos.z);
      if (!p) continue;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) selectedBuf[i] = 1;
    }
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  /**
   * Everyone goes to the click. Soft-separation handles overlap — no parade grid,
   * no centroid slide (clicking inside the blob used to no-op).
   * @param {number[]} ids
   * @param {number} gx
   * @param {number} gz
   */
  function moveDestinations(ids, gx, gz) {
    const n = ids.length;
    const tx = new Array(n);
    const ty = new Array(n);
    const x = fx.fromFloat(gx);
    const z = fx.fromFloat(gz);
    for (let k = 0; k < n; k++) {
      tx[k] = x;
      ty[k] = z;
    }
    return { tx, ty };
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

    // Click a friendly transport → embark riders (explicit). Do not auto-board on
    // every mixed move — that stole half the army away from the click.
    // Engineer-only clicks still fall through to repair below.
    if (cmdType === CMD.MOVE || cmdType === CMD.ATTACK_MOVE) {
      const transport = pickUnit(
        clientX,
        clientY,
        (i) =>
          world.owner[i] === localPlayerId &&
          isTransport(world.type[i]) &&
          !ids.every((id) => id === i),
      );
      if (transport >= 0) {
        const riders = ids.filter(
          (id) => id !== transport && canRideTransport(world.type[id]),
        );
        const onlyEngineers =
          riders.length > 0 && riders.every((id) => world.type[id] === UNIT.ENGINEER);
        if (riders.length > 0 && !onlyEngineers) {
          const moveIds = [...riders, transport];
          const { tx, ty } = moveDestinations(
            moveIds,
            fx.toFloat(world.px[transport]),
            fx.toFloat(world.py[transport]),
          );
          enqueueCommand({
            type: CMD.MOVE,
            entities: moveIds,
            tx,
            ty,
            transportAssignments: riders.map((riderId) => ({
              riderId,
              transportId: transport,
            })),
          });
          playVillagerMove();
          return;
        }
      }
    }

    // Engineers on a mechanical ally → repair. Mixed selections: only engineers
    // repair; everyone else still gets the ground order (old path returned early).
    const ally = pickUnit(
      clientX,
      clientY,
      (i) => world.owner[i] === localPlayerId && isMechanical(world.type[i]),
    );
    let moveIds = ids;
    if (ally >= 0) {
      const engineers = ids.filter((id) => world.type[id] === UNIT.ENGINEER);
      if (engineers.length > 0) {
        enqueueCommand({ type: CMD.ATTACK, entities: engineers, target: ally });
        moveIds = ids.filter((id) => world.type[id] !== UNIT.ENGINEER);
        if (moveIds.length === 0) {
          playVillagerMove();
          return;
        }
      }
    }

    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;
    onOrder?.(g.x, g.z, g.y, cmdType);

    const { tx, ty } = moveDestinations(moveIds, g.x, g.z);
    enqueueCommand({ type: cmdType, entities: moveIds, tx, ty });
    // Placeholder SFX — proves Howler works until real unit VO lands.
    playVillagerMove();
  }

  /** Tap+hold — unload loaded transports, else cast primary ability. */
  function castAbilityAt(clientX, clientY) {
    if (!canUseInput()) return;
    const ids = selectedIds();
    if (ids.length === 0) return;
    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;

    const world = getWorld();
    const loadedTransports = ids.filter(
      (i) => isTransport(world.type[i]) && passengerCount(world, i) > 0,
    );
    if (loadedTransports.length > 0) {
      onAbilityHold?.(g.x, g.z, g.y);
      enqueueCommand({
        type: CMD.UNLOAD,
        entities: loadedTransports,
        tx: fx.fromFloat(g.x),
        ty: fx.fromFloat(g.z),
      });
      for (const t of loadedTransports) selectedBuf[t] = 0;
      syncSelectionSquad();
      onSelectionChanged?.();
      return;
    }

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
            syncSelectionSquad();
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
