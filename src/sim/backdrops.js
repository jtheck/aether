// Visual-only off-board / surround props. No pass, stock, or entities.
// Poses persist on field.backdrops and round-trip in .garden (`bd`).

export const BACKDROP = {
  DISC: 'disc',
};

/** Icosphere in disc.glb sits ~3 units above authored origin. */
const DISC_ORIGIN_Y = 3.037;

export const BACKDROP_DEFS = {
  [BACKDROP.DISC]: {
    url: '/assets/models/props/disc.glb',
    defaultScale: 80,
    originY: DISC_ORIGIN_Y,
  },
};

export function backdropModelUrls() {
  return Object.values(BACKDROP_DEFS).map((d) => d.url);
}

export function isBackdropType(type) {
  return Object.prototype.hasOwnProperty.call(BACKDROP_DEFS, String(type || ''));
}

function q(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

/**
 * @param {string} type
 * @param {number} scale
 */
export function defaultBackdropY(type, scale) {
  const originY = BACKDROP_DEFS[type]?.originY || 0;
  return q(-(originY * scale));
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
