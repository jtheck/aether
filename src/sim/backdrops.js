// Visual-only off-board / surround props. No pass, stock, or entities.
// Poses persist on field.backdrops and round-trip in .garden (`bd`).

export const BACKDROP = {
  DISC: 'disc',
  CASTLE: 'castle',
};

/** Icosphere in disc.glb sits ~3 units above authored origin. */
const DISC_ORIGIN_Y = 3.037;

export const BACKDROP_DEFS = {
  [BACKDROP.DISC]: {
    url: '/assets/models/props/disc.glb',
    label: 'Disc',
    // Native mesh is ~9 units across. 80 wraps a small table.
    defaultScale: 80,
    originY: DISC_ORIGIN_Y,
  },
  [BACKDROP.CASTLE]: {
    url: '/assets/models/props/castle.glb',
    label: 'Castle',
    // Native keep is about half a unit wide and already sits on y=0.
    // 64 makes a keep roughly thirty tiles across, for a hole or a rim.
    defaultScale: 64,
    originY: 0,
  },
};

export function backdropModelUrls() {
  return Object.values(BACKDROP_DEFS).map((d) => d.url);
}

export function isBackdropType(type) {
  return Object.prototype.hasOwnProperty.call(BACKDROP_DEFS, String(type || ''));
}

function q(n) {
  const v = Math.round(Number(n) * 1000) / 1000;
  return v === 0 ? 0 : v;
}

/**
 * @param {string} type
 * @param {number} scale
 */
export function defaultBackdropY(type, scale) {
  const originY = BACKDROP_DEFS[type]?.originY || 0;
  return q(-(originY * scale));
}

/** A new pose at a ground point, sunk so the mesh origin sits on y=0. */
export function freshBackdrop(type, x, z) {
  if (!isBackdropType(type)) return null;
  const scale = BACKDROP_DEFS[type].defaultScale;
  return {
    type,
    x: q(x),
    z: q(z),
    y: defaultBackdropY(type, scale),
    yaw: 0,
    scale,
  };
}

/**
 * Index of the prop under a ground point, or -1.
 * Reach grows with scale so a keep is selectable out at its walls.
 */
export function nearestBackdrop(list, x, z) {
  const poses = normalizeBackdrops(list);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const reach = Math.max(6, pose.scale * 0.45);
    const d = Math.hypot(pose.x - x, pose.z - z);
    if (d <= reach && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * @param {unknown} raw
 * @returns {{ type: string, x: number, z: number, y: number, yaw: number, scale: number }[]}
 */
export function normalizeBackdrops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const tuple = Array.isArray(item);
    const type = String(tuple ? item[0] : item?.type || '');
    if (!isBackdropType(type)) continue;
    const def = BACKDROP_DEFS[type];
    const scaleRaw = tuple ? item[5] : item?.scale;
    const scale = Number(scaleRaw) > 0 ? Number(scaleRaw) : def.defaultScale;
    const yRaw = tuple ? item[3] : item?.y;
    const y = yRaw == null || yRaw === ''
      ? defaultBackdropY(type, scale)
      : Number(yRaw) || 0;
    out.push({
      type,
      x: Number(tuple ? item[1] : item?.x) || 0,
      z: Number(tuple ? item[2] : item?.z) || 0,
      y,
      yaw: Number(tuple ? item[4] : item?.yaw) || 0,
      scale,
    });
  }
  return out;
}

/** Compact garden tuples: `[type, x, z, y, yaw, scale]`. */
export function encodeBackdrops(list) {
  return normalizeBackdrops(list).map((b) => [b.type, q(b.x), q(b.z), q(b.y), q(b.yaw), q(b.scale)]);
}

export function cloneBackdrops(list) {
  return normalizeBackdrops(list).map((b) => ({ ...b }));
}

export function hasAuthoredBackdrops(field) {
  return (field?.backdrops?.length | 0) > 0;
}
