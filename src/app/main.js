// app/ — SimSession (lockstep) + Lite renderer + input.

import { livingByOwner, ORDER, MAX_ENTITIES } from '../sim/world.js';
import { getUnitDef, isFlyer, isTransport, FLY_HEIGHT } from '../sim/unitTypes.js';
import {
  DROP_OFF_TYPES,
  GATHER_ACT,
  campWorkRadiusWorld,
} from '../sim/gather.js';
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
  STRESS_AI_OWNERS,
  STRESS_MENU_PER_SIDE,
} from '../sim/worldSetup.js';
import { resolveSessionAiPlayers, STRESS_AI_PROFILES, stressShareVisionOwners } from '../sim/ai.js';
import { CMD } from '../sim/commands.js';
import { decodeGarden, GARDEN_SESSION_KEY } from '../sim/garden.js';
import { TESTER_GARDEN_URL } from '../sim/testerGarden.js';
import {
  applySerializedBuildingOccupancy,
  BUILDING_FOOTPRINTS,
  buildingHasMenu,
  canPlaceBuildingAt,
  defaultRallyWorld,
  isRallyBeyondBuilding,
  listRallyFlags,
  buildingTrainsOnlyFlyers,
  rallyPathWorldPoints,
  rallySegmentWorldPoints,
  snapBuildingYaw,
  snapBuildingWorld,
  ownedFinishedBuildingTypes,
  getBuildingCost,
  getBuildingRequires,
} from '../sim/buildings.js';
import { menuGateState } from '../sim/menuGate.js';
import { TILE_SIZE_F, worldToTile, setActiveMapSize, SKIRMISH_MAP_W, SKIRMISH_MAP_H } from '../sim/field.js';
import { agoraOverlayActive } from '../sim/agora.js';
import { ownerResourcesFrom } from '../sim/resources.js';
import { formatGameNumber } from '../sim/formatGameNumber.js';
import { createResourceBank } from './resourceBank.js';
import {
  createObserverData,
  namesFromLobbySeats,
  observerSheetOwners,
} from './observerData.js';
import { ownerTint, setLocalOwnerTint } from '../render/ownerTints.js';
import { TECH, TECH_BY_ID } from '../sim/tech.js';
import { createRenderer } from '../render/renderer.js';
import { createFogOfWar } from '../render/fogOfWar.js';
import { shareVisionOwnersFromCfg } from '../render/visionShare.js';
import { selectionGroupsFromBuildings } from '../render/selectionHud.js';
import { createLiteExplorerToggle } from '../render/liteExplorer.js';
import { setupMenu } from './menu.js';
import {
  ensureFxModeDefault,
  ensureShadowModeDefault,
  fxTier,
  getExtraControlGroups,
  getPlayerColor,
  getUnitSkins,
  resolveFxMode,
  resolveShadowMode,
  shadowTier,
} from './settings.js';
import {
  OVERLAY_COLLAR_SPIN_DISTANCE_SQ,
  OVERLAY_MAX_BARS,
  markSelectedThenNearest,
  overlayBarIsFar,
  overlayCameraRef,
} from '../render/overlayLod.js';
import { posePassengerOnTransport, seatsForUnitType } from '../render/transportSeats.js';
import {
  DEFAULT_AGORA_ROOF,
  DEFAULT_BUILDING_ROOF,
  roofChipLift,
  unitChipLift,
} from '../render/healthBars.js';
import { setupInput } from './input.js';
import { isCameraFollowTypingTarget, selectionCentroidXZ } from './input/cameraFollow.js';
import { isControlGroupDoubleTap } from './input/controlGroups.js';
import {
  aggregateBuildingTracks,
  buildingHasWork,
  groupHasUpgradeQueued,
  pickFirstBuiltIndex,
  pickLeastLoadedIndex,
  sameOwnedBuildingType,
} from './input/buildingSelect.js';
import { chasePoseXZ } from './poseInterp.js';
import { init as initAudio, playThunder, thunderPlaysForStrikes } from './audio.js';
import { SimSession, formatHudMatchClock, matchSecondsFromTick } from './simSession.js';
import { createKothShard, kothModeFromSearch } from './kothShard.js';
import { setupKothLobby } from './kothLobby.js';
import { createGameLobby } from './gameLobby.js';
import { createMatchLobby } from './matchLobby.js';
import { setupLobbyUi } from './lobbyUi.js';
import { chapterIdForGardenUrl, chapterLabelFor, gardenUrlForChapter, isLobbyPlayMode } from '../lobby/modes.js';
import { liveConfigFromLobby } from '../lobby/startConfig.js';
import { createMatchStory } from '../story/matchPlay.js';
import { castIndexFromUnits, normalizeSpeaker } from '../story/cast.js';
import { adventureDealSeed, prepareAdventureGarden, snapshotParty } from '../story/party.js';
import {
  createObjectiveHud,
  normalizeObjectives,
  stepObjectives,
} from '../story/objectives.js';
import { createExitMarks } from '../story/exits.js';
import { liveConfigKeepsAdventure, resetAdventureRuntime } from '../story/adventureRuntime.js';
import { CHAPTER_FLUSH_MS, chapterVotesReady, pickCanonicalChapter } from '../story/chapterSync.js';
import { getTeamAssignments, setTeamAssignments } from '../sim/teams.js';
import { aetherSteam } from './steam.js';
import {
  localOwnedPacks,
  selectedSkins,
  setLocalHudSkins,
} from './dlcCatalog.js';
import { SCREENSHOT_HUD_CLASS, createScreenshotHud } from './screenshotHud.js';
import { installNavGuard } from './navGuard.js';

const SEED = 0x1234;

/** `?fog=0` keeps the old no-overlay look; omit to use the scene default. */
function fogOverrideFromSearch(search = location.search) {
  const q = new URLSearchParams(search).get('fog');
  if (q === '0' || q === 'off' || q === 'false') return false;
  if (q === '1' || q === 'on' || q === 'true') return true;
  return null;
}

function loadGardenJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`garden ${res.status}`);
    return res.json();
  });
}

function storyCastFromGarden(garden) {
  if (!garden) return [];
  try {
    const units = Array.isArray(garden.units) ? garden.units : decodeGarden(garden).units;
    return castIndexFromUnits(units);
  } catch {
    return [];
  }
}

function loadTesterGarden() {
  return loadGardenJson(TESTER_GARDEN_URL);
}

async function loadGardenFromSearch(search) {
  const params = new URLSearchParams(search);
  const raw = params.get('garden');
  if (!raw && params.get('tester') === '1') {
    try {
      return await loadTesterGarden();
    } catch (err) {
      console.error('Could not load tester garden', err);
      return null;
    }
  }
  if (!raw) return null;
  try {
    if (raw === 'session' || raw === 'local') {
      const text = sessionStorage.getItem(GARDEN_SESSION_KEY);
      if (!text) throw new Error('no session garden');
      return JSON.parse(text);
    }
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`garden ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Could not load garden', raw, err);
    return null;
  }
}

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
/** Skip fog stamps that would run on the outgoing world during a live config swap. */
let liveConfigQuietFog = false;

function worldPositionsForSync(state, count) {
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = fx.toFloat(state.px[i]);
    z[i] = fx.toFloat(state.py[i]);
  }
  return { x, z };
}

/**
 * @param {(i: number, x: number, z: number, owner: number) => boolean} [hideUnit]
 */
function rebuildRendererEntities(renderer, session, hideUnit) {
  const count = session.count;
  const world = session.state;
  const unmapped = renderer.rebuildFromTypes(count, world.type, world.owner);
  const stillUnmapped = renderer.syncInstances(count, world.type, worldPositionsForSync(world, count), {
    alive: world.alive,
    owners: world.owner,
    carrying: world.carriedAmt,
    gatherAct: world.gatherAct,
    hideUnit,
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

function localSelectedSkins() {
  return selectedSkins(localOwnedPacks(aetherSteam.ownedPacks()), getUnitSkins());
}

function applyOwnerPacksToRenderer(renderer, cfg, localPlayerId) {
  const fromCfg = {};
  const src = cfg?.ownerSkins ?? cfg?.ownerPacks;
  if (src && typeof src === 'object') {
    for (const [owner, value] of Object.entries(src)) fromCfg[owner] = value;
  }
  const local = localSelectedSkins();
  if (localPlayerId >= 0 && fromCfg[localPlayerId] == null && fromCfg[String(localPlayerId)] == null) {
    fromCfg[localPlayerId] = local;
  }
  renderer?.setOwnerSkins?.(fromCfg);
  setLocalHudSkins(fromCfg[localPlayerId] ?? fromCfg[String(localPlayerId)] ?? local);
}

async function main() {
  console.log("©'26 Aether.Garden");
  installNavGuard();
  const canvas = document.getElementById('canvas');
  initAudio();

  if (!(await probeWebGPU())) {
    goAxiom();
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
    if (shouldBootLoadingScreenMatch(bootCfg)) {
      // The loading screen IS the match: small 1v1 vs passive AI, shared vision.
      // `?fog=0` restores the old no-overlay look.
      bootCfg = {
        ...bootCfg,
        mode: 'skirmish',
        localSolo: true,
        role: 'player',
        localPlayerId: PLAYER,
        humanPlayers: [PLAYER],
        activeSlots: [PLAYER, AI_OWNER],
        aiPlayers: [{ owner: AI_OWNER, temperament: 'passive' }],
        fog: fogOverrideFromSearch() ?? true,
        sharedVision: true,
      };
    }
  }

  if (new URLSearchParams(location.search).get('tester') === '1') {
    bootCfg = {
      ...bootCfg,
      mode: 'sandbox',
      localSolo: true,
      role: 'player',
      localPlayerId: PLAYER,
      humanPlayers: [PLAYER],
      activeSlots: [PLAYER, AI_OWNER],
      aiPlayers: [{ owner: AI_OWNER, temperament: 'passive' }],
      fog: fogOverrideFromSearch() ?? true,
      sharedVision: true,
    };
  }

  // ?stress= — FFA combat, but stamp the three attacking AIs onto our fog.
  // The cautious/passive seat stays veiled so we can still see fog work.
  if (stress > 0) {
    bootCfg = {
      ...bootCfg,
      shareVisionWith: stressShareVisionOwners(),
      fog: fogOverrideFromSearch() ?? true,
    };
  }

  ctx = await bootGame(canvas, bootCfg, { stress, animStress, armyPerSide: bootCfg.armyPerSide ?? armyPerSide, kothShard, solo });
  if (pendingLiveCfg) {
    const cfg = pendingLiveCfg;
    pendingLiveCfg = null;
    await applyLiveConfig(ctx, cfg, kothShard);
  }
}

/**
 * True for the plain default cold boot (KOTH staging lobby, local player, no
 * authored map) — the case we replace with the small 1v1 loading-screen match.
 * Live joins, spectators, ?garden= maps, and ?tester=1 (unit-tester) opt out.
 */
function shouldBootLoadingScreenMatch(bootCfg) {
  if (bootCfg.mode !== 'staging' && bootCfg.mode !== 'sandbox') return false;
  if ((bootCfg.role ?? 'player') !== 'player') return false;
  const params = new URLSearchParams(location.search);
  if (params.get('garden')) return false;
  if (params.get('tester') === '1') return false;
  return true;
}

async function bootGame(canvas, bootCfg, { stress, animStress = 0, armyPerSide = 0, kothShard, solo = false }) {
  const skirmish = bootCfg.mode === 'skirmish';
  let kothLobbyUi = { refresh() {} };
  let lobbyUi = { refresh() {} };
  // GPU capacity is sized like a full KOTH match so the shard can still stomp us
  // into a live match. The skirmish backdrop otherwise boots like staging.
  const useNet = bootCfg.mode === 'koth' || bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox' || skirmish;
  const army = bootCfg.armyPerSide ?? armyPerSide ?? 0;

  const session = new SimSession({
    localPlayerId: bootCfg.localPlayerId,
    humanPlayers: bootCfg.humanPlayers,
    aiPlayers: useKothAi(bootCfg, stress, animStress, solo),
    inputDelayTicks: useNet ? 1 : 0,
    role: bootCfg.role ?? 'player',
  });

  let garden = await loadGardenFromSearch(location.search);
  if (garden?.story || garden?.obj) {
    garden = prepareAdventureGarden(garden, {
      humanPlayers: bootCfg.humanPlayers ?? [bootCfg.localPlayerId ?? 0],
      seed: adventureDealSeed(bootCfg.seed ?? 0, garden.s ?? 0),
    });
  }
  const simConfig = {
    seed: garden?.s ?? bootCfg.seed ?? SEED,
    stressPerSide: stress,
    animStressPerSide: animStress,
    armyPerSide: army,
    profileSim: new URLSearchParams(location.search).has('profileSim'),
    garden,
    mode: skirmish
      ? 'skirmish'
      : bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox'
        ? 'staging'
        : bootCfg.mode === 'koth'
          ? 'koth'
          : 'legacy',
    activeSlots: bootCfg.activeSlots ?? [bootCfg.localPlayerId],
    // Skirmish backdrop: smaller Forge-style board with no KOTH center plinth.
    ...(skirmish ? { mapW: SKIRMISH_MAP_W, mapH: SKIRMISH_MAP_H, noCenterBlock: true } : {}),
  };

  const { count, agoras, buildings } = await session.start(simConfig);
  // The sim worker sizes its own field module; the main thread has a separate
  // copy, so mirror the active map dims here or worldToTile / building snap /
  // tile pathability all offset when the board isn't the default size.
  if (session.field) setActiveMapSize(session.field.width, session.field.height);
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
  const bootLocalSkins = localSelectedSkins();
  setLocalHudSkins(bootLocalSkins);
  const renderer = await createRenderer(canvas, count, {
    shadowQuality: shadowTier(bootShadowMode),
    fxMode: bootFxMode,
    fxQuality: fxTier(bootFxMode),
    types: session.state.type,
    owners: session.state.owner,
    ownerSkins: bootCfg.localPlayerId >= 0
      ? { [bootCfg.localPlayerId]: bootLocalSkins }
      : {},
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
  const fog = createFogOfWar();
  /**
   * Set by dumpFrameProfile. Fog used to run on worker onCommit (outside rAF),
   * so `frame` ignored the hitch. Stamp is now once-per-frame after pump.
   */
  let frameProf = null;
  let fogStampDue = false;
  fog.reset(session.field);
  fog.stamp({
    world: session.state,
    buildings: livingBuildingList(session.buildings ?? buildings),
    agoras: session.agoras ?? agoras,
    field: session.field,
    localPlayerId: bootCfg.localPlayerId,
    shareVisionWith: shareVisionOwnersFromCfg(bootCfg),
    enabled:
      bootCfg.fog !== false &&
      (((bootCfg.role ?? 'player') === 'player' && bootCfg.localPlayerId >= 0) ||
        (bootCfg.role ?? 'player') === 'spectator'),
  });
  renderer.attachFogOfWar?.(fog);
  renderer.setVisionDraw?.((x, z, owner) => !fog.hidesHostile(owner, x, z));
  const hideUnitForSync = (_i, x, z, owner) => fog.hidesHostile(owner, x, z);
  {
    const shownA = fog.filterAgoras(agoras ?? session.agoras);
    const shownB = fog.filterBuildings(livingBuildingList(buildings ?? session.buildings));
    fog.commitDisplayLists(shownB, shownA);
    renderer.placeAgoras?.(shownA);
    renderer.placeBuildings?.(shownB);
  }
  // First paint ASAP — props/units/radials continue loading in the background.
  await renderer.start();
  rebuildRendererEntities(renderer, session, hideUnitForSync);
  setStatusText('');
  // Console: renderer.toggleShadows() / renderer.setShadowsEnabled(false)
  window.renderer = renderer;
  window.session = session;
  window.fog = fog;
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
      console.warn('[dumpSimProfile] no timing yet — stress, ?profileSim=1, or setProfileSim(true)');
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
  window.dumpFrameProfile = (frames = 40) => {
    frameProf = {
      left: Math.max(1, frames | 0),
      acc: Object.create(null),
      n: 0,
      nFog: 0,
      inFrame: false,
      pendingOutside: 0,
    };
    console.log('[dumpFrameProfile] sampling', frameProf.left, 'frames… then console.table');
    return frameProf;
  };
  window.setProfileSim = (enabled = true) => {
    session.client?.setProfileSim?.(enabled);
    console.log('[setProfileSim]', enabled ? 'on' : 'off', '— dumpSimProfile() after a few ticks');
  };
  function profAdd(phase, ms) {
    if (!frameProf || !Number.isFinite(ms)) return;
    frameProf.acc[phase] = (frameProf.acc[phase] ?? 0) + ms;
    if (!frameProf.inFrame) frameProf.pendingOutside = (frameProf.pendingOutside ?? 0) + ms;
  }
  function finishFrameProf(t0) {
    if (!frameProf) return;
    frameProf.inFrame = false;
    const now = performance.now();
    const outside = frameProf.pendingOutside ?? 0;
    frameProf.pendingOutside = 0;
    frameProf.acc.frame = (frameProf.acc.frame ?? 0) + (now - t0);
    frameProf.acc.main = (frameProf.acc.main ?? 0) + (now - t0) + outside;
    frameProf.n++;
    frameProf.left--;
    if (frameProf.left > 0) return;
    const n = Math.max(1, frameProf.n);
    const rows = Object.entries(frameProf.acc)
      .map(([phase, ms]) => ({
        phase,
        meanMs: +(ms / n).toFixed(2),
      }))
      .sort((a, b) => b.meanMs - a.meanMs);
    console.table(rows);
    console.log('[dumpFrameProfile]', {
      frames: n,
      fogStamps: frameProf.nFog,
      fps: fpsDisplay,
      note: 'means are per display frame. fog* nest inside frame when stamped after pump.',
    });
    frameProf = null;
  }
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
  renderer.setExtraControlGroups?.(getExtraControlGroups());
  /** Filled just before return so the menu callback can reach the live ctx. */
  const ctxRef = { current: null };
  /** Filled when screenshot HUD is created — settings can lock chrome off. */
  const screenshotHudRef = { current: null };
  const sideMenu = setupMenu({
    renderer,
    onStartSoloAi: () => startSoloAiMatch(ctxRef.current),
    onStartUnitTester: () => startUnitTesterMatch(ctxRef.current),
    onStartStressful: () => startStressfulSituation(ctxRef.current),
    onPlayerColorChange: (hex) => {
      setLocalOwnerTint(localPlayerId, hex);
      updateColors();
      renderer.refreshOwnerTints?.();
      syncWorkRadiusRing();
    },
    onUnitSkinsChange: () => {
      applyOwnerPacksToRenderer(renderer, {}, localPlayerId);
    },
    getHudLocked: () => screenshotHudRef.current?.isLocked() ?? false,
    setHudLocked: (on) => screenshotHudRef.current?.setLocked(on),
  });
  const liteExplorer = createLiteExplorerToggle({
    engine: renderer.engine,
    scene: renderer.scene,
    canvas,
  });
  let renderEntityCount = rebuildRendererEntities(renderer, session, hideUnitForSync);

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
    poseCarrying: new Uint8Array(CAP),
    poseChopping: new Uint8Array(CAP),
    poseAttacking: new Uint8Array(CAP),
    /** Quantized walk-cycle rate (0.05 steps) so slow strolls refresh VAT fps. */
    poseWalkQ: new Uint8Array(CAP),
    poseValid: new Uint8Array(CAP),
    /** Cached terrain height for unchanged xz. */
    cacheGx: new Float32Array(CAP),
    cacheGz: new Float32Array(CAP),
    cacheGy: new Float32Array(CAP),
    /** Deferred health chips: [x, z, lift, ratio] × N (selected first at flush). */
    hbSelected: new Float32Array(CAP * 4),
    hbHurt: new Float32Array(CAP * 4),
    hbSelectedOwner: new Int32Array(CAP),
    hbHurtOwner: new Int32Array(CAP),
    hbSelectedHp: new Int32Array(CAP),
    hbHurtHp: new Int32Array(CAP),
    /** Passenger deck packing for carried units. */
    passengerSlot: new Int32Array(CAP),
    passengerTotalOf: new Int32Array(CAP),
    passengerNextSlot: new Int32Array(CAP),
    /** Overlay LOD: spin allow mask + selected-then-nearest health-bar pick. */
    overlaySpinAllow: new Uint8Array(CAP),
    overlayBarIds: new Int32Array(CAP),
    overlayBarD2: new Float32Array(CAP),
    overlayBarAllow: new Uint8Array(CAP),
    fogHidden: new Uint8Array(CAP),
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
  setLocalOwnerTint(localPlayerId, getPlayerColor());
  let matchMeta = { mode: bootCfg.mode, matchId: bootCfg.matchId };
  let matchOverShown = false;
  let lastRenderDebugAt = 0;

  // Scenario override — loading-screen / unit-tester share vision with the AI.
  // `fog: false` / ?fog=0 still disables the overlay entirely.
  let fogUserEnabled = bootCfg.fog !== false;
  let fogShareVisionWith = shareVisionOwnersFromCfg(bootCfg);
  function fogActive() {
    if (!fogUserEnabled) return false;
    if (session.role === 'spectator') return true;
    return session.role === 'player' && localPlayerId >= 0;
  }
  function setFogEnabled(v) {
    fogUserEnabled = !!v;
    if (session.resetting || liveConfigQuietFog) return;
    stampFog();
    refreshFoggedProps();
  }
  function setShareVisionWith(owners) {
    fogShareVisionWith = Array.isArray(owners) ? owners.map((id) => id | 0) : [];
    if (session.resetting || liveConfigQuietFog) return;
    stampFog();
    refreshFoggedProps();
  }

  const sceneryFogAt = (x, z) => fog.fogFactorAt(x, z);
  let sceneryFogOn = null;
  function stampFog(opts) {
    if (liveConfigQuietFog && !opts?.force) return;
    const t0 = frameProf ? performance.now() : 0;
    try {
      fog.stamp({
        world: session.state,
        buildings: livingBuildingList(session.buildings),
        agoras: session.agoras,
        field: session.field,
        localPlayerId,
        shareVisionWith: fogShareVisionWith,
        enabled: fogActive(),
      });
    } catch (err) {
      console.warn('[fog] stamp failed', err);
      return;
    }
    const t1 = frameProf ? performance.now() : 0;
    // Recolor trees/rocks before syncOverlay — that upload clears the dirty list
    // and marks the overlay painted.
    const on = fog.isEnabled();
    if (on !== sceneryFogOn || (on && fog.overlayNeedsFullPaint?.())) {
      sceneryFogOn = on;
      renderer.applySceneryFog?.(on ? sceneryFogAt : null);
    } else if (on) {
      renderer.applySceneryFogTiles?.(fog.forEachDirtyTile);
    }
    const t2 = frameProf ? performance.now() : 0;
    try {
      fog.syncOverlay();
    } catch (err) {
      console.warn('[fog] overlay upload failed', err);
    }
    const t3 = frameProf ? performance.now() : 0;
    if (frameProf) {
      profAdd('fogStamp', t1 - t0);
      profAdd('fogScenery', t2 - t1);
      profAdd('fogUpload', t3 - t2);
      frameProf.nFog = (frameProf.nFog ?? 0) + 1;
    }
  }

  function stampFogIfDue() {
    if (!fogStampDue) return;
    fogStampDue = false;
    stampFog();
  }

  function syncDrawnEntities() {
    const n = rebuildRendererEntities(renderer, session, hideUnitForSync);
    bufs.poseValid.fill(0);
    return n;
  }

  function livingBuildingList(list) {
    if (!list) return list;
    return list.filter((b) => b.hp == null || (b.hp | 0) > 0);
  }

  function placeFoggedProps(buildingList = session.buildings, agoraList = session.agoras) {
    const shownB = fog.filterBuildings(livingBuildingList(buildingList));
    const shownA = fog.filterAgoras(agoraList);
    fog.commitDisplayLists(shownB, shownA);
    renderer.placeAgoras?.(shownA);
    void renderer.placeBuildings?.(shownB);
  }

  function refreshFoggedProps() {
    const shownB = fog.filterBuildings(livingBuildingList(session.buildings));
    const shownA = fog.filterAgoras(session.agoras);
    if (!fog.commitDisplayLists(shownB, shownA)) return;
    renderer.placeAgoras?.(shownA);
    void renderer.placeBuildings?.(shownB);
  }

  let agoraOwnerPaintSig = '';
  function syncAgoraOwnerPaint() {
    const list = session.agoras;
    let sig = '';
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        sig += `${a.owner}:${a.founder ?? a.owner}|`;
      }
    }
    if (sig === agoraOwnerPaintSig) return;
    agoraOwnerPaintSig = sig;
    placeFoggedProps();
  }

  const updateColors = () => {
    const world = session.state;
    const { selected, deathFade, colors } = bufs;
    for (let i = 0; i < session.count; i++) {
      const fade = deathFade[i];
      if (!world.alive[i] && fade <= 0) {
        colors[i * 4 + 3] = 0;
        continue;
      }
      // TeamColor parts read this as a solid owner swatch; other parts stay white.
      const c = ownerTint(world.owner[i]);
      const alpha = world.alive[i] ? 1 : fade;
      colors[i * 4] = c[0];
      colors[i * 4 + 1] = c[1];
      colors[i * 4 + 2] = c[2];
      colors[i * 4 + 3] = alpha;
    }
    renderer.setColors(colors);
    paintStatus();
  };

  function resetTableClient() {
    matchOverShown = false;
    const overEl = document.getElementById('match-over');
    if (overEl) overEl.style.display = 'none';
    releaseSpaceFollow();
    applyPlacingType(null);
    endRallyPlacement();
    closeRadial();
    selectedBuildings = [];
    lastAgoraIndex = -1;
    lastAgoraHotkeyTap = null;
    ghostPathTileKey = -1;
    ghostPathPoints = null;
    agoraOwnerPaintSig = '';
    sceneryFogOn = null;
    inputApi?.clearSelection?.();
    inputApi?.clearControlGroups?.();
    renderer.clearSelectionRings?.();
    renderer.setSelectionGroups?.([]);
    syncBuildingHighlight(null);
    renderer.setWorkRadiusRing?.(null);
    renderer.setBuildingGhost?.(null);
    renderer.setRallyGhost?.(null);
    renderer.placeRallyFlags?.([]);
    renderer.setObjectiveRings?.(null);
    bufs.selected.fill(0);
    bufs.wasSelected.fill(0);
    bufs.wasAlive.fill(1);
    bufs.deathFade.fill(0);
    bufs.facingYaw.fill(0);
    bufs.selSpinYaw.fill(0);
    bufs.selSpinVel.fill(0);
    bufs.poseValid.fill(0);
    bufs.cacheGx.fill(NaN);
    bufs.cacheGz.fill(NaN);
    bufs.cacheGy.fill(NaN);
    bufs.ringX.fill(NaN);
    bufs.ringZ.fill(NaN);
    bufs.ringSize.fill(0);
    bufs.ringTint.fill(0);
    bufs.fogHidden.fill(0);
  }

  session.onWorldRebuilt = async (entityCount) => {
    if (session._pendingWorldGen != null && session._pendingWorldGen !== liveConfigGeneration) return;
    // Map dims may change across a rebuild (skirmish ↔ koth) — mirror them before
    // any main-thread tile math (fog, snap, pathability) runs.
    if (session.field) setActiveMapSize(session.field.width, session.field.height);
    renderer.setCount(entityCount);
    renderer.clearProjectiles?.();
    renderer.clearParticles?.();
    resetTableClient();
    fog.reset(session.field);
    // Stamp only after setField rebuilds the overlay — uploading a 208-tile
    // 1v1 veil into the outgoing stress texture is what made the swap look insane.
    if (session.field) await renderer.setField?.(session.field);
    stampFog({ force: true });
    renderEntityCount = syncDrawnEntities();
    placeFoggedProps();
    syncRallyFlagMarkers();
    sceneryFogOn = null;
    if (fog.isEnabled()) {
      sceneryFogOn = true;
      renderer.applySceneryFog?.(sceneryFogAt);
    }
    updateColors();
  };

  session.onBuildingsChanged = (list) => {
    if (session.field) {
      applySerializedBuildingOccupancy(session.field, list);
      renderer.refreshTileGrid?.();
    }
    const shownB = fog.filterBuildings(livingBuildingList(list));
    fog.commitDisplayLists(shownB, fog.filterAgoras(session.agoras));
    renderer.placeBuildings?.(shownB);
    syncRallyFlagMarkers(list);
    syncRadialMenuGate();
    if (actionBuildingIndex >= 0) {
      const live = liveActionIndices(list);
      if (!live.length) closeRadial();
      else if (!live.includes(actionBuildingIndex)) {
        openActionRadialForBuilding(live[0], actionBuildingIndices);
      }
    }
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

  function paintStatusClock() {
    const timeEl = document.getElementById('status-time');
    if (!timeEl) return;
    const clock = formatHudMatchClock(matchSecondsFromTick(session.confirmedTick));
    if (timeEl.textContent !== clock) timeEl.textContent = clock;
  }

  function paintStatusPop() {
    const el = document.getElementById('status-pop');
    if (!el) return;
    const observing = session.role === 'spectator' || localPlayerId < 0;
    const next = observing ? '' : formatGameNumber(livingByOwner(session.state, localPlayerId));
    if (el.textContent !== next) el.textContent = next;
  }

  function paintStatusSide() {
    const sideEl = document.getElementById('status-side');
    if (!sideEl) return;
    const bits = [];
    if (fpsDisplay > 0) bits.push(`${fpsDisplay}ƒ`);
    const rtt = kothShard?.getRttMs?.();
    if (rtt != null) bits.push(`${rtt}∾`);
    const next = bits.join(' ');
    if (sideEl.textContent !== next) sideEl.textContent = next;
  }

  function paintStatus() {
    paintStatusClock();
    paintStatusPop();
    paintStatusSide();
    kothLobbyUi.refresh();
    lobbyUi.refresh();
    paintResources();
  }

  const resourceBank = createResourceBank();
  resourceBank.mount().catch((err) => {
    console.warn('resource bank icons failed', err);
  });
  const observerData = createObserverData();
  observerData.mount().then(() => paintResources()).catch((err) => {
    console.warn('observer data failed', err);
  });
  let observerLobby = null;

  function formatResourceBank(r) {
    return `Wood ${formatGameNumber(r.wood)}  ·  Stone ${formatGameNumber(r.stone)}  ·  Mineral ${formatGameNumber(r.mineral)}  ·  Food ${formatGameNumber(r.food)}`;
  }

  function paintResources() {
    const rEl = document.getElementById('resources');
    if (!rEl) return;
    const localBank = ownerResourcesFrom(session.resources, localPlayerId);
    const observing = session.role === 'spectator' || localPlayerId < 0;
    const sheetOwners = observerSheetOwners({
      observing,
      localId: localPlayerId,
      session,
      shareWith: fogShareVisionWith,
    });
    const showSheet = sheetOwners.length > 0;
    const showIcons = resourceBank.ready && !observing;
    if (showIcons) {
      resourceBank.paint({
        bank: localBank,
        buildings: session.buildings,
        owner: localPlayerId,
      });
    } else {
      resourceBank.paint({ hidden: true, bank: localBank, buildings: session.buildings, owner: localPlayerId });
    }
    observerData.paint({
      hidden: !showSheet,
      resources: session.resources,
      buildings: session.buildings,
      agoras: session.agoras,
      world: session.state,
      owners: sheetOwners,
      names: namesFromLobbySeats(observerLobby?.getState?.()?.seats),
      computers: session.aiPlayers,
    });
    // Observer sheet owns other-army banks. The old bottom dump is gone
    // whenever the sheet is up (shared-vision AI / spectator).
    let next = '';
    if (!showSheet && !observing && !showIcons) {
      next = formatResourceBank(localBank);
    }
    if (rEl.textContent !== next) rEl.textContent = next;
  }

  function ownedBuildingTypesFor(owner = localPlayerId) {
    return ownedFinishedBuildingTypes(session.buildings, owner);
  }

  function syncRadialMenuGate() {
    renderer.setRadialMenuGate?.({
      bank: ownerResourcesFrom(session.resources, localPlayerId),
      ownedTypes: ownedBuildingTypesFor(localPlayerId),
    });
  }

  /**
   * Ground rings showing gather reach for every drop-off of the selected type
   * (same owner). Engineers extend each ring independently, matching the sim.
   */
  function syncWorkRadiusRing() {
    const buildings = session.buildings;
    const keys = new Set();
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (sel.kind !== 'building') continue;
      const b = buildings?.[sel.index];
      if (!b || (b.owner | 0) !== localPlayerId) continue;
      if (b.built === 0 || !DROP_OFF_TYPES.has(b.type)) continue;
      keys.add(`${b.owner}:${b.type}`);
    }
    if (keys.size === 0) {
      renderer.setWorkRadiusRing?.(null);
      return;
    }
    const st = session.state;
    const rings = [];
    for (let i = 0; i < (buildings?.length ?? 0); i++) {
      const b = buildings[i];
      if (!b || b.built === 0 || !keys.has(`${b.owner}:${b.type}`)) continue;
      rings.push({ x: b.x, z: b.z, radius: campWorkRadiusWorld(st, b), owner: b.owner });
    }
    renderer.setWorkRadiusRing?.(rings);
  }

  updateColors();

  /** @type {string | null} */
  let placingType = null;
  /** True while setting a production building's train rally with the flag cursor. */
  let placingRally = false;
  /** @type {{ kind: 'agora' | 'building', index: number }[]} */
  let selectedBuildings = [];
  /** Space held: camera zips to / locks on the current selection. */
  let spaceFollowHeld = false;

  function selectionFollowPoint() {
    return selectionCentroidXZ({
      count: session.count,
      selected: bufs.selected,
      alive: session.state?.alive,
      renderX: bufs.renderX,
      renderZ: bufs.renderZ,
      selectedBuildings,
      buildings: session.buildings,
      agoras: session.agoras,
    });
  }

  function pushSelectionFollow() {
    if (!spaceFollowHeld) return;
    const c = selectionFollowPoint();
    if (!c) {
      renderer.cameraController?.stopFollow?.();
      return;
    }
    renderer.cameraController?.followXZ?.(c.x, c.z);
  }

  function releaseSpaceFollow() {
    spaceFollowHeld = false;
    renderer.cameraController?.stopFollow?.();
  }
  /** Ghost A* cache — repath only when the cursor enters a new tile. */
  let ghostPathTileKey = -1;
  /** @type {{ x: number, z: number }[] | null} */
  let ghostPathPoints = null;

  session.onResourcesChanged = () => {
    paintResources();
    syncRadialMenuGate();
  };

  session.onStorageOverflow = (events) => {
    if (session.role === 'spectator' || localPlayerId < 0) return;
    resourceBank.flashOverflow(events, localPlayerId);
  };

  session.onTechChanged = () => {
    ghostPathTileKey = -1;
    ghostPathPoints = null;
    syncRallyFlagMarkers();
    syncActionRadialResearch();
    syncRadialMenuGate();
  };

  function rallyPathOptsForOwner(owner) {
    return ownerHasDrayage(owner) ? { slowAware: true } : null;
  }

  function rallyMarkerFor(b, rx, rz, fromX, fromZ, points, attackMove) {
    return {
      x: rx,
      z: rz,
      fromX: fromX ?? b.x,
      fromZ: fromZ ?? b.z,
      points,
      yaw: b.yaw ?? 0,
      owner: b.owner | 0,
      attackMove: !!attackMove,
    };
  }

  function rallyChainMarkers(b) {
    const flags = listRallyFlags(b);
    if (!flags.length) return [];
    const pathOpts = rallyPathOptsForOwner(b.owner);
    const air = buildingTrainsOnlyFlyers(b.type);
    /** @type {ReturnType<typeof rallyMarkerFor>[]} */
    const markers = [];
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i];
      const fromX = i === 0 ? b.x : flags[i - 1].x;
      const fromZ = i === 0 ? b.z : flags[i - 1].z;
      const points =
        i === 0
          ? rallyPathWorldPoints(session.field, b, f.x, f.z, pathOpts)
          : rallySegmentWorldPoints(session.field, fromX, fromZ, f.x, f.z, {
              ...pathOpts,
              air,
            });
      markers.push(
        rallyMarkerFor(
          b,
          f.x,
          f.z,
          fromX,
          fromZ,
          points,
          (f.order | 0) === ORDER.ATTACK_MOVE,
        ),
      );
    }
    return markers;
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
    const seen = new Set();
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      if (sel?.kind !== 'building' && sel?.kind !== 'rally') continue;
      const bi = sel.index | 0;
      if (seen.has(bi)) continue;
      seen.add(bi);
      const b = buildings[bi];
      if (!b?.hasRally || (b.owner | 0) !== localPlayerId) continue;
      const chain = rallyChainMarkers(b);
      for (let k = 0; k < chain.length; k++) markers.push(chain[k]);
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
      return a ? { x: a.x, z: a.z, size: /** @type {const} */ ('m') } : null;
    }
    if (sel.kind === 'rally') {
      const b = session.buildings?.[sel.index];
      if (!b) return null;
      const flags = listRallyFlags(b);
      const f = flags.find((x) => x.hop === (sel.hop | 0));
      return f ? { x: f.x, z: f.z, size: /** @type {const} */ ('s') } : null;
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
    syncRadialMenuGate();
    renderer.showBuildingRadial?.(a.x, a.z, a.owner);
  }

  function pickOwnedAgoraIndex(preferred = lastAgoraIndex) {
    const list = session.agoras ?? [];
    let fallback = -1;
    for (let i = 0; i < list.length; i++) {
      if ((list[i]?.owner | 0) !== localPlayerId) continue;
      if (i === preferred) return i;
      if (fallback < 0) fallback = i;
    }
    return fallback;
  }

  /** Last B / ~ tap — second press in the control-group window jumps the camera. */
  let lastAgoraHotkeyTap = null;

  function jumpCameraToOwnedAgora(index) {
    const a = session.agoras?.[index];
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) return;
    renderer.cameraController?.lookAtXZ?.(a.x, a.z);
  }

  function openOwnAgoraMenu() {
    if (!bootInteractive) return;
    if ((session.role ?? 'player') !== 'player' || localPlayerId < 0) return;
    const index = pickOwnedAgoraIndex();
    if (index < 0) return;
    if (placingType) applyPlacingType(null);

    const now = performance.now();
    const jump = isControlGroupDoubleTap(lastAgoraHotkeyTap, 'agora', now);
    lastAgoraHotkeyTap = { id: 'agora', t: now };

    if (jump) {
      inputApi.setSelectedBuilding?.({ kind: 'agora', index });
      jumpCameraToOwnedAgora(index);
      return;
    }

    if (renderer.isBuildingRadialOpen?.() && lastAgoraIndex === index) {
      closeRadial();
      return;
    }
    inputApi.setSelectedBuilding?.({ kind: 'agora', index });
  }

  /** Selected placeable driving the action radial (for train / cancel cmds). */
  let actionBuildingIndex = -1;
  /** Same-type group the open action radial represents. */
  /** @type {number[]} */
  let actionBuildingIndices = [];

  function liveActionIndices(list = session.buildings) {
    const src = actionBuildingIndices.length
      ? actionBuildingIndices
      : actionBuildingIndex >= 0
        ? [actionBuildingIndex]
        : [];
    /** @type {number[]} */
    const out = [];
    const seen = new Set();
    for (let k = 0; k < src.length; k++) {
      const i = src[k] | 0;
      if (seen.has(i)) continue;
      const b = list?.[i];
      if (!b || (b.hp != null && (b.hp | 0) <= 0)) continue;
      seen.add(i);
      out.push(i);
    }
    return out;
  }

  /** Push sim building tracks onto the open action radial. */
  function syncActionRadialTracksFromSim() {
    if (!renderer.isActionRadialOpen?.() || actionBuildingIndex < 0) return;
    const indices = liveActionIndices();
    if (!indices.length) {
      closeRadial();
      return;
    }
    if (!indices.includes(actionBuildingIndex)) {
      actionBuildingIndex = indices[0];
      const next = session.buildings?.[actionBuildingIndex];
      if (next) renderer.showActionRadial?.(next.x, next.z, next.type);
    }
    const b = session.buildings?.[actionBuildingIndex];
    if (!b) {
      closeRadial();
      return;
    }
    const tracks = aggregateBuildingTracks(
      indices,
      session.buildings,
      actionBuildingIndex,
    );
    renderer.setActionRadialTracks?.(tracks);
    let anyWork = false;
    let anyUnpaused = false;
    let anySite = false;
    for (let k = 0; k < indices.length; k++) {
      const site = session.buildings?.[indices[k]];
      if (!site) continue;
      if (site.built === 0) anySite = true;
      if (buildingHasWork(site)) {
        anyWork = true;
        if (!site.prodPaused) anyUnpaused = true;
      }
    }
    renderer.setActionRadialPaused?.(anyWork && !anyUnpaused);
    renderer.setActionRadialUtilityAvailability?.({
      cancel: anyWork || anySite,
      pause: anyWork,
    });
    syncActionRadialResearch();
  }

  function openActionRadialForBuilding(index, indices) {
    const b = session.buildings?.[index];
    if (!b || (!buildingHasMenu(b.type) && b.built !== 0)) {
      closeRadial();
      return;
    }
    actionBuildingIndex = index;
    actionBuildingIndices = (indices?.length ? indices : [index]).slice();
    renderer.hideBuildingRadial?.();
    syncRadialMenuGate();
    renderer.showActionRadial?.(b.x, b.z, b.type);
    syncActionRadialTracksFromSim();
  }

  function closeRadial() {
    actionBuildingIndex = -1;
    actionBuildingIndices = [];
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

  // Locked until boot/match ready — camera + commands stay quiet together.
  let bootInteractive = false;
  let menuUnlocked = false;
  const setInteractive = (on) => {
    bootInteractive = !!on;
    // Menu button: hide only for cold boot, not match-load splash.
    if (bootInteractive && !menuUnlocked) {
      menuUnlocked = true;
      sideMenu.setAvailable?.(true);
      document.getElementById('header')?.classList.add('map-ready');
      setGraffitiHeaderVisible(isLobbyGraffitiScene(bootCfg.mode));
    }
  };
  let storyCast = storyCastFromGarden(garden);
  const SPEECH_LIFT = 2.4;
  function getStorySpeakerPos(name) {
    const key = normalizeSpeaker(name);
    if (!key) return null;
    const entry = storyCast.find((c) => normalizeSpeaker(c.name) === key);
    if (!entry) return null;
    const i = entry.index | 0;
    const world = session.state;
    const n = world?.count | 0;
    if (world && i >= 0 && i < n) {
      const live = bufs.poseValid?.[i];
      const x = live ? bufs.renderX[i] : fx.toFloat(world.px[i]);
      const z = live ? bufs.renderZ[i] : fx.toFloat(world.py[i]);
      const y = live ? bufs.renderY[i] + SPEECH_LIFT : SPEECH_LIFT;
      if (Number.isFinite(x) && Number.isFinite(z)) return { x, y, z };
    }
    const field = session.field;
    if (field && Number.isFinite(entry.tx)) {
      const half = field.worldHalfF ?? (field.width * TILE_SIZE_F) / 2;
      return {
        x: (entry.tx + 0.5) * TILE_SIZE_F - half,
        y: SPEECH_LIFT,
        z: (entry.tz + 0.5) * TILE_SIZE_F - half,
      };
    }
    return null;
  }
  const matchStory = createMatchStory({
    getCamera: () => renderer.cameraController,
    getField: () => session.field,
    getSpeakerPos: getStorySpeakerPos,
    worldToScreen: (x, y, z) => renderer.worldToScreen?.(x, y, z) ?? null,
  });
  if (garden?.story) matchStory.playIntro(garden.story);
  const objectiveHud = createObjectiveHud(document.body);
  const exitMarks = createExitMarks({
    host: document.body,
    worldToScreen: (x, y, z) => renderer.worldToScreen?.(x, y, z) ?? null,
  });

  function syncExitMarks(hidden) {
    const rings = exitMarks.set(adventureObjectives, session.field, { hidden });
    renderer.setObjectiveRings?.(hidden ? null : rings);
  }
  let adventureObjectives = [];
  let adventureStory = garden?.story || null;
  let carriedParty = null;
  let carriedBank = null;
  let chapterWon = false;
  let chapterAdvanceBusy = false;
  let pendingChapterUrl = null;
  let objectivesArmedAt = 0;
  const chapterVotes = new Map();
  let chapterVoteUrl = '';
  let chapterProposeSent = false;
  let chapterFlushTimer = null;

  function gardenObjectivesOf(g) {
    if (!g) return [];
    if (Array.isArray(g.objectives)) return normalizeObjectives(g.objectives);
    try {
      return normalizeObjectives(decodeGarden(g).objectives);
    } catch {
      return [];
    }
  }

  function captureAdventureParty() {
    const humans = session.humanPlayers?.length ? session.humanPlayers : [localPlayerId];
    carriedParty = snapshotParty(session.state, storyCast, humans);
    const flat = session.resources;
    const id = Math.min(...humans.map((h) => h | 0));
    carriedBank = (flat && flat.length >= (id + 1) * 4)
      ? ownerResourcesFrom(flat, id)
      : null;
  }

  function takeCarriedParty() {
    const out = { party: carriedParty || [], bank: carriedBank };
    carriedParty = null;
    carriedBank = null;
    return out;
  }

  function noteChapterVote(payload) {
    if (!payload?.url) return;
    if (chapterVoteUrl && payload.url !== chapterVoteUrl) chapterVotes.clear();
    chapterVoteUrl = payload.url;
    chapterVotes.set(payload.playerId | 0, payload);
  }

  function adventureLobby() {
    return ctxRef.current?.matchLobby || observerLobby;
  }

  function adventureSessionLive() {
    return Boolean(ctxRef.current?.adventureLive);
  }

  function tryFlushChapter() {
    if (!adventureSessionLive()) return;
    const humans = session.humanPlayers?.length ? session.humanPlayers : [localPlayerId];
    if (!chapterVotesReady(chapterVotes, humans) || chapterAdvanceBusy || chapterFlushTimer) return;
    const picked = pickCanonicalChapter(chapterVotes);
    if (!picked?.url) return;
    const lobby = adventureLobby();
    lobby?.detachSession?.();
    session.pauseLockstep = true;
    session.simAcc = 0;
    setStatusText('Next chapter…');
    chapterFlushTimer = setTimeout(() => {
      chapterFlushTimer = null;
      chapterVotes.clear();
      chapterVoteUrl = '';
      if (picked.epoch != null) lobby?.setLockstepEpoch?.(picked.epoch | 0);
      void ctxAdvanceChapter?.(picked.url, picked);
    }, CHAPTER_FLUSH_MS);
  }

  function proposeChapterAdvance(url) {
    if (!adventureSessionLive()) return;
    if (!url) {
      setStatusText('Adventure complete');
      return;
    }
    if (chapterProposeSent && chapterVoteUrl === url) {
      tryFlushChapter();
      return;
    }
    chapterProposeSent = true;
    pendingChapterUrl = null;
    const humans = session.humanPlayers?.length ? session.humanPlayers : [localPlayerId];
    const lobby = adventureLobby();
    if (humans.length < 2 || !lobby) {
      void ctxAdvanceChapter?.(url);
      return;
    }
    const payload = {
      url,
      playerId: localPlayerId | 0,
      party: carriedParty || [],
      bank: carriedBank,
      epoch: (lobby.getLockstepEpoch?.() | 0) + 1,
    };
    noteChapterVote(payload);
    lobby.sendChapter?.(payload);
    setStatusText('Waiting for party…');
    tryFlushChapter();
  }

  function beginAdventure(g) {
    adventureStory = g?.story || null;
    adventureObjectives = gardenObjectivesOf(g);
    chapterWon = false;
    chapterAdvanceBusy = false;
    pendingChapterUrl = null;
    chapterVotes.clear();
    chapterVoteUrl = '';
    chapterProposeSent = false;
    if (chapterFlushTimer) {
      clearTimeout(chapterFlushTimer);
      chapterFlushTimer = null;
    }
    objectivesArmedAt = (typeof performance !== 'undefined' ? performance.now() : 0) + 800;
    objectiveHud.set(adventureObjectives, { hidden: true });
    syncExitMarks(true);
    const live = ctxRef.current?.adventureLive;
    paintCornerMark(chapterLabelFor({
      chapter: live?.chapter,
      gardenUrl: live?.gardenUrl,
      name: g?.n || g?.name,
    }) || 'Ch');
  }

  function endAdventure() {
    const next = resetAdventureRuntime({
      story: adventureStory,
      objectives: adventureObjectives,
      carriedParty,
      carriedBank,
      chapterWon,
      chapterAdvanceBusy,
      pendingChapterUrl,
      objectivesArmedAt,
      chapterVotes,
      chapterVoteUrl,
      chapterProposeSent,
      chapterFlushTimer,
    });
    adventureStory = next.story;
    adventureObjectives = next.objectives;
    carriedParty = next.carriedParty;
    carriedBank = next.carriedBank;
    chapterWon = next.chapterWon;
    chapterAdvanceBusy = next.chapterAdvanceBusy;
    pendingChapterUrl = next.pendingChapterUrl;
    objectivesArmedAt = next.objectivesArmedAt;
    chapterVoteUrl = next.chapterVoteUrl;
    chapterProposeSent = next.chapterProposeSent;
    chapterFlushTimer = next.chapterFlushTimer;
    matchStory.stop();
    storyCast = [];
    objectiveHud.hide();
    exitMarks.hide();
    renderer.setObjectiveRings?.(null);
    if (ctxRef.current) ctxRef.current.adventureLive = null;
    paintCornerMark('');
  }

  function collectObjectiveUnits() {
    const world = session.state;
    const n = world?.count | 0;
    const humans = session.humanPlayers?.length ? session.humanPlayers : [localPlayerId];
    const allow = new Set(humans);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!world.alive?.[i]) continue;
      if (allow.size && !allow.has(world.owner[i])) continue;
      const def = getUnitDef(world.type[i]);
      out.push({
        x: fx.toFloat(world.px[i]),
        z: fx.toFloat(world.py[i]),
        named: storyCast.some((c) => (c.index | 0) === i),
        civilian: def.category === 'civilian',
      });
    }
    return out;
  }

  function tickAdventureObjectives() {
    if (!adventureObjectives.length || chapterWon || chapterAdvanceBusy) {
      objectiveHud.set(adventureObjectives, { hidden: true });
      syncExitMarks(true);
      return;
    }
    if (session.resetting || matchStory.driving()) {
      objectiveHud.set(adventureObjectives, { hidden: true });
      syncExitMarks(true);
      return;
    }
    if (objectivesArmedAt && performance.now() < objectivesArmedAt) {
      objectiveHud.set(adventureObjectives, { hidden: true });
      syncExitMarks(true);
      return;
    }
    const result = stepObjectives(adventureObjectives, collectObjectiveUnits(), session.field);
    objectiveHud.set(adventureObjectives);
    syncExitMarks(false);
    if (result.just.length && result.just[0].message) {
      setStatusText(result.just[0].message);
    }
    if (!result.chapterWin) return;
    chapterWon = true;
    captureAdventureParty();
    const next = result.next || '';
    if (matchStory.playWin(adventureStory)) {
      pendingChapterUrl = next;
      return;
    }
    if (next) pendingChapterUrl = next;
    else {
      setStatusText('Adventure complete');
      objectiveHud.set(adventureObjectives);
    }
  }

  if (garden?.story || gardenObjectivesOf(garden).length) beginAdventure(garden);
  let ctxAdvanceChapter = null;

  let inputApi = setupInput({
    canvas,
    renderer,
    inputActive: () => bootInteractive,
    world: () => session.state,
    selected: bufs.selected,
    localPlayerId,
    isUnitVisible: (i) => !bufs.fogHidden[i],
    isStructureVisible: (owner, x, z) => !fog.hidesHostile(owner, x, z),
    getUnitWorldPos: (i, out) => {
      out.x = bufs.renderX[i];
      out.y = bufs.renderY[i];
      out.z = bufs.renderZ[i];
      return out;
    },
    enqueueCommand: (cmd) => session.submitCommand(cmd),
    onSelectionChanged: updateColors,
    onControlGroupJump: () => {
      const c = selectionFollowPoint();
      if (!c) return;
      renderer.cameraController?.lookAtXZ?.(c.x, c.z);
    },
    onOrder: (x, z, y, cmdType, tile, extra) => {
      if (cmdType === CMD.GATHER) {
        renderer.pingHarvestTarget?.(tile);
        const arrowCmd = extra?.arrow;
        if (arrowCmd !== CMD.ATTACK_MOVE && arrowCmd !== CMD.MOVE) return;
        cmdType = arrowCmd;
      }
      const tint = cmdType === CMD.ATTACK_MOVE ? 'red' : 'white';
      renderer.pingOrderMarker?.(x, z, y, tint, { forceMove: cmdType === CMD.MOVE });
    },
    onAbilityHold: null,
    canInteract: () =>
      session.role === 'player' && localPlayerId >= 0 && !session.pauseLockstep && !matchStory.driving(),
    getAgoras: () => session.agoras ?? [],
    getBuildings: () => session.buildings ?? [],
    getField: () => session.field ?? null,
    onBuildingSelected: (sel, _ptr, all) => {
      const list = all ?? (sel ? [sel] : null);
      selectedBuildings = list ? list.slice() : [];
      syncBuildingHighlight(list);
      syncRallyFlagMarkers();
      syncWorkRadiusRing();
      if (sel && list && list.length === 1 && sel.kind === 'agora') {
        const a = session.agoras?.[sel.index];
        if (a && (a.owner | 0) === localPlayerId) {
          openRadialForAgora(sel.index);
          return;
        }
      }
      if (sel && list) {
        const group = sameOwnedBuildingType(list, session.buildings, localPlayerId);
        if (group) {
          const primary =
            sel.kind === 'building' && group.indices.includes(sel.index | 0)
              ? sel.index | 0
              : group.indices[0];
          openActionRadialForBuilding(primary, group.indices);
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
        buildingIndices: liveActionIndices(),
        tx: fx.fromFloat(x),
        ty: fx.fromFloat(z),
        order: ORDER.ATTACK_MOVE,
      });
      endRallyPlacement();
      openActionRadialForBuilding(actionBuildingIndex, actionBuildingIndices);
      renderer.pingOrderMarker?.(x, z, undefined, 'red', { forceMove: false });
    },
    clearRallyPlacement: () => {
      endRallyPlacement();
    },
    onRallyCancel: () => {
      const bi = actionBuildingIndex;
      const group = actionBuildingIndices.slice();
      endRallyPlacement();
      if (bi >= 0) openActionRadialForBuilding(bi, group);
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
        const target = pickLeastLoadedIndex(liveActionIndices(), session.buildings);
        if (target < 0) return;
        session.submitCommand({
          type: CMD.QUEUE_TRAIN,
          playerId: localPlayerId,
          buildingIndex: target,
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
        const group = liveActionIndices();
        if (groupHasUpgradeQueued(group, session.buildings, techId)) return;
        const target = pickFirstBuiltIndex(group, session.buildings);
        if (target < 0) return;
        session.submitCommand({
          type: CMD.RESEARCH,
          playerId: localPlayerId,
          buildingIndex: target,
          techId,
        });
        return;
      }
      if (picked.kind === 'pause') {
        const group = liveActionIndices();
        let anyWork = false;
        let anyUnpaused = false;
        for (let k = 0; k < group.length; k++) {
          const site = session.buildings?.[group[k]];
          if (!buildingHasWork(site)) continue;
          anyWork = true;
          if (!site.prodPaused) anyUnpaused = true;
        }
        if (!anyWork || localPlayerId < 0) return;
        renderer.setActionRadialArmed?.(null);
        const paused = anyUnpaused ? 1 : 0;
        for (let k = 0; k < group.length; k++) {
          const i = group[k];
          if (!buildingHasWork(session.buildings?.[i])) continue;
          session.submitCommand({
            type: CMD.PAUSE_TRAIN,
            playerId: localPlayerId,
            buildingIndex: i,
            paused,
          });
        }
        return;
      }
      if (picked.kind === 'cancel') {
        const group = liveActionIndices();
        const tracks = renderer.getActionRadialTracks?.() ?? {};
        const hasWork = Object.values(tracks).some(
          (t) =>
            (t?.count | 0) > 0 ||
            (t?.extra | 0) > 0 ||
            (t?.progress ?? 0) > 0,
        );
        let anySite = false;
        for (let k = 0; k < group.length; k++) {
          const site = session.buildings?.[group[k]];
          if (site?.built === 0 && (site.hp == null || (site.hp | 0) > 0)) {
            anySite = true;
            break;
          }
        }
        if (!hasWork && !anySite) return;
        if (renderer.getActionRadialArmed?.() === 'cancel') {
          if (localPlayerId >= 0) {
            for (let k = 0; k < group.length; k++) {
              const i = group[k];
              const site = session.buildings?.[i];
              if (!site) continue;
              const isSite =
                site.built === 0 && (site.hp == null || (site.hp | 0) > 0);
              if (isSite) {
                session.submitCommand({
                  type: CMD.CANCEL_CONSTRUCTION,
                  playerId: localPlayerId,
                  buildingIndex: i,
                });
              } else if (buildingHasWork(site)) {
                session.submitCommand({
                  type: CMD.CANCEL_TRAIN,
                  playerId: localPlayerId,
                  buildingIndex: i,
                });
              }
            }
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
        if (
          menuGateState({
            cost: getBuildingCost(picked.id),
            requires: getBuildingRequires(picked.id),
            bank: ownerResourcesFrom(session.resources, localPlayerId),
            ownedTypes: ownedBuildingTypesFor(localPlayerId),
          }) === 'locked'
        ) {
          return;
        }
        // Keep the agora radial open while ghost-placing / switching types.
        applyPlacingType(picked.id);
        placingYaw = 0;
        renderer.setBuildingGhost?.(null);
      }
    },
    onRadialHover: (cx, cy) =>
      renderer.hoverBuildingRadial?.(cx, cy, !placingType),
    hitRadial: (cx, cy) => renderer.hitBuildingRadial?.(cx, cy) ?? false,
    hitRadialHub: (cx, cy) => renderer.hitBuildingRadialHub?.(cx, cy) ?? false,
  });

  const screenshotHud = createScreenshotHud({
    onPress: () => {
      sideMenu.close();
      closeRadial();
      inputApi.cancelPlacement?.();
      applyPlacingType(null);
    },
    onChange: (hidden) => {
      document.body.classList.toggle(SCREENSHOT_HUD_CLASS, hidden);
      renderer.setScreenshotHudHidden?.(hidden);
      if (!hidden) {
        syncWorkRadiusRing();
        syncBuildingHighlight(selectedBuildings.length ? selectedBuildings : null);
      }
    },
  });
  screenshotHudRef.current = screenshotHud;

  window.addEventListener('keydown', (e) => {
    if (inputApi.handleControlGroupKeyDown?.(e)) return;
    if (e.code === 'Space') {
      if (isCameraFollowTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!bootInteractive) return;
      spaceFollowHeld = true;
      pushSelectionFollow();
      renderer.cameraController?.tick?.(16);
      return;
    }
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyO') {
      if (isCameraFollowTypingTarget(document.activeElement)) return;
      e.preventDefault();
      if (screenshotHud.isLocked()) {
        screenshotHud.setLocked(false);
        return;
      }
      screenshotHud.press();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      if (screenshotHud.isHidden()) return;
      if (placingType) {
        inputApi.cancelPlacement?.();
        return;
      }
      if (isAnyRadialOpen()) {
        closeRadial();
        return;
      }
      void sideMenu.handleEscape?.();
      return;
    }
    if (e.code === 'KeyJ') {
      kothShard?.requestJoin?.();
      return;
    }
    if (e.code === 'KeyB' || e.code === 'Backquote') {
      if (isCameraFollowTypingTarget(document.activeElement)) return;
      e.preventDefault();
      openOwnAgoraMenu();
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
    if (e.code === 'KeyN') {
      e.preventDefault();
      const on = renderer.toggleShadows?.();
      if (typeof on === 'boolean') setStatusText(on ? 'Shadows on' : 'Shadows off');
      sideMenu.refresh();
      return;
    }
    if (e.code === 'KeyX') {
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
    if (e.code === 'KeyL') {
      e.preventDefault();
      const on = renderer.toggleCelestialSpin?.();
      if (typeof on === 'boolean') setStatusText(on ? 'Sun spin on' : 'Sun spin off');
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
  window.addEventListener('keyup', (e) => {
    inputApi.handleControlGroupKeyUp?.(e);
    if (e.code === 'Space') releaseSpaceFollow();
    if (e.code === 'KeyO') screenshotHud.release();
  }, true);
  document.addEventListener('focusin', (e) => {
    if (isCameraFollowTypingTarget(e.target)) releaseSpaceFollow();
  });
  window.addEventListener('blur', () => {
    releaseSpaceFollow();
    screenshotHud.release();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      releaseSpaceFollow();
      screenshotHud.release();
    }
  });
  kothLobbyUi = setupKothLobby({
    kothShard,
    onLeaveSolo: () => {
      const ctx = ctxRef?.current;
      if (!ctx) return;
      ctx.localSoloHold = false;
      ctx.setShareVisionWith?.([]);
      ctx.setFogEnabled?.(true);
    },
    onRestoreBackdrop: () => {
      const ctx = ctxRef?.current;
      if (!ctx) return;
      return startSoloAiMatch(ctx, {
        temperament: 'passive',
        fog: fogOverrideFromSearch() ?? true,
        sharedVision: true,
        statusLabel: '1v1 AI',
        mode: 'skirmish',
        armyPerSide: 0,
      });
    },
    onCloseMenu: () => sideMenu.close(),
  });

  if (kothShard) {
    const gameLobby = createGameLobby({
      getP2p: () => kothShard.getP2p(),
      subscribeBroadcast: (fn) => kothShard.subscribeBroadcast(fn),
      onChange: () => lobbyUi.refresh(),
    });
    const matchLobby = createMatchLobby({
      getP2p: () => kothShard.getP2p(),
      getUserId: () => kothShard.getUserId(),
      gameLobby,
      subscribeBroadcast: (fn) => kothShard.subscribeBroadcast(fn),
      subscribeLobbyMessage: (fn) => kothShard.subscribeLobbyMessage(fn),
      subscribeDataMessage: (fn) => kothShard.subscribeDataMessage(fn),
      subscribePeerConnected: (fn) => kothShard.subscribePeerConnected(fn),
      subscribePeerDisconnected: (fn) => kothShard.subscribePeerDisconnected(fn),
      subscribeMatchLobbyConnected: (fn) => kothShard.subscribeMatchLobbyConnected(fn),
      onChange: () => lobbyUi.refresh(),
      onStartMatch: (snap) => startLobbyMatch(ctxRef.current, snap, kothShard, matchLobby, sideMenu),
      onChapter: (msg) => ctxRef.current?.onChapterVote?.(msg),
      onLeaveMatch: () => {
        matchLobby.detachSession();
        kothShard.setLobbyMatchHold?.(false);
        const ctx = ctxRef.current;
        if (!ctx) return;
        ctx.endAdventure?.();
        ctx.localSoloHold = false;
        return startSoloAiMatch(ctx, {
          temperament: 'passive',
          fog: fogOverrideFromSearch() ?? true,
          sharedVision: true,
          statusLabel: '1v1 AI',
          mode: 'skirmish',
          armyPerSide: 0,
        });
      },
    });
    observerLobby = matchLobby;
    lobbyUi = setupLobbyUi({
      gameLobby,
      matchLobby,
      isKothLive: () => kothShard.getLobbyPresence?.()?.browsing === false,
      getUserId: () => kothShard.getUserId(),
      onCloseMenu: () => sideMenu.close(),
    });
  }

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
      syncDrawnEntities();
    }
    if (session.kothMatchOver && !matchOverShown) {
      matchOverShown = true;
      showMatchOver(session);
    }
    fogStampDue = true;
    refreshFoggedProps();
    syncAgoraOwnerPaint();
    updateColors();
  };

  let lastUnmappedRebuild = 0;
  /** Reused per-frame: selected unit count keyed by sim type id. */
  const selCountByType = new Map();

  renderer.onFrame((deltaMs) => {
    const frameT0 = frameProf ? performance.now() : 0;
    if (frameProf) frameProf.inFrame = true;
    let profT = frameT0;
    const profSplit = (name) => {
      if (!frameProf) return;
      const now = performance.now();
      profAdd(name, now - profT);
      profT = now;
    };
    // Keep FX clocks in sync with pause (catch-up / KOTH also toggle pauseLockstep).
    renderer.setFxPaused?.(session.pauseLockstep);
    matchStory.tick(deltaMs);
    exitMarks.tick();
    renderer.cameraController?.tick?.(deltaMs);
    session.pump(deltaMs);
    tickAdventureObjectives();
    if (pendingChapterUrl != null && !matchStory.driving() && !chapterAdvanceBusy && !chapterProposeSent) {
      const url = pendingChapterUrl;
      if (url) proposeChapterAdvance(url);
      else {
        pendingChapterUrl = null;
        setStatusText('Adventure complete');
      }
    }
    profSplit('pump');
    stampFogIfDue();
    if (frameProf) profT = performance.now();
    syncWorkRadiusRing();

    updateCatchupProgress(session);
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
    }
    paintStatusClock();
    paintStatusPop();
    paintStatusSide();
    paintResources();

    const alpha = session.displayAlpha;
    const { prev, cur } = session.displaySnapshots();
    if (!prev || !cur) {
      finishFrameProf(frameT0);
      return;
    }

    // A/B: skip pose loop + health/auras when units are hidden.
    if (renderer.getUnitsEnabled && !renderer.getUnitsEnabled()) {
      pushSelectionFollow();
      renderer.commit();
      finishFrameProf(frameT0);
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
      poseX, poseZ, poseYaw, poseSize, poseLoft, poseMoving, poseCarrying, poseChopping, poseAttacking, poseWalkQ, poseValid,
      cacheGx, cacheGz, cacheGy,
      fogHidden,
    } = bufs;

    fogHidden.fill(0);
    selCountByType.clear();
    for (let i = 0; i < n; i++) {
      if (!world.alive[i]) continue;
      let owner = world.owner[i];
      let hx = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha;
      let hz = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha;
      const carrier = world.carriedBy?.[i] ?? -1;
      if (carrier >= 0 && carrier < n && world.alive[carrier]) {
        owner = world.owner[carrier];
        hx = prev.x[carrier] + (cur.x[carrier] - prev.x[carrier]) * alpha;
        hz = prev.z[carrier] + (cur.z[carrier] - prev.z[carrier]) * alpha;
      }
      if (fog.hidesHostile(owner, hx, hz)) fogHidden[i] = 1;
    }

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

    const poseDirty = (i, x, z, yaw, size, loft, movingBit, carryingBit = 0, choppingBit = 0, walkQ = 20, attackingBit = 0) => {
      if (!poseValid[i]) return true;
      if (movingBit !== poseMoving[i]) return true;
      if (carryingBit !== poseCarrying[i]) return true;
      if (choppingBit !== poseChopping[i]) return true;
      if (attackingBit !== poseAttacking[i]) return true;
      if (walkQ !== poseWalkQ[i]) return true;
      const pdx = x - poseX[i];
      const pdz = z - poseZ[i];
      if (pdx * pdx + pdz * pdz > POSE_XZ_EPS_SQ) return true;
      if (Math.abs(yaw - poseYaw[i]) > POSE_YAW_EPS) return true;
      if (Math.abs(size - poseSize[i]) > POSE_SIZE_EPS) return true;
      if (Math.abs(loft - poseLoft[i]) > POSE_LOFT_EPS) return true;
      return false;
    };

    const commitPose = (i, x, z, yaw, size, loft, movingBit, carryingBit = 0, choppingBit = 0, walkQ = 20, attackingBit = 0) => {
      poseX[i] = x;
      poseZ[i] = z;
      poseYaw[i] = yaw;
      poseSize[i] = size;
      poseLoft[i] = loft;
      poseMoving[i] = movingBit;
      poseCarrying[i] = carryingBit;
      poseChopping[i] = choppingBit;
      poseAttacking[i] = attackingBit;
      poseWalkQ[i] = walkQ;
      poseValid[i] = 1;
    };

    if (renderer.consumePoseResync?.()) {
      renderEntityCount = syncDrawnEntities();
    }
    if (n !== renderEntityCount) {
      renderEntityCount = n;
      renderer.setCount(n);
      syncDrawnEntities();
    }
    // Apply lob flight snapshot before drawing so loft/trail match this frame.
    if (!session.resetting) {
      const monkKickUpdates = session.takePendingMonkKickUpdates?.();
      if (monkKickUpdates?.length) renderer.applyMonkKickUpdates?.(monkKickUpdates);
    }
    renderer.setMonkLobDisplayAlpha?.(alpha);
    renderer.beginHealthBars?.();
    // Defer chip writes so selected units win if the bar pool is ever capped again.
    let hbSelCount = 0;
    let hbHurtCount = 0;
    const hbSel = bufs.hbSelected;
    const hbHurt = bufs.hbHurt;
    const hbSelOwner = bufs.hbSelectedOwner;
    const hbHurtOwner = bufs.hbHurtOwner;
    const hbSelHp = bufs.hbSelectedHp;
    const hbHurtHp = bufs.hbHurtHp;

    // Overlay LOD: collar spin by eye distance; bars selected-first, then nearest hurt.
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
      if (fogHidden[i]) continue;
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
    markSelectedThenNearest(barIds, barD2, barCand, OVERLAY_MAX_BARS, selected, overlayBarAllow);

    // Pack passengers into transport seats (`spawn_anchor*`) or the v1 deck grid.
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

    const hideDrawnUnit = (i) => {
      // Always rewrite — rebuild/sync can stomp GPU slots while pose still says hidden.
      if (!renderer.writeInstance(i, world.type[i], world.owner[i], 0, 0, 0)) drawStats.unmapped++;
      commitPose(i, 0, 0, 0, 0, 0, 0);
      if (wasSelected[i]) {
        renderer.writeSelectionRing(i, 0, 0, 0);
        wasSelected[i] = 0;
      }
    };

    for (let i = 0; i < n; i++) {
      if (fogHidden[i]) {
        hideDrawnUnit(i);
        continue;
      }
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

      // Passengers ride authored spawn empties (position + suggested rotation).
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
        const vehicleYaw = facingYaw[t] || 0;
        const slot = passengerSlot?.[i] ?? 0;
        const total = Math.max(1, passengerTotalOf?.[t] ?? 1);
        const liveSeats = renderer.transportSeats?.(world.type[t]);
        const seats = liveSeats?.length ? liveSeats : seatsForUnitType(world.type[t]);
        const vehicleLoft = isFlyer(world.type[t]) ? FLY_HEIGHT : 0;
        const posed = posePassengerOnTransport({
          tx,
          tz,
          vehicleYaw,
          vehicleLoft,
          seats,
          slot,
          total,
        });
        let x = posed.x;
        let z = posed.z;
        const followSmooth = spaceFollowHeld && (!!selected[i] || !!selected[t]) && !!poseValid[i];
        if (followSmooth) {
          const s = chasePoseXZ(poseX[i], poseZ[i], x, z, dt);
          x = s.x;
          z = s.z;
        }
        const loft = posed.loft;
        const yaw = posed.yaw;
        let size = def.size * 0.85;
        const fade = deathFade[i];
        if (fade > 0) size *= fade;
        const gy = groundYCached(t, tx, tz);
        renderX[i] = x;
        renderY[i] = gy + loft + (def.pickHeight ?? 1.1);
        renderZ[i] = z;
        if (fade > 0) {
          colors[i * 4 + 3] = fade;
          colorsDirty = true;
        }
        const forcePose = followSmooth || fade > 0 || posed.pitch !== 0 || posed.roll !== 0;
        if (forcePose || poseDirty(i, x, z, yaw, size, loft, 0)) {
          if (renderer.writeInstance(i, world.type[i], world.owner[i], x, z, size, yaw, false, loft, posed.pitch, posed.roll, gy)) {
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
      let x = prev.x[i] + (cur.x[i] - prev.x[i]) * alpha;
      let z = prev.z[i] + (cur.z[i] - prev.z[i]) * alpha;
      const followSmooth = spaceFollowHeld && !!selected[i] && !!poseValid[i];
      if (followSmooth) {
        const s = chasePoseXZ(poseX[i], poseZ[i], x, z, dt);
        x = s.x;
        z = s.z;
      }
      const dx = cur.x[i] - prev.x[i];
      const dz = cur.z[i] - prev.z[i];
      // Soft-separation nudges positions without an order — don't spin facing / walk.
      // MOVE/ATTACK_MOVE keep walk/rings even while path is pending (zero dx).
      const ord = world.order?.[i] ?? ORDER.IDLE;
      const orderedMove = ord !== ORDER.IDLE;
      const orderedMarch = ord === ORDER.MOVE || ord === ORDER.WANDER || ord === ORDER.ATTACK_MOVE;
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
      const gatherAct = world.gatherAct?.[i] | 0;
      const carryingBit = gatherAct === GATHER_ACT.HAUL ? 1 : 0;
      const choppingBit = gatherAct === GATHER_ACT.CHOP ? 1 : 0;
      const attackingBit = ord === ORDER.ATTACK && !displacing ? 1 : 0;
      const stepLen = Math.hypot(dx, dz);
      const nominal = fx.toFloat(def.speed) || 2;
      const walkRate = movingBit ? Math.min(1, stepLen / nominal) : 1;
      const walkQ = Math.round(Math.max(0, Math.min(1, walkRate)) * 20);
      const forcePose = followSmooth || fade > 0 || loft > 0.01 || pitch !== 0 || roll !== 0;
      if (forcePose || poseDirty(i, x, z, yaw, size, loft, movingBit, carryingBit, choppingBit, walkQ, attackingBit)) {
        if (renderer.writeInstance(i, world.type[i], world.owner[i], x, z, size, yaw, !!movingBit, loft, pitch, roll, gy, !!carryingBit, !!choppingBit, walkRate, !!attackingBit)) {
          if (world.owner[i] === 0) drawStats.p0++;
          else if (world.owner[i] === 1) drawStats.p1++;
        } else drawStats.unmapped++;
        commitPose(i, x, z, yaw, size, loft, movingBit, carryingBit, choppingBit, walkQ, attackingBit);
      } else if (world.owner[i] === 0) drawStats.p0++;
      else if (world.owner[i] === 1) drawStats.p1++;
      const isSel = !!selected[i] && !!world.alive[i];
      if (isSel) {
        selCountByType.set(world.type[i], (selCountByType.get(world.type[i]) ?? 0) + 1);
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
          } else if (ord === ORDER.MOVE || ord === ORDER.WANDER) {
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
        const owners = isSel ? hbSelOwner : hbHurtOwner;
        const hps = isSel ? hbSelHp : hbHurtHp;
        const o = slot * 4;
        buf[o] = x;
        buf[o + 1] = z;
        buf[o + 2] = unitChipLift(loft, def.pickHeight);
        buf[o + 3] = hp / maxHp;
        owners[slot] = world.owner[i];
        hps[slot] = hp | 0;
      }
    }
    profSplit('pose');
    for (let s = 0; s < hbSelCount; s++) {
      const o = s * 4;
      renderer.writeHealthBar?.(hbSel[o], hbSel[o + 1], hbSel[o + 2], hbSel[o + 3], {
        armor: false,
        holy: false,
        far: overlayBarIsFar(hbSel[o] - refX, hbSel[o + 1] - refZ),
        owner: hbSelOwner[s],
        hp: hbSelHp[s],
      });
    }
    for (let s = 0; s < hbHurtCount; s++) {
      const o = s * 4;
      renderer.writeHealthBar?.(hbHurt[o], hbHurt[o + 1], hbHurt[o + 2], hbHurt[o + 3], {
        armor: false,
        holy: false,
        far: overlayBarIsFar(hbHurt[o] - refX, hbHurt[o + 1] - refZ),
        owner: hbHurtOwner[s],
        hp: hbHurtHp[s],
      });
    }
    const markedB = new Set();
    const markedA = new Set();
    const agoraLift = renderer.agoraChipHeight?.() ?? roofChipLift(0, DEFAULT_AGORA_ROOF);
    const writeAgoraChips = (a, index) => {
      if (!a || fog.hidesHostile(a.owner, a.x, a.z)) return;
      markedA.add(index);
      renderer.writeHealthBar?.(a.x, a.z, agoraLift, 1, {
        armor: false,
        holy: false,
        agora: true,
        far: overlayBarIsFar(a.x - refX, a.z - refZ),
        owner: a.owner,
        founder: a.founder ?? a.owner,
        capturer: a.capturer,
        progress: a.progress,
        tug: a.tug,
        phase: a.phase,
      });
    };
    for (let i = 0; i < selectedBuildings.length; i++) {
      const sel = selectedBuildings[i];
      let x;
      let z;
      let owner;
      let lift;
      let ratio = 1;
      let hpLeft;
      if (sel.kind === 'rally') continue;
      if (sel.kind === 'agora') {
        writeAgoraChips(session.agoras?.[sel.index], sel.index);
        continue;
      }
      const b = session.buildings?.[sel.index];
      if (!b || (b.hp != null && (b.hp | 0) <= 0)) continue;
      x = b.x;
      z = b.z;
      owner = b.owner;
      lift = renderer.buildingChipHeight?.(b.type) ?? roofChipLift(0, DEFAULT_BUILDING_ROOF);
      const maxHp = b.maxHp != null ? b.maxHp | 0 : 0;
      const hp = b.hp != null ? b.hp | 0 : maxHp;
      hpLeft = hp;
      if (maxHp > 0) ratio = hp / maxHp;
      markedB.add(sel.index);
      if (fog.hidesHostile(owner, x, z)) continue;
      renderer.writeHealthBar?.(x, z, lift, ratio, {
        armor: false,
        holy: false,
        building: true,
        far: overlayBarIsFar(x - refX, z - refZ),
        owner,
        hp: hpLeft,
      });
    }
    const allA = session.agoras;
    if (allA) {
      for (let i = 0; i < allA.length; i++) {
        if (markedA.has(i)) continue;
        const a = allA[i];
        if (!agoraOverlayActive(a)) continue;
        writeAgoraChips(a, i);
      }
    }
    const allB = session.buildings;
    if (allB) {
      for (let i = 0; i < allB.length; i++) {
        if (markedB.has(i)) continue;
        const b = allB[i];
        const maxHp = b.maxHp != null ? b.maxHp | 0 : 0;
        const hp = b.hp != null ? b.hp | 0 : maxHp;
        if (maxHp <= 0 || hp <= 0 || hp >= maxHp) continue;
        if (fog.hidesHostile(b.owner, b.x, b.z)) continue;
        const lift = renderer.buildingChipHeight?.(b.type) ?? roofChipLift(0, DEFAULT_BUILDING_ROOF);
        renderer.writeHealthBar?.(b.x, b.z, lift, hp / maxHp, {
          armor: false,
          holy: false,
          building: true,
          far: overlayBarIsFar(b.x - refX, b.z - refZ),
          owner: b.owner,
          hp,
        });
      }
    }
    renderer.endHealthBars?.();
    if (renderer.setSelectionGroups) {
      if (selectedBuildings.length > 0) {
        renderer.setSelectionGroups(
          selectionGroupsFromBuildings(
            selectedBuildings,
            session.buildings,
            session.agoras,
          ),
        );
      } else {
        const groups = [];
        for (const [typeId, count] of selCountByType) {
          groups.push({ kind: 'unit', typeId, name: getUnitDef(typeId).name, count });
        }
        renderer.setSelectionGroups(groups);
      }
    }
    inputApi.syncControlGroupMarks?.();
    profSplit('overlay');
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
        { fromStatus: true, skip: fogHidden },
      );
    }
    if (renderer.syncLocustDots) {
      renderer.syncLocustDots(n, world.locustStacks, renderX, renderY, renderZ, {
        skip: fogHidden,
        buildings: session.buildings,
        hideBuilding: (b) => fog.hidesHostile(b.owner, b.x, b.z),
      });
    }
    if (renderer.syncCarryLoads) {
      renderer.syncCarryLoads(n, {
        x: renderX,
        y: renderY,
        z: renderZ,
        yaw: facingYaw,
        amt: world.carriedAmt,
        kind: world.carriedKind,
        act: world.gatherAct,
        alive: world.alive,
        skip: fogHidden,
      });
    }
    if (renderer.syncHolyShields) {
      const shieldSpheres = [];
      for (let i = 0; i < n; i++) {
        if (!world.alive[i] || fogHidden[i]) continue;
        if (!(world.shieldHp[i] > 0)) continue;
        const def = getUnitDef(world.type[i]);
        const pick = def.pickRadius ?? 1.8;
        // Pick spheres sit inside the VAT mesh; the shield has to wrap the body.
        const wrap = Math.max(pick * 2.2, (def.size ?? 5) * 0.5);
        shieldSpheres.push({
          x: renderX[i],
          y: renderY[i] + pick * 0.35,
          z: renderZ[i],
          r: wrap,
        });
      }
      renderer.syncHolyShields(shieldSpheres);
    }
    profSplit('fx');
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
      renderEntityCount = syncDrawnEntities();
    }
    if (colorsDirty) renderer.setColors(colors);
    if (renderer.getPickHitboxesVisible?.()) {
      const spheres = [];
      for (let i = 0; i < n; i++) {
        if (!world.alive[i] || fogHidden[i]) continue;
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
    if (!session.resetting) {
      const treeUpdates = session.takePendingTreeUpdates?.();
      if (treeUpdates?.length) renderer.applyTreeUpdates?.(treeUpdates);
      const rockUpdates = session.takePendingRockUpdates?.();
      if (rockUpdates?.length) renderer.applyRockUpdates?.(rockUpdates);
      const fireZoneUpdates = session.takePendingFireZoneUpdates?.();
      if (fireZoneUpdates?.length) renderer.applyFireZoneUpdates?.(fireZoneUpdates);
      const frogUpdates = session.takePendingFrogUpdates?.();
      if (frogUpdates?.length) renderer.applyFrogUpdates?.(frogUpdates);
      const lightningUpdates = session.takePendingLightningUpdates?.();
      if (lightningUpdates?.length) {
        renderer.applyLightningUpdates?.(lightningUpdates);
        let bolts = 0;
        for (let u = 0; u < lightningUpdates.length; u++) {
          bolts += lightningUpdates[u]?.count ?? 0;
        }
        if (thunderPlaysForStrikes(bolts)) playThunder();
      }
      const holyArmorUpdates = session.takePendingHolyArmorUpdates?.();
      if (holyArmorUpdates?.length) renderer.applyHolyArmorUpdates?.(holyArmorUpdates);
      const sporeBloomUpdates = session.takePendingSporeBloomUpdates?.();
      if (sporeBloomUpdates?.length) {
        renderer.applySporeBloomUpdates?.(sporeBloomUpdates, world.tick);
      } else {
        renderer.setFxSimTick?.(world.tick);
      }
    }
    syncActionRadialTracksFromSim();
    pushSelectionFollow();
    profSplit('worldFx');
    renderer.commit();
    profSplit('commit');
    finishFrameProf(frameT0);
  });

  // Engine already started after createRenderer for progressive first paint.
  await renderer.start();

  // Splash stays up through the first heavy frames; fade starts after settle.
  const unlock = () => {
    if (bootInteractive) return;
    setInteractive(true);
    dismissBootSplash();
    aetherSteam.notifyPlayReady();
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
      renderEntityCount = syncDrawnEntities();
      return renderEntityCount;
    },
    inputApi,
    matchStory,
    setStoryCast(cast) {
      storyCast = Array.isArray(cast) ? cast : [];
    },
    beginAdventure,
    endAdventure,
    captureAdventureParty,
    takeCarriedParty,
    onChapterVote(msg) {
      if (!adventureSessionLive() || !msg?.url) return;
      const from = msg.playerId | 0;
      if (from === (localPlayerId | 0)) {
        tryFlushChapter();
        return;
      }
      const firstFromPeer = !chapterVotes.has(from);
      noteChapterVote(msg);
      if (!chapterProposeSent) {
        if (!chapterWon && !matchStory.driving()) {
          chapterWon = true;
          captureAdventureParty();
        }
        if (chapterWon && !matchStory.driving()) {
          proposeChapterAdvance(msg.url);
          return;
        }
      } else if (firstFromPeer) {
        const mine = chapterVotes.get(localPlayerId | 0);
        const lobby = adventureLobby();
        if (mine) lobby?.sendChapter?.(mine);
      }
      tryFlushChapter();
    },
    matchLobby: observerLobby,
    adventureLive: garden?.story || garden?.obj
      ? {
        mode: 'adventure',
        localSolo: true,
        localPlayerId,
        humanPlayers: [localPlayerId],
        activeSlots: [localPlayerId],
        role: 'player',
        seed: garden?.s ?? bootCfg.seed ?? 0,
        fog: true,
        sharedVision: true,
        teamByOwner: [0, 0, 0, 0],
      }
      : null,
    setInteractive,
    kothShard,
    /** When true, ignore KOTH presentation/live stomps (local 1v1 AI). */
    localSoloHold: !!bootCfg.localSolo,
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
      setLocalOwnerTint(localPlayerId, getPlayerColor());
      inputApi.setLocalPlayerId?.(v);
      stampFog();
      refreshFoggedProps();
      updateColors();
      renderer.refreshOwnerTints?.();
      syncWorkRadiusRing();
    },
    matchMeta,
    setMatchMeta(m) {
      matchMeta = { ...matchMeta, ...m };
    },
    paintStatus,
    updateColors,
    stampFog,
    refreshFoggedProps,
    setFogEnabled,
    setShareVisionWith,
  };
  ctxAdvanceChapter = async (url, handoff = null) => {
    if (!adventureSessionLive() || chapterAdvanceBusy) return;
    chapterAdvanceBusy = true;
    try {
      await loadAdventureGardenUrl(ctx, url, kothShard, {
        party: handoff?.party,
        bank: handoff?.bank,
        epoch: handoff?.epoch,
        matchLobby: ctx.matchLobby || observerLobby,
      });
    } catch (err) {
      console.error('[adventure] next chapter failed', err);
      setStatusText('Next chapter failed to load');
      chapterWon = false;
      session.pauseLockstep = false;
    } finally {
      chapterAdvanceBusy = false;
    }
  };
  ctxRef.current = ctx;
  paintHudStatus = paintStatus;
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
    setGraffitiHeaderVisible(true);
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

  ctx.matchStory?.stop();
  ctx.setStoryCast?.([]);
  if (!liveConfigKeepsAdventure(cfg)) ctx.endAdventure?.();
  applyOwnerPacksToRenderer(ctx.renderer, cfg, cfg.localPlayerId ?? ctx.localPlayerId);

  // Cover the teardown/rebuild — same splash as cold boot.
  showMatchSplash();
  ctx.setInteractive?.(false);
  setGraffitiHeaderVisible(isLobbyGraffitiScene(cfg.mode));
  setStatusText(cfg.loadingLabel ?? (localSolo ? 'Starting 1v1…' : 'Loading match…'));

  const simMode = workerSimMode(cfg.mode);
  const humanPlayers = cfg.humanPlayers ?? activeSlots;
  const aiPlayers = resolveSessionAiPlayers(
    { ...cfg, humanPlayers, localSolo },
    ctx.session.aiPlayers,
  );
  const prevHumans = [...(ctx.session.humanPlayers ?? [])];
  const prevAi = ctx.session.aiPlayers;
  const prevRole = ctx.session.role;
  const prevLocal = ctx.localPlayerId;
  const prevTeams = getTeamAssignments();
  let worldReset = false;
  // Don't stamp/upload fog on the outgoing world (stress 496 → 1v1 208).
  // Stay quiet through session.reset; onWorldRebuilt force-stamps after setField.
  liveConfigQuietFog = true;
  try {
    setTeamAssignments(cfg.teamByOwner ?? null);
    ctx.session.setRole(cfg.role ?? 'player');
    if (cfg.localPlayerId != null) {
      ctx.localPlayerId = cfg.localPlayerId;
      ctx.session.setLocalPlayerId?.(cfg.localPlayerId);
    }
    ctx.setFogEnabled?.(cfg.fog !== false);
    ctx.setShareVisionWith?.(shareVisionOwnersFromCfg(cfg));
    ctx.session._pendingWorldGen = gen;
    worldReset = true;
    await ctx.session.reset({
      seed: cfg.seed,
      mode: simMode,
      activeSlots,
      armyPerSide: cfg.armyPerSide ?? 0,
      stressPerSide: cfg.stressPerSide ?? 0,
      animStressPerSide: cfg.animStressPerSide ?? 0,
      profileSim: cfg.profileSim === true
        || (cfg.stressPerSide | 0) > 0
        || (cfg.animStressPerSide | 0) > 0
        || new URLSearchParams(location.search).has('profileSim'),
      garden: cfg.garden,
      skipDefaultSpawns: cfg.skipDefaultSpawns
        ?? Boolean(cfg.garden?.story || cfg.garden?.obj || (cfg.garden?.u && cfg.garden.u.length)),
      agoraOccupyEndsMatch: cfg.agoraOccupyEndsMatch
        ?? (cfg.mode === 'adventure' || !!(cfg.garden?.story || cfg.garden?.obj) ? 0 : undefined),
      aiPlayers,
      humanPlayers,
      mapW: cfg.mapW ?? (cfg.mode === 'skirmish' ? SKIRMISH_MAP_W : undefined),
      mapH: cfg.mapH ?? (cfg.mode === 'skirmish' ? SKIRMISH_MAP_H : undefined),
      noCenterBlock: cfg.noCenterBlock ?? (simMode === 'skirmish'),
      teamByOwner: cfg.teamByOwner ?? null,
      laneBases: !!cfg.laneBases,
    });
    // Terrain is enough to unlock — 3D scenery/building GLBs finish in the
    // background. Waiting on modelsReady here was a ~12s tab stall.
    await Promise.race([
      ctx.renderer.whenFieldReady?.() ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, 12000)),
    ]);
  } catch (err) {
    if (!worldReset) {
      setTeamAssignments(prevTeams);
      ctx.session.setHumanPlayers(prevHumans);
      ctx.session.aiPlayers = prevAi;
      ctx.session.setRole(prevRole);
      ctx.localPlayerId = prevLocal;
      ctx.session.setLocalPlayerId?.(prevLocal);
    }
    console.error('[live] match rebuild failed', err);
    setStatusText('Match load failed');
    ctx.setInteractive?.(true);
    dismissBootSplash({ immediate: true });
    if (err && typeof err === 'object') err.worldReset = worldReset;
    throw err;
  } finally {
    liveConfigQuietFog = false;
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

  ctx.setStoryCast?.(storyCastFromGarden(cfg.garden));
  forceRendererSync(ctx);
  syncPresentation(ctx, cfg, { skipRenderSync: true });
  const storyMark = cfg.mode === 'adventure' || !!(cfg.garden?.story || cfg.garden?.obj);
  paintCornerMark(storyMark
    ? chapterLabelFor({
      chapter: cfg.chapter,
      gardenUrl: cfg.gardenUrl,
      name: cfg.garden?.n || cfg.garden?.name,
    })
    : '');

  // The live world is rebuilt and confirmedTick is back at 0 for this match;
  // seed the lockstep confirm handshake so the sim can leave tick 0.
  // Local 1v1 AI runs offline (delay 0) — no shard handshake.
  if (cfg.mode === 'koth' && !localSolo) kothShard?.notifyLiveSessionReady?.();

  ctx.setInteractive?.(true);
  dismissBootSplash();
  aetherSteam.notifyPlayReady();
}

/**
 * Offline 1v1 vs AI — same two-army KOTH spawn as a real match, no P2P.
 * Exercises the hardened match teardown/rebuild path from the menu.
 * @param {object | null} ctx
 * @param {{ temperament?: string, fog?: boolean, sharedVision?: boolean, shareVisionWith?: number[], statusLabel?: string, garden?: object, mode?: string, armyPerSide?: number }} [opts]
 */
async function startSoloAiMatch(ctx, opts = {}) {
  if (!ctx?.session || !ctx.renderer) return;
  if (ctx._soloStarting) return;
  const {
    temperament = 'steady',
    fog = true,
    sharedVision = false,
    shareVisionWith,
    statusLabel = '1v1 vs AI',
    garden = null,
    mode = 'koth',
  } = opts;
  ctx._soloStarting = true;
  ctx.localSoloHold = true;
  try {
    const armyPerSide = garden ? 0 : (opts.armyPerSide ?? ctx.session.state?.armyPerSide ?? 0);
    await applyLiveConfig(ctx, {
      mode,
      localSolo: true,
      seed: garden?.s ?? (Math.random() * 0xffffffff) >>> 0,
      localPlayerId: PLAYER,
      humanPlayers: [PLAYER],
      activeSlots: [PLAYER, AI_OWNER],
      aiPlayers: [{ owner: AI_OWNER, temperament }],
      role: 'player',
      reset: true,
      inputEnabled: true,
      armyPerSide,
      garden,
      matchId: `solo-${Date.now().toString(36)}`,
      fog,
      sharedVision,
      shareVisionWith,
    }, ctx.kothShard);
    ctx.setMatchMeta?.({ mode: 'solo' });
    ctx.setFogEnabled?.(fog);
    setStatusText(statusLabel);
  } catch (err) {
    ctx.localSoloHold = false;
    console.error('[solo] start failed', err);
  } finally {
    ctx._soloStarting = false;
  }
}

/**
 * Offline 2-player sandbox on the authored unit-tester garden.
 * Shared vision with the AI so both sides show through fog. `?fog=0` disables it.
 */
async function startUnitTesterMatch(ctx) {
  if (!ctx?.session || !ctx.renderer) return;
  let garden;
  try {
    garden = await loadTesterGarden();
  } catch (err) {
    console.error('[tester] garden load failed', err);
    setStatusText('Unit tester map failed to load');
    return;
  }
  await startSoloAiMatch(ctx, {
    temperament: 'passive',
    fog: fogOverrideFromSearch() ?? true,
    sharedVision: true,
    statusLabel: 'Unit tester',
    garden,
    mode: 'sandbox',
  });
}

/**
 * Offline 5-way FFA stress test — pie-ring armies, same AI mix as `?stress=N`.
 */
async function startStressfulSituation(ctx) {
  if (!ctx?.session || !ctx.renderer) return;
  if (ctx._soloStarting) return;
  ctx._soloStarting = true;
  ctx.localSoloHold = true;
  try {
    await applyLiveConfig(ctx, {
      mode: 'legacy',
      localSolo: true,
      seed: (Math.random() * 0xffffffff) >>> 0,
      localPlayerId: PLAYER,
      humanPlayers: [PLAYER],
      activeSlots: [PLAYER, ...STRESS_AI_OWNERS],
      aiPlayers: STRESS_AI_PROFILES.map((p) => ({ ...p })),
      role: 'player',
      reset: true,
      inputEnabled: true,
      armyPerSide: 0,
      stressPerSide: STRESS_MENU_PER_SIDE,
      shareVisionWith: stressShareVisionOwners(),
      fog: fogOverrideFromSearch() ?? true,
      loadingLabel: 'Starting stressful situation…',
      matchId: `stress-${Date.now().toString(36)}`,
    }, ctx.kothShard);
    ctx.setMatchMeta?.({ mode: 'stress' });
    ctx.setFogEnabled?.(fogOverrideFromSearch() ?? true);
    setStatusText('Stressful Situation');
  } catch (err) {
    ctx.localSoloHold = false;
    console.error('[stress] start failed', err);
  } finally {
    ctx._soloStarting = false;
  }
}

function syncPresentation(ctx, cfg, options = {}) {
  applyOwnerPacksToRenderer(ctx.renderer, cfg, cfg.localPlayerId ?? ctx.localPlayerId);
  if (!options.skipRenderSync && !ctx.session.resetting) forceRendererSync(ctx);
  ctx.setMatchMeta({ mode: cfg.mode ?? 'koth', matchId: cfg.matchId });
  if (cfg.localPlayerId != null) ctx.localPlayerId = cfg.localPlayerId;
  if (cfg.localPlayerId != null) ctx.session.setLocalPlayerId?.(cfg.localPlayerId);
  if (cfg.humanPlayers && (cfg.reset || cfg.updateHumanPlayers || options.updateHumanPlayers)) {
    ctx.session.setHumanPlayers(cfg.humanPlayers);
  }
  ctx.session.setRole(cfg.role ?? 'player');
  ctx.inputApi?.setRole?.(cfg.role ?? 'player');
  ctx.setFogEnabled?.(cfg.fog !== false);
  ctx.setShareVisionWith?.(shareVisionOwnersFromCfg(cfg));
  ctx.stampFog?.();
  ctx.refreshFoggedProps?.();
  if (cfg.inputEnabled != null) ctx.inputApi?.setInputEnabled?.(Boolean(cfg.inputEnabled));
  ctx.session.inputDelayTicks = cfg.localSolo
    ? 0
    : (cfg.inputDelayTicks ?? (cfg.mode === 'koth' || isLobbyPlayMode(cfg.mode) ? 1 : 0));
  // New table: drop selection / groups so stress entity ids cannot pick 1v1 units.
  // Camera snap only on a real match reset — join/role used to yank the view.
  if (cfg.reset || (cfg.role ?? 'player') !== 'player') ctx.inputApi?.clearSelection?.();
  if (cfg.reset) ctx.inputApi?.clearControlGroups?.();
  if (cfg.reset && (cfg.mode === 'koth' || cfg.localSolo || isLobbyPlayMode(cfg.mode))) {
    ctx.renderer.resetCamera?.();
  }

  const overEl = document.getElementById('match-over');
  if (overEl) overEl.style.display = 'none';
  ctx.matchOverShown = false;

  ctx.updateColors();
  ctx.paintStatus?.();
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

function matchEndedByAgora(session) {
  const list = session.agoras;
  if (!list?.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].captured) return true;
  }
  return false;
}

function showMatchOver(session) {
  const el = document.getElementById('match-over');
  if (!el) return;
  const k = session.koth;
  let text = 'Match over';
  if (session.matchWinner != null && session.matchWinner >= 0) {
    const winner = session.matchWinner;
    const agora = matchEndedByAgora(session);
    const localWin = winner === (session.localPlayerId ?? 0);
    text = agora
      ? (localWin
        ? 'Victory — agora captured'
        : `Defeat — Player ${formatGameNumber(winner)} captured the agora`)
      : (localWin ? 'Victory — last standing' : 'Defeat — no pop');
    if (agora) aetherSteam.notifyKothDefeat(session);
  } else if (k) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < 5; i++) {
      if ((k.scores[i] ?? 0) > bestScore) {
        bestScore = k.scores[i];
        best = i;
      }
    }
    text = `Match over — Player ${formatGameNumber(best)} wins (${formatGameNumber(bestScore)} pts)`;
  }
  el.textContent = text;
  el.style.display = 'block';
}

function useKothAi(bootCfg, stress, animStress, solo) {
  if (animStress > 0) return [];
  if (stress > 0) return STRESS_AI_PROFILES.map((p) => ({ ...p }));
  if (bootCfg.aiPlayers) return bootCfg.aiPlayers;
  if (solo) return [AI_OWNER];
  if (bootCfg.mode === 'staging' || bootCfg.mode === 'sandbox') {
    return [{ owner: AI_OWNER, temperament: 'cautious' }];
  }
  if (bootCfg.mode === 'koth') return [];
  return [AI_OWNER];
}

/** Last shard/boot message. HUD-owned offer/role labels are ignored so they don't flash. */
let statusHint = '';
/** Assigned once bootGame creates paintStatus. */
let paintHudStatus = null;

function statusHintIsHudOwned(text) {
  if (!text) return false;
  if (/J to claim/.test(text)) return true;
  if (/^Live — /.test(text)) return true;
  return false;
}

const CORNER_VERSION = 'v 0.4';

function paintCornerMark(label) {
  const el = typeof document !== 'undefined' ? document.getElementById('version') : null;
  if (el) el.textContent = label || CORNER_VERSION;
}

function setStatusText(text) {
  const next = text ?? '';
  if (statusHintIsHudOwned(next)) {
    statusHint = '';
    if (paintHudStatus) {
      paintHudStatus();
      return;
    }
  } else {
    statusHint = next;
    if (paintHudStatus) {
      paintHudStatus();
      return;
    }
  }
  const el = document.getElementById('status-time') || document.getElementById('status');
  if (el) el.textContent = statusHint || next;
}

async function waitForGetFireP2p(timeoutMs = 5000) {
  const start = performance.now();
  while (typeof globalThis.GETFIREP2P !== 'function' && performance.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return typeof globalThis.GETFIREP2P === 'function';
}

/** Soft landing for Lite (WebGPU-only) — src/axiom/ is packaged at /axiom/. */
function goAxiom() {
  showFallback('WebGPU support not detected, going elsewhere...');
  // Slow / no-WebGPU boxes often miss a 1-frame notice. Wait for a real paint,
  // then hold so the card can settle before the URL swap.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        location.replace(`${location.origin}/axiom/`);
      }, 3600);
    });
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

/**
 * True only when a real WebGPU adapter+device can be created.
 * `navigator.gpu` alone is not enough (blocklisted GPUs, some mobiles).
 */
async function probeWebGPU(timeoutMs = 2500) {
  const gpu = navigator.gpu;
  if (!gpu) return false;
  try {
    const adapter = await withTimeout(gpu.requestAdapter(), timeoutMs, 'WebGPU adapter timeout');
    if (!adapter || adapter.isFallbackAdapter) return false;
    const device = await withTimeout(adapter.requestDevice(), timeoutMs, 'WebGPU device timeout');
    if (!device) return false;
    try {
      device.destroy?.();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

function isWebGpuFailure(err) {
  const m = String(err?.message ?? err).toLowerCase();
  return /webgpu|requestadapter|requestdevice|gpuadapter|gpu device|no compatible/i.test(m);
}

// Splash: hold opaque through the ready hitch, then fade. Starting the dissolve
// on the same tick as scene-ready starves it of frames.
const SPLASH_FADE_MS = 550;
const SPLASH_SETTLE_FRAMES = 14;
const SPLASH_SETTLE_MAX_MS = 900;

function workerSimMode(mode) {
  if (mode === 'staging' || mode === 'sandbox') return 'staging';
  if (mode === 'skirmish' || isLobbyPlayMode(mode)) return 'skirmish';
  return 'koth';
}

async function loadAdventureGardenUrl(ctx, url, kothShard, extras = {}) {
  let party = extras.party;
  let bank = extras.bank ?? null;
  if (!Array.isArray(party)) {
    let handoff = ctx.takeCarriedParty?.();
    if (!handoff?.party?.length) {
      ctx.captureAdventureParty?.();
      handoff = ctx.takeCarriedParty?.();
    }
    party = handoff?.party || [];
    if (bank == null) bank = handoff?.bank ?? null;
  }
  setStatusText('Loading next chapter…');
  const gardenJson = await loadGardenJson(url);
  const id = ctx.localPlayerId ?? 0;
  const live = ctx.adventureLive || {
    mode: 'adventure',
    localSolo: true,
    localPlayerId: id,
    humanPlayers: [id],
    activeSlots: [id],
    role: 'player',
    seed: gardenJson.s ?? 0,
    fog: true,
    sharedVision: true,
    teamByOwner: [0, 0, 0, 0],
  };
  const humans = live.humanPlayers?.length ? live.humanPlayers : [id];
  const garden = prepareAdventureGarden(gardenJson, {
    humanPlayers: humans,
    seed: adventureDealSeed(live.seed ?? 0, gardenJson.s ?? 0),
    party: party.length ? party : null,
    bank,
  });
  const localSolo = humans.length < 2;
  const matchLobby = extras.matchLobby ?? ctx.matchLobby;
  matchLobby?.detachSession?.();
  await applyLiveConfig(ctx, {
    ...live,
    garden,
    gardenUrl: url,
    chapter: chapterIdForGardenUrl(url) || live.chapter,
    seed: garden.s,
    mapW: garden.w,
    mapH: garden.h,
    reset: true,
    inputEnabled: true,
    armyPerSide: 0,
    agoraOccupyEndsMatch: 0,
    mode: 'adventure',
    localSolo,
    humanPlayers: humans,
    activeSlots: live.activeSlots?.length ? live.activeSlots : humans,
    inputDelayTicks: localSolo ? 0 : (live.inputDelayTicks ?? 1),
    loadingLabel: 'Loading next chapter…',
  }, kothShard);
  ctx.session.pauseLockstep = false;
  ctx.session.simAcc = 0;
  ctx.adventureLive = {
    ...live,
    localSolo,
    humanPlayers: humans,
    activeSlots: live.activeSlots?.length ? live.activeSlots : humans,
    gardenUrl: url,
    chapter: chapterIdForGardenUrl(url) || live.chapter || '',
  };
  ctx.beginAdventure?.(garden);
  ctx.matchStory?.playIntro(garden?.story);
  if (!localSolo) {
    if (extras.epoch != null) matchLobby?.setLockstepEpoch?.(extras.epoch | 0);
    matchLobby?.attachSession?.(ctx.session);
  }
  setStatusText('Adventure — match on');
}

async function startLobbyMatch(ctx, snapshot, kothShard, matchLobby, sideMenu) {
  if (!ctx?.session) return;
  const cfg = liveConfigFromLobby(snapshot, kothShard?.getUserId?.() ?? null);
  if (cfg.localPlayerId < 0) {
    setStatusText('Not seated — cannot start');
    return;
  }
  let garden = null;
  if (snapshot.mode === 'adventure') {
    const url = cfg.gardenUrl || gardenUrlForChapter(cfg.chapter);
    if (!url) {
      setStatusText('That chapter is not ready yet');
      throw new Error('chapter garden missing');
    }
    try {
      const rawGarden = await loadGardenJson(url);
      garden = prepareAdventureGarden(rawGarden, {
        humanPlayers: cfg.humanPlayers,
        seed: adventureDealSeed(cfg.seed, rawGarden.s),
      });
    } catch (err) {
      console.error('[lobby] chapter garden failed', err);
      setStatusText('Chapter map failed to load');
      throw err;
    }
  }
  const heldSolo = ctx.localSoloHold;
  ctx.localSoloHold = true;
  kothShard?.setLobbyMatchHold?.(true);
  try {
    await applyLiveConfig(ctx, {
      ...cfg,
      garden,
      ...(garden ? { seed: garden.s, mapW: garden.w, mapH: garden.h } : {}),
      reset: true,
      inputEnabled: true,
      armyPerSide: 0,
    }, kothShard);
    ctx.setMatchMeta?.({ mode: snapshot.mode, matchId: snapshot.roomId });
    if (snapshot.mode === 'adventure') {
      ctx.adventureLive = { ...cfg };
      ctx.matchLobby = matchLobby;
      ctx.beginAdventure?.(garden);
    } else {
      ctx.endAdventure?.();
    }
    if (!cfg.localSolo) matchLobby?.attachSession?.(ctx.session);
    sideMenu?.close?.();
    ctx.matchStory?.playIntro(garden?.story);
    const label = snapshot.mode === 'teams'
      ? 'Teams'
      : snapshot.mode === 'adventure'
        ? 'Adventure'
        : '1v1';
    setStatusText(`${label} — match on`);
  } catch (err) {
    ctx.localSoloHold = heldSolo;
    kothShard?.setLobbyMatchHold?.(false);
    matchLobby?.detachSession?.();
    console.error('[lobby] match start failed', err);
  }
}

/** Graffiti logo is lobby/loading chrome — hide it once a real match is up. */
function isLobbyGraffitiScene(mode) {
  return mode === 'skirmish' || mode === 'staging';
}

function setGraffitiHeaderVisible(on) {
  document.getElementById('header')?.classList.toggle('in-match', !on);
}

/**
 * Drive the catch-up progress bar inside the KOTH lobby menu while a late joiner
 * replays to the live tick, so the load is visible in the lobby the player is
 * already looking at rather than as a separate screen.
 */
function updateCatchupProgress(session) {
  const el = document.getElementById('koth-catchup');
  if (!el) return;
  const active = !!session?.replayingCatchUp;
  if (!active) {
    if (!el.hidden) el.hidden = true;
    return;
  }
  if (el.hidden) el.hidden = false;
  const fill = document.getElementById('koth-catchup-fill');
  if (!fill) return;
  const progress = session.catchupProgress;
  const pct = progress && progress.targetTick > 0
    ? Math.max(0, Math.min(100, Math.round((progress.tick / progress.targetTick) * 100)))
    : 0;
  const width = `${pct}%`;
  if (fill.style.width !== width) fill.style.width = width;
}

function showMatchSplash() {
  let el = document.getElementById('boot-splash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-splash';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<img src="./icons/splash.png" alt="" width="512" height="512" decoding="async" />';
    document.body.appendChild(el);
  }
  delete el.dataset.leaving;
  delete el.dataset.settle;
  el.style.pointerEvents = '';
  const img = el.querySelector('img');
  if (img) {
    img.getAnimations?.().forEach((a) => a.cancel());
    img.style.opacity = '1';
  }
}

/** @param {{ immediate?: boolean }} [opts] */
function dismissBootSplash(opts = {}) {
  document.getElementById('header')?.classList.add('map-ready');
  const el = document.getElementById('boot-splash');
  if (!el) return;
  if (opts.immediate) {
    el.dataset.leaving = '1';
    el.remove();
    return;
  }
  if (el.dataset.leaving === '1' || el.dataset.settle === '1') return;
  el.dataset.settle = '1';
  el.style.pointerEvents = 'none';

  let frames = 0;
  const t0 = performance.now();
  const tick = () => {
    if (!el.isConnected || el.dataset.leaving === '1' || el.dataset.settle !== '1') return;
    frames += 1;
    if (frames < SPLASH_SETTLE_FRAMES && performance.now() - t0 < SPLASH_SETTLE_MAX_MS) {
      requestAnimationFrame(tick);
      return;
    }
    el.dataset.leaving = '1';
    delete el.dataset.settle;
    const img = el.querySelector('img') || el;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
    };
    if (typeof img.animate === 'function') {
      img.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: SPLASH_FADE_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      ).finished.then(finish, finish);
    } else {
      img.style.transition = `opacity ${SPLASH_FADE_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
      void img.offsetWidth;
      img.style.opacity = '0';
      img.addEventListener('transitionend', finish, { once: true });
    }
    setTimeout(finish, SPLASH_FADE_MS + 200);
  };
  requestAnimationFrame(tick);
}

function showFallback(msg) {
  dismissBootSplash({ immediate: true });
  const canvas = document.getElementById('canvas');
  if (canvas) canvas.style.display = 'none';
  const el = document.getElementById('fallback');
  if (!el) return;
  el.style.display = 'grid';
  const heading = el.querySelector('strong');
  const p = el.querySelector('[data-msg]');
  if (navigator.onLine === false) {
    if (heading) heading.textContent = "You're offline";
    if (p) p.textContent = 'Reconnect to play Æther.Garden.';
    return;
  }
  if (p && msg) p.textContent = msg;
}

main().catch((err) => {
  console.error(err);
  if (isWebGpuFailure(err)) {
    goAxiom();
    return;
  }
  showFallback(String(err?.message ?? err));
});
