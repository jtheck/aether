// Match chat HUD. Composer stays bottom-left; the log floats above it, farther
// into the view, with no panel behind the lines. Sends on the persistent lobby
// socket. Works in the waiting room and during a live match; players and
// spectators share the room. Story lines (adventure speech) are painted into
// the same log locally — they are not sent on the socket.
// Send appends locally so a line shows in the log without waiting for the
// socket echo.
//
// Tap-driven so mobile works without a hardware keyboard: a Chat button opens
// the composer (input + Send); desktop can also press Enter as a shortcut.
//
// `resolveChat()` returns the currently-active chat surface, or null when the
// player is not in a networked room:
//   { active: boolean, send: (text) => boolean, log: () => Array }

import { CHAT_MAX_LEN } from '../lobby/chat.js';

/** How long a line stays fully visible before it starts fading. */
export const CHAT_LINE_HOLD_MS = 9000;
/** Opacity fade after the hold. */
export const CHAT_LINE_FADE_MS = 1400;
/** How long faded lines stay up after the text entry is clicked. */
export const CHAT_LINE_REVEAL_MS = 8000;

/**
 * @param {number} ageMs
 * @param {boolean} revealing
 * @returns {'shown' | 'fading' | 'gone'}
 */
export function chatLinePhase(ageMs, revealing) {
  if (revealing) return 'shown';
  const age = Math.max(0, Number(ageMs) || 0);
  if (age < CHAT_LINE_HOLD_MS) return 'shown';
  if (age < CHAT_LINE_HOLD_MS + CHAT_LINE_FADE_MS) return 'fading';
  return 'gone';
}

const STYLE_ID = 'chat-hud-style';
const CSS = `
#chat-hud { position: fixed; left: 12px; bottom: 40px; z-index: 10001;
  width: min(320px, 70vw); display: flex; flex-direction: column;
  align-items: flex-start; gap: 4px; font-size: 13px; pointer-events: none;
  user-select: none; -webkit-user-select: none; }
#chat-hud[hidden] { display: none; }
#chat-hud .chat-log { position: fixed; left: min(160px, 18vw); bottom: min(240px, 28vh);
  display: flex; flex-direction: column; justify-content: flex-end; gap: 2px;
  width: max-content; max-width: min(520px, 56vw); max-height: 40vh; overflow: hidden;
  padding: 0; background: none; pointer-events: none; user-select: none;
  -webkit-user-select: none; }
#chat-hud .chat-log:empty { display: none; }
#chat-hud .chat-row { word-break: break-word; line-height: 1.35; opacity: 1;
  transition: opacity 0.35s ease;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.75);
  user-select: none; -webkit-user-select: none; }
#chat-hud .chat-row.is-leaving { opacity: 0; transition: opacity ${CHAT_LINE_FADE_MS}ms linear; }
#chat-hud .chat-row.is-faded { display: none; }
#chat-hud .chat-name { font-weight: 600; margin-right: 4px; }
#chat-hud .chat-you .chat-name::after { content: ' (you)'; opacity: .55;
  font-weight: 400; }
#chat-hud .chat-btn { pointer-events: auto; box-sizing: border-box;
  padding: 6px 12px; border-radius: 6px; color: #fff; cursor: pointer;
  background: rgba(12, 15, 20, 0.7); border: 1px solid #2a3140;
  font-size: 13px; line-height: 1; }
#chat-hud .chat-btn:hover { border-color: aqua; color: aqua; }
#chat-hud .chat-composer { display: flex; align-self: stretch; gap: 6px;
  max-height: 0; opacity: 0; overflow: hidden; pointer-events: none; }
#chat-hud.is-open .chat-composer { max-height: 48px; opacity: 1; pointer-events: auto;
  transition: max-height 0.18s ease, opacity 0.18s ease; }
#chat-hud.is-open .chat-toggle { display: none; }
#chat-hud.chat-local .chat-composer { display: none; }
#chat-hud .chat-narration { font-style: italic; color: #f3ead2; }
#chat-hud .chat-input { pointer-events: auto; box-sizing: border-box; flex: 1;
  min-width: 0; padding: 6px 8px; border-radius: 6px; color: #fff;
  background: rgba(12, 15, 20, 0.7); border: 1px solid #2a3140;
  user-select: text; -webkit-user-select: text; }
#chat-hud .chat-input:focus { outline: none; border-color: aqua; }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * @param {object} opts
 * @param {() => ({ active: boolean, send: (t: string) => boolean, log: () => object[] } | null)} opts.resolveChat
 * @param {() => string | null} [opts.getUserId]
 */
export function setupChatHud({ resolveChat, getUserId } = {}) {
  if (typeof document === 'undefined' || typeof resolveChat !== 'function') {
    return { refresh() {}, noteStory() {}, clearStory() {} };
  }
  ensureStyle();

  const root = document.createElement('div');
  root.id = 'chat-hud';
  root.hidden = true;

  const logEl = document.createElement('div');
  logEl.className = 'chat-log';
  logEl.setAttribute('role', 'log');
  logEl.setAttribute('aria-live', 'polite');
  logEl.addEventListener('selectstart', (e) => e.preventDefault());

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'chat-btn chat-toggle';
  toggle.textContent = 'Chat';
  toggle.setAttribute('aria-label', 'Open chat');

  const composer = document.createElement('div');
  composer.className = 'chat-composer';
  const input = document.createElement('input');
  input.className = 'chat-input';
  input.type = 'text';
  input.maxLength = CHAT_MAX_LEN;
  input.placeholder = 'Message…';
  input.setAttribute('aria-label', 'Chat message');
  input.enterKeyHint = 'send';
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'chat-btn chat-send';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send chat message');
  composer.append(input, sendBtn);

  root.append(logEl, composer, toggle);
  document.body.append(root);

  const rendered = new Set();
  let open = false;
  /** Local story lines. Not part of the networked room log. */
  const storyLog = [];
  const storySeen = new Set();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const fadeTimers = new Map();
  let revealUntil = 0;
  let revealTimer = 0;

  function revealing() {
    return Date.now() < revealUntil;
  }

  function clearFadeTimer(id) {
    const timer = fadeTimers.get(id);
    if (timer) clearTimeout(timer);
    fadeTimers.delete(id);
  }

  function beginFade(row) {
    if (!row?.isConnected || revealing()) return;
    row.classList.add('is-leaving');
    const id = row.dataset.id;
    if (!id) return;
    clearFadeTimer(id);
    fadeTimers.set(id, setTimeout(() => {
      if (!row.isConnected || revealing() || !row.classList.contains('is-leaving')) return;
      row.classList.add('is-faded');
    }, CHAT_LINE_FADE_MS + 40));
  }

  function armFade(row) {
    const id = row.dataset.id;
    if (!id) return;
    clearFadeTimer(id);
    const ts = Number(row.dataset.ts) || Date.now();
    const delay = Math.max(0, ts + CHAT_LINE_HOLD_MS - Date.now());
    fadeTimers.set(id, setTimeout(() => beginFade(row), delay));
  }

  function settleRow(row) {
    const ts = Number(row.dataset.ts) || Date.now();
    const phase = chatLinePhase(Date.now() - ts, revealing());
    if (phase === 'shown') {
      row.classList.remove('is-faded', 'is-leaving');
      if (!revealing()) armFade(row);
      return;
    }
    row.classList.add('is-leaving', 'is-faded');
  }

  function endReveal() {
    if (revealing()) return;
    for (const row of logEl.children) {
      const ts = Number(row.dataset.ts) || Date.now();
      if (chatLinePhase(Date.now() - ts, false) === 'shown') armFade(row);
      else beginFade(row);
    }
  }

  function revealHistory() {
    revealUntil = Date.now() + CHAT_LINE_REVEAL_MS;
    const revive = [];
    for (const row of logEl.children) {
      clearFadeTimer(row.dataset.id);
      if (!row.classList.contains('is-faded') && !row.classList.contains('is-leaving')) continue;
      row.classList.remove('is-faded');
      row.classList.add('is-leaving');
      revive.push(row);
    }
    if (revive.length) {
      // Paint the hidden lines at opacity 0, then fade them in on the next frame.
      void logEl.offsetWidth;
      requestAnimationFrame(() => {
        if (!revealing()) return;
        for (const row of revive) row.classList.remove('is-leaving');
      });
    }
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealUntil = 0;
      endReveal();
    }, CHAT_LINE_REVEAL_MS);
  }

  function setOpen(next) {
    open = Boolean(next);
    root.classList.toggle('is-open', open);
    if (open) {
      revealHistory();
      input.focus();
    } else if (document.activeElement === input) {
      input.blur();
    }
  }

  function renderLog(messages) {
    const localId = getUserId?.() ?? null;
    const keep = new Set(messages.map((m) => m.id));
    for (const child of [...logEl.children]) {
      if (!keep.has(child.dataset.id)) {
        rendered.delete(child.dataset.id);
        clearFadeTimer(child.dataset.id);
        child.remove();
      }
    }
    for (const msg of messages) {
      if (rendered.has(msg.id)) continue;
      rendered.add(msg.id);
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.dataset.id = msg.id;
      row.dataset.ts = String(msg.ts || Date.now());
      row.addEventListener('transitionend', (e) => {
        if (e.propertyName !== 'opacity' || e.target !== row) return;
        if (!row.classList.contains('is-leaving') || revealing()) return;
        row.classList.add('is-faded');
      });
      settleRow(row);
      if (msg.narration) row.classList.add('chat-narration');
      else if (localId && msg.from && String(msg.from) === String(localId)) {
        row.classList.add('chat-you');
      }
      if (!msg.narration) {
        const name = document.createElement('span');
        name.className = 'chat-name';
        name.textContent = `${msg.name || 'Player'}:`;
        if (msg.color) name.style.color = msg.color;
        row.append(name);
      }
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = msg.text;
      row.append(text);
      logEl.append(row);
    }
  }

  function networkChat() {
    const chat = resolveChat();
    return chat?.active ? chat : null;
  }

  function visibleMessages(chat) {
    const messages = [];
    if (storyLog.length) messages.push(...storyLog);
    if (chat) messages.push(...(chat.log() ?? []));
    messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return messages;
  }

  function noteStory(lines) {
    if (!Array.isArray(lines) || !lines.length) return;
    let added = false;
    const now = Date.now();
    for (const line of lines) {
      const name = String(line?.name || line?.speaker || '').trim();
      const text = String(line?.text || '').trim();
      const narration = Boolean(line?.narration) || !name;
      if (!text || (!name && !line?.narration)) continue;
      const rawId = String(line.id || `${name}:${text}`);
      const id = rawId.startsWith('story:') ? rawId : `story:${rawId}`;
      if (storySeen.has(id)) continue;
      storySeen.add(id);
      storyLog.push({
        id,
        from: null,
        name,
        narration,
        color: narration ? '' : (typeof line.color === 'string' ? line.color : '#fc4'),
        text,
        ts: now,
      });
      added = true;
      while (storyLog.length > 100) {
        const dropped = storyLog.shift();
        if (dropped) storySeen.delete(dropped.id);
      }
    }
    if (added) refresh();
  }

  function clearStory() {
    if (!storyLog.length && !storySeen.size) return;
    storyLog.length = 0;
    storySeen.clear();
    refresh();
  }

  function refresh() {
    const chat = networkChat();
    const active = Boolean(chat);
    root.classList.toggle('chat-local', !active);
    const show = active || storyLog.length > 0;
    if (root.hidden === show) root.hidden = !show;
    if (!active && open) setOpen(false);
    if (!show) return;
    renderLog(visibleMessages(chat));
  }

  function trySend() {
    const chat = resolveChat();
    const text = input.value;
    if (!chat?.active || !text.trim()) {
      setOpen(false);
      return false;
    }
    if (!chat.send(text)) return false;
    input.value = '';
    setOpen(false);
    refresh();
    return true;
  }

  toggle.addEventListener('click', () => {
    if (root.classList.contains('chat-local')) {
      revealHistory();
      return;
    }
    setOpen(true);
  });
  input.addEventListener('pointerdown', () => revealHistory());
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!open) return;
      const next = document.activeElement;
      if (next === input || next === sendBtn) return;
      setOpen(false);
    }, 0);
  });
  sendBtn.addEventListener('click', () => {
    if (!trySend()) input.focus();
  });

  input.addEventListener('keydown', (e) => {
    // Keep gameplay hotkeys from firing while composing a message.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      trySend();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      setOpen(false);
    }
  });

  // Press Enter anywhere (when not already typing) to jump into chat — desktop
  // shortcut that complements the on-screen button used on touch devices.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || root.hidden || root.classList.contains('chat-local')) return;
    if (isTypingTarget(e.target) || e.target === input) return;
    e.preventDefault();
    setOpen(true);
  });

  refresh();
  return { refresh, noteStory, clearStory };
}
