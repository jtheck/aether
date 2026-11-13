// Local graffiti catalog. Packaged builds cannot glob the folders, so ids stay
// listed here. Add a PNG by dropping the file and a row.

export const DECAL_NONE = '';
export const DECAL_LONG_EDGE = 14;
export const LOGO_DEFAULT_ID = 'graffiti';
export const TRIBE_DEFAULT_ID = DECAL_NONE;

/** @typedef {{ id: string, url: string, pw: number, ph: number, label: string }} DecalEntry */

/** @type {readonly DecalEntry[]} */
export const LOGO_DECALS = Object.freeze([
  { id: 'graffiti', url: '/assets/images/decals/logo/graffiti.png', pw: 600, ph: 442, label: 'Graffiti' },
  { id: 'garden', url: '/assets/images/decals/logo/garden.png', pw: 1100, ph: 619, label: 'Garden' },
  { id: 'splash', url: '/assets/images/decals/logo/splash.png', pw: 555, ph: 555, label: 'Splash' },
  { id: 'skinnyheader', url: '/assets/images/decals/logo/skinnyheader.png', pw: 506, ph: 56, label: 'Banner' },
]);

/** @type {readonly DecalEntry[]} */
export const TRIBE_DECALS = Object.freeze([
  { id: 'earth', url: '/assets/images/decals/tribe/earth.png', pw: 256, ph: 256, label: 'Earth' },
  { id: 'fire', url: '/assets/images/decals/tribe/fire.png', pw: 256, ph: 256, label: 'Fire' },
  { id: 'spirit', url: '/assets/images/decals/tribe/spirit.png', pw: 256, ph: 256, label: 'Spirit' },
  // { id: 'stone', url: '/assets/images/decals/tribe/stone.png', pw: 256, ph: 256, label: 'Stone' },
  { id: 'water', url: '/assets/images/decals/tribe/water.png', pw: 256, ph: 256, label: 'Water' },
  { id: 'wind', url: '/assets/images/decals/tribe/wind.png', pw: 256, ph: 256, label: 'Wind' },
]);

export function decalWorldSize(entry) {
  const pw = Math.max(1, entry?.pw | 0);
  const ph = Math.max(1, entry?.ph | 0);
  const long = Math.max(pw, ph);
  return {
    width: DECAL_LONG_EDGE * (pw / long),
    height: DECAL_LONG_EDGE * (ph / long),
  };
}

export function findLogoDecal(id) {
  return LOGO_DECALS.find((d) => d.id === id) ?? null;
}

export function findTribeDecal(id) {
  return TRIBE_DECALS.find((d) => d.id === id) ?? null;
}

export function hasDecalDlc(ownedPacks) {
  return (ownedPacks ?? []).length > 0;
}

/** Logo pick: no DLC always graffiti. DLC may choose any logo id or none. */
export function resolveLogoDecalId(saved, ownedPacks) {
  if (!hasDecalDlc(ownedPacks)) return LOGO_DEFAULT_ID;
  if (saved === DECAL_NONE) return DECAL_NONE;
  if (findLogoDecal(saved)) return saved;
  return LOGO_DEFAULT_ID;
}

export function resolveTribeDecalId(saved) {
  if (saved === DECAL_NONE || saved == null) return DECAL_NONE;
  if (findTribeDecal(saved)) return saved;
  return TRIBE_DEFAULT_ID;
}

function hashUnit(n) {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Auto seats: one of the tribe marks, or none. Same seed+owner → same pick. */
export function aiTribeDecalId(seed, owner) {
  const ids = [DECAL_NONE, ...TRIBE_DECALS.map((d) => d.id)];
  const u = hashUnit(((seed >>> 0) ^ Math.imul((owner | 0) + 1, 0x9e3779b1)) >>> 0);
  return ids[(u * ids.length) | 0] ?? DECAL_NONE;
}

export function sanitizeDecalPicks(raw, ownedPacks) {
  return {
    logo: resolveLogoDecalId(raw?.logo, ownedPacks),
    tribe: resolveTribeDecalId(raw?.tribe),
  };
}

function ownerKey(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function aiOwnerId(entry) {
  if (typeof entry === 'number') return entry | 0;
  if (entry && typeof entry === 'object') return entry.owner | 0;
  return 0;
}

/** Human seats keep their picks (logo gated by that seat's DLC). Auto rolls a tribe. */
export function ownerDecalsFromSeats(seats, seed = 0) {
  /** @type {Record<number, { logo: string, tribe: string }>} */
  const out = {};
  for (const s of seats ?? []) {
    const owner = s.index | 0;
    if (s.kind === 'human') out[owner] = sanitizeDecalPicks({ logo: s.logo, tribe: s.tribe }, s.dlc);
    else if (s.kind === 'ai') {
      out[owner] = { logo: LOGO_DEFAULT_ID, tribe: aiTribeDecalId(seed, owner) };
    }
  }
  return out;
}

/**
 * Merge a live-config map, fill missing Auto owners from the match seed,
 * and only overlay the local player when that seat is still empty.
 */
export function fillOwnerDecals(cfg = {}, localPicks = null) {
  const seed = (cfg.seed ?? 0) >>> 0;
  /** @type {Record<number, { logo: string, tribe: string }>} */
  const out = {};
  const src = cfg.ownerDecals;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [key, value] of Object.entries(src)) {
      const owner = ownerKey(key);
      if (owner == null) continue;
      const logo = value?.logo;
      out[owner] = {
        logo: logo === DECAL_NONE || findLogoDecal(logo) ? (logo ?? DECAL_NONE) : LOGO_DEFAULT_ID,
        tribe: resolveTribeDecalId(value?.tribe),
      };
    }
  }
  for (const entry of cfg.aiPlayers ?? []) {
    const owner = aiOwnerId(entry);
    if (out[owner] == null) {
      out[owner] = { logo: LOGO_DEFAULT_ID, tribe: aiTribeDecalId(seed, owner) };
    }
  }
  const localId = cfg.localPlayerId;
  if (localPicks && localId >= 0 && out[localId] == null) {
    const logo = localPicks.logo;
    out[localId] = {
      logo: logo === DECAL_NONE || findLogoDecal(logo)
        ? (logo ?? DECAL_NONE)
        : resolveLogoDecalId(logo, localPicks.ownedPacks),
      tribe: resolveTribeDecalId(localPicks.tribe),
    };
  }
  return out;
}

export function stampHashUnit(n) {
  return hashUnit(n);
}

/**
 * @param {{ userId?: string | null, state?: string, playerId?: number }[]} roster
 * @param {Map<string, { logo: string, tribe: string }> | Record<string, { logo: string, tribe: string }>} userDecals
 */
export function ownerDecalsFromRoster(roster, userDecals) {
  /** @type {Record<number, { logo: string, tribe: string }>} */
  const out = {};
  const lookup = userDecals instanceof Map
    ? (id) => userDecals.get(id)
    : (id) => userDecals?.[id];
  for (const s of roster ?? []) {
    if (s?.state !== 'active' || !s.userId) continue;
    const picks = lookup(s.userId);
    if (!picks) continue;
    const logo = picks.logo;
    out[s.playerId | 0] = {
      logo: logo === DECAL_NONE || findLogoDecal(logo) ? (logo ?? DECAL_NONE) : LOGO_DEFAULT_ID,
      tribe: resolveTribeDecalId(picks.tribe),
    };
  }
  return out;
}
