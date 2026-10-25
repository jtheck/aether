// Web Worker - deterministic sim authority (one commitTick = one lockstep step).

import {
  buildField,
  fieldSnapshot,
  mapSizeForConfig,
  STRESS_CAMERA_HALF_F,
  STRESS_SPAWN_CLEAR_TILES,
  TILE_SIZE_F,
  worldHalfZFFromField,
} from '../sim/field.js';
import { applyTableSilhouette } from '../sim/tableShape.js';
import { populateScenery } from '../sim/scenery.js';
import { applyGardenPlacements, decodeGarden, fieldFromGarden, placementOwnersToKeep } from '../sim/garden.js';
import { setupWaveSpawners } from '../sim/waveSpawner.js';
import { setTeamAssignments, setTeamNeutralPairs, teamsFromGarden } from '../sim/teams.js';
import { armStoryProtectFromGarden } from '../sim/storyProtect.js';
import {
  buildWorldFromConfig,
  spawnBases,
  stressReservedPoints,
  stressSpawnDryPads,
} from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { excludeHumanAiPlayers, generateAiCommands } from '../sim/ai.js';
import { generateEconomyCommands } from '../sim/aiEconomy.js';
import { mergeFrames } from '../sim/commandFrame.js';
import { checksum } from '../sim/checksum.js';
import { serializeAgoras } from '../sim/agora.js';
import { serializeBuildings, applyWorldStructureOccupancy } from '../sim/buildings.js';
import { bindDoors, serializeDoors, takeDoorUpdates } from '../sim/doorCombat.js';
import { serializeTech } from '../sim/tech.js';
import { serializeResources } from '../sim/resources.js';
import { serializeOwnerStats } from '../sim/ownerStats.js';
import { exportMatchSnapshot } from '../sim/matchSnapshot.js';
import { takeStorageOverflow } from '../sim/storage.js';
import { takeTreeUpdates } from '../sim/trees.js';
import { takeRockUpdates } from '../sim/scenery.js';
import { takeFireZoneUpdates } from '../sim/fireZones.js';
import { takeFrogUpdates } from '../sim/frogs.js';
import { takeLightningUpdates } from '../sim/lightning.js';
import { takeHolyArmorUpdates } from '../sim/holyArmor.js';
import { takePriestHealUpdates } from '../sim/priestHeal.js';
import { takeSporeBloomUpdates } from '../sim/sporeBloom.js';
import { takeMonkKickUpdates } from '../sim/monkKick.js';
import {
  beginSharedPublish,
  endSharedPublish,
  mapSharedState,
  publishProjectiles,
  publishWorld,
  publishType,
  SHARED_LAYOUT_VERSION,
} from '../sim/sharedState.js';
import {
  exportWorldCheckpoint,
  importWorldCheckpoint,
} from '../sim/worldCheckpoint.js';

// 4 Hz bounds stale presentation state even if a future mutation misses a
// dirty bit, while avoiding three full structured-clone payloads every tick.
const METADATA_SAFETY_REFRESH_TICKS = 5;

function serializeKoth(k) {
  if (!k) return null;
  const bounty = [];
  const n = k.bountyCount | 0;
  for (let i = 0; i < n; i++) {
    bounty.push({
      tick: k.bountyTick?.[i] | 0,
      victim: k.bountyVictim?.[i] | 0,
      points: k.bountyPoints?.[i] | 0,
    });
  }
  return {
    kingOwner: k.kingOwner,
    scores: Array.from(k.scores),
    active: Array.from(k.active),
    eliminated: Array.from(k.eliminated),
    exposed: k.exposed ? Array.from(k.exposed) : [],
    bounty,
  };
}

let world;
let field;
let views;
let aiPlayers = [];

function commandsForTick(frames) {
  let cmds = mergeFrames(frames);
  for (let p = 0; p < aiPlayers.length; p++) {
    const entry = aiPlayers[p];
    const ai = generateAiCommands(world, entry);
    if (ai.length) cmds = cmds ? [...cmds, ...ai] : ai;
    const eco = generateEconomyCommands(world, field, entry);
    if (eco.length) cmds = cmds ? [...cmds, ...eco] : eco;
  }
  return cmds;
}

/** @returns {{ ai: number, merge: number }} */
function commandsForTickTimed(frames) {
  const t0 = performance.now();
  let cmds = mergeFrames(frames);
  const mergeMs = performance.now() - t0;
  const t1 = performance.now();
  for (let p = 0; p < aiPlayers.length; p++) {
    const entry = aiPlayers[p];
    const ai = generateAiCommands(world, entry);
    if (ai.length) cmds = cmds ? [...cmds, ...ai] : ai;
    const eco = generateEconomyCommands(world, field, entry);
    if (eco.length) cmds = cmds ? [...cmds, ...eco] : eco;
  }
  return { cmds, mergeMs, aiMs: performance.now() - t1 };
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      views = mapSharedState(msg.sab);
      aiPlayers = excludeHumanAiPlayers(
        msg.config.aiPlayers ?? [],
        msg.config.humanPlayers ?? [],
      );
      const garden = msg.config.garden ? decodeGarden(msg.config.garden) : null;
      const keepOwners = garden
        ? placementOwnersToKeep(garden, {
          humanPlayers: msg.config.humanPlayers,
          activeSlots: msg.config.activeSlots,
          aiPlayers,
        })
        : null;
      const size = garden
        ? { mapW: garden.width, mapH: garden.height }
        : mapSizeForConfig(msg.config);
      field = garden
        ? fieldFromGarden(msg.config.garden)
        : buildField(msg.config.seed, {
          width: size.mapW,
          height: size.mapH,
          ...((msg.config.stressPerSide | 0) > 0
            ? {
              spawnPads: stressSpawnDryPads((size.mapW * TILE_SIZE_F) / 2),
              spawnPadClearTiles: STRESS_SPAWN_CLEAR_TILES,
            }
            : {}),
        });
      if (!garden && (msg.config.stressPerSide | 0) > 0) {
        field.cameraHalfF = STRESS_CAMERA_HALF_F;
      }
      world = buildWorldFromConfig({
        ...msg.config,
        mapW: field.width,
        mapH: field.height,
        skipDefaultSpawns: !!(
          msg.config.skipDefaultSpawns
          || garden?.units?.length
          || garden?.story
          || garden?.objectives?.length
          || (keepOwners && garden?.agoras?.length)
        ),
        agoraOccupyEndsMatch: msg.config.agoraOccupyEndsMatch != null
          ? msg.config.agoraOccupyEndsMatch
          : (garden?.story || garden?.objectives?.length ? 0 : undefined),
      });
      // Stress / explicit flag - timing never feeds gameplay.
      world.profileSim = msg.config.profileSim === true
        || (msg.config.stressPerSide | 0) > 0
        || (msg.config.animStressPerSide | 0) > 0;
      if (garden) {
        applyGardenPlacements(world, field, garden, {
          keep: keepOwners,
          spawnSeed: msg.config.spawnSeed != null
            ? msg.config.spawnSeed >>> 0
            : (msg.config.seed ?? 0) >>> 0,
        });
      }
      if (garden?.objectives?.length) setupWaveSpawners(world, field, garden.objectives);
      const teams = teamsFromGarden(garden);
      if (teams) setTeamAssignments(teams);
      setTeamNeutralPairs(garden?.neutralTeams ?? null);
      armStoryProtectFromGarden(world, garden);
      if (!garden) {
        field.suppressCenterBlock = !!msg.config.noCenterBlock;
        applyTableSilhouette(field);
      }
      if (!garden?.authoredScenery) {
        const kothDrop = msg.config.mode === 'koth' && !msg.config.homeAgoras;
        const reserved = [];
        if (!kothDrop) {
          reserved.push(...spawnBases(field.worldHalfF, {
            laneBases: !!msg.config.laneBases,
            mapW: field.width,
            worldHalfZF: worldHalfZFFromField(field),
          }));
        }
        if ((msg.config.stressPerSide | 0) > 0) {
          reserved.push(...stressReservedPoints(field.worldHalfF));
        }
        if (garden) {
          const half = field.worldHalfF;
          const halfZ = worldHalfZFFromField(field);
          for (const u of garden.units) {
            reserved.push([
              (u.tx + 0.5) * TILE_SIZE_F - half,
              (u.tz + 0.5) * TILE_SIZE_F - halfZ,
            ]);
          }
        }
        populateScenery(field, world, reserved, kothDrop ? { reserveTrees: false } : undefined);
      }
      applyWorldStructureOccupancy(field, world);
      bindDoors(world, field);
      beginSharedPublish(views);
      publishType(world, views);
      publishWorld(world, views);
      publishProjectiles(world, views);
      endSharedPublish(views);
      postMessage({
        type: 'ready',
        count: world.count,
        field: fieldSnapshot(field),
        layoutVersion: SHARED_LAYOUT_VERSION,
        agoras: serializeAgoras(world.agoras),
        buildings: serializeBuildings(world.buildings),
        doors: serializeDoors(world.doors),
        tech: serializeTech(world),
        resources: serializeResources(world),
        checksum: checksum(world, field),
        profileSim: !!world.profileSim,
      });
    } else if (msg.type === 'setProfileSim') {
      if (world) world.profileSim = !!msg.enabled;
      postMessage({ type: 'profileSim', enabled: !!world?.profileSim });
    } else if (msg.type === 'commitTick') {
      const expect = (msg.tick | 0);
      if (expect > 0 && expect !== world.tick + 1) {
        throw new Error(`commitTick expect ${expect}, world.tick=${world.tick}`);
      }
      const tTick = performance.now();
      let cmds;
      let mergeMs = 0;
      let aiMs = 0;
      if (world.profileSim) {
        const timed = commandsForTickTimed(msg.frames);
        cmds = timed.cmds;
        mergeMs = timed.mergeMs;
        aiMs = timed.aiMs;
      } else {
        cmds = commandsForTick(msg.frames);
      }
      step(world, field, cmds);
      const tPub0 = performance.now();
      beginSharedPublish(views);
      publishWorld(world, views);
      // Type changes in place (villager → brigand, warrior → champion). New
      // spawns are not the only time the renderer needs a fresh type.
      publishType(world, views);
      publishProjectiles(world, views);
      endSharedPublish(views);
      const publishMs = performance.now() - tPub0;
      const treeUpdates = takeTreeUpdates(field);
      const rockUpdates = takeRockUpdates(field);
      const fireZoneUpdates = takeFireZoneUpdates(world);
      const frogUpdates = takeFrogUpdates(world);
      const lightningUpdates = takeLightningUpdates(world);
      const holyArmorUpdates = takeHolyArmorUpdates(world);
      const priestHealUpdates = takePriestHealUpdates(world);
      const sporeBloomUpdates = takeSporeBloomUpdates(world);
      const monkKickUpdates = takeMonkKickUpdates(world);
      const safetyRefresh = world.tick % METADATA_SAFETY_REFRESH_TICKS === 0;
      const buildingsChanged = !!world.buildingsDirty || safetyRefresh;
      const doorUpdates = takeDoorUpdates(world);
      if (world.buildingsDirty) world.buildingsDirty = 0;
      const techChanged = !!world.techDirty || safetyRefresh;
      if (world.techDirty) world.techDirty = 0;
      const resourcesChanged = !!world.resourcesDirty || safetyRefresh;
      if (world.resourcesDirty) world.resourcesDirty = 0;
      const storageOverflow = takeStorageOverflow(world);
      const metrics = { ...world.metrics };
      if (world.profileSim) {
        metrics.timing = {
          ...(world.metrics.timing ?? {}),
          merge: mergeMs,
          ai: aiMs,
          publish: publishMs,
          tick: performance.now() - tTick,
        };
      }
      postMessage({
        type: 'stepDone',
        tick: world.tick,
        checksum: checksum(world, field),
        metrics,
        kothMatchOver: world.kothMatchOver ?? 0,
        matchWinner: world.matchWinner ?? -1,
        koth: serializeKoth(world.koth),
        ...(buildingsChanged
          ? { buildings: serializeBuildings(world.buildings), buildingsChanged: true }
          : null),
        doorUpdates,
        agoras: serializeAgoras(world.agoras),
        ...(techChanged ? { tech: serializeTech(world), techChanged: true } : null),
        ...(resourcesChanged
          ? { resources: serializeResources(world), resourcesChanged: true }
          : null),
        ownerStats: serializeOwnerStats(world),
        ...(function snapFrame() {
          const bounty = world.koth?.bounty?.length | 0;
          const ended = (world.matchWinner | 0) >= 0;
          const send = world.snapSampled || bounty !== (world.snapBounty | 0) || (ended && !world.snapEnded);
          if (!send) return null;
          world.snapSampled = 0;
          world.snapBounty = bounty;
          if (ended) world.snapEnded = 1;
          return { snap: exportMatchSnapshot(world) };
        })(),
        storageOverflow,
        treeUpdates,
        rockUpdates,
        fireZoneUpdates,
        frogUpdates,
        lightningUpdates,
        holyArmorUpdates,
        priestHealUpdates,
        sporeBloomUpdates,
        monkKickUpdates,
      });
    } else if (msg.type === 'exportCheckpoint') {
      if (!world || !field) throw new Error('exportCheckpoint before init');
      const cs = checksum(world, field);
      const checkpoint = exportWorldCheckpoint(world, field, cs);
      postMessage({
        type: 'checkpoint',
        requestId: msg.requestId,
        tick: world.tick,
        checksum: cs,
        checkpoint,
      });
    } else if (msg.type === 'importCheckpoint') {
      if (!world || !field) throw new Error('importCheckpoint before init');
      const tick = importWorldCheckpoint(world, field, msg.checkpoint);
      beginSharedPublish(views);
      publishType(world, views);
      publishWorld(world, views);
      publishProjectiles(world, views);
      endSharedPublish(views);
      const cs = checksum(world, field);
      if (msg.expectedChecksum != null && cs !== (msg.expectedChecksum >>> 0)) {
        throw new Error(
          `checkpoint checksum mismatch: got ${cs.toString(16)}, expected ${(msg.expectedChecksum >>> 0).toString(16)}`,
        );
      }
      postMessage({
        type: 'checkpointImported',
        requestId: msg.requestId,
        tick,
        checksum: cs,
        count: world.count,
        koth: serializeKoth(world.koth),
        kothMatchOver: world.kothMatchOver ?? 0,
      });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message ?? err), stack: err?.stack });
  }
};
