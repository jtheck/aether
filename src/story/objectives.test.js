import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE_F } from '../sim/field.js';
import {
  OBJ_ADVANCE,
  OBJ_ESCAPE,
  OBJ_REACH,
  chapterObjectivesWin,
  encodeObjectives,
  normalizeObjectives,
  objectiveWorldPos,
  stepObjectives,
  zoneContains,
} from './objectives.js';

const field = { worldHalfF: 160, width: 80 };

function unitAt(tx, tz, extra = {}) {
  const x = (tx + 0.5) * TILE_SIZE_F - field.worldHalfF;
  const z = (tz + 0.5) * TILE_SIZE_F - field.worldHalfF;
  return { x, z, named: true, civilian: false, ...extra };
}

describe('objectives', () => {
  it('roundtrips packed garden rows', () => {
    const packed = encodeObjectives([{
      id: 'road',
      kind: 'escape',
      tx: 30,
      tz: 10,
      r: 6,
      label: 'Reach the old road (north)',
      message: 'Go.',
      next: '/maps/chapter2.garden',
    }]);
    assert.deepEqual(packed[0], [
      30, 10, 6, 'escape', 'Go.', '/maps/chapter2.garden', 'Reach the old road (north)', 'road',
    ]);
    const [obj] = normalizeObjectives(packed);
    assert.equal(obj.id, 'road');
    assert.equal(obj.kind, OBJ_ESCAPE);
    assert.equal(obj.next, '/maps/chapter2.garden');
    assert.equal(obj.label, 'Reach the old road (north)');
  });

  it('hits a reach zone and wins when that is the only objective', () => {
    const list = normalizeObjectives([{ kind: OBJ_REACH, tx: 30, tz: 10, r: 4 }]);
    const miss = stepObjectives(list, [unitAt(30, 20)], field);
    assert.equal(miss.chapterWin, false);
    assert.equal(list[0].completed, false);
    const hit = stepObjectives(list, [unitAt(30, 10)], field);
    assert.equal(hit.just.length, 1);
    assert.equal(hit.chapterWin, true);
    assert.equal(zoneContains(list[0], objectiveWorldPos(list[0], field).x, objectiveWorldPos(list[0], field).z, field), true);
  });

  it('completes escape when one named unit enters, then exposes next', () => {
    const list = normalizeObjectives([{
      kind: OBJ_ESCAPE,
      tx: 30,
      tz: 10,
      r: 6,
      next: '/maps/chapter2.garden',
    }]);
    const none = stepObjectives(list, [unitAt(30, 10, { named: false, civilian: true })], field);
    assert.equal(none.chapterWin, false);
    const hit = stepObjectives(list, [unitAt(31, 11, { named: true })], field);
    assert.equal(hit.chapterWin, true);
    assert.equal(hit.next, '/maps/chapter2.garden');
    assert.equal(chapterObjectivesWin(list), true);
  });

  it('advance completes every objective', () => {
    const list = normalizeObjectives([
      { kind: OBJ_REACH, tx: 1, tz: 1, r: 3 },
      { kind: OBJ_ADVANCE, tx: 30, tz: 10, r: 4, next: '/maps/chapter2.garden' },
    ]);
    const hit = stepObjectives(list, [unitAt(30, 10, { named: false })], field);
    assert.equal(list.every((o) => o.completed), true);
    assert.equal(hit.chapterWin, true);
    assert.equal(hit.next, '/maps/chapter2.garden');
  });
});
