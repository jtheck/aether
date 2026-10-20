/** Reference distance stays on FLAG_BASE_SCALE; closer and farther ease off the linear ramp. */
export const FLAG_BASE_SCALE = 2.15;
export const FLAG_DIST_REF = 110;
export const FLAG_SCALE_MIN = 1.35;
export const FLAG_SCALE_MAX = 3.4;
/**
 * 1 would hold screen size (scale ∝ distance) and reads as a zoom pop.
 * Sublinear keeps far banners readable without racing the caps.
 */
export const FLAG_SCALE_EXP = 0.7;

export function flagScaleForDist(dist) {
  const t = Math.max(0, dist) / FLAG_DIST_REF;
  const ratio = t > 0 ? t ** FLAG_SCALE_EXP : 0;
  const scale = FLAG_BASE_SCALE * ratio;
  if (scale < FLAG_SCALE_MIN) return FLAG_SCALE_MIN;
  if (scale > FLAG_SCALE_MAX) return FLAG_SCALE_MAX;
  return scale;
}

/** 1 at {@link FLAG_DIST_REF}. Grows with the banner as the eye pulls back. */
export function flagScaleMul(dist) {
  return flagScaleForDist(dist > 1e-3 ? dist : FLAG_DIST_REF) / FLAG_BASE_SCALE;
}

/**
 * Capture dots and their bursts follow the flag, then stop short of the
 * banner's far cap so the row does not balloon at max zoom.
 */
export const AGORA_CAPTURE_SCALE_MAX = 1.25;

export function agoraCaptureDotMul(dist) {
  const m = flagScaleMul(dist);
  return m > AGORA_CAPTURE_SCALE_MAX ? AGORA_CAPTURE_SCALE_MAX : m;
}

/**
 * World-motion multiplier that holds a burst's reference-distance travel,
 * then lets it grow with the capture row. 1 when the eye distance is unknown.
 */
export function agoraFxSizeMul(dist) {
  if (!(dist > 1e-3)) return 1;
  return agoraCaptureDotMul(dist) * (dist / FLAG_DIST_REF);
}

function mul3(v, m) {
  return [v[0] * m, v[1] * m, v[2] * m];
}

function mulSize(s, m) {
  if (Array.isArray(s)) return [s[0] * m, s[1] * m];
  if (typeof s === 'number') return s * m;
  return s;
}

/**
 * Scale a capture burst and keep it out of the distance cull.
 * Size and motion multipliers are separate so a dot-sized sprite can
 * speed up without being resized a second time.
 */
export function stampAgoraFx(init, sizeMul = 1, motionMul = 1) {
  const sm = sizeMul > 0 ? sizeMul : 1;
  const mm = motionMul > 0 ? motionMul : 1;
  if (sm !== 1) {
    if (init.startSize != null) init.startSize = mulSize(init.startSize, sm);
    if (init.peakSize != null) init.peakSize = mulSize(init.peakSize, sm);
    if (init.endSize != null) init.endSize = mulSize(init.endSize, sm);
  }
  if (mm !== 1 && init.velocity) init.velocity = mul3(init.velocity, mm);
  if (mm !== 1 && init.gravity) init.gravity = mul3(init.gravity, mm);
  init.cull = false;
  return init;
}
