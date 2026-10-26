import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraLatencyProbe } from './cameraLatency.js';

describe('camera latency probe', () => {
  it('measures the latest sampled input through camera integration and render', () => {
    let t = 10;
    const probe = createCameraLatencyProbe({
      enabled: true,
      sampleEvery: 1,
      now: () => t,
    });

    probe.begin('wheel-zoom', 8);
    t = 11;
    probe.begin('pointer-pan', 10);
    t = 16;
    probe.integrated();
    t = 19;
    probe.rendered();

    const table = console.table;
    const group = console.groupCollapsed;
    const groupEnd = console.groupEnd;
    console.table = () => {};
    console.groupCollapsed = () => {};
    console.groupEnd = () => {};
    const result = probe.dump();
    console.table = table;
    console.groupCollapsed = group;
    console.groupEnd = groupEnd;

    assert.equal(result.sampleCount, 1);
    assert.equal(result.samples[0].kind, 'pointer-pan');
    assert.deepEqual(result.summary.overall.inputToRender, {
      count: 1,
      p50: 9,
      p95: 9,
      p99: 9,
    });
    assert.equal(result.summary.overall.inputToIntegrate.p50, 6);
    assert.equal(result.summary.overall.integrateToRender.p50, 3);
  });
});
