// Cosmetic DLC packs — render-only. Sim unit ids never change.
// Steam App IDs unlock packs; GLBs live on the CDN like every other model.

import { UNIT, UNIT_DEFS, getUnitDef } from '../sim/unitTypes.js';
import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import { VAT_UNIT_DEFS } from '../render/vatUnits.js';

export const DLC_FIRST_RESPONDER = 'first_responder';
export const DLC_FIRST_RESPONDER_APP_ID = 5217980;

/** @typedef {{ url: string, scale?: number, idleClip?: string, walkClip?: string, carryClip?: string, chopClip?: string }} DlcSkin */

/** @type {Readonly<Record<string, { steamAppId: number, name: string, skins: Record<number, DlcSkin> }>>} */
export const DLC_PACKS = {
  [DLC_FIRST_RESPONDER]: {
    steamAppId: DLC_FIRST_RESPONDER_APP_ID,
    name: 'First Responder',
    skins: {
      [UNIT.PRIEST]: { url: '/assets/models/dlc/first_responder/priest-DLC1.glb' },
    },
  },
};

/** Settings / wire value for the base mesh. */
export const DEFAULT_SKIN_ID = '';

/** Catalog order — first owned pack wins when two override the same unit. */
export const DLC_PACK_ORDER = Object.freeze([DLC_FIRST_RESPONDER]);

/** HUD / radial icons: typeId → pack id for the local player. */
let hudSkins = {};

export function setLocalHudSkins(skins) {
  hudSkins = sanitizeSkins(skins);
}

export function localHudSkin(typeId) {
  return hudSkins[typeId] ?? hudSkins[String(typeId)] ?? null;
}

/** @deprecated use localHudSkin(typeId) */
export function localHudPack() {
  return hudSkins[UNIT.PRIEST] ?? Object.values(hudSkins)[0] ?? null;
}

export function isDlcPackId(id) {
  return typeof id === 'string' && id in DLC_PACKS;
}

/** `?dlc=` is a local art hook — ignored on aether.garden / any non-loopback host. */
export function isLocalDlcHost(hostname) {
  const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function pageHostname() {
  return typeof location !== 'undefined' ? location.hostname : '';
}

function pageSearch() {
  return typeof location !== 'undefined' ? location.search : '';
}

/**
 * @param {string} [search]
 * @param {string} [hostname]
 */
export function queryDlcPacks(search = pageSearch(), hostname = pageHostname()) {
  if (!isLocalDlcHost(hostname)) return [];
  const raw = new URLSearchParams(search).get('dlc');
  if (!raw) return [];
  if (raw === '1' || raw === 'all' || raw === 'true') return [...DLC_PACK_ORDER];
  return raw.split(',').map((s) => s.trim()).filter(isDlcPackId);
}

/**
 * @param {string[]} [steamPacks]
 * @param {string} [search]
 * @param {string} [hostname]
 * @returns {string[]}
 */
export function localOwnedPacks(steamPacks = [], search = pageSearch(), hostname = pageHostname()) {
  const fromQuery = queryDlcPacks(search, hostname);
  if (fromQuery.length) return fromQuery;
  return (steamPacks ?? []).filter(isDlcPackId);
}

/** @param {string[]} ownedPacks */
export function activePackId(ownedPacks) {
  for (const id of DLC_PACK_ORDER) {
    if (ownedPacks?.includes(id)) return id;
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {Record<number, string>}
 */
export function sanitizeSkins(raw) {
  /** @type {Record<number, string>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const typeId = Number(key);
    if (!Number.isInteger(typeId)) continue;
    if (value === DEFAULT_SKIN_ID || value === 'default') {
      out[typeId] = DEFAULT_SKIN_ID;
      continue;
    }
    if (typeof value === 'string' && isDlcPackId(value) && DLC_PACKS[value].skins[typeId]) {
      out[typeId] = value;
    }
  }
  return out;
}

/**
 * Unlocked looks for one unit. Always includes Default; extra entries are owned packs.
 * @param {number} typeId
 * @param {string[]} [ownedPacks]
 */
export function skinChoicesForUnit(typeId, ownedPacks = []) {
  const choices = [{ id: DEFAULT_SKIN_ID, label: 'Default' }];
  for (const packId of DLC_PACK_ORDER) {
    if (!ownedPacks.includes(packId)) continue;
    if (!DLC_PACKS[packId]?.skins?.[typeId]) continue;
    choices.push({ id: packId, label: DLC_PACKS[packId].name || packId });
  }
  return choices;
}

/** @param {string[]} [ownedPacks] */
export function unitsWithUnlockedSkins(ownedPacks = []) {
  const ids = [];
  for (const def of UNIT_DEFS) {
    if (skinChoicesForUnit(def.id, ownedPacks).length > 1) ids.push(def.id);
  }
  return ids;
}

/**
 * Per-unit pack ids to render. Missing saved key → first owned pack for that unit.
 * Explicit Default (`''`) stays on the base mesh.
 * @param {string[]} [ownedPacks]
 * @param {Record<number, string> | object} [saved]
 * @returns {Record<number, string>}
 */
export function selectedSkins(ownedPacks = [], saved = {}) {
  const owned = (ownedPacks ?? []).filter(isDlcPackId);
  const prefs = sanitizeSkins(saved);
  /** @type {Record<number, string>} */
  const out = {};
  for (const typeId of unitsWithUnlockedSkins(owned)) {
    if (Object.prototype.hasOwnProperty.call(prefs, typeId)) {
      const pick = prefs[typeId];
      if (pick && owned.includes(pick)) out[typeId] = pick;
      continue;
    }
    const first = DLC_PACK_ORDER.find((id) => owned.includes(id) && DLC_PACKS[id].skins[typeId]);
    if (first) out[typeId] = first;
  }
  return out;
}

/** @param {Record<number, string> | null | undefined} skins @param {number} typeId */
export function packForUnit(skins, typeId) {
  if (!skins) return null;
  const pack = skins[typeId] ?? skins[String(typeId)];
  return pack || null;
}

/**
 * @param {{ kind?: string, index?: number, dlc?: string[], skins?: object }[]} [seats]
 * @returns {Record<number, Record<number, string>>}
 */
export function ownerSkinsFromSeats(seats) {
  /** @type {Record<number, Record<number, string>>} */
  const out = {};
  for (const s of seats ?? []) {
    if (s?.kind !== 'human') continue;
    let skins = sanitizeSkins(s.skins);
    const sentSkins = s.skins && typeof s.skins === 'object' && !Array.isArray(s.skins);
    if (!sentSkins && Array.isArray(s.dlc) && s.dlc.length) {
      skins = selectedSkins(s.dlc.filter(isDlcPackId), {});
    }
    if (Object.keys(skins).length) out[s.index | 0] = skins;
  }
  return out;
}

/** @deprecated ownerSkinsFromSeats — first pack only */
export function ownerPacksFromSeats(seats) {
  /** @type {Record<number, string>} */
  const out = {};
  for (const [owner, skins] of Object.entries(ownerSkinsFromSeats(seats))) {
    const pack = Object.values(skins)[0];
    if (pack) out[Number(owner)] = pack;
  }
  return out;
}

/**
 * @param {{ userId?: string | null, state?: string, playerId?: number }[]} roster
 * @param {Map<string, Record<number, string>> | Record<string, Record<number, string>>} userSkins
 * @returns {Record<number, Record<number, string>>}
 */
export function ownerSkinsFromRoster(roster, userSkins) {
  /** @type {Record<number, Record<number, string>>} */
  const out = {};
  const lookup = userSkins instanceof Map
    ? (id) => userSkins.get(id)
    : (id) => userSkins?.[id];
  for (const s of roster ?? []) {
    if (s?.state !== 'active' || !s.userId) continue;
    const skins = sanitizeSkins(lookup(s.userId));
    if (Object.keys(skins).length) out[s.playerId | 0] = skins;
  }
  return out;
}

/** @deprecated ownerSkinsFromRoster */
export function ownerPacksFromRoster(roster, userDlc) {
  /** @type {Map<string, Record<number, string>>} */
  const mapped = new Map();
  if (userDlc instanceof Map) {
    for (const [id, value] of userDlc) {
      mapped.set(id, Array.isArray(value) ? selectedSkins(value, {}) : sanitizeSkins(value));
    }
  } else {
    for (const [id, value] of Object.entries(userDlc ?? {})) {
      mapped.set(id, Array.isArray(value) ? selectedSkins(value, {}) : sanitizeSkins(value));
    }
  }
  return ownerSkinsFromRoster(roster, mapped);
}

export function unitSkinLabel(typeId) {
  return getUnitDef(typeId)?.name ?? `Unit ${typeId}`;
}

/**
 * Map Steam /info.dlc rows onto catalog pack ids.
 * @param {{ appId?: number, owned?: boolean, available?: boolean }[]} [dlcList]
 */
export function packsOwnedFromSteamDlc(dlcList) {
  const ownedAppIds = new Set();
  for (const row of dlcList ?? []) {
    const appId = Number(row?.appId);
    if (!Number.isFinite(appId)) continue;
    if (row.owned || row.available) ownedAppIds.add(appId);
  }
  const out = [];
  for (const id of DLC_PACK_ORDER) {
    const pack = DLC_PACKS[id];
    if (pack && ownedAppIds.has(pack.steamAppId)) out.push(id);
  }
  return out;
}

/** @param {number} typeId @param {string | null | undefined} packId */
export function resolveUnitModelUrl(typeId, packId) {
  const override = packId ? DLC_PACKS[packId]?.skins?.[typeId]?.url : null;
  return override ?? UNIT_MODEL_URLS[typeId] ?? VAT_UNIT_DEFS[typeId]?.url ?? null;
}

/** @param {number} typeId @param {string | null | undefined} packId */
export function resolveVatDef(typeId, packId) {
  const base = VAT_UNIT_DEFS[typeId];
  const skin = packId ? DLC_PACKS[packId]?.skins?.[typeId] : null;
  if (!base) return null;
  if (!skin) return base;
  return {
    ...base,
    url: skin.url ?? base.url,
    scale: skin.scale ?? base.scale,
    idleClip: skin.idleClip ?? base.idleClip,
    walkClip: skin.walkClip ?? base.walkClip,
    carryClip: skin.carryClip ?? base.carryClip,
    chopClip: skin.chopClip ?? base.chopClip,
  };
}

/** Static DLC GLBs for prebake / roster warm. */
export function allDlcMeshUrls() {
  const urls = [];
  for (const pack of Object.values(DLC_PACKS)) {
    for (const skin of Object.values(pack.skins)) {
      if (skin.url && !skin.idleClip) urls.push(skin.url);
    }
  }
  return urls;
}

/** VAT DLC defs for prebake (none in First Responder yet). */
export function allDlcVatDefs() {
  const defs = [];
  for (const pack of Object.values(DLC_PACKS)) {
    for (const skin of Object.values(pack.skins)) {
      if (!skin.url || !skin.idleClip) continue;
      defs.push({
        url: skin.url,
        idleClip: skin.idleClip,
        walkClip: skin.walkClip,
        carryClip: skin.carryClip,
        chopClip: skin.chopClip,
      });
    }
  }
  return defs;
}

/** Steam worker known App IDs (keep in sync with DLC_PACKS). */
export function allDlcSteamAppIds() {
  return DLC_PACK_ORDER.map((id) => DLC_PACKS[id].steamAppId);
}
