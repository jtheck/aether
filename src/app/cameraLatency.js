const MAX_SAMPLES = 256;
const MAX_EVENT_AGE_MS = 1000;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

function stageSummary(samples) {
  const stages = {
    inputToIntegrate: (s) => s.integrateAt - s.inputAt,
    integrateToRender: (s) => s.renderAt - s.integrateAt,
    inputToRender: (s) => s.renderAt - s.inputAt,
  };
  const out = {};
  for (const [name, read] of Object.entries(stages)) {
    const values = samples.map(read).filter(Number.isFinite).sort((a, b) => a - b);
    out[name] = {
      count: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    };
  }
  return out;
}

export function summarizeCameraLatency(samples) {
  const complete = samples.filter((sample) => sample.renderAt != null);
  const byKind = {};
  for (const sample of complete) {
    (byKind[sample.kind] ??= []).push(sample);
  }
  return {
    overall: stageSummary(complete),
    byKind: Object.fromEntries(
      Object.entries(byKind).map(([kind, rows]) => [kind, stageSummary(rows)]),
    ),
  };
}

export function createCameraLatencyProbe({
  enabled = false,
  sampleEvery = 4,
  now,
} = {}) {
  if (!enabled) {
    const noop = () => {};
    return {
      enabled: false,
      begin: noop,
      integrated: noop,
      rendered: noop,
      dump: () => ({
        sampleCount: 0,
        pendingCount: 0,
        summary: summarizeCameraLatency([]),
        samples: [],
      }),
    };
  }
  now ??= () => performance.now();
  let inputCount = 0;
  let pending = null;
  let integrated = null;
  const completed = [];

  function begin(kind = 'camera', eventAt) {
    if (!enabled) return;
    inputCount++;
    if (inputCount % Math.max(1, sampleEvery | 0) !== 0) return;
    const at = now();
    const stamped = Number(eventAt);
    const inputAt =
      Number.isFinite(stamped) && stamped >= 0 && stamped <= at && at - stamped <= MAX_EVENT_AGE_MS
        ? stamped
        : at;
    // The latest sample is the pose the next frame should reflect.
    pending = { kind, inputAt, handlerAt: at, integrateAt: null, renderAt: null };
  }

  function markIntegrated() {
    if (!enabled || !pending) return;
    pending.integrateAt = now();
    integrated = pending;
    pending = null;
  }

  function rendered() {
    if (!enabled || !integrated) return;
    integrated.renderAt = now();
    completed.push(integrated);
    if (completed.length > MAX_SAMPLES) completed.shift();
    integrated = null;
  }

  function dump() {
    const summary = summarizeCameraLatency(completed);
    console.table(summary.overall);
    for (const [kind, rows] of Object.entries(summary.byKind)) {
      console.groupCollapsed?.(`[camera latency] ${kind}`);
      console.table(rows);
      console.groupEnd?.();
    }
    return {
      sampleCount: completed.length,
      pendingCount: Number(Boolean(pending)) + Number(Boolean(integrated)),
      summary,
      samples: completed.map((sample) => ({ ...sample })),
    };
  }

  return { enabled, begin, integrated: markIntegrated, rendered, dump };
}

const enabled =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('cameraLatency') === '1';

export const cameraLatency = createCameraLatencyProbe({ enabled });

if (enabled && typeof window !== 'undefined') {
  window.dumpCameraLatency = () => cameraLatency.dump();
}
