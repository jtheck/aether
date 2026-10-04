/**
 * Selection collars are stored by entity id. The GPU draw count only has to
 * cover the highest visible slot — a count of `entityCount` submits one
 * zero-scale collar per unit for the rest of the match, including after the
 * army is dead.
 *
 * @param {Uint8Array} shown 1 = collar visible at that entity id
 * @param {number} index
 * @param {boolean} visible
 * @param {number} prevCount
 */
export function nextSelectionRingDrawCount(shown, index, visible, prevCount) {
  const i = index | 0;
  if (i < 0 || i >= shown.length) return prevCount | 0;
  const prev = prevCount | 0;
  if (visible) {
    shown[i] = 1;
    return i + 1 > prev ? i + 1 : prev;
  }
  if (shown[i] === 0) return prev;
  shown[i] = 0;
  if (i + 1 !== prev) return prev;
  let h = i;
  while (h > 0 && shown[h - 1] === 0) h--;
  return h;
}
