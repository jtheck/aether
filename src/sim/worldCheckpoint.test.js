// World checkpoint encode/decode smoke test (no worker).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { buildField } from './field.js';
import { applyTableSilhouette } from './tableShape.js';
import { populateScenery } from './scenery.js';
import { kothBases } from './worldSetup.js';
import { checksum } from './checksum.js';
import { createKothMeta } from './kothMeta.js';
import { exportWorldCheckpoint, importWorldCheckpoint } from './worldCheckpoint.js';
import { UNIT } from './unitTypes.js';
import * as fx from './fixed.js';

test('checkpoint round-trips entity + koth state with matching checksum', () => {
  const seed = 0xabcd;
  const field = buildField(seed, { width: 64, height: 64 });
  applyTableSilhouette(field);
  populateScenery(field, createWorld(seed), kothBases(field.worldHalfF));
  const w = createWorld(seed);
  w.koth = createKothMeta([0, 1]);
  spawn(w, { x: fx.fromInt(10), y: fx.fromInt(12), type: UNIT.VILLAGER, owner: 0 });
  spawn(w, { x: fx.fromInt(-8), y: fx.fromInt(4), type: UNIT.WARRIOR, owner: 1 });
  w.tick = 42;
  w.rng.s = 0x12345678;

  const cs = checksum(w, field);
  const blob = exportWorldCheckpoint(w, field, cs);
  assert.equal(blob.tick, 42);
  assert.equal(blob.checksum, cs);

  const w2 = createWorld(seed);
  w2.koth = createKothMeta([]);
  const field2 = buildField(seed, { width: 64, height: 64 });
  applyTableSilhouette(field2);
  populateScenery(field2, createWorld(seed), kothBases(field2.worldHalfF));
  importWorldCheckpoint(w2, field2, blob);

  assert.equal(w2.tick, 42);
  assert.equal(w2.count, 2);
  assert.equal(w2.rng.s, 0x12345678);
  assert.equal(checksum(w2, field2), cs);
});
