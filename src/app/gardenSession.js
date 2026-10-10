// Play handoff for a Forge map. Small gardens stay in sessionStorage so the
// opened tab inherits them. Anything over the quota goes to IndexedDB, which
// the match reads on the same origin.

import { GARDEN_SESSION_KEY } from '../sim/garden.js';

const DB_NAME = 'aeg';
const STORE = 'garden';
const DB_VERSION = 1;

export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError'
    || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || err?.code === 22;
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
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(String(json), GARDEN_SESSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('garden store aborted'));
    });
  } finally {
    db.close();
  }
}

export async function readSessionGarden() {
  if (typeof indexedDB === 'undefined') return null;
  let db = null;
  try {
    db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(GARDEN_SESSION_KEY);
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
  const storage = opts.storage === undefined
    ? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
    : opts.storage;
  const writeOverflow = opts.writeOverflow || writeSessionGarden;
  if (storage) {
    try {
      storage.setItem(GARDEN_SESSION_KEY, json);
      return;
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      try { storage.removeItem(GARDEN_SESSION_KEY); } catch { /* still over quota */ }
    }
  }
  await writeOverflow(json);
}
