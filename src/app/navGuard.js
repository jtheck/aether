// Block mouse / keyboard history navigation so a live match is not dumped
// by a thumb button or Alt+Left. Toolbar Back in the browser chrome still works.

const LISTEN_OPTS = { capture: true };

/** X1 / X2 — browser Back / Forward on most mice. */
export function isBrowserNavMouseButton(button) {
  return button === 3 || button === 4;
}

/** Name fields still need Backspace and Option/Alt+arrow. */
export function isTextEntryTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!el.isContentEditable;
}

/**
 * @param {{
 *   key?: string,
 *   code?: string,
 *   altKey?: boolean,
 *   metaKey?: boolean,
 *   ctrlKey?: boolean,
 * }} e
 */
export function isBrowserNavKey(e, typing = false) {
  if (typing) return false;
  const key = e.key;
  const code = e.code;
  if (key === 'BrowserBack' || key === 'BrowserForward') return true;
  if (key === 'Backspace' || code === 'Backspace') return true;
  const left = key === 'ArrowLeft' || code === 'ArrowLeft';
  const right = key === 'ArrowRight' || code === 'ArrowRight';
  if ((e.altKey || e.metaKey) && (left || right)) return true;
  const open = key === '[' || code === 'BracketLeft';
  const close = key === ']' || code === 'BracketRight';
  if ((e.metaKey || e.ctrlKey) && (open || close)) return true;
  return false;
}

/**
 * @param {object} [root]
 * @returns {() => void}
 */
export function installNavGuard(root = globalThis) {
  const win = root.window ?? root;
  const doc = root.document ?? win.document;
  if (!win?.addEventListener || !doc) return () => {};

  function onMouse(e) {
    if (isBrowserNavMouseButton(e.button)) e.preventDefault();
  }

  function onKey(e) {
    if (isBrowserNavKey(e, isTextEntryTarget(doc.activeElement))) e.preventDefault();
  }

  win.addEventListener('pointerdown', onMouse, LISTEN_OPTS);
  win.addEventListener('mousedown', onMouse, LISTEN_OPTS);
  win.addEventListener('mouseup', onMouse, LISTEN_OPTS);
  win.addEventListener('auxclick', onMouse, LISTEN_OPTS);
  win.addEventListener('keydown', onKey, LISTEN_OPTS);

  return () => {
    win.removeEventListener('pointerdown', onMouse, LISTEN_OPTS);
    win.removeEventListener('mousedown', onMouse, LISTEN_OPTS);
    win.removeEventListener('mouseup', onMouse, LISTEN_OPTS);
    win.removeEventListener('auxclick', onMouse, LISTEN_OPTS);
    win.removeEventListener('keydown', onKey, LISTEN_OPTS);
  };
}
