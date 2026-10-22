const DEV_SUFFIX = '-dev';

function currentLocation() {
  return typeof globalThis.location === 'object' ? globalThis.location : null;
}

/**
 * Local HTTP builds must never discover or join production peers.
 * Production is the HTTPS aether.garden deployment; loopback and any HTTP
 * development server use a separate namespace.
 */
export function isLocalNetworkEnvironment(loc = currentLocation()) {
  if (!loc) return false;
  const hostname = String(loc.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return loc.protocol === 'http:'
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1';
}

/** Scope every discovery, broadcast, and match-lobby channel the same way. */
export function networkChannel(base, loc = currentLocation()) {
  return `${base}${isLocalNetworkEnvironment(loc) ? DEV_SUFFIX : ''}`;
}
