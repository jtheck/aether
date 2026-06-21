// Web Worker — deterministic sim authority (one commitTick = one lockstep step).

import { buildDemoField } from '../sim/field.js';
import { buildWorldFromConfig, PLAYER } from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { generateAiCommands } from '../sim/ai.js';
import { mergeFrames } from '../sim/commandFrame.js';
import { checksum } from '../sim/checksum.js';
import { mapSharedState, publishWorld, publishType } from '../sim/sharedState.js';

let world;
let field;
let views;
let aiPlayers = [];

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
      field = buildDemoField(msg.config.seed);
      world = buildWorldFromConfig(msg.config);
      publishType(world, views);
      publishWorld(world, views);
      postMessage({ type: 'ready', count: world.count });
    } else if (msg.type === 'commitTick') {
      step(world, field, commandsForTick(msg.frames));
      publishWorld(world, views);
      postMessage({ type: 'stepDone', tick: world.tick, checksum: checksum(world) });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message ?? err), stack: err?.stack });
  }
};
