import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installAdventureCampaign } from './adventureCampaign.js';
import { chapterLabelFor, defaultSettings, gardenUrlForChapter, lobbyAllowsSpectators, mapTypeFitsLobby, selectableAdventureChapters } from './modes.js';
import { liveConfigFromLobby, teamByOwnerForMode } from './startConfig.js';

const seats = [
  { index: 0, kind: 'human', userId: 'host-id', name: 'H', ready: true, dlc: ['first_responder'], color: '#ff0000' },
  { index: 1, kind: 'human', userId: 'guest-id', name: 'G', ready: true, color: '#00ff00' },
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
    const watching = liveConfigFromLobby({
      mode: 'onevsone',
      roomId: 'lobby-1',
      settings: { fieldSize: 'tiny', seed: 99 },
      seats: seats.slice(0, 2),
    }, 'eye');
    assert.equal(watching.role, 'spectator');
    assert.equal(watching.localPlayerId, -1);
    assert.equal(watching.sharedVision, true);
    assert.deepEqual(watching.humanPlayers, [0, 1]);
    assert.equal(cfg.localSolo, false);
    assert.deepEqual(cfg.shareVisionWith, []);
    assert.deepEqual(cfg.ownerSkins, { 0: { 4: 'first_responder', 14: 'first_responder' } });
    assert.deepEqual(cfg.ownerColors, { 0: '#FF0000', 1: '#00FF00' });
  });

  it('assigns 2v2 lanes for teams', () => {
    const teams = teamByOwnerForMode('teams', 4);
    assert.deepEqual(teams, [0, 0, 1, 1]);
    const uneven = teamByOwnerForMode('teams', 4, [
      { index: 0, team: 0 },
      { index: 1, team: 0 },
      { index: 2, team: 0 },
      { index: 3, team: 1 },
    ]);
    assert.deepEqual(uneven, [0, 0, 0, 1]);
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
    installAdventureCampaign({
      v: 1,
      kind: 'campaign',
      name: 'Adventure',
      episodes: [{ name: 'Episode 1', chapters: [{ file: 'opening.garden', name: 'Opening' }] }],
      gardens: { 'opening.garden': { v: 4, n: 'Opening', w: 8, h: 8 } },
    });
    assert.equal(cfg.chapter, 'ch1');
    assert.equal(cfg.gardenUrl, '');
    const fromFile = liveConfigFromLobby({
      mode: 'adventure',
      roomId: 'adv',
      settings: { fieldSize: 'small', seed: 2, chapter: 'pack:opening.garden' },
      seats: [seats[0]],
    }, 'host-id');
    assert.equal(fromFile.gardenUrl, 'pack:opening.garden');
    assert.deepEqual(selectableAdventureChapters().map((c) => c.id), ['pack:opening.garden']);
  });

  it('plays a custom map ref in 1v1', () => {
    const cfg = liveConfigFromLobby({
      mode: 'onevsone',
      roomId: 'lobby-1',
      settings: { fieldSize: 'tiny', seed: 99, chapter: 'session' },
      seats: seats.slice(0, 2),
    }, 'host-id');
    assert.equal(cfg.chapter, 'session');
    assert.equal(cfg.gardenUrl, 'session');
    assert.equal(cfg.mapW, 80);
  });

  it('passes workshop chapter refs through as gardenUrl', () => {
    const cfg = liveConfigFromLobby({
      mode: 'adventure',
      roomId: 'adv',
      settings: { fieldSize: 'small', seed: 2, chapter: 'workshop:99/maps/02.garden' },
      seats: [seats[0]],
    }, 'host-id');
    assert.equal(cfg.chapter, 'workshop:99/maps/02.garden');
    assert.equal(cfg.gardenUrl, 'workshop:99/maps/02.garden');
  });
});

describe('lobby map and spectator defaults', () => {
  it('starts 1v1 and teams on a generated field with spectators allowed', () => {
    const duel = defaultSettings('onevsone', 'tiny');
    assert.equal(duel.fieldSize, 'tiny');
    assert.equal(duel.chapter, '');
    assert.equal(duel.allowSpectators, true);
    assert.equal(defaultSettings('teams').allowSpectators, true);
    assert.equal(defaultSettings('adventure').allowSpectators, false);
    assert.equal(lobbyAllowsSpectators('onevsone', duel), true);
    assert.equal(lobbyAllowsSpectators('onevsone', { allowSpectators: false }), false);
    assert.equal(lobbyAllowsSpectators('adventure', { allowSpectators: true }), false);
    assert.equal(mapTypeFitsLobby('', 'teams'), true);
    assert.equal(mapTypeFitsLobby('1v1', 'onevsone'), true);
    assert.equal(mapTypeFitsLobby('teams', 'onevsone'), false);
    assert.equal(mapTypeFitsLobby('adventure', 'teams'), false);
  });
});

describe('chapterLabelFor', () => {
  it('names a chapter from id, garden url, or garden title', () => {
    assert.equal(chapterLabelFor({ chapter: 'ch2' }), 'Ch 2');
    assert.equal(chapterLabelFor({ gardenUrl: '/maps/chapter3.garden' }), 'Ch 3');
    assert.equal(chapterLabelFor({ name: 'Chapter 1' }), 'Ch 1');
    assert.equal(chapterLabelFor({ chapter: 'workshop:99', name: 'Grove' }), 'Grove');
    assert.equal(chapterLabelFor({ gardenUrl: 'workshop:99' }), 'Workshop');
  });
});

describe('adventure campaign picker', () => {
  it('lists only live chapters from the installed campaign', () => {
    installAdventureCampaign({
      v: 1,
      kind: 'campaign',
      name: 'Adventure',
      episodes: [
        { name: 'Episode 1', chapters: [{ file: 'opening.garden', name: 'Opening' }] },
        { name: 'Later', chapters: [{ file: 'wip.garden', name: 'WIP', live: false }] },
      ],
      gardens: {
        'opening.garden': { v: 4, n: 'Opening', w: 8, h: 8 },
        'wip.garden': { v: 4, n: 'WIP', w: 8, h: 8 },
      },
    });
    assert.deepEqual(selectableAdventureChapters().map((c) => c.name), ['Opening']);
    assert.deepEqual(selectableAdventureChapters().map((c) => c.episode), ['Episode 1']);
    assert.equal(gardenUrlForChapter('e1c1'), '');
    assert.equal(gardenUrlForChapter('pack:opening.garden'), 'pack:opening.garden');
  });
});
