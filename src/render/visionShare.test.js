import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shareVisionOwnersFromCfg } from './visionShare.js';

describe('shareVisionOwnersFromCfg', () => {
  it('returns nothing for a normal playing client', () => {
    assert.deepEqual(
      shareVisionOwnersFromCfg({
        role: 'player',
        localPlayerId: 0,
        activeSlots: [0, 1],
      }),
      [],
    );
  });

  it('unions every army for a KOTH spectator', () => {
    assert.deepEqual(
      shareVisionOwnersFromCfg({
        role: 'spectator',
        localPlayerId: -1,
        activeSlots: [0, 1, 3],
        humanPlayers: [0, 1],
      }).sort((a, b) => a - b),
      [0, 1, 3],
    );
  });

  it('shares with the other side when sharedVision is on', () => {
    assert.deepEqual(
      shareVisionOwnersFromCfg({
        role: 'player',
        localPlayerId: 0,
        sharedVision: true,
        activeSlots: [0, 1],
        aiPlayers: [{ owner: 1 }],
      }),
      [1],
    );
  });

  it('honors an explicit share list without allying every AI', () => {
    assert.deepEqual(
      shareVisionOwnersFromCfg({
        role: 'player',
        localPlayerId: 0,
        shareVisionWith: [2, 3, 4],
        sharedVision: false,
        aiPlayers: [
          { owner: 1, temperament: 'cautious' },
          { owner: 2, temperament: 'steady' },
          { owner: 3, temperament: 'aggressive' },
          { owner: 4, temperament: 'reckless' },
        ],
      }),
      [2, 3, 4],
    );
  });
});
