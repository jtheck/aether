// Named story units — speaker strings match garden unit names.

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
