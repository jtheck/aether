// Shared match-room chat: message shape, sanitisation, and a dedup ring buffer.
// Rides the persistent GetFire lobby socket (matchLobby + kothShard), so it
// reaches players and spectators alike without depending on the WebRTC mesh.

export const CHAT_TYPE = 'chat';
export const CHAT_MAX_LEN = 200;
export const CHAT_NAME_MAX_LEN = 32;
export const CHAT_LOG_LIMIT = 100;
export const CHAT_MIN_INTERVAL_MS = 300;

/** Collapse whitespace, strip control chars, and cap length. */
export function sanitizeChatText(text) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LEN);
}

/**
 * Build a self-describing chat message (name/color travel with it so spectators
 * and late joiners can render without a roster lookup). Returns null if empty.
 * @param {{ from?: string | null, name?: string, color?: string, text: string }} opts
 */
export function makeChatMessage({ from, name, color, text }) {
  const clean = sanitizeChatText(text);
  if (!clean) return null;
  const ts = Date.now();
  return {
    type: CHAT_TYPE,
    from: from ?? null,
    name: String(name ?? '').trim().slice(0, CHAT_NAME_MAX_LEN),
    color: typeof color === 'string' ? color : '',
    text: clean,
    ts,
    id: `${from ?? '?'}:${ts}:${Math.random().toString(36).slice(2, 6)}`,
  };
}

/** @param {any} msg */
export function isChatMessage(msg) {
  return Boolean(msg && msg.type === CHAT_TYPE && typeof msg.text === 'string' && msg.id);
}

/**
 * GetFire lobby `speak` keeps a small field set (type/from/content/…). Put the
 * full chat body in `content` so name/text/id survive the relay.
 * @param {object} msg
 */
export function chatSpeakPayload(msg) {
  return { type: CHAT_TYPE, content: msg };
}

/**
 * Accept a flat chat, a `content`-wrapped speak, stringified content, or a
 * stripped speak that still has `type` + `text`.
 * @param {any} raw
 */
export function unwrapChatMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (isChatMessage(raw)) return raw;
  const nested = raw.content;
  if (nested && typeof nested === 'object' && isChatMessage(nested)) return nested;
  if (typeof nested === 'string') {
    try {
      const parsed = JSON.parse(nested);
      if (isChatMessage(parsed)) return parsed;
    } catch {
      /* not json */
    }
  }
  if (raw.type === CHAT_TYPE && typeof raw.text === 'string') {
    const text = sanitizeChatText(raw.text);
    if (!text) return null;
    return {
      type: CHAT_TYPE,
      from: raw.from ?? null,
      name: raw.name,
      color: raw.color,
      text,
      ts: raw.ts,
      id: raw.id || `${raw.from ?? '?'}:${Number(raw.ts) || 0}:${text}`,
    };
  }
  return null;
}

/** @param {{ add: (raw: object) => boolean }} log @param {any} raw */
export function ingestChat(log, raw) {
  const msg = unwrapChatMessage(raw);
  return Boolean(msg && log.add(msg));
}

/**
 * Ring buffer that ignores duplicates by id (covers ActionCable self-echo and
 * any relay repeats).
 * @param {number} [limit]
 */
export function createChatLog(limit = CHAT_LOG_LIMIT) {
  /** @type {object[]} */
  const items = [];
  const seen = new Set();

  return {
    /** @param {object} raw @returns {boolean} true if newly added */
    add(raw) {
      if (!isChatMessage(raw)) return false;
      if (seen.has(raw.id)) return false;
      const msg = {
        id: raw.id,
        from: raw.from ?? null,
        name: String(raw.name ?? '').trim().slice(0, CHAT_NAME_MAX_LEN) || 'Player',
        color: typeof raw.color === 'string' ? raw.color : '',
        text: sanitizeChatText(raw.text),
        ts: Number(raw.ts) || Date.now(),
      };
      if (!msg.text) return false;
      seen.add(msg.id);
      items.push(msg);
      while (items.length > limit) {
        const dropped = items.shift();
        if (dropped) seen.delete(dropped.id);
      }
      return true;
    },
    list() {
      return items.slice();
    },
    clear() {
      items.length = 0;
      seen.clear();
    },
  };
}
