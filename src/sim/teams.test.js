import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTeamNeutralPairs,
  isAlly,
  isHostile,
  normalizeNeutralTeams,
  setTeamAssignments,
  setTeamNeutralPairs,
  teamOf,
} from './teams.js';

describe('team hostility', () => {
  it('is FFA until assignments are set, then same-team owners are allies', () => {
    setTeamAssignments(null);
    assert.equal(isHostile(0, 1), true);
    assert.equal(isAlly(0, 1), false);
    setTeamAssignments([0, 0, 0, 0]);
    assert.equal(isHostile(0, 3), false);
    assert.equal(isAlly(0, 3), true);
    assert.equal(teamOf(4), 4, 'owners past the table keep their own team');
    assert.equal(isHostile(0, 4), true);
    setTeamAssignments(null);
  });

  it('neutral pairs skip hostility both ways without becoming allies', () => {
    setTeamAssignments([0, 0, 0, 0]);
    setTeamNeutralPairs([[0, 4], [5, 0]]);
    assert.deepEqual(getTeamNeutralPairs(), [[0, 4], [0, 5]]);
    assert.equal(isHostile(0, 4), false);
    assert.equal(isHostile(4, 0), false);
    assert.equal(isAlly(0, 4), false);
    assert.equal(isHostile(0, 5), false);
    assert.equal(isAlly(0, 5), false);
    assert.equal(isHostile(4, 5), true, 'the two outsider teams still fight');
    assert.equal(isAlly(4, 5), false);
    setTeamAssignments(null);
    assert.equal(getTeamNeutralPairs(), null, 'reassignment clears neutrals');
  });

  it('dedupes and sorts authored garden pairs', () => {
    assert.deepEqual(normalizeNeutralTeams([[5, 0], [0, 4], [0, 4], [2, 2]]), [[0, 5], [0, 4]]);
    assert.equal(normalizeNeutralTeams([]), null);
  });
});
