// Rows for the match-over score table. Same columns in every mode.

const EMPTY = Object.freeze({
  kills: 0,
  losses: 0,
  trained: 0,
  razes: 0,
  buildingsLost: 0,
  gathered: 0,
  spent: 0,
});

function activeStat(row) {
  if (!row) return false;
  return (row.kills | 0) > 0
    || (row.losses | 0) > 0
    || (row.trained | 0) > 0
    || (row.razes | 0) > 0
    || (row.buildingsLost | 0) > 0
    || (row.gathered | 0) > 0
    || (row.spent | 0) > 0;
}

/**
 * @param {Array<{ kills?: number, losses?: number, trained?: number, razes?: number, buildingsLost?: number, gathered?: number, spent?: number, gatheredBy?: object, spentBy?: object }> | null | undefined} stats
 * @param {number[] | null | undefined} owners seat ids. Empty falls back to anyone with a tally.
 */
export function matchStatRows(stats, owners) {
  const rows = [];
  const seen = new Set();
  const list = [];
  if (owners?.length) {
    for (let i = 0; i < owners.length; i++) list.push(owners[i] | 0);
  } else if (stats) {
    for (let i = 0; i < stats.length; i++) {
      if (activeStat(stats[i])) list.push(i);
    }
  }
  for (let i = 0; i < list.length; i++) {
    const owner = list[i] | 0;
    if (owner < 0 || seen.has(owner)) continue;
    seen.add(owner);
    const src = stats?.[owner];
    rows.push({
      owner,
      kills: src?.kills | 0,
      losses: src?.losses | 0,
      trained: src?.trained | 0,
      razes: src?.razes | 0,
      buildingsLost: src?.buildingsLost | 0,
      gathered: src?.gathered | 0,
      spent: src?.spent | 0,
      gatheredBy: src?.gatheredBy ?? null,
      spentBy: src?.spentBy ?? null,
    });
  }
  return rows;
}

export function matchStatOwners(session) {
  const ids = [];
  const add = (id) => {
    const n = id | 0;
    if (!Number.isInteger(id) && typeof id !== 'number') return;
    if (n < 0 || ids.includes(n)) return;
    ids.push(n);
  };
  for (const id of session?.humanPlayers ?? []) add(id);
  for (const ai of session?.aiPlayers ?? []) add(typeof ai === 'number' ? ai : ai?.owner);
  for (const id of session?.activeSlots ?? []) add(id);
  const active = session?.koth?.active;
  if (active) {
    for (let i = 0; i < active.length; i++) if (active[i]) add(i);
  }
  return ids.length ? ids : null;
}

export { EMPTY as EMPTY_MATCH_STAT };
