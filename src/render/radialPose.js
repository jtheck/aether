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
