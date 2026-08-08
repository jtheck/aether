// app/ — SimSession (lockstep) + Lite renderer + input.

import { livingByOwner, ORDER, MAX_ENTITIES } from '../sim/world.js';
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
import {
  applySerializedBuildingOccupancy,
  BUILDING_FOOTPRINTS,
  buildingHasMenu,
  canPlaceBuildingAt,
  defaultRallyWorld,
  isRallyBeyondBuilding,
  rallyPathWorldPoints,
  snapBuildingYaw,
  snapBuildingWorld,
} from '../sim/buildings.js';
import { TILE_SIZE_F, worldToTile } from '../sim/field.js';
import { TECH, TECH_BY_ID } from '../sim/tech.js';
import { createRenderer } from '../render/renderer.js';
import { createLiteExplorerToggle } from '../render/liteExplorer.js';
import { setupMenu } from './menu.js';
import {
  ensureFxModeDefault,
  ensureShadowModeDefault,
  fxTier,
  resolveFxMode,
  resolveShadowMode,
  shadowTier,
} from './settings.js';
import {
  OVERLAY_COLLAR_SPIN_DISTANCE_SQ,
  OVERLAY_MAX_BARS,
  markNearestN,
  overlayCameraRef,
} from '../render/overlayLod.js';
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
/** Select flourish → idle spin (distance-gated in overlay LOD). */
const SEL_SPIN_STEADY = 0.006 * 60;
const SEL_SPIN_START = 2.8;
const SEL_SPIN_SETTLE = 6;
const SEL_SPIN_EPS = 1e-3;
/** Tint codes for ring write skip. */
const RING_TINT_WHITE = 0;
const RING_TINT_RED = 1;
const RING_TINT_YELLOW = 2;
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
  // Progressive boot leaves units unmapped until templates arrive — don't warn.
  if (!(unmapped.length || stillUnmapped) && livingByOwner(world, 1) > 0) {
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
    showFallback(
      'SharedArrayBuffer unavailable — need Cross-Origin-Opener-Policy: same-origin and '
      + 'Cross-Origin-Embedder-Policy: require-corp (local: npm run serve; prod: set on CloudFront). '
      + 'crossOriginIsolated must be true.',
    );
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
    if (ctx?.localSoloHold) return;
    if (!ctx) {
      pendingLiveCfg = cfg;
      return;
    }
    await applyLiveConfig(ctx, cfg, kothShard);
  }

  function handlePresentationSync(cfg) {
    if (!ctx || ctx.localSoloHold) return;
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
    profileSim: new URLSearchParams(location.search).has('profileSim'),
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

  setStatusText('Waking the world…');

  // Seeds the saved tier from the GPU on first run only; no-op afterwards.
  await ensureShadowModeDefault();
  await ensureFxModeDefault();
  const bootShadowMode = resolveShadowMode();
  const bootFxMode = resolveFxMode();
  const renderer = await createRenderer(canvas, count, {
    shadowQuality: shadowTier(bootShadowMode),
    fxMode: bootFxMode,
    fxQuality: fxTier(bootFxMode),
    types: session.state.type,
    owners: session.state.owner,
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
  // First paint ASAP — props/units/radials continue loading in the background.
  await renderer.start();
  rebuildRendererEntities(renderer, session);
  setStatusText('');
  // Console: renderer.toggleShadows() / renderer.setShadowsEnabled(false)
  window.renderer = renderer;
  window.session = session;
  window.dumpPools = () => {
    const world = session.state;
    const pools = renderer.poolStats?.() ?? {};
    const proj = world.projectiles;
    const out = {
      unitsWorld: world.count,
      projectiles: {
        active: proj?.activeCount ?? 0,
        highWater: proj?.highWater ?? 0,
        capacity: 32768,
      },
      ...pools,
    };
    console.table(
      Object.fromEntries(
        Object.entries({
          units_mapped: out.units,
          particles: out.particles,
          trails: out.trails,
          frogs: out.frogs,
          lightning: out.lightning,
          groundFires: out.groundFires,
          projectiles: out.projectiles,
        }).filter(([, v]) => v),
      ),
    );
    if (out.units?.batches) {
      const hot = Object.entries(out.units.batches)
        .map(([k, v]) => ({ batch: k, ...v, fill: v.capacity ? +(v.active / v.capacity).toFixed(2) : 0 }))
        .filter((r) => r.active > 0 || r.capacity > 32)
        .sort((a, b) => b.active - a.active)
        .slice(0, 20);
      console.table(hot);
    }
    console.log('[dumpPools]', out);
    return out;
  };
  window.dumpSimProfile = () => {
    const ema = session.simTimingEma;
    const last = session.simTimingLast ?? session.simMetrics?.timing;
    if (!ema && !last) {
      console.warn('[dumpSimProfile] no timing yet — stress/?profileSim=1 enables worker profiling');
      return null;
    }
    const keys = new Set([
      ...Object.keys(ema ?? {}),
      ...Object.keys(last ?? {}),
    ]);
    const rows = [...keys]
      .map((phase) => ({
        phase,
        emaMs: ema?.[phase] != null ? +ema[phase].toFixed(2) : null,
        lastMs: last?.[phase] != null ? +Number(last[phase]).toFixed(2) : null,
        pct: ema?.tick > 0 && ema?.[phase] != null
          ? +((ema[phase] / ema.tick) * 100).toFixed(1)
          : null,
      }))
      .sort((a, b) => (b.emaMs ?? b.lastMs ?? 0) - (a.emaMs ?? a.lastMs ?? 0));
    console.table(rows);
    const m = session.simMetrics;
    console.log('[dumpSimProfile]', {
      units: session.state?.count,
      tick: session.confirmedTick,
      emaTickMs: ema?.tick != null ? +ema.tick.toFixed(2) : null,
      budgetMs: 50,
      counters: m
        ? {
            combatCandidates: m.combatCandidates,
            separationPairs: m.separationPairs,
            movingAvoidancePairs: m.movingAvoidancePairs,
            losAttempts: m.losAttempts,
            astarSearches: m.astarSearches,
            projectileActive: m.projectileActive,
          }
        : null,
    });
    return { rows, ema, last, metrics: m };
  };
  /**
   * GPU pixel-perfect pick (renderer.pickUnit) vs CPU ray-vs-sphere (renderer.rayPickSpheres)
   * latency + accuracy, sampled against currently on-screen units. Aim the camera at your
   * army first — needs live units in view to build sample points.
   * Flip USE_GPU_PICK in render/pickMode.js and hard-refresh before GPU samples.
   */
  window.dumpPickBench = async (trials = 60) => {
    const world = session.state;
    const rect = canvas.getBoundingClientRect();
    const { renderX, renderY, renderZ } = bufs;

    const candidates = [];
    const spheres = [];
    for (let i = 0; i < session.count; i++) {
      if (!world.alive[i]) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      const def = getUnitDef(world.type[i]);
      spheres.push({ id: i, x: renderX[i], y: renderY[i], z: renderZ[i], r: def.pickRadius ?? 1.8 });
      const p = renderer.worldToScreen(renderX[i], renderY[i], renderZ[i]);
      if (!p || p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
      candidates.push({ id: i, clientX: rect.left + p.x, clientY: rect.top + p.y });
    }
    if (candidates.length === 0) {
      console.warn('[dumpPickBench] no on-screen units — aim the camera at your army first');
      return null;
    }

    const samples = [];
    for (let k = 0; k < trials; k++) samples.push(candidates[k % candidates.length]);

    function stats(ms) {
      const sorted = ms.slice().sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      return {
        n: sorted.length,
        meanMs: +(sum / sorted.length).toFixed(3),
        medianMs: +pct(0.5).toFixed(3),
        p95Ms: +pct(0.95).toFixed(3),
        maxMs: +sorted[sorted.length - 1].toFixed(3),
        minMs: +sorted[0].toFixed(3),
      };
    }

    // Sequential (not pipelined) — isolates each round trip's true latency.
    const gpuTimes = [];
    let gpuHits = 0;
    for (const s of samples) {
      const t0 = performance.now();
      // eslint-disable-next-line no-await-in-loop
      const id = await renderer.pickUnit(s.clientX, s.clientY);
      gpuTimes.push(performance.now() - t0);
      if (id === s.id) gpuHits++;
    }

    const cpuTimes = [];
    let cpuHits = 0;
    for (const s of samples) {
      const t0 = performance.now();
      const id = renderer.rayPickSpheres(s.clientX, s.clientY, spheres);
      cpuTimes.push(performance.now() - t0);
      if (id === s.id) cpuHits++;
    }

    const gpuStats = stats(gpuTimes);
    const cpuStats = stats(cpuTimes);
    console.table({
      'GPU pixel-perfect (pickUnit)': { ...gpuStats, hitRate: `${gpuHits}/${samples.length}` },
      'CPU ray-vs-sphere (rayPickSpheres)': { ...cpuStats, hitRate: `${cpuHits}/${samples.length}` },
    });
    console.log(
      '[dumpPickBench] GPU/CPU mean speedup:',
      `${(gpuStats.meanMs / Math.max(cpuStats.meanMs, 1e-6)).toFixed(1)}x`,
      '· units in view:', candidates.length,
    );
    return {
      gpu: { ...gpuStats, hitRate: gpuHits / samples.length },
      cpu: { ...cpuStats, hitRate: cpuHits / samples.length },
      samples: samples.length,
      unitsInView: candidates.length,
    };
  };
  if (new URLSearchParams(location.search).get('tiles') === '1') {
    renderer.setTileGridVisible(true);
  }
  if (new URLSearchParams(location.search).get('hitboxes') === '1') {
    renderer.setPickHitboxesVisible?.(true);
  }
  // Applied after start() rather than at construction so receivers still
  // register with shadow sampling compiled in and B can re-enable them.
  if (bootShadowMode === 0) {
    renderer.setShadowsEnabled?.(false);
  }
  /** Filled just before return so the menu callback can reach the live ctx. */
  const ctxRef = { current: null };
  const sideMenu = setupMenu({
    renderer,
    onStartSoloAi: () => startSoloAiMatch(ctxRef.current),
  });
  const liteExplorer = createLiteExplorerToggle({
    engine: renderer.engine,
    scene: renderer.scene,
    canvas,
  });
  let renderEntityCount = rebuildRendererEntities(renderer, session);

  // Match sim SoA: fixed MAX_ENTITIES. Never realloc on spawn — selection/pose
  // state stays stable for the whole match; only live `count` moves.
  const CAP = MAX_ENTITIES;
  /** Mutable render buffers — frame loop reads this object, not closed-over copies. */
  const bufs = {
    selected: new Uint8Array(CAP),
    wasSelected: new Uint8Array(CAP),
    wasAlive: new Uint8Array(CAP),
    deathFade: new Float32Array(CAP),
    facingYaw: new Float32Array(CAP),
    selSpinYaw: new Float32Array(CAP),
    selSpinVel: new Float32Array(CAP),
    /** Last collar write — skip GPU dirty once spin settles and pose/tint hold. */
    ringX: new Float32Array(CAP),
    ringZ: new Float32Array(CAP),
    ringSize: new Float32Array(CAP),
    ringTint: new Uint8Array(CAP),
    colors: new Float32Array(CAP * 4),
    renderX: new Float32Array(CAP),
    renderY: new Float32Array(CAP),
    renderZ: new Float32Array(CAP),
    /** Last matrix write — skip rewrite when pose is unchanged. */
    poseX: new Float32Array(CAP),
    poseZ: new Float32Array(CAP),
    poseYaw: new Float32Array(CAP),
    poseSize: new Float32Array(CAP),
    poseLoft: new Float32Array(CAP),
    poseMoving: new Uint8Array(CAP),
    poseValid: new Uint8Array(CAP),
    /** Cached terrain height for unchanged xz. */
    cacheGx: new Float32Array(CAP),
    cacheGz: new Float32Array(CAP),
    cacheGy: new Float32Array(CAP),
    /** Deferred health chips: [x, z, size, ratio] × N (selected first at flush). */
    hbSelected: new Float32Array(CAP * 4),
    hbHurt: new Float32Array(CAP * 4),
    /** Passenger deck packing for carried units. */
    passengerSlot: new Int32Array(CAP),
    passengerTotalOf: new Int32Array(CAP),
    passengerNextSlot: new Int32Array(CAP),
    /** Overlay LOD: spin allow mask + nearest-N health-bar pick. */
    overlaySpinAllow: new Uint8Array(CAP),
    overlayBarIds: new Int32Array(CAP),
    overlayBarD2: new Float32Array(CAP),
    overlayBarAllow: new Uint8Array(CAP),
  };
  bufs.wasAlive.fill(1);
  bufs.cacheGx.fill(NaN);
  bufs.cacheGz.fill(NaN);
  bufs.cacheGy.fill(NaN);
  bufs.ringX.fill(NaN);
  bufs.ringZ.fill(NaN);

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

  session.onWorldRebuilt = async (entityCount) => {
    if (session._pendingWorldGen != null && session._pendingWorldGen !== liveConfigGeneration) return;
    renderer.setCount(entityCount);
    renderEntityCount = rebuildRendererEntities(renderer, session);
    renderer.clearProjectiles?.();
    renderer.clearParticles?.();
    renderer.placeAgoras?.(session.agoras);
    renderer.placeBuildings?.(session.buildings);
    syncRallyFlagMarkers();
    if (session.field) await renderer.setField?.(session.field);
    updateColors();
    if (matchMeta.mode === 'koth' || matchMeta.mode === 'solo') {
      logArmyRenderState(renderer, session, 'world rebuilt');
    }
  };

  session.onBuildingsChanged = (list) => {
    if (session.field) {
      applySerializedBuildingOccupancy(session.field, list);
      renderer.refreshTileGrid?.();
    }
    renderer.placeBuildings?.(list);
    syncRallyFlagMarkers(list);
  };

  function ownerTechBits(owner = localPlayerId) {
    return session.tech?.[owner | 0] | 0;
  }

  function ownerHasDrayage(owner) {
    return (ownerTechBits(owner) & TECH.DRAYAGE) !== 0;
  }

  /** @returns {string[]} */
  function researchedUpgradeIdsFor(owner = localPlayerId) {
    const bits = ownerTechBits(owner);
    /** @type {string[]} */
    const ids = [];
    for (const [id, bit] of Object.entries(TECH_BY_ID)) {
      if (bits & bit) ids.push(id);
    }
    return ids;
  }

  function syncActionRadialResearch() {
    if (!renderer.isActionRadialOpen?.()) return;
    renderer.setActionRadialResearched?.(researchedUpgradeIdsFor(localPlayerId));
  }

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
    else if (matchMeta.mode === 'solo') line = `1v1 AI  ·  ${line}`;
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
  /** True while setting a production building's train rally with the flag cursor. */
  let placingRally = false;
  /** @type {{ kind: 'agora' | 'building', index: number }[]} */
  let selectedBuildings = [];
  /** Ghost A* cache — repath only when the cursor enters a new tile. */
  let ghostPathTileKey = -1;
  /** @type {{ x: number, z: number }[] | null} */
  let ghostPathPoints = null;

  session.onTechChanged = () => {
    ghostPathTileKey = -1;
    ghostPathPoints = null;
    syncRallyFlagMarkers();
    syncActionRadialResearch();
  };

  function rallyPathOptsForOwner(owner) {
    return ownerHasDrayage(owner) ? { slowAware: true } : null;
  }

  function rallyMarkerFor(b, rx, rz) {
    return {
      x: rx,
      z: rz,
      fromX: b.x,
      fromZ: b.z,
      points: rallyPathWorldPoints(
        session.field,
        b,
        rx,
        rz,
        rallyPathOptsForOwner(b.owner),
      ),
      yaw: b.yaw ?? 0,
      owner: b.owner | 0,
    };
  }

  function setRallyGhostAt(b, x, z) {
    const tx = worldToTile(fx.fromFloat(x));
    const tz = worldToTile(fx.fromFloat(z));
    const key = ((tz & 0xffff) << 16) | (tx & 0xffff);
    const pathOpts = rallyPathOptsForOwner(b.owner);
    if (key !== ghostPathTileKey || !ghostPathPoints) {
      ghostPathTileKey = key;
      ghostPathPoints = rallyPathWorldPoints(session.field, b, x, z, pathOpts);
    } else {
      // Same tile — keep the A* spine, pin the tip to the live cursor.
      const pts = ghostPathPoints.slice();
      if (pts.length) pts[pts.length - 1] = { x, z };
      else pts.push({ x, z });
      ghostPathPoints = pts;
    }
    renderer.setRallyGhost?.({
      x,
      z,
      fromX: b.x,
      fromZ: b.z,
      points: ghostPathPoints,
      owner: localPlayerId,
    });
  }

  function syncRallyFlagMarkers(list = session.buildings) {
    const markers = [];
    const buildings = list ?? [];
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (sel?.kind !== 'building') continue;
      const b = buildings[sel.index];
      if (!b?.hasRally) continue;
      if (!isRallyBeyondBuilding(b.type, b.x, b.z, b.rallyX, b.rallyZ)) continue;
      markers.push(rallyMarkerFor(b, b.rallyX, b.rallyZ));
    }
    renderer.placeRallyFlags?.(markers);
  }

  function beginRallyPlacement() {
    if (actionBuildingIndex < 0 || localPlayerId < 0) return;
    const b = session.buildings?.[actionBuildingIndex];
    if (!b || b.owner !== localPlayerId) return;
    placingRally = true;
    ghostPathTileKey = -1;
    ghostPathPoints = null;
    applyPlacingType(null);
    renderer.setActionRadialArmed?.(null);
    renderer.hideActionRadial?.();
    const yaw = b.yaw ?? 0;
    let rx;
    let rz;
    if (
      b.hasRally &&
      isRallyBeyondBuilding(b.type, b.x, b.z, b.rallyX, b.rallyZ)
    ) {
      rx = b.rallyX;
      rz = b.rallyZ;
    } else {
      const def = defaultRallyWorld(b.type, b.x, b.z, yaw);
      rx = def.x;
      rz = def.z;
    }
    setRallyGhostAt(b, rx, rz);
    // Hide planted marker while the ghost owns the cursor.
    renderer.placeRallyFlags?.([]);
  }

  function endRallyPlacement() {
    placingRally = false;
    ghostPathTileKey = -1;
    ghostPathPoints = null;
    renderer.setRallyGhost?.(null);
    syncRallyFlagMarkers();
  }
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
    // Placeables: S for 2×2 footprints, M otherwise.
    if (!b) return null;
    const fp = BUILDING_FOOTPRINTS[b.type];
    const size = fp && fp.w <= 2 ? 's' : 'm';
    return { x: b.x, z: b.z, size };
  }

  /**
   * @param {{ kind: 'agora' | 'building', index: number } | { kind: 'agora' | 'building', index: number }[] | null | undefined} selOrList
   */
  function syncBuildingHighlight(selOrList) {
    if (!selOrList) {
      renderer.setBuildingSelectionHighlight?.(null);
      return;
    }
    const list = Array.isArray(selOrList) ? selOrList : [selOrList];
    const positions = [];
    for (let i = 0; i < list.length; i++) {
      const pos = buildingWorldPos(list[i]);
      if (pos) positions.push(pos);
    }
    renderer.setBuildingSelectionHighlight?.(positions.length ? positions : null);
  }

  function openRadialForAgora(index) {
    lastAgoraIndex = index;
    const a = session.agoras?.[index];
    if (!a) return;
    renderer.hideActionRadial?.();
    renderer.showBuildingRadial?.(a.x, a.z);
  }

  /** Selected placeable driving the action radial (for train / cancel cmds). */
  let actionBuildingIndex = -1;

  /** Push sim building tracks onto the open action radial. */
  function syncActionRadialTracksFromSim() {
    if (!renderer.isActionRadialOpen?.() || actionBuildingIndex < 0) return;
    const b = session.buildings?.[actionBuildingIndex];
    /** @type {Record<string, { progress: number, count: number }>} */
    const tracks = {};
    for (const t of b?.tracks ?? []) {
      if (!t?.id || (t.count | 0) < 1) continue;
      tracks[`${t.kind}:${t.id}`] = {
        progress: Number(t.progress) || 0,
        count: t.count | 0,
      };
    }
    renderer.setActionRadialTracks?.(tracks);
    syncActionRadialResearch();
  }

  function openActionRadialForBuilding(index) {
    const b = session.buildings?.[index];
    if (!b || !buildingHasMenu(b.type)) {
      closeRadial();
      return;
    }
    actionBuildingIndex = index;
    renderer.hideBuildingRadial?.();
    renderer.showActionRadial?.(b.x, b.z, b.type);
    syncActionRadialTracksFromSim();
  }

  function closeRadial() {
    actionBuildingIndex = -1;
    renderer.setActionRadialArmed?.(null);
    renderer.hideBuildingRadial?.();
    renderer.hideActionRadial?.();
  }

  function isAnyRadialOpen() {
    return (
      (renderer.isBuildingRadialOpen?.() ?? false) ||
      (renderer.isActionRadialOpen?.() ?? false)
    );
  }

  /** @param {string | null} t */
  function applyPlacingType(t) {
    if (t) endRallyPlacement();
    placingType = t ?? null;
    if (!placingType) {
      placingYaw = 0;
      renderer.setBuildingGhost?.(null);
    }
    renderer.setBuildingRadialCompact?.(Boolean(placingType));
  }

  // Locked until splash fades — camera + commands stay quiet together.
  let bootInteractive = false;
  const setInteractive = (on) => {
    bootInteractive = !!on;
  };
  let inputApi = setupInput({
    canvas,
    renderer,
    inputActive: () => bootInteractive,
    world: () => session.state,
    selected: bufs.selected,
    localPlayerId,
    getUnitWorldPos: (i, out) => {
      out.x = bufs.renderX[i];
      out.y = bufs.renderY[i];
      out.z = bufs.renderZ[i];
      return out;
    },
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
    onBuildingSelected: (sel, _ptr, all) => {
      const list = all ?? (sel ? [sel] : null);
      selectedBuildings = list ? list.slice() : [];
      syncBuildingHighlight(list);
      syncRallyFlagMarkers();
      // Action / build radials only for a single selection.
      if (sel && list && list.length === 1) {
        if (sel.kind === 'agora') {
          openRadialForAgora(sel.index);
          return;
        }
        if (sel.kind === 'building') {
          openActionRadialForBuilding(sel.index);
          return;
        }
      }
      closeRadial();
    },
    getPlacingType: () => placingType,
    setPlacingType: (t) => {
      applyPlacingType(t);
    },
    isPlacingRally: () => placingRally,
    onRallyMove: (x, z) => {
      if (!placingRally || actionBuildingIndex < 0) return;
      const b = session.buildings?.[actionBuildingIndex];
      if (!b) return;
      setRallyGhostAt(b, x, z);
    },
    onRallyConfirm: (x, z) => {
      if (!placingRally || actionBuildingIndex < 0 || localPlayerId < 0) return;
      const b = session.buildings?.[actionBuildingIndex];
      if (!b || !isRallyBeyondBuilding(b.type, b.x, b.z, x, z)) {
        // Keep placement open until the point clears the footprint.
        return;
      }
      session.submitCommand({
        type: CMD.SET_RALLY,
        playerId: localPlayerId,
        buildingIndex: actionBuildingIndex,
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
      });
      endRallyPlacement();
      openActionRadialForBuilding(actionBuildingIndex);
      renderer.pingOrderMarker?.(x, z, undefined, 'white', { forceMove: true });
    },
    clearRallyPlacement: () => {
      endRallyPlacement();
    },
    onRallyCancel: () => {
      const bi = actionBuildingIndex;
      endRallyPlacement();
      if (bi >= 0) openActionRadialForBuilding(bi);
    },
    getPlacementYaw: () => placingYaw,
    setPlacementYaw: (yaw) => {
      placingYaw = snapBuildingYaw(yaw);
    },
    onPlacementMove: (x, z, yaw = placingYaw) => {
      if (!placingType) return;
      const yawRad = snapBuildingYaw(yaw ?? placingYaw);
      placingYaw = yawRad;
      const snapped = snapBuildingWorld(
        placingType,
        fx.fromFloat(x),
        fx.fromFloat(z),
      );
      const sx = fx.toFloat(snapped.x);
      const sz = fx.toFloat(snapped.z);
      const valid = session.field
        ? canPlaceBuildingAt(session.field, placingType, snapped.x, snapped.z)
        : true;
      renderer.setBuildingGhost?.({
        type: placingType,
        x: sx,
        z: sz,
        yaw: yawRad,
        valid,
      });
    },
    onPlacementConfirm: (x, z, yaw = placingYaw) => {
      if (!placingType) return;
      const type = placingType;
      const yawRad = snapBuildingYaw(yaw ?? placingYaw);
      placingYaw = yawRad;
      const snapped = snapBuildingWorld(type, fx.fromFloat(x), fx.fromFloat(z));
      const sx = fx.toFloat(snapped.x);
      const sz = fx.toFloat(snapped.z);
      if (session.field && !canPlaceBuildingAt(session.field, type, snapped.x, snapped.z)) {
        // Stay in placement mode; ghost already shows invalid.
        renderer.setBuildingGhost?.({
          type,
          x: sx,
          z: sz,
          yaw: yawRad,
          valid: false,
        });
        return;
      }
      session.submitCommand({
        type: CMD.PLACE_BUILDING,
        playerId: localPlayerId,
        buildingType: type,
        tx: snapped.x,
        ty: snapped.z,
        yaw: fx.fromFloat(yawRad),
      });
      // Multi-place: keep type + yaw; ghost follows on next move.
      renderer.setBuildingGhost?.(null);
      if (lastAgoraIndex >= 0) {
        inputApi.setSelectedBuilding?.({ kind: 'agora', index: lastAgoraIndex });
      }
    },
    onPlacementCancel: () => {
      applyPlacingType(null);
      renderer.unlockBuildingRadialCategory?.();
      if (lastAgoraIndex >= 0) {
        inputApi.setSelectedBuilding?.({ kind: 'agora', index: lastAgoraIndex });
      }
    },
    isRadialOpen: () => isAnyRadialOpen(),
    pickRadialOption: (cx, cy) => renderer.pickBuildingRadial?.(cx, cy) ?? null,
    onRadialPick: (picked) => {
      if (!picked) return;
      if (typeof picked === 'string') {
        applyPlacingType(picked);
        placingYaw = 0;
        renderer.setBuildingGhost?.(null);
        return;
      }
      if (picked.kind === 'unit') {
        renderer.setActionRadialArmed?.(null);
        if (actionBuildingIndex < 0 || localPlayerId < 0) return;
        session.submitCommand({
          type: CMD.QUEUE_TRAIN,
          playerId: localPlayerId,
          buildingIndex: actionBuildingIndex,
          unitKey: picked.id,
        });
        return;
      }
      if (picked.kind === 'upgrade') {
        renderer.setActionRadialArmed?.(null);
        if (actionBuildingIndex < 0 || localPlayerId < 0) return;
        const techId = picked.id;
        if (!techId) return;
        // Already owned — pad is dull; ignore re-queue.
        if (researchedUpgradeIdsFor(localPlayerId).includes(techId)) return;
        session.submitCommand({
          type: CMD.RESEARCH,
          playerId: localPlayerId,
          buildingIndex: actionBuildingIndex,
          techId,
        });
        return;
      }
      if (picked.kind === 'utility') {
        const id = picked.id;
        if (id === 'garrison') return; // unavailable until sim garrison lands
        if (id === 'rally') {
          beginRallyPlacement();
          return;
        }
        if (id === 'demolish') {
          if (renderer.getActionRadialArmed?.() === 'demolish') {
            renderer.setActionRadialArmed?.(null);
            // Demolish confirm stub — no building delete yet.
          } else {
            renderer.setActionRadialArmed?.('demolish');
          }
          return;
        }
        return;
      }
      if (picked.kind === 'cancel') {
        const tracks = renderer.getActionRadialTracks?.() ?? {};
        const hasWork = Object.values(tracks).some(
          (t) => (t?.count | 0) > 0 || (t?.progress ?? 0) > 0,
        );
        if (!hasWork) return;
        if (renderer.getActionRadialArmed?.() === 'cancel') {
          if (actionBuildingIndex >= 0 && localPlayerId >= 0) {
            session.submitCommand({
              type: CMD.CANCEL_TRAIN,
              playerId: localPlayerId,
              buildingIndex: actionBuildingIndex,
            });
          }
          renderer.setActionRadialArmed?.(null);
        } else {
          renderer.setActionRadialArmed?.('cancel');
        }
        return;
      }
      if (picked.kind === 'category') {
        // Lock the page and drop any in-progress ghost so hover can browse again.
        applyPlacingType(null);
        renderer.setBuildingRadialCategory?.(picked.id, true);
        return;
      }
      if (picked.kind === 'building') {
        // Keep the agora radial open while ghost-placing / switching types.
        applyPlacingType(picked.id);
        placingYaw = 0;
        renderer.setBuildingGhost?.(null);
      }
    },
    onRadialHover: (cx, cy) =>
      renderer.hoverBuildingRadial?.(cx, cy, !placingType),
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
      if (isAnyRadialOpen()) {
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
      const on = renderer.togglePickHitboxes?.();
      if (typeof on === 'boolean') {
        console.info('[pick hitboxes]', on ? 'on' : 'off');
        setStatusText(on ? 'Pick hitboxes on' : 'Pick hitboxes off');
      }
      return;
    }
    if (e.code === 'KeyB') {
      e.preventDefault();
      const on = renderer.toggleShadows?.();
      if (typeof on === 'boolean') setStatusText(on ? 'Shadows on' : 'Shadows off');
      sideMenu.refresh();
      return;
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      const on = renderer.toggleFx?.();
      if (typeof on === 'boolean') {
        const st = renderer.particleStats?.();
        setStatusText(
          on
            ? `FX on${st ? ` · ${st.active}/${st.hardMax} p` : ''}`
            : 'FX off',
        );
      }
      sideMenu.refresh();
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
      ringX, ringZ, ringSize, ringTint,
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

    if (renderer.consumePoseResync?.()) {
      bufs.poseValid.fill(0);
      renderEntityCount = rebuildRendererEntities(renderer, session);
    }
    if (n !== renderEntityCount) {
      renderEntityCount = n;
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

    // Overlay LOD: collar spin by eye distance; health bars nearest-N to look-at.
    const overlay = overlayCameraRef(renderer);
    const overlaySpinAllow = bufs.overlaySpinAllow;
    const overlayBarAllow = bufs.overlayBarAllow;
    overlaySpinAllow.fill(0);
    overlayBarAllow.fill(0);
    const barIds = bufs.overlayBarIds;
    const barD2 = bufs.overlayBarD2;
    let barCand = 0;
    const refX = overlay.x;
    const refZ = overlay.z;
    const eyeX = overlay.eyeX;
    const eyeZ = overlay.eyeZ;
    for (let i = 0; i < n; i++) {
      if (!world.alive[i]) continue;
      if (world.carriedBy && world.carriedBy[i] >= 0) continue;
      const isSel = !!selected[i];
      const def = getUnitDef(world.type[i]);
      const hurt = def.hp > 0 && world.hp[i] < def.hp;
      if (!isSel && !hurt) continue;
      const x = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha;
      const z = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha;
      if (isSel) {
        const sx = x - eyeX;
        const sz = z - eyeZ;
        if (sx * sx + sz * sz <= OVERLAY_COLLAR_SPIN_DISTANCE_SQ) overlaySpinAllow[i] = 1;
      }
      barIds[barCand] = i;
      const dx = x - refX;
      const dz = z - refZ;
      barD2[barCand] = dx * dx + dz * dz;
      barCand++;
    }
    markNearestN(barIds, barD2, barCand, OVERLAY_MAX_BARS, overlayBarAllow);

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
          inputApi?.deselectEntity?.(i);
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
      // MOVE/ATTACK_MOVE keep walk/rings even while path is pending (zero dx).
      const ord = world.order?.[i] ?? ORDER.IDLE;
      const orderedMove = ord !== ORDER.IDLE;
      const orderedMarch = ord === ORDER.MOVE || ord === ORDER.ATTACK_MOVE;
      const displacing = dx * dx + dz * dz > 0.0004;
      // Interpolated sim face — shows turn-in-place (XZ snapshots alone looked frozen).
      let faceDx = dx;
      let faceDz = dz;
      if (cur.faceX && prev.faceX) {
        faceDx = prev.faceX[i] + (cur.faceX[i] - prev.faceX[i]) * alpha;
        faceDz = prev.faceZ[i] + (cur.faceZ[i] - prev.faceZ[i]) * alpha;
      }
      const turning = orderedMove && faceDx * faceDx + faceDz * faceDz > 1e-6;
      const moving = orderedMarch || (orderedMove && (displacing || turning));
      if (turning) facingYaw[i] = Math.atan2(faceDx, faceDz);
      else if (displacing && orderedMove) facingYaw[i] = Math.atan2(dx, dz);
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
        // Burst + idle spin within spin distance; static collar beyond (always drawn).
        const spinOk = !!overlaySpinAllow[i];
        if (spinOk) {
          if (!wasSelected[i]) {
            selSpinVel[i] = SEL_SPIN_START;
            ringX[i] = NaN;
          } else if (selSpinVel[i] < SEL_SPIN_EPS) {
            // Re-entered range — ease back to idle spin without another burst.
            selSpinVel[i] = SEL_SPIN_STEADY;
          }
          const blend = Math.min(1, SEL_SPIN_SETTLE * dt);
          selSpinVel[i] += (SEL_SPIN_STEADY - selSpinVel[i]) * blend;
          if (selSpinVel[i] > SEL_SPIN_EPS) selSpinYaw[i] += selSpinVel[i] * dt;
          else selSpinVel[i] = 0;
        } else {
          selSpinVel[i] = 0;
          if (!wasSelected[i]) {
            selSpinYaw[i] = 0;
            ringX[i] = NaN;
          }
        }
        const spinning = spinOk && selSpinVel[i] > SEL_SPIN_EPS;
        // Authored colors when standing. Red/yellow only while en route (ATTACK_MOVE
        // stays set after arrival for acquire — don't leave the collar stuck red).
        // Hard ATTACK while engaged stays red even if not translating.
        let tintName = 'white';
        let tintCode = RING_TINT_WHITE;
        if (ord === ORDER.ATTACK) {
          tintName = 'red';
          tintCode = RING_TINT_RED;
        } else if (moving) {
          if (ord === ORDER.ATTACK_MOVE) {
            tintName = 'red';
            tintCode = RING_TINT_RED;
          } else if (ord === ORDER.MOVE) {
            tintName = 'yellow';
            tintCode = RING_TINT_YELLOW;
          }
        }
        let ringKind = 'default';
        if (isTransport(world.type[i]) || def.category === 'vehicle' || def.category === 'air') {
          ringKind = 'vehicle';
        } else if (def.primaryAbility) {
          ringKind = 'caster';
        }
        // After the flourish, only rewrite when the unit moved or tint changed.
        const needRing =
          spinning ||
          tintCode !== ringTint[i] ||
          !Number.isFinite(ringX[i]) ||
          Math.abs(x - ringX[i]) > POSE_XZ_EPS ||
          Math.abs(z - ringZ[i]) > POSE_XZ_EPS ||
          Math.abs(size - ringSize[i]) > POSE_SIZE_EPS;
        if (needRing) {
          renderer.writeSelectionRing(i, x, z, size, selSpinYaw[i], tintName, { kind: ringKind });
          ringX[i] = x;
          ringZ[i] = z;
          ringSize[i] = size;
          ringTint[i] = tintCode;
        }
      } else {
        selSpinVel[i] = 0;
        if (wasSelected[i]) {
          renderer.writeSelectionRing(i, 0, 0, 0);
          ringX[i] = NaN;
        }
      }
      wasSelected[i] = isSel ? 1 : 0;

      const maxHp = def.hp;
      const hp = world.hp[i];
      if (maxHp > 0 && (isSel || hp < maxHp) && overlayBarAllow[i]) {
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
      // Match gameInput collectBuildingPickSpheres (own structures only).
      const buildingPickRadius = (typeKey) => {
        const fp = BUILDING_FOOTPRINTS[typeKey];
        if (!fp) return 3;
        return 0.5 * Math.hypot(fp.w, fp.h) * TILE_SIZE_F;
      };
      const BUILDING_PICK_MIN_Y = 2.5;
      for (const a of session.agoras ?? []) {
        if ((a.owner | 0) !== localPlayerId) continue;
        const r = buildingPickRadius('agora');
        spheres.push({ x: a.x, y: Math.max(BUILDING_PICK_MIN_Y, r * 0.6), z: a.z, r });
      }
      for (const b of session.buildings ?? []) {
        if ((b.owner | 0) !== localPlayerId) continue;
        const r = buildingPickRadius(b.type);
        spheres.push({ x: b.x, y: Math.max(BUILDING_PICK_MIN_Y, r * 0.6), z: b.z, r });
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
    syncActionRadialTracksFromSim();
    renderer.commit();
  });

  // Engine already started after createRenderer for progressive first paint.
  await renderer.start();

  // Splash logo sits on top while Phase B loads; don't block bootGame return.
  // Fade + unlock once units/buildings settle (scene visible underneath the whole time).
  const unlock = () => {
    if (bootInteractive) return;
    setInteractive(true);
    dismissBootSplash();
  };
  void Promise.race([
    renderer.whenInteractive?.() ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 12000)),
  ]).then(unlock);

  const ctx = {
    session,
    renderer,
    bufs,
    syncRenderer: () => {
      renderEntityCount = rebuildRendererEntities(renderer, session);
      return renderEntityCount;
    },
    inputApi,
    setInteractive,
    kothShard,
    /** When true, ignore KOTH presentation/live stomps (local 1v1 AI). */
    localSoloHold: false,
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
  ctxRef.current = ctx;
  return ctx;
}

async function applyLiveConfig(ctx, cfg, kothShard) {
  const gen = ++liveConfigGeneration;
  const activeSlots = cfg.activeSlots ?? cfg.humanPlayers ?? [];
  const localSolo = !!cfg.localSolo;
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
  if (cfg.mode === 'koth' && DEBUG_KOTH) console.info('[KOTH] applying live config', { gen, activeSlots, localSolo });

  // Cover the teardown/rebuild — same splash as cold boot.
  showMatchSplash();
  ctx.setInteractive?.(false);
  setStatusText(localSolo ? 'Starting 1v1…' : 'Loading match…');

  const simMode = cfg.mode === 'staging' || cfg.mode === 'sandbox' ? 'staging' : 'koth';
  const humanPlayers = cfg.humanPlayers ?? activeSlots;
  if (cfg.aiPlayers) ctx.session.aiPlayers = cfg.aiPlayers;
  ctx.session._pendingWorldGen = gen;
  try {
    await ctx.session.reset({
      seed: cfg.seed,
      mode: simMode,
      activeSlots,
      armyPerSide: cfg.armyPerSide ?? 0,
    });
    // onWorldRebuilt awaited setField; wait for scenery models too.
    await Promise.race([
      ctx.renderer.whenFieldReady?.() ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
  } catch (err) {
    console.error('[live] match rebuild failed', err);
    setStatusText('Match load failed');
    ctx.setInteractive?.(true);
    dismissBootSplash();
    throw err;
  }
  setArmyPerSide(cfg.armyPerSide ?? 0);
  if (gen !== liveConfigGeneration) {
    if (ctx.session._pendingWorldGen === gen) ctx.session._pendingWorldGen = null;
    if (DEBUG_KOTH) console.info('[KOTH] stale live config ignored after reset', { gen, current: liveConfigGeneration });
    // A newer applyLiveConfig owns the splash / input gate.
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
      localSolo,
    });
  }

  // The live world is rebuilt and confirmedTick is back at 0 for this match;
  // seed the lockstep confirm handshake so the sim can leave tick 0.
  // Local 1v1 AI runs offline (delay 0) — no shard handshake.
  if (cfg.mode === 'koth' && !localSolo) kothShard?.notifyLiveSessionReady?.();

  ctx.setInteractive?.(true);
  dismissBootSplash();
}

/**
 * Offline 1v1 vs AI — same two-army KOTH spawn as a real match, no P2P.
 * Exercises the hardened match teardown/rebuild path from the menu.
 * @param {object | null} ctx
 */
async function startSoloAiMatch(ctx) {
  if (!ctx?.session || !ctx.renderer) return;
  if (ctx._soloStarting) return;
  ctx._soloStarting = true;
  ctx.localSoloHold = true;
  try {
    const armyPerSide = ctx.session.state?.armyPerSide ?? 0;
    await applyLiveConfig(ctx, {
      mode: 'koth',
      localSolo: true,
      seed: (Math.random() * 0xffffffff) >>> 0,
      localPlayerId: PLAYER,
      humanPlayers: [PLAYER],
      activeSlots: [PLAYER, AI_OWNER],
      aiPlayers: [AI_OWNER],
      role: 'player',
      reset: true,
      inputEnabled: true,
      armyPerSide,
      matchId: `solo-${Date.now().toString(36)}`,
    }, ctx.kothShard);
    ctx.setMatchMeta?.({ mode: 'solo' });
    setStatusText('1v1 vs AI');
  } catch (err) {
    ctx.localSoloHold = false;
    console.error('[solo] start failed', err);
  } finally {
    ctx._soloStarting = false;
  }
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
  ctx.session.inputDelayTicks = cfg.localSolo ? 0 : cfg.mode === 'koth' ? 1 : 0;
  // Only snap the camera on a real match reset — presentation syncs (join/role)
  // used to call this every time and yank the view back to origin.
  if ((cfg.mode === 'koth' || cfg.localSolo) && cfg.reset) ctx.renderer.resetCamera?.();

  const overEl = document.getElementById('match-over');
  if (overEl) overEl.style.display = 'none';
  ctx.matchOverShown = false;

  ctx.updateColors();
  const label = cfg.localSolo
    ? '1v1 vs AI'
    : cfg.mode === 'staging' || cfg.mode === 'sandbox'
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

function ensureBootSplashEl() {
  let el = document.getElementById('boot-splash');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'boot-splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<img src="./icons/splash.png" alt="" width="512" height="512" decoding="async" />';
  document.body.appendChild(el);
  return el;
}

/** Show splash over the board while a match teardown/rebuild runs. */
function showMatchSplash() {
  const el = ensureBootSplashEl();
  el.classList.remove('is-leaving');
  el.style.opacity = '';
  el.style.pointerEvents = '';
}

function dismissBootSplash() {
  const el = document.getElementById('boot-splash');
  if (!el || el.classList.contains('is-leaving')) return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.remove();
  };
  // Stop eating input immediately; opacity fade is visual only.
  el.style.pointerEvents = 'none';
  el.classList.add('is-leaving');
  el.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 800);
}

function showFallback(msg) {
  dismissBootSplash();
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
