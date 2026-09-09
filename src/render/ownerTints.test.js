import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER_TINTS,
  hexToRgb01,
  ownerColorsFromRoster,
  ownerColorsFromSeats,
  ownerTint,
  sanitizeOwnerColor,
  setLocalOwnerTint,
  setOwnerTints,
} from './ownerTints.js';

describe('ownerTints', () => {
  it('parses profile hex into 0–1 RGB', () => {
    assert.deepEqual(hexToRgb01('#FF0000'), [1, 0, 0]);
    assert.deepEqual(hexToRgb01('00ff00'), [0, 1, 0]);
    assert.equal(hexToRgb01('red'), null);
    assert.equal(sanitizeOwnerColor('#abCDef'), '#ABCDEF');
    assert.equal(sanitizeOwnerColor('red'), '');
  });

  it('uses the profile swatch for the local owner only', () => {
    setOwnerTints(null);
    setLocalOwnerTint(2, '#FF0000');
    assert.deepEqual(ownerTint(2), [1, 0, 0]);
    assert.deepEqual(ownerTint(0), OWNER_TINTS[0]);
    assert.deepEqual(ownerTint(1), OWNER_TINTS[1]);
    setLocalOwnerTint(-1, '#FF0000');
    assert.deepEqual(ownerTint(2), OWNER_TINTS[2]);
    setOwnerTints(null);
    setLocalOwnerTint(0, '');
  });

  it('paints every seat hex so clients agree on remote armies', () => {
    setOwnerTints({ 0: '#FF0000', 1: '#00FF00' });
    setLocalOwnerTint(1, '#00FF00');
    assert.deepEqual(ownerTint(0), [1, 0, 0]);
    assert.deepEqual(ownerTint(1), [0, 1, 0]);
    assert.deepEqual(ownerTint(2), OWNER_TINTS[2]);
    setOwnerTints(null);
    setLocalOwnerTint(0, '');
  });

  it('maps lobby seats and KOTH roster onto owner hexes', () => {
    assert.deepEqual(ownerColorsFromSeats([
      { kind: 'human', index: 0, color: '#ff0000' },
      { kind: 'human', index: 1, color: '00ff00' },
      { kind: 'empty', index: 2, color: '#0000ff' },
    ]), { 0: '#FF0000', 1: '#00FF00' });
    assert.deepEqual(ownerColorsFromRoster(
      [
        { state: 'active', playerId: 0, userId: 'a' },
        { state: 'active', playerId: 1, userId: 'b' },
        { state: 'empty', playerId: 2, userId: null },
      ],
      new Map([['b', '#00ff00']]),
    ), { 1: '#00FF00' });
  });
});
