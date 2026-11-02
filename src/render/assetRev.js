// Package fills ASSET_REV with content hashes. Dev leaves it empty, so
// /assets/... paths load as written. A hashed deploy URL is safe to cache.

/** @type {Readonly<Record<string, string>>} */
const ASSET_REV = Object.freeze({});

/**
 * @param {string} path
 * @returns {string}
 */
export function assetUrl(path) {
  if (typeof path !== 'string' || !path) return path;
  const cut = path.search(/[?#]/);
  const clean = cut >= 0 ? path.slice(0, cut) : path;
  const suffix = cut >= 0 ? path.slice(cut) : '';
  const key = clean.startsWith('/assets/')
    ? clean
    : clean.startsWith('assets/')
      ? `/${clean}`
      : null;
  if (!key) return path;
  const rev = ASSET_REV[key];
  if (!rev) return path;
  const out = clean.startsWith('/') ? rev : rev.slice(1);
  return out + suffix;
}

/**
 * Stable paths revalidate. Content-hashed paths use the browser cache.
 * @param {string} url
 * @param {RequestInit} [init]
 */
export function assetFetch(url, init) {
  const resolved = assetUrl(url);
  if (resolved === url) {
    return fetch(resolved, { ...init, cache: 'no-cache' });
  }
  return fetch(resolved, init);
}
