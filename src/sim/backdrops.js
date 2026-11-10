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
    // Baked xz reach. The wide rim is ~2.9, not the keep's half-unit.
    radius: 2.92,
    y0: -0.586,
    y1: 3.107,
  },
  [BACKDROP.CASTLE]: {
    url: '/assets/models/props/castle.glb',
    label: 'Castle',
    // Native keep is about half a unit wide and already sits on y=0.
    // 64 makes a keep roughly thirty tiles across, for a hole or a rim.
    defaultScale: 64,
    originY: 0,
    radius: 0.65,
    y0: -0.297,
    y1: 0.795,
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

/** Model-space xz reach for a prop, scaled into world units. */
export function backdropReach(pose) {
  const radius = BACKDROP_DEFS[pose?.type]?.radius || 0.45;
  const scale = Number(pose?.scale) > 0 ? Number(pose.scale) : 1;
  return Math.max(6, scale * radius);
}

/**
 * Index of the prop under a ground point, or -1.
 * Reach follows each mesh's footprint, so a disc is grabbable out at its rim.
 */
export function nearestBackdrop(list, x, z) {
  const poses = normalizeBackdrops(list);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const reach = backdropReach(pose);
    const d = Math.hypot(pose.x - x, pose.z - z);
    if (d <= reach && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

/**
 * Index of the prop a view ray hits before the ground, or -1.
 * `ray` is `{ x, y, z, dx, dy, dz }` with t in world units of that direction.
 * `groundT` is the ray parameter of the ground hit (clicks past it fall through).
 */
export function backdropAlongRay(list, ray, groundT) {
  if (!ray) return -1;
  const poses = normalizeBackdrops(list);
  const limit = Number.isFinite(groundT) ? groundT + 1e-3 : Infinity;
  let best = -1;
  let bestT = limit;
  for (let i = 0; i < poses.length; i++) {
    const t = backdropRayT(poses[i], ray);
    if (t == null || t < 0 || t > bestT) continue;
    best = i;
    bestT = t;
  }
  return best;
}

function backdropRayT(pose, ray) {
  const def = BACKDROP_DEFS[pose.type];
  if (!def) return null;
  const scale = pose.scale;
  const r = scale * (def.radius || 0.45);
  const y0 = pose.y + scale * (def.y0 || 0);
  const y1 = pose.y + scale * (def.y1 || 0);
  const ox = ray.x - pose.x;
  const oz = ray.z - pose.z;
  const dx = ray.dx;
  const dz = ray.dz;
  const dy = ray.dy;
  /** @type {number[]} */
  const ts = [];
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - r * r;
  if (a < 1e-12) {
    if (c <= 0) ts.push(0);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      ts.push((-b - s) / (2 * a), (-b + s) / (2 * a));
    }
  }
  if (Math.abs(dy) > 1e-8) {
    for (const y of [y0, y1]) {
      const t = (y - ray.y) / dy;
      const x = ox + dx * t;
      const z = oz + dz * t;
      if (x * x + z * z <= r * r + 1e-4) ts.push(t);
    }
  }
  let best = null;
  for (const t of ts) {
    if (t < -1e-4) continue;
    const y = ray.y + dy * t;
    if (y < y0 - 1e-2 || y > y1 + 1e-2) continue;
    if (best == null || t < best) best = t;
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
