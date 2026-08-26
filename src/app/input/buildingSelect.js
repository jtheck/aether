/** @param {{ kind: string, index: number }} s */
export function buildingSelKey(s) {
  return `${s.kind}:${s.index}`;
}

/**
 * Shift-add buildings without duplicates, preserving current order.
 * @param {{ kind: string, index: number }[]} current
 * @param {{ kind: string, index: number }[]} extra
 */
export function mergeBuildingSels(current, extra) {
  const seen = new Set(current.map(buildingSelKey));
  const merged = current.slice();
  for (let i = 0; i < extra.length; i++) {
    const s = extra[i];
    const k = buildingSelKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(s);
  }
  return merged;
}

/** Canvas-local point inside an axis-aligned drag box. */
export function screenPosInRect(p, minX, maxX, minY, maxY) {
  return !!p && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

/** Units win a mixed drag box so boxing an army does not also grab an agora. */
export function boxSelectWinner(unitHits, buildingHits) {
  if (unitHits > 0) return 'units';
  if (buildingHits > 0) return 'buildings';
  return 'none';
}

/**
 * Radial option miss: the hub frames the selected building (world click);
 * ring / pad chrome keeps the menu. Hub wins over chrome because hitAtRay
 * includes the hole so box-select does not start there.
 * @param {{ picked?: boolean, onHub?: boolean, onChrome?: boolean }} h
 * @returns {'pick' | 'hub' | 'chrome' | 'world'}
 */
export function radialClickKind(h) {
  if (h.picked) return 'pick';
  if (h.onHub) return 'hub';
  if (h.onChrome) return 'chrome';
  return 'world';
}
