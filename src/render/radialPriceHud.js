// Screen-space menu prices: amount + per-kind resource icon. No pop — every
// train is 1 pop, so it is not worth listing.

import { lackingCostKinds, resourceCostParts } from '../sim/resources.js';
import { loadPriceIcons } from './resourceIconSheet.js';

/** @type {HTMLElement | null} */
let root = null;
/** @type {Record<string, SVGSVGElement>} */
let icons = {};
let ready = false;
/** @type {Promise<void> | null} */
let mounting = null;

/** @type {Map<string, HTMLElement>} */
const nodes = new Map();

function ensureRoot() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'radial-prices';
  document.body.appendChild(root);
}

export function ensureRadialPriceHud() {
  ensureRoot();
  if (ready || mounting) return mounting ?? Promise.resolve();
  mounting = loadPriceIcons()
    .then((map) => {
      icons = map;
      ready = true;
      for (const el of nodes.values()) {
        if (!el.dataset.cost) continue;
        try {
          fillRow(el, readPaint(el));
        } catch {
          /* ignore */
        }
      }
    })
    .catch((err) => {
      console.warn('radial price icons failed', err);
      mounting = null;
    });
  return mounting;
}

function washCss(wash) {
  const r = Math.round((wash?.[0] ?? 0.8) * 255);
  const g = Math.round((wash?.[1] ?? 0.8) * 255);
  const b = Math.round((wash?.[2] ?? 0.8) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function costKey(cost) {
  const parts = resourceCostParts(cost);
  if (!parts.length) return '';
  return parts.map((p) => `${p.kind}:${p.amount}`).join('|');
}

function readPaint(el) {
  return {
    cost: el.dataset.cost ? JSON.parse(el.dataset.cost) : null,
    bank: el.dataset.bank ? JSON.parse(el.dataset.bank) : null,
    gate: el.dataset.gate || 'ok',
    wash: el.dataset.wash ? JSON.parse(el.dataset.wash) : null,
    okWash: el.dataset.okWash ? JSON.parse(el.dataset.okWash) : null,
  };
}

function fillRow(el, spec) {
  el.textContent = '';
  const cost = spec.cost;
  const parts = resourceCostParts(cost);
  const split = spec.gate === 'unafford';
  const lack = split ? new Set(lackingCostKinds(spec.bank, cost)) : null;
  const okCss = washCss(spec.okWash ?? spec.wash);
  const badCss = washCss(spec.wash);
  for (let i = 0; i < parts.length; i++) {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'radial-price-sep';
      sep.textContent = '·';
      el.appendChild(sep);
    }
    const amt = document.createElement('span');
    amt.className = 'radial-price-amt';
    amt.textContent = String(parts[i].amount);
    el.appendChild(amt);
    const src = icons[parts[i].kind];
    const icon = src ? src.cloneNode(true) : null;
    if (icon) el.appendChild(icon);
    if (split) {
      const css = lack.has(parts[i].kind) ? badCss : okCss;
      amt.style.color = css;
      if (icon) icon.style.color = css;
    }
  }
}

/**
 * @param {string} id
 * @param {{
 *   cost: Record<string, number> | null | undefined,
 *   x: number,
 *   y: number,
 *   opacity?: number,
 *   wash?: number[],
 *   okWash?: number[],
 *   gate?: string,
 *   bank?: Record<string, number> | null,
 * } | null} spec
 */
export function setRadialPrice(id, spec) {
  void ensureRadialPriceHud();
  if (!root) return;
  if (!spec || !costKey(spec.cost)) {
    hideRadialPrice(id);
    return;
  }
  let el = nodes.get(id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'radial-price';
    root.appendChild(el);
    nodes.set(id, el);
  }
  const gate = spec.gate || 'ok';
  const lackBits = gate === 'unafford' ? lackingCostKinds(spec.bank, spec.cost).join(',') : '';
  const key = `${costKey(spec.cost)}|${washCss(spec.wash)}|${washCss(spec.okWash)}|${gate}|${lackBits}`;
  if (el.dataset.key !== key) {
    el.dataset.cost = JSON.stringify(spec.cost ?? null);
    el.dataset.bank = JSON.stringify(spec.bank ?? null);
    el.dataset.gate = gate;
    el.dataset.wash = JSON.stringify(spec.wash ?? null);
    el.dataset.okWash = JSON.stringify(spec.okWash ?? spec.wash ?? null);
    fillRow(el, spec);
    el.style.color = washCss(gate === 'unafford' ? (spec.okWash ?? spec.wash) : spec.wash);
    el.dataset.key = key;
  }
  el.style.opacity = spec.opacity == null ? '0.85' : String(spec.opacity);
  el.style.transform = `translate(${spec.x}px, ${spec.y}px) translate(-50%, 0)`;
  el.hidden = false;
}

/** @param {string} id */
export function hideRadialPrice(id) {
  const el = nodes.get(id);
  if (el) el.hidden = true;
}

/** @param {string} prefix */
export function hideRadialPricesWithPrefix(prefix) {
  for (const id of nodes.keys()) {
    if (id.startsWith(prefix)) hideRadialPrice(id);
  }
}
