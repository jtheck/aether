import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { corpseCompactDue } from './corpseCompact.js';

const base = {
  minHold: 64,
  fraction: 0.08,
  minIntervalMs: 1000,
  lastCompact: 0,
  now: 5000,
};

describe('corpseCompactDue', () => {
  it('waits for a fraction of units that are still alive', () => {
    assert.equal(corpseCompactDue({
      ...base,
      count: 50000,
      fadedCorpses: 3000,
      retired: 0,
    }), false);
    assert.equal(corpseCompactDue({
      ...base,
      count: 50000,
      fadedCorpses: 4000,
      retired: 0,
    }), true);
  });

  it('flushes immediately once nothing is left alive or fading', () => {
    assert.equal(corpseCompactDue({
      ...base,
      count: 50000,
      fadedCorpses: 50000,
      retired: 47000,
      now: 100,
      lastCompact: 0,
    }), true);
  });

  it('does not compact corpses the renderer already dropped', () => {
    assert.equal(corpseCompactDue({
      ...base,
      count: 50000,
      fadedCorpses: 50000,
      retired: 50000,
    }), false);
  });

  it('rate-limits compacts while units are still up', () => {
    assert.equal(corpseCompactDue({
      ...base,
      count: 1000,
      fadedCorpses: 200,
      retired: 0,
      now: 500,
      lastCompact: 0,
    }), false);
  });
});
