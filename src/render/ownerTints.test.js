import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_TINTS,
  hexToRgb01,
  ownerTint,
  setLocalOwnerTint,
} from './ownerTints.js';

describe('ownerTints', () => {
  it('parses profile hex into 0–1 RGB', () => {
    assert.deepEqual(hexToRgb01('#FF0000'), [1, 0, 0]);
    assert.deepEqual(hexToRgb01('00ff00'), [0, 1, 0]);
    assert.equal(hexToRgb01('red'), null);
  });

  it('uses the profile swatch for the local owner only', () => {
    setLocalOwnerTint(2, '#FF0000');
    assert.deepEqual(ownerTint(2), [1, 0, 0]);
    assert.deepEqual(ownerTint(0), OWNER_TINTS[0]);
    assert.deepEqual(ownerTint(1), OWNER_TINTS[1]);
    setLocalOwnerTint(-1, '#FF0000');
    assert.deepEqual(ownerTint(2), OWNER_TINTS[2]);
    setLocalOwnerTint(0, '');
  });
});
