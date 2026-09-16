import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world.js';
import { UNIT } from './unitTypes.js';
import {
  WAVE_BASE_COUNT,
  WAVE_ENEMY_OWNER,
  WAVE_FIRST_DELAY_TICKS,
  WAVE_INTERVAL_TICKS,
  setupWaveSpawners,
  waveSpawnerSystem,
} from './waveSpawner.js';

// Minimal field stub — field=null path in the system skips snap/queuePath, which
// keeps the unit test focused on schedule + determinism (no pathing dependency).
const FIELD = { width: 112, height: 112, worldHalfF: 224 };
const MILITARY = new Set([UNIT.WARRIOR, UNIT.ARCHER, UNIT.WARLOCK]);

function runSchedule(seed, defObjectives, ticks) {
  const world = createWorld(seed);
  setupWaveSpawners(world, FIELD, defObjectives);
  const spawnTicks = [];
  let last = 0;
  for (let t = 0; t <= ticks; t++) {
    world.tick = t;
    waveSpawnerSystem(world, null);
    if (world.count !== last) {
      spawnTicks.push({ tick: t, added: world.count - last });
      last = world.count;
    }
  }
  return { world, spawnTicks };
}

describe('wave spawner schedule', () => {
  const objectives = [{ kind: 'survive', tx: 56, tz: 56, r: 6, params: { waves: 3 } }];

  it('does nothing before the first-wave delay', () => {
    const { world } = runSchedule(1234, objectives, WAVE_FIRST_DELAY_TICKS - 1);
    assert.equal(world.count, 0);
  });

  it('releases escalating waves on cadence, then stops after N', () => {
    const total = WAVE_FIRST_DELAY_TICKS + WAVE_INTERVAL_TICKS * 4;
    const { world, spawnTicks } = runSchedule(1234, objectives, total);
    assert.equal(spawnTicks.length, 3, 'exactly three waves');
    assert.equal(spawnTicks[0].tick, WAVE_FIRST_DELAY_TICKS);
    assert.equal(spawnTicks[1].tick, WAVE_FIRST_DELAY_TICKS + WAVE_INTERVAL_TICKS);
    assert.equal(spawnTicks[2].tick, WAVE_FIRST_DELAY_TICKS + WAVE_INTERVAL_TICKS * 2);
    assert.equal(spawnTicks[0].added, WAVE_BASE_COUNT);
    assert.equal(spawnTicks[1].added, WAVE_BASE_COUNT + 1);
    assert.equal(spawnTicks[2].added, WAVE_BASE_COUNT + 2);
    assert.equal(world.count, WAVE_BASE_COUNT * 3 + 3); // 3+4+5
  });

  it('spawns hostile military owned by the campaign enemy owner', () => {
    const { world } = runSchedule(1234, objectives, WAVE_FIRST_DELAY_TICKS);
    for (let i = 0; i < world.count; i++) {
      assert.equal(world.owner[i], WAVE_ENEMY_OWNER);
      assert.ok(MILITARY.has(world.type[i]), `unit ${i} is a military type`);
      assert.equal(world.alive[i], 1);
    }
  });

  it('gives each wave unit a single attack-move rally by default', () => {
    const { world } = runSchedule(1234, objectives, WAVE_FIRST_DELAY_TICKS);
    for (let i = 0; i < world.count; i++) {
      assert.equal(world.order[i], world.ORDER.ATTACK_MOVE);
      assert.equal(world.hasTarget[i], 1);
      assert.equal(world.rallyHopCount[i], 0);
    }
  });

  it('chains multi-rally hops when the objective authors an approach route', () => {
    const routed = [{
      kind: 'survive',
      tx: 56,
      tz: 56,
      r: 6,
      params: { waves: 2, route: [[0.5, 0.1], [0.5, 0.3], [0.5, 0.45]] },
    }];
    const { world } = runSchedule(1234, routed, WAVE_FIRST_DELAY_TICKS);
    assert.ok(world.count > 0);
    for (let i = 0; i < world.count; i++) {
      assert.equal(world.order[i], world.ORDER.ATTACK_MOVE);
      // staging → dest + hop1 + hop2 (objective) = two rally hops
      assert.equal(world.rallyHopCount[i], 2);
    }
  });

  it('is deterministic — same seed reproduces counts, types, and positions', () => {
    const total = WAVE_FIRST_DELAY_TICKS + WAVE_INTERVAL_TICKS * 3;
    const a = runSchedule(9876, objectives, total).world;
    const b = runSchedule(9876, objectives, total).world;
    assert.equal(a.count, b.count);
    assert.equal(a.rng.s, b.rng.s);
    for (let i = 0; i < a.count; i++) {
      assert.equal(a.type[i], b.type[i]);
      assert.equal(a.px[i], b.px[i]);
      assert.equal(a.py[i], b.py[i]);
    }
  });

  it('only arms survive/defend objectives that request waves', () => {
    const w1 = createWorld(1);
    setupWaveSpawners(w1, FIELD, [{ kind: 'reach', tx: 10, tz: 10, r: 5 }]);
    assert.equal(w1.waveSpawners, null);

    const w2 = createWorld(1);
    setupWaveSpawners(w2, FIELD, [
      { kind: 'defend', tx: 40, tz: 40, r: 6, params: { waves: 2 } },
      { kind: 'survive', tx: 20, tz: 20, r: 5 }, // no waves → skipped
    ]);
    assert.equal(w2.waveSpawners.length, 1);
    assert.equal(w2.waveSpawners[0].waves, 2);
  });
});
