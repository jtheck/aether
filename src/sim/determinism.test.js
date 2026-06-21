// Phase 0/2 foundation test: the simulation must be bit-for-bit reproducible,
// INCLUDING the command + movement + combat path.
//
// This is THE test the whole lockstep architecture stands on. If it ever fails,
// something in sim/ broke determinism and multiplayer would desync.
//
// Run: node sim/determinism.test.js   (from src/)

import { createWorld, spawn } from './world.js';
import { step } from './step.js';
import { checksum } from './checksum.js';
import { rngRange } from './rng.js';
import { CMD } from './commands.js';
import { buildDemoField } from './field.js';
import * as fx from './fixed.js';

const field = buildDemoField(0xabc);

function build(seed) {
  const w = createWorld(seed);
  for (let i = 0; i < 300; i++) {
    spawn(w, {
      x: fx.fromInt(rngRange(w.rng, -200, 200)),
      y: fx.fromInt(rngRange(w.rng, -200, 200)),
      hp: rngRange(w.rng, 50, 200),
      type: rngRange(w.rng, 0, 5),
      owner: rngRange(w.rng, 0, 4),
    });
  }
  return w;
}

function moveAllCommand(w) {
  const entities = [];
  const tx = [];
  const ty = [];
  for (let i = 0; i < w.count; i++) {
    entities.push(i);
    tx.push(fx.fromInt(rngRange(w.rng, -200, 200)));
    ty.push(fx.fromInt(rngRange(w.rng, -200, 200)));
  }
  return [{ type: CMD.MOVE, entities, tx, ty }];
}

function attackPairCommand(w) {
  if (w.count < 2) return [];
  return [{ type: CMD.ATTACK, entities: [0], target: 1 }];
}

function runFinal(seed, ticks, extraCmd) {
  const w = build(seed);
  step(w, field, extraCmd ? extraCmd(w) : moveAllCommand(w));
  for (let t = 1; t < ticks; t++) step(w, field);
  return checksum(w);
}

function runTrace(seed, ticks) {
  const w = build(seed);
  const trace = new Array(ticks);
  step(w, field, moveAllCommand(w));
  trace[0] = checksum(w);
  for (let t = 1; t < ticks; t++) {
    step(w, field);
    trace[t] = checksum(w);
  }
  return trace;
}

const TICKS = 5000;
let ok = true;

const a = runFinal(0x1234, TICKS);
const b = runFinal(0x1234, TICKS);
const c = runFinal(0x9999, TICKS);
const combat = runFinal(0x5555, TICKS, attackPairCommand);

const sameSeed = a === b;
const diffSeed = a !== c;
const combatOk = combat === runFinal(0x5555, TICKS, attackPairCommand);

const ta = runTrace(0x777, 1000);
const tb = runTrace(0x777, 1000);
const traceEqual = ta.length === tb.length && ta.every((v, i) => v === tb[i]);

console.log(`same seed   A=${a.toString(16)}  B=${b.toString(16)}  ->  ${sameSeed ? 'OK' : 'MISMATCH'}`);
console.log(`diff seed   C=${c.toString(16)}                  ->  ${diffSeed ? 'OK (differs)' : 'SUSPICIOUS (same)'}`);
console.log(`combat seed D=${combat.toString(16)}             ->  ${combatOk ? 'OK' : 'MISMATCH'}`);
console.log(`per-tick trace (1000 ticks identical)         ->  ${traceEqual ? 'OK' : 'MISMATCH'}`);

if (!sameSeed) ok = false;
if (!diffSeed) ok = false;
if (!combatOk) ok = false;
if (!traceEqual) ok = false;

console.log(ok ? '\n[PASS] determinism holds (with commands + movement + combat)' : '\n[FAIL] determinism broken');
process.exit(ok ? 0 : 1);
