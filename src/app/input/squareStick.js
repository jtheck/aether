// Gamepad aim for the square command panels.
// A lone stick maps onto the menu's button rectangles: up is the top edge,
// right is the right edge. Full throw stays on the button you are pointing
// at — it does not jump to an outer ring the way the old pie did.
// The other stick can aim too. The stronger throw wins. A centered stick
// clears the highlight.

export const SQUARE_STICK_DEADZONE = 0.22;
/** Another button has to be this much closer before the highlight leaves. */
const HOLD_SLACK = 6;

/**
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 */
export function menuCells(targets) {
  const inner = targets?.inner ?? [];
  const outer = targets?.outer ?? [];
  const cells = [];
  for (const cell of inner) if (cell) cells.push(cell);
  for (const cell of outer) if (cell) cells.push(cell);
  return cells;
}

/**
 * Square panels publish a screen box on every button. Pie slices only have
 * an angle, and those stay on the radial picker.
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 */
export function menuTargetsAreSquares(targets) {
  const cells = menuCells(targets);
  if (!cells.length) return false;
  for (const cell of cells) {
    if (!(cell.w > 0) || !(cell.h > 0)) return false;
    if (!Number.isFinite(cell.x) || !Number.isFinite(cell.y)) return false;
  }
  return true;
}

/**
 * @param {number} v
 */
function axis(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.abs(v) <= SQUARE_STICK_DEADZONE ? 0 : v;
}

/**
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number } | null | undefined} read
 */
function aimStick(read) {
  const lx = axis(read?.lx ?? 0);
  const ly = axis(read?.ly ?? 0);
  const rx = axis(read?.rx ?? 0);
  const ry = axis(read?.ry ?? 0);
  const lm = Math.hypot(lx, ly);
  const rm = Math.hypot(rx, ry);
  if (!(lm > 0) && !(rm > 0)) return null;
  if (rm > lm) return { x: rx, y: ry };
  return { x: lx, y: ly };
}

/**
 * @param {object[]} cells
 */
function menuBounds(cells) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    if (cell.x < minX) minX = cell.x;
    if (cell.y < minY) minY = cell.y;
    const r = cell.x + cell.w;
    const b = cell.y + cell.h;
    if (r > maxX) maxX = r;
    if (b > maxY) maxY = b;
  }
  return {
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    hx: Math.max(1, (maxX - minX) * 0.5),
    hy: Math.max(1, (maxY - minY) * 0.5),
  };
}

/**
 * Distance from a point to a button. Zero when the point is inside.
 * @param {object} cell
 * @param {number} x
 * @param {number} y
 */
function distToButton(cell, x, y) {
  const dx = x < cell.x ? cell.x - x : x > cell.x + cell.w ? x - (cell.x + cell.w) : 0;
  const dy = y < cell.y ? cell.y - y : y > cell.y + cell.h ? y - (cell.y + cell.h) : 0;
  return Math.hypot(dx, dy);
}

/**
 * @param {object} cell
 * @param {object | null | undefined} held
 */
function sameButton(cell, held) {
  if (!held || cell.kind !== held.kind) return false;
  const id = cell.id ?? null;
  const heldId = held.id ?? null;
  return id === heldId;
}

/**
 * @param {object} cell
 */
function asPick(cell) {
  const pick = { kind: cell.kind, ring: cell.ring === 'inner' ? 'inner' : 'outer' };
  if (cell.id != null) pick.id = cell.id;
  if (Number.isFinite(cell.ang)) pick.ang = cell.ang;
  return pick;
}

/**
 * @param {{ lx?: number, ly?: number, rx?: number, ry?: number } | null | undefined} read
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 * @param {object | null | undefined} [held]
 */
export function squareStickPick(read, targets, held = null) {
  const cells = menuCells(targets);
  if (!menuTargetsAreSquares(targets)) return null;
  const stick = aimStick(read);
  if (!stick) return null;

  const box = menuBounds(cells);
  const x = box.cx + Math.max(-1, Math.min(1, stick.x)) * box.hx;
  const y = box.cy + Math.max(-1, Math.min(1, stick.y)) * box.hy;

  let best = null;
  let bestD = Infinity;
  let heldCell = null;
  let heldD = Infinity;
  for (const cell of cells) {
    const d = distToButton(cell, x, y);
    if (d < bestD) {
      bestD = d;
      best = cell;
    }
    if (sameButton(cell, held)) {
      heldCell = cell;
      heldD = d;
    }
  }
  if (!best) return null;
  if (heldCell && heldD <= bestD + HOLD_SLACK) return asPick(heldCell);
  return asPick(best);
}
