import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chapterLabelFor } from './modes.js';
import { liveConfigFromLobby, teamByOwnerForMode } from './startConfig.js';

const seats = [
  { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true, dlc: ['first_responder'] },
  { index: 1, kind: 'human', userId: 'guest-id', name: 'G', ready: true },
  { index: 2, kind: 'empty', userId: null, name: '', ready: false },
  { index: 3, kind: 'empty', userId: null, name: '', ready: false },
];

describe('lobby start config', () => {
  it('maps each human to their seat index as owner', () => {
    const cfg = liveConfigFromLobby({
      mode: 'onevsone',
      roomId: 'lobby-1',
      settings: { fieldSize: 'tiny', seed: 99 },
      seats: seats.slice(0, 2),
    }, 'guest-id');
    assert.equal(cfg.localPlayerId, 1);
    assert.deepEqual(cfg.humanPlayers, [0, 1]);
    assert.equal(cfg.seed, 99);
    assert.equal(cfg.mapW, 80);
    assert.equal(cfg.teamByOwner, null);
    assert.equal(cfg.role, 'player');
    assert.equal(cfg.localSolo, false);
    assert.deepEqual(cfg.shareVisionWith, []);
    assert.deepEqual(cfg.ownerSkins, { 0: { 4: 'first_responder' } });
  });

  it('assigns 2v2 lanes for teams', () => {
    const teams = teamByOwnerForMode('teams', 4);
    assert.deepEqual(teams, [0, 0, 1, 1]);
    const cfg = liveConfigFromLobby({
      mode: 'teams',
      roomId: 'r',
      settings: { fieldSize: 'small', seed: 1 },
      seats,
    }, 'host-id');
    assert.equal(cfg.localPlayerId, 0);
    assert.equal(cfg.laneBases, true);
    assert.deepEqual(cfg.teamByOwner, [0, 0, 1, 1]);
    assert.deepEqual(cfg.shareVisionWith, [1]);
  });

  it('allies every adventure owner', () => {
    assert.deepEqual(teamByOwnerForMode('adventure', 3), [0, 0, 0]);
    const cfg = liveConfigFromLobby({
      mode: 'adventure',
      roomId: 'adv',
      settings: { fieldSize: 'small', seed: 2, chapter: 'ch1' },
      seats: [seats[0]],
    }, 'host-id');
    assert.equal(cfg.localSolo, true);
    assert.equal(cfg.sharedVision, true);
    assert.equal(cfg.chapter, 'ch1');
    assert.equal(cfg.gardenUrl, '/maps/chapter1.garden');
  });
});

describe('chapterLabelFor', () => {
  it('names a chapter from id, garden url, or garden title', () => {
    assert.equal(chapterLabelFor({ chapter: 'ch2' }), 'Ch 2');
    assert.equal(chapterLabelFor({ gardenUrl: '/maps/chapter3.garden' }), 'Ch 3');
    assert.equal(chapterLabelFor({ name: 'Chapter 1' }), 'Ch 1');
  });
});
