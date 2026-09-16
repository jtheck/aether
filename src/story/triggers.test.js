import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGarden } from '../sim/garden.js';
import { objectiveWorldPos, zoneContains } from './objectives.js';
import {
  SURVIVE_SECONDS_PER_WAVE,
  armCampaignTriggers,
  campaignTriggerStatus,
  describeCampaignObjective,
  stepCampaignTriggers,
  surviveSeconds,
} from './triggers.js';
import { CAMPAIGN_CHAPTERS } from './campaign.js';

const here = dirname(fileURLToPath(import.meta.url));
const TICK_HZ = 20;

function timerCtx(tick, partyAlive = true) {
  return { tick, tickHz: TICK_HZ, targetsInZone: () => [], isTargetAlive: () => true, partyAlive: () => partyAlive };
}

describe('survive / defend hold-out timer', () => {
  it('derives seconds from waves or explicit seconds', () => {
    assert.equal(surviveSeconds({ params: { waves: 3 } }), 3 * SURVIVE_SECONDS_PER_WAVE);
    assert.equal(surviveSeconds({ params: { seconds: 45 } }), 45);
    assert.equal(surviveSeconds({ params: null }), 20);
  });

  it('completes only after the duration, and only if the party is alive', () => {
    const obj = { kind: 'survive', params: { waves: 2 }, completed: false };
    armCampaignTriggers([obj], timerCtx(0));
    const end = 2 * SURVIVE_SECONDS_PER_WAVE * TICK_HZ;
    assert.equal(obj._endTick, end);

    assert.deepEqual(stepCampaignTriggers([obj], timerCtx(end - 1)), []);
    assert.equal(obj.completed, false);

    // Duration met but party wiped — no completion.
    assert.deepEqual(stepCampaignTriggers([obj], timerCtx(end, false)), []);
    assert.equal(obj.completed, false);

    const just = stepCampaignTriggers([obj], timerCtx(end, true));
    assert.equal(just.length, 1);
    assert.equal(obj.completed, true);
  });

  it('reports a countdown for the HUD', () => {
    const obj = { kind: 'defend', params: { seconds: 10 }, label: 'Hold the gate', completed: false };
    armCampaignTriggers([obj], timerCtx(0));
    const status = campaignTriggerStatus(obj, timerCtx(4 * TICK_HZ));
    assert.equal(status.remaining, 6);
    assert.equal(describeCampaignObjective(obj, timerCtx(4 * TICK_HZ)), 'Hold the gate — 6s');
  });
});

describe('destroy target-death trigger', () => {
  function destroyCtx(alive) {
    return {
      tick: 0,
      tickHz: TICK_HZ,
      targetsInZone: () => [{ kind: 'unit', i: 0 }, { kind: 'building', j: 0, key: 'camp@1_1' }],
      isTargetAlive: (t) => alive.get(`${t.kind}:${t.i ?? t.j}`) !== false,
      partyAlive: () => true,
    };
  }

  it('completes only when every captured target is dead', () => {
    const obj = { kind: 'destroy', label: 'Wreck the ram', completed: false };
    const alive = new Map();
    armCampaignTriggers([obj], destroyCtx(alive));
    assert.equal(obj._targets.length, 2);

    assert.deepEqual(stepCampaignTriggers([obj], destroyCtx(alive)), []);
    alive.set('unit:0', false);
    assert.deepEqual(stepCampaignTriggers([obj], destroyCtx(alive)), []);
    assert.equal(describeCampaignObjective(obj, destroyCtx(alive)), 'Wreck the ram — 1/2 left');

    alive.set('building:0', false);
    const just = stepCampaignTriggers([obj], destroyCtx(alive));
    assert.equal(just.length, 1);
    assert.equal(obj.completed, true);
  });

  it('never completes if no targets were captured in the zone', () => {
    const obj = { kind: 'destroy', completed: false };
    const ctx = { tick: 0, tickHz: TICK_HZ, targetsInZone: () => [], isTargetAlive: () => false, partyAlive: () => true };
    armCampaignTriggers([obj], ctx);
    assert.deepEqual(stepCampaignTriggers([obj], ctx), []);
    assert.equal(obj.completed, false);
  });
});

describe('objective triggers — hold / capture / infiltrate / race / escort / choice', () => {
  const FIELD = { width: 100, height: 100, worldHalfF: 200 };
  const at = (obj) => objectiveWorldPos(obj, FIELD);
  function ctx(tick, over = {}) {
    return {
      tick,
      tickHz: TICK_HZ,
      field: FIELD,
      partyPoints: () => [],
      enemyPoints: () => [],
      escortPoint: () => null,
      partyAlive: () => true,
      targetsInZone: () => [],
      isTargetAlive: () => true,
      ...over,
    };
  }

  it('hold completes only after a continuous stay, and resets on leaving', () => {
    const obj = { kind: 'hold', tx: 50, tz: 50, r: 5, params: { hold: 3 }, completed: false };
    const inZone = { partyPoints: () => [at(obj)] };
    armCampaignTriggers([obj], ctx(0));
    stepCampaignTriggers([obj], ctx(0, inZone));
    assert.equal(obj._holdEnd, 3 * TICK_HZ);
    stepCampaignTriggers([obj], ctx(10)); // left the zone
    assert.equal(obj._holdEnd, undefined, 'timer resets when nobody holds it');
    stepCampaignTriggers([obj], ctx(20, inZone));
    stepCampaignTriggers([obj], ctx(20 + 3 * TICK_HZ, inZone));
    assert.equal(obj.completed, true);
  });

  it('capture needs the zone cleared of enemies', () => {
    const obj = { kind: 'capture', tx: 50, tz: 50, r: 5, completed: false };
    armCampaignTriggers([obj], ctx(0));
    const contested = { partyPoints: () => [at(obj)], enemyPoints: () => [at(obj)] };
    assert.deepEqual(stepCampaignTriggers([obj], ctx(0, contested)), []);
    const cleared = { partyPoints: () => [at(obj)], enemyPoints: () => [] };
    assert.equal(stepCampaignTriggers([obj], ctx(1, cleared)).length, 1);
    assert.equal(obj.completed, true);
  });

  it('race fails the chapter when the clock runs out', () => {
    const obj = { kind: 'race', tx: 50, tz: 50, r: 5, params: { seconds: 5 }, completed: false };
    armCampaignTriggers([obj], ctx(0));
    assert.equal(obj._raceEnd, 5 * TICK_HZ);
    stepCampaignTriggers([obj], ctx(5 * TICK_HZ + 1));
    assert.equal(obj._failed, true);
    assert.ok(obj.failMessage);
  });

  it('escort completes on arrival and fails if the escort dies', () => {
    const obj = { kind: 'escort', tx: 50, tz: 50, r: 5, params: { escort: 'Cart' }, completed: false };
    armCampaignTriggers([obj], ctx(0));
    // Seen alive but not yet at the zone.
    stepCampaignTriggers([obj], ctx(0, { escortPoint: () => ({ x: 999, z: 999 }) }));
    assert.equal(obj._escortSeen, true);
    assert.equal(obj.completed, false);
    // Escort dies (no point) → fail.
    stepCampaignTriggers([obj], ctx(1, { escortPoint: () => null }));
    assert.equal(obj._failed, true);
  });

  it('escort completes when the escort reaches the zone', () => {
    const obj = { kind: 'escort', tx: 50, tz: 50, r: 5, params: { escort: 'Cart' }, completed: false };
    armCampaignTriggers([obj], ctx(0));
    const arrived = { escortPoint: () => at(obj) };
    assert.equal(stepCampaignTriggers([obj], ctx(0, arrived)).length, 1);
    assert.equal(obj.completed, true);
  });

  it('choice resolves sibling forks when one branch is taken', () => {
    const ledge = { kind: 'choice', tx: 40, tz: 50, r: 5, params: { branch: 'ledge' }, completed: false };
    const rope = { kind: 'choice', tx: 60, tz: 50, r: 5, params: { branch: 'bridge' }, completed: false };
    const list = [ledge, rope];
    armCampaignTriggers(list, ctx(0));
    const pick = { partyPoints: () => [at(ledge)] };
    const just = stepCampaignTriggers(list, ctx(0, pick));
    assert.equal(ledge.completed, true);
    assert.equal(rope.completed, true);
    assert.equal(ledge._choice, 'ledge');
    assert.equal(rope._choice, 'ledge');
    assert.equal(just.length, 2);
  });
});

describe('generated destroy chapters carry a killable target', () => {
  it('places a hostile structure inside every destroy zone', () => {
    for (const c of CAMPAIGN_CHAPTERS) {
      const destroyObjs = c.def.objectives.filter((o) => o.kind === 'destroy');
      if (!destroyObjs.length) continue;
      const data = JSON.parse(readFileSync(join(here, '../../maps', `${c.id}.garden`), 'utf8'));
      const g = decodeGarden(data);
      for (const objective of g.objectives.filter((o) => o.kind === 'destroy')) {
        const target = g.buildings.find((b) => (b.owner | 0) === 4 && zoneContains(objective, b.x, b.z, { width: g.width }));
        assert.ok(target, `${c.id} destroy zone should contain a hostile building`);
      }
    }
  });
});
