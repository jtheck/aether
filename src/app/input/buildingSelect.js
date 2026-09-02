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
 * While ghost-placing, an agora click (hub hole or mesh) exits place mode.
 * Option picks and ring chrome stay as they are; everything else confirms.
 * @param {'pick' | 'hub' | 'chrome' | 'world'} radialKind
 * @param {{ kind?: string } | null | undefined} buildingHit
 * @returns {'pick' | 'chrome' | 'exit' | 'confirm'}
 */
export function placementTapKind(radialKind, buildingHit) {
  if (radialKind === 'pick') return 'pick';
  if (radialKind === 'hub') return 'exit';
  if (radialKind === 'chrome') return 'chrome';
  if (buildingHit?.kind === 'agora') return 'exit';
  return 'confirm';
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

function buildingAlive(b) {
  return !!b && (b.hp == null || (b.hp | 0) > 0);
}

/**
 * Own living placeables of one type. Rally flags are ignored; agora / mixed
 * types / foreign owners return null so the action radial stays closed.
 * @param {{ kind?: string, index?: number }[] | null | undefined} list
 * @param {{ owner?: number, type?: string, hp?: number }[] | null | undefined} buildings
 * @param {number} owner
 * @returns {{ type: string, indices: number[] } | null}
 */
export function sameOwnedBuildingType(list, buildings, owner) {
  /** @type {number[]} */
  const indices = [];
  let type = null;
  for (let i = 0; i < (list?.length ?? 0); i++) {
    const sel = list[i];
    if (sel?.kind === 'rally') continue;
    if (sel?.kind !== 'building') return null;
    const b = buildings?.[sel.index];
    if (!buildingAlive(b) || (b.owner | 0) !== (owner | 0)) return null;
    if (type == null) type = b.type;
    else if (b.type !== type) return null;
    indices.push(sel.index | 0);
  }
  return type != null && indices.length ? { type, indices } : null;
}

export function buildingTrackLoad(b) {
  let n = 0;
  for (const t of b?.tracks ?? []) n += t.count | 0;
  return n;
}

export function buildingHasWork(b) {
  for (const t of b?.tracks ?? []) {
    if ((t.count | 0) > 0 || (Number(t.progress) || 0) > 0) return true;
  }
  return false;
}

/** Units of this type sitting on other selected buildings: `+3`. */
export function extraQueueBadge(extra) {
  const n = extra | 0;
  return n > 0 ? `+${n}` : '';
}

/**
 * Next train click goes on the least-loaded built site (stable index on ties).
 * @param {number[]} indices
 * @param {{ built?: number, hp?: number, tracks?: { count?: number }[] }[] | null | undefined} buildings
 */
export function pickLeastLoadedIndex(indices, buildings) {
  let best = -1;
  let bestLoad = Infinity;
  for (let k = 0; k < (indices?.length ?? 0); k++) {
    const i = indices[k] | 0;
    const b = buildings?.[i];
    if (!buildingAlive(b) || b.built === 0) continue;
    const load = buildingTrackLoad(b);
    if (load < bestLoad) {
      bestLoad = load;
      best = i;
    }
  }
  return best;
}

export function groupHasUpgradeQueued(indices, buildings, techId) {
  const id = String(techId ?? '');
  if (!id) return false;
  for (let k = 0; k < (indices?.length ?? 0); k++) {
    const b = buildings?.[indices[k]];
    for (const t of b?.tracks ?? []) {
      if (t.kind === 'upgrade' && t.id === id && (t.count | 0) > 0) return true;
    }
  }
  return false;
}

export function pickFirstBuiltIndex(indices, buildings) {
  for (let k = 0; k < (indices?.length ?? 0); k++) {
    const i = indices[k] | 0;
    const b = buildings?.[i];
    if (!buildingAlive(b) || b.built === 0) continue;
    return i;
  }
  return -1;
}

/**
 * Framed building's own queue plus extras on the rest of the group.
 * `count` / `progress` are the primary site; `extra` is other buildings.
 * @param {number[]} indices
 * @param {{ tracks?: { kind?: string, id?: string, count?: number, progress?: number }[], hp?: number }[] | null | undefined} buildings
 * @param {number} [primaryIndex]
 */
export function aggregateBuildingTracks(indices, buildings, primaryIndex = -1) {
  const primary = primaryIndex | 0;
  /** @type {Record<string, { progress: number, count: number, extra: number }>} */
  const tracks = {};
  for (let k = 0; k < (indices?.length ?? 0); k++) {
    const i = indices[k] | 0;
    const b = buildings?.[i];
    if (!buildingAlive(b)) continue;
    const isPrimary = primary < 0 || i === primary;
    for (const t of b?.tracks ?? []) {
      if (!t?.id || (t.count | 0) < 1) continue;
      const key = `${t.kind}:${t.id}`;
      const n = t.count | 0;
      const progress = Number(t.progress) || 0;
      const prev = tracks[key];
      if (!prev) {
        tracks[key] = isPrimary
          ? { progress, count: n, extra: 0 }
          : { progress: 0, count: 0, extra: n };
        continue;
      }
      if (isPrimary) {
        prev.count += n;
        prev.progress = progress;
      } else {
        prev.extra += n;
      }
    }
  }
  return tracks;
}
