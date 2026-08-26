// Army TeamColor. Other slots use a lifted palette so they stay readable on
// the board. The local player uses their profile swatch (`playerColor`).

export const OWNER_TINTS = [
  [0.38, 0.64, 1.0],
  [1.0, 0.4, 0.3],
  [0.62, 1.0, 0.34],
  [1.0, 0.9, 0.34],
  [0.88, 0.52, 1.0],
];

let localOwnerId = 0;
let localTint = OWNER_TINTS[0];

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

/**
 * Bind the local slot to a profile hex. `ownerId < 0` (spectator) uses only
 * the slot palette.
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
  const n = OWNER_TINTS.length;
  return OWNER_TINTS[((id % n) + n) % n];
}
