// Selection + orders (LMB). Camera pan / force-move on RMB via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { snapBuildingYaw } from '../../sim/buildings.js';
import { isMechanical, isTransport, UNIT } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { canRideTransport, passengerCount, assignNearestRidersToTransport, listPassengers, transportCapacityOf } from '../../sim/transport.js';
import { playVillagerMove } from '../audio.js';

/** v1 lasso drag threshold. */
export const DRAG_THRESHOLD_PX = 25;
/** Hold-drag past this while placing enters rotate mode. */
const PLACE_ROTATE_THRESHOLD_PX = 18;
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
 * @param {(x: number, z: number, yaw?: number) => void} [opts.onPlacementMove]
 * @param {(x: number, z: number, yaw?: number) => void} [opts.onPlacementConfirm]
 * @param {() => void} [opts.onPlacementCancel]
 * @param {() => number} [opts.getPlacementYaw]
 * @param {(yaw: number) => void} [opts.setPlacementYaw]
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
    getPlacementYaw,
    setPlacementYaw,
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
  /** @type {{ x: number, z: number } | null} */
  let placeAnchor = null;
  let placeRotating = false;
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
  /**
   * Bumps when a newer LMB press/click supersedes an older one.
   * Under stress, click-1's GPU pick can finish after click-2's force-move and
   * re-issue attack-move — epoch checks drop those stale completions.
   */
  let worldClickEpoch = 0;

  ensureSelectionBox();

  function clickCurrent(epoch) {
    return epoch === worldClickEpoch;
  }

  function canUseInput() {
    return inputEnabled && localPlayerId >= 0 && (canInteract?.() ?? true);
  }

  function isPlacing() {
    return Boolean(getPlacingType?.());
  }

  /**
   * Drop ghost placement without re-selecting the agora (unlike cancelPlacement).
   * Used when the player leaves build UI by selecting units / clearing.
   */
  function abandonPlacement() {
    if (!isPlacing()) return;
    resetPlaceGesture();
    setPlacingType?.(null);
  }

  function currentYaw() {
    return getPlacementYaw?.() ?? 0;
  }

  function emitPlacementGhost(x, z, yaw = currentYaw()) {
    onPlacementMove?.(x, z, yaw);
  }

  function resetPlaceGesture() {
    placeAnchor = null;
    placeRotating = false;
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
   * GPU mesh pick → alive entity id, or -1.
   * Passengers resolve to their transport (clicking the deck = click the vehicle).
   */
  async function pickUnitAt(clientX, clientY) {
    if (!renderer.pickUnit) return -1;
    const id = await renderer.pickUnit(clientX, clientY);
    if (id < 0) return -1;
    const world = getWorld();
    if (!world.alive[id]) return -1;
    const carrier = world.carriedBy?.[id] ?? -1;
    if (carrier >= 0) {
      return world.alive[carrier] ? carrier : -1;
    }
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
    abandonPlacement();
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

  function boxSelect(x0, y0, x1, y1, add) {
    if (!canUseInput()) return;
    // Selecting units leaves build/place UI.
    abandonPlacement();
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
   * @param {number} [epoch] worldClickEpoch snapshot — drop if superseded
   */
  async function orderAt(clientX, clientY, cmdType, preHit, epoch) {
    if (!canUseInput() || isPlacing()) return;
    const ids = selectedIds();
    if (ids.length === 0) return;
    if (epoch !== undefined && !clickCurrent(epoch)) return;

    const world = getWorld();
    const hit = preHit !== undefined ? preHit : await pickUnitAt(clientX, clientY);
    if (epoch !== undefined && !clickCurrent(epoch)) return;

    // Force-move (CMD.MOVE) ignores enemies under the cursor; attack-move still hard-attacks.
    if (
      hit >= 0 &&
      cmdType === CMD.ATTACK_MOVE &&
      isHostile(localPlayerId, world.owner[hit])
    ) {
      if (epoch !== undefined && !clickCurrent(epoch)) return;
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
          if (epoch !== undefined && !clickCurrent(epoch)) return;
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
        if (epoch !== undefined && !clickCurrent(epoch)) return;
        enqueueCommand({ type: CMD.ATTACK, entities: engineers, target: hit });
        moveIds = ids.filter((id) => world.type[id] !== UNIT.ENGINEER);
        if (moveIds.length === 0) {
          playVillagerMove();
          return;
        }
      }
    }

    // Friendly under cursor that wasn't embark/repair — don't smash a ground
    // order onto them (caller should have re-selected instead).
    if (hit >= 0 && world.owner[hit] === localPlayerId) return;

    const g = renderer.screenToGround(clientX, clientY);
    if (!g) return;
    if (epoch !== undefined && !clickCurrent(epoch)) return;
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

    // Arm the timer immediately. Waiting on GPU pick first made hold-cast miss under
    // stress (pick latency ate the whole gesture before the 400ms timer even started).
    const gen = ++abilityHoldGen;
    abilityHoldTimer = setTimeout(() => {
      abilityHoldTimer = null;
      if (gen !== abilityHoldGen) return;
      if (boxDragging || dragPointerId == null) return;
      abilityHoldFired = true;
      castAbilityAt(abilityHoldClientX, abilityHoldClientY);
    }, ABILITY_HOLD_MS);

    // Best-effort: cancel if this press is on an own unit (selection, not cast).
    const world = getWorld();
    const hit = await pickUnitAt(clientX, clientY);
    if (gen !== abilityHoldGen) return;
    if (hit >= 0 && world.owner[hit] === localPlayerId) {
      clearAbilityHold();
      abilityHoldFired = false;
    }
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

    // Placement: LMB down locks anchor; drag past threshold rotates (30° snaps).
    // Radial stays usable so you can switch building type without canceling.
    if (isPlacing()) {
      radialGesture = Boolean(isRadialOpen?.() && hitRadial?.(e.clientX, e.clientY));
      placeRotating = false;
      placeAnchor = null;
      if (!radialGesture) {
        const g = renderer.screenToGround?.(e.clientX, e.clientY);
        if (g) {
          placeAnchor = { x: g.x, z: g.z };
          emitPlacementGhost(g.x, g.z, currentYaw());
        }
      }
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
      if (isRadialOpen?.()) void onRadialHover?.(e.clientX, e.clientY);
      if (radialGesture) return true;

      const g = renderer.screenToGround?.(e.clientX, e.clientY);
      if (!g) return true;

      // LMB held with an anchor → rotate once dragged far enough.
      if (dragPointerId === e.pointerId && placeAnchor && lmbDownPos) {
        const moved = Math.hypot(e.clientX - lmbDownPos.x, e.clientY - lmbDownPos.y);
        if (moved > PLACE_ROTATE_THRESHOLD_PX) {
          placeRotating = true;
          const yaw = snapBuildingYaw(Math.atan2(g.x - placeAnchor.x, g.z - placeAnchor.z));
          setPlacementYaw?.(yaw);
          emitPlacementGhost(placeAnchor.x, placeAnchor.z, yaw);
          return true;
        }
        if (placeRotating) {
          emitPlacementGhost(placeAnchor.x, placeAnchor.z, currentYaw());
          return true;
        }
      }

      // Free cursor move (or pre-threshold hold): ghost follows pointer.
      if (dragPointerId !== e.pointerId || !placeRotating) {
        emitPlacementGhost(g.x, g.z, currentYaw());
      }
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
   * @param {PointerEvent} e
   * @param {{ x: number, y: number } | null} d
   * @param {{
   *   tapAt?: number,
   *   forceMove?: boolean,
   *   prevTap?: { t: number, x: number, y: number, kind: 'unit' | 'ground', typeId?: number } | null,
   *   epoch?: number,
   * }} [click]
   */
  async function handleWorldClick(e, d, click = {}) {
    const tapAt = click.tapAt ?? performance.now();
    const prevTap = click.prevTap !== undefined ? click.prevTap : lastTap;
    const epoch = click.epoch ?? worldClickEpoch;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD_PX) return;
    const world = getWorld();
    const hit = await pickUnitAt(e.clientX, e.clientY);
    if (!clickCurrent(epoch)) return;
    if (hit >= 0 && world.owner[hit] === localPlayerId) {
      const selected = selectedIds();
      // Riders + room on transport → embark. Otherwise always re-select (never
      // ground-move onto a friendly — full vehicles / random infantry included).
      const canEmbark =
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        isTransport(world.type[hit]) &&
        passengerCount(world, hit) < transportCapacityOf(world.type[hit]) &&
        selected.some((id) => id !== hit && canRideTransport(world.type[id]));
      if (canEmbark) {
        lastTap = null;
        if (!clickCurrent(epoch)) return;
        await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit, epoch);
      } else {
        const typeId = world.type[hit];
        const selectAll =
          e.ctrlKey ||
          e.metaKey ||
          (!!prevTap &&
            prevTap.kind === 'unit' &&
            prevTap.typeId === typeId &&
            tapAt - prevTap.t <= DOUBLE_MS &&
            Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) <= DOUBLE_PX);
        if (!clickCurrent(epoch)) return;
        lastTap = { t: tapAt, x: e.clientX, y: e.clientY, kind: 'unit', typeId };
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
    if (!clickCurrent(epoch)) return;
    if (bld) {
      lastTap = null;
      clearUnitSelection();
      notifyBuildingSelected(bld, { clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (selectedIds().length > 0) {
      if (!clickCurrent(epoch)) return;
      await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit, epoch);
      return;
    }

    if (!clickCurrent(epoch)) return;
    lastTap = null;
    clearBuildingSelection();
  }

  async function handlePointerUp(e) {
    if (e.button !== 0 && e.type !== 'pointercancel') return false;
    if (dragPointerId === null) return false;
    if (e.pointerId !== dragPointerId && e.type !== 'pointercancel') return false;

    // Capture before any await — GPU picks under stress can take longer than DOUBLE_MS.
    const tapAt = performance.now();
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

    // Snapshot before this click mutates lastTap (unit double-select-all).
    const prevTap = lastTap;

    if (canUseInput() && e.type !== 'pointercancel') {
      if (isPlacing()) {
        let radialHandled = false;
        if (isRadialOpen?.() || wasRadialGesture) {
          const picked = await pickRadialOption?.(e.clientX, e.clientY);
          if (picked) {
            lastTap = null;
            onRadialPick?.(picked);
            radialHandled = true;
          } else if (wasRadialGesture || hitRadial?.(e.clientX, e.clientY)) {
            lastTap = null;
            radialHandled = true;
          }
        }
        if (!radialHandled) {
          // Clicking an own unit abandons place mode and selects (don't confirm place).
          const unitHit = await pickUnitAt(e.clientX, e.clientY);
          const world = getWorld();
          if (
            unitHit >= 0 &&
            world.owner[unitHit] === localPlayerId &&
            d &&
            Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_THRESHOLD_PX
          ) {
            abandonPlacement();
            lastTap = {
              t: tapAt,
              x: e.clientX,
              y: e.clientY,
              kind: 'unit',
              typeId: world.type[unitHit],
            };
            if (!e.shiftKey) selectedBuf.fill(0);
            selectedBuf[unitHit] = 1;
            clearBuildingSelection();
            syncSelectionSquad();
            onSelectionChanged?.();
          } else {
            const yaw = currentYaw();
            if (placeRotating && placeAnchor) {
              onPlacementConfirm?.(placeAnchor.x, placeAnchor.z, yaw);
            } else if (
              d &&
              Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_THRESHOLD_PX
            ) {
              const g =
                placeAnchor ??
                renderer.screenToGround?.(e.clientX, e.clientY);
              if (g) onPlacementConfirm?.(g.x, g.z, yaw);
            }
          }
        }
        resetPlaceGesture();
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
            const epoch = ++worldClickEpoch;
            await handleWorldClick(e, d, { tapAt, prevTap, epoch });
          }
        }
      }
    }

    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    return true;
  }

  /**
   * RMB tap (no pan) / touch 2-finger later — force MOVE to ground.
   * No unit pick; ignores enemies. Drag pan is filtered by the camera controller.
   */
  function forceMoveAt(clientX, clientY) {
    if (!canUseInput() || isPlacing()) return false;
    if (selectedIds().length === 0) return false;
    lastTap = null;
    const epoch = ++worldClickEpoch;
    void orderAt(clientX, clientY, CMD.MOVE, -1, epoch);
    return true;
  }

  function cancelDrag() {
    worldClickEpoch++;
    abilityHoldGen++;
    clearAbilityHold();
    abilityHoldFired = false;
    radialGesture = false;
    resetPlaceGesture();
    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    lmbDownPos = null;
    boxDragging = false;
  }

  /** Esc / RMB-tap while placing — cancel placement. */
  function cancelPlacement() {
    if (!isPlacing()) return false;
    resetPlaceGesture();
    setPlacingType?.(null);
    onPlacementCancel?.();
    return true;
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    forceMoveAt,
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
