// Web Worker — owns the deterministic sim tick (step + AI + pathfinding).

import { buildDemoField } from '../sim/field.js';
import { buildWorldFromConfig, PLAYER, AI_OWNER } from '../sim/worldSetup.js';
import { step } from '../sim/step.js';
import { generateAiCommands } from '../sim/ai.js';
import { mapSharedState, publishWorld, publishType } from '../sim/sharedState.js';

let world;
let field;
let views;
let stressAiOff;

function mergeCommands(playerCmds) {
  let cmds = playerCmds?.length ? [...playerCmds] : null;
  if (!stressAiOff) {
    const ai = generateAiCommands(world, AI_OWNER, PLAYER);
    if (ai.length) cmds = cmds ? [...cmds, ...ai] : ai;
  }
  return cmds;
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      views = mapSharedState(msg.sab);
      stressAiOff = msg.config.stressPerSide > 0;
      field = buildDemoField(msg.config.seed);
      world = buildWorldFromConfig(msg.config);
      publishType(world, views);
      publishWorld(world, views);
      postMessage({ type: 'ready', count: world.count });
    } else if (msg.type === 'step') {
      const steps = msg.steps ?? 1;
      for (let s = 0; s < steps; s++) {
        const cmds = s === 0 ? mergeCommands(msg.commands) : mergeCommands(null);
        step(world, field, cmds);
      }
      publishWorld(world, views);
      postMessage({ type: 'stepDone', tick: world.tick });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message ?? err), stack: err?.stack });
  }
};
