import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNIT } from './unitTypes.js';
import {
  exportMatchSnapshot,
  noteMatchAction,
  noteMatchBuilding,
  noteMatchTech,
  sampleMatch,
} from './matchSnapshot.js';

function world() {
  return {
    tick: 0,
    count: 2,
    alive: Uint8Array.from([1, 1]),
    owner: Int16Array.from([0, 1]),
    type: Uint8Array.from([UNIT.VILLAGER, UNIT.WARRIOR]),
  };
}

test('a sample counts villagers, army value, and orders, and keeps the first building', () => {
  const w = world();
  noteMatchAction(w, 0);
  noteMatchAction(w, 0);
  noteMatchBuilding(w, 0, 'barracks');
  noteMatchBuilding(w, 0, 'barracks');
  noteMatchTech(w, 1, 'patronage');
  sampleMatch(w);
  const snap = exportMatchSnapshot(w, [0, 1]);
  assert.equal(snap.samples[0].v[0], 1);
  assert.equal(snap.samples[0].v[1], 0);
  assert.equal(snap.samples[0].a[1], 40);
  assert.equal(snap.samples[0].p[0], 2);
  assert.equal(snap.samples[0].p[1], 0);
  assert.deepEqual(snap.tech.map((row) => row.id), ['barracks', 'patronage']);
  w.tick = 50;
  const closed = exportMatchSnapshot(w, [0, 1]);
  assert.equal(closed.samples.at(-1).tick, 50);
  assert.equal(closed.tick, 50);
});
