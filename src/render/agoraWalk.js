// Walk Y for the agora plaza — same heightfield idea as terrain, one deck offset.

/** Inner plaza floor from agora.glb (part 2), mesh-local. */
export const AGORA_DECK_Y = 0.781;
export const AGORA_DECK_MIN_X = -7.605;
export const AGORA_DECK_MAX_X = 7.658;
export const AGORA_DECK_MIN_Z = -7.512;
export const AGORA_DECK_MAX_Z = 7.626;
/** Corner of the local AABB, plus slack so the cheap reject never clips the pad. */
const AGORA_DECK_R2 = 11.2 * 11.2;

/** Same yaw as agora thin-instances: face map center when unset. */
export function agoraWalkYaw(x, z, yaw) {
  return yaw != null ? yaw : Math.atan2(-x, -z);
}

/**
 * @param {{ x: number, z: number, yaw?: number }[]} list
 * @param {(x: number, z: number) => number} [baseYAt]
 */
export function agoraWalkPadsFromList(list, baseYAt) {
  if (!list?.length) return [];
  const pads = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const x = a.x;
    const z = a.z;
    pads.push({
      x,
      z,
      yaw: agoraWalkYaw(x, z, a.yaw),
      baseY: baseYAt ? baseYAt(x, z) : (a.baseY ?? 0),
    });
  }
  return pads;
}

/** World XZ → agora-local XZ (matches writeMatrix yaw in agoras.js). */
export function agoraLocalXZ(dx, dz, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function pointOnAgoraDeck(pad, x, z) {
  const dx = x - pad.x;
  const dz = z - pad.z;
  if (dx * dx + dz * dz > AGORA_DECK_R2) return false;
  const local = agoraLocalXZ(dx, dz, pad.yaw);
  return local.x >= AGORA_DECK_MIN_X && local.x <= AGORA_DECK_MAX_X
    && local.z >= AGORA_DECK_MIN_Z && local.z <= AGORA_DECK_MAX_Z;
}

/**
 * Heightfield sample: terrain unless the agora plaza is higher.
 * @param {{ x: number, z: number, yaw: number, baseY: number }[]} pads
 */
export function agoraWalkYAt(pads, x, z, fallback = 0) {
  let y = fallback;
  if (!pads?.length) return y;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (!pointOnAgoraDeck(pad, x, z)) continue;
    const deck = (pad.baseY || 0) + AGORA_DECK_Y;
    if (deck > y) y = deck;
  }
  return y;
}
