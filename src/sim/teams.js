// Team hostility — owner → team map (null = FFA: each owner is its own team).
// Same pattern as setActiveMapSize: set once at world init in the sim worker.

/** @type {Uint8Array | null} */
let _teamOf = null;

/**
 * Assign team ids indexed by owner. Pass null to restore FFA (owner === team).
 * @param {ArrayLike<number> | null | undefined} teamByOwner
 */
export function setTeamAssignments(teamByOwner) {
  if (teamByOwner == null) {
    _teamOf = null;
    return;
  }
  const n = teamByOwner.length;
  const next = new Uint8Array(n);
  for (let i = 0; i < n; i++) next[i] = teamByOwner[i] & 0xff;
  _teamOf = next;
}

/** Team id for an owner (identity when no assignment table is set). */
export function teamOf(owner) {
  if (!_teamOf || owner < 0 || owner >= _teamOf.length) return owner & 0xff;
  return _teamOf[owner];
}

/** Different owner on a different team → hostile. */
export function isHostile(ownerA, ownerB) {
  if (ownerA === ownerB) return false;
  return teamOf(ownerA) !== teamOf(ownerB);
}

export function isAlly(ownerA, ownerB) {
  return !isHostile(ownerA, ownerB);
}
