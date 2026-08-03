// Headless deterministic scale benchmark. Timing is diagnostic only and never
// enters authoritative simulation state.

import { performance } from 'node:perf_hooks';
import * as fx from './fixed.js';
import { checksum } from './checksum.js';
import { CMD } from './commands.js';
import { buildField, WORLD_HALF_F, mapSizeForConfig, setActiveMapSize } from './field.js';
import {
  mapSharedState,
  publishProjectiles,
  publishType,
  publishWorld,
  simSharedByteSize,
} from './sharedState.js';
import { step } from './step.js';
import { spawnProjectile } from './projectiles.js';
import { PROJECTILE } from './projectileTypes.js';
import { UNIT } from './unitTypes.js';
import { buildWorldFromConfig } from './worldSetup.js';

const args = new Set(process.argv.slice(2));
const counts = args.has('--acceptance') ? [50000] : [1000, 8000, 20000, 50000];
const scenarioNames = [
  'idle-acquisition',
  'mass-move',
  'active-combat',
  'dense-cells',
  'ranged-combat',
  'saturated-projectiles',
];

function buildScenario(count, scenario) {
  const w = buildWorldFromConfig({ seed: 0x50ca1e, stressPerSide: count >> 1 });
  if (scenario === 'active-combat') {
    for (let i = 0; i < w.count; i++) w.owner[i] = i & 1;
  } else if (scenario === 'ranged-combat') {
    for (let i = 0; i < w.count; i++) {
      w.type[i] = UNIT.ARCHER;
      w.owner[i] = i & 1;
    }
  } else if (scenario === 'dense-cells') {
    const origin = -(w.worldHalfF ?? WORLD_HALF_F) + 4;
    for (let i = 0; i < w.count; i++) {
      const cell = i % 10000;
      const lane = (i / 10000) | 0;
      const cx = cell % 100;
      const cz = (cell / 100) | 0;
      w.px[i] = fx.fromFloat(origin + cx * 8 + 1 + lane);
      w.py[i] = fx.fromFloat(origin + cz * 8 + 1 + lane);
      w.owner[i] = 0;
    }
  } else if (scenario === 'saturated-projectiles') {
    const projectileCount = Math.min(16000, w.count);
    for (let i = 0; i < projectileCount; i++) {
      spawnProjectile(w, {
        type: PROJECTILE.ARROW,
        owner: w.owner[i],
        source: i,
        target: -1,
        x: w.px[i],
        y: w.py[i],
        aimX: -w.px[i],
        aimY: -w.py[i],
        damage: 1,
      });
    }
  }
  return w;
}

function massMoveCommand(w) {
  const entities = new Array(w.count);
  const tx = new Array(w.count);
  const ty = new Array(w.count);
  for (let i = 0; i < w.count; i++) {
    entities[i] = i;
    tx[i] = -w.px[i];
    ty[i] = -w.py[i];
  }
  return [{ type: CMD.MOVE, entities, tx, ty }];
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function runScenario(count, scenario) {
  const size = mapSizeForConfig({ stressPerSide: count >> 1 });
  const field = buildField(0x50ca1e, { width: size.mapW, height: size.mapH });
  const w = buildScenario(count, scenario);
  const shared = mapSharedState(new SharedArrayBuffer(simSharedByteSize()));
  publishType(w, shared);
  publishWorld(w, shared);
  publishProjectiles(w, shared);
  const samples = [];
  const ticks = count >= 50000 ? 8 : 4;
  let command = scenario === 'mass-move' ? massMoveCommand(w) : undefined;
  for (let tick = 0; tick < ticks; tick++) {
    const start = performance.now();
    step(w, field, command);
    publishWorld(w, shared);
    publishProjectiles(w, shared);
    checksum(w);
    samples.push(performance.now() - start);
    command = undefined;
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    mean,
    p95: percentile(samples, 0.95),
    checksum: checksum(w),
    metrics: { ...w.metrics },
  };
}

let acceptanceP95 = 0;
for (const count of counts) {
  for (const scenario of scenarioNames) {
    const result = runScenario(count, scenario);
    if (count === 50000) acceptanceP95 = Math.max(acceptanceP95, result.p95);
    console.log(
      `${String(count).padStart(5)} ${scenario.padEnd(16)} ` +
      `mean=${result.mean.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms ` +
      `candidates=${result.metrics.combatCandidates} pairs=${result.metrics.separationPairs} ` +
      `los=${result.metrics.losAttempts} astar=${result.metrics.astarSearches} ` +
      `proj=${result.metrics.projectileActive} hits=${result.metrics.projectileHits} ` +
      `miss=${result.metrics.projectileMisses} overflow=${result.metrics.projectileOverflow} ` +
      `sum=${result.checksum.toString(16)}`,
    );
  }
}

console.log(`50k worst p95=${acceptanceP95.toFixed(2)}ms (target <=50ms)`);
if (args.has('--enforce') && acceptanceP95 > 50) process.exitCode = 1;
