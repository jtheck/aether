// Centered resource stacks. The authored SVG keeps Inkscape folder labels
// (wood / stone / mineral / food, then 1–c); we key off those, slide the
// groups into bank order, and fade icons as the bank fills. A wasted haul
// return pops the next locked slot (7 or a) yellow once, then fades it out.

import { formatGameNumber } from '../sim/formatGameNumber.js';
import { RESOURCE_KINDS } from '../sim/resources.js';
import {
  RESOURCE_SLOT_LABELS,
  SLOT_VIS,
  ownerStorageView,
  slotVisual,
} from '../sim/storage.js';
import {
  RESOURCE_ICONS_URL,
  collectResourceIcons,
  normalizeResourceKind,
} from '../render/resourceIconSheet.js';

export { RESOURCE_ICONS_URL, collectResourceIcons, normalizeResourceKind };

/**
 * @param {HTMLElement | null} [host]
 */
export function createResourceBank(host) {
  const root = host || document.getElementById('resource-bank');
  /** @type {Record<string, Record<string, Element>> | null} */
  let icons = null;
  /** @type {Record<string, HTMLElement> | null} */
  let counts = null;
  let ready = false;
  let layout = () => {};

  async function mount() {
    if (!root || ready) return ready;
    const res = await fetch(RESOURCE_ICONS_URL);
    if (!res.ok) throw new Error(`resource icons ${res.status}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.localName !== 'svg') throw new Error('resource icons: no svg');
    icons = collectResourceIcons(svg);
    svg.setAttribute('aria-hidden', 'true');
    const svgHost = root.querySelector('.resource-bank-svg') || root;
    svgHost.appendChild(document.importNode(svg, true));
    // Re-collect from the live tree so class toggles stick.
    const liveSvg = svgHost.querySelector('svg');
    icons = collectResourceIcons(liveSvg);
    counts = wireCounts(root);
    root.hidden = false;
    layout = () => layoutResourceBank(root, liveSvg, icons, counts);
    requestAnimationFrame(layout);
    window.addEventListener('resize', layout);
    ready = true;
    return true;
  }

  /**
   * @param {{
   *   bank: { wood?: number, stone?: number, mineral?: number, food?: number },
   *   buildings?: object[],
   *   owner: number,
   *   hidden?: boolean,
   * }} state
   */
  function paint(state) {
    if (!ready || !icons || !root) return;
    if (state.hidden) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const view = ownerStorageView(state.buildings, state.owner, state.bank, 'world');
    for (let k = 0; k < RESOURCE_KINDS.length; k++) {
      const kind = RESOURCE_KINDS[k];
      const row = view[kind];
      const map = icons[kind];
      for (let i = 0; i < RESOURCE_SLOT_LABELS.length; i++) {
        const el = map[RESOURCE_SLOT_LABELS[i]];
        if (!el) continue;
        const vis = slotVisual(i, row.filled, row.slots, row.atCap);
        const on = vis === SLOT_VIS.ON;
        el.classList.toggle('is-on', on);
        // A prior 7/A hint flash must not keep a now-filled icon at opacity 0.
        if (on) el.classList.remove('is-flash');
      }
      const countEl = counts?.[kind];
      if (countEl) {
        const next = formatGameNumber(row.amount);
        if (countEl.textContent !== next) countEl.textContent = next;
      }
    }
  }

  /**
   * One-shot pop per wasted return: yellow on the next locked slot (7 / a).
   * A full stack (no hint) is a no-op — don't wash the whole kind.
   * @param {{ owner: number, kind: string, hint?: string | null }[] | null | undefined} events
   * @param {number} owner
   */
  function flashOverflow(events, owner) {
    if (!ready || !icons || !events?.length) return;
    const o = owner | 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if ((ev.owner | 0) !== o || !ev.hint) continue;
      bumpFlash(icons[ev.kind]?.[ev.hint], 'is-flash');
    }
  }

  return { mount, paint, flashOverflow, get ready() { return ready; } };
}

/**
 * Authored art is stone / wood / food / mineral. Slide the groups so they
 * read wood → stone → mineral → food, matching the bank order.
 * @param {SVGSVGElement} svg
 */
export function orderResourceColumns(svg) {
  if (!svg || svg.dataset.ordered === '1') return;
  const groups = [];
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const g = svg.querySelector(`[data-kind="${RESOURCE_KINDS[i]}"]`);
    if (g) groups.push(g);
  }
  if (groups.length !== RESOURCE_KINDS.length) return;
  const screen = groups.map((g) => g.getBoundingClientRect().left);
  const slots = screen.slice().sort((a, b) => a - b);
  const svgW = svg.getBoundingClientRect().width;
  const vbW = svg.viewBox.baseVal.width || 100;
  if (svgW <= 0) return;
  const unit = svgW / vbW;
  const ns = svg.namespaceURI;
  for (let col = 0; col < groups.length; col++) {
    const dx = (slots[col] - screen[col]) / unit;
    if (Math.abs(dx) < 0.02) continue;
    const wrap = svg.ownerDocument.createElementNS(ns, 'g');
    wrap.setAttribute('transform', `translate(${dx},0)`);
    groups[col].parentNode.insertBefore(wrap, groups[col]);
    wrap.appendChild(groups[col]);
  }
  svg.dataset.ordered = '1';
}

/**
 * Sit each count in the pile pocket, on one even 4-column grid — same
 * left-edge spacing as the stacks, not the live icon width.
 * @param {HTMLElement} root
 * @param {SVGSVGElement | null} svg
 * @param {Record<string, Record<string, Element>>} icons
 * @param {Record<string, HTMLElement> | null} counts
 */
export function placeCountsOnPiles(root, svg, icons, counts) {
  if (!root || !svg || !icons || !counts) return;
  const origin = root.getBoundingClientRect();
  const lefts = [];
  const bottoms = [];
  for (let k = 0; k < RESOURCE_KINDS.length; k++) {
    const g = svg.querySelector(`[data-kind="${RESOURCE_KINDS[k]}"]`);
    const r = g?.getBoundingClientRect?.();
    if (!r || !(r.width > 0)) return;
    lefts.push(r.left);
    bottoms.push(r.bottom);
  }
  const n = lefts.length;
  const base = lefts[0];
  const step = n > 1 ? (lefts[n - 1] - base) / (n - 1) : 0;
  if (!(step > 0)) return;
  const inset = step * 0.72 - 13;
  for (let k = 0; k < n; k++) {
    const el = counts[RESOURCE_KINDS[k]];
    if (!el) continue;
    el.style.left = `${base + step * k + inset - origin.left}px`;
    el.style.top = `${bottoms[k] - origin.top}px`;
  }
}

function layoutResourceBank(root, svg, icons, counts) {
  orderResourceColumns(svg);
  placeCountsOnPiles(root, svg, icons, counts);
}

/** Restart a one-shot fade even if the last flash is still running. */
function bumpFlash(el, cls = 'is-flash') {
  if (!el) return;
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
  const done = (e) => {
    if (e.target !== el) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

/** @param {HTMLElement} root */
function wireCounts(root) {
  const row = root.querySelector('.resource-bank-counts');
  if (!row) return null;
  /** @type {Record<string, HTMLElement>} */
  const map = {};
  const spans = row.querySelectorAll('[data-kind]');
  for (let i = 0; i < spans.length; i++) {
    const el = /** @type {HTMLElement} */ (spans[i]);
    const kind = normalizeResourceKind(el.getAttribute('data-kind') || '');
    if (kind) map[kind] = el;
  }
  return map;
}
