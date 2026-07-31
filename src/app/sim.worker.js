// Web Worker — deterministic sim authority (one commitTick = one lockstep step).

import { buildField, fieldSnapshot } from '../sim/field.js';
import { populateScenery } from '../sim/scenery.js';
import { buildWorldFromConfig, KOTH_BASES, PLAYER } from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { generateAiCommands } from '../sim/ai.js';
import { mergeFrames } from '../sim/commandFrame.js';
import { checksum } from '../sim/checksum.js';
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
    const ai = generateAiCommands(world, aiPlayers[p], PLAYER);
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
      field = buildField(msg.config.seed);
      world = buildWorldFromConfig(msg.config);
      populateScenery(field, world, KOTH_BASES);
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
      postMessage({
        type: 'stepDone',
        tick: world.tick,
        checksum: checksum(world),
        metrics: { ...world.metrics },
        kothMatchOver: world.kothMatchOver ?? 0,
        koth: serializeKoth(world.koth),
      });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message ?? err), stack: err?.stack });
  }
};
