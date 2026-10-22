// Play handoff for a Forge map. The opened tab does not inherit sessionStorage
// (COOP same-origin gives it a fresh one), so the garden is also written to
// localStorage when it fits and always to IndexedDB. The match reads the first
// copy it can see.

import { GARDEN_SESSION_KEY } from '../sim/garden.js';

const DB_NAME = 'aeg';
const STORE = 'garden';
const DB_VERSION = 1;

/** Session value when the garden itself is in IndexedDB. */
export const GARDEN_OVERFLOW_MARK = 'idb';

/** Campaign bundle (index + gardens) for web play. Always stored in IndexedDB. */
export const CAMPAIGN_PACK_KEY = 'aeg.campaign';

/** Tiny localStorage stamp so a new tab can tell a fresh IndexedDB write from a stale one. */
const GARDEN_GEN_KEY = 'aeg.garden.gen';

export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError'
    || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || err?.code === 22;
}

export function isGardenOverflowMark(stored) {
  return stored === GARDEN_OVERFLOW_MARK;
}

function storageFrom(opts) {
  if (opts.storage !== undefined) return opts.storage;
  return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
}

/**
 * Put the garden in sessionStorage, or leave a short mark when it does not fit.
 * The mark replaces any previous garden so a new tab does not replay a stale map.
 * @param {string} json
 * @param {{ storage?: Storage | null }} [opts]
 * @returns {'session' | 'overflow'}
 */
export function stageSessionGarden(json, opts = {}) {
  const storage = storageFrom(opts);
  if (storage) {
    try {
      storage.setItem(GARDEN_SESSION_KEY, json);
      return 'session';
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      try {
        storage.setItem(GARDEN_SESSION_KEY, GARDEN_OVERFLOW_MARK);
      } catch {
        try { storage.removeItem(GARDEN_SESSION_KEY); } catch { /* still over quota */ }
      }
    }
  }
  return 'overflow';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * localStorage is shared with the new tab immediately. sessionStorage is not.
 * Returns a generation stamp, or null when localStorage itself is unavailable.
 * The garden body is removed again when it does not fit, so a stale map cannot
 * win over the IndexedDB copy that is about to be written.
 * @param {string} json
 * @returns {string | null}
 */
export function stageLocalGarden(json) {
  if (typeof localStorage === 'undefined') return null;
  let gen = null;
  try {
    gen = String(Date.now());
    localStorage.setItem(GARDEN_GEN_KEY, gen);
  } catch {
    return null;
  }
  try {
    localStorage.setItem(GARDEN_SESSION_KEY, json);
  } catch {
    try { localStorage.removeItem(GARDEN_SESSION_KEY); } catch { /* quota */ }
  }
  return gen;
}

/** @returns {string | null} */
export function readLocalGarden() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(GARDEN_SESSION_KEY);
    if (!stored || isGardenOverflowMark(stored)) return null;
    return stored;
  } catch {
    return null;
  }
}

function readLocalGen() {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(GARDEN_GEN_KEY); } catch { return null; }
}

/**
 * IndexedDB copy of the garden. When a generation stamp is set, wait until the
 * write from this play lands so a previous map is not what the match boots.
 * @param {string} [gen]
 */
export async function writeSessionGarden(json, gen) {
  await writeStoreValue(GARDEN_SESSION_KEY, json);
  if (gen) await writeStoreValue(GARDEN_GEN_KEY, String(gen));
}

/** IndexedDB garden that matches the latest local generation stamp, if any. */
export async function readMatchingSessionGarden() {
  const gen = readLocalGen();
  const deadline = Date.now() + 1000;
  let stored = null;
  for (;;) {
    stored = await readSessionGarden();
    if (!gen) return stored;
    const got = await readStoreValue(GARDEN_GEN_KEY);
    if (stored && got === gen) return stored;
    if (Date.now() >= deadline) return stored;
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function readSessionGarden() {
  return readStoreValue(GARDEN_SESSION_KEY);
}

export async function writeCampaignPack(json) {
  await writeStoreValue(CAMPAIGN_PACK_KEY, json);
}

export async function readCampaignPack() {
  return readStoreValue(CAMPAIGN_PACK_KEY);
}

async function writeStoreValue(key, json) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(String(json), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('garden store aborted'));
    });
  } finally {
    db.close();
  }
}

async function readStoreValue(key) {
  if (typeof indexedDB === 'undefined') return null;
  let db = null;
  try {
    db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * @param {string} json
 * @param {{ storage?: Storage | null, writeOverflow?: (json: string) => Promise<void> }} [opts]
 */
export async function stashSessionGarden(json, opts = {}) {
  if (stageSessionGarden(json, opts) === 'session') return;
  const writeOverflow = opts.writeOverflow || writeSessionGarden;
  await writeOverflow(json);
}
