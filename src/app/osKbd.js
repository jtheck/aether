// In-game pad keyboard for menu text fields (player name, lobby seed).

import { applyTextFieldValue, textFieldMaxChars } from './osTextInput.js';

export const OS_KBD_ID = 'os_kbd';

export const OS_KBD_LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

export const OS_KBD_DIGITS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
];

export function osKbdStartMode(el) {
  const mode = String(el?.inputMode || el?.inputmode || '').toLowerCase();
  if (mode === 'numeric' || mode === 'decimal') return 'digits';
  if (el?.type === 'number') return 'digits';
  return 'letters';
}

export function applyOsKbdKey(value, key, maxChars = 24, replaceAll = false) {
  const cur = String(value ?? '');
  const max = Number.isFinite(maxChars) && maxChars > 0 ? maxChars | 0 : 24;
  if (key === 'back') return cur.slice(0, -1);
  if (key === 'space') {
    const next = replaceAll ? ' ' : `${cur} `;
    return next.slice(0, max);
  }
  if (typeof key === 'string' && key.length === 1) {
    const next = replaceAll ? key : `${cur}${key}`;
    return next.slice(0, max);
  }
  return cur;
}

export function osKbdRoot(doc) {
  const el = doc?.getElementById?.(OS_KBD_ID);
  return el && !el.hidden ? el : null;
}

export function closeOsKbd(doc = typeof document !== 'undefined' ? document : null) {
  const root = doc?.getElementById?.(OS_KBD_ID);
  if (!root) return false;
  const active = doc?.activeElement;
  if (active && (root === active || root.contains?.(active))) active.blur?.();
  root.hidden = true;
  root._osKbd = null;
  return true;
}

function btn(doc, action, label, wide, row, col) {
  const el = doc.createElement('button');
  el.type = 'button';
  el.dataset.osKbd = action;
  el.dataset.osKbdRow = String(row);
  el.dataset.osKbdCol = String(col);
  el.textContent = label;
  if (wide) el.className = 'is-wide';
  return el;
}

export function listOsKbdKeys(root) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n !== root && n.dataset?.osKbd != null && String(n.dataset.osKbd) !== '') out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

export function findOsKbdKey(root, action) {
  const want = String(action ?? '').toLowerCase();
  if (!want) return null;
  for (const el of listOsKbdKeys(root)) {
    if (String(el.dataset.osKbd).toLowerCase() === want) return el;
  }
  return null;
}

export function osKbdRows(items) {
  const byRow = new Map();
  for (const el of items) {
    const r = Number(el.dataset?.osKbdRow) | 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(el);
  }
  return [...byRow.keys()].sort((a, b) => a - b).map((k) => {
    const line = byRow.get(k);
    line.sort((a, b) => (Number(a.dataset.osKbdCol) | 0) - (Number(b.dataset.osKbdCol) | 0));
    return line;
  });
}

/** Move focus on the key grid. Up/down stay in column; left/right wrap the row. */
export function stepOsKbdFocus(root, dx, dy) {
  const items = listOsKbdKeys(root);
  const rows = osKbdRows(items);
  if (!rows.length || (!dx && !dy)) return null;
  const doc = root.ownerDocument;
  const current = items.includes(doc?.activeElement) ? doc.activeElement : null;
  let row = 0;
  let col = 0;
  if (current) {
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].indexOf(current);
      if (c >= 0) {
        row = r;
        col = c;
        break;
      }
    }
  }
  if (dy) {
    row = (row + dy + rows.length) % rows.length;
    col = Math.min(col, rows[row].length - 1);
  }
  if (dx) {
    const line = rows[row];
    col = (col + dx + line.length) % line.length;
  }
  const next = rows[row][col];
  markOsKbdFocus(root, next);
  return next ?? null;
}

function focusKey(el) {
  if (!el?.focus) return;
  try {
    el.focus({ focusVisible: true });
  } catch {
    el.focus();
  }
}

export function markOsKbdFocus(root, el) {
  if (!el) return null;
  for (const key of listOsKbdKeys(root)) {
    const on = key === el;
    if (key.classList?.toggle) key.classList.toggle('is-on', on);
    else if (on) key.className = key.className ? `${key.className} is-on` : 'is-on';
  }
  focusKey(el);
  if (root?._osKbd) root._osKbd.focusAction = el.dataset?.osKbd ?? null;
  return el;
}

export function pressOsKbdAction(doc, action) {
  const root = osKbdRoot(doc) ?? doc?.getElementById?.(OS_KBD_ID);
  if (!root?._osKbd?.el || root.hidden) return false;
  press(root, action);
  return true;
}

function paint(root) {
  const doc = root.ownerDocument;
  const state = root._osKbd;
  if (!doc?.createElement || !state) return;
  const keep = state.focusAction
    ?? root.ownerDocument?.activeElement?.dataset?.osKbd;
  root.replaceChildren();
  const preview = doc.createElement('div');
  preview.className = 'os-kbd-preview';
  preview.textContent = state.el?.value ?? '';
  root.appendChild(preview);
  const rows = state.mode === 'digits' ? OS_KBD_DIGITS : OS_KBD_LETTERS;
  let row = 0;
  for (const cols of rows) {
    const line = doc.createElement('div');
    line.className = 'os-kbd-row';
    cols.forEach((ch, col) => {
      const glyph = state.shift && state.mode === 'letters' ? ch.toUpperCase() : ch;
      line.appendChild(btn(doc, glyph, glyph, false, row, col));
    });
    root.appendChild(line);
    row += 1;
  }

  const actions = doc.createElement('div');
  actions.className = 'os-kbd-row';
  let col = 0;
  const add = (action, label, wide) => {
    actions.appendChild(btn(doc, action, label, wide, row, col));
    col += 1;
  };
  if (state.mode === 'letters') {
    add('shift', state.shift ? 'ABC' : 'abc');
    add('mode', '123');
  } else {
    add('mode', 'abc');
  }
  add('space', 'space', true);
  add('back', '⌫');
  add('done', 'done');
  root.appendChild(actions);

  markOsKbdFocus(root, findOsKbdKey(root, keep) ?? listOsKbdKeys(root)[0]);
}

function press(root, action) {
  const state = root._osKbd;
  if (!state?.el) return;
  if (action === 'done') {
    applyTextFieldValue(state.el, state.el.value ?? '');
    closeOsKbd(root.ownerDocument);
    return;
  }
  if (action === 'shift') {
    state.shift = !state.shift;
    paint(root);
    return;
  }
  if (action === 'mode') {
    state.mode = state.mode === 'digits' ? 'letters' : 'digits';
    state.shift = false;
    paint(root);
    return;
  }
  const next = applyOsKbdKey(state.el.value, action, textFieldMaxChars(state.el), state.replaceAll);
  state.replaceAll = false;
  if (action.length === 1 && state.shift) state.shift = false;
  if (action === 'space' || (typeof action === 'string' && action.length === 1)) {
    state.focusAction = action;
  }
  applyTextFieldValue(state.el, next);
  paint(root);
}

export function openOsKbd(el, opts = {}) {
  const doc = opts.document
    ?? el?.ownerDocument
    ?? (typeof document !== 'undefined' ? document : null);
  if (!el || !doc?.createElement) return false;
  let root = doc.getElementById(OS_KBD_ID);
  if (!root) {
    root = doc.createElement('div');
    root.id = OS_KBD_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Keyboard');
    root.addEventListener('click', (e) => {
      const hit = e.target?.closest?.('[data-os-kbd]');
      if (!hit || !root._osKbd) return;
      e.preventDefault?.();
      press(root, hit.dataset.osKbd);
    });
    (doc.body || doc.documentElement)?.appendChild?.(root);
  }
  root.hidden = false;
  const mode = osKbdStartMode(el);
  root._osKbd = {
    el,
    mode,
    shift: false,
    replaceAll: false,
    focusAction: mode === 'digits' ? '1' : 'q',
  };
  paint(root);
  return true;
}
