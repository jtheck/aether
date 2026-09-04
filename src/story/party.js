// Carry the living adventure party across a garden reset.
// The first four garden units are heroes — dealt to the seated players.

import { normalizeSpeaker } from './cast.js';
import { decodeGarden, patchGarden } from '../sim/garden.js';

export const HERO_COUNT = 4;

const RING = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
  [2, 0], [0, 2], [-2, 0], [0, -2],
];

function offsetTile(tx, tz, i) {
  const [dx, dz] = RING[(i - 1) % RING.length] || [i, 0];
  return { tx: tx + dx, tz: tz + dz };
}

/**
 * Living human-owned units. Named heroes come from garden spawn order (`cast`).
 * @param {{ count?: number, alive?: ArrayLike<number>, type?: ArrayLike<number>, owner?: ArrayLike<number>, hp?: ArrayLike<number> }} world
 * @param {{ name: string, index: number }[]} [cast]
 * @param {Iterable<number> | null} [humanOwners]
 */
export function snapshotParty(world, cast = [], humanOwners = null) {
  const allow = humanOwners ? new Set(humanOwners) : null;
  const nameOf = new Map();
  for (const c of cast) {
    if (c?.name) nameOf.set(c.index | 0, String(c.name));
  }
  const out = [];
  const n = world?.count | 0;
  for (let i = 0; i < n; i++) {
    if (!world.alive?.[i]) continue;
    const owner = world.owner[i] | 0;
    if (allow && !allow.has(owner)) continue;
    const hp = world.hp?.[i] | 0;
    if (hp <= 0) continue;
    out.push({
      name: nameOf.get(i) || '',
      type: world.type[i] | 0,
      owner,
      hp,
    });
  }
  return out;
}

export function mergePartyUnits(gardenUnits, party) {
  const slots = gardenUnits || [];
  const living = (party || []).filter((p) => (p.hp | 0) > 0);
  if (!living.length) return slots.map((u) => ({ ...u }));

  const namedSlots = slots.filter((u) => String(u.name || '').trim());
  const unnamedSlots = slots.filter((u) => !String(u.name || '').trim());
  const byName = new Map();
  const extras = [];
  for (const p of living) {
    const key = normalizeSpeaker(p.name);
    if (key) byName.set(key, p);
    else extras.push(p);
  }

  const nextNamed = [];
  for (const slot of namedSlots) {
    const p = byName.get(normalizeSpeaker(slot.name));
    if (!p) continue;
    nextNamed.push({
      owner: p.owner | 0,
      type: p.type | 0,
      tx: slot.tx | 0,
      tz: slot.tz | 0,
      name: String(slot.name),
      hp: p.hp | 0,
    });
    byName.delete(normalizeSpeaker(slot.name));
  }
  for (const leftover of byName.values()) extras.push(leftover);

  const origin = nextNamed[0] || namedSlots[0] || { tx: 0, tz: 0 };
  const extraUnits = extras.map((p, i) => {
    const at = offsetTile(origin.tx, origin.tz, i + 1);
    return {
      owner: p.owner | 0,
      type: p.type | 0,
      tx: at.tx,
      tz: at.tz,
      name: p.name ? String(p.name) : '',
      hp: p.hp | 0,
    };
  });

  return [...nextNamed, ...unnamedSlots, ...extraUnits];
}

function unitsFromGardenJson(gardenJson) {
  if (Array.isArray(gardenJson.units)) return gardenJson.units;
  try {
    return decodeGarden(gardenJson).units;
  } catch {
    return decodeGarden({
      v: gardenJson.v || 4,
      w: gardenJson.w || 32,
      h: gardenJson.h || 32,
      u: gardenJson.u,
    }).units;
  }
}

export function applyPartyToGarden(gardenJson, party, startingResources = null) {
  if (!gardenJson) return gardenJson;
  const units = mergePartyUnits(unitsFromGardenJson(gardenJson), party);
  return patchGarden(gardenJson, {
    units,
    ...(startingResources ? { startingResources } : {}),
  });
}

export function normalizePlayerIds(playerIds) {
  const ids = [...new Set((playerIds || []).map((id) => id | 0))].sort((a, b) => a - b);
  return ids.length ? ids : [0];
}

/** How many heroes each seated player gets (index matches sorted player list before shuffle). */
export function heroCountsForPlayers(playerCount) {
  const n = Math.max(1, Math.min(HERO_COUNT, playerCount | 0));
  if (n <= 1) return [HERO_COUNT];
  if (n === 2) return [2, 2];
  if (n === 3) return [2, 1, 1];
  return [1, 1, 1, 1];
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Owner per hero slot. Same seed + seats ⇒ same deal on every peer.
 * @param {number} heroCount
 * @param {Iterable<number>} playerIds
 * @param {number} [seed]
 */
export function dealHeroOwners(heroCount, playerIds, seed = 0) {
  const n = Math.max(0, heroCount | 0);
  const players = normalizePlayerIds(playerIds);
  if (!n) return [];
  if (players.length <= 1) return Array(n).fill(players[0] | 0);

  const counts = heroCountsForPlayers(players.length);
  const rng = mulberry32(seed >>> 0);
  const order = shuffleInPlace(players.slice(0, counts.length), rng);
  const seats = [];
  for (let i = 0; i < order.length; i++) {
    for (let k = 0; k < counts[i]; k++) seats.push(order[i]);
  }
  shuffleInPlace(seats, rng);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < seats.length ? seats[i] : players[0]);
  return out;
}

/** Stamp every unit to one owner (solo / local-id remap). */
export function stampUnitOwners(units, owner) {
  const id = owner | 0;
  return (units || []).map((u) => ({ ...u, owner: id }));
}

/** Room seed + garden seed — same on every peer, different each chapter. */
export function adventureDealSeed(matchSeed, mapSeed) {
  return ((matchSeed >>> 0) + Math.imul((mapSeed >>> 0) || 1, 1664525) + 1013904223) >>> 0;
}

function heroIndexes(units) {
  const named = [];
  const fallback = [];
  for (let i = 0; i < units.length; i++) {
    if (String(units[i].name || '').trim()) {
      if (named.length < HERO_COUNT) named.push(i);
    } else if (fallback.length < HERO_COUNT) {
      fallback.push(i);
    }
  }
  return named.length ? named : fallback;
}

/** Living named heroes (else the first four units) get a fresh deal. Extras keep their owner. */
export function assignHeroOwners(units, playerIds, seed = 0) {
  const list = (units || []).map((u) => ({ ...u }));
  const idx = heroIndexes(list);
  const owners = dealHeroOwners(idx.length, playerIds, seed);
  for (let i = 0; i < idx.length; i++) list[idx[i]].owner = owners[i];
  return list;
}

/**
 * Patch an encoded garden so the worker spawns the right owners.
 * Solo: every unit belongs to the one player.
 * 2–4p: shuffle the four heroes every map; extras keep who trained them.
 * Adventure maps do not carry an agora.
 */
export function prepareAdventureGarden(gardenJson, {
  humanPlayers = [0],
  seed = 0,
  party = null,
  bank = null,
} = {}) {
  if (!gardenJson) return gardenJson;
  const players = normalizePlayerIds(humanPlayers);
  let units = unitsFromGardenJson(gardenJson);
  if (party?.length) units = mergePartyUnits(units, party);
  if (players.length <= 1) units = stampUnitOwners(units, players[0]);
  else units = assignHeroOwners(units, players, seed);

  const extras = { units, agoras: [] };
  if (bank) extras.startingResources = bank;
  return patchGarden(gardenJson, extras);
}
