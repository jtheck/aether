// Bottom-left HUD column. The chat entry is the anchor; replay (when showing)
// sits above it, and the minimized match lobby sits above that.
// Heights are occupied pixels. 0 means that piece is hidden.

export const CORNER_LEFT = 12;
export const CORNER_BOTTOM = 40;
export const CORNER_GAP = 8;

/**
 * @param {{ chat?: number, replay?: number, lobby?: boolean }} [heights]
 * @returns {{ chat: number, replay: number, lobby: number }}
 *   CSS `bottom` offsets in px. `lobby` is the dock offset even when the
 *   lobby is centered; only the parked rule reads it.
 */
export function cornerStackBottoms({ chat = 0, replay = 0, lobby = false } = {}) {
  const chatH = Math.max(0, Number(chat) || 0);
  const replayH = Math.max(0, Number(replay) || 0);
  let stacked = chatH;
  const replayBottom = CORNER_BOTTOM + stacked + (stacked > 0 && replayH > 0 ? CORNER_GAP : 0);
  if (replayH > 0) stacked = (replayBottom - CORNER_BOTTOM) + replayH;
  const lobbyBottom = CORNER_BOTTOM + stacked + (lobby && stacked > 0 ? CORNER_GAP : 0);
  return { chat: CORNER_BOTTOM, replay: replayBottom, lobby: lobbyBottom };
}

/**
 * How high the floating chat log should clear the column.
 * @param {{ chat?: number, replay?: number, lobby?: number, lobbyOn?: boolean }} [box]
 */
export function chatLogClearance({ chat = 0, replay = 0, lobby = 0, lobbyOn = false } = {}) {
  const chatH = Math.max(0, Number(chat) || 0);
  const replayH = Math.max(0, Number(replay) || 0);
  const lobbyH = Math.max(0, Number(lobby) || 0);
  const stack = cornerStackBottoms({ chat: chatH, replay: replayH, lobby: lobbyOn });
  let top = CORNER_BOTTOM;
  if (chatH > 0) top = stack.chat + chatH;
  if (replayH > 0) top = stack.replay + replayH;
  if (lobbyOn && lobbyH > 0) top = stack.lobby + lobbyH;
  return top + CORNER_GAP;
}

function boxHeight(el) {
  if (!el || el.hidden) return 0;
  const h = el.getBoundingClientRect?.().height;
  return h > 0 ? h : 0;
}

/**
 * Measure the live column and publish the offsets the CSS reads.
 * @param {Document} [doc]
 */
export function publishCornerStack(doc = document) {
  const chat = doc.getElementById('chat-hud');
  const replay = doc.getElementById('replay-watch');
  const lobby = doc.getElementById('match-lobby-overlay');
  const chatH = boxHeight(chat);
  const replayH = boxHeight(replay);
  const lobbyOn = Boolean(lobby && !lobby.hidden && lobby.classList.contains('is-parked'));
  const lobbyH = lobbyOn ? boxHeight(lobby) : 0;
  const stack = cornerStackBottoms({ chat: chatH, replay: replayH, lobby: lobbyOn });
  const root = doc.documentElement;
  root.style.setProperty('--corner-left', `${CORNER_LEFT}px`);
  root.style.setProperty('--corner-bottom', `${CORNER_BOTTOM}px`);
  root.style.setProperty('--replay-bottom', `${stack.replay}px`);
  root.style.setProperty('--lobby-bottom', `${stack.lobby}px`);
  root.style.setProperty('--chat-log-bottom', `${chatLogClearance({
    chat: chatH,
    replay: replayH,
    lobby: lobbyH,
    lobbyOn,
  })}px`);
  return stack;
}

let watching = false;

/** Keep the column stacked as chat, replay, and the lobby show, hide, and resize. */
export function watchCornerStack() {
  if (watching || typeof document === 'undefined' || !document.body) return;
  watching = true;
  const seen = new WeakSet();
  const ro = new ResizeObserver(() => publishCornerStack());
  function attach() {
    for (const id of ['chat-hud', 'replay-watch', 'match-lobby-overlay']) {
      const el = document.getElementById(id);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      ro.observe(el);
      mo.observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
  }
  const mo = new MutationObserver(() => {
    attach();
    publishCornerStack();
  });
  mo.observe(document.body, { childList: true });
  attach();
  publishCornerStack();
  window.addEventListener('resize', () => publishCornerStack());
}
