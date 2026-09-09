// Army TeamColor. Other slots use a lifted palette so they stay readable on
// the board. Seat / roster hexes (and the local profile swatch) override that
// so every client paints the same army the same color.

export const OWNER_TINTS = [
  [0.38, 0.64, 1.0],
  [1.0, 0.4, 0.3],
  [0.62, 1.0, 0.34],
  [1.0, 0.9, 0.34],
  [0.88, 0.52, 1.0],
];

let localOwnerId = 0;
let localTint = OWNER_TINTS[0];
/** @type {Map<number, [number, number, number]>} */
const slotTints = new Map();

/** @param {string | null | undefined} hex `#RRGGBB` or `RRGGBB` */
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  ];
}

/** Canonical `#RRGGBB`, or empty if the value is not a hex swatch. */
export function sanitizeOwnerColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  return m ? `#${m[1].toUpperCase()}` : '';
}

/**
 * Seat index → profile hex for every human in a lobby snapshot.
 * @param {{ kind?: string, index?: number, color?: string }[]} [seats]
 * @returns {Record<number, string>}
 */
export function ownerColorsFromSeats(seats) {
  /** @type {Record<number, string>} */
  const out = {};
  for (const s of seats ?? []) {
    if (s?.kind !== 'human') continue;
    const hex = sanitizeOwnerColor(s.color);
    if (hex) out[s.index | 0] = hex;
  }
  return out;
}

/**
 * Player id → profile hex from a KOTH roster + userId color map.
 * @param {{ userId?: string | null, state?: string, playerId?: number }[]} roster
 * @param {Map<string, string> | Record<string, string>} userColors
 * @returns {Record<number, string>}
 */
export function ownerColorsFromRoster(roster, userColors) {
  /** @type {Record<number, string>} */
  const out = {};
  const lookup = userColors instanceof Map
    ? (id) => userColors.get(id)
    : (id) => userColors?.[id];
  for (const s of roster ?? []) {
    if (s?.state !== 'active' || !s.userId) continue;
    const hex = sanitizeOwnerColor(lookup(s.userId));
    if (hex) out[s.playerId | 0] = hex;
  }
  return out;
}

/**
 * Replace the shared slot map. Missing / invalid hexes fall back to the palette.
 * @param {Record<number | string, string> | null | undefined} colorsByOwner
 */
export function setOwnerTints(colorsByOwner) {
  slotTints.clear();
  if (!colorsByOwner || typeof colorsByOwner !== 'object') return;
  for (const [key, hex] of Object.entries(colorsByOwner)) {
    const rgb = hexToRgb01(hex);
    if (!rgb) continue;
    slotTints.set(key | 0, rgb);
  }
}

/**
 * Bind the local slot to a profile hex. `ownerId < 0` (spectator) uses only
 * the slot palette / shared map.
 * @param {number} ownerId
 * @param {string} hex
 */
export function setLocalOwnerTint(ownerId, hex) {
  localOwnerId = Number.isFinite(+ownerId) ? (+ownerId | 0) : -1;
  localTint = hexToRgb01(hex) ?? OWNER_TINTS[0];
}

/** TeamColor RGB for an army slot. */
export function ownerTint(owner) {
  const id = owner | 0;
  if (localOwnerId >= 0 && id === localOwnerId) return localTint;
  const slotted = slotTints.get(id);
  if (slotted) return slotted;
  const n = OWNER_TINTS.length;
  return OWNER_TINTS[((id % n) + n) % n];
}
