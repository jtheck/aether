// Selection + orders (LMB). Camera pan / force-move on RMB via pointerHub.
// Touch later synthesizes into the hub; gamepad can call order helpers / enqueueCommand.

import * as fx from '../../sim/fixed.js';
import { CMD } from '../../sim/commands.js';
import { snapBuildingYaw, BUILDING_FOOTPRINTS } from '../../sim/buildings.js';
import { MAX_ENTITIES } from '../../sim/world.js';
import { isMechanical, isTransport, UNIT, getUnitDef } from '../../sim/unitTypes.js';
import { isHostile } from '../../sim/teams.js';
import { canRideTransport, passengerCount, assignNearestRidersToTransport, listPassengers, transportCapacityOf } from '../../sim/transport.js';
import { playVillagerMove } from '../audio.js';
import { TILE_SIZE_F } from '../../sim/field.js';
import { USE_GPU_PICK } from '../../render/pickMode.js';

/** Debug-sphere-equivalent minimum pick height for buildings/agoras (world units). */
const BUILDING_PICK_MIN_Y = 2.5;
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
 * @param {(x: number, z: number, y?: number) => void} [opts.onOrder]
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
 * @param {(pick: string | { kind: 'building' | 'category' | 'unit' | 'upgrade' | 'utility' | 'cancel', id?: string }) => void} [opts.onRadialPick]
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
    if (i < 0 || selSlot[i] >= 0) return;
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

  // --- CPU pick scratch (no per-click allocations on the live path) ---
  /** @type {{ id: number, x: number, y: number, z: number, r: number }[]} */
  const unitSpherePool = [];
  /** @type {{ id: { kind: 'agora' | 'building', index: number }, x: number, y: number, z: number, r: number }[]} */
  const buildingSpherePool = [];
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

  /** Half the footprint diagonal (world units) — a tight-ish circle around the pad. */
  function buildingPickRadius(typeKey) {
    const fp = BUILDING_FOOTPRINTS[typeKey];
    if (!fp) return 3;
    return 0.5 * Math.hypot(fp.w, fp.h) * TILE_SIZE_F;
  }

  /** Fill buildingSpherePool (own structures only); returns live count. */
  function fillBuildingPickSpheres() {
    let n = 0;
    const agoras = getAgoras?.() ?? [];
    for (let i = 0; i < agoras.length; i++) {
      const a = agoras[i];
      if ((a.owner | 0) !== localPlayerId) continue;
      const r = buildingPickRadius('agora');
      let sp = buildingSpherePool[n];
      if (!sp) {
        buildingSpherePool[n] = sp = {
          id: { kind: 'agora', index: 0 },
          x: 0,
          y: 0,
          z: 0,
          r: 0,
        };
      }
      sp.id.kind = 'agora';
      sp.id.index = i;
      sp.x = a.x;
      sp.y = Math.max(BUILDING_PICK_MIN_Y, r * 0.6);
      sp.z = a.z;
      sp.r = r;
      n++;
    }
    const buildings = getBuildings?.() ?? [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if ((b.owner | 0) !== localPlayerId) continue;
      const r = buildingPickRadius(b.type);
      let sp = buildingSpherePool[n];
      if (!sp) {
        buildingSpherePool[n] = sp = {
          id: { kind: 'building', index: 0 },
          x: 0,
          y: 0,
          z: 0,
          r: 0,
        };
      }
      sp.id.kind = 'building';
      sp.id.index = i;
      sp.x = b.x;
      sp.y = Math.max(BUILDING_PICK_MIN_Y, r * 0.6);
      sp.z = b.z;
      sp.r = r;
      n++;
    }
    return n;
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
   * GPU mesh pick → own agora / placeable under the cursor, or null.
   * Kept for USE_GPU_PICK — not the live path.
   */
  async function pickBuildingAtGpu(clientX, clientY) {
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

  /**
   * CPU ray-vs-sphere → own agora / placeable, or null.
   * @param {object | null} ray
   * @returns {{ kind: 'agora' | 'building', index: number } | null}
   */
  function pickBuildingAtRay(ray) {
    if (!ray || !renderer.rayHitSpheresNearest) return null;
    const n = fillBuildingPickSpheres();
    const hit = renderer.rayHitSpheresNearest(ray, buildingSpherePool, n);
    // Copy out of the pool — pooled id objects are reused on the next pick.
    if (!hit || hit === -1) return null;
    return { kind: hit.kind, index: hit.index };
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
  function notifyBuildingSelected(sel, ptr, all) {
    selectedBuilding = sel;
    selectedBuildings = all ?? (sel ? [sel] : []);
    onBuildingSelected?.(sel, ptr, selectedBuildings);
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

  /**
   * Select every own building matching typeKey (agora or placeable type).
   * @param {string} typeKey
   * @param {boolean} add
   * @param {{ kind: 'agora' | 'building', index: number }} primary
   * @param {{ clientX: number, clientY: number } | undefined} [ptr]
   */
  function selectAllBuildingsOfType(typeKey, add, primary, ptr) {
    clearUnitSelection();
    /** @type {{ kind: 'agora' | 'building', index: number }[]} */
    const matched = [];
    if (typeKey === 'agora') {
      const agoras = getAgoras?.() ?? [];
      for (let i = 0; i < agoras.length; i++) {
        if ((agoras[i].owner | 0) === localPlayerId) matched.push({ kind: 'agora', index: i });
      }
    } else {
      const buildings = getBuildings?.() ?? [];
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if ((b.owner | 0) !== localPlayerId) continue;
        if (b.type !== typeKey) continue;
        matched.push({ kind: 'building', index: i });
      }
    }
    if (matched.length === 0) {
      notifyBuildingSelected(primary, ptr, [primary]);
      return;
    }
    if (add && selectedBuildings.length > 0) {
      const seen = new Set(selectedBuildings.map((s) => `${s.kind}:${s.index}`));
      const merged = selectedBuildings.slice();
      for (let i = 0; i < matched.length; i++) {
        const s = matched[i];
        const k = `${s.kind}:${s.index}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(s);
      }
      notifyBuildingSelected(primary, ptr, merged);
      return;
    }
    notifyBuildingSelected(primary, ptr, matched);
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
      if (!(world.carriedBy && world.carriedBy[i] >= 0)) return true;
    }
    return false;
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

  function selectAllOfType(typeId, add) {
    const world = getWorld();
    if (!add) clearUnitSelectionBits();
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      if (world.type[i] === typeId) selectEntity(i);
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
    if (!add) clearUnitSelectionBits();
    const world = getWorld();
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.owner[i] !== localPlayerId) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      getUnitWorldPos(i, posScratch);
      const p = renderer.worldToScreen(posScratch.x, posScratch.y, posScratch.z);
      if (!p) continue;
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) selectEntity(i);
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
    hideSelectionBox();

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
          selectAllOfType(typeId, e.shiftKey);
        } else {
          // Packed-tight units under the same tap all come back from pickUnitsAt —
          // select every own one instead of just the nearest. Degrades to a normal
          // single select when hits is just [hit].
          if (!e.shiftKey) clearUnitSelectionBits();
          for (let k = 0; k < hits.length; k++) {
            const id = hits[k];
            if (world.owner[id] === localPlayerId) selectEntity(id);
          }
          clearBuildingSelection();
          syncSelectionSquad();
          onSelectionChanged?.();
        }
      }
      return;
    }

    if (USE_GPU_PICK) bld = await pickBuildingAt(e.clientX, e.clientY);
    if (!clickCurrent(epoch)) return;
    if (bld) {
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
        selectAllBuildingsOfType(typeKey, e.shiftKey, bld, ptr);
      } else {
        clearUnitSelection();
        notifyBuildingSelected(bld, ptr);
      }
      return;
    }

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
      const orderKind =
        hit >= 0 && world.owner[hit] !== localPlayerId ? 'enemy' : 'ground';
      await orderAt(e.clientX, e.clientY, CMD.ATTACK_MOVE, hit, epoch);
      if (!clickCurrent(epoch)) return;
      lastTap = { t: tapAt, x: e.clientX, y: e.clientY, kind: orderKind };
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

    // Snapshot before this click mutates lastTap (unit/building double-select-all).
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
    if (!hasOrderableSelection()) return false;
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
   * RMB tap: drop ghost + close radials the same way LMB empty-ground does
   * (clear building selection). Returns true if build UI was dismissed.
   */
  function dismissMenus() {
    if (!canUseInput()) return false;
    const hadUi =
      isPlacing() ||
      selectedBuilding != null ||
      selectedBuildings.length > 0 ||
      Boolean(isRadialOpen?.());
    if (!hadUi) return false;
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
