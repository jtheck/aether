// Workshop garden refs — Steam ids, not fetchable URLs.
// Host still embeds the JSON for web guests; this only loads a local subscribe.

import { GARDEN_SESSION_KEY } from '../sim/garden.js';

export const WORKSHOP_SCHEME = 'workshop:';

export function parseWorkshopId(raw) {
  const s = String(raw ?? '').trim();
  return /^\d{1,20}$/.test(s) ? s : '';
}

export function normalizeGardenRel(file) {
  const s = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..') || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return '';
  if (!/\.garden$/i.test(s)) return '';
  if (s.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return s;
}

export function parseWorkshopRef(raw) {
  const text = String(raw || '').trim();
  if (!text.toLowerCase().startsWith(WORKSHOP_SCHEME)) return null;
  const rest = text.slice(WORKSHOP_SCHEME.length);
  const slash = rest.indexOf('/');
  const id = parseWorkshopId(slash < 0 ? rest : rest.slice(0, slash));
  if (!id) return null;
  if (slash < 0) return { id, file: '' };
  const file = normalizeGardenRel(rest.slice(slash + 1));
  if (!file) return null;
  return { id, file };
}

export function formatWorkshopRef(id, file) {
  const clean = parseWorkshopId(id);
  if (!clean) return '';
  const rel = normalizeGardenRel(file);
  return rel ? `${WORKSHOP_SCHEME}${clean}/${rel}` : `${WORKSHOP_SCHEME}${clean}`;
}

export function isWorkshopRef(raw) {
  return !!parseWorkshopRef(raw);
}

/**
 * Relative `next` (02.garden, maps/02.garden) stays inside the current Workshop pack.
 * Absolute / http / workshop: refs pass through.
 * @param {string} next
 * @param {string} [currentRef]
 */
export function resolveNextGardenRef(next, currentRef = '') {
  const raw = String(next || '').trim();
  if (!raw) return '';
  if (parseWorkshopRef(raw) || raw.startsWith('/') || /^https?:/i.test(raw) || raw === 'session' || raw === 'local') {
    return raw;
  }
  const cur = parseWorkshopRef(currentRef);
  if (!cur) return raw;
  const base = cur.file || 'map.garden';
  const joined = raw.includes('/')
    ? normalizeGardenRel(raw)
    : normalizeGardenRel(base.includes('/') ? `${base.slice(0, base.lastIndexOf('/') + 1)}${raw}` : raw);
  return joined ? formatWorkshopRef(cur.id, joined) : raw;
}

/**
 * Session, workshop:<id>, or a fetchable garden URL.
 * @param {string} raw
 * @param {{
 *   loadWorkshopGarden?: (id: string, file: string) => Promise<object | null> | object | null,
 *   fetchGarden?: (url: string) => Promise<object>,
 *   sessionText?: () => string | null,
 * }} [opts]
 */
export async function loadGardenRef(raw, opts = {}) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text === 'session' || text === 'local') {
    const stored = opts.sessionText
      ? opts.sessionText()
      : (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(GARDEN_SESSION_KEY) : null);
    if (!stored) throw new Error('no session garden');
    return JSON.parse(stored);
  }
  const workshop = parseWorkshopRef(text);
  if (workshop) {
    if (!opts.loadWorkshopGarden) throw new Error('workshop unavailable');
    const garden = await opts.loadWorkshopGarden(workshop.id, workshop.file);
    if (!garden) throw new Error('workshop garden missing');
    return garden;
  }
  if (opts.fetchGarden) return opts.fetchGarden(text);
  const res = await fetch(text);
  if (!res.ok) throw new Error(`garden ${res.status}`);
  return res.json();
}
