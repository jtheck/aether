// Match chat HUD. Self-contained overlay (bottom-left) that renders the active
// room's chat log and sends on the persistent lobby socket. Works in the
// waiting room and during a live match; players and spectators share the room.
//
// Tap-driven so mobile works without a hardware keyboard: a Chat button opens
// the composer (input + Send); desktop can also press Enter as a shortcut.
//
// `resolveChat()` returns the currently-active chat surface, or null when the
// player is not in a networked room:
//   { active: boolean, send: (text) => boolean, log: () => Array }

import { CHAT_MAX_LEN } from '../lobby/chat.js';

const STYLE_ID = 'chat-hud-style';
const CSS = `
#chat-hud { position: fixed; left: 12px; bottom: 40px; z-index: 10001;
  width: min(320px, 70vw); display: flex; flex-direction: column;
  align-items: flex-start; gap: 4px; font-size: 13px; pointer-events: none; }
#chat-hud[hidden] { display: none; }
#chat-hud .chat-log { display: flex; flex-direction: column; gap: 2px;
  align-self: stretch; max-height: 30vh; overflow-y: auto; padding: 6px 8px;
  border-radius: 6px; background: rgba(12, 15, 20, 0.55); pointer-events: auto;
  scrollbar-width: thin; }
#chat-hud .chat-log:empty { display: none; }
#chat-hud .chat-row { word-break: break-word; line-height: 1.35;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9); }
#chat-hud .chat-name { font-weight: 600; margin-right: 4px; }
#chat-hud .chat-you .chat-name::after { content: ' (you)'; opacity: .55;
  font-weight: 400; }
#chat-hud .chat-btn { pointer-events: auto; box-sizing: border-box;
  padding: 6px 12px; border-radius: 6px; color: #fff; cursor: pointer;
  background: rgba(12, 15, 20, 0.7); border: 1px solid #2a3140;
  font-size: 13px; line-height: 1; }
#chat-hud .chat-btn:hover { border-color: aqua; color: aqua; }
#chat-hud .chat-composer { display: none; align-self: stretch; gap: 6px; }
#chat-hud.is-open .chat-composer { display: flex; }
#chat-hud.is-open .chat-toggle { display: none; }
#chat-hud .chat-input { pointer-events: auto; box-sizing: border-box; flex: 1;
  min-width: 0; padding: 6px 8px; border-radius: 6px; color: #fff;
  background: rgba(12, 15, 20, 0.7); border: 1px solid #2a3140; }
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
    return { refresh() {} };
  }
  ensureStyle();

  const root = document.createElement('div');
  root.id = 'chat-hud';
  root.hidden = true;

  const logEl = document.createElement('div');
  logEl.className = 'chat-log';
  logEl.setAttribute('role', 'log');
  logEl.setAttribute('aria-live', 'polite');

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

  function setOpen(next) {
    open = Boolean(next);
    root.classList.toggle('is-open', open);
    if (open) {
      input.focus();
    } else if (document.activeElement === input) {
      input.blur();
    }
  }

  function nearBottom() {
    return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  }

  function renderLog(messages) {
    const localId = getUserId?.() ?? null;
    const keep = new Set(messages.map((m) => m.id));
    for (const child of [...logEl.children]) {
      if (!keep.has(child.dataset.id)) {
        rendered.delete(child.dataset.id);
        child.remove();
      }
    }
    const stick = nearBottom();
    for (const msg of messages) {
      if (rendered.has(msg.id)) continue;
      rendered.add(msg.id);
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.dataset.id = msg.id;
      if (localId && msg.from && String(msg.from) === String(localId)) {
        row.classList.add('chat-you');
      }
      const name = document.createElement('span');
      name.className = 'chat-name';
      name.textContent = `${msg.name || 'Player'}:`;
      if (msg.color) name.style.color = msg.color;
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = msg.text;
      row.append(name, text);
      logEl.append(row);
    }
    if (stick) logEl.scrollTop = logEl.scrollHeight;
  }

  function refresh() {
    const chat = resolveChat();
    const active = Boolean(chat?.active);
    if (root.hidden === active) root.hidden = !active;
    if (!active) {
      if (open) setOpen(false);
      return;
    }
    renderLog(chat.log() ?? []);
  }

  function trySend() {
    const chat = resolveChat();
    const text = input.value;
    if (chat?.active && text.trim()) chat.send(text);
    input.value = '';
    // Stay open so mobile users can keep typing without re-tapping.
    refresh();
  }

  toggle.addEventListener('click', () => setOpen(true));
  sendBtn.addEventListener('click', () => {
    trySend();
    input.focus();
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
    if (e.key !== 'Enter' || root.hidden) return;
    if (isTypingTarget(e.target) || e.target === input) return;
    e.preventDefault();
    setOpen(true);
  });

  refresh();
  return { refresh };
}
