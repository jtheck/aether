// Owner-wide researched tech bits (minimal — no cost / research time yet).

/** Cap owners that can hold tech masks (staging + koth headroom). */
export const MAX_TECH_OWNERS = 16;

/**
 * Bit flags per upgrade id (matches UPGRADE_DEFS / radial pads).
 * @type {Readonly<Record<string, number>>}
 */
export const TECH_BY_ID = Object.freeze({
  patronage: 1 << 0,
  armor: 1 << 1,
  artillery: 1 << 2,
  drayage: 1 << 3,
  prospecting: 1 << 4,
  scribes: 1 << 5,
  stewardship: 1 << 6,
});

/** Convenience aliases for call sites. */
export const TECH = Object.freeze({
  PATRONAGE: TECH_BY_ID.patronage,
  ARMOR: TECH_BY_ID.armor,
  ARTILLERY: TECH_BY_ID.artillery,
  DRAYAGE: TECH_BY_ID.drayage,
  PROSPECTING: TECH_BY_ID.prospecting,
  SCRIBES: TECH_BY_ID.scribes,
  STEWARDSHIP: TECH_BY_ID.stewardship,
});

/**
 * @param {object} w
 */
export function ensureTech(w) {
  if (!w.tech || w.tech.length < MAX_TECH_OWNERS) {
    const next = new Uint32Array(MAX_TECH_OWNERS);
    if (w.tech) next.set(w.tech.subarray(0, Math.min(w.tech.length, MAX_TECH_OWNERS)));
    w.tech = next;
  }
  return w.tech;
}

/**
 * @param {object} w
 * @param {number} owner
 * @param {number} bit
 */
export function ownerHasTech(w, owner, bit) {
  const o = owner | 0;
  if (o < 0 || o >= MAX_TECH_OWNERS) return false;
  ensureTech(w);
  return (w.tech[o] & (bit | 0)) !== 0;
}

/**
 * @param {number[] | Uint32Array | null | undefined} tech
 * @param {number} owner
 * @param {number} bit
 */
export function techBitsHas(tech, owner, bit) {
  const o = owner | 0;
  if (!tech || o < 0 || o >= tech.length) return false;
  return (tech[o] & (bit | 0)) !== 0;
}

/**
 * Grant an owner tech bit (idempotent). Used when a research track completes.
 * @param {object} w
 * @param {number} owner
 * @param {string | number} techIdOrBit
 */
export function grantTech(w, owner, techIdOrBit) {
  const playerId = owner | 0;
  if (playerId < 0 || playerId >= MAX_TECH_OWNERS) return false;
  let bit = 0;
  if (typeof techIdOrBit === 'string') {
    bit = TECH_BY_ID[techIdOrBit] | 0;
  } else {
    bit = techIdOrBit | 0;
  }
  if (!bit) return false;
  ensureTech(w);
  if ((w.tech[playerId] & bit) !== 0) return false;
  w.tech[playerId] |= bit;
  w.techDirty = 1;
  return true;
}

/**
 * @param {object | null | undefined} w
 * @returns {number[]}
 */
export function serializeTech(w) {
  if (!w?.tech) return [];
  const out = [];
  for (let i = 0; i < w.tech.length; i++) out.push(w.tech[i] | 0);
  return out;
}

/**
 * @param {object} w
 * @param {number[] | Uint32Array | null | undefined} data
 */
export function applySerializedTech(w, data) {
  ensureTech(w);
  w.tech.fill(0);
  if (!data?.length) return;
  const n = Math.min(MAX_TECH_OWNERS, data.length);
  for (let i = 0; i < n; i++) w.tech[i] = data[i] | 0;
}

/**
 * @param {number} h
 * @param {(v: number) => void} mix
 * @param {object | null | undefined} w
 */
export function mixTechChecksum(h, mix, w) {
  if (!w?.tech) {
    mix(0);
    return h;
  }
  mix(w.tech.length);
  for (let i = 0; i < w.tech.length; i++) mix(w.tech[i] | 0);
  return h;
}
