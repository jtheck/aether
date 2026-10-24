import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInputLatencyProbe } from './inputLatency.js';

describe('input latency probe', () => {
  it('tracks a command through apply, display eligibility, and first render', () => {
    let t = 0;
    const probe = createInputLatencyProbe({
      enabled: true,
      sampleEvery: 1,
      now: () => t,
    });
    probe.begin('pointer');
    t = 3;
    probe.submitted({ commandId: '0:1', tick: 4 });
    t = 80;
    probe.applied([{ commandId: '0:1' }], 4);
    t = 105;
    probe.eligible(4);
    t = 108;
    probe.rendered(4);

    const table = console.table;
    console.table = () => {};
    const result = probe.dump();
    console.table = table;

    assert.equal(result.sampleCount, 1);
    assert.deepEqual(result.summary.inputToRender, {
      count: 1,
      p50: 108,
      p95: 108,
      p99: 108,
    });
    assert.equal(result.summary.submitToApply.p50, 77);
    assert.equal(result.summary.applyToEligible.p50, 25);
    assert.equal(result.summary.eligibleToRender.p50, 3);
  });
});
