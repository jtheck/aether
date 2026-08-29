// Selection + orders (LMB). Camera pan / force-move on RMB via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { snapBuildingYaw, BUILDING_FOOTPRINTS, buildingCanRally, isBuildingAlive, isRallyBeyondBuilding } from '../../sim/buildings.js';
import {
  CONTROL_GROUP_HOLD_MS,
  assignControlGroup,
  controlGroupFilled,
  controlGroupIdFromCode,
  createEmptyControlGroups,
  livingControlGroup,
} from './controlGroups.js';
import { MAX_ENTITIES, ORDER } from '../../sim/world.js';
import { isMechanical, isTransport, UNIT, getUnitDef, unitAttacksBuildings } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { canRideTransport, passengerCount, assignNearestRidersToTransport, listPassengers, transportCapacityOf } from '../../sim/transport.js';
import { playVillagerMove } from '../audio.js';
import { TILE_SIZE_F } from '../../sim/field.js';
import { SCENERY } from '../../sim/scenery.js';
import { USE_GPU_PICK } from '../../render/pickMode.js';
import {
  boxSelectWinner,
  inspectForeignOnClick,
  mergeBuildingSels,
  radialClickKind,
  radialHubFramedBuilding,
  screenPosInRect,
  twoFingerConsumesBuildUi,
} from './buildingSelect.js';
import { pickGatherNodeOnRay, rayHitYawBox, rayTToPoint } from './gatherPick.js';

/** Footprint box height — tall enough for a tower, not a circumcircle. */
const BUILDING_PICK_HEIGHT = 10;
/** Slight pad so a click on the eaves still counts. */
const BUILDING_PICK_HALO = 0.35;
/** Reused empty hit list — never mutate. */
const EMPTY_HITS = Object.freeze([]);

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
 * @param {(i: number, out: {x:number,y:number,z:number}) => {x:number,y:number,z:number}} opts.getUnitWorldPos
 * @param {(cmd: object) => void} opts.enqueueCommand
 * @param {() => void} [opts.onSelectionChanged]
 * @param {(x: number, z: number, y?: number, cmdType?: number, tile?: number, extra?: { arrow?: number }) => void} [opts.onOrder]
 * @param {(x: number, z: number, y?: number) => void} [opts.onAbilityHold]
 * @param {() => boolean} [opts.canInteract]
 * @param {() => { owner: number, x: number, z: number }[]} [opts.getAgoras]
 * @param {() => { owner: number, type: string, x: number, z: number, yaw?: number }[]} [opts.getBuildings]
 * @param {(sel: { kind: 'agora' | 'building', index: number } | null, ptr?: { clientX: number, clientY: number }, all?: { kind: 'agora' | 'building', index: number }[]) => void} [opts.onBuildingSelected]
 * @param {() => string | null} [opts.getPlacingType]
 * @param {(buildingType: string | null) => void} [opts.setPlacingType]
 * @param {(x: number, z: number, yaw?: number) => void} [opts.onPlacementMove]
 * @param {(x: number, z: number, yaw?: number) => void} [opts.onPlacementConfirm]
 * @param {() => void} [opts.onPlacementCancel]
 * @param {() => boolean} [opts.isPlacingRally]
 * @param {(x: number, z: number) => void} [opts.onRallyMove]
 * @param {(x: number, z: number) => void} [opts.onRallyConfirm]
 * @param {() => void} [opts.onRallyCancel]
 * @param {() => void} [opts.clearRallyPlacement]
 * @param {() => number} [opts.getPlacementYaw]
 * @param {(yaw: number) => void} [opts.setPlacementYaw]
 * @param {() => boolean} [opts.isRadialOpen]
 * @param {(clientX: number, clientY: number) => (string | null) | Promise<string | null>} [opts.pickRadialOption]
 * @param {(pick: string | { kind: 'building' | 'category' | 'unit' | 'upgrade' | 'pause' | 'cancel', id?: string }) => void} [opts.onRadialPick]
 * @param {(clientX: number, clientY: number) => void} [opts.onRadialHover]
 * @param {(clientX: number, clientY: number) => boolean} [opts.hitRadial]
 * @param {(clientX: number, clientY: number) => boolean} [opts.hitRadialHub]
 * @param {(i: number) => boolean} [opts.isUnitVisible] — skip fog-hidden hostiles
 * @param {(owner: number, x: number, z: number) => boolean} [opts.isStructureVisible] — skip fog-hidden hostiles
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
    isPlacingRally,
    onRallyMove,
    onRallyConfirm,
    onRallyCancel,
    clearRallyPlacement,
    getPlacementYaw,
    setPlacementYaw,
    isRadialOpen,
    pickRadialOption,
    onRadialPick,
    onRadialHover,
    hitRadial,
    hitRadialHub,
    isUnitVisible,
    isStructureVisible,
    getField,
  } = opts;

  let localPlayerId = initialPlayerId;
  let selectedBuf = selected;
  let inputEnabled = true;
  const getWorld = typeof worldOrGetter === 'function' ? worldOrGetter : () => worldOrGetter;

  /** Dense selection list — bitset stays for O(1) membership; list for O(sel) orders. */
  const selIds = new Int32Array(MAX_ENTITIES);
  const selSlot = new Int32Array(MAX_ENTITIES);
  selSlot.fill(-1);
  let selCount = 0;

  function selectEntity(i) {
    if (i < 0) return;
    renderer.pingUnit?.(i);
    if (selSlot[i] >= 0) return;
    selSlot[i] = selCount;
    selIds[selCount++] = i;
    selectedBuf[i] = 1;
  }

  function deselectEntity(i) {
    const s = selSlot[i];
    if (s < 0) {
      selectedBuf[i] = 0;
      return;
    }
    const last = selIds[--selCount];
    selIds[s] = last;
    selSlot[last] = s;
    selSlot[i] = -1;
    selectedBuf[i] = 0;
  }

  /** Drop dead / externally cleared entries; keep carried (orders skip them). */
  function compactSelection() {
    const world = getWorld();
    let w = 0;
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      if (!selectedBuf[i] || !world.alive[i]) {
        selectedBuf[i] = 0;
        selSlot[i] = -1;
        continue;
      }
      if (w !== k) {
        selIds[w] = i;
        selSlot[i] = w;
      }
      w++;
    }
    selCount = w;
  }

  function rebuildDenseFromBuf() {
    selCount = 0;
    selSlot.fill(-1);
    const n = selectedBuf.length;
    for (let i = 0; i < n; i++) {
      if (!selectedBuf[i]) continue;
      selSlot[i] = selCount;
      selIds[selCount++] = i;
    }
  }

  /** @type {{ kind: 'agora' | 'building', index: number } | null} */
  let selectedBuilding = null;
  /** @type {{ kind: 'agora' | 'building', index: number }[]} */
  let selectedBuildings = [];

  let boxStart = null;
  let dragPointerId = null;
  let lmbDownPos = null;
  /** Latched once pointer exceeds DRAG_THRESHOLD_PX — keeps box updating inside the grace. */
  let boxDragging = false;
  /** Pointer-down started on the build radial — never box-select this gesture. */
  let radialGesture = false;
  /** Pointer-down started on a bottom selection-strip chip — select that type on up. */
  let selHudGesture = false;
  /** Pad id (0..5) when pointer-down started on a control-group button. */
  let ctrlGroupGesture = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let ctrlGroupHoldTimer = null;
  let ctrlGroupHoldFired = false;
  /** @type {{ units: number[], buildings: { kind: string, index: number }[] }[]} */
  let controlGroups = createEmptyControlGroups();
  /** @type {{ x: number, z: number } | null} */
  let placeAnchor = null;
  let placeRotating = false;
  let selectionBox = null;
  /** @type {{ t: number, x: number, y: number, kind: 'unit' | 'ground' | 'enemy' | 'building', typeId?: number, buildingTypeKey?: string } | null} */
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
    return Boolean(getPlacingType?.()) || Boolean(isPlacingRally?.());
  }

  /**
   * Drop ghost placement without re-selecting the agora (unlike cancelPlacement).
   * Used when the player leaves build UI by selecting units / clearing.
   */
  function abandonPlacement() {
    if (!isPlacing()) return;
    resetPlaceGesture();
    if (isPlacingRally?.()) {
      if (clearRallyPlacement) clearRallyPlacement();
      else onRallyCancel?.();
    } else setPlacingType?.(null);
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

  function clearCtrlGroupHold() {
    if (ctrlGroupHoldTimer != null) {
      clearTimeout(ctrlGroupHoldTimer);
      ctrlGroupHoldTimer = null;
    }
    renderer.setControlGroupHold?.(null);
  }

  function markControlGroupFilled(id) {
    const live = livingControlGroup(
      controlGroups[id],
      getWorld(),
      localPlayerId,
      getBuildings?.(),
      getAgoras?.(),
    );
    renderer.setControlGroupCount?.(id, live.units.length + live.buildings.length);
    return live;
  }

  function syncControlGroupMarks() {
    for (let i = 0; i < controlGroups.length; i++) {
      const g = controlGroups[i];
      if (!g.units.length && !g.buildings.length) {
        renderer.setControlGroupCount?.(i, 0);
        continue;
      }
      markControlGroupFilled(i);
    }
  }

  function snapshotControlGroupSelection() {
    compactSelection();
    const world = getWorld();
    /** @type {number[]} */
    const units = [];
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      units.push(i);
    }
    /** @type {{ kind: string, index: number }[]} */
    const buildings = [];
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (buildingOwnerOf(sel) !== localPlayerId) continue;
      if (sel.kind === 'building') {
        const b = getBuildings?.()?.[sel.index];
        if (!isBuildingAlive(b)) continue;
      } else if (sel.kind === 'agora') {
        if (!getAgoras?.()?.[sel.index]) continue;
      }
      buildings.push({ kind: sel.kind, index: sel.index });
    }
    return { units, buildings };
  }

  function assignCurrentToControlGroup(id) {
    const snap = snapshotControlGroupSelection();
    if (!assignControlGroup(controlGroups, id, snap.units, snap.buildings)) return;
    markControlGroupFilled(id);
  }

  function selectControlGroup(id) {
    const live = markControlGroupFilled(id);
    if (!controlGroupFilled(live)) return;
    abandonPlacement();
    if (live.units.length > 0) {
      clearUnitSelectionBits();
      for (let k = 0; k < live.units.length; k++) selectEntity(live.units[k]);
      clearBuildingSelection();
      syncSelectionSquad();
      onSelectionChanged?.();
      return;
    }
    clearUnitSelection();
    setBuildingSelection(live.buildings, false, live.buildings[0]);
  }

  function resetControlGroups() {
    controlGroups = createEmptyControlGroups();
    for (let i = 0; i < controlGroups.length; i++) {
      renderer.setControlGroupCount?.(i, 0);
    }
  }

  function armCtrlGroupHold(id) {
    clearCtrlGroupHold();
    ctrlGroupHoldFired = false;
    renderer.setControlGroupHold?.(id);
    ctrlGroupHoldTimer = setTimeout(() => {
      ctrlGroupHoldTimer = null;
      if (ctrlGroupGesture !== id || dragPointerId == null) return;
      ctrlGroupHoldFired = true;
      assignCurrentToControlGroup(id);
    }, CONTROL_GROUP_HOLD_MS);
  }

  function hitControlGroupHud(clientX, clientY) {
    return renderer.pickControlGroupHud?.(clientX, clientY) != null;
  }

  /** Number-key hold (1-6) — separate from the pad pointer gesture. */
  let ctrlGroupKeyId = null;
  let ctrlGroupKeyAssigned = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let ctrlGroupKeyTimer = null;

  function clearCtrlGroupKeyHold() {
    if (ctrlGroupKeyTimer != null) {
      clearTimeout(ctrlGroupKeyTimer);
      ctrlGroupKeyTimer = null;
    }
    if (ctrlGroupGesture == null) renderer.setControlGroupHold?.(null);
  }

  /**
   * Digit / numpad 1-6: tap selects, hold assigns (same as the pads).
   * Ctrl/Cmd+number assigns immediately.
   * @param {KeyboardEvent} e
   */
  function handleControlGroupKeyDown(e) {
    if (e.altKey) return false;
    const id = controlGroupIdFromCode(e.code);
    if (id == null || !canUseInput()) return false;
    e.preventDefault();
    if (e.repeat) return true;

    if (e.ctrlKey || e.metaKey) {
      clearCtrlGroupKeyHold();
      ctrlGroupKeyId = id;
      ctrlGroupKeyAssigned = true;
      assignCurrentToControlGroup(id);
      renderer.setControlGroupHold?.(id);
      return true;
    }

    clearCtrlGroupKeyHold();
    ctrlGroupKeyId = id;
    ctrlGroupKeyAssigned = false;
    renderer.setControlGroupHold?.(id);
    ctrlGroupKeyTimer = setTimeout(() => {
      ctrlGroupKeyTimer = null;
      if (ctrlGroupKeyId !== id) return;
      ctrlGroupKeyAssigned = true;
      assignCurrentToControlGroup(id);
    }, CONTROL_GROUP_HOLD_MS);
    return true;
  }

  /** @param {KeyboardEvent} e */
  function handleControlGroupKeyUp(e) {
    const id = controlGroupIdFromCode(e.code);
    if (id == null || ctrlGroupKeyId !== id) return false;
    const assigned = ctrlGroupKeyAssigned;
    ctrlGroupKeyId = null;
    ctrlGroupKeyAssigned = false;
    clearCtrlGroupKeyHold();
    if (!assigned && canUseInput()) selectControlGroup(id);
    return true;
  }

  // --- CPU pick scratch (no per-click allocations on the live path) ---
  /** @type {{ id: number, x: number, y: number, z: number, r: number }[]} */
  const unitSpherePool = [];
  /** @type {{ id: { kind: 'agora' | 'building', index: number }, x: number, y: number, z: number }[]} */
  const buildingPickPool = [];
  const unitHitIds = new Int32Array(MAX_ENTITIES);
  const unitHitTs = new Float32Array(MAX_ENTITIES);
  const resolvedHitIds = [];
  const posScratch = { x: 0, y: 0, z: 0 };
  const seenStamp = new Uint32Array(MAX_ENTITIES);
  let seenGen = 1;

  function beginSeen() {
    seenGen++;
    if (seenGen === 0xffffffff) {
      seenStamp.fill(0);
      seenGen = 1;
    }
  }

  /** Fill unitSpherePool; returns live count. */
  function fillUnitPickSpheres() {
    const world = getWorld();
    let n = 0;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      if (isUnitVisible && !isUnitVisible(i)) continue;
      const def = getUnitDef(world.type[i]);
      getUnitWorldPos(i, posScratch);
      let sp = unitSpherePool[n];
      if (!sp) unitSpherePool[n] = sp = { id: 0, x: 0, y: 0, z: 0, r: 0 };
      sp.id = i;
      sp.x = posScratch.x;
      sp.y = posScratch.y;
      sp.z = posScratch.z;
      sp.r = def?.pickRadius ?? 1.8;
      n++;
    }
    return n;
  }

  function buildingFootHalf(typeKey) {
    const fp = BUILDING_FOOTPRINTS[typeKey];
    const w = fp?.w ?? 2;
    const h = fp?.h ?? 2;
    return {
      halfW: w * TILE_SIZE_F * 0.5 + BUILDING_PICK_HALO,
      halfD: h * TILE_SIZE_F * 0.5 + BUILDING_PICK_HALO,
    };
  }

  /** Own structures always; hostiles only when fog is not hiding them. */
  function structurePickable(owner, x, z) {
    return !isStructureVisible || isStructureVisible(owner | 0, x, z);
  }

  /** Fill buildingPickPool with own structure centers (box-select). */
  function fillBuildingPickCenters() {
    let n = 0;
    const gy = (x, z) => renderer.groundYAt?.(x, z) ?? 0;
    const agoras = getAgoras?.() ?? [];
    for (let i = 0; i < agoras.length; i++) {
      const a = agoras[i];
      if ((a.owner | 0) !== localPlayerId) continue;
      let sp = buildingPickPool[n];
      if (!sp) {
        buildingPickPool[n] = sp = { id: { kind: 'agora', index: 0 }, x: 0, y: 0, z: 0 };
      }
      sp.id.kind = 'agora';
      sp.id.index = i;
      sp.x = a.x;
      sp.y = gy(a.x, a.z) + 2.5;
      sp.z = a.z;
      n++;
    }
    const buildings = getBuildings?.() ?? [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if ((b.owner | 0) !== localPlayerId) continue;
      let sp = buildingPickPool[n];
      if (!sp) {
        buildingPickPool[n] = sp = { id: { kind: 'building', index: 0 }, x: 0, y: 0, z: 0 };
      }
      sp.id.kind = 'building';
      sp.id.index = i;
      sp.x = b.x;
      sp.y = gy(b.x, b.z) + 2.5;
      sp.z = b.z;
      n++;
    }
    return n;
  }

  function considerBuildingHit(ray, x, z, yaw, typeKey, kind, index, best) {
    const { halfW, halfD } = buildingFootHalf(typeKey);
    const gy = renderer.groundYAt?.(x, z) ?? 0;
    const t = rayHitYawBox(ray, x, z, yaw || 0, halfW, gy - 0.2, halfD, gy + BUILDING_PICK_HEIGHT);
    if (t == null || t >= best.t) return;
    best.t = t;
    best.kind = kind;
    best.index = index;
  }

  /**
   * GPU mesh pick → alive entity id, or -1.
   * Kept for USE_GPU_PICK / dumpPickBench — not the live path.
   */
  async function pickUnitAtGpu(clientX, clientY) {
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
   * CPU ray-vs-sphere → every alive entity under the ray, nearest first.
   * Passengers resolve to their transport (clicking the deck = click the vehicle).
   * @param {object | null} ray
   * @returns {number[]}
   */
  function pickUnitsAtRay(ray) {
    if (!ray || !renderer.rayHitSpheresAllInto) return EMPTY_HITS;
    const sphereN = fillUnitPickSpheres();
    const hitN = renderer.rayHitSpheresAllInto(
      ray,
      unitSpherePool,
      sphereN,
      unitHitIds,
      unitHitTs,
    );
    if (hitN === 0) return EMPTY_HITS;
    const world = getWorld();
    resolvedHitIds.length = 0;
    beginSeen();
    for (let k = 0; k < hitN; k++) {
      let id = unitHitIds[k];
      if (!world.alive[id]) continue;
      const carrier = world.carriedBy?.[id] ?? -1;
      if (carrier >= 0) id = world.alive[carrier] ? carrier : -1;
      if (id < 0 || seenStamp[id] === seenGen) continue;
      seenStamp[id] = seenGen;
      resolvedHitIds.push(id);
    }
    return resolvedHitIds;
  }

  /**
   * All entities under the cursor, nearest first.
   * Sync on the CPU path; returns a Promise only when USE_GPU_PICK.
   * @returns {number[] | Promise<number[]>}
   */
  function pickUnitsAt(clientX, clientY) {
    if (USE_GPU_PICK) {
      return pickUnitAtGpu(clientX, clientY).then((id) => (id >= 0 ? [id] : EMPTY_HITS));
    }
    const ray = renderer.clientPickingRay?.(clientX, clientY) ?? null;
    return pickUnitsAtRay(ray);
  }

  /** Nearest entity under the cursor, or -1. */
  function pickUnitAt(clientX, clientY) {
    if (USE_GPU_PICK) return pickUnitAtGpu(clientX, clientY);
    const hits = pickUnitsAt(clientX, clientY);
    return hits.length > 0 ? hits[0] : -1;
  }

  /**
   * GPU mesh pick → visible agora / placeable under the cursor, or null.
   * Kept for USE_GPU_PICK — not the live path.
   */
  async function pickBuildingAtGpu(clientX, clientY) {
    if (!renderer.pickBuilding) return null;
    const hit = await renderer.pickBuilding(clientX, clientY);
    if (!hit) return null;
    if (hit.kind === 'agora') {
      const a = getAgoras?.()?.[hit.index];
      if (!a || !structurePickable(a.owner, a.x, a.z)) return null;
      return hit;
    }
    const b = getBuildings?.()?.[hit.index];
    if (!b || (b.hp != null && (b.hp | 0) <= 0) || !structurePickable(b.owner, b.x, b.z)) return null;
    return hit;
  }

  /**
   * CPU ray vs footprint box → visible agora / placeable, or null.
   * Buildings are few; no need for the unit bounding-sphere path.
   * @param {object | null} ray
   * @returns {{ kind: 'agora' | 'building', index: number } | null}
   */
  function pickBuildingAtRay(ray) {
    if (!ray) return null;
    const best = { t: Infinity, kind: '', index: -1 };
    const agoras = getAgoras?.() ?? [];
    for (let i = 0; i < agoras.length; i++) {
      const a = agoras[i];
      if (!structurePickable(a.owner, a.x, a.z)) continue;
      considerBuildingHit(ray, a.x, a.z, a.yaw, 'agora', 'agora', i, best);
    }
    const buildings = getBuildings?.() ?? [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.hp != null && (b.hp | 0) <= 0) continue;
      if (!structurePickable(b.owner, b.x, b.z)) continue;
      considerBuildingHit(ray, b.x, b.z, b.yaw, b.type, 'building', i, best);
    }
    if (best.index < 0) return null;
    return { kind: best.kind, index: best.index };
  }

  /** @returns {{ kind: 'agora' | 'building', index: number } | null | Promise<...>} */
  function pickBuildingAt(clientX, clientY) {
    if (USE_GPU_PICK) return pickBuildingAtGpu(clientX, clientY);
    const ray = renderer.clientPickingRay?.(clientX, clientY) ?? null;
    return pickBuildingAtRay(ray);
  }

  /**
   * @param {{ kind: 'agora' | 'building', index: number } | null} sel
   * @param {{ clientX: number, clientY: number } | undefined} [ptr]
   * @param {{ kind: 'agora' | 'building', index: number }[] | null | undefined} [all]
   */
  function pingStructure(sel) {
    if (!sel) return;
    if (sel.kind === 'agora') {
      renderer.pingAgora?.(sel.index);
      return;
    }
    const b = getBuildings?.()?.[sel.index];
    if (b) renderer.pingBuilding?.(b.x, b.z);
  }

  function notifyBuildingSelected(sel, ptr, all) {
    selectedBuilding = sel;
    selectedBuildings = all ?? (sel ? [sel] : []);
    onBuildingSelected?.(sel, ptr, selectedBuildings);
    if (!sel) return;
    for (let i = 0; i < selectedBuildings.length; i++) {
      pingStructure(selectedBuildings[i]);
    }
  }

  function clearBuildingSelection() {
    abandonPlacement();
    if (!selectedBuilding && selectedBuildings.length === 0) {
      onBuildingSelected?.(null);
      return;
    }
    selectedBuilding = null;
    selectedBuildings = [];
    onBuildingSelected?.(null);
  }

  /**
   * Type key for double-click / ctrl select-all (agora or placeable id).
   * @param {{ kind: 'agora' | 'building', index: number }} hit
   * @returns {string | null}
   */
  function buildingTypeKeyOf(hit) {
    if (hit.kind === 'agora') return 'agora';
    const b = getBuildings?.()?.[hit.index];
    return b?.type ?? null;
  }

  function buildingOwnerOf(sel) {
    if (!sel) return -1;
    if (sel.kind === 'agora') return getAgoras?.()?.[sel.index]?.owner | 0;
    return getBuildings?.()?.[sel.index]?.owner | 0;
  }

  /**
   * Replace or shift-add buildings. Empty `list` is a no-op unless replacing
   * (`add` false), which clears. Shift-add refuses mixed owners.
   * @param {{ kind: 'agora' | 'building', index: number }[]} list
   * @param {boolean} add
   * @param {{ kind: 'agora' | 'building', index: number } | null | undefined} [primary]
   * @param {{ clientX: number, clientY: number } | undefined} [ptr]
   */
  function setBuildingSelection(list, add, primary, ptr) {
    if (list.length === 0) {
      if (!add) clearBuildingSelection();
      return;
    }
    let adding = add && selectedBuildings.length > 0;
    if (adding) {
      const have = buildingOwnerOf(selectedBuildings[0]);
      const next = buildingOwnerOf(primary ?? list[0]);
      if (have !== next) adding = false;
    }
    if (adding) {
      notifyBuildingSelected(primary ?? list[0], ptr, mergeBuildingSels(selectedBuildings, list));
      return;
    }
    notifyBuildingSelected(primary ?? list[0], ptr, list);
  }

  /**
   * Own agora / placeable centers whose pick height projects into the canvas
   * rect. Copies ids out of the center pool.
   * @returns {{ kind: 'agora' | 'building', index: number }[]}
   */
  function buildingsInScreenRect(minX, maxX, minY, maxY) {
    /** @type {{ kind: 'agora' | 'building', index: number }[]} */
    const matched = [];
    const n = fillBuildingPickCenters();
    for (let i = 0; i < n; i++) {
      const sp = buildingPickPool[i];
      const p = renderer.worldToScreen(sp.x, sp.y, sp.z);
      if (!screenPosInRect(p, minX, maxX, minY, maxY)) continue;
      matched.push({ kind: sp.id.kind, index: sp.id.index });
    }
    return matched;
  }

  function selectionOwnerForBuildingType(typeKey, primary) {
    if (primary) return buildingOwnerOf(primary);
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (typeKey === 'agora' && sel.kind === 'agora') return buildingOwnerOf(sel);
      if (sel.kind === 'building') {
        const b = getBuildings?.()?.[sel.index];
        if (b?.type === typeKey) return b.owner | 0;
      }
    }
    return localPlayerId;
  }

  /**
   * Select every visible building matching typeKey for one owner.
   * @param {string} typeKey
   * @param {boolean} add
   * @param {{ kind: 'agora' | 'building', index: number } | null | undefined} [primary]
   * @param {{ clientX: number, clientY: number } | undefined} [ptr]
   * @param {number} [ownerId]
   */
  function selectAllBuildingsOfType(typeKey, add, primary, ptr, ownerId) {
    const owner = ownerId ?? selectionOwnerForBuildingType(typeKey, primary);
    clearUnitSelection();
    /** @type {{ kind: 'agora' | 'building', index: number }[]} */
    const matched = [];
    if (typeKey === 'agora') {
      const agoras = getAgoras?.() ?? [];
      for (let i = 0; i < agoras.length; i++) {
        const a = agoras[i];
        if ((a.owner | 0) !== owner) continue;
        if (!structurePickable(a.owner, a.x, a.z)) continue;
        matched.push({ kind: 'agora', index: i });
      }
    } else {
      const buildings = getBuildings?.() ?? [];
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if ((b.owner | 0) !== owner) continue;
        if (b.type !== typeKey) continue;
        if (!structurePickable(b.owner, b.x, b.z)) continue;
        matched.push({ kind: 'building', index: i });
      }
    }
    if (matched.length === 0) {
      if (primary) notifyBuildingSelected(primary, ptr, [primary]);
      return;
    }
    setBuildingSelection(matched, add, primary ?? matched[0], ptr);
  }

  /**
   * Selection-strip chip — units and buildings use the same click-to-select-all.
   * @param {{ kind?: string, typeId?: number, typeKey?: string } | number | null} slot
   * @param {boolean} add
   */
  function selectHudSlot(slot, add) {
    if (slot == null) return;
    if (typeof slot === 'object' && slot.kind === 'building' && slot.typeKey) {
      selectAllBuildingsOfType(slot.typeKey, add);
      return;
    }
    const typeId = typeof slot === 'number' ? slot : slot.typeId;
    if (typeId != null) selectAllOfType(typeId, add);
  }

  /**
   * Orderable selection (alive, not carried). O(sel), not O(world).
   * @param {Set<number>} [includeCarried] — unload handoff: keep these riders
   */
  function selectedIds(includeCarried) {
    compactSelection();
    const world = getWorld();
    const ids = [];
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      if (world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0 && !includeCarried?.has(i)) continue;
      ids.push(i);
    }
    return ids;
  }

  function hasOrderableSelection() {
    compactSelection();
    const world = getWorld();
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      if (world.owner[i] !== localPlayerId) continue;
      if (!(world.carriedBy && world.carriedBy[i] >= 0)) return true;
    }
    return false;
  }

  function dropUnitsNotOwnedBy(owner) {
    compactSelection();
    const world = getWorld();
    for (let k = selCount - 1; k >= 0; k--) {
      const i = selIds[k];
      if (world.owner[i] !== owner) deselectEntity(i);
    }
  }

  /** Own selected production buildings that can take a train rally. */
  function rallyCapableBuildings() {
    const buildings = getBuildings?.() ?? [];
    /** @type {{ index: number, type: string, x: number, z: number }[]} */
    const out = [];
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (sel.kind !== 'building') continue;
      const b = buildings[sel.index];
      if (!b || (b.owner | 0) !== localPlayerId) continue;
      if (!buildingCanRally(b.type)) continue;
      out.push({ index: sel.index, type: b.type, x: b.x, z: b.z });
    }
    return out;
  }

  function hasRallySelection() {
    return rallyCapableBuildings().length > 0;
  }

  /**
   * Plant rally on every selected production building (LMB attack-move, RMB force-move).
   * @param {number} x
   * @param {number} z
   * @param {number} cmdType CMD.MOVE | CMD.ATTACK_MOVE
   */
  function rallyOrderAt(x, z, cmdType) {
    const list = rallyCapableBuildings();
    const order = cmdType === CMD.ATTACK_MOVE ? ORDER.ATTACK_MOVE : ORDER.MOVE;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!isRallyBeyondBuilding(b.type, b.x, b.z, x, z)) continue;
      enqueueCommand({
        type: CMD.SET_RALLY,
        playerId: localPlayerId,
        buildingIndex: b.index,
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
        order,
      });
      any = true;
    }
    if (any) onOrder?.(x, z, undefined, cmdType);
    return any;
  }

  /** Push current selection into the sim so monks skip co-selected friendlies. */
  function syncSelectionSquad(includeCarried) {
    if (!canUseInput()) return;
    enqueueCommand({
      type: CMD.SELECT,
      playerId: localPlayerId,
      entities: selectedIds(includeCarried),
    });
  }

  function clearUnitSelectionBits() {
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      selectedBuf[i] = 0;
      selSlot[i] = -1;
    }
    selCount = 0;
  }

  function clearUnitSelection() {
    clearUnitSelectionBits();
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  function clearSelection() {
    clearUnitSelection();
    clearBuildingSelection();
  }

  function selectionOwnerForType(typeId) {
    compactSelection();
    const world = getWorld();
    for (let k = 0; k < selCount; k++) {
      const i = selIds[k];
      if (world.alive[i] && world.type[i] === typeId) return world.owner[i] | 0;
    }
    return localPlayerId;
  }

  /** Packed hits under one tap — keep one owner's units, never mix armies. */
  function applyUnitHits(hits, owner, add) {
    const world = getWorld();
    if (!add) clearUnitSelectionBits();
    else dropUnitsNotOwnedBy(owner);
    for (let k = 0; k < hits.length; k++) {
      const id = hits[k];
      if (world.owner[id] === owner) selectEntity(id);
    }
    clearBuildingSelection();
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  function selectAllOfType(typeId, add, ownerId) {
    const world = getWorld();
    const owner = ownerId ?? selectionOwnerForType(typeId);
    if (!add) clearUnitSelectionBits();
    else dropUnitsNotOwnedBy(owner);
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== owner) continue;
      if (owner !== localPlayerId && isUnitVisible && !isUnitVisible(i)) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      if (world.type[i] === typeId) selectEntity(i);
    }
    clearBuildingSelection();
    syncSelectionSquad();
    onSelectionChanged?.();
  }

  function boxSelect(x0, y0, x1, y1, add) {
    if (!canUseInput()) return;
    // Selecting units / buildings leaves build/place UI.
    abandonPlacement();
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1) - rect.left;
    const maxX = Math.max(x0, x1) - rect.left;
    const minY = Math.min(y0, y1) - rect.top;
    const maxY = Math.max(y0, y1) - rect.top;
    if (!add) clearUnitSelectionBits();
    else dropUnitsNotOwnedBy(localPlayerId);
    const world = getWorld();
    let unitHits = 0;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      getUnitWorldPos(i, posScratch);
      const p = renderer.worldToScreen(posScratch.x, posScratch.y, posScratch.z);
      if (!p) continue;
      if (screenPosInRect(p, minX, maxX, minY, maxY)) {
        selectEntity(i);
        unitHits++;
      }
    }
    const buildings = unitHits > 0 ? [] : buildingsInScreenRect(minX, maxX, minY, maxY);
    const winner = boxSelectWinner(unitHits, buildings.length);
    if (winner === 'units') {
      clearBuildingSelection();
      syncSelectionSquad();
      onSelectionChanged?.();
      return;
    }
    if (winner === 'buildings') {
      clearUnitSelection();
      setBuildingSelection(buildings, add, buildings[0]);
      return;
    }
    if (!add) clearBuildingSelection();
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
   * @param {{ kind: 'agora' | 'building', index: number } | null} [preBld]
   */
  async function orderAt(clientX, clientY, cmdType, preHit, epoch, preBld) {
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
      renderer.pingUnit?.(hit);
      return;
    }

    // Hostile placeable — same hard attack + flash as a unit click.
    // Units that cannot hit buildings (priests) keep the ground attack-move.
    let moveIds = ids;
    if (cmdType === CMD.ATTACK_MOVE && preBld?.kind === 'building') {
      const b = getBuildings?.()?.[preBld.index];
      const hostile =
        b &&
        (b.hp == null || (b.hp | 0) > 0) &&
        buildingOwnerOf(preBld) !== localPlayerId;
      if (hostile) {
        const attackers = [];
        const rest = [];
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k];
          if (unitAttacksBuildings(world.type[id])) attackers.push(id);
          else rest.push(id);
        }
        if (attackers.length > 0) {
          if (epoch !== undefined && !clickCurrent(epoch)) return;
          enqueueCommand({
            type: CMD.ATTACK,
            entities: attackers,
            target: -1,
            buildingIndex: preBld.index,
          });
          pingStructure(preBld);
        }
        if (rest.length === 0) return;
        moveIds = rest;
      }
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
            deselectEntity(assignments[a].riderId);
          }
          selectEntity(hit);
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
    if (
      hit >= 0 &&
      world.owner[hit] === localPlayerId &&
      isMechanical(world.type[hit])
    ) {
      const engineers = ids.filter((id) => world.type[id] === UNIT.ENGINEER);
      if (engineers.length > 0) {
        if (epoch !== undefined && !clickCurrent(epoch)) return;
        enqueueCommand({ type: CMD.ATTACK, entities: engineers, target: hit });
        renderer.pingUnit?.(hit);
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

    // Attack-move onto a tree / rock: villagers gather (same volume pick as RMB).
    if (cmdType === CMD.ATTACK_MOVE) {
      const node = resolveGatherClick(clientX, clientY);
      if (node) {
        const villagers = [];
        const rest = [];
        for (let k = 0; k < moveIds.length; k++) {
          const id = moveIds[k];
          if (world.owner[id] === localPlayerId && world.type[id] === UNIT.VILLAGER) {
            villagers.push(id);
          } else {
            rest.push(id);
          }
        }
        if (villagers.length > 0) {
          enqueueCommand({ type: CMD.GATHER, entities: villagers, tile: node.tile });
          if (epoch !== undefined && !clickCurrent(epoch)) return;
          pingGatherOrder(node, cmdType);
          if (rest.length === 0) {
            playVillagerMove();
            return;
          }
          const { tx, ty } = moveDestinations(rest, node.x, node.z);
          enqueueCommand({ type: cmdType, entities: rest, tx, ty });
          playVillagerMove();
          return;
        }
      }
    }

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
        deselectEntity(loadedTransports[k]);
      }
      for (let k = 0; k < spilled.length; k++) selectEntity(spilled[k]);
      // selectedIds skips carried — include spilled even before sim unloads.
      syncSelectionSquad(spilledSet);
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
    if (isPlacing() || !hasOrderableSelection()) return;

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
    if (e.button !== 0) return false;
    // Raw touch is owned by touchAdapter (pointerHub). Synthetic touch objects
    // from the adapter are intentional and must be accepted here.

    // Latch pointer state synchronously — never await before this or pointerup is lost.
    boxStart = { x: e.clientX, y: e.clientY };
    lmbDownPos = { x: e.clientX, y: e.clientY };
    dragPointerId = e.pointerId;
    boxDragging = false;
    abilityHoldFired = false;
    ctrlGroupGesture = null;
    ctrlGroupHoldFired = false;
    clearCtrlGroupHold();
    hideSelectionBox();

    // Top selection strip acts as on-screen buttons: a press on a chip owns
    // the gesture (no box-select / ability-hold); the type is selected on up.
    selHudGesture = renderer.pickSelectionHud?.(e.clientX, e.clientY) != null;
    if (selHudGesture) return true;

    const ctrlId = renderer.pickControlGroupHud?.(e.clientX, e.clientY);
    if (ctrlId != null) {
      ctrlGroupGesture = ctrlId;
      armCtrlGroupHold(ctrlId);
      return true;
    }

    // Placement: LMB down locks anchor; drag past threshold rotates (30° snaps).
    // Radial stays usable so you can switch building type without canceling.
    // Rally mode: click-to-set (no rotate).
    if (isPlacing()) {
      radialGesture = Boolean(isRadialOpen?.() && hitRadial?.(e.clientX, e.clientY));
      placeRotating = false;
      placeAnchor = null;
      if (!radialGesture) {
        const g = renderer.screenToGround?.(e.clientX, e.clientY);
        if (g) {
          if (isPlacingRally?.()) {
            onRallyMove?.(g.x, g.z);
          } else {
            placeAnchor = { x: g.x, z: g.z };
            emitPlacementGhost(g.x, g.z, currentYaw());
          }
        }
      }
      return true;
    }

    // Sync only — GPU picks here starve the picker and race pointerup.
    // Touch: still-hold is one-finger pan; cast is double-tap on enemy/ground.
    radialGesture = Boolean(isRadialOpen?.() && hitRadial?.(e.clientX, e.clientY));
    if (!radialGesture && e.pointerType !== 'touch') void armAbilityHold(e.clientX, e.clientY);
    return true;
  }

  function handlePointerMove(e) {
    if (!canUseInput()) return false;

    // Chip / control-group press holds the gesture — no box-select.
    if (selHudGesture || ctrlGroupGesture != null) return true;

    if (isPlacing()) {
      if (isRadialOpen?.()) void onRadialHover?.(e.clientX, e.clientY);
      if (radialGesture) return true;

      const g = renderer.screenToGround?.(e.clientX, e.clientY);
      if (!g) return true;

      if (isPlacingRally?.()) {
        onRallyMove?.(g.x, g.z);
        return true;
      }

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
   *   prevTap?: { t: number, x: number, y: number, kind: 'unit' | 'ground' | 'enemy' | 'building', typeId?: number, buildingTypeKey?: string } | null,
   *   epoch?: number,
   *   hubPassThrough?: boolean,
   * }} [click]
   */
  async function handleWorldClick(e, d, click = {}) {
    const tapAt = click.tapAt ?? performance.now();
    const prevTap = click.prevTap !== undefined ? click.prevTap : lastTap;
    const epoch = click.epoch ?? worldClickEpoch;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD_PX) return;
    const world = getWorld();
    // One unproject for unit + building miss — GPU path still goes through pickUnitsAt.
    let hits;
    let bld = null;
    if (USE_GPU_PICK) {
      hits = await pickUnitsAt(e.clientX, e.clientY);
    } else {
      const ray = renderer.clientPickingRay?.(e.clientX, e.clientY) ?? null;
      hits = pickUnitsAtRay(ray);
      // Defer building fill until units miss (avoid wasted building scan).
      if (hits.length === 0 || world.owner[hits[0]] !== localPlayerId) {
        bld = pickBuildingAtRay(ray);
      }
    }
    const hit = hits.length > 0 ? hits[0] : -1;
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
          selectAllOfType(typeId, e.shiftKey, localPlayerId);
        } else {
          applyUnitHits(hits, localPlayerId, e.shiftKey);
        }
      }
      return;
    }

    // Idle click on a visible foreign unit → inspect (collar + HP). With own
    // troops selected this stays an attack-move so combat LMB is unchanged.
    if (hit >= 0 && inspectForeignOnClick(hasOrderableSelection())) {
      const owner = world.owner[hit];
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
      if (selectAll) selectAllOfType(typeId, e.shiftKey, owner);
      else applyUnitHits(hits, owner, e.shiftKey);
      return;
    }

    if (USE_GPU_PICK) bld = await pickBuildingAt(e.clientX, e.clientY);
    if (!clickCurrent(epoch)) return;
    if (!bld && click.hubPassThrough) {
      bld = radialHubFramedBuilding(
        { picked: false, onHub: true },
        selectedBuilding,
      );
    }
    if (bld) {
      const ownBld = buildingOwnerOf(bld) === localPlayerId;
      if (ownBld || inspectForeignOnClick(hasOrderableSelection())) {
        const typeKey = buildingTypeKeyOf(bld);
        const selectAll =
          !!typeKey &&
          (e.ctrlKey ||
            e.metaKey ||
            (!!prevTap &&
              prevTap.kind === 'building' &&
              prevTap.buildingTypeKey === typeKey &&
              tapAt - prevTap.t <= DOUBLE_MS &&
              Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) <= DOUBLE_PX));
        if (!clickCurrent(epoch)) return;
        lastTap = typeKey
          ? { t: tapAt, x: e.clientX, y: e.clientY, kind: 'building', buildingTypeKey: typeKey }
          : null;
        const ptr = { clientX: e.clientX, clientY: e.clientY };
        if (selectAll && typeKey) {
          selectAllBuildingsOfType(typeKey, e.shiftKey, bld, ptr, buildingOwnerOf(bld));
        } else {
          clearUnitSelection();
          setBuildingSelection([bld], e.shiftKey, bld, ptr);
        }
        return;
      }
    }

    // Hub frames the selected building — a miss must not rally / deselect.
    if (click.hubPassThrough) return;

    if (hasOrderableSelection()) {
      if (!clickCurrent(epoch)) return;
      // Double-tap enemy/ground → cast (first tap already a-moved; do not delay it).
      const castEligible =
        !!prevTap &&
        (prevTap.kind === 'ground' || prevTap.kind === 'enemy') &&
        tapAt - prevTap.t <= DOUBLE_MS &&
        Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) <= DOUBLE_PX;
      if (castEligible) {
        lastTap = null;
        castAbilityAt(e.clientX, e.clientY);
        return;
      }
      const hostileBld =
        bld?.kind === 'building' && buildingOwnerOf(bld) !== localPlayerId;
      const orderKind =
        (hit >= 0 && world.owner[hit] !== localPlayerId) || hostileBld
          ? 'enemy'
          : 'ground';
      await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit, epoch, bld);
      if (!clickCurrent(epoch)) return;
      lastTap = { t: tapAt, x: e.clientX, y: e.clientY, kind: orderKind };
      return;
    }

    if (hasRallySelection()) {
      if (!clickCurrent(epoch)) return;
      const g = renderer.screenToGround?.(e.clientX, e.clientY);
      if (g) rallyOrderAt(g.x, g.z, CMD.ATTACK_MOVE);
      lastTap = { t: tapAt, x: e.clientX, y: e.clientY, kind: 'ground' };
      return;
    }

    if (!clickCurrent(epoch)) return;
    lastTap = null;
    clearSelection();
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
    const wasSelHud = selHudGesture;
    const wasCtrlGroup = ctrlGroupGesture;
    const ctrlHoldAssigned = ctrlGroupHoldFired;
    boxDragging = false;
    abilityHoldFired = false;
    radialGesture = false;
    selHudGesture = false;
    ctrlGroupGesture = null;
    ctrlGroupHoldFired = false;
    abilityHoldGen++;
    clearAbilityHold();
    clearCtrlGroupHold();

    // Snapshot before this click mutates lastTap (unit/building double-select-all).
    const prevTap = lastTap;

    if (canUseInput() && e.type !== 'pointercancel') {
      if (wasCtrlGroup != null) {
        if (!ctrlHoldAssigned) selectControlGroup(wasCtrlGroup);
        lastTap = null;
      } else if (wasSelHud) {
        // Release on the same chip → select every unit/building of that type
        // for the current owner (shift adds), like v1's selection panel.
        const slot = renderer.pickSelectionHud?.(e.clientX, e.clientY);
        if (slot != null) selectHudSlot(slot, e.shiftKey);
        lastTap = null;
      } else if (isPlacing()) {
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
          // Placement owns LMB — never steal the click for unit selection.
          if (isPlacingRally?.()) {
            if (
              d &&
              Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_THRESHOLD_PX
            ) {
              const g = renderer.screenToGround?.(e.clientX, e.clientY);
              if (g) onRallyConfirm?.(g.x, g.z);
            }
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
          // One radial pick on click only (not on move / down).
          const picked = await pickRadialOption?.(e.clientX, e.clientY);
          const kind = radialClickKind({
            picked: !!picked,
            onHub: hitRadialHub?.(e.clientX, e.clientY),
            onChrome: wasRadialGesture || !!hitRadial?.(e.clientX, e.clientY),
          });
          if (kind === 'pick') {
            lastTap = null;
            onRadialPick?.(picked);
            radialHandled = true;
          } else if (kind === 'hub') {
            // Empty hole sits on the selected building — re-select / select-all.
            const epoch = ++worldClickEpoch;
            await handleWorldClick(e, d, {
              tapAt,
              prevTap,
              epoch,
              hubPassThrough: true,
            });
            radialHandled = true;
          } else if (kind === 'chrome') {
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
   * RMB tap (no pan) / touch 2-finger when no build UI — force MOVE to ground.
   * No unit pick; ignores enemies. Drag pan is filtered by the camera controller.
   */
  function forceMoveAt(clientX, clientY) {
    if (!canUseInput() || isPlacing()) return false;
    if (hasRallySelection()) {
      lastTap = null;
      const g = renderer.screenToGround?.(clientX, clientY);
      if (!g) return false;
      return rallyOrderAt(g.x, g.z, CMD.MOVE);
    }
    if (!hasOrderableSelection()) return false;
    lastTap = null;
    if (tryGatherAt(clientX, clientY)) return true;
    const epoch = ++worldClickEpoch;
    void orderAt(clientX, clientY, CMD.MOVE, -1, epoch);
    return true;
  }

  /**
   * Harvestable node under the cursor: tree/rock/farm volume along the click
   * ray, else the ground tile. CPU AABBs — not GPU mesh pick.
   * @returns {{ tile: number, x: number, z: number, y: number } | null}
   */
  function resolveGatherClick(clientX, clientY) {
    const field = getField?.();
    if (!field?.treeStock) return null;
    const ray = renderer.clientPickingRay?.(clientX, clientY);
    const g = renderer.screenToGround?.(clientX, clientY);
    const half = field.worldHalfF ?? (field.width * TILE_SIZE_F) / 2;
    const heightAt = (x, z) => renderer.groundYAt?.(x, z) ?? 0;
    const maxT = ray && g ? Math.max(8, rayTToPoint(ray, g.x, g.y, g.z) + 2) : 400;
    let tile = pickGatherNodeOnRay(field, ray, { maxT, heightAt });
    if (tile < 0 && g) {
      const tx = Math.floor((g.x + half) / TILE_SIZE_F);
      const tz = Math.floor((g.z + half) / TILE_SIZE_F);
      if (tx >= 0 && tz >= 0 && tx < field.width && tz < field.height) {
        tile = gatherNodeTileAt(field, tx, tz);
      }
    }
    if (tile < 0) return null;
    const w = field.width | 0;
    const x = ((tile % w) + 0.5) * TILE_SIZE_F - half;
    const z = (((tile / w) | 0) + 0.5) * TILE_SIZE_F - half;
    return { tile, x, z, y: heightAt(x, z) };
  }

  /**
   * RMB on a tree / rock with villagers selected → gather.
   * Returns true when a GATHER command was issued (skips the force-move).
   */
  function tryGatherAt(clientX, clientY) {
    const node = resolveGatherClick(clientX, clientY);
    if (!node) return false;
    const world = getWorld();
    const villagers = [];
    for (let k = 0; k < selCount; k++) {
      const id = selIds[k];
      if (world.owner[id] === localPlayerId && world.type[id] === UNIT.VILLAGER) {
        villagers.push(id);
      }
    }
    if (villagers.length === 0) return false;
    enqueueCommand({ type: CMD.GATHER, entities: villagers, tile: node.tile });
    pingGatherOrder(node, CMD.MOVE);
    return true;
  }

  /**
   * Tree/rock flash always; attack/move arrow too when the selection isn't a
   * lone villager (group or mixed click).
   */
  function pingGatherOrder(node, sourceCmd) {
    const extra = selCount > 1 ? { arrow: sourceCmd } : undefined;
    onOrder?.(node.x, node.z, node.y, CMD.GATHER, node.tile, extra);
  }

  /**
   * Harvestable tile under a click: the tile itself for a tree, or the nearest
   * rock CENTER (within a big rock's footprint) for a rock. -1 if neither.
   */
  function gatherNodeTileAt(field, tx, tz) {
    const w = field.width;
    const inTile = tz * w + tx;
    if (inTile < 0 || inTile >= field.treeStock.length) return -1;
    if ((field.treeStock[inTile] | 0) > 0) return inTile;
    // Farm food node (may be a neighbor tile if the click landed off-center).
    const foodNode = field.foodNode;
    if (foodNode) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx;
          const z = tz + dz;
          if (x < 0 || z < 0 || x >= w || z >= field.height) continue;
          if (foodNode[z * w + x]) return z * w + x;
        }
      }
    }
    const rockStock = field.rockStock;
    const sceneryType = field.sceneryType;
    if (!rockStock || !sceneryType) return -1;
    // Clicking a large rock hits a footprint tile — search out to max radius (2).
    let best = -1;
    let bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx;
        const z = tz + dz;
        if (x < 0 || z < 0 || x >= w || z >= field.height) continue;
        const t = z * w + x;
        if ((sceneryType[t] | 0) < SCENERY.ROCK_PLAIN) continue;
        if ((rockStock[t] | 0) <= 0) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  function cancelDrag() {
    worldClickEpoch++;
    abilityHoldGen++;
    clearAbilityHold();
    clearCtrlGroupHold();
    abilityHoldFired = false;
    radialGesture = false;
    selHudGesture = false;
    ctrlGroupGesture = null;
    ctrlGroupHoldFired = false;
    resetPlaceGesture();
    hideSelectionBox();
    boxStart = null;
    dragPointerId = null;
    lmbDownPos = null;
    boxDragging = false;
  }

  /** Esc while placing — cancel ghost and return to the agora radial. */
  function cancelPlacement() {
    if (!isPlacing()) return false;
    resetPlaceGesture();
    if (isPlacingRally?.()) {
      onRallyCancel?.();
      return true;
    }
    setPlacingType?.(null);
    onPlacementCancel?.();
    return true;
  }

  /**
   * RMB tap: cancel placement / close build UI. Rally-capable buildings keep
   * selection so forceMoveAt can plant a force-move rally.
   */
  function dismissMenus() {
    if (!canUseInput()) return false;
    if (isPlacing()) {
      lastTap = null;
      clearBuildingSelection();
      return true;
    }
    if (hasRallySelection()) return false;
    const hadUi =
      selectedBuilding != null ||
      selectedBuildings.length > 0 ||
      Boolean(isRadialOpen?.());
    if (!hadUi) return false;
    lastTap = null;
    clearBuildingSelection();
    return true;
  }

  function hasBuildUi() {
    return twoFingerConsumesBuildUi(
      isPlacing(),
      selectedBuilding != null || selectedBuildings.length > 0,
      Boolean(isRadialOpen?.()),
    );
  }

  /**
   * Touch 2-finger tap — leave placement and building selection (including
   * rally). Unlike dismissMenus, this does not spare production buildings
   * for a force-move rally.
   */
  function backOutBuildUi() {
    if (!canUseInput() || !hasBuildUi()) return false;
    lastTap = null;
    clearBuildingSelection();
    return true;
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    forceMoveAt,
    castAbilityAt,
    cancelDrag,
    clearSelection,
    deselectEntity,
    cancelPlacement,
    dismissMenus,
    backOutBuildUi,
    hasBuildUi,
    isPlacing,
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
      rebuildDenseFromBuf();
    },
    setInputEnabled(enabled) {
      inputEnabled = Boolean(enabled);
      if (!inputEnabled) {
        abilityHoldGen++;
        clearAbilityHold();
        clearCtrlGroupHold();
        ctrlGroupKeyId = null;
        ctrlGroupKeyAssigned = false;
        clearCtrlGroupKeyHold();
        clearSelection();
      }
    },
    setRole(role) {
      inputEnabled = role === 'player' || role === 'livePlayer' || role === 'sandboxPlayer' || role === 'stagingPlayer';
      if (!inputEnabled) {
        abilityHoldGen++;
        clearAbilityHold();
        clearCtrlGroupHold();
        ctrlGroupKeyId = null;
        ctrlGroupKeyAssigned = false;
        clearCtrlGroupKeyHold();
        clearSelection();
      }
    },
    hitControlGroupHud,
    handleControlGroupKeyDown,
    handleControlGroupKeyUp,
    clearControlGroups() {
      resetControlGroups();
    },
    syncControlGroupMarks,
  };
}
