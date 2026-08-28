// Type-channel discovery for 1v1 / Teams / Adventure.

import { sameUserId, senderUserId } from '../lobby/ids.js';
import { getMode, isLobbyMode } from '../lobby/modes.js';
import { ANNOUNCE_TTL_MS, LOBBY_PROTOCOL_VERSION, MSG, typeChannel } from '../lobby/protocol.js';

/**
 * @param {object} opts
 * @param {() => object | null} opts.getP2p
 * @param {(fn: (data: object, raw?: object) => void) => () => void} [opts.subscribeBroadcast]
 * @param {() => void} [opts.onChange]
 */
export function createGameLobby({ getP2p, subscribeBroadcast, onChange } = {}) {
  /** @type {Set<string>} */
  const listening = new Set();
  /** @type {Set<string>} */
  const held = new Set();
  /** @type {Map<string, Map<string, object>>} */
  const lists = new Map();

  function emit() {
    onChange?.();
  }

  function localUserId() {
    return getP2p?.()?.getUserId?.() ?? null;
  }

  function bucket(mode) {
    let map = lists.get(mode);
    if (!map) {
      map = new Map();
      lists.set(mode, map);
    }
    return map;
  }

  function prune(mode, now = Date.now()) {
    const map = lists.get(mode);
    if (!map) return;
    for (const [id, row] of map) {
      if (now - (row.ts ?? 0) > ANNOUNCE_TTL_MS) map.delete(id);
    }
  }

  subscribeBroadcast?.((data) => {
    if (!data || data.v !== LOBBY_PROTOCOL_VERSION) return;
    if (!isLobbyMode(data.mode)) return;
    if (data.type === MSG.ANNOUNCE) {
      if (sameUserId(senderUserId(data) ?? data.from, localUserId())) return;
      if (!data.roomId) return;
      const row = { ...data, ts: Date.now() };
      bucket(data.mode).set(data.roomId, row);
      emit();
      return;
    }
    if (data.type === MSG.CLOSED && data.roomId) {
      lists.get(data.mode)?.delete(data.roomId);
      emit();
    }
  });

  function listen(mode) {
    if (!isLobbyMode(mode)) return;
    const p2p = getP2p?.();
    const channel = typeChannel(mode);
    if (p2p && channel) p2p.joinBroadcast?.(channel);
    listening.add(mode);
    bucket(mode);
    emit();
  }

  function unlisten(mode, { force = false } = {}) {
    if (!force && held.has(mode)) return;
    listening.delete(mode);
    if (!held.has(mode)) {
      const channel = typeChannel(mode);
      if (channel) getP2p?.()?.leaveBroadcast?.(channel);
      lists.delete(mode);
    }
    emit();
  }

  function hold(mode) {
    if (!isLobbyMode(mode)) return;
    held.add(mode);
    if (!listening.has(mode)) listen(mode);
  }

  function release(mode) {
    held.delete(mode);
    if (!listening.has(mode)) unlisten(mode, { force: true });
  }

  function announce(payload) {
    if (!payload?.mode || !isLobbyMode(payload.mode)) return;
    const p2p = getP2p?.();
    const channel = typeChannel(payload.mode);
    if (!p2p?.broadcast || !channel) return;
    hold(payload.mode);
    p2p.broadcast(
      { v: LOBBY_PROTOCOL_VERSION, ...payload, type: payload.type ?? MSG.ANNOUNCE },
      channel,
    );
  }

  function listLobbies(mode) {
    prune(mode);
    const rows = [...(lists.get(mode)?.values() ?? [])];
    rows.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return rows;
  }

  return {
    listen,
    unlisten,
    hold,
    release,
    announce,
    listLobbies,
    isListening: (mode) => listening.has(mode) || held.has(mode),
    getMode: (mode) => getMode(mode),
  };
}
