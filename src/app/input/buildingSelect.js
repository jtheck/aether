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

/**
 * Empty hub around a framed building still counts as that building when the
 * footprint pick misses (yard inside a village ring, etc.).
 * @param {{ picked?: boolean, onHub?: boolean }} h
 * @param {{ kind: string, index: number } | null | undefined} framed
 */
export function radialHubFramedBuilding(h, framed) {
  if (h.picked || !h.onHub) return null;
  return framed ?? null;
}

/**
 * LMB on a foreign unit/building: inspect (collar + HP) when idle;
 * keep attack / a-move when the player already has orderable troops.
 * @param {boolean} hasOwnOrderableSelection
 */
export function inspectForeignOnClick(hasOwnOrderableSelection) {
  return !hasOwnOrderableSelection;
}

/**
 * Mobile 2-finger tap leaves build UI instead of force-moving.
 * Rally selections are included — RMB dismissMenus leaves those for force-move.
 * @param {boolean} placing
 * @param {boolean} hasBuildingSelection
 * @param {boolean} radialOpen
 */
export function twoFingerConsumesBuildUi(placing, hasBuildingSelection, radialOpen) {
  return Boolean(placing || hasBuildingSelection || radialOpen);
}
