import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFrameProfileSample,
  createFrameProfile,
  summarizeFrameProfile,
} from './frameProfile.js';

describe('frame profile summary', () => {
  it('reports tail latency and distinguishes sparse work from per-frame cost', () => {
    const profile = createFrameProfile(4);
    profile.n = 4;
    for (const value of [1, 2, 3, 20]) {
      addFrameProfileSample(profile, 'appTotal', value);
    }
    addFrameProfileSample(profile, 'fogUpload', 8);

    const rows = summarizeFrameProfile(profile);
    const app = rows.find((row) => row.phase === 'appTotal');
    const fog = rows.find((row) => row.phase === 'fogUpload');
    assert.deepEqual(app, {
      phase: 'appTotal',
      samples: 4,
      perFrameMs: 6.5,
      meanMs: 6.5,
      p50: 2,
      p95: 20,
      p99: 20,
    });
    assert.equal(fog.samples, 1);
    assert.equal(fog.meanMs, 8);
    assert.equal(fog.perFrameMs, 2);
  });
});
