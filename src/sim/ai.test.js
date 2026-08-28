// AI roster helpers — leftover loading-screen AI must never puppet a human slot.

import assert from 'node:assert/strict';
import {
  excludeHumanAiPlayers,
  resolveSessionAiPlayers,
} from './ai.js';

const loadingScreenAi = [{ owner: 1, temperament: 'passive' }];

function dropsHumanSlots() {
  assert.deepEqual(
    excludeHumanAiPlayers(loadingScreenAi, [0, 1]),
    [],
    'first KOTH joiner is owner 1 — same id as the loading-screen AI',
  );
  assert.deepEqual(
    excludeHumanAiPlayers([0, { owner: 1 }, { owner: 2 }], [0, 1]),
    [{ owner: 2 }],
  );
}

function liveKothClearsLeftoverAi() {
  assert.deepEqual(
    resolveSessionAiPlayers(
      { mode: 'koth', localSolo: false, humanPlayers: [0, 1] },
      loadingScreenAi,
    ),
    [],
    'live P2P KOTH drops leftover backdrop AI even when cfg omits aiPlayers',
  );
  assert.deepEqual(
    resolveSessionAiPlayers(
      { mode: 'koth', localSolo: false, aiPlayers: [], humanPlayers: [0] },
      loadingScreenAi,
    ),
    [],
  );
}

function soloKeepsExplicitAi() {
  assert.deepEqual(
    resolveSessionAiPlayers(
      {
        mode: 'koth',
        localSolo: true,
        aiPlayers: loadingScreenAi,
        humanPlayers: [0],
      },
      [],
    ),
    loadingScreenAi,
    'offline 1v1 / loading-screen backdrop still gets the passive opponent',
  );
}

function neverOverlapsHumans() {
  assert.deepEqual(
    resolveSessionAiPlayers(
      {
        mode: 'koth',
        localSolo: true,
        aiPlayers: loadingScreenAi,
        humanPlayers: [0, 1],
      },
      [],
    ),
    [],
    'even an explicit AI list cannot own a human lockstep slot',
  );
}

dropsHumanSlots();
liveKothClearsLeftoverAi();
soloKeepsExplicitAi();
neverOverlapsHumans();
console.log('ai.test.js: ok (human slots never get leftover AI)');
