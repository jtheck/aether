// Web Worker — deterministic sim authority (one commitTick = one lockstep step).

import { buildField, fieldSnapshot, mapSizeForConfig } from '../sim/field.js';
import { populateScenery } from '../sim/scenery.js';
import { buildWorldFromConfig, kothBases } from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { generateAiCommands } from '../sim/ai.js';
import { mergeFrames } from '../sim/commandFrame.js';
import { checksum } from '../sim/checksum.js';
import { serializeAgoras } from '../sim/agora.js';
import { serializeBuildings, applyWorldStructureOccupancy } from '../sim/buildings.js';
import { serializeTech } from '../sim/tech.js';
import { takeTreeUpdates } from '../sim/trees.js';
import { takeFireZoneUpdates } from '../sim/fireZones.js';
import { takeFrogUpdates } from '../sim/frogs.js';
import { takeLightningUpdates } from '../sim/lightning.js';
import { takeHolyArmorUpdates } from '../sim/holyArmor.js';
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

function serializeKoth(k) {
  if (!k) return null;
  return {
    kingOwner: k.kingOwner,
    scores: Array.from(k.scores),
    active: Array.from(k.active),
    eliminated: Array.from(k.eliminated),
  };
}

let world;
let field;
let views;
let aiPlayers = [];
let publishedTypeCount = 0;

function commandsForTick(frames) {
  let cmds = mergeFrames(frames);
  for (let p = 0; p < aiPlayers.length; p++) {
    const entry = aiPlayers[p];
    const ai = generateAiCommands(world, entry);
    if (ai.length) cmds = cmds ? [...cmds, ...ai] : ai;
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
  }
  return { cmds, mergeMs, aiMs: performance.now() - t1 };
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      views = mapSharedState(msg.sab);
      aiPlayers = msg.config.aiPlayers ?? [];
      const size = mapSizeForConfig(msg.config);
      field = buildField(msg.config.seed, { width: size.mapW, height: size.mapH });
      world = buildWorldFromConfig({ ...msg.config, mapW: size.mapW, mapH: size.mapH });
      // Stress / explicit flag — timing never feeds gameplay.
      world.profileSim = msg.config.profileSim === true
        || (msg.config.stressPerSide | 0) > 0
        || (msg.config.animStressPerSide | 0) > 0;
      populateScenery(field, world, kothBases(field.worldHalfF));
      applyWorldStructureOccupancy(field, world);
      beginSharedPublish(views);
      publishType(world, views);
      publishedTypeCount = world.count;
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
        tech: serializeTech(world),
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
      if (world.count > publishedTypeCount) {
        publishType(world, views, publishedTypeCount);
        publishedTypeCount = world.count;
      }
      publishProjectiles(world, views);
      endSharedPublish(views);
      const publishMs = performance.now() - tPub0;
      const treeUpdates = takeTreeUpdates(field);
      const fireZoneUpdates = takeFireZoneUpdates(world);
      const frogUpdates = takeFrogUpdates(world);
      const lightningUpdates = takeLightningUpdates(world);
      const holyArmorUpdates = takeHolyArmorUpdates(world);
      const sporeBloomUpdates = takeSporeBloomUpdates(world);
      const monkKickUpdates = takeMonkKickUpdates(world);
      const buildingsChanged = !!world.buildingsDirty;
      if (world.buildingsDirty) world.buildingsDirty = 0;
      const techChanged = !!world.techDirty;
      if (world.techDirty) world.techDirty = 0;
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
        buildings: serializeBuildings(world.buildings),
        buildingsChanged,
        tech: serializeTech(world),
        techChanged,
        treeUpdates,
        fireZoneUpdates,
        frogUpdates,
        lightningUpdates,
        holyArmorUpdates,
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
      publishedTypeCount = world.count;
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
