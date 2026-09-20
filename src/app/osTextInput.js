// Menu text-field helpers used by the in-game pad keyboard.

export function textFieldMaxChars(el, fallback = 24) {
  const n = Number(el?.maxLength);
  if (Number.isFinite(n) && n > 0 && n < 10000) return n | 0;
  return fallback;
}

export function applyTextFieldValue(el, text, Ev = globalThis.Event) {
  if (!el) return false;
  el.value = String(text ?? '');
  if (typeof el.dispatchEvent === 'function' && typeof Ev === 'function') {
    el.dispatchEvent(new Ev('input', { bubbles: true }));
    el.dispatchEvent(new Ev('change', { bubbles: true }));
  }
  return true;
}
