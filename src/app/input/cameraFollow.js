import { isBuildingAlive } from '../../sim/buildings.js';

/**
 * Average XZ of the current selection (live units + standing buildings + agoras).
 * @param {{
 *   count?: number,
 *   selected?: ArrayLike<number>,
 *   alive?: ArrayLike<number>,
 *   renderX?: ArrayLike<number>,
 *   renderZ?: ArrayLike<number>,
 *   selectedBuildings?: { kind?: string, index?: number }[] | null,
 *   buildings?: { x?: number, z?: number, hp?: number }[] | null,
 *   agoras?: { x?: number, z?: number }[] | null,
 * }} src
 * @returns {{ x: number, z: number } | null}
 */
export function selectionCentroidXZ(src) {
  let sx = 0;
  let sz = 0;
  let n = 0;
  const cap = src?.count | 0;
  const selected = src?.selected;
  const alive = src?.alive;
  const renderX = src?.renderX;
  const renderZ = src?.renderZ;
  for (let i = 0; i < cap; i++) {
    if (!selected?.[i] || !alive?.[i]) continue;
    const x = renderX?.[i];
    const z = renderZ?.[i];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    sx += x;
    sz += z;
    n++;
  }
  const sels = src?.selectedBuildings ?? [];
  const buildings = src?.buildings;
  const agoras = src?.agoras;
  for (let i = 0; i < sels.length; i++) {
    const sel = sels[i];
    if (sel?.kind === 'agora') {
      const a = agoras?.[sel.index];
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
      sx += a.x;
      sz += a.z;
      n++;
      continue;
    }
    const b = buildings?.[sel.index];
    if (!isBuildingAlive(b) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
    sx += b.x;
    sz += b.z;
    n++;
  }
  if (!n) return null;
  return { x: sx / n, z: sz / n };
}

/** Space in a name field / menu control should type or activate, not lock the camera. */
export function isCameraFollowTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  if (el.isContentEditable) return true;
  return false;
}
