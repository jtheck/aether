// Side-menu type drawers + center match room + reduced sidebar copy.

import { sameUserId, shortUserId } from '../lobby/ids.js';
import { ADVENTURE_CHAPTERS, FIELD_SIZES, MODE_IDS, getMode } from '../lobby/modes.js';
import { shortRoomId } from '../lobby/protocol.js';

/**
 * @param {object} lobby
 * @returns {{ title: string, meta: string, label: string }}
 */
export function formatTypeLobbyRow(lobby) {
  const title = (lobby.hostName ?? '').trim() || `…${shortRoomId(lobby.roomId)}`;
  const seats = `${lobby.playerCount ?? 0}/${lobby.maxPlayers ?? 0}`;
  const field = lobby.settings?.fieldSize;
  const meta = field ? `${seats}  ·  ${field}` : seats;
  return { title, meta, label: `Join ${title}, ${seats}` };
}

/**
 * @param {object} state
 * @returns {{ title: string, meta: string }}
 */
export function formatMatchStatus(state) {
  const mode = getMode(state.mode);
  const name = (state.hostName ?? '').trim();
  const seats = `${state.playerCount ?? 0}/${state.maxPlayers ?? mode?.maxPlayers ?? 0}`;
  if (state.hosting) return { title: `Your ${mode?.name ?? 'lobby'}`, meta: seats };
  return { title: name ? `In ${name}'s ${mode?.name ?? 'lobby'}` : 'In lobby', meta: seats };
}

/** @param {{ name?: string, userId?: string | null }} seat @param {string | null} localId */
export function formatSeatName(seat, localId) {
  const name = (seat.name || 'Player').trim() || 'Player';
  const tag = shortUserId(seat.userId);
  const you = sameUserId(seat.userId, localId) ? ' (you)' : '';
  return `${name} · ${tag}${you}`;
}

/** @param {number} ms */
export function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s <= 0 ? 'Starting…' : `Starting in ${s}`;
}

/** @param {string} reason */
export function formatStartLabel(can, reason, countdownMs, phase) {
  if (phase === 'playing') return 'In match';
  if (phase === 'starting') return 'Starting…';
  if (phase === 'countdown') return formatCountdown(countdownMs);
  if (!can) return reason || 'Start';
  return 'Start';
}

/**
 * @param {HTMLElement} listEl
 * @param {HTMLElement | null} emptyEl
 * @param {object[]} lobbies
 */
export function syncTypeLobbyList(listEl, emptyEl, lobbies) {
  if (emptyEl) emptyEl.hidden = lobbies.length > 0;
  const keep = new Set(lobbies.map((lobby) => lobby.roomId));
  for (const btn of [...listEl.querySelectorAll('[data-room-id]')]) {
    if (!keep.has(btn.dataset.roomId)) btn.remove();
  }
  for (const lobby of lobbies) {
    const row = formatTypeLobbyRow(lobby);
    let btn = listEl.querySelector(`[data-room-id="${CSS.escape(lobby.roomId)}"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn koth-lobby-row';
      btn.dataset.roomId = lobby.roomId;
      const name = document.createElement('span');
      name.className = 'koth-lobby-name';
      const meta = document.createElement('span');
      meta.className = 'koth-lobby-meta';
      btn.append(name, meta);
      listEl.append(btn);
    }
    if (lobby.from) btn.dataset.from = lobby.from;
    if (btn.getAttribute('aria-label') !== row.label) btn.setAttribute('aria-label', row.label);
    const nameEl = btn.querySelector('.koth-lobby-name');
    const metaEl = btn.querySelector('.koth-lobby-meta');
    if (nameEl && nameEl.textContent !== row.title) nameEl.textContent = row.title;
    if (metaEl && metaEl.textContent !== row.meta) metaEl.textContent = row.meta;
  }
}

function setText(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
}

function setHidden(el, hidden) {
  if (!el || el.hidden === hidden) return;
  el.hidden = hidden;
}

function paintSeats(container, seats, { teams, localId, compact }) {
  if (!container) return;
  const groups = teams
    ? [
      { label: 'Team A', items: seats.filter((s) => s.team === 0) },
      { label: 'Team B', items: seats.filter((s) => s.team === 1) },
    ]
    : [{ label: compact ? '' : 'Players', items: seats }];

  const wanted = groups.length;
  while (container.children.length > wanted) container.lastElementChild?.remove();
  while (container.children.length < wanted) {
    const wrap = document.createElement('div');
    wrap.className = 'lobby-seat-group';
    const title = document.createElement('div');
    title.className = 'lobby-seat-group-title';
    const list = document.createElement('div');
    list.className = 'lobby-seat-list';
    wrap.append(title, list);
    container.append(wrap);
  }

  groups.forEach((group, gi) => {
    const wrap = container.children[gi];
    const title = wrap.querySelector('.lobby-seat-group-title');
    const list = wrap.querySelector('.lobby-seat-list');
    setText(title, group.label);
    setHidden(title, !group.label);
    while (list.children.length > group.items.length) list.lastElementChild?.remove();
    while (list.children.length < group.items.length) {
      const row = document.createElement('div');
      row.className = 'lobby-seat';
      const name = document.createElement('span');
      name.className = 'lobby-seat-name';
      const status = document.createElement('span');
      status.className = 'lobby-seat-status';
      row.append(name, status);
      list.append(row);
    }
    group.items.forEach((seat, i) => {
      const row = list.children[i];
      const nameEl = row.querySelector('.lobby-seat-name');
      const statusEl = row.querySelector('.lobby-seat-status');
      if (seat.kind === 'human') {
        setText(nameEl, formatSeatName(seat, localId));
        if (nameEl) nameEl.style.color = seat.color || '';
        setText(statusEl, seat.ready ? 'Ready' : 'Not ready');
      } else {
        setText(nameEl, 'Waiting…');
        if (nameEl) nameEl.style.color = '';
        setText(statusEl, '');
      }
    });
  });
}

function fillSelect(select, values, current, labelOf = (v) => v) {
  if (!select) return;
  if (select.options.length !== values.length) {
    select.replaceChildren(
      ...values.map((v) => {
        const opt = document.createElement('option');
        opt.value = typeof v === 'string' ? v : v.id;
        opt.textContent = typeof v === 'string' ? labelOf(v) : v.name;
        return opt;
      }),
    );
  }
  if (current != null && select.value !== String(current)) select.value = String(current);
}

/**
 * @param {object} opts
 * @param {object} opts.gameLobby
 * @param {object} opts.matchLobby
 * @param {() => boolean} [opts.isKothLive]
 * @param {() => string | null} [opts.getUserId]
 */
export function setupLobbyUi({ gameLobby, matchLobby, isKothLive, getUserId }) {
  const drawersRoot = document.getElementById('menu-lobbies');
  const sidebar = document.getElementById('menu-match');
  const overlay = document.getElementById('match-lobby-overlay');
  if (!drawersRoot || !gameLobby || !matchLobby) return { refresh() {} };
  drawersRoot.hidden = false;

  const drawers = new Map();
  for (const mode of MODE_IDS) {
    const el = drawersRoot.querySelector(`[data-mode="${mode}"]`);
    if (!el) continue;
    drawers.set(mode, {
      el,
      toggle: el.querySelector('.lobby-drawer-toggle'),
      body: el.querySelector('.lobby-drawer-body'),
      list: el.querySelector('.lobby-type-list'),
      empty: el.querySelector('.lobby-type-empty'),
      create: el.querySelector('.lobby-create'),
    });
  }

  const sideStatus = document.getElementById('menu-match-status');
  const sideMeta = document.getElementById('menu-match-meta');
  const sideSeats = document.getElementById('menu-match-seats');
  const sideReady = document.getElementById('menu-match-ready');
  const sideStart = document.getElementById('menu-match-start');
  const sideLeave = document.getElementById('menu-match-leave');

  const panelTitle = document.getElementById('match-lobby-title');
  const panelSeats = document.getElementById('match-lobby-seats');
  const panelReady = document.getElementById('match-lobby-ready');
  const panelStart = document.getElementById('match-lobby-start');
  const panelLeave = document.getElementById('match-lobby-leave');
  const panelNote = document.getElementById('match-lobby-note');
  const fieldSelect = document.getElementById('match-lobby-field');
  const seedInput = document.getElementById('match-lobby-seed');
  const chapterSelect = document.getElementById('match-lobby-chapter');
  const fieldRow = document.getElementById('match-lobby-field-row');
  const seedRow = document.getElementById('match-lobby-seed-row');
  const chapterRow = document.getElementById('match-lobby-chapter-row');

  function kothLive() {
    return Boolean(isKothLive?.());
  }

  let lastSig = '';

  function refresh() {
    const live = kothLive();
    const active = matchLobby.isActive();
    const state = active ? matchLobby.getState() : null;
    const open = [...drawers].map(([m, ui]) => `${m}:${ui.toggle?.getAttribute('aria-expanded')}`).join();
    const lists = MODE_IDS.map((m) => gameLobby.listLobbies(m).map((l) => `${l.roomId}:${l.playerCount}`).join(',')).join('|');
    const sig = [
      live, active, open, lists,
      state?.phase, state?.playerCount, state?.countdownEndsAt,
      Math.ceil((matchLobby.countdownMs?.() ?? 0) / 200),
      state?.settings?.fieldSize, state?.settings?.seed, state?.settings?.chapter,
      JSON.stringify(state?.seats ?? []),
    ].join('/');
    if (sig === lastSig) return;
    lastSig = sig;
    const busy = live || active;
    drawersRoot.classList.toggle('is-dimmed', busy);
    for (const id of ['koth-start', 'menu-koth-start']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = active;
    }

    for (const [mode, ui] of drawers) {
      const open = ui.toggle?.getAttribute('aria-expanded') === 'true';
      setHidden(ui.body, !open);
      if (ui.create) ui.create.disabled = busy;
      if (open && !busy) syncTypeLobbyList(ui.list, ui.empty, gameLobby.listLobbies(mode));
      else if (ui.list && !open) ui.list.replaceChildren();
      ui.el.classList.toggle('is-match-type', Boolean(state && state.mode === mode));
    }

    const inPlay = state?.phase === 'playing';
    setHidden(sidebar, !active);
    setHidden(overlay, !active || inPlay);
    if (!active || !state) return;

    const mode = getMode(state.mode);
    const status = formatMatchStatus(state);
    const localId = getUserId?.() ?? null;
    const mySeat = state.seats.find((s) => sameUserId(s.userId, localId));
    const startLabel = formatStartLabel(
      matchLobby.canStart(),
      matchLobby.startBlockReason(),
      matchLobby.countdownMs(),
      state.phase,
    );
    const canClickStart = state.hosting && matchLobby.canStart() && state.phase === 'waiting';

    setText(sideStatus, status.title);
    setText(sideMeta, status.meta);
    setText(panelTitle, `${mode?.name ?? 'Lobby'} — ${state.hosting ? 'host' : status.title}`);
    paintSeats(sideSeats, state.seats, { teams: Boolean(mode?.teams), localId, compact: true });
    paintSeats(panelSeats, state.seats, { teams: Boolean(mode?.teams), localId, compact: false });

    setHidden(sideReady, state.hosting);
    setHidden(panelReady, state.hosting);
    if (sideReady) {
      sideReady.disabled = state.phase === 'starting' || inPlay;
      setText(sideReady, mySeat?.ready ? 'Unready' : 'Ready');
    }
    if (panelReady) {
      panelReady.disabled = state.phase === 'starting' || inPlay;
      setText(panelReady, mySeat?.ready ? 'Unready' : 'Ready');
    }

    setHidden(sideStart, !state.hosting || inPlay);
    setHidden(panelStart, !state.hosting || inPlay);
    if (sideStart) {
      sideStart.disabled = !canClickStart;
      setText(sideStart, startLabel);
    }
    if (panelStart) {
      panelStart.disabled = !canClickStart;
      setText(panelStart, startLabel);
    }

    const note = inPlay
      ? 'Match running.'
      : state.phase === 'countdown' || state.phase === 'starting'
        ? formatCountdown(matchLobby.countdownMs())
        : (state.hosting ? 'Ready up, then start.' : 'Waiting for host.');
    setText(panelNote, note);

    const hostControls = state.hosting && state.phase === 'waiting';
    fillSelect(fieldSelect, FIELD_SIZES, state.settings.fieldSize);
    fillSelect(chapterSelect, ADVENTURE_CHAPTERS.filter((c) => c.garden), state.settings.chapter);
    if (seedInput && document.activeElement !== seedInput && String(seedInput.value) !== String(state.settings.seed)) {
      seedInput.value = String(state.settings.seed);
    }
    if (fieldSelect) fieldSelect.disabled = !hostControls;
    if (seedInput) seedInput.disabled = !hostControls;
    if (chapterSelect) chapterSelect.disabled = !hostControls;
    setHidden(fieldRow, Boolean(mode?.hasChapter));
    setHidden(seedRow, Boolean(mode?.hasChapter));
    setHidden(chapterRow, !mode?.hasChapter);
  }

  function setDrawerOpen(mode, open) {
    const ui = drawers.get(mode);
    if (!ui?.toggle) return;
    ui.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) gameLobby.listen(mode);
    else gameLobby.unlisten(mode);
    refresh();
  }

  for (const [mode, ui] of drawers) {
    ui.toggle?.addEventListener('click', () => {
      const open = ui.toggle.getAttribute('aria-expanded') !== 'true';
      setDrawerOpen(mode, open);
    });
    ui.create?.addEventListener('click', () => {
      if (kothLive() || matchLobby.isActive()) return;
      matchLobby.createRoom(mode);
      refresh();
    });
    ui.list?.addEventListener('click', (e) => {
      if (kothLive() || matchLobby.isActive()) return;
      const btn = e.target instanceof Element ? e.target.closest('[data-room-id]') : null;
      if (!btn?.dataset.roomId) return;
      matchLobby.joinRoom(mode, btn.dataset.roomId, btn.dataset.from);
      refresh();
    });
  }

  function toggleReady() {
    const state = matchLobby.getState();
    const localId = getUserId?.() ?? null;
    const mine = state.seats.find((s) => s.userId === localId);
    matchLobby.setReady(!mine?.ready);
    refresh();
  }

  sideReady?.addEventListener('click', toggleReady);
  panelReady?.addEventListener('click', toggleReady);
  sideStart?.addEventListener('click', () => { matchLobby.requestStart(); refresh(); });
  panelStart?.addEventListener('click', () => { matchLobby.requestStart(); refresh(); });
  sideLeave?.addEventListener('click', () => { matchLobby.leaveRoom(); refresh(); });
  panelLeave?.addEventListener('click', () => { matchLobby.leaveRoom(); refresh(); });

  fieldSelect?.addEventListener('change', () => matchLobby.setSetting('fieldSize', fieldSelect.value));
  chapterSelect?.addEventListener('change', () => matchLobby.setSetting('chapter', chapterSelect.value));
  seedInput?.addEventListener('change', () => matchLobby.setSetting('seed', seedInput.value));

  for (const el of drawersRoot.querySelectorAll('button, input, select')) {
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('keyup', (e) => e.stopPropagation());
  }
  overlay?.addEventListener('keydown', (e) => e.stopPropagation());

  refresh();
  return { refresh };
}
