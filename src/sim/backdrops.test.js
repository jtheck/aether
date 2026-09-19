import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP,
  BACKDROP_DEFS,
  cloneBackdrops,
  defaultBackdropY,
  encodeBackdrops,
  isBackdropType,
  normalizeBackdrops,
} from './backdrops.js';

describe('backdrops', () => {
  it('accepts known types and drops unknown ones', () => {
    assert.equal(isBackdropType(BACKDROP.DISC), true);
    assert.equal(isBackdropType('castle'), false);
    const list = normalizeBackdrops([
      { type: 'disc', x: 2, z: -4 },
      { type: 'nope', x: 1, z: 1 },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, BACKDROP.DISC);
    assert.equal(list[0].scale, BACKDROP_DEFS.disc.defaultScale);
    assert.equal(list[0].y, defaultBackdropY('disc', list[0].scale));
  });

  it('roundtrips garden tuples with an explicit huge pose', () => {
    const posed = normalizeBackdrops([['disc', 0, 0, -243, 0, 80]]);
    assert.deepEqual(encodeBackdrops(posed), [['disc', 0, 0, -243, 0, 80]]);
    assert.deepEqual(cloneBackdrops(posed), posed);
  });
});
