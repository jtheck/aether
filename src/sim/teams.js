// Team hostility - owner → team map (null = FFA: each owner is its own team).
// Same pattern as setActiveMapSize: set once at world init in the sim worker.
// Optional neutral pairs: different teams that do not fight (they still fight
// everyone else). Cleared whenever assignments change.

/** @type {Uint8Array | null} */
let _teamOf = null;
/** Packed (minTeam<<8)|maxTeam keys that are non-hostile. */
let _neutral = null;

/** Owners that can appear in a saved alliance table. Matches the resource banks. */
export const TEAM_TABLE_OWNERS = 16;

/**
 * Owner → team id, length TEAM_TABLE_OWNERS. Missing entries stay their own team.
 * Null when the garden did not author a table.
 * @param {unknown} raw
 * @param {number} [count]
 */
export function normalizeTeamByOwner(raw, count = TEAM_TABLE_OWNERS) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const n = count | 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = Number(raw[i]);
    out.push(Number.isInteger(v) && v >= 0 && v <= 255 ? v : i);
  }
  return out;
}

/**
 * Adventure with no saved table. Hero seats 0–3 share a side.
 * Every later color fights everyone, including the other later colors.
 */
export function adventureTeamByOwner() {
  const out = [];
  for (let i = 0; i < TEAM_TABLE_OWNERS; i++) out.push(i < 4 ? 0 : i);
  return out;
}

/**
 * Owner→team table for a raw or decoded garden.
 * An authored `tm` wins. Adventure with none uses the hero-seat table.
 * @param {object | null | undefined} garden
 */
export function teamsFromGarden(garden) {
  if (!garden || typeof garden !== 'object') return null;
  const authored = normalizeTeamByOwner(garden.tm ?? garden.teamByOwner);
  if (authored) return authored;
  const mt = garden.mt ?? garden.mapType;
  if (mt === 'adventure') return adventureTeamByOwner();
  return null;
}

export function normalizeNeutralTeams(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const a = row[0] | 0;
    const b = row[1] | 0;
    if (a === b) continue;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = (lo << 8) | hi;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([lo, hi]);
  }
  return out.length ? out : null;
}

function packPair(a, b) {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return (lo << 8) | hi;
}

/**
 * Assign team ids indexed by owner. Pass null to restore FFA (owner === team).
 * Always clears neutral pairs; call setTeamNeutralPairs after if needed.
 * @param {ArrayLike<number> | null | undefined} teamByOwner
 */
export function setTeamAssignments(teamByOwner) {
  _neutral = null;
  if (teamByOwner == null) {
    _teamOf = null;
    return;
  }
  const n = teamByOwner.length;
  const next = new Uint8Array(n);
  for (let i = 0; i < n; i++) next[i] = teamByOwner[i] & 0xff;
  _teamOf = next;
}

/** Copy of the current owner→team table, or null for FFA. */
export function getTeamAssignments() {
  return _teamOf ? new Uint8Array(_teamOf) : null;
}

/** Team pairs that are neither allied nor hostile. */
export function getTeamNeutralPairs() {
  if (!_neutral?.size) return null;
  return [..._neutral].map((key) => [key >> 8, key & 0xff]);
}

export function setTeamNeutralPairs(pairs) {
  const norm = normalizeNeutralTeams(pairs);
  if (!norm) {
    _neutral = null;
    return;
  }
  _neutral = new Set(norm.map(([a, b]) => packPair(a, b)));
}

/** Team id for an owner (identity when no assignment table is set). */
export function teamOf(owner) {
  if (!_teamOf || owner < 0 || owner >= _teamOf.length) return owner & 0xff;
  return _teamOf[owner];
}

function isNeutralTeamPair(teamA, teamB) {
  return !!_neutral?.has(packPair(teamA, teamB));
}

/** Same team, or the same owner. Neutral pairs are not allies. */
export function isAlly(ownerA, ownerB) {
  return teamOf(ownerA) === teamOf(ownerB);
}

/** Different team, and not on a neutral pair. */
export function isHostile(ownerA, ownerB) {
  if (ownerA === ownerB) return false;
  const ta = teamOf(ownerA);
  const tb = teamOf(ownerB);
  if (ta === tb) return false;
  if (isNeutralTeamPair(ta, tb)) return false;
  return true;
}
