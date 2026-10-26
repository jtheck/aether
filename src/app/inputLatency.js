const MAX_SAMPLES = 256;
const MAX_INTENT_AGE_MS = 2000;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

export function summarizeInputLatency(samples) {
  const stages = {
    inputToSubmit: (s) => s.submitAt - s.inputAt,
    submitToApply: (s) => s.applyAt - s.submitAt,
    applyToEligible: (s) => s.eligibleAt - s.applyAt,
    eligibleToRender: (s) => s.renderAt - s.eligibleAt,
    inputToRender: (s) => s.renderAt - s.inputAt,
  };
  const out = {};
  const usable = samples.filter((s) => !s.catchup && s.renderAt != null);
  for (const [name, read] of Object.entries(stages)) {
    const values = usable.map(read).filter(Number.isFinite).sort((a, b) => a - b);
    out[name] = {
      count: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    };
  }
  return out;
}

export function createInputLatencyProbe({
  enabled = false,
  sampleEvery = 4,
  now,
} = {}) {
  if (!enabled) {
    const noop = () => {};
    return {
      enabled: false,
      begin: noop,
      submitted: noop,
      applied: noop,
      eligible: noop,
      rendered: noop,
      dump: () => ({
        sampleCount: 0,
        pendingCount: 0,
        summary: summarizeInputLatency([]),
        samples: [],
      }),
    };
  }
  now ??= () => performance.now();
  let intentCount = 0;
  let latestIntent = null;
  const byCommand = new Map();
  const active = new Set();
  const completed = [];

  function begin(kind = 'input') {
    if (!enabled) return;
    intentCount++;
    latestIntent =
      intentCount % Math.max(1, sampleEvery | 0) === 0
        ? { inputAt: now(), kind }
        : null;
  }

  function submitted(frame) {
    if (!enabled || !frame?.commandId) return;
    const intent = latestIntent;
    latestIntent = null;
    if (!intent || now() - intent.inputAt > MAX_INTENT_AGE_MS) return;
    const sample = {
      ...intent,
      commandId: frame.commandId,
      tick: frame.tick | 0,
      submitAt: now(),
      applyAt: null,
      eligibleAt: null,
      renderAt: null,
      catchup: false,
    };
    byCommand.set(frame.commandId, sample);
    active.add(sample);
  }

  function applied(frames, tick, catchup = false) {
    if (!enabled) return;
    const at = now();
    for (const frame of frames ?? []) {
      const sample = byCommand.get(frame?.commandId);
      if (!sample) continue;
      sample.tick = tick | 0;
      sample.applyAt = at;
      sample.catchup = !!catchup;
    }
  }

  function eligible(displayTick) {
    if (!enabled) return;
    const at = now();
    for (const sample of active) {
      if (sample.applyAt != null && sample.eligibleAt == null && sample.tick <= displayTick) {
        sample.eligibleAt = at;
      }
    }
  }

  function rendered(displayTick) {
    if (!enabled) return;
    const at = now();
    for (const sample of [...active]) {
      if (sample.eligibleAt == null || sample.tick > displayTick) continue;
      sample.renderAt = at;
      active.delete(sample);
      byCommand.delete(sample.commandId);
      completed.push(sample);
      if (completed.length > MAX_SAMPLES) completed.shift();
    }
  }

  function dump() {
    const summary = summarizeInputLatency(completed);
    console.table(summary);
    return {
      sampleCount: completed.length,
      pendingCount: active.size,
      summary,
      samples: completed.map((s) => ({ ...s })),
    };
  }

  return { enabled, begin, submitted, applied, eligible, rendered, dump };
}

const enabled =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('inputLatency') === '1';

export const inputLatency = createInputLatencyProbe({ enabled });

if (enabled && typeof window !== 'undefined') {
  window.dumpInputLatency = () => inputLatency.dump();
}
