// Play handoff for a Forge map. Small gardens stay in sessionStorage so the
// opened tab inherits them. Anything over the quota goes to IndexedDB, which
// the match reads on the same origin.

import { GARDEN_SESSION_KEY } from '../sim/garden.js';

const DB_NAME = 'aeg';
const STORE = 'garden';
const DB_VERSION = 1;

/** Session value when the garden itself is in IndexedDB. */
export const GARDEN_OVERFLOW_MARK = 'idb';

/** Campaign bundle (index + gardens) for web play. Always stored in IndexedDB. */
export const CAMPAIGN_PACK_KEY = 'aeg.campaign';

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

export async function writeSessionGarden(json) {
  await writeStoreValue(GARDEN_SESSION_KEY, json);
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
