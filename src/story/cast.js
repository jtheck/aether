// Named story units — speaker strings match garden unit names.

import { UNIT } from '../sim/unitTypes.js';

/** The four heroes, in a small diamond around an anchor tile. */
export const STORY_PARTY = Object.freeze([
  { name: 'Stumpey', type: UNIT.MYCO, dx: 0, dz: 1 },
  { name: 'Goblin', type: UNIT.WARLOCK, dx: -3, dz: 1 },
  { name: 'Idra', type: UNIT.PRIEST, dx: 0, dz: -1 },
  { name: 'Doc', type: UNIT.SHAMAN, dx: 3, dz: -1 },
]);

function clampTile(v, n) {
  return Math.max(0, Math.min(n - 1, v | 0));
}

/**
 * Tile placements for the four heroes.
 * Default is the campaign diamond. `row` stands them shoulder to shoulder
 * on the anchor tile.
 */
export function storyPartyPlacements(anchorTx, anchorTz, width, height, owner = 0, layout = 'diamond') {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  if (layout === 'row') {
    const gap = 4;
    const n = STORY_PARTY.length;
    const tz = clampTile(anchorTz, h);
    return STORY_PARTY.map((hero, i) => ({
      owner: owner | 0,
      type: hero.type,
      name: hero.name,
      tx: clampTile(anchorTx + Math.round((i - (n - 1) / 2) * gap), w),
      tz,
    }));
  }
  return STORY_PARTY.map((hero) => ({
    owner: owner | 0,
    type: hero.type,
    name: hero.name,
    tx: clampTile(anchorTx + hero.dx, w),
    tz: clampTile(anchorTz + hero.dz, h),
  }));
}

/** Drop the party in. A hero already on the map moves to the diamond instead of duplicating. */
export function mergeStoryParty(units, placements) {
  const next = (units || []).map((u) => ({ ...u }));
  for (const p of placements || []) {
    const key = normalizeSpeaker(p.name);
    const existing = next.find((u) => normalizeSpeaker(u.name) === key);
    if (existing) {
      existing.owner = p.owner | 0;
      existing.type = p.type | 0;
      existing.tx = p.tx | 0;
      existing.tz = p.tz | 0;
      delete existing.x;
      delete existing.z;
    } else {
      next.push({
        owner: p.owner | 0,
        type: p.type | 0,
        name: p.name,
        tx: p.tx | 0,
        tz: p.tz | 0,
      });
    }
  }
  return next;
}

export function normalizeSpeaker(name) {
  return String(name || '').trim().toLowerCase();
}

export function findNamedUnit(units, name) {
  const key = normalizeSpeaker(name);
  if (!key) return null;
  return (units || []).find((u) => normalizeSpeaker(u.name) === key) || null;
}

/** Spawn-order index for each named garden unit (first N garden units when default spawns are skipped). */
export function castIndexFromUnits(units) {
  const out = [];
  const list = units || [];
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u?.name) continue;
    out.push({
      name: String(u.name),
      index: i,
      type: u.type | 0,
      tx: u.tx | 0,
      tz: u.tz | 0,
    });
  }
  return out;
}

export function unitsFromCast(cast, owner = 0) {
  return (cast || []).map((c) => ({
    owner: c.owner | 0 || owner,
    type: c.type | 0,
    tx: c.tx | 0,
    tz: c.tz | 0,
    name: String(c.name || ''),
  }));
}

export function namedUnits(units) {
  return (units || []).filter((u) => String(u.name || '').trim());
}
