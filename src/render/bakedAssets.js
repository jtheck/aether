// Offline bake artifact helpers (VAT dumps, mesh packages, socket tables).
// Files live under /assets/baked/ — produced by `npm run prebake`.

/** @param {string} glbUrl e.g. /assets/models/tavern.glb */
export function bakedMeshStem(glbUrl) {
  const base = glbUrl.split('/').pop() || 'mesh.glb';
  return base.replace(/\.glb$/i, '');
}

/** @param {string} glbUrl */
export function bakedMeshJsonUrl(glbUrl) {
  return `/assets/baked/meshes/${bakedMeshStem(glbUrl)}.json`;
}

/** @param {string} glbUrl */
export function bakedMeshBinUrl(glbUrl) {
  return `/assets/baked/meshes/${bakedMeshStem(glbUrl)}.bin`;
}

/** @param {string} glbUrl */
export function bakedVatJsonUrl(glbUrl) {
  return `/assets/baked/vat/${bakedMeshStem(glbUrl)}.json`;
}

/** @param {string} glbUrl */
export function bakedVatBinUrl(glbUrl) {
  return `/assets/baked/vat/${bakedMeshStem(glbUrl)}.bin`;
}

export const BAKED_SOCKETS_URL = '/assets/baked/sockets.json';
export const BAKED_MANIFEST_URL = '/assets/baked/manifest.json';

/** @type {Promise<{ meshes: Set<string>, vat: Set<string> } | null> | null} */
let manifestPromise = null;

/**
 * Load once: which bake artifacts exist (avoids 404 probes that add black-screen RTT).
 * @returns {Promise<{ meshes: Set<string>, vat: Set<string> } | null>}
 */
export function loadBakedManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const res = await tryFetch(BAKED_MANIFEST_URL);
      if (!res) return null;
      try {
        const data = await res.json();
        return {
          meshes: new Set(data.meshes ?? []),
          vat: new Set(data.vat ?? []),
        };
      } catch {
        return null;
      }
    })();
  }
  return manifestPromise;
}

/** @param {string} glbUrl */
export async function hasBakedMesh(glbUrl) {
  const man = await loadBakedManifest();
  if (!man) return false;
  return man.meshes.has(bakedMeshStem(glbUrl));
}

/** @param {string} glbUrl */
export async function hasBakedVat(glbUrl) {
  const man = await loadBakedManifest();
  if (!man) return false;
  return man.vat.has(bakedMeshStem(glbUrl));
}

/**
 * @param {string} url
 * @returns {Promise<Response | null>}
 */
export async function tryFetch(url) {
  try {
    // no-cache: always revalidate (ETag/304). force-cache stuck returning
    // visitors on old unhashed bake/GLB bytes after deploy — hard-to-kill on mobile.
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ offset: number, length: number }} span
 */
export function float32Slice(buffer, span) {
  return new Float32Array(buffer, span.offset, span.length);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ offset: number, length: number }} span
 */
export function uint32Slice(buffer, span) {
  return new Uint32Array(buffer, span.offset, span.length);
}

/**
 * Pack typed arrays into one ArrayBuffer; returns { buffer, spans }.
 * @param {{ key: string, data: Float32Array | Uint32Array }[]} entries
 */
export function packBinary(entries) {
  let total = 0;
  for (const e of entries) {
    total = align4(total);
    total += e.data.byteLength;
  }
  const buffer = new ArrayBuffer(total);
  const spans = {};
  let offset = 0;
  for (const e of entries) {
    offset = align4(offset);
    const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    new Uint8Array(buffer, offset, bytes.length).set(bytes);
    spans[e.key] = {
      offset,
      length: e.data.length,
      type: e.data instanceof Uint32Array ? 'u32' : 'f32',
    };
    offset += bytes.length;
  }
  return { buffer, spans };
}

function align4(n) {
  return (n + 3) & ~3;
}
