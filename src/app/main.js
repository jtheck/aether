// app/ — SimSession (lockstep) + Lite renderer + input.

import { livingByOwner, ORDER } from '../sim/world.js';
import { UNIT_DEFS, getUnitDef, isFlyer, isTransport, FLY_HEIGHT } from '../sim/unitTypes.js';
import * as fx from '../sim/fixed.js';
import {
  PLAYER_ARMY,
  stressPerSideFromSearch,
  animStressPerSideFromSearch,
  armyPerSideFromSearch,
  kothMaxEntities,
  setArmyPerSide,
  PLAYER,
  AI_OWNER,
} from '../sim/worldSetup.js';
import { STRESS_AI_PROFILES } from '../sim/ai.js';
import { CMD } from '../sim/commands.js';
import { applySerializedBuildingOccupancy, canPlaceBuildingAt, snapBuildingYaw } from '../sim/buildings.js';
import { createRenderer } from '../render/renderer.js';
import { createLiteExplorerToggle } from '../render/liteExplorer.js';
import { isVatUnitType } from '../render/vatUnits.js';
import { setupInput } from './input.js';
import { init as initAudio } from './audio.js';
import { SimSession, formatMatchTime, matchSecondsFromTick } from './simSession.js';
import { createKothShard, kothModeFromSearch } from './kothShard.js';

/** v1 carton packing — local XZ offsets for riders on a transport deck. */
const PASSENGER_COLS = 2;
const PASSENGER_SPACING = 1.2;
/** Hang passengers this far under air transports (v1 gondola drop, scaled with loft). */
const AIR_PASSENGER_DROP = 7;

function passengerLocalOffset(slot, total) {
  const col = slot % PASSENGER_COLS;
  const row = (slot / PASSENGER_COLS) | 0;
  const rows = Math.max(1, Math.ceil(total / PASSENGER_COLS));
  return {
    x: (col - (PASSENGER_COLS - 1) / 2) * PASSENGER_SPACING,
    z: (row - (rows - 1) / 2) * PASSENGER_SPACING,
  };
}

function rotateYawOffset(offX, offZ, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: offX * c - offZ * s,
    z: offX * s + offZ * c,
  };
}

const SEED = 0x1234;

const OWNER_TINTS = [
  [0.25, 0.55, 1.0],
  [1.0, 0.32, 0.25],
  [0.4, 1.0, 0.45],
  [0.95, 0.8, 0.25],
  [0.75, 0.45, 1.0],
];
const DEATH_FADE_MS = 450;
/** Match game/units.js selection spin. */
const SEL_SPIN_STEADY = 0.006 * 60;
const SEL_SPIN_START = 1.7;
const SEL_SPIN_SETTLE = 6;
/** Skip matrix rewrite when display pose is within this (world units / radians). */
const POSE_XZ_EPS = 0.03;
const POSE_XZ_EPS_SQ = POSE_XZ_EPS * POSE_XZ_EPS;
const POSE_YAW_EPS = 0.03;
const POSE_SIZE_EPS = 0.002;
const POSE_LOFT_EPS = 0.02;
const DEBUG_KOTH = new URLSearchParams(location.search).get('debug') === 'koth';

/** Drops stale applyLiveConfig completions (solo reset finishing after join reset). */
let liveConfigGeneration = 0;

function tintColor(base, tint, amount) {
  const a = amount;
  const b = 1 - amount;
  return [base[0] * b + tint[0] * a, base[1] * b + tint[1] * a, base[2] * b + tint[2] * a];
}

function worldPositionsForSync(state, count) {
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = fx.toFloat(state.px[i]);
    z[i] = fx.toFloat(state.py[i]);
  }
  return { x, z };
}

function logArmyRenderState(renderer, session, label) {
  const world = session.state;
  const count = session.count;
  const batches = renderer.debugBatches?.(count, world.type, world.owner);
  console.info(`[render] ${label}`, {
    count,
    p0: livingByOwner(world, 0),
    p1: livingByOwner(world, 1),
    batches,
  });
}

function rebuildRendererEntities(renderer, session) {
  const count = session.count;
  const world = session.state;
  const unmapped = renderer.rebuildFromTypes(count, world.type, world.owner);
  const stillUnmapped = renderer.syncInstances(count, world.type, worldPositionsForSync(world, count), {
    alive: world.alive,
    owners: world.owner,
  });
  if (unmapped.length || stillUnmapped) {
    const sample = unmapped.slice(0, 12);
    const owners = sample.map((i) => world.owner[i]);
    console.warn('[render] unmapped entities after rebuild', {
      count,
      unmapped: unmapped.length,
      stillUnmapped,
      sample,
      owners,
      batches: renderer.debugBatches?.(count, world.type, world.owner),
    });
  } else if (livingByOwner(world, 1) > 0) {
    const dbg = renderer.debugBatches?.(count, world.type, world.owner);
    const tiMismatch = dbg?.batches && Object.values(dbg.batches).some(
      (b) => b.entities > 0 && b.tiCount < b.entities,
    );
    if (tiMismatch) {
      console.warn('[render] thin-instance count below entity mapping', dbg);
    }
    console.info('[render] entity rebuild', {
      count,
      p0: livingByOwner(world, 0),
      p1: livingByOwner(world, 1),
      batches: dbg?.batches,
    });
  }
  return count;
}

function forceRendererSync(ctx) {
  if (!ctx?.renderer || !ctx.session) return 0;
  const count = ctx.session.count;
  ctx.resizeRenderBuffers(count);
  ctx.renderer.setCount(count);
  if (ctx.syncRenderer) return ctx.syncRenderer();
  return rebuildRendererEntities(ctx.renderer, ctx.session);
}

async function main() {
  const canvas = document.getElementById('canvas');
  initAudio();

  if (!(await waitForWebGPU())) {
    showFallback('This browser has no WebGPU. Use Chrome/Edge 113+ or Firefox/Safari with WebGPU enabled.');
    return;
  }

  if (typeof SharedArrayBuffer === 'undefined') {
    showFallback('SharedArrayBuffer unavailable. Run via node serve.mjs (COOP/COEP headers required).');
    return;
  }

  const stress = stressPerSideFromSearch(location.search);
  const animStress = animStressPerSideFromSearch(location.search);
  const armyPerSide = armyPerSideFromSearch(location.search);
  const solo = new URLSearchParams(location.search).has('solo');
  const useKoth = kothModeFromSearch(location.search) && !solo;

  let kothShard = null;
  let ctx = null;
  /** @type {object | null} Live config received before bootGame finished. */
  let pendingLiveCfg = null;

  async function handleLiveStart(cfg) {
    if (!ctx) {
      pendingLiveCfg = cfg;
      return;
    }
    await applyLiveConfig(ctx, cfg, kothShard);
  }

  function handlePresentationSync(cfg) {
    if (!ctx) return;
    syncPresentation(ctx, cfg);
  }

  let bootCfg = {
    mode: 'legacy',
    seed: SEED,
    localPlayerId: PLAYER,
    humanPlayers: [PLAYER],
    role: 'player',
    activeSlots: [PLAYER],
    armyPerSide,
  };

  if (useKoth && stress === 0 && animStress === 0) {
    if (!(await waitForGetFireP2p())) {
      showFallback('GetFire P2P failed to load. Hard-refresh or use ?solo=1 for offline.');
      return;
    }
    kothShard = createKothShard({
      onStatus: setStatusText,
      onLiveStart: handleLiveStart,
      onPresentationSync: handlePresentationSync,
      armyPerSide,
    });
    bootCfg = await kothShard.waitForBoot();
    if (bootCfg.armyPerSide == null) bootCfg.armyPerSide = armyPerSide;
  }

  ctx = await bootGame(canvas, bootCfg, { stress, animStress, armyPerSide: bootCfg.armyPerSide ?? armyPerSide, kothShard, solo });
  if (pendingLiveCfg) {
    const cfg = pendingLiveCfg;
    pendingLiveCfg = null;
    await applyLiveConfig(ctx, cfg, kothShard);
  }
}

async function bootGame(canvas, bootCfg, { stress, animStress = 0, armyPerSide = 0, kothShard, solo = false }) {
  const useNet = bootCfg.mode === 'koth' || bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox';
  const army = bootCfg.armyPerSide ?? armyPerSide ?? 0;

  const session = new SimSession({
    localPlayerId: bootCfg.localPlayerId,
    humanPlayers: bootCfg.humanPlayers,
    aiPlayers: useKothAi(bootCfg, stress, animStress, solo),
    inputDelayTicks: useNet ? 1 : 0,
    role: bootCfg.role ?? 'player',
  });

  const simConfig = {
    seed: bootCfg.seed ?? SEED,
    stressPerSide: stress,
    animStressPerSide: animStress,
    armyPerSide: army,
    mode:
      bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox'
        ? 'staging'
        : bootCfg.mode === 'koth'
          ? 'koth'
          : 'legacy',
    activeSlots: bootCfg.activeSlots ?? [bootCfg.localPlayerId],
  };

  const { count, agoras, buildings } = await session.start(simConfig);
  if (kothShard) kothShard.attachSession(session);

  // Main-thread army size for KOTH GPU prealloc (worker has its own copy).
  setArmyPerSide(army);

  // rAF stops when the tab is hidden; lockstep still needs tick confirms.
  const onVisibility = () => session.setBackgroundPump(document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  if (document.hidden) session.setBackgroundPump(true);

  if (animStress > 0) {
    setStatusText(`Baking VAT for ${count} villagers…`);
  }

  const renderer = await createRenderer(canvas, count, {
    types: session.state.type,
    gpuCapacity: useNet ? kothMaxEntities(army) : count,
    field: session.field,
    onAnimLoadProgress: animStress > 0
      ? (done, total) => setStatusText(
        done >= total
          ? `VAT ready — ${count} villagers`
          : `VAT shards ${done}/${total} for ${count} villagers…`,
      )
      : undefined,
  });
  renderer.setCount(count);
  renderer.placeAgoras?.(agoras ?? session.agoras);
  renderer.placeBuildings?.(buildings ?? session.buildings);
  // Console: renderer.toggleShadows() / renderer.setShadowsEnabled(false)
  window.renderer = renderer;
  if (new URLSearchParams(location.search).get('tiles') === '1') {
    renderer.setTileGridVisible(true);
  }
  if (new URLSearchParams(location.search).get('hitboxes') === '1') {
    renderer.setPickHitboxesVisible?.(true);
  }
  if (new URLSearchParams(location.search).get('shadows') === '0') {
    renderer.setShadowsEnabled?.(false);
  }
  const liteExplorer = createLiteExplorerToggle({
    engine: renderer.engine,
    scene: renderer.scene,
    canvas,
  });
  let renderEntityCount = rebuildRendererEntities(renderer, session);

  /** Mutable render buffers — frame loop reads this object, not closed-over copies. */
  const bufs = {
    selected: new Uint8Array(count),
    wasSelected: new Uint8Array(count),
    wasAlive: new Uint8Array(count),
    deathFade: new Float32Array(count),
    facingYaw: new Float32Array(count),
    selSpinYaw: new Float32Array(count),
    selSpinVel: new Float32Array(count),
    colors: new Float32Array(count * 4),
    renderX: new Float32Array(count),
    renderY: new Float32Array(count),
    renderZ: new Float32Array(count),
    /** Last matrix write — skip rewrite when pose is unchanged. */
    poseX: new Float32Array(count),
    poseZ: new Float32Array(count),
    poseYaw: new Float32Array(count),
    poseSize: new Float32Array(count),
    poseLoft: new Float32Array(count),
    poseMoving: new Uint8Array(count),
    poseValid: new Uint8Array(count),
    /** Cached terrain height for unchanged xz. */
    cacheGx: new Float32Array(count),
    cacheGz: new Float32Array(count),
    cacheGy: new Float32Array(count),
    /** Deferred health chips: [x, z, size, ratio] × N (selected first at flush). */
    hbSelected: new Float32Array(count * 4),
    hbHurt: new Float32Array(count * 4),
    /** Passenger deck packing for carried units. */
    passengerSlot: new Int32Array(count),
    passengerTotalOf: new Int32Array(count),
    passengerNextSlot: new Int32Array(count),
  };
  bufs.wasAlive.fill(1);
  bufs.cacheGx.fill(NaN);
  bufs.cacheGz.fill(NaN);
  bufs.cacheGy.fill(NaN);

  function resizeRenderBuffers(n) {
    const prevFacing = bufs.facingYaw;
    const prevSpinYaw = bufs.selSpinYaw;
    const prevSpinVel = bufs.selSpinVel;
    const prevWasSel = bufs.wasSelected;
    bufs.selected = new Uint8Array(n);
    bufs.wasSelected = new Uint8Array(n);
    bufs.wasAlive = new Uint8Array(n);
    bufs.wasAlive.fill(1);
    bufs.deathFade = new Float32Array(n);
    bufs.facingYaw = new Float32Array(n);
    bufs.selSpinYaw = new Float32Array(n);
    bufs.selSpinVel = new Float32Array(n);
    bufs.colors = new Float32Array(n * 4);
    bufs.renderX = new Float32Array(n);
    bufs.renderY = new Float32Array(n);
    bufs.renderZ = new Float32Array(n);
    bufs.poseX = new Float32Array(n);
    bufs.poseZ = new Float32Array(n);
    bufs.poseYaw = new Float32Array(n);
    bufs.poseSize = new Float32Array(n);
    bufs.poseLoft = new Float32Array(n);
    bufs.poseMoving = new Uint8Array(n);
    bufs.poseValid = new Uint8Array(n);
    bufs.cacheGx = new Float32Array(n);
    bufs.cacheGz = new Float32Array(n);
    bufs.cacheGy = new Float32Array(n);
    bufs.cacheGx.fill(NaN);
    bufs.cacheGz.fill(NaN);
    bufs.cacheGy.fill(NaN);
    bufs.hbSelected = new Float32Array(n * 4);
    bufs.hbHurt = new Float32Array(n * 4);
    bufs.passengerSlot = new Int32Array(n);
    bufs.passengerTotalOf = new Int32Array(n);
    bufs.passengerNextSlot = new Int32Array(n);
    const copy = Math.min(n, prevFacing?.length ?? 0);
    for (let i = 0; i < copy; i++) {
      bufs.facingYaw[i] = prevFacing[i];
      bufs.selSpinYaw[i] = prevSpinYaw[i];
      bufs.selSpinVel[i] = prevSpinVel[i];
      bufs.wasSelected[i] = prevWasSel[i];
    }
    inputApi?.setSelectedBuffer?.(bufs.selected);
  }

  let fpsDisplay = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let localPlayerId = bootCfg.localPlayerId;
  let matchMeta = { mode: bootCfg.mode, matchId: bootCfg.matchId };
  let matchOverShown = false;
  let lastRenderDebugAt = 0;

  const updateColors = () => {
    const world = session.state;
    const { selected, deathFade, colors } = bufs;
    for (let i = 0; i < session.count; i++) {
      const fade = deathFade[i];
      if (!world.alive[i] && fade <= 0) {
        colors[i * 4 + 3] = 0;
        continue;
      }
      const def = getUnitDef(world.type[i]);
      // VAT shirts use pure owner color (v1 TeamColor material). Other units
      // keep a soft blend of unit-def color + owner tint.
      const ownerTint = OWNER_TINTS[world.owner[i] % OWNER_TINTS.length];
      const c = isVatUnitType(world.type[i])
        ? ownerTint
        : tintColor(def.color, ownerTint, 0.45);
      const alpha = world.alive[i] ? 1 : fade;
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = alpha;
    }
    renderer.setColors(colors);
    paintStatus();
  };

  session.onWorldRebuilt = (entityCount) => {
    if (session._pendingWorldGen != null && session._pendingWorldGen !== liveConfigGeneration) return;
    resizeRenderBuffers(entityCount);
    renderer.setCount(entityCount);
    renderEntityCount = rebuildRendererEntities(renderer, session);
    renderer.clearProjectiles?.();
    renderer.placeAgoras?.(session.agoras);
    renderer.placeBuildings?.(session.buildings);
    if (session.field) renderer.setField?.(session.field);
    updateColors();
    if (matchMeta.mode === 'koth') {
      logArmyRenderState(renderer, session, 'world rebuilt');
    }
  };

  session.onBuildingsChanged = (list) => {
    if (session.field) {
      applySerializedBuildingOccupancy(session.field, list);
      renderer.refreshTileGrid?.();
    }
    renderer.placeBuildings?.(list);
  };

  function paintStatus() {
    const world = session.state;
    const el = document.getElementById('status');
    if (!el) return;
    const p = livingByOwner(world, localPlayerId);
    let sel = 0;
    for (let i = 0; i < session.count; i++) if (bufs.selected[i]) sel++;
    const matchTime = formatMatchTime(matchSecondsFromTick(session.confirmedTick));
    let line = `You P${localPlayerId}: ${p}  ·  Selected: ${sel}  ·  Tick ${world.tick}`;
    if (matchMeta.mode === 'staging' || matchMeta.mode === 'sandbox') line = `Staging  ·  ${line}`;
    if (matchMeta.mode === 'koth') {
      const k = session.koth;
      if (k) {
        const players = k.active?.reduce?.((n, v) => n + (v ? 1 : 0), 0) ?? 0;
        const p0 = livingByOwner(world, 0);
        const p1 = livingByOwner(world, 1);
        line = `KOTH  ·  ⏱ ${matchTime}  ·  👑 P${k.kingOwner}  ·  Players ${players}  ·  Units ${world.count} P0 ${p0} P1 ${p1}  ·  Score ${k.scores[localPlayerId] ?? 0}  ·  ${line}`;
      } else line = `KOTH  ·  ⏱ ${matchTime}  ·  ${line}`;
    }
    if (session.role === 'spectator') {
      const depth = kothShard?.getObserverDepth?.() ?? 0;
      const offered = kothShard?.isOfferEligible?.();
      if (offered) line = `Offer ready  ·  ${line}`;
      else if (depth > 0) line = `Observing L${depth}  ·  ${line}`;
      else line = `Spectating  ·  ${line}`;
    }
    if (session.replayingCatchUp && session.catchupProgress) {
      const { tick, targetTick } = session.catchupProgress;
      const elapsed = formatMatchTime(matchSecondsFromTick(tick));
      const total = formatMatchTime(matchSecondsFromTick(targetTick));
      line = `Catch-up ${elapsed} / ${total}  ·  ${line}`;
    } else if (session.pauseLockstep) {
      line = `PAUSED  ·  ${line}`;
    }
    if (fpsDisplay > 0) line += `  ·  ${fpsDisplay} fps`;
    const rtt = kothShard?.getRttMs?.();
    if (rtt != null) line += `  ·  ${rtt} ms`;
    if (stress > 0) line += `  ·  stress ${world.count} units`;
    if (animStress > 0) line += `  ·  animStress ${world.count} VAT`;
    if (matchMeta.matchId) line += `  ·  …${matchMeta.matchId.slice(-8)}`;
    el.textContent = line;
    updateKothControls(kothShard);
  }

  updateColors();
  updateLegend();

  /** @type {string | null} */
  let placingType = null;
  /** Radians — kept across multi-place until cancel / type switch. */
  let placingYaw = 0;
  /** Keep agora selected after placing so radial can reopen. */
  let lastAgoraIndex = -1;

  function buildingWorldPos(sel) {
    if (!sel) return null;
    if (sel.kind === 'agora') {
      const a = session.agoras?.[sel.index];
      return a ? { x: a.x, z: a.z, size: /** @type {const} */ ('l') } : null;
    }
    const b = session.buildings?.[sel.index];
    // Placeables default to M; perch is small.
    if (!b) return null;
    const size = b.type === 'perch' ? 's' : 'm';
    return { x: b.x, z: b.z, size };
  }

  function syncBuildingHighlight(sel) {
    renderer.setBuildingSelectionHighlight?.(buildingWorldPos(sel));
  }

  function openRadialForAgora(index) {
    lastAgoraIndex = index;
    const a = session.agoras?.[index];
    if (!a) return;
    renderer.showBuildingRadial?.(a.x, a.z);
  }

  function closeRadial() {
    renderer.hideBuildingRadial?.();
  }

  let inputApi = setupInput({
    canvas,
    renderer,
    world: () => session.state,
    selected: bufs.selected,
    localPlayerId,
    getUnitWorldPos: (i) => ({
      x: bufs.renderX[i],
      y: bufs.renderY[i],
      z: bufs.renderZ[i],
    }),
    enqueueCommand: (cmd) => session.submitCommand(cmd),
    onSelectionChanged: updateColors,
    onOrder: (x, z, y, cmdType) => {
      const tint = cmdType === CMD.ATTACK_MOVE ? 'red' : 'white';
      renderer.pingOrderMarker?.(x, z, y, tint, { forceMove: cmdType === CMD.MOVE });
    },
    onAbilityHold: null,
    canInteract: () =>
      session.role === 'player' && localPlayerId >= 0 && !session.pauseLockstep,
    getAgoras: () => session.agoras ?? [],
    getBuildings: () => session.buildings ?? [],
    onBuildingSelected: (sel) => {
      syncBuildingHighlight(sel);
      if (sel?.kind === 'agora') openRadialForAgora(sel.index);
      else closeRadial();
    },
    getPlacingType: () => placingType,
    setPlacingType: (t) => {
      placingType = t;
      if (!t) {
        placingYaw = 0;
        renderer.setBuildingGhost?.(null);
      }
    },
    getPlacementYaw: () => placingYaw,
    setPlacementYaw: (yaw) => {
      placingYaw = snapBuildingYaw(yaw);
    },
    onPlacementMove: (x, z, yaw = placingYaw) => {
      if (!placingType) return;
      const yawRad = snapBuildingYaw(yaw ?? placingYaw);
      placingYaw = yawRad;
      const valid = session.field
        ? canPlaceBuildingAt(
            session.field,
            placingType,
            fx.fromFloat(x),
            fx.fromFloat(z),
          )
        : true;
      renderer.setBuildingGhost?.({ type: placingType, x, z, yaw: yawRad, valid });
    },
    onPlacementConfirm: (x, z, yaw = placingYaw) => {
      if (!placingType) return;
      const type = placingType;
      const yawRad = snapBuildingYaw(yaw ?? placingYaw);
      placingYaw = yawRad;
      if (
        session.field &&
        !canPlaceBuildingAt(
          session.field,
          type,
          fx.fromFloat(x),
          fx.fromFloat(z),
        )
      ) {
        // Stay in placement mode; ghost already shows invalid.
        renderer.setBuildingGhost?.({ type, x, z, yaw: yawRad, valid: false });
        return;
      }
      session.submitCommand({
        type: CMD.PLACE_BUILDING,
        playerId: localPlayerId,
        buildingType: type,
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
        yaw: fx.fromFloat(yawRad),
      });
      // Multi-place: keep type + yaw; ghost follows on next move.
      renderer.setBuildingGhost?.(null);
      if (lastAgoraIndex >= 0) {
        inputApi.setSelectedBuilding?.({ kind: 'agora', index: lastAgoraIndex });
      }
    },
    onPlacementCancel: () => {
      placingType = null;
      placingYaw = 0;
      renderer.setBuildingGhost?.(null);
      if (lastAgoraIndex >= 0) {
        inputApi.setSelectedBuilding?.({ kind: 'agora', index: lastAgoraIndex });
      }
    },
    isRadialOpen: () => renderer.isBuildingRadialOpen?.() ?? false,
    pickRadialOption: (cx, cy) => renderer.pickBuildingRadial?.(cx, cy) ?? null,
    onRadialPick: (buildingType) => {
      placingType = buildingType;
      placingYaw = 0;
      // Keep the agora radial open while ghost-placing / switching types.
      renderer.setBuildingGhost?.(null);
    },
    onRadialHover: (cx, cy) => renderer.hoverBuildingRadial?.(cx, cy),
    hitRadial: (cx, cy) => renderer.hitBuildingRadial?.(cx, cy) ?? false,
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (placingType) {
        inputApi.cancelPlacement?.();
        return;
      }
      if (renderer.isBuildingRadialOpen?.()) {
        closeRadial();
        return;
      }
      inputApi.clearSelection?.();
      renderer.setBuildingSelectionHighlight?.(null);
      return;
    }
    if (e.code === 'KeyJ') {
      kothShard?.requestJoin?.();
      return;
    }
    if (e.code === 'KeyG') {
      e.preventDefault();
      renderer.toggleTileGrid();
      return;
    }
    if (e.code === 'KeyH') {
      e.preventDefault();
      renderer.togglePickHitboxes?.();
      return;
    }
    if (e.code === 'KeyB') {
      e.preventDefault();
      const on = renderer.toggleShadows?.();
      if (typeof on === 'boolean') setStatusText(on ? 'Shadows on' : 'Shadows off');
      return;
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      const on = renderer.toggleFx?.();
      if (typeof on === 'boolean') setStatusText(on ? 'FX on' : 'FX off');
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      const on = renderer.toggleVat?.();
      if (typeof on === 'boolean') setStatusText(on ? 'VAT on' : 'VAT off');
      return;
    }
    if (e.code === 'KeyU') {
      e.preventDefault();
      const on = renderer.toggleUnits?.();
      if (typeof on === 'boolean') setStatusText(on ? 'Units on' : 'Units off');
      return;
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      session.pauseLockstep = !session.pauseLockstep;
      if (session.pauseLockstep) session.simAcc = 0;
      renderer.setFxPaused?.(session.pauseLockstep);
      paintStatus();
      return;
    }
    if (e.code === 'F9') {
      e.preventDefault();
      liteExplorer.toggle();
    }
  });
  setupKothControls(kothShard);

  // Walk everyone so idle→walk skinning is under load (not just idle poses).
  if (animStress > 0) {
    const world = session.state;
    const entities = [];
    const tx = [];
    const ty = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      entities.push(i);
      // Swap sides — two blocks march through each other.
      const destX = world.owner[i] === PLAYER ? 240 : -240;
      tx.push(fx.fromFloat(destX));
      ty.push(world.py[i]);
    }
    if (entities.length) {
      session.submitCommand({ type: CMD.MOVE, entities, tx, ty });
    }
  }

  const prevCommit = session.onCommit;
  session.onCommit = (tick, checksum) => {
    prevCommit?.(tick, checksum);
    const world = session.state;
    const { wasAlive, deathFade } = bufs;
    for (let i = 0; i < session.count; i++) {
      if (wasAlive[i] && !world.alive[i]) deathFade[i] = 1;
      wasAlive[i] = world.alive[i];
    }
    if (session.count !== renderEntityCount) {
      renderEntityCount = session.count;
      resizeRenderBuffers(renderEntityCount);
      renderer.setCount(renderEntityCount);
      rebuildRendererEntities(renderer, session);
    }
    if (session.kothMatchOver && !matchOverShown) {
      matchOverShown = true;
      showMatchOver(session);
    }
    updateColors();
  };

  let lastUnmappedRebuild = 0;

  renderer.onFrame((deltaMs) => {
    // Keep FX clocks in sync with pause (catch-up / KOTH also toggle pauseLockstep).
    renderer.setFxPaused?.(session.pauseLockstep);
    renderer.cameraController?.tick?.(deltaMs);
    session.pump(deltaMs);

    if (session.replayingCatchUp) {
      paintStatus();
      updateColors();
    }

    fpsAcc += deltaMs;
    fpsFrames++;
    if (fpsAcc >= 500) {
      fpsDisplay = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
      paintStatus();
    }

    const alpha = session.displayAlpha;
    const { prev, cur } = session.displaySnapshots();
    if (!prev || !cur) return;

    // A/B: skip pose loop + health/auras when units are hidden.
    if (renderer.getUnitsEnabled && !renderer.getUnitsEnabled()) {
      renderer.commit();
      return;
    }

    const dt = Math.min(0.05, deltaMs / 1000);

    let colorsDirty = false;
    const drawStats = { p0: 0, p1: 0, unmapped: 0 };
    const n = session.count;
    const world = session.state;
    const {
      selected, wasSelected, deathFade, facingYaw, selSpinYaw, selSpinVel,
      colors, renderX, renderY, renderZ,
      poseX, poseZ, poseYaw, poseSize, poseLoft, poseMoving, poseValid,
      cacheGx, cacheGz, cacheGy,
    } = bufs;

    const groundYCached = (i, x, z) => {
      if (
        Math.abs(cacheGx[i] - x) <= POSE_XZ_EPS &&
        Math.abs(cacheGz[i] - z) <= POSE_XZ_EPS &&
        Number.isFinite(cacheGy[i])
      ) {
        return cacheGy[i];
      }
      const gy = renderer.groundYAt?.(x, z) ?? 0;
      cacheGx[i] = x;
      cacheGz[i] = z;
      cacheGy[i] = gy;
      return gy;
    };

    const poseDirty = (i, x, z, yaw, size, loft, movingBit) => {
      if (!poseValid[i]) return true;
      if (movingBit !== poseMoving[i]) return true;
      const pdx = x - poseX[i];
      const pdz = z - poseZ[i];
      if (pdx * pdx + pdz * pdz > POSE_XZ_EPS_SQ) return true;
      if (Math.abs(yaw - poseYaw[i]) > POSE_YAW_EPS) return true;
      if (Math.abs(size - poseSize[i]) > POSE_SIZE_EPS) return true;
      if (Math.abs(loft - poseLoft[i]) > POSE_LOFT_EPS) return true;
      return false;
    };

    const commitPose = (i, x, z, yaw, size, loft, movingBit) => {
      poseX[i] = x;
      poseZ[i] = z;
      poseYaw[i] = yaw;
      poseSize[i] = size;
      poseLoft[i] = loft;
      poseMoving[i] = movingBit;
      poseValid[i] = 1;
    };

    if (n !== renderEntityCount) {
      renderEntityCount = n;
      resizeRenderBuffers(n);
      renderer.setCount(n);
      rebuildRendererEntities(renderer, session);
    }
    // Apply lob flight snapshot before drawing so loft/trail match this frame.
    const monkKickUpdates = session.takePendingMonkKickUpdates?.();
    if (monkKickUpdates?.length) renderer.applyMonkKickUpdates?.(monkKickUpdates);
    renderer.setMonkLobDisplayAlpha?.(alpha);
    renderer.beginHealthBars?.();
    // Defer chip writes so selected units win if the bar pool is ever capped again.
    let hbSelCount = 0;
    let hbHurtCount = 0;
    const hbSel = bufs.hbSelected;
    const hbHurt = bufs.hbHurt;

    // Pack passengers into transport decks (v1 grid — vehicle GLBs have no seat anchors).
    const passengerSlot = bufs.passengerSlot;
    const passengerTotalOf = bufs.passengerTotalOf;
    if (passengerSlot && passengerSlot.length >= n) {
      passengerSlot.fill(-1);
      passengerTotalOf.fill(0);
      for (let i = 0; i < n; i++) {
        if (!world.alive[i] || !world.carriedBy || world.carriedBy[i] < 0) continue;
        passengerTotalOf[world.carriedBy[i]]++;
      }
      const nextSlot = bufs.passengerNextSlot;
      if (nextSlot && nextSlot.length >= n) {
        nextSlot.fill(0);
        for (let i = 0; i < n; i++) {
          if (!world.alive[i] || !world.carriedBy || world.carriedBy[i] < 0) continue;
          const t = world.carriedBy[i];
          passengerSlot[i] = nextSlot[t]++;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (deathFade[i] > 0) {
        deathFade[i] = Math.max(0, deathFade[i] - deltaMs / DEATH_FADE_MS);
        if (deathFade[i] <= 0 && !world.alive[i]) {
          if (poseDirty(i, 0, 0, 0, 0, 0, 0)) {
            if (!renderer.writeInstance(i, world.type[i], world.owner[i], 0, 0, 0)) drawStats.unmapped++;
            commitPose(i, 0, 0, 0, 0, 0, 0);
          }
          if (wasSelected[i]) {
            renderer.writeSelectionRing(i, 0, 0, 0);
            wasSelected[i] = 0;
          }
          colors[i * 4 + 3] = 0;
          colorsDirty = true;
          continue;
        }
      } else if (!world.alive[i]) {
        if (poseDirty(i, 0, 0, 0, 0, 0, 0)) {
          if (!renderer.writeInstance(i, world.type[i], world.owner[i], 0, 0, 0)) drawStats.unmapped++;
          commitPose(i, 0, 0, 0, 0, 0, 0);
        }
        if (wasSelected[i]) {
          renderer.writeSelectionRing(i, 0, 0, 0);
          wasSelected[i] = 0;
        }
        continue;
      }

      // Passengers ride on the transport deck (procedural grid — no seat anchors in GLBs).
      if (world.carriedBy && world.carriedBy[i] >= 0) {
        const t = world.carriedBy[i];
        if (t < 0 || t >= n || !world.alive[t]) {
          if (poseDirty(i, 0, 0, 0, 0, 0, 0)) {
            if (!renderer.writeInstance(i, world.type[i], world.owner[i], 0, 0, 0)) drawStats.unmapped++;
            commitPose(i, 0, 0, 0, 0, 0, 0);
          }
          if (wasSelected[i]) {
            renderer.writeSelectionRing(i, 0, 0, 0);
            wasSelected[i] = 0;
          }
          selected[i] = 0;
          continue;
        }
        const def = getUnitDef(world.type[i]);
        const tx = prev.x[t] + (cur.x[t] - prev.x[t]) * alpha;
        const tz = prev.z[t] + (cur.z[t] - prev.z[t]) * alpha;
        const yaw = facingYaw[t] || 0;
        const slot = passengerSlot?.[i] ?? 0;
        const total = Math.max(1, passengerTotalOf?.[t] ?? 1);
        const local = passengerLocalOffset(slot, total);
        const worldOff = rotateYawOffset(local.x, local.z, yaw);
        const x = tx + worldOff.x;
        const z = tz + worldOff.z;
        const air = isFlyer(world.type[t]);
        const loft = air ? Math.max(0, FLY_HEIGHT - AIR_PASSENGER_DROP) : 0;
        let size = def.size * 0.85;
        const fade = deathFade[i];
        if (fade > 0) size *= fade;
        const gy = groundYCached(i, x, z);
        renderX[i] = x;
        renderY[i] = gy + loft + (def.pickHeight ?? 1.1);
        renderZ[i] = z;
        if (fade > 0) {
          colors[i * 4 + 3] = fade;
          colorsDirty = true;
        }
        if (poseDirty(i, x, z, yaw, size, loft, 0) || fade > 0) {
          if (renderer.writeInstance(i, world.type[i], world.owner[i], x, z, size, yaw, false, loft, 0, 0, gy)) {
            if (world.owner[i] === 0) drawStats.p0++;
            else if (world.owner[i] === 1) drawStats.p1++;
          } else drawStats.unmapped++;
          commitPose(i, x, z, yaw, size, loft, 0);
        } else if (world.owner[i] === 0) drawStats.p0++;
        else if (world.owner[i] === 1) drawStats.p1++;
        if (wasSelected[i] || selected[i]) {
          renderer.writeSelectionRing(i, 0, 0, 0);
        }
        // Don't clear selected[] — unload stamps riders before the sim spills them,
        // and wiping here dropped that handoff every frame they were still carried.
        wasSelected[i] = 0;
        continue;
      }

      const def = getUnitDef(world.type[i]);
      const x = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha;
      const z = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha;
      const dx = cur.x[i] - prev.x[i];
      const dz = cur.z[i] - prev.z[i];
      // Soft-separation nudges positions without an order — don't spin facing / walk.
      // (navWpCount is worker-only; shared render state exposes order.)
      const orderedMove = (world.order?.[i] ?? ORDER.IDLE) !== ORDER.IDLE;
      const moving = orderedMove && dx * dx + dz * dz > 0.0004;
      if (moving) facingYaw[i] = Math.atan2(dx, dz);
      const flyLoft = isFlyer(world.type[i]) ? FLY_HEIGHT : 0;
      const loft = (renderer.monkLobHeight?.(i) ?? 0) + flyLoft;
      const pitch = renderer.monkLobPitch?.(i) ?? 0;
      const roll = renderer.monkLobRoll?.(i) ?? 0;
      const yawTwist = renderer.monkLobYawTwist?.(i) ?? 0;
      // Face along flight path while tumbling; twist spins on top.
      let yaw = facingYaw[i];
      if (loft > 0.01 && dx * dx + dz * dz > 0.0004) yaw = Math.atan2(dx, dz);
      yaw += yawTwist;
      let size = def.size;
      const fade = deathFade[i];
      if (fade > 0) size *= fade;
      // Pick sphere center at chest height over terrain (not sim `size`, which is spacing).
      const gy = groundYCached(i, x, z);
      renderX[i] = x;
      renderY[i] = gy + loft + (def.pickHeight ?? 1.1);
      renderZ[i] = z;
      if (fade > 0) {
        colors[i * 4 + 3] = fade;
        colorsDirty = true;
      }
      const movingBit = moving && world.alive[i] ? 1 : 0;
      const forcePose = fade > 0 || loft > 0.01 || pitch !== 0 || roll !== 0;
      if (forcePose || poseDirty(i, x, z, yaw, size, loft, movingBit)) {
        if (renderer.writeInstance(i, world.type[i], world.owner[i], x, z, size, yaw, !!movingBit, loft, pitch, roll, gy)) {
          if (world.owner[i] === 0) drawStats.p0++;
          else if (world.owner[i] === 1) drawStats.p1++;
        } else drawStats.unmapped++;
        commitPose(i, x, z, yaw, size, loft, movingBit);
      } else if (world.owner[i] === 0) drawStats.p0++;
      else if (world.owner[i] === 1) drawStats.p1++;
      const isSel = !!selected[i] && !!world.alive[i];
      if (isSel) {
        if (!wasSelected[i]) selSpinVel[i] = SEL_SPIN_START;
        const blend = Math.min(1, SEL_SPIN_SETTLE * dt);
        selSpinVel[i] += (SEL_SPIN_STEADY - selSpinVel[i]) * blend;
        selSpinYaw[i] += selSpinVel[i] * dt;
        // Authored colors when standing. Red/yellow only while en route (ATTACK_MOVE
        // stays set after arrival for acquire — don't leave the collar stuck red).
        // Hard ATTACK while engaged stays red even if not translating.
        const ord = world.order?.[i] ?? ORDER.IDLE;
        let ringTint = 'white';
        if (ord === ORDER.ATTACK) ringTint = 'red';
        else if (moving) {
          if (ord === ORDER.ATTACK_MOVE) ringTint = 'red';
          else if (ord === ORDER.MOVE) ringTint = 'yellow';
        }
        let ringKind = 'default';
        if (isTransport(world.type[i]) || def.category === 'vehicle' || def.category === 'air') {
          ringKind = 'vehicle';
        } else if (def.primaryAbility) {
          ringKind = 'caster';
        }
        renderer.writeSelectionRing(i, x, z, size, selSpinYaw[i], ringTint, { kind: ringKind });
      } else {
        selSpinVel[i] = 0;
        if (wasSelected[i]) renderer.writeSelectionRing(i, 0, 0, 0);
      }
      wasSelected[i] = isSel ? 1 : 0;

      const maxHp = def.hp;
      const hp = world.hp[i];
      if (maxHp > 0 && (isSel || hp < maxHp)) {
        const slot = isSel ? hbSelCount++ : hbHurtCount++;
        const buf = isSel ? hbSel : hbHurt;
        const o = slot * 4;
        buf[o] = x;
        buf[o + 1] = z;
        buf[o + 2] = size;
        buf[o + 3] = hp / maxHp;
      }
    }
    for (let s = 0; s < hbSelCount; s++) {
      const o = s * 4;
      renderer.writeHealthBar?.(hbSel[o], hbSel[o + 1], hbSel[o + 2], hbSel[o + 3], {
        armor: false,
        holy: false,
      });
    }
    for (let s = 0; s < hbHurtCount; s++) {
      const o = s * 4;
      renderer.writeHealthBar?.(hbHurt[o], hbHurt[o + 1], hbHurt[o + 2], hbHurt[o + 3], {
        armor: false,
        holy: false,
      });
    }
    renderer.endHealthBars?.();
    if (renderer.syncUnitAuras) {
      renderer.syncUnitAuras(
        n,
        {
          shieldHp: world.shieldHp,
          frostTicks: world.frostTicks,
          dotTicks: world.dotTicks,
        },
        renderX,
        renderY,
        renderZ,
        { fromStatus: true },
      );
    }
    if (DEBUG_KOTH && matchMeta.mode === 'koth' && performance.now() - lastRenderDebugAt > 3000) {
      lastRenderDebugAt = performance.now();
      console.info('[KOTH] render frame', {
        count: n,
        drawStats,
        batches: renderer.debugBatches?.(n, world.type, world.owner),
      });
    }
    if (drawStats.unmapped > 0 && performance.now() - lastUnmappedRebuild > 400) {
      lastUnmappedRebuild = performance.now();
      renderEntityCount = rebuildRendererEntities(renderer, session);
      bufs.poseValid.fill(0);
    }
    if (colorsDirty) renderer.setColors(colors);
    if (renderer.getPickHitboxesVisible?.()) {
      const spheres = [];
      for (let i = 0; i < n; i++) {
        if (!world.alive[i]) continue;
        const def = getUnitDef(world.type[i]);
        spheres.push({
          x: renderX[i],
          y: renderY[i],
          z: renderZ[i],
          r: def.pickRadius ?? 1.8,
        });
      }
      renderer.syncPickHitboxes?.(spheres);
    }
    const projectileSnapshots = session.displayProjectileSnapshots();
    renderer.syncProjectiles?.(
      projectileSnapshots.prev,
      projectileSnapshots.cur,
      alpha,
    );
    const treeUpdates = session.takePendingTreeUpdates?.();
    if (treeUpdates?.length) renderer.applyTreeUpdates?.(treeUpdates);
    const fireZoneUpdates = session.takePendingFireZoneUpdates?.();
    if (fireZoneUpdates?.length) renderer.applyFireZoneUpdates?.(fireZoneUpdates);
    const frogUpdates = session.takePendingFrogUpdates?.();
    if (frogUpdates?.length) renderer.applyFrogUpdates?.(frogUpdates);
    const lightningUpdates = session.takePendingLightningUpdates?.();
    if (lightningUpdates?.length) renderer.applyLightningUpdates?.(lightningUpdates);
    const holyArmorUpdates = session.takePendingHolyArmorUpdates?.();
    if (holyArmorUpdates?.length) renderer.applyHolyArmorUpdates?.(holyArmorUpdates);
    const sporeBloomUpdates = session.takePendingSporeBloomUpdates?.();
    if (sporeBloomUpdates?.length) {
      renderer.applySporeBloomUpdates?.(sporeBloomUpdates, world.tick);
    } else {
      renderer.setFxSimTick?.(world.tick);
    }
    renderer.commit();
  });

  await renderer.start();

  return {
    session,
    renderer,
    bufs,
    syncRenderer: () => {
      renderEntityCount = rebuildRendererEntities(renderer, session);
      return renderEntityCount;
    },
    resizeRenderBuffers,
    inputApi,
    kothShard,
    get matchOverShown() {
      return matchOverShown;
    },
    set matchOverShown(v) {
      matchOverShown = v;
    },
    get localPlayerId() {
      return localPlayerId;
    },
    set localPlayerId(v) {
      localPlayerId = v;
      inputApi.setLocalPlayerId?.(v);
    },
    matchMeta,
    setMatchMeta(m) {
      matchMeta = { ...matchMeta, ...m };
    },
    paintStatus,
    updateColors,
  };
}

async function applyLiveConfig(ctx, cfg, kothShard) {
  const gen = ++liveConfigGeneration;
  const activeSlots = cfg.activeSlots ?? cfg.humanPlayers ?? [];
  if ((cfg.mode === 'staging' || cfg.mode === 'sandbox') && activeSlots.length === 0) {
    if (gen !== liveConfigGeneration) return;
    ctx.setMatchMeta({ mode: 'staging', matchId: cfg.matchId });
    ctx.session.setRole(cfg.role ?? 'spectator');
    setStatusText('Looking for live shard…');
    return;
  }
  // A live KOTH match can legitimately have a single active army: the opening
  // creator before anyone joins, and the king left standing after every
  // opponent is slain. Only a zero-slot koth config is meaningless here.
  if (cfg.mode === 'koth' && activeSlots.length < 1) {
    console.warn('[KOTH] ignoring live config with no active slots', cfg);
    setStatusText('Waiting for roster sync…');
    return;
  }
  if (cfg.mode === 'koth' && DEBUG_KOTH) console.info('[KOTH] applying live config', { gen, activeSlots });

  const simMode = cfg.mode === 'staging' || cfg.mode === 'sandbox' ? 'staging' : 'koth';
  const humanPlayers = cfg.humanPlayers ?? activeSlots;
  ctx.session._pendingWorldGen = gen;
  await ctx.session.reset({
    seed: cfg.seed,
    mode: simMode,
    activeSlots,
    armyPerSide: cfg.armyPerSide ?? 0,
  });
  setArmyPerSide(cfg.armyPerSide ?? 0);
  if (gen !== liveConfigGeneration) {
    if (ctx.session._pendingWorldGen === gen) ctx.session._pendingWorldGen = null;
    if (DEBUG_KOTH) console.info('[KOTH] stale live config ignored after reset', { gen, current: liveConfigGeneration });
    return;
  }
  ctx.session._pendingWorldGen = null;
  ctx.session.setHumanPlayers(humanPlayers);
  if (cfg.mode === 'koth' && DEBUG_KOTH) console.info('[KOTH] sim after reset', ownerStats(ctx.session.state));

  forceRendererSync(ctx);
  syncPresentation(ctx, cfg, { skipRenderSync: true });

  if (cfg.mode === 'koth') {
    const world = ctx.session.state;
    console.info('[live] world ready', {
      activeSlots,
      count: ctx.session.count,
      p0: livingByOwner(world, 0),
      p1: livingByOwner(world, 1),
    });
  }

  // The live world is rebuilt and confirmedTick is back at 0 for this match;
  // seed the lockstep confirm handshake so the sim can leave tick 0.
  if (cfg.mode === 'koth') kothShard?.notifyLiveSessionReady?.();
}

function syncPresentation(ctx, cfg, options = {}) {
  if (!options.skipRenderSync && !ctx.session.resetting) forceRendererSync(ctx);
  ctx.setMatchMeta({ mode: cfg.mode ?? 'koth', matchId: cfg.matchId });
  if (cfg.localPlayerId != null) ctx.localPlayerId = cfg.localPlayerId;
  if (cfg.localPlayerId != null) ctx.session.setLocalPlayerId?.(cfg.localPlayerId);
  if (cfg.humanPlayers && (cfg.reset || cfg.updateHumanPlayers || options.updateHumanPlayers)) {
    ctx.session.setHumanPlayers(cfg.humanPlayers);
  }
  ctx.session.setRole(cfg.role ?? 'player');
  ctx.inputApi?.setRole?.(cfg.role ?? 'player');
  if (cfg.inputEnabled != null) ctx.inputApi?.setInputEnabled?.(Boolean(cfg.inputEnabled));
  if ((cfg.role ?? 'player') !== 'player') ctx.inputApi?.clearSelection?.();
  ctx.session.inputDelayTicks = cfg.mode === 'koth' ? 1 : 0;
  // Only snap the camera on a real match reset — presentation syncs (join/role)
  // used to call this every time and yank the view back to origin.
  if (cfg.mode === 'koth' && cfg.reset) ctx.renderer.resetCamera?.();

  const overEl = document.getElementById('match-over');
  if (overEl) overEl.style.display = 'none';
  ctx.matchOverShown = false;

  ctx.updateColors();
  const label =
    cfg.mode === 'staging' || cfg.mode === 'sandbox'
      ? 'Staging'
      : cfg.role === 'player'
        ? `Live — player ${cfg.localPlayerId}`
        : 'Live — spectating';
  setStatusText(label);
}

function ownerStats(world) {
  const owners = new Map();
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    const owner = world.owner[i];
    let s = owners.get(owner);
    if (!s) {
      s = { count: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      owners.set(owner, s);
    }
    const x = world.px[i] / 65536;
    const z = world.py[i] / 65536;
    s.count++;
    s.minX = Math.min(s.minX, x);
    s.maxX = Math.max(s.maxX, x);
    s.minZ = Math.min(s.minZ, z);
    s.maxZ = Math.max(s.maxZ, z);
  }
  return {
    count: world.count,
    owners: Object.fromEntries([...owners.entries()].map(([owner, s]) => [owner, s])),
  };
}

function showMatchOver(session) {
  const el = document.getElementById('match-over');
  if (!el) return;
  const k = session.koth;
  let text = 'Match over';
  if (session.matchWinner != null && session.matchWinner >= 0) {
    const winner = session.matchWinner;
    text =
      winner === (session.localPlayerId ?? 0)
        ? 'Victory — agora captured'
        : `Defeat — Player ${winner} captured the agora`;
  } else if (k) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < 5; i++) {
      if ((k.scores[i] ?? 0) > bestScore) {
        bestScore = k.scores[i];
        best = i;
      }
    }
    text = `Match over — Player ${best} wins (${bestScore} pts)`;
  }
  el.textContent = text;
  el.style.display = 'block';
}

function useKothAi(bootCfg, stress, animStress, solo) {
  if (animStress > 0) return [];
  if (stress > 0) return STRESS_AI_PROFILES.map((p) => ({ ...p }));
  if (solo) return [AI_OWNER];
  if (bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox') {
    return [{ owner: AI_OWNER, temperament: 'cautious' }];
  }
  if (bootCfg.mode === 'koth') return [];
  return [AI_OWNER];
}

function updateLegend() {
  const el = document.getElementById('legend');
  if (!el) return;
  el.innerHTML = PLAYER_ARMY.map(({ type }) => {
    const d = UNIT_DEFS[type];
    const rgb = d.color.map((v) => Math.round(v * 255)).join(',');
    return `<span class="legend-item"><i style="background:rgb(${rgb})"></i>${d.name}</span>`;
  }).join('');
}

function setStatusText(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function setupKothControls(kothShard) {
  const start = document.getElementById('koth-start');
  const join = document.getElementById('koth-join');
  if (!start || !join || !kothShard) {
    if (start) start.hidden = true;
    if (join) join.hidden = true;
    return;
  }
  start.addEventListener('click', () => {
    kothShard.startOrJoinLive?.();
    updateKothControls(kothShard);
  });
  join.addEventListener('click', () => {
    kothShard.requestJoin?.();
    updateKothControls(kothShard);
  });
  updateKothControls(kothShard);
}

function updateKothControls(kothShard) {
  const start = document.getElementById('koth-start');
  const join = document.getElementById('koth-join');
  if (!start || !join) return;
  if (!kothShard) {
    start.hidden = true;
    join.hidden = true;
    return;
  }
  const canJoin = Boolean(kothShard.canJoin?.());
  start.hidden = !kothShard.canStartOrJoinLive?.() || canJoin;
  join.hidden = !canJoin;
  join.textContent = kothShard.joinActionLabel?.() ?? 'Join Match';
}

async function waitForGetFireP2p(timeoutMs = 5000) {
  const start = performance.now();
  while (typeof globalThis.GETFIREP2P !== 'function' && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return typeof globalThis.GETFIREP2P === 'function';
}

async function waitForWebGPU(timeoutMs = 3000) {
  const start = performance.now();
  while (!navigator.gpu && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!navigator.gpu;
}

function showFallback(msg) {
  const el = document.getElementById('fallback');
  if (!el) return;
  el.style.display = 'grid';
  const p = el.querySelector('[data-msg]');
  if (p && msg) p.textContent = msg;
}

main().catch((err) => {
  console.error(err);
  showFallback(String(err?.message ?? err));
});
