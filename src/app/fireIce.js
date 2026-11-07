// STUN list for the peer connection. The cable socket does not carry it.
// GET https://getfire.net/api/v1/ice needs no Fire session. The body is
// { v: { iceServers: [{ urls: "stun:…" }] } }. A missing array keeps Google STUN.

export const FIRE_ICE_URL = 'https://getfire.net/api/v1/ice';

/** @returns {RTCIceServer[] | null} The server list, or null when it is missing. */
export function iceServersFromFireBody(body) {
  const list = body?.v?.iceServers;
  return Array.isArray(list) ? list : null;
}

/**
 * Plain GET. Null means the caller should keep its Google STUN defaults.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<RTCIceServer[] | null>}
 */
export async function loadFireIceServers(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(FIRE_ICE_URL, {
      credentials: 'omit',
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(4000)
        : undefined,
    });
    if (!response?.ok) return null;
    return iceServersFromFireBody(await response.json());
  } catch {
    return null;
  }
}
