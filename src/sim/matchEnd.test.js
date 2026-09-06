import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { kill } from './damage.js';
import { buildField } from './field.js';
import { UNIT } from './unitTypes.js';
import { createAgoras } from './agora.js';
import { createBuilding } from './buildings.js';
import { setTeamAssignments } from './teams.js';
import { step } from './step.js';
import { matchWipeStep } from './matchEnd.js';
import * as fx from './fixed.js';

function seatWorld(owners, aliveOwners) {
  const w = createWorld(1);
  w.agoraOccupyEndsMatch = 1;
  w.kothMatchOver = 0;
  w.matchWinner = -1;
  w.agoras = createAgoras(owners.map((owner, i) => ({ owner, x: i * 20, z: 0 })));
  const live = new Set(aliveOwners);
  for (const owner of owners) {
    if (!live.has(owner)) continue;
    spawn(w, { x: fx.fromInt(owner * 8), y: 0, type: UNIT.VILLAGER, owner });
  }
  return w;
}

describe('match wipe (0 pop)', () => {
  it('does not end while every seat still has pop', () => {
    const w = seatWorld([0, 1], [0, 1]);
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 0);
    assert.equal(w.matchWinner, -1);
  });

  it('awards the survivor when the other seat hits 0 pop', () => {
    const w = seatWorld([0, 1], [0]);
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 1);
    assert.equal(w.matchWinner, 0);
  });

  it('a leftover village does not save a wiped army', () => {
    const w = seatWorld([0, 1], [0]);
    w.buildings = [createBuilding({ type: 'village', owner: 1, x: 40, z: 0 })];
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 1);
    assert.equal(w.matchWinner, 0);
  });

  it('stays quiet when occupy does not end the match', () => {
    const w = seatWorld([0, 1], [0]);
    w.agoraOccupyEndsMatch = 0;
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 0);
    assert.equal(w.matchWinner, -1);
  });

  it('needs two seats — a lone agora is not a match', () => {
    const w = seatWorld([0], []);
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 0);
  });

  it('mutual wipe ends the match without a winner', () => {
    const w = seatWorld([0, 1], []);
    matchWipeStep(w);
    assert.equal(w.kothMatchOver, 1);
    assert.equal(w.matchWinner, -1);
  });

  it('in teams, one ally at 0 pop does not end the match', () => {
    setTeamAssignments([0, 1, 0, 1]);
    try {
      const w = seatWorld([0, 1, 2, 3], [0, 2, 3]);
      matchWipeStep(w);
      assert.equal(w.kothMatchOver, 0);
    } finally {
      setTeamAssignments(null);
    }
  });

  it('in teams, wiping a whole side awards the surviving team', () => {
    setTeamAssignments([0, 1, 0, 1]);
    try {
      const w = seatWorld([0, 1, 2, 3], [2]);
      matchWipeStep(w);
      assert.equal(w.kothMatchOver, 1);
      assert.equal(w.matchWinner, 2);
    } finally {
      setTeamAssignments(null);
    }
  });

  it('step ends a skirmish when the last enemy unit dies', () => {
    const w = seatWorld([0, 1], [0, 1]);
    const field = buildField(1, { width: 64, height: 64 });
    let enemy = -1;
    for (let i = 0; i < w.count; i++) {
      if (w.owner[i] === 1) enemy = i;
    }
    kill(w, enemy);
    step(w, field, []);
    assert.equal(w.kothMatchOver, 1);
    assert.equal(w.matchWinner, 0);
  });
});
