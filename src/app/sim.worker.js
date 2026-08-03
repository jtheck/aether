// Web Worker — deterministic sim authority (one commitTick = one lockstep step).

import { buildField, fieldSnapshot, mapSizeForConfig } from '../sim/field.js';
import { populateScenery } from '../sim/scenery.js';
import { buildWorldFromConfig, kothBases } from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { generateAiCommands } from '../sim/ai.js';
import { mergeFrames } from '../sim/commandFrame.js';
import { checksum } from '../sim/checksum.js';
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

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      views = mapSharedState(msg.sab);
      aiPlayers = msg.config.aiPlayers ?? [];
      const size = mapSizeForConfig(msg.config);
      field = buildField(msg.config.seed, { width: size.mapW, height: size.mapH });
      world = buildWorldFromConfig({ ...msg.config, mapW: size.mapW, mapH: size.mapH });
      populateScenery(field, world, kothBases(field.worldHalfF));
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
      });
    } else if (msg.type === 'commitTick') {
      step(world, field, commandsForTick(msg.frames));
      beginSharedPublish(views);
      publishWorld(world, views);
      if (world.count > publishedTypeCount) {
        publishType(world, views, publishedTypeCount);
        publishedTypeCount = world.count;
      }
      publishProjectiles(world, views);
      endSharedPublish(views);
      const treeUpdates = takeTreeUpdates(field);
      const fireZoneUpdates = takeFireZoneUpdates(world);
      const frogUpdates = takeFrogUpdates(world);
      const lightningUpdates = takeLightningUpdates(world);
      const holyArmorUpdates = takeHolyArmorUpdates(world);
      const sporeBloomUpdates = takeSporeBloomUpdates(world);
      const monkKickUpdates = takeMonkKickUpdates(world);
      postMessage({
        type: 'stepDone',
        tick: world.tick,
        checksum: checksum(world, field),
        metrics: { ...world.metrics },
        kothMatchOver: world.kothMatchOver ?? 0,
        koth: serializeKoth(world.koth),
        treeUpdates,
        fireZoneUpdates,
        frogUpdates,
        lightningUpdates,
        holyArmorUpdates,
        sporeBloomUpdates,
        monkKickUpdates,
      });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message ?? err), stack: err?.stack });
  }
};
