import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_MAP_PREVIEW_URL } from '../houseMapCatalog.js';
import { ladderMapLabel, ladderMapPreviewUrl } from './ladderDialog.js';

test('a dealt official map shows its name', () => {
  assert.equal(ladderMapLabel({
    phase: 'countdown',
    settings: { mapName: 'The Ford', fieldSize: 'small' },
  }), 'The Ford');
});

test('a generated field shows its size once the countdown starts', () => {
  assert.equal(ladderMapLabel({
    phase: 'countdown',
    settings: { mapName: '', fieldSize: 'medium' },
  }), 'Medium');
});

test('the default size stays hidden until the match is dealt', () => {
  assert.equal(ladderMapLabel({
    phase: 'waiting',
    settings: { mapName: '', fieldSize: 'small' },
  }), '');
});

test('the countdown picture follows the dealt map', () => {
  const official = {
    phase: 'countdown',
    settings: { mapName: 'Ford', chapter: '/maps/skirmish/ford.garden', fieldSize: 'small' },
  };
  assert.equal(ladderMapPreviewUrl(official), AUTO_MAP_PREVIEW_URL);
  const generated = {
    phase: 'countdown',
    settings: { mapName: '', chapter: '', fieldSize: 'medium' },
  };
  assert.equal(ladderMapPreviewUrl(generated), AUTO_MAP_PREVIEW_URL);
  assert.equal(ladderMapPreviewUrl({
    phase: 'waiting',
    settings: { mapName: '', chapter: '', fieldSize: 'small' },
  }), '');
  assert.equal(ladderMapPreviewUrl({
    phase: 'countdown',
    settings: { mapName: 'Mine', chapter: 'session', fieldSize: 'small' },
  }), AUTO_MAP_PREVIEW_URL);
});
