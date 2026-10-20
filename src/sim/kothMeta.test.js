import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { kill } from './damage.js';
import { UNIT } from './unitTypes.js';
import { createAgoras } from './agora.js';
import * as fx from './fixed.js';
import { getResource } from './resources.js';
import { applyDamage } from './damage.js';
import { applyDamageBuilding } from './buildingCombat.js';
import {
  createKothMeta,
  kothBountyList,
  kothMetaStep,
  kothRegisterJoin,
  kothWipedOwners,
  KOTH_DROP_HEADCOUNT,
  KOTH_REVEAL_TICKS,
} from './kothMeta.js';
import { KOTH_UNITS_PER_ARMY } from './worldSetup.js';

function kothWorld(aliveOwners, activeOwners = aliveOwners) {
  const w = createWorld(1);
  w.kothMatchOver = 0;
  w.koth = createKothMeta(activeOwners);
  for (const owner of aliveOwners) {
    spawn(w, { x: fx.fromInt(owner * 8), y: 0, type: UNIT.VILLAGER, owner });
  }
  return w;
}

describe('koth combat wipe', () => {
  it('marks a seat eliminated when living units hit 0 and leaves the match up', () => {
    const w = kothWorld([0, 1]);
    let foe = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 1) foe = i;
    }
    kill(w, foe);
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[1], 1);
    assert.equal(w.koth.eliminated[0], 0);
    assert.equal(w.kothMatchOver, 0);
    assert.deepEqual(kothWipedOwners(w.koth), [1]);
  });

  it('pays nothing for an unestablished death and keeps the king on a remaining seat', () => {
    const w = kothWorld([0, 1]);
    w.koth.kingOwner = 1;
    let foe = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 1) foe = i;
    }
    kill(w, foe);
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 0);
    assert.equal(w.koth.scores[1], 0);
    assert.equal(w.koth.kingOwner, 0);
  });

  it('only ends the round on a true wipe', () => {
    const w = kothWorld([], [0, 1]);
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[0], 1);
    assert.equal(w.koth.eliminated[1], 1);
    assert.equal(w.kothMatchOver, 1);
    assert.deepEqual(kothWipedOwners(w.koth), [0, 1]);
  });

  it('clears the wipe flag when a seat respawns', () => {
    const w = kothWorld([0], [0, 1]);
    kothMetaStep(w);
    assert.deepEqual(kothWipedOwners(w.koth), [1]);
    spawn(w, { x: fx.fromInt(16), y: 0, type: UNIT.VILLAGER, owner: 1 });
    kothRegisterJoin(w.koth, 1, 40);
    assert.deepEqual(kothWipedOwners(w.koth), []);
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[1], 0);
    assert.equal(w.kothMatchOver, 0);
  });

  it('kothWipedOwners ignores empty meta', () => {
    assert.deepEqual(kothWipedOwners(null), []);
    assert.deepEqual(kothWipedOwners({}), []);
  });
});

describe('koth agora wipe', () => {
  it('lets a nomad army live with no agora', () => {
    const w = kothWorld([0, 1]);
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[0], 0);
    assert.equal(w.koth.established[0], 0);
    assert.equal(w.koth.eliminated[1], 0);
  });

  it('latches established when a seat owns a completed agora', () => {
    const w = kothWorld([0, 1]);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    kothMetaStep(w);
    assert.equal(w.koth.established[0], 1);
    assert.equal(w.koth.established[1], 0);
    assert.equal(w.koth.eliminated[0], 0);
  });

  it('keeps a seat alive when it still owns one of several agoras', () => {
    const w = kothWorld([0, 1]);
    w.agoras = createAgoras([
      { owner: 0, x: 0, z: 0 },
      { owner: 0, x: 20, z: 0 },
    ]);
    kothMetaStep(w);
    w.agoras[0].owner = 1;
    w.agoras[0].founder = 1;
    kothMetaStep(w);
    assert.equal(w.koth.established[0], 1);
    assert.equal(w.koth.eliminated[0], 0);
    assert.equal(w.koth.eliminated[1], 0);
  });

  it('wipes a seat that established then lost every agora, even with pop', () => {
    const w = kothWorld([0, 1]);
    w.agoras = createAgoras([
      { owner: 0, x: 0, z: 0 },
      { owner: 0, x: 20, z: 0 },
    ]);
    kothMetaStep(w);
    w.agoras[0].owner = 1;
    w.agoras[0].founder = 1;
    w.agoras[1].owner = 1;
    w.agoras[1].founder = 1;
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[0], 1);
    assert.equal(w.koth.eliminated[1], 0);
    assert.equal(w.kothMatchOver, 0);
    assert.equal(w.koth.scores[1], 0);
    assert.deepEqual(kothWipedOwners(w.koth), [0]);
  });

  it('clears the established latch when a seat respawns', () => {
    const w = kothWorld([0, 1]);
    w.agoras = createAgoras([{ owner: 1, x: 0, z: 0 }]);
    kothMetaStep(w);
    w.agoras[0].owner = 0;
    w.agoras[0].founder = 0;
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[1], 1);
    kothRegisterJoin(w.koth, 1, 40);
    assert.equal(w.koth.established[1], 0);
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[1], 0);
  });
});

describe('koth deed bounty', () => {
  it('matches the opening drop headcount', () => {
    assert.equal(KOTH_DROP_HEADCOUNT, KOTH_UNITS_PER_ARMY);
  });

  function blooded(owner, ownerKills = 0, ownerRazes = 0, alive = [0, 1, 2]) {
    const w = kothWorld(alive);
    w.agoras = createAgoras([{ owner, x: 0, z: 0 }]);
    w.ownerKills = new Int32Array(16);
    w.ownerRazes = new Int32Array(16);
    w.ownerKills[owner] = ownerKills;
    w.ownerRazes[owner] = ownerRazes;
    kothMetaStep(w);
    return w;
  }

  function killOwner(w, owner) {
    for (let i = 0; i < w.count; i++) {
      if (w.alive[i] && w.owner[i] === owner) {
        kill(w, i);
        return;
      }
    }
  }

  it('pays nothing when only two seats are in the fight', () => {
    const w = blooded(1, 10, 0, [0, 1]);
    killOwner(w, 1);
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 0);
    assert.equal(getResource(w, 0, 'food'), 0);
    assert.equal(kothBountyList(w.koth).length, 0);
    assert.equal(w.kothMatchOver, 0);
  });

  it('ends the hill once a third seat is gone', () => {
    const w = blooded(1, 10, 0);
    killOwner(w, 1);
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 1);
    assert.equal(getResource(w, 0, 'food'), 80);
    assert.equal(w.kothMatchOver, 1);
  });

  it('pays 1 point and the small purse for one gate once three seats are in', () => {
    const w = blooded(1, 10, 0);
    killOwner(w, 1);
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 1);
    assert.equal(w.koth.scores[2], 1);
    assert.equal(getResource(w, 0, 'food'), 80);
    assert.equal(getResource(w, 0, 'mineral'), 0);
    assert.equal(kothBountyList(w.koth)[0].points, 1);
  });

  it('adds a hill point when the king dies without upgrading the purse', () => {
    const w = blooded(0, 10, 0);
    w.koth.scores[0] = 1;
    let foe = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 0) foe = i;
    }
    kill(w, foe);
    kothMetaStep(w);
    assert.equal(w.koth.scores[1], 2);
    assert.equal(getResource(w, 1, 'food'), 80);
    assert.equal(getResource(w, 1, 'mineral'), 0);
    assert.equal(w.koth.kingOwner, 1);
  });

  it('pays 2 points, the larger purse, and warriors under the drop cap for two gates', () => {
    const w = blooded(1, 10, 1);
    killOwner(w, 1);
    const before = w.count;
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 2);
    assert.equal(w.koth.scores[2], 2);
    assert.equal(getResource(w, 0, 'mineral'), 10);
    assert.equal(getResource(w, 0, 'food'), 160);
    assert.equal(w.count - before, 8);
  });

  it('drops a hill point when an agora falls and the seat survives', () => {
    const w = kothWorld([0, 1]);
    w.koth.scores[0] = 3;
    w.agoras = createAgoras([
      { owner: 0, x: 0, z: 0 },
      { owner: 0, x: 20, z: 0 },
    ]);
    kothMetaStep(w);
    w.agoras[0].owner = 1;
    w.agoras[0].founder = 1;
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[0], 0);
    assert.equal(w.koth.scores[0], 2);
    w.koth.scores[0] = 0;
    w.agoras[1].owner = 1;
    w.agoras[1].founder = 1;
    // Last agora eliminates instead of going negative.
    kothMetaStep(w);
    assert.equal(w.koth.eliminated[0], 1);
    assert.equal(w.koth.scores[0], 0);
  });

  it('reveals a seat that has not founded an agora after the grace', () => {
    const w = kothWorld([0]);
    w.tick = KOTH_REVEAL_TICKS - 1;
    kothMetaStep(w);
    assert.equal(w.koth.exposed[0], 0);
    w.tick = KOTH_REVEAL_TICKS;
    kothMetaStep(w);
    assert.equal(w.koth.exposed[0], 1);
    w.agoras = createAgoras([{ owner: 0, x: 0, z: 0 }]);
    kothMetaStep(w);
    assert.equal(w.koth.exposed[0], 0);
  });

  it('credits a hostile kill and a finished building raze to the attacker', () => {
    const w = kothWorld([0, 1]);
    let foe = -1;
    let friend = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 1) foe = i;
      if (w.owner[i] === 0) friend = i;
    }
    applyDamage(w, foe, 999, friend);
    assert.equal(w.ownerKills[0], 1);
    w.buildings = [{
      owner: 1,
      type: 'camp',
      built: 1,
      hp: 10,
      x: 0,
      z: 0,
    }];
    applyDamageBuilding(w, null, 0, 10, 0);
    assert.equal(w.ownerRazes[0], 1);
    assert.equal(w.buildings[0].hp, 0);
  });
});
