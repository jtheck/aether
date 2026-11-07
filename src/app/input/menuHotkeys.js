// Keyboard picks for an open radial.
// A Q T G H walk the option pads.
// Agora categories start at 9:00 and go clockwise.
// A production menu starts at pause/cancel and goes clockwise.
// Fewer than five options wrap, so every key still hits something.
// A sixth option and beyond has no key.
// X pauses, C cancels.
//
// Disc angles: 0 is screen-left (9:00), π/2 is the bottom, π is screen-right,
// −π/2 is the top. Angle grows toward screen-left, so clockwise decreases it.

const TAU = Math.PI * 2;

/** Order around the dial. */
export const MENU_OPTION_KEYS = ['KeyA', 'KeyQ', 'KeyT', 'KeyG', 'KeyH'];

/**
 * Pause's clockwise edge. Matches the action radial: the utility wedge is the
 * bottom 90°, pause on the left, cancel on the right. Clockwise leaves pause
 * toward screen-left.
 */
const PAUSE_CLOCKWISE_EDGE = Math.PI / 4;

function wrapTau(d) {
  let a = d % TAU;
  if (a < 0) a += TAU;
  return a === 0 ? 0 : a;
}

/**
 * Clockwise distance from 9:00, in [0, 2π).
 * @param {number} ang
 */
export function clockwiseFromNine(ang) {
  return wrapTau(-(Number(ang) || 0));
}

/**
 * Clockwise distance from the pause pad, in [0, 2π).
 * @param {number} ang
 */
export function clockwiseFromPause(ang) {
  return wrapTau(PAUSE_CLOCKWISE_EDGE - (Number(ang) || 0));
}

/**
 * Options the letter keys can hit. Agora uses the category pie (inner).
 * A production menu uses its pads, not pause or cancel.
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 */
export function orderedMenuOptions(targets) {
  if (!targets) return [];
  const inner = targets.inner ?? [];
  const outer = (targets.outer ?? []).filter(
    (s) => s && s.kind !== 'pause' && s.kind !== 'cancel',
  );
  const list = inner.length ? inner : outer;
  const rank = inner.length ? clockwiseFromNine : clockwiseFromPause;
  return [...list].sort((a, b) => rank(a.ang) - rank(b.ang));
}

/**
 * @param {{ inner?: object[], outer?: object[] } | null | undefined} targets
 * @param {string} code
 * @returns {object | null | undefined}
 *   undefined — not a menu key, or no menu is open
 *   null — menu key with nothing to activate
 *   object — the option to confirm
 */
export function menuHotkeyPick(targets, code) {
  if (!targets) return undefined;
  if (code === 'KeyX') {
    return (targets.outer ?? []).find((s) => s?.kind === 'pause') ?? null;
  }
  if (code === 'KeyC') {
    return (targets.outer ?? []).find((s) => s?.kind === 'cancel') ?? null;
  }
  const index = MENU_OPTION_KEYS.indexOf(code);
  if (index < 0) return undefined;
  const options = orderedMenuOptions(targets);
  if (!options.length) return null;
  if (options.length > MENU_OPTION_KEYS.length) return options[index];
  return options[index % options.length];
}
