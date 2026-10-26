function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

export function createFrameProfile(frameCount = 40) {
  return {
    left: Math.max(1, frameCount | 0),
    samples: Object.create(null),
    n: 0,
    nFog: 0,
    inFrame: false,
    pendingOutside: 0,
  };
}

export function addFrameProfileSample(profile, phase, ms) {
  if (!profile || !Number.isFinite(ms) || ms < 0) return;
  (profile.samples[phase] ??= []).push(ms);
}

export function summarizeFrameProfile(profile) {
  const frameCount = Math.max(1, profile?.n | 0);
  return Object.entries(profile?.samples ?? {})
    .map(([phase, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      const round = (value) => value == null ? null : Math.round(value * 100) / 100;
      return {
        phase,
        samples: sorted.length,
        perFrameMs: round(total / frameCount),
        meanMs: round(total / Math.max(1, sorted.length)),
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        p99: round(percentile(sorted, 0.99)),
      };
    })
    .sort((a, b) => b.perFrameMs - a.perFrameMs);
}
