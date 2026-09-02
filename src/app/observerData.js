// Roster sheet — spectators see every army; players see shared-vision
// others (AI / allies). Replaces the old bottom #resources dump.

import { RESOURCE_KINDS, ownerResourcesFrom } from '../sim/resources.js';
import { livingByOwner } from '../sim/world.js';
import { AI_OWNER } from '../sim/worldSetup.js';
import { ownerTint } from '../render/ownerTints.js';
import { loadPriceIcons } from '../render/resourceIconSheet.js';

/** @param {number[]} rgb01 */
function tintCss(rgb01) {
  const r = Math.round((rgb01?.[0] ?? 0.8) * 255);
  const g = Math.round((rgb01?.[1] ?? 0.8) * 255);
  const b = Math.round((rgb01?.[2] ?? 0.8) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * @param {{ humanPlayers?: number[], aiPlayers?: Array<number | { owner?: number }> } | null | undefined} session
 * @param {number[] | null | undefined} extra
 * @returns {number[]}
 */
export function collectObserverOwners(session, extra) {
  const ids = new Set();
  const humans = session?.humanPlayers ?? [];
  for (let i = 0; i < humans.length; i++) ids.add(humans[i] | 0);
  const ais = session?.aiPlayers ?? [];
  for (let i = 0; i < ais.length; i++) {
    const raw = ais[i];
    ids.add((typeof raw === 'number' ? raw : raw?.owner) | 0);
  }
  if (extra) {
    for (let i = 0; i < extra.length; i++) ids.add(extra[i] | 0);
  }
  return [...ids].filter((id) => id >= 0).sort((a, b) => a - b);
}

/**
 * Who belongs on the sheet. Spectators get the full roster; a player only
 * gets shared-vision others (never themselves).
 * @param {{
 *   observing?: boolean,
 *   localId?: number,
 *   session?: { humanPlayers?: number[], aiPlayers?: Array<number | { owner?: number }> },
 *   shareWith?: number[] | null,
 * }} spec
 * @returns {number[]}
 */
export function observerSheetOwners(spec) {
  if (spec?.observing) return collectObserverOwners(spec.session, spec.shareWith);
  const local = spec?.localId | 0;
  const extra = spec?.shareWith ?? [];
  const ids = new Set();
  for (let i = 0; i < extra.length; i++) {
    const id = extra[i] | 0;
    if (id >= 0 && id !== local) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * @param {{ index?: number, kind?: string, name?: string }[] | null | undefined} seats
 * @returns {Record<number, string>}
 */
export function namesFromLobbySeats(seats) {
  /** @type {Record<number, string>} */
  const out = {};
  if (!seats) return out;
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (s?.kind !== 'human') continue;
    const name = String(s.name || '').trim();
    if (!name) continue;
    out[s.index | 0] = name;
  }
  return out;
}

/**
 * @param {number} owner
 * @param {Array<number | { owner?: number }> | null | undefined} computers
 */
export function isComputerOwner(owner, computers) {
  const o = owner | 0;
  if (computers?.length) {
    for (let i = 0; i < computers.length; i++) {
      const raw = computers[i];
      const id = (typeof raw === 'number' ? raw : raw?.owner) | 0;
      if (id === o) return true;
    }
    return false;
  }
  return o === AI_OWNER;
}

/**
 * @param {number} owner
 * @param {Record<number, string> | null | undefined} names
 * @param {Array<number | { owner?: number }> | null | undefined} computers
 */
export function observerOwnerName(owner, names, computers) {
  const o = owner | 0;
  const named = names?.[o];
  if (named) return named;
  if (isComputerOwner(o, computers)) return 'Auto';
  return `P${o}`;
}

/**
 * @param {HTMLElement | null} [host]
 */
export function createObserverData(host) {
  const root = host || document.getElementById('observer-data');
  /** @type {Record<string, SVGSVGElement> | null} */
  let icons = null;
  let ready = false;
  /** @type {Map<number, { name: HTMLElement, counts: Record<string, HTMLElement>, pop: HTMLElement }>} */
  const rows = new Map();

  async function mount() {
    if (!root || ready) return ready;
    try {
      icons = await loadPriceIcons();
    } catch (err) {
      console.warn('observer data icons failed', err);
      icons = {};
    }
    ready = true;
    return true;
  }

  /**
   * @param {{
   *   hidden?: boolean,
   *   resources?: number[] | Int32Array | null,
   *   buildings?: object[],
   *   agoras?: object[],
   *   world?: object,
   *   owners?: number[],
   *   names?: Record<number, string>,
   *   computers?: Array<number | { owner?: number }>,
   * }} state
   */
  function paint(state) {
    if (!root) return;
    const owners = state?.hidden ? [] : (state?.owners ?? []);
    if (!owners.length) {
      if (rows.size) {
        root.textContent = '';
        rows.clear();
        root.dataset.sig = '';
      }
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const sig = `${owners.join(',')}|${icons ? 1 : 0}`;
    if (root.dataset.sig !== sig) {
      root.textContent = '';
      rows.clear();
      const header = makeHeader(icons);
      for (let i = 0; i < header.length; i++) root.appendChild(header[i]);
      for (let i = 0; i < owners.length; i++) {
        const rec = makeRow();
        for (let c = 0; c < rec.cells.length; c++) root.appendChild(rec.cells[c]);
        rows.set(owners[i], rec);
      }
      root.dataset.sig = sig;
    }
    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      const rec = rows.get(owner);
      if (!rec) continue;
      const label = observerOwnerName(owner, state.names, state.computers);
      if (rec.name.textContent !== label) rec.name.textContent = label;
      rec.name.style.color = tintCss(ownerTint(owner));
      const bank = ownerResourcesFrom(state.resources, owner);
      for (let k = 0; k < RESOURCE_KINDS.length; k++) {
        const kind = RESOURCE_KINDS[k];
        const el = rec.counts[kind];
        if (!el) continue;
        const next = String(bank[kind] | 0);
        if (el.textContent !== next) el.textContent = next;
      }
      const army = String(state.world ? livingByOwner(state.world, owner) : 0);
      if (rec.pop.textContent !== army) rec.pop.textContent = army;
    }
  }

  return { mount, paint, get ready() { return ready; } };
}

/** @param {Record<string, SVGSVGElement> | null} icons */
function makeHeader(icons) {
  const cells = [document.createElement('span'), document.createElement('span')];
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const cell = document.createElement('span');
    const src = icons?.[RESOURCE_KINDS[i]];
    if (src) {
      const icon = src.cloneNode(true);
      icon.style.height = '1em';
      icon.style.width = 'auto';
      cell.appendChild(icon);
    }
    cells.push(cell);
  }
  return cells;
}

function makeRow() {
  const pop = document.createElement('span');
  pop.style.justifySelf = 'end';
  const name = document.createElement('span');
  name.style.justifySelf = 'start';
  /** @type {Record<string, HTMLElement>} */
  const counts = {};
  const cells = [pop, name];
  for (let i = 0; i < RESOURCE_KINDS.length; i++) {
    const n = document.createElement('span');
    counts[RESOURCE_KINDS[i]] = n;
    cells.push(n);
  }
  return { cells, name, counts, pop };
}
