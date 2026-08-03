// Selection + orders (LMB). Camera/RMB owned by cameraController via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { isMechanical, isTransport, UNIT } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { canRideTransport, passengerCount, assignNearestRidersToTransport, listPassengers } from '../../sim/transport.js';
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
 * @param {() => { owner: number, x: number, z: number }[]} [opts.getAgoras]
 * @param {() => { owner: number, type: string, x: number, z: number, yaw?: number }[]} [opts.getBuildings]
 * @param {(sel: { kind: 'agora' | 'building', index: number } | null) => void} [opts.onBuildingSelected]
 * @param {() => string | null} [opts.getPlacingType]
 * @param {(buildingType: string | null) => void} [opts.setPlacingType]
 * @param {(x: number, z: number) => void} [opts.onPlacementMove]
 * @param {(x: number, z: number) => void} [opts.onPlacementConfirm]
 * @param {() => void} [opts.onPlacementCancel]
 * @param {() => boolean} [opts.isRadialOpen]
 * @param {(clientX: number, clientY: number) => (string | null) | Promise<string | null>} [opts.pickRadialOption]
 * @param {(buildingType: string) => void} [opts.onRadialPick]
 * @param {(clientX: number, clientY: number) => void} [opts.onRadialHover]
 * @param {(clientX: number, clientY: number) => boolean} [opts.hitRadial]
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
    getAgoras,
    getBuildings,
    onBuildingSelected,
    getPlacingType,
    setPlacingType,
    onPlacementMove,
    onPlacementConfirm,
    onPlacementCancel,
    isRadialOpen,
    pickRadialOption,
    onRadialPick,
    onRadialHover,
    hitRadial,
  } = opts;

  let localPlayerId = initialPlayerId;
  let selectedBuf = selected;
  let inputEnabled = true;
  const getWorld = typeof worldOrGetter === 'function' ? worldOrGetter : () => worldOrGetter;

  /** @type {{ kind: 'agora' | 'building', index: number } | null} */
  let selectedBuilding = null;

  let boxStart = null;
  let dragPointerId = null;
  let lmbDownPos = null;
  /** Latched once pointer exceeds DRAG_THRESHOLD_PX — keeps box updating inside the grace. */
  let boxDragging = false;
  /** Pointer-down started on the build radial — never box-select this gesture. */
  let radialGesture = false;
  let selectionBox = null;
  /** @type {{ t: number, x: number, y: number, kind: 'unit' | 'ground', typeId?: number } | null} */
  let lastTap = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let abilityHoldTimer = null;
  let abilityHoldFired = false;
  let abilityHoldClientX = 0;
  let abilityHoldClientY = 0;
  /** Bumps to cancel in-flight ability-hold GPU picks. */
  let abilityHoldGen = 0;

  ensureSelectionBox();

  function canUseInput() {
    return inputEnabled && localPlayerId >= 0 && (canInteract?.() ?? true);
  }

  function isPlacing() {
    return Boolean(getPlacingType?.());
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

  /**
   * GPU mesh pick → alive, non-passenger entity id, or -1.
   * One pick per click; callers classify by owner / role.
   */
  async function pickUnitAt(clientX, clientY) {
    if (!renderer.pickUnit) return -1;
    const id = await renderer.pickUnit(clientX, clientY);
    if (id < 0) return -1;
    const world = getWorld();
    if (!world.alive[id]) return -1;
    if (world.carriedBy && world.carriedBy[id] >= 0) return -1;
    return id;
  }

  /**
   * GPU mesh pick → own agora / placeable under the cursor (actual mesh), or null.
   * @returns {Promise<{ kind: 'agora' | 'building', index: number } | null>}
   */
  async function pickBuildingAt(clientX, clientY) {
    if (!renderer.pickBuilding) return null;
    const hit = await renderer.pickBuilding(clientX, clientY);
    if (!hit) return null;
    if (hit.kind === 'agora') {
      const a = getAgoras?.()?.[hit.index];
      if (!a || (a.owner | 0) !== localPlayerId) return null;
      return hit;
    }
    const b = getBuildings?.()?.[hit.index];
    if (!b || (b.owner | 0) !== localPlayerId) return null;
    return hit;
  }

  function setSelectedBuilding(sel) {
    selectedBuilding = sel;
  }

  function notifyBuildingSelected(sel, ptr) {
    selectedBuilding = sel;
    onBuildingSelected?.(sel, ptr);
  }

  function clearBuildingSelection() {
    if (!selectedBuilding) {
      onBuildingSelected?.(null);
      return;
    }
    selectedBuilding = null;
    onBuildingSelected?.(null);
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

  function clearUnitSelection() {
    selectedBuf.fill(0);
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  function clearSelection() {
    clearUnitSelection();
    clearBuildingSelection();
    if (isPlacing()) {
      setPlacingType?.(null);
      onPlacementCancel?.();
    }
  }

  function selectAllOfType(typeId, add) {
    const world = getWorld();
    if (!add) selectedBuf.fill(0);
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      if (world.type[i] === typeId) selectedBuf[i] = 1;
    }
    clearBuildingSelection();
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
    if (!canUseInput() || isPlacing()) return;
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
    clearBuildingSelection();
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  /**
   * Everyone goes to the click. Units already inside the group's soft gather
   * disk stay put; the rest path in. Standing soft-sep blooms piles after
   * arrival — no parade grid, no centroid slide.
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
   * @param {number} [preHit] entity id from an earlier pick this click, or -1
   */
  async function orderAt(clientX, clientY, cmdType, preHit) {
    if (!canUseInput() || isPlacing()) return;
    const ids = selectedIds();
    if (ids.length === 0) return;

    const world = getWorld();
    const hit = preHit !== undefined ? preHit : await pickUnitAt(clientX, clientY);

    // Force-move (CMD.MOVE) ignores enemies under the cursor; attack-move still hard-attacks.
    if (
      hit >= 0 &&
      cmdType === CMD.ATTACK_MOVE &&
      isHostile(localPlayerId, world.owner[hit])
    ) {
      enqueueCommand({ type: CMD.ATTACK, entities: ids, target: hit });
      return;
    }

    // Click a friendly transport → nearest selected riders embark (up to capacity).
    // Includes engineers — repair falls through only when nobody can board (full / empty pick).
    if (hit >= 0 && (cmdType === CMD.MOVE || cmdType === CMD.ATTACK_MOVE)) {
      const isOwnTransport =
        world.owner[hit] === localPlayerId &&
        isTransport(world.type[hit]) &&
        !ids.every((id) => id === hit);
      if (isOwnTransport) {
        const assignments = assignNearestRidersToTransport(world, hit, ids);
        if (assignments.length > 0) {
          const moveIds = [...assignments.map((a) => a.riderId), hit];
          const { tx, ty } = moveDestinations(
            moveIds,
            fx.toFloat(world.px[hit]),
            fx.toFloat(world.py[hit]),
          );
          enqueueCommand({
            type: CMD.MOVE,
            entities: moveIds,
            tx,
            ty,
            transportAssignments: assignments,
          });
          // Drop boarding riders from selection; keep everyone else; add the vehicle.
          for (let a = 0; a < assignments.length; a++) {
            selectedBuf[assignments[a].riderId] = 0;
          }
          selectedBuf[hit] = 1;
          clearBuildingSelection();
          syncSelectionSquad();
          onSelectionChanged?.();
          playVillagerMove();
          return;
        }
      }
    }

    // Engineers on a mechanical ally → repair. Mixed selections: only engineers
    // repair; everyone else still gets the ground order (old path returned early).
    let moveIds = ids;
    if (
      hit >= 0 &&
      world.owner[hit] === localPlayerId &&
      isMechanical(world.type[hit])
    ) {
      const engineers = ids.filter((id) => world.type[id] === UNIT.ENGINEER);
      if (engineers.length > 0) {
        enqueueCommand({ type: CMD.ATTACK, entities: engineers, target: hit });
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
    if (!canUseInput() || isPlacing()) return;
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
      const spilled = [];
      for (const t of loadedTransports) {
        const riders = listPassengers(world, t);
        for (let k = 0; k < riders.length; k++) spilled.push(riders[k]);
      }
      enqueueCommand({
        type: CMD.UNLOAD,
        entities: loadedTransports,
        tx: fx.fromFloat(g.x),
        ty: fx.fromFloat(g.z),
      });
      // Drop the vehicles; keep the rest of the selection; add spilled riders.
      const spilledSet = new Set(spilled);
      for (let k = 0; k < loadedTransports.length; k++) {
        selectedBuf[loadedTransports[k]] = 0;
      }
      for (let k = 0; k < spilled.length; k++) selectedBuf[spilled[k]] = 1;
      const sel = [];
      for (let i = 0; i < world.count; i++) {
        if (!selectedBuf[i] || !world.alive[i]) continue;
        // selectedIds skips carried — include spilled even before sim unloads.
        if (world.carriedBy?.[i] >= 0 && !spilledSet.has(i)) continue;
        sel.push(i);
      }
      enqueueCommand({
        type: CMD.SELECT,
        playerId: localPlayerId,
        entities: sel,
      });
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

  async function armAbilityHold(clientX, clientY) {
    clearAbilityHold();
    abilityHoldFired = false;
    abilityHoldClientX = clientX;
    abilityHoldClientY = clientY;
    if (isPlacing() || selectedIds().length === 0) return;
    // Don't arm over own units — that press is for selection.
    const gen = ++abilityHoldGen;
    const world = getWorld();
    const hit = await pickUnitAt(clientX, clientY);
    if (gen !== abilityHoldGen) return;
    if (hit >= 0 && world.owner[hit] === localPlayerId) return;
    if (boxDragging || dragPointerId == null) return;

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

    // Latch pointer state synchronously — never await before this or pointerup is lost.
    boxStart = { x: e.clientX, y: e.clientY };
    lmbDownPos = { x: e.clientX, y: e.clientY };
    dragPointerId = e.pointerId;
    boxDragging = false;
    abilityHoldFired = false;
    hideSelectionBox();

    // Placement: LMB down starts a click; confirm on up.
    if (isPlacing()) {
      radialGesture = false;
      return true;
    }

    // Sync only — GPU picks here starve the picker and race pointerup.
    radialGesture = Boolean(isRadialOpen?.() && hitRadial?.(e.clientX, e.clientY));
    if (!radialGesture) void armAbilityHold(e.clientX, e.clientY);
    return true;
  }

  function handlePointerMove(e) {
    if (!canUseInput()) return false;

    if (isPlacing()) {
      const g = renderer.screenToGround?.(e.clientX, e.clientY);
      if (g) onPlacementMove?.(g.x, g.z);
      return true;
    }

    if (isRadialOpen?.()) {
      void onRadialHover?.(e.clientX, e.clientY);
      if (radialGesture) return true;
    }

    if (dragPointerId !== e.pointerId || !boxStart) return false;
    if (radialGesture) return true;
    const moved = Math.hypot(e.clientX - boxStart.x, e.clientY - boxStart.y);
    if (!boxDragging && moved > DRAG_THRESHOLD_PX) {
      boxDragging = true;
      abilityHoldGen++;
      clearAbilityHold();
    }
    if (boxDragging) showSelectionBox(boxStart.x, boxStart.y, e.clientX, e.clientY);
    else {
      abilityHoldClientX = e.clientX;
      abilityHoldClientY = e.clientY;
    }
    return true;
  }

  /**
   * Normal LMB click (select unit / building / order / clear).
   * Shared by free clicks and radial misses so the menu never traps selection.
   */
  async function handleWorldClick(e, d) {
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD_PX) return;
    const world = getWorld();
    const hit = await pickUnitAt(e.clientX, e.clientY);
    if (hit >= 0 && world.owner[hit] === localPlayerId) {
      const selected = selectedIds();
      // Riders selected + click transport → embark (don't steal as re-select).
      const embarkClick =
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        isTransport(world.type[hit]) &&
        selected.some((id) => id !== hit && canRideTransport(world.type[id]));
      if (embarkClick) {
        lastTap = null;
        await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit);
      } else {
        const typeId = world.type[hit];
        const selectAll =
          e.ctrlKey || e.metaKey || consumeDoubleTap(e.clientX, e.clientY, 'unit', { typeId });
        if (selectAll) {
          selectAllOfType(typeId, e.shiftKey);
        } else {
          if (!e.shiftKey) selectedBuf.fill(0);
          selectedBuf[hit] = 1;
          clearBuildingSelection();
          syncSelectionSquad();
          onSelectionChanged?.();
        }
      }
      return;
    }

    const bld = await pickBuildingAt(e.clientX, e.clientY);
    if (bld) {
      lastTap = null;
      clearUnitSelection();
      notifyBuildingSelected(bld, { clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (selectedIds().length > 0) {
      // Immediate attack-move; double-tap upgrades to force-move (arrow reuses ping).
      // Reuse `hit` so we don't GPU-pick twice in one click.
      if (consumeDoubleTap(e.clientX, e.clientY, 'ground')) {
        await orderAt(e.clientX, e.clientY, CMD.MOVE, hit);
      } else {
        await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit);
      }
      return;
    }

    lastTap = null;
    clearBuildingSelection();
  }

  async function handlePointerUp(e) {
    if (e.button !== 0 && e.type !== 'pointercancel') return false;
    if (dragPointerId === null) return false;
    if (e.pointerId !== dragPointerId && e.type !== 'pointercancel') return false;

    const d = lmbDownPos;
    lmbDownPos = null;
    const wasDragging = boxDragging;
    const holdCast = abilityHoldFired;
    const wasRadialGesture = radialGesture;
    boxDragging = false;
    abilityHoldFired = false;
    radialGesture = false;
    abilityHoldGen++;
    clearAbilityHold();

    if (canUseInput() && e.type !== 'pointercancel') {
      if (isPlacing()) {
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_THRESHOLD_PX) {
          const g = renderer.screenToGround?.(e.clientX, e.clientY);
          if (g) onPlacementConfirm?.(g.x, g.z);
        }
      } else {
        let radialHandled = false;
        if (isRadialOpen?.() || wasRadialGesture) {
          // One GPU mesh pick on click only (not on move / down).
          const picked = await pickRadialOption?.(e.clientX, e.clientY);
          if (picked) {
            lastTap = null;
            onRadialPick?.(picked);
            radialHandled = true;
          } else if (wasRadialGesture || hitRadial?.(e.clientX, e.clientY)) {
            // Ring / near-option gesture — keep menu, no world click.
            lastTap = null;
            radialHandled = true;
          }
        }

        if (!radialHandled) {
          if (holdCast) {
            // Ability already issued on hold — swallow click so we don't also attack-move.
            lastTap = null;
          } else if (wasDragging && boxStart) {
            lastTap = null;
            boxSelect(boxStart.x, boxStart.y, e.clientX, e.clientY, e.shiftKey);
          } else {
            await handleWorldClick(e, d);
          }
        }
      }
    }

    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    return true;
  }

  function cancelDrag() {
    abilityHoldGen++;
    clearAbilityHold();
    abilityHoldFired = false;
    radialGesture = false;
    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    lmbDownPos = null;
    boxDragging = false;
  }

  /** RMB / Esc while placing — cancel placement. */
  function cancelPlacement() {
    if (!isPlacing()) return false;
    setPlacingType?.(null);
    onPlacementCancel?.();
    return true;
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    cancelDrag,
    clearSelection,
    cancelPlacement,
    getSelectedBuilding: () => selectedBuilding,
    setSelectedBuilding(sel) {
      notifyBuildingSelected(sel);
    },
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
        abilityHoldGen++;
        clearAbilityHold();
        clearSelection();
      }
    },
    setRole(role) {
      inputEnabled = role === 'player' || role === 'livePlayer' || role === 'sandboxPlayer' || role === 'stagingPlayer';
      if (!inputEnabled) {
        abilityHoldGen++;
        clearAbilityHold();
        clearSelection();
      }
    },
  };
}
