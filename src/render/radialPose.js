/**
 * Pose helpers so a tilted radial's hub hole stays on the selected building.
 * Scale is refined from the posed center so HUD size stays stable.
 */

/**
 * Slide `liftY` above the building onto the camera→building ray.
 * The hub hole then shares the building's screen position.
 *
 * @param {{ x: number, y: number, z: number }} eye
 * @param {number} anchorX
 * @param {number} anchorY
 * @param {number} anchorZ
 * @param {number} liftY
 * @returns {{ x: number, y: number, z: number }}
 */
export function frameRadialCenterOnAnchor(eye, anchorX, anchorY, anchorZ, liftY) {
  const desiredY = anchorY + liftY;
  const dy = anchorY - eye.y;
  if (!Number.isFinite(desiredY) || Math.abs(dy) < 1e-5) {
    return { x: anchorX, y: desiredY, z: anchorZ };
  }
  let t = (desiredY - eye.y) / dy;
  if (!Number.isFinite(t)) {
    return { x: anchorX, y: desiredY, z: anchorZ };
  }
  // Stay between the eye and the building so the hole frames it.
  t = Math.max(0.08, Math.min(0.97, t));
  return {
    x: eye.x + t * (anchorX - eye.x),
    y: eye.y + t * (anchorY - eye.y),
    z: eye.z + t * (anchorZ - eye.z),
  };
}

/**
 * Near-ring ground clearance used by both radials (sin(tilt) * rim + pad).
 * @param {number} tilt
 * @param {number} rimR
 * @param {number} hudScale
 * @param {number} [extraLift]
 */
export function radialNearRingLift(tilt, rimR, hudScale, extraLift = 1.2) {
  return Math.sin(tilt) * rimR * hudScale + extraLift;
}

/**
 * Frame the selected building in the hub hole and return the posed center + scale.
 *
 * @param {{ x: number, y: number, z: number }} eye
 * @param {number} anchorX
 * @param {number} anchorY
 * @param {number} anchorZ
 * @param {(dist: number) => number} scaleForDist
 * @param {number} rimR
 * @param {number} tilt
 * @param {number} [extraLift]
 * @returns {{ x: number, y: number, z: number, hudScale: number }}
 */
export function poseRadialFramingBuilding(
  eye,
  anchorX,
  anchorY,
  anchorZ,
  scaleForDist,
  rimR,
  tilt,
  extraLift = 1.2,
) {
  const distA =
    Math.hypot(eye.x - anchorX, eye.y - anchorY, eye.z - anchorZ) || 110;
  let hudScale = scaleForDist(distA);
  let center = frameRadialCenterOnAnchor(
    eye,
    anchorX,
    anchorY,
    anchorZ,
    radialNearRingLift(tilt, rimR, hudScale, extraLift),
  );
  const distC =
    Math.hypot(eye.x - center.x, eye.y - center.y, eye.z - center.z) || 110;
  hudScale = scaleForDist(distC);
  center = frameRadialCenterOnAnchor(
    eye,
    anchorX,
    anchorY,
    anchorZ,
    radialNearRingLift(tilt, rimR, hudScale, extraLift),
  );
  const distFinal =
    Math.hypot(eye.x - center.x, eye.y - center.y, eye.z - center.z) || 110;
  return {
    x: center.x,
    y: center.y,
    z: center.z,
    hudScale: scaleForDist(distFinal),
  };
}

/**
 * Camera-right / camera-up at a world point (world Y is up).
 * @param {{ x: number, y: number, z: number }} eye
 */
export function cameraRightUp(eye, x, y, z) {
  let vx = x - eye.x;
  let vy = y - eye.y;
  let vz = z - eye.z;
  const vlen = Math.hypot(vx, vy, vz);
  if (vlen < 1e-6) return { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };
  vx /= vlen;
  vy /= vlen;
  vz /= vlen;
  let rx = vz;
  let ry = 0;
  let rz = -vx;
  const rlen = Math.hypot(rx, rz);
  if (rlen < 1e-4) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rlen;
    rz /= rlen;
  }
  let ux = vy * rz - vz * ry;
  let uy = vz * rx - vx * rz;
  let uz = vx * ry - vy * rx;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  return { rx, ry, rz, ux, uy, uz };
}

/**
 * Apparent CSS-px radius of a world-space disc at `hud` depth.
 * @param {(x: number, y: number, z: number) => { x: number, y: number } | null} worldToScreen
 */
export function apparentScreenRadius(eye, x, y, z, worldR, worldToScreen) {
  const c = worldToScreen?.(x, y, z);
  if (!c || !(worldR > 0)) return 0;
  const { rx, ry, rz, ux, uy, uz } = cameraRightUp(eye, x, y, z);
  const pR = worldToScreen(x + rx * worldR, y + ry * worldR, z + rz * worldR);
  const pU = worldToScreen(x + ux * worldR, y + uy * worldR, z + uz * worldR);
  let r = 0;
  if (pR) r = Math.max(r, Math.hypot(pR.x - c.x, pR.y - c.y));
  if (pU) r = Math.max(r, Math.hypot(pU.x - c.x, pU.y - c.y));
  return r;
}

function smoothstep(edge0, edge1, x) {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function screenToWorldDelta(eye, x, y, z, dx, dy, worldToScreen) {
  if (!dx && !dy) return { x: 0, y: 0, z: 0 };
  const { rx, ry, rz, ux, uy, uz } = cameraRightUp(eye, x, y, z);
  const probe = 8;
  const c = worldToScreen(x, y, z);
  if (!c) return { x: 0, y: 0, z: 0 };
  const pR = worldToScreen(x + rx * probe, y + ry * probe, z + rz * probe);
  const pU = worldToScreen(x + ux * probe, y + uy * probe, z + uz * probe);
  const pxR = pR ? Math.hypot(pR.x - c.x, pR.y - c.y) / probe : 0;
  const pxU = pU ? Math.hypot(pU.x - c.x, pU.y - c.y) / probe : 0;
  const alongR = pxR > 1e-6 ? dx / pxR : 0;
  const alongU = pxU > 1e-6 ? -dy / pxU : 0;
  return {
    x: rx * alongR + ux * alongU,
    y: ry * alongR + uy * alongU,
    z: rz * alongR + uz * alongU,
  };
}

/** Max relative shrink vs unconstrained HUD scale. */
export const RADIAL_EDGE_SHRINK_FLOOR = 0.78;
/** Unconstrained fit fraction used to size the fade band. */
export const RADIAL_EDGE_FADE_OUT = 0.38;
/** Hang this fraction of min(vw, vh) past the viewport before slide starts. */
export const RADIAL_EDGE_OVERFLOW_FRAC = 0.08;
/** Max hub slide, as a fraction of the unconstrained disc's screen radius. */
export const RADIAL_EDGE_SLIDE_FRAC = 0.45;
/** First this fraction of max slide is slide-only; then shrink mixes in. */
export const RADIAL_EDGE_SLIDE_ONLY_FRAC = 0.55;
export const RADIAL_EDGE_FADE_OUT_TAU = 0.18;
export const RADIAL_EDGE_FADE_IN_TAU = 0.12;
/** Picks turn off before the menu is fully gone. */
export const RADIAL_EDGE_PICK_ALPHA = 0.22;
/**
 * Lite bakes opaque vs blend from `alpha < 1` on first draw. HUD meshes that
 * later fade must stay strictly below 1 or they pop off instead of fading.
 */
export const RADIAL_HUD_BLEND_ALPHA = 0.999;

/**
 * Mesh fade alpha. Text/DOM can use `base * edgeOpacity` directly.
 * @param {number} [base]
 * @param {number} edgeOpacity
 */
export function radialHudFadeAlpha(base, edgeOpacity) {
  const a = (base ?? 1) * edgeOpacity;
  if (!(a > 0)) return 0;
  return a >= 1 ? RADIAL_HUD_BLEND_ALPHA : a;
}

/**
 * Lite text blends premultiplied (`src=one`) but only multiplies *alpha* by
 * layer.opacity, so names stay solid unless RGB is premultiplied here.
 * @param {number[] | null | undefined} rgba
 * @param {number} opacity
 * @returns {number[]}
 */
export function radialHudPremulRgba(rgba, opacity) {
  const r = rgba?.[0] ?? 1;
  const g = rgba?.[1] ?? 1;
  const b = rgba?.[2] ?? 1;
  const a = Math.max(0, Math.min(1, (rgba?.[3] ?? 1) * opacity));
  return [r * a, g * a, b * a, a];
}

/**
 * @param {number} wantMul unconstrained fit (1 = on-screen, 0 = center at the edge)
 */
export function radialEdgeOpacity(
  wantMul,
  shrinkFloor = RADIAL_EDGE_SHRINK_FLOOR,
  fadeOut = RADIAL_EDGE_FADE_OUT,
) {
  if (!(wantMul > fadeOut)) return 0;
  if (wantMul >= shrinkFloor) return 1;
  return smoothstep(fadeOut, shrinkFloor, wantMul);
}

/**
 * Ease displayed opacity toward the spatial target.
 * @param {number} current
 * @param {number} target
 * @param {number} dt seconds
 */
export function stepRadialEdgeOpacity(
  current,
  target,
  dt,
  outTau = RADIAL_EDGE_FADE_OUT_TAU,
  inTau = RADIAL_EDGE_FADE_IN_TAU,
) {
  const cur = Math.max(0, Math.min(1, current));
  const dest = Math.max(0, Math.min(1, target));
  if (!(dt > 0) || dt >= 1) return dest;
  const tau = dest < cur ? outTau : inTau;
  const next = cur + (dest - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
  return Math.abs(dest - next) < 0.008 ? dest : Math.max(0, Math.min(1, next));
}

/**
 * Slide in, then mix in shrink, then freeze the slide and fade.
 *
 * @param {{
 *   eye: { x: number, y: number, z: number },
 *   x: number, y: number, z: number,
 *   hudScale: number,
 *   worldRadius: number,
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   getViewport?: () => { width: number, height: number } | null,
 *   marginPx?: number,
 *   shrinkFloor?: number,
 *   fadeOut?: number,
 *   overflowFrac?: number,
 *   slideFrac?: number,
 *   slideOnlyFrac?: number,
 * }} opts
 * @returns {{ x: number, y: number, z: number, hudScale: number, opacity: number, hidden: boolean }}
 */
export function fitRadialInViewport(opts) {
  let x = opts.x;
  let y = opts.y;
  let z = opts.z;
  const unconstrained = opts.hudScale;
  let hudScale = unconstrained;
  const eye = opts.eye;
  const worldR1 = opts.worldRadius;
  const w2s = opts.worldToScreen;
  const vp = opts.getViewport?.();
  const vw = vp?.width ?? 0;
  const vh = vp?.height ?? 0;
  const shrinkFloor = opts.shrinkFloor ?? RADIAL_EDGE_SHRINK_FLOOR;
  const fadeOut = opts.fadeOut ?? RADIAL_EDGE_FADE_OUT;
  const slideFrac = opts.slideFrac ?? RADIAL_EDGE_SLIDE_FRAC;
  const slideOnlyFrac = opts.slideOnlyFrac ?? RADIAL_EDGE_SLIDE_ONLY_FRAC;
  if (!w2s || vw < 8 || vh < 8 || !(worldR1 > 0) || !eye) {
    return { x, y, z, hudScale, opacity: 1, hidden: false };
  }
  const overflow = opts.overflowFrac ?? RADIAL_EDGE_OVERFLOW_FRAC;
  const margin =
    opts.marginPx ?? -Math.min(vw, vh) * overflow;

  const c = w2s(x, y, z);
  if (!c) return { x, y, z, hudScale, opacity: 1, hidden: false };
  const r = apparentScreenRadius(eye, x, y, z, worldR1 * unconstrained, w2s);
  if (!(r > 1e-3)) return { x, y, z, hudScale, opacity: 1, hidden: false };

  let dx = 0;
  let dy = 0;
  if (c.x - r < margin) dx += margin + r - c.x;
  if (c.x + r > vw - margin) dx += vw - margin - r - c.x;
  if (c.y - r < margin) dy += margin + r - c.y;
  if (c.y + r > vh - margin) dy += vh - margin - r - c.y;
  const need = Math.hypot(dx, dy);

  const slideMax = r * slideFrac;
  const slideOnly = slideMax * Math.max(0, Math.min(1, slideOnlyFrac));
  const shrinkPx = (1 - shrinkFloor) * r;
  const mixSpan = slideMax - slideOnly + shrinkPx;

  let slideLen = 0;
  let scaleMul = 1;
  let opacity = 1;
  if (need > 0.5) {
    if (need <= slideOnly) {
      slideLen = need;
    } else if (need <= slideOnly + mixSpan) {
      const u = mixSpan > 1e-6 ? (need - slideOnly) / mixSpan : 1;
      slideLen = slideOnly + u * (slideMax - slideOnly);
      scaleMul = 1 - u * (1 - shrinkFloor);
    } else {
      slideLen = slideMax;
      scaleMul = shrinkFloor;
      const extra = need - slideMax - shrinkPx;
      const leftover = Math.max(0, shrinkFloor * r - slideMax);
      const fadePx = Math.max(1e-3, Math.min((shrinkFloor - fadeOut) * r, leftover));
      opacity = extra >= fadePx ? 0 : 1 - smoothstep(0, fadePx, extra);
    }
  }

  if (slideLen > 1e-4 && need > 1e-4) {
    const k = slideLen / need;
    const w = screenToWorldDelta(eye, x, y, z, dx * k, dy * k, w2s);
    x += w.x;
    y += w.y;
    z += w.z;
  }
  hudScale = unconstrained * scaleMul;

  return { x, y, z, hudScale, opacity, hidden: opacity <= 0 };
}
