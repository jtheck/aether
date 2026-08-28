import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_GROUP_COUNT,
  assignControlGroup,
  controlGroupFilled,
  controlGroupIdFromCode,
  createEmptyControlGroups,
  livingControlGroup,
} from './controlGroups.js';

function fakeWorld(entries) {
  const count = 8;
  const alive = new Uint8Array(count);
  const owner = new Uint8Array(count);
  for (const e of entries) {
    alive[e.id] = e.alive ? 1 : 0;
    owner[e.id] = e.owner;
  }
  return { count, alive, owner };
}

describe('control groups', () => {
  it('maps number keys 1-6 (and numpad) onto the six pads', () => {
    assert.equal(controlGroupIdFromCode('Digit1'), 0);
    assert.equal(controlGroupIdFromCode('Digit6'), 5);
    assert.equal(controlGroupIdFromCode('Numpad3'), 2);
    assert.equal(controlGroupIdFromCode('Digit7'), null);
    assert.equal(controlGroupIdFromCode('KeyQ'), null);
  });

  it('assigns a snapshot and ignores stale / foreign members', () => {
    const groups = createEmptyControlGroups();
    assert.equal(groups.length, CONTROL_GROUP_COUNT);
    assert.equal(assignControlGroup(groups, 0, [1, 2], [{ kind: 'building', index: 3 }]), true);
    assert.deepEqual(groups[0].units, [1, 2]);
    groups[0].units.push(99);
    assert.equal(assignControlGroup(groups, 99, [1], []), false);

    const world = fakeWorld([
      { id: 1, alive: true, owner: 0 },
      { id: 2, alive: false, owner: 0 },
      { id: 4, alive: true, owner: 1 },
    ]);
    assignControlGroup(groups, 1, [1, 2, 4], [
      { kind: 'building', index: 0 },
      { kind: 'building', index: 1 },
      { kind: 'agora', index: 0 },
    ]);
    const live = livingControlGroup(
      groups[1],
      world,
      0,
      [{ owner: 0, hp: 10 }, { owner: 0, hp: 0 }],
      [{ owner: 0 }],
    );
    assert.deepEqual(live.units, [1]);
    assert.deepEqual(live.buildings, [
      { kind: 'building', index: 0 },
      { kind: 'agora', index: 0 },
    ]);
    assert.equal(controlGroupFilled(live), true);
    assert.equal(controlGroupFilled({ units: [], buildings: [] }), false);
  });

  it('treats a missing building hp as standing (legacy rows)', () => {
    const groups = createEmptyControlGroups();
    assignControlGroup(groups, 2, [], [{ kind: 'building', index: 0 }]);
    const live = livingControlGroup(
      groups[2],
      fakeWorld([]),
      0,
      [{ owner: 0 }],
      [],
    );
    assert.deepEqual(live.buildings, [{ kind: 'building', index: 0 }]);
  });
});
