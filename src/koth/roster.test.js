import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activateSlot,
  createEmptyRoster,
  lowestActiveUserId,
  reserveSlot,
} from './roster.js';

describe('KOTH roster authority', () => {
  it('belongs to the lowest active seat, not a lower reserved seat', () => {
    let roster = createEmptyRoster();
    roster = activateSlot(roster, 1, 'current-king').slots;
    roster = activateSlot(roster, 3, 'later-player').slots;
    roster = reserveSlot(roster, 0, 'rejoining-founder');

    assert.equal(lowestActiveUserId(roster), 'current-king');
  });

  it('moves to a rejoining lower seat only after activation', () => {
    let roster = createEmptyRoster();
    roster = activateSlot(roster, 1, 'current-king').slots;
    roster = reserveSlot(roster, 0, 'rejoining-founder');
    assert.equal(lowestActiveUserId(roster), 'current-king');

    roster = activateSlot(roster, 0, 'rejoining-founder').slots;
    assert.equal(lowestActiveUserId(roster), 'rejoining-founder');
  });
});
