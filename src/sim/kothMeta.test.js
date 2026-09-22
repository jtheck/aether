import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { kill } from './damage.js';
import { UNIT } from './unitTypes.js';
import { createAgoras } from './agora.js';
import * as fx from './fixed.js';
import {
  createKothMeta,
  kothMetaStep,
  kothRegisterJoin,
  kothWipedOwners,
} from './kothMeta.js';

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

  it('awards the survivor a point and keeps the king on a remaining seat', () => {
    const w = kothWorld([0, 1]);
    w.koth.kingOwner = 1;
    let foe = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 1) foe = i;
    }
    kill(w, foe);
    kothMetaStep(w);
    assert.equal(w.koth.scores[0], 1);
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
    assert.equal(w.koth.scores[1], 1);
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
