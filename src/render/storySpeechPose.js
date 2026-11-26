// Where headset story copy sits. No scene objects.

/**
 * Same plane as the screen HUD (ICON_DEPTH 0.8). Unit lines share that
 * tilt and drift instead of floating on their own billboard.
 */
export const XR_SPEECH_HUD_DEPTH = 0.8;
/** Full tangent span of one line. Small enough to sit inside the chrome oval. */
export const XR_SPEECH_TAN_W = 0.32;
export const XR_SPEECH_TAN_H = 0.11;
/** Column center. The plaque stays inside the chrome tangent and off the view axis. */
export const XR_SPEECH_COLUMN_H = 0.38;
/** Top slot, under the selection arc. Further lines step down. */
export const XR_SPEECH_STACK_TOP = 0.18;
export const XR_SPEECH_STACK_STEP = 0.125;
export const XR_SPEECH_STACK = 5;
/** A speaker inside this tangent, and in front of the eye, keeps its bubble. */
export const XR_SPEECH_UNIT_TAN_H = 0.5;
export const XR_SPEECH_UNIT_TAN_V = 0.42;

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

/**
 * Unit tangents from the eye toward a world point in view space.
 * @param {Float32Array | number[]} wm
 * @param {{ x: number, y?: number, z: number }} point
 */
export function speakerViewTangent(wm, point) {
  const fx = wm?.[8] || 0;
  const fy = wm?.[9] || 0;
  const fz = wm?.[10] || 1;
  const rx = wm?.[0] || 0;
  const ry = wm?.[1] || 0;
  const rz = wm?.[2] || 0;
  const ux = wm?.[4] || 0;
  const uy = wm?.[5] || 1;
  const uz = wm?.[6] || 0;
  const ex = wm?.[12] || 0;
  const ey = wm?.[13] || 0;
  const ez = wm?.[14] || 0;
  const py = Number.isFinite(point?.y) ? point.y : ey;
  const dx = (point?.x || 0) - ex;
  const dy = py - ey;
  const dz = (point?.z || 0) - ez;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const ahead = fx * nx + fy * ny + fz * nz;
  if (ahead < 1e-4) {
    return { hTan: 0, vTan: 0, ahead: 0 };
  }
  const right = rx * nx + ry * ny + rz * nz;
  const up = ux * nx + uy * ny + uz * nz;
  return { hTan: right / ahead, vTan: up / ahead, ahead };
}

/**
 * Which HUD column a speaker belongs on. Sign only; the slot itself sticks.
 * @param {Float32Array | number[]} wm
 * @param {{ x: number, y?: number, z: number }} point
 */
export function speechSide(wm, point) {
  const view = speakerViewTangent(wm, point);
  if (view.ahead > 1e-3 && Math.abs(view.hTan) > 0.04) return view.hTan < 0 ? -1 : 1;
  const rx = wm?.[0] || 0;
  const ry = wm?.[1] || 0;
  const rz = wm?.[2] || 0;
  const dx = (point?.x || 0) - (wm?.[12] || 0);
  const dy = (Number.isFinite(point?.y) ? point.y : (wm?.[13] || 0)) - (wm?.[13] || 0);
  const dz = (point?.z || 0) - (wm?.[14] || 0);
  const right = rx * dx + ry * dy + rz * dz;
  return right < 0 ? -1 : 1;
}

/**
 * Keep a line on the column slot it already has. New lines take the next
 * free step on their side, then the other side. Nothing is re-picked
 * because the head turned.
 * @param {{ key: string, side: number }[]} wishes
 * @param {Map<string, { side: number, index: number }>} [hold]
 */
export function assignSpeechColumns(wishes, hold) {
  const prev = hold instanceof Map ? hold : new Map();
  /** @type {Map<string, { side: number, index: number }>} */
  const next = new Map();
  const used = new Map([[-1, new Set()], [1, new Set()]]);
  for (const wish of wishes) {
    const kept = prev.get(wish.key);
    if (!kept) continue;
    const bag = used.get(kept.side);
    if (!bag || bag.has(kept.index) || kept.index < 0 || kept.index >= XR_SPEECH_STACK) continue;
    bag.add(kept.index);
    next.set(wish.key, { side: kept.side, index: kept.index });
  }
  for (const wish of wishes) {
    if (next.has(wish.key)) continue;
    const prefer = wish.side < 0 ? -1 : 1;
    let placed = null;
    for (const side of [prefer, -prefer]) {
      const bag = used.get(side);
      for (let i = 0; i < XR_SPEECH_STACK; i++) {
        if (bag.has(i)) continue;
        bag.add(i);
        placed = { side, index: i };
        break;
      }
      if (placed) break;
    }
    if (placed) next.set(wish.key, placed);
  }
  return next;
}

/**
 * HUD-plane pose for one stack slot. Axes match the HUD matrix.
 * @param {Float32Array | number[]} wm
 * @param {number} side
 * @param {number} index
 */
export function speechColumnPose(wm, side, index) {
  const d = XR_SPEECH_HUD_DEPTH;
  const h = (side < 0 ? -1 : 1) * XR_SPEECH_COLUMN_H;
  const v = XR_SPEECH_STACK_TOP - Math.max(0, index | 0) * XR_SPEECH_STACK_STEP;
  const rx = wm?.[0] || 1;
  const ry = wm?.[1] || 0;
  const rz = wm?.[2] || 0;
  const ux = wm?.[4] || 0;
  const uy = wm?.[5] || 1;
  const uz = wm?.[6] || 0;
  const fx = wm?.[8] || 0;
  const fy = wm?.[9] || 0;
  const fz = wm?.[10] || 1;
  return {
    h,
    v,
    x: (wm?.[12] || 0) + (fx + rx * h + ux * v) * d,
    y: (wm?.[13] || 0) + (fy + ry * h + uy * v) * d,
    z: (wm?.[14] || 0) + (fz + rz * h + uz * v) * d,
    width: XR_SPEECH_TAN_W * d,
    height: XR_SPEECH_TAN_H * d,
    yAxis: [ux, uy, uz],
    zAxis: [-fx, -fy, -fz],
  };
}

/**
 * The speaker is in front of the eye and inside the view, so the line can
 * sit on the unit. Outside that, it sticks to the HUD column.
 * @param {Float32Array | number[]} wm
 * @param {{ x: number, y?: number, z: number }} point
 */
export function speechInFront(wm, point) {
  const view = speakerViewTangent(wm, point);
  if (!(view.ahead > 0.25)) return false;
  return Math.abs(view.hTan) <= XR_SPEECH_UNIT_TAN_H && Math.abs(view.vTan) <= XR_SPEECH_UNIT_TAN_V;
}

/**
 * Upright plaque just off the speaker, toward the eye. Size tracks distance
 * so it stays readable, and stops growing past a short range.
 * @param {Float32Array | number[]} wm
 * @param {{ x: number, y?: number, z: number }} point
 */
export function speechUnitPose(wm, point) {
  const ex = wm?.[12] || 0;
  const ey = wm?.[13] || 0;
  const ez = wm?.[14] || 0;
  const px = point?.x || 0;
  const py = Number.isFinite(point?.y) ? point.y : ey;
  const pz = point?.z || 0;
  let dx = ex - px;
  let dy = ey - py;
  let dz = ez - pz;
  const dist = Math.hypot(dx, dy, dz) || 1;
  dx /= dist;
  dy /= dist;
  dz /= dist;
  const pull = Math.min(0.45, dist * 0.05);
  const x = px + dx * pull;
  const y = py + 0.25;
  const z = pz + dz * pull;
  const face = worldUprightFaceEye(ex, ey, ez, x, y, z);
  const sized = Math.min(Math.max(dist, 2), 16);
  return {
    x,
    y,
    z,
    width: XR_SPEECH_TAN_W * sized * 0.7,
    height: XR_SPEECH_TAN_H * sized * 0.7,
    yAxis: face.yAxis,
    zAxis: face.zAxis,
  };
}

/** Y-up billboard facing the live eye; does not roll with head tilt. */
export function worldUprightFaceEye(ex, ey, ez, px, py, pz) {
  let zx = ex - px;
  let zy = ey - py;
  let zz = ez - pz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-5) {
    xx = 1;
    xy = 0;
    xz = 0;
    xl = 1;
  } else {
    xx /= xl;
    xz /= xl;
  }
  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  const yl = Math.hypot(yx, yy, yz) || 1;
  return {
    yAxis: [yx / yl, yy / yl, yz / yl],
    zAxis: [zx, zy, zz],
  };
}
