// Authored resource SVG — Inkscape folder labels (kind) and slot labels (1–c).
// Inkscape "Invert" filters rasterize the sheet at viewBox size (100×20);
// strip them on load so the HUD strokes stay vectors.

import { RESOURCE_KINDS } from '../sim/resources.js';
import { RESOURCE_SLOT_LABELS } from '../sim/storage.js';

export const RESOURCE_ICONS_URL = '/assets/images/resource_icons.svg';
/** Menu prices: wood #B, food #3, others #2. */
export const PRICE_ICON_SLOT = Object.freeze({
  wood: 'b',
  stone: '2',
  mineral: '2',
  food: '3',
});

const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** @param {Element | null | undefined} el */
export function inkscapeLabel(el) {
  if (!el?.getAttribute) return '';
  const raw =
    el.getAttributeNS?.(INKSCAPE_NS, 'label') ||
    el.getAttribute('inkscape:label') ||
    '';
  return String(raw).trim().toLowerCase();
}

/** Drop `filter:…` from an inline style so SVG filters cannot rasterize. */
export function stripFilterCss(style) {
  const s = String(style || '');
  if (!s) return '';
  return s
    .replace(/(?:^|;)\s*filter\s*:[^;]*/gi, '')
    .replace(/^;+|;+$/g, '')
    .replace(/;;+/g, ';');
}

/** @param {Element} el */
function stripSvgFilter(el) {
  if (!el?.getAttribute) return;
  el.removeAttribute('filter');
  const style = el.getAttribute('style');
  if (style && /filter\s*:/i.test(style)) {
    const next = stripFilterCss(style);
    if (next) el.setAttribute('style', next);
    else el.removeAttribute('style');
  }
}

/**
 * Remove authored Invert filters (and their defs) from a sheet.
 * @param {Element | null | undefined} root
 */
export function stripAuthoredSvgFilters(root) {
  if (!root?.querySelectorAll) return;
  stripSvgFilter(root);
  const filters = root.querySelectorAll('filter');
  for (let i = 0; i < filters.length; i++) filters[i].remove();
  const painted = root.querySelectorAll('[filter], [style*="filter"]');
  for (let i = 0; i < painted.length; i++) stripSvgFilter(painted[i]);
}

/** @param {string} label */
export function normalizeResourceKind(label) {
  const k = String(label || '').trim().toLowerCase();
  if (k === 'minerals') return 'mineral';
  if (k === 'wood' || k === 'stone' || k === 'mineral' || k === 'food') return k;
  return '';
}

/**
 * Walk the authored groups and stamp data-kind / data-slot.
 * @param {Element} svg
 * @returns {Record<string, Record<string, Element>>}
 */
export function collectResourceIcons(svg) {
  stripAuthoredSvgFilters(svg);
  /** @type {Record<string, Record<string, Element>>} */
  const out = { wood: {}, stone: {}, mineral: {}, food: {} };
  const kids = svg.children;
  for (let i = 0; i < kids.length; i++) {
    const kindG = kids[i];
    if (kindG.localName !== 'g') continue;
    const kind = normalizeResourceKind(inkscapeLabel(kindG));
    if (!kind) continue;
    kindG.setAttribute('data-kind', kind);
    const icons = kindG.children;
    for (let j = 0; j < icons.length; j++) {
      const icon = icons[j];
      if (icon.localName !== 'g') continue;
      const slot = inkscapeLabel(icon);
      if (!RESOURCE_SLOT_LABELS.includes(slot)) continue;
      icon.setAttribute('data-slot', slot);
      icon.classList.add('resource-icon');
      out[kind][slot] = icon;
    }
  }
  return out;
}

/**
 * @param {Element} iconG
 * @returns {DOMRect | null}
 */
function iconBBox(iconG) {
  if (!iconG || typeof document === 'undefined') return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const wrap = document.createElementNS(SVG_NS, 'g');
  wrap.appendChild(iconG.cloneNode(true));
  svg.appendChild(wrap);
  const host = document.documentElement;
  host.appendChild(svg);
  let box;
  try {
    box = wrap.getBBox();
  } catch {
    box = null;
  }
  host.removeChild(svg);
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  return box;
}

function paddedFrame(box) {
  const pad = Math.max(box.width, box.height) * 0.1;
  return { frameW: box.width + pad * 2, frameH: box.height + pad * 2 };
}

/**
 * Standalone SVG of one slot. Optional frame keeps back-row art (longer
 * twigs, etc.) on the same scale as a front-row glyph.
 * @param {Element} iconG
 * @param {{ frameW?: number, frameH?: number }} [opts]
 * @returns {SVGSVGElement | null}
 */
export function isolateResourceIcon(iconG, opts) {
  const box = iconBBox(iconG);
  if (!box) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const wrap = document.createElementNS(SVG_NS, 'g');
  wrap.appendChild(iconG.cloneNode(true));
  svg.appendChild(wrap);
  svg.setAttribute('aria-hidden', 'true');
  const tight = paddedFrame(box);
  const fw = opts?.frameW ?? tight.frameW;
  const fh = opts?.frameH ?? tight.frameH;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  svg.setAttribute('viewBox', `${cx - fw / 2} ${cy - fh / 2} ${fw} ${fh}`);
  return svg;
}

/**
 * @param {string} [url]
 * @returns {Promise<Record<string, SVGSVGElement>>}
 */
export async function loadPriceIcons(url = RESOURCE_ICONS_URL) {
  /** @type {Record<string, SVGSVGElement>} */
  const out = {};
  const res = await fetch(url);
  if (!res.ok) throw new Error(`resource icons ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  const map = collectResourceIcons(svg);
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const kind = RESOURCE_KINDS[i];
    const slot = PRICE_ICON_SLOT[kind] ?? '2';
    const icon = isolateResourceIcon(map[kind][slot]);
    if (!icon) continue;
    icon.dataset.kind = kind;
    icon.dataset.slot = slot;
    // Wood-B is a taller glyph; the shared 1.2em height thins its strokes.
    if (kind === 'wood') {
      icon.style.height = '1.5em';
      icon.style.width = 'auto';
    }
    out[kind] = icon;
  }
  return out;
}
