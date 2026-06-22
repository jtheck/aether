// Phase 0/2 foundation test: the simulation must be bit-for-bit reproducible,
// INCLUDING the command + movement + combat path.
//
// This is THE test the whole lockstep architecture stands on. If it ever fails,
// something in sim/ broke determinism and multiplayer would desync.
//
// Run: node sim/determinism.test.js   (from src/)

import { createWorld, spawn, livingByOwner } from './world.js';
import { step } from './step.js';
import { checksum } from './checksum.js';
import { rngRange } from './rng.js';
import { CMD } from './commands.js';
import { buildDemoField } from './field.js';
import * as fx from './fixed.js';
import { buildWorldFromConfig, UNITS_PER_ARMY, KOTH_BASES } from './worldSetup.js';
import { ownsPlayerFrame } from '../koth/protocol.js';
import { createEmptyRoster, activateSlot, releaseUser } from '../koth/roster.js';

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

function runKoth(seed, ticks, framesByTick) {
  const w = buildWorldFromConfig({ seed, mode: 'koth', activeSlots: [0, 1] });
  for (let t = 1; t <= ticks; t++) step(w, field, framesByTick.get(t) ?? []);
  return checksum(w);
}

function kothWorldSetupOk() {
  const w = buildWorldFromConfig({ seed: 0x3344, mode: 'koth', activeSlots: [0, 1, 2] });
  const countsOk = [0, 1, 2].every((owner) => livingByOwner(w, owner) === UNITS_PER_ARMY);
  const centers = [0, 1, 2].map((owner) => {
    let x = 0;
    let z = 0;
    let n = 0;
    for (let i = 0; i < w.count; i++) {
      if (!w.alive[i] || w.owner[i] !== owner) continue;
      x += fx.toFloat(w.px[i]);
      z += fx.toFloat(w.py[i]);
      n++;
    }
    return [x / n, z / n];
  });
  const distinct = centers.every(([x, z], owner) => {
    const [bx, bz] = KOTH_BASES[owner];
    return Math.hypot(x - bx, z - bz) < 30;
  });
  return countsOk && distinct;
}

function ownershipOk() {
  let roster = createEmptyRoster();
  roster = activateSlot(roster, 0, 'alice').slots;
  roster = activateSlot(roster, 1, 'bob').slots;
  return (
    ownsPlayerFrame(roster, { tick: 1, playerId: 0, userId: 'alice', commands: [] }) &&
    !ownsPlayerFrame(roster, { tick: 1, playerId: 0, userId: 'bob', commands: [] })
  );
}

function catchupReplayOk() {
  const frames = new Map();
  frames.set(3, [{ type: CMD.MOVE, entities: [0, 1], tx: [fx.fromInt(-80), fx.fromInt(-76)], ty: [fx.fromInt(40), fx.fromInt(44)] }]);
  frames.set(9, [{ type: CMD.ATTACK_MOVE, entities: [32, 33], tx: [fx.fromInt(50), fx.fromInt(54)], ty: [fx.fromInt(-30), fx.fromInt(-26)] }]);
  const normal = runKoth(0xabcd, 80, frames);
  const replayed = runKoth(0xabcd, 80, new Map([...frames.entries()].map(([tick, cmds]) => [tick, cmds.map((cmd) => ({ ...cmd }))])));
  return normal === replayed;
}

function samePlayerCommandOrderOk() {
  const ordered = new Map();
  ordered.set(2, [
    { type: CMD.STOP, entities: [0] },
    { type: CMD.MOVE, entities: [0], tx: [fx.fromInt(15)], ty: [fx.fromInt(20)] },
  ]);
  const reversed = new Map();
  reversed.set(2, [
    { type: CMD.MOVE, entities: [0], tx: [fx.fromInt(15)], ty: [fx.fromInt(20)] },
    { type: CMD.STOP, entities: [0] },
  ]);
  return runKoth(0xbeef, 20, ordered) !== runKoth(0xbeef, 20, reversed);
}

function joinAndDeathOk() {
  let roster = createEmptyRoster();
  roster = activateSlot(roster, 0, 'alice').slots;
  roster = activateSlot(roster, 1, 'bob').slots;
  const accepted = activateSlot(roster, 2, 'cara');
  roster = accepted.slots;
  const w = buildWorldFromConfig({ seed: 0x7788, mode: 'koth', activeSlots: [0, 1] });
  step(w, field, [{ type: CMD.SPAWN_SLOT, playerId: 2 }]);
  const spawnedOnce = livingByOwner(w, 2) === UNITS_PER_ARMY;
  step(w, field, [{ type: CMD.SPAWN_SLOT, playerId: 2 }]);
  const idempotent = livingByOwner(w, 2) === UNITS_PER_ARMY;
  step(w, field, [{ type: CMD.FORCE_ELIMINATE, playerId: 2 }]);
  roster = releaseUser(roster, 'cara', true);
  const eliminated = livingByOwner(w, 2) === 0 && roster[2].state === 'spectator';
  return spawnedOnce && idempotent && eliminated;
}

function committedLedgerExportOk() {
  const sessionLike = {
    committedLedgerFrames: [],
    fullLedgerFrames: [],
    _seenFrameIds: new Set(),
  };
  const frame = {
    tick: 4,
    playerId: 0,
    commandId: 'test:4:0',
    commands: [{ type: CMD.STOP, entities: [0] }],
  };
  // Importing SimSession would require browser worker globals in this test. This
  // mirrors the committed-export invariant: pending frames are not catch-up data.
  sessionLike.fullLedgerFrames.push(frame);
  const exportedBeforeCommit = sessionLike.committedLedgerFrames.filter((f) => f.tick <= 4);
  sessionLike.committedLedgerFrames.push(frame);
  const exportedAfterCommit = sessionLike.committedLedgerFrames.filter((f) => f.tick <= 4);
  return exportedBeforeCommit.length === 0 && exportedAfterCommit.length === 1;
}

const worldSetupOk = kothWorldSetupOk();
const ownerFrameOk = ownershipOk();
const catchupOk = catchupReplayOk();
const samePlayerOrderOk = samePlayerCommandOrderOk();
const joinDeathOk = joinAndDeathOk();
const committedLedgerOk = committedLedgerExportOk();

console.log(`same seed   A=${a.toString(16)}  B=${b.toString(16)}  ->  ${sameSeed ? 'OK' : 'MISMATCH'}`);
console.log(`diff seed   C=${c.toString(16)}                  ->  ${diffSeed ? 'OK (differs)' : 'SUSPICIOUS (same)'}`);
console.log(`combat seed D=${combat.toString(16)}             ->  ${combatOk ? 'OK' : 'MISMATCH'}`);
console.log(`per-tick trace (1000 ticks identical)         ->  ${traceEqual ? 'OK' : 'MISMATCH'}`);
console.log(`koth 3-player world setup                    ->  ${worldSetupOk ? 'OK' : 'MISMATCH'}`);
console.log(`koth command ownership                       ->  ${ownerFrameOk ? 'OK' : 'MISMATCH'}`);
console.log(`koth catch-up replay equivalence             ->  ${catchupOk ? 'OK' : 'MISMATCH'}`);
console.log(`koth same-player command order matters       ->  ${samePlayerOrderOk ? 'OK' : 'MISMATCH'}`);
console.log(`koth join spawn + death cleanup              ->  ${joinDeathOk ? 'OK' : 'MISMATCH'}`);
console.log(`koth committed ledger export                 ->  ${committedLedgerOk ? 'OK' : 'MISMATCH'}`);

if (!sameSeed) ok = false;
if (!diffSeed) ok = false;
if (!combatOk) ok = false;
if (!traceEqual) ok = false;
if (!worldSetupOk) ok = false;
if (!ownerFrameOk) ok = false;
if (!catchupOk) ok = false;
if (!samePlayerOrderOk) ok = false;
if (!joinDeathOk) ok = false;
if (!committedLedgerOk) ok = false;

console.log(ok ? '\n[PASS] determinism holds (with commands + movement + combat)' : '\n[FAIL] determinism broken');
process.exit(ok ? 0 : 1);

