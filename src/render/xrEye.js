// Headset pose for systems that otherwise read the desktop orbit camera.
// The XR draw already uses the eye camera; this is for CPU work that runs
// before that camera exists for the frame (unit scale, scenery LOD, billboards).

const world = new Float32Array(16);
world[0] = world[5] = world[10] = world[15] = 1;
let version = 1;

/** @type {{ x: number, y: number, z: number, worldMatrix: Float32Array } | null} */
let eye = null;

const view = {
  get x() { return world[12]; },
  get y() { return world[13]; },
  get z() { return world[14]; },
  worldMatrix: world,
};

/** Copy a WebXR pose into Lite's left-handed scene, same as the eye camera. */
export function setXrEyeFromPose(rh) {
  world[0] = rh[0];
  world[1] = rh[1];
  world[2] = -rh[2];
  world[3] = 0;
  world[4] = rh[4];
  world[5] = rh[5];
  world[6] = -rh[6];
  world[7] = 0;
  world[8] = -rh[8];
  world[9] = -rh[9];
  world[10] = rh[10];
  world[11] = 0;
  world[12] = rh[12];
  world[13] = rh[13];
  world[14] = -rh[14];
  world[15] = 1;
  version += 1;
  eye = view;
}

export function xrEyeVersion() {
  return version;
}

export function clearXrEye() {
  eye = null;
}

export function xrEye() {
  return eye;
}

/**
 * Desktop orbit: the camera sits on a pole above a spot on the board and looks
 * at that spot. Same placement, with the spot moved under the headset.
 * Returns the pole length (head height above the ground).
 */
export function writeAnchoredOrbit(out, headX, headY, headZ, groundY, alpha, beta) {
  const radius = Math.max(12, headY - groundY);
  let sinB = Math.sin(beta);
  if (sinB === 0) sinB = 1e-4;
  const cosB = Math.cos(beta);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const target = { x: headX, y: groundY, z: headZ };
  const eyePos = {
    x: target.x + radius * cosA * sinB,
    y: target.y + radius * cosB,
    z: target.z + radius * sinA * sinB,
  };
  lookAtWorld(out, eyePos, target);
  return radius;
}

/**
 * Depth window for the shadow pole. The ground under the head is `radius`
 * along the view. The window starts in front of that and ends a few pole
 * lengths past it, so the close slices land on the ground instead of on the
 * empty air between the camera and the table.
 */
export function xrShadowDepth(radius) {
  const r = Math.max(12, radius);
  return {
    near: Math.max(0.35, r * 0.45),
    far: Math.max(48, r * 4),
  };
}

function lookAtWorld(out, eyePos, target) {
  out[3] = 0;
  out[7] = 0;
  out[11] = 0;
  out[12] = eyePos.x;
  out[13] = eyePos.y;
  out[14] = eyePos.z;
  out[15] = 1;
  let zx = target.x - eyePos.x;
  let zy = target.y - eyePos.y;
  let zz = target.z - eyePos.z;
  const zLen = Math.hypot(zx, zy, zz);
  const upX = 0;
  const upY = 1;
  const upZ = 0;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let xLen = 0;
  if (zLen >= 1e-10) {
    const invZ = 1 / zLen;
    zx *= invZ;
    zy *= invZ;
    zz *= invZ;
    xx = upY * zz - upZ * zy;
    xy = upZ * zx - upX * zz;
    xz = upX * zy - upY * zx;
    xLen = Math.hypot(xx, xy, xz);
  }
  if (xLen < 1e-10) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    return;
  }
  const invX = 1 / xLen;
  xx *= invX;
  xy *= invX;
  xz *= invX;
  out[0] = xx;
  out[1] = xy;
  out[2] = xz;
  out[4] = zy * xz - zz * xy;
  out[5] = zz * xx - zx * xz;
  out[6] = zx * xy - zy * xx;
  out[8] = zx;
  out[9] = zy;
  out[10] = zz;
}
