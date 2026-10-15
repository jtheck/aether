// Cosmetic DLC packs — render-only. Sim unit ids never change.
// Steam App IDs unlock packs; GLBs live on the CDN like every other model.

import { UNIT, UNIT_DEFS, getUnitDef } from '../sim/unitTypes.js';
import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import { VAT_UNIT_DEFS } from '../render/vatUnits.js';

export const DLC_FIRST_RESPONDER = 'first_responder';
export const DLC_FIRST_RESPONDER_APP_ID = 5217980;

/** @typedef {{ url?: string, label?: string, scale?: number, idleClip?: string, walkClip?: string, carryClip?: string, chopClip?: string, attackClip?: string }} DlcSkin */

/** Unit skins key by UNIT id. Building skins (church, …) use `buildings`. */
/** @type {Readonly<Record<string, { steamAppId: number, name: string, skins: Record<number, DlcSkin>, buildings?: Record<string, DlcSkin> }>>} */
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

/** @param {number | string} appId */
export function steamStoreUrl(appId) {
  return `https://store.steampowered.com/app/${Number(appId)}/`;
}

/**
 * Looks the skins menu can show. Locked rows stay visible so a browser
 * player can see the pack and the Steam purchase link.
 * @param {string[]} [ownedPacks]
 * @param {Record<number, string> | object} [savedUnits]
 * @param {Record<string, string> | object} [savedBuildings]
 */
export function skinMenuModel(ownedPacks = [], savedUnits = {}, savedBuildings = {}) {
  const owned = (ownedPacks ?? []).filter(isDlcPackId);
  const unitPrefs = sanitizeSkins(savedUnits);
  const buildingPrefs = sanitizeBuildingSkins(savedBuildings);
  const auto = selectedSkins(owned, {});
  /** @type {{ kind: 'unit' | 'building', id: number | string, label: string, unlocked: boolean, choices: { id: string, label: string }[] | null, value: string, offers: { id: string, name: string, storeUrl: string }[] }[]} */
  const items = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const packId of DLC_PACK_ORDER) {
    const pack = DLC_PACKS[packId];
    if (!pack) continue;
    for (const key of Object.keys(pack.skins ?? {})) {
      const typeId = Number(key);
      if (!Number.isInteger(typeId) || !pack.skins[typeId]?.url) continue;
      const dedupe = `unit:${typeId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const choices = skinChoicesForUnit(typeId, owned);
      const unlocked = choices.length > 1;
      items.push({
        kind: 'unit',
        id: typeId,
        label: unitSkinLabel(typeId),
        unlocked,
        choices: unlocked ? choices : null,
        value: unlocked
          ? (Object.prototype.hasOwnProperty.call(unitPrefs, typeId)
            ? unitPrefs[typeId]
            : (auto[typeId] ?? DEFAULT_SKIN_ID))
          : DEFAULT_SKIN_ID,
        offers: offersFor('unit', typeId),
      });
    }
    for (const buildingId of Object.keys(pack.buildings ?? {})) {
      if (!pack.buildings[buildingId]?.url) continue;
      const dedupe = `building:${buildingId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const choices = skinChoicesForBuilding(buildingId, owned);
      const unlocked = choices.length > 1;
      items.push({
        kind: 'building',
        id: buildingId,
        label: pack.buildings[buildingId].label || buildingId,
        unlocked,
        choices: unlocked ? choices : null,
        value: unlocked
          ? (Object.prototype.hasOwnProperty.call(buildingPrefs, buildingId)
            ? (buildingPrefs[buildingId] || DEFAULT_SKIN_ID)
            : (choices[1]?.id ?? DEFAULT_SKIN_ID))
          : DEFAULT_SKIN_ID,
        offers: offersFor('building', buildingId),
      });
    }
  }
  return items;
}

/** @param {'unit' | 'building'} kind @param {number | string} id */
function offersFor(kind, id) {
  const offers = [];
  for (const packId of DLC_PACK_ORDER) {
    const pack = DLC_PACKS[packId];
    const skin = kind === 'unit' ? pack?.skins?.[id] : pack?.buildings?.[id];
    if (!skin?.url) continue;
    offers.push({
      id: packId,
      name: pack.name || packId,
      storeUrl: steamStoreUrl(pack.steamAppId),
    });
  }
  return offers;
}

/**
 * @param {string} buildingId
 * @param {string[]} [ownedPacks]
 */
export function skinChoicesForBuilding(buildingId, ownedPacks = []) {
  const choices = [{ id: DEFAULT_SKIN_ID, label: 'Default' }];
  for (const packId of DLC_PACK_ORDER) {
    if (!ownedPacks.includes(packId)) continue;
    const skin = DLC_PACKS[packId]?.buildings?.[buildingId];
    if (!skin?.url) continue;
    choices.push({ id: packId, label: DLC_PACKS[packId].name || packId });
  }
  return choices;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function sanitizeBuildingSkins(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!key || key.length > 32) continue;
    const defined = DLC_PACK_ORDER.some((id) => DLC_PACKS[id]?.buildings?.[key]?.url);
    if (!defined) continue;
    if (value === DEFAULT_SKIN_ID || value === 'default') {
      out[key] = DEFAULT_SKIN_ID;
      continue;
    }
    if (typeof value === 'string' && isDlcPackId(value) && DLC_PACKS[value].buildings?.[key]?.url) {
      out[key] = value;
    }
  }
  return out;
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
    attackClip: skin.attackClip ?? base.attackClip,
  };
}

function packCosmeticSkins(pack) {
  return [...Object.values(pack?.skins ?? {}), ...Object.values(pack?.buildings ?? {})];
}

/** Static DLC GLBs for prebake / roster warm. */
export function allDlcMeshUrls() {
  const urls = [];
  for (const pack of Object.values(DLC_PACKS)) {
    for (const skin of packCosmeticSkins(pack)) {
      if (skin.url && !skin.idleClip) urls.push(skin.url);
    }
  }
  return urls;
}

/** VAT DLC defs for prebake (none in First Responder yet). */
export function allDlcVatDefs() {
  const defs = [];
  for (const pack of Object.values(DLC_PACKS)) {
    for (const skin of packCosmeticSkins(pack)) {
      if (!skin.url || !skin.idleClip) continue;
      defs.push({
        url: skin.url,
        idleClip: skin.idleClip,
        walkClip: skin.walkClip,
        carryClip: skin.carryClip,
        chopClip: skin.chopClip,
        attackClip: skin.attackClip,
      });
    }
  }
  return defs;
}

/** Steam worker known App IDs (keep in sync with DLC_PACKS). */
export function allDlcSteamAppIds() {
  return DLC_PACK_ORDER.map((id) => DLC_PACKS[id].steamAppId);
}
