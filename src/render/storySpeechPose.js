// Where headset story copy sits. No scene objects.

/** Flat facing from the headset world matrix. Column 2's XZ is stick-forward. */
export function eyeFlatForward(wm) {
  const x = wm?.[8] || 0;
  const z = wm?.[10] || 0;
  const len = Math.hypot(x, z);
  if (len < 1e-5) return [0, 1];
  return [x / len, z / len];
}

/**
 * Ground point in front of the eye, a little closer than the look-down hit
 * so the card reads where the centered 2D narration sits.
 * @param {[number, number, number]} eye
 * @param {[number, number]} forward flat unit (x, z)
 * @param {number} groundY
 * @param {number} [lookDown]
 */
export function narratorPlanePose(eye, forward, groundY, lookDown = 0.36) {
  const tan = Math.tan(lookDown);
  const rise = (eye?.[1] || 0) - (Number.isFinite(groundY) ? groundY : 0);
  const gaze = rise > 1 ? rise / (tan > 1e-3 ? tan : 1) : 12;
  const dist = Math.max(8, Math.min(gaze * 0.72, 40));
  const fx = forward?.[0] || 0;
  const fz = forward?.[1] || 1;
  return {
    x: (eye?.[0] || 0) + fx * dist,
    y: (Number.isFinite(groundY) ? groundY : 0) + 0.35,
    z: (eye?.[2] || 0) + fz * dist,
    dist,
  };
}
