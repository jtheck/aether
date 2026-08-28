// Live KOTH lobby browser — HUD is the quick list; the side menu is the full copy.

import { formatMatchTime, matchSecondsFromTick } from './simSession.js';
import { shortId } from '../koth/protocol.js';

/**
 * @param {object} lobby
 * @returns {string}
 */
export function lobbyRowSignature(lobby) {
  return `${lobby.matchId}:${lobby.activeCount}:${lobby.tick}:${lobby.hostName ?? ''}`;
}

/**
 * @param {object} lobby
 * @returns {{ title: string, meta: string, label: string }}
 */
export function formatLobbyRow(lobby) {
  const title = (lobby.hostName ?? '').trim() || `…${shortId(lobby.matchId)}`;
  const seats = lobby.seats || 5;
  const players = `${lobby.activeCount}/${seats}`;
  const time = formatMatchTime(matchSecondsFromTick(lobby.tick ?? 0));
  const meta = `${players}  ·  ${time}`;
  return { title, meta, label: `Join ${title}, ${players}` };
}

/**
 * @param {object} presence
 * @returns {{ title: string, meta: string }}
 */
export function formatInLobbyStatus(presence) {
  const seats = presence.seats || 5;
  const players = `${presence.activeCount ?? 0}/${seats}`;
  const time = formatMatchTime(matchSecondsFromTick(presence.tick ?? 0));
  const meta = `${players}  ·  ${time}`;
  const name = (presence.hostName ?? '').trim();
  if (presence.hosting) return { title: 'Your lobby', meta };
  if (presence.role === 'spectator') {
    return { title: name ? `Spectating ${name}` : 'Spectating', meta };
  }
  return { title: name ? `In ${name}'s lobby` : 'In lobby', meta };
}

/**
 * @param {HTMLElement} listEl
 * @param {HTMLElement | null} emptyEl
 * @param {object[]} lobbies
 * @param {string} [rowClass]
 */
export function syncLobbyList(listEl, emptyEl, lobbies, rowClass = 'koth-lobby-row') {
  if (emptyEl) emptyEl.hidden = lobbies.length > 0;
  const keep = new Set(lobbies.map((lobby) => lobby.matchId));
  for (const btn of [...listEl.querySelectorAll('[data-match-id]')]) {
    if (!keep.has(btn.dataset.matchId)) btn.remove();
  }
  for (const lobby of lobbies) {
    const row = formatLobbyRow(lobby);
    let btn = listEl.querySelector(`[data-match-id="${CSS.escape(lobby.matchId)}"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = rowClass;
      btn.dataset.matchId = lobby.matchId;
      const name = document.createElement('span');
      name.className = 'koth-lobby-name';
      const meta = document.createElement('span');
      meta.className = 'koth-lobby-meta';
      btn.append(name, meta);
      listEl.append(btn);
    }
    if (lobby.from && btn.dataset.from !== lobby.from) btn.dataset.from = lobby.from;
    if (btn.getAttribute('aria-label') !== row.label) btn.setAttribute('aria-label', row.label);
    const nameEl = btn.querySelector('.koth-lobby-name');
    const metaEl = btn.querySelector('.koth-lobby-meta');
    if (nameEl && nameEl.textContent !== row.title) nameEl.textContent = row.title;
    if (metaEl && metaEl.textContent !== row.meta) metaEl.textContent = row.meta;
  }
  const wanted = lobbies.map((lobby) => lobby.matchId);
  const current = [...listEl.querySelectorAll('[data-match-id]')].map((btn) => btn.dataset.matchId);
  const orderChanged = wanted.length !== current.length || wanted.some((id, i) => id !== current[i]);
  if (orderChanged) {
    for (const id of wanted) {
      const btn = listEl.querySelector(`[data-match-id="${CSS.escape(id)}"]`);
      if (btn) listEl.append(btn);
    }
  }
}

/**
 * @param {object} opts
 * @param {object} opts.kothShard
 * @param {() => void} [opts.onLeaveSolo]
 * @param {() => unknown} [opts.onRestoreBackdrop]
 * @param {() => void} [opts.onCloseMenu]
 */
export function setupKothLobby({ kothShard, onLeaveSolo, onRestoreBackdrop, onCloseMenu }) {
  const controls = document.getElementById('koth-controls');
  const lobbyEl = document.getElementById('koth-lobby');
  const listEl = document.getElementById('koth-lobby-list');
  const emptyEl = document.getElementById('koth-lobby-empty');
  const start = document.getElementById('koth-start');
  const join = document.getElementById('koth-join');
  const menuKoth = document.getElementById('menu-koth');
  const menuBrowse = document.getElementById('menu-koth-browse');
  const menuLive = document.getElementById('menu-koth-live');
  const menuList = document.getElementById('menu-koth-list');
  const menuEmpty = document.getElementById('menu-koth-empty');
  const menuStart = document.getElementById('menu-koth-start');
  const menuStatus = document.getElementById('menu-koth-status');
  const menuMeta = document.getElementById('menu-koth-live-meta');
  const menuClaim = document.getElementById('menu-koth-claim');
  const menuLeave = document.getElementById('menu-koth-leave');

  if (!controls || !lobbyEl || !listEl || !emptyEl || !start || !join) return { refresh() {} };

  if (!kothShard) {
    controls.hidden = true;
    if (menuKoth) menuKoth.hidden = true;
    return { refresh() {} };
  }

  if (menuKoth) menuKoth.hidden = false;

  function paintLists(lobbies) {
    syncLobbyList(listEl, emptyEl, lobbies);
    if (menuList) syncLobbyList(menuList, menuEmpty, lobbies, 'btn koth-lobby-row');
  }

  function setText(el, text) {
    if (!el || el.textContent === text) return;
    el.textContent = text;
  }

  function setHidden(el, hidden) {
    if (!el || el.hidden === hidden) return;
    el.hidden = hidden;
  }

  function paintLive(presence) {
    const row = formatInLobbyStatus(presence);
    setText(menuStatus, row.title);
    setText(menuMeta, row.meta);
    if (menuClaim) {
      setHidden(menuClaim, !presence.canJoin);
      setText(menuClaim, presence.joinLabel || 'Claim Seat');
    }
  }

  function refresh() {
    const presence = kothShard.getLobbyPresence?.() ?? { browsing: kothShard.canStartOrJoinLive?.() };
    const browsing = Boolean(presence.browsing ?? kothShard.canStartOrJoinLive?.());
    const canJoin = Boolean(presence.canJoin ?? kothShard.canJoin?.());

    if (browsing) {
      setHidden(controls, false);
      setHidden(lobbyEl, false);
      setHidden(join, true);
      paintLists(kothShard.listLiveLobbies?.() ?? []);
      setHidden(menuBrowse, false);
      setHidden(menuLive, true);
      return;
    }

    if (canJoin) {
      setHidden(controls, false);
      setHidden(lobbyEl, true);
      setHidden(join, false);
      setText(join, presence.joinLabel || kothShard.joinActionLabel?.() || 'Join Match');
    } else {
      setHidden(controls, true);
    }

    setHidden(menuBrowse, true);
    setHidden(menuLive, false);
    paintLive(presence);
  }

  function joinRow(btn) {
    if (!btn?.dataset.matchId) return;
    onLeaveSolo?.();
    onCloseMenu?.();
    kothShard.joinLiveLobby?.(btn.dataset.matchId, btn.dataset.from);
    refresh();
  }

  function startLobby(btn) {
    if (!btn || btn.disabled) return;
    onLeaveSolo?.();
    onCloseMenu?.();
    btn.disabled = true;
    if (start) start.disabled = true;
    if (menuStart) menuStart.disabled = true;
    Promise.resolve(kothShard.startLiveLobby?.()).finally(() => {
      if (start) start.disabled = false;
      if (menuStart) menuStart.disabled = false;
      refresh();
    });
  }

  function claimSeat() {
    onLeaveSolo?.();
    onCloseMenu?.();
    kothShard.requestJoin?.();
    refresh();
  }

  async function leaveLobby() {
    if (menuLeave?.disabled) return;
    if (menuLeave) menuLeave.disabled = true;
    onCloseMenu?.();
    try {
      kothShard.leaveLiveLobby?.();
      await onRestoreBackdrop?.();
    } finally {
      if (menuLeave) menuLeave.disabled = false;
      refresh();
    }
  }

  listEl.addEventListener('click', (e) => {
    joinRow(e.target instanceof Element ? e.target.closest('[data-match-id]') : null);
  });
  menuList?.addEventListener('click', (e) => {
    joinRow(e.target instanceof Element ? e.target.closest('[data-match-id]') : null);
  });
  start.addEventListener('click', () => startLobby(start));
  menuStart?.addEventListener('click', () => startLobby(menuStart));
  join.addEventListener('click', claimSeat);
  menuClaim?.addEventListener('click', claimSeat);
  menuLeave?.addEventListener('click', () => void leaveLobby());

  refresh();
  return { refresh };
}
