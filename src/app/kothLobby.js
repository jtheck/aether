// Live match browser — glass HUD lists any open game; the side menu is the full copy.

import { formatMatchTime, matchSecondsFromTick } from './simSession.js';
import { SHARD_ANNOUNCE_MS } from '../koth/protocol.js';
import { resolveLobbyName } from '../koth/lobbyName.js';
import { MODE_IDS, getMode } from '../lobby/modes.js';
import { formatTypeLobbyRow } from './lobbyUi.js';

/** Wait one KOTH presence tick before joining 1v1 / Teams / Adventure. */
export const TYPE_LISTEN_FALLBACK_MS = SHARD_ANNOUNCE_MS;

/**
 * @param {object} lobby
 * @returns {string}
 */
export function lobbyRowSignature(lobby) {
  const name = resolveLobbyName(lobby);
  return `${lobby.matchId}:${lobby.activeCount}:${lobby.tick}:${name}:${lobby.spectatorCount ?? 0}`;
}

function lobbyMetaLine(source) {
  const seats = source.seats || 5;
  const players = `${source.activeCount ?? 0}/${seats}`;
  const watching = source.spectatorCount
    ?? (Array.isArray(source.spectators) ? source.spectators.length : 0);
  const time = formatMatchTime(matchSecondsFromTick(source.tick ?? 0));
  return watching > 0
    ? `${players}  ·  ${watching} watching  ·  ${time}`
    : `${players}  ·  ${time}`;
}

/**
 * @param {object} lobby
 * @returns {{ title: string, meta: string, label: string }}
 */
export function formatLobbyRow(lobby) {
  const title = resolveLobbyName(lobby) || 'Open lobby';
  const seats = lobby.seats || 5;
  const players = `${lobby.activeCount}/${seats}`;
  const meta = lobbyMetaLine(lobby);
  return { title, meta, label: `Join ${title}, ${players}` };
}

/**
 * @param {object} presence
 * @returns {{ title: string, meta: string }}
 */
export function formatInLobbyStatus(presence) {
  const meta = lobbyMetaLine(presence);
  const name = resolveLobbyName(presence);
  if (presence.stalled) return { title: 'Waiting for players…', meta };
  if (presence.appState === 'matchmaking') return { title: 'Looking for a match…', meta };
  if (name) return { title: name, meta };
  if (presence.hosting) return { title: 'Your lobby', meta };
  if (presence.role === 'spectator') return { title: 'Spectating', meta };
  return { title: 'In lobby', meta };
}

/** Seated players first, then spectators, for the in-match roster. */
export function lobbyPeople(presence) {
  const players = Array.isArray(presence?.players) ? presence.players : [];
  const spectators = Array.isArray(presence?.spectators) ? presence.spectators : [];
  return [...players, ...spectators];
}

/** Hide the browser while another game type is live or a type lobby is open. */
export function shouldShowKothBrowser(presence, extra = {}) {
  if (!presence) return false;
  if (presence.parked || extra.typeLobbyActive) return false;
  return true;
}

/** After a quiet KOTH window, opt into the type-match channels. */
export function shouldAutoListenTypeLobbies({
  browsing = false,
  parked = false,
  typeLobbyActive = false,
  kothCount = 0,
  emptyForMs = 0,
} = {}) {
  if (!browsing || parked || typeLobbyActive) return false;
  if (kothCount > 0) return false;
  return emptyForMs >= TYPE_LISTEN_FALLBACK_MS;
}

export function browseRowId(row) {
  if (row?.kind === 'type') return `type:${row.mode}:${row.roomId}`;
  return `koth:${row?.matchId ?? ''}`;
}

export function formatBrowseRow(row) {
  if (row?.kind === 'type') {
    const mode = getMode(row.mode);
    const base = formatTypeLobbyRow(row);
    const name = mode?.name ?? 'Lobby';
    return {
      title: base.title,
      meta: `${name}  ·  ${base.meta}`,
      label: `Join ${name}, ${base.title}, ${base.meta}`,
    };
  }
  return formatLobbyRow(row);
}

export function collectTypeBrowseLobbies(gameLobby) {
  if (!gameLobby?.listLobbies) return [];
  const out = [];
  for (const mode of MODE_IDS) {
    if (gameLobby.isListening && !gameLobby.isListening(mode)) continue;
    for (const lobby of gameLobby.listLobbies(mode)) {
      out.push({ kind: 'type', mode, ...lobby });
    }
  }
  return out;
}

/** Center the HUD while forming a match; keep it cornered while browsing or mid-match lag. */
export function shouldCenterKothLobby(presence) {
  if (!presence || presence.browsing) return false;
  if (presence.stalled) return false;
  if (presence.canJoin) return true;
  if (presence.role === 'spectator') return true;
  const state = presence.appState;
  if (state === 'spectator' || state === 'queued' || state === 'joining' || state === 'matchmaking') {
    return true;
  }
  if (presence.waiting != null) return Boolean(presence.waiting);
  const playing = presence.role === 'player' && (presence.activeCount ?? 0) >= 2;
  return !playing;
}

/** Show the in-scene roster while waiting to start, joining, or a peer is stalled. */
export function shouldShowKothWaitingHud(presence) {
  if (!presence || presence.browsing) return false;
  if (presence.stalled || presence.canJoin) return true;
  if (presence.waiting != null) return Boolean(presence.waiting);
  return shouldCenterKothLobby(presence);
}

/** @param {{ name?: string, playerId?: number, you?: boolean, spectator?: boolean }} player */
export function formatLobbyPlayerLine(player) {
  const name = (player?.name ?? '').trim()
    || (player?.spectator ? 'Spectator' : `Player ${(player?.playerId ?? 0) + 1}`);
  const bits = [];
  if (player?.you) bits.push('you');
  if (player?.spectator) bits.push('watching');
  if (player?.lagging) bits.push('lagging');
  return bits.length ? `${name} (${bits.join(', ')})` : name;
}

/**
 * @param {HTMLElement | null} listEl
 * @param {{ name?: string, playerId?: number, you?: boolean }[]} [players]
 */
export function syncLobbyPlayers(listEl, players) {
  if (!listEl) return;
  const rows = Array.isArray(players) ? players : [];
  listEl.hidden = rows.length === 0;
  while (listEl.childElementCount > rows.length) listEl.lastElementChild?.remove();
  while (listEl.childElementCount < rows.length) {
    const line = document.createElement('div');
    line.className = 'koth-lobby-player';
    listEl.append(line);
  }
  for (let i = 0; i < rows.length; i++) {
    const text = formatLobbyPlayerLine(rows[i]);
    if (listEl.children[i].textContent !== text) listEl.children[i].textContent = text;
  }
}

/**
 * @param {HTMLElement} listEl
 * @param {HTMLElement | null} emptyEl
 * @param {object[]} lobbies
 * @param {string} [rowClass]
 */
export function syncLobbyList(listEl, emptyEl, lobbies, rowClass = 'koth-lobby-row') {
  const rows = lobbies.map((lobby) => {
    const kind = lobby.kind === 'type' ? 'type' : 'koth';
    const row = { ...lobby, kind };
    return { row, id: browseRowId(row), formatted: formatBrowseRow(row) };
  });
  if (emptyEl) emptyEl.hidden = rows.length > 0;
  const keep = new Set(rows.map((item) => item.id));
  for (const btn of [...listEl.querySelectorAll('[data-browse-id], [data-match-id]')]) {
    const id = btn.dataset.browseId
      || (btn.dataset.matchId ? `koth:${btn.dataset.matchId}` : '');
    if (!keep.has(id)) btn.remove();
  }
  for (const { row, id, formatted } of rows) {
    let btn = listEl.querySelector(`[data-browse-id="${CSS.escape(id)}"]`);
    if (!btn && row.kind !== 'type' && row.matchId) {
      btn = listEl.querySelector(`[data-match-id="${CSS.escape(row.matchId)}"]`);
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = rowClass;
      const name = document.createElement('span');
      name.className = 'koth-lobby-name';
      const meta = document.createElement('span');
      meta.className = 'koth-lobby-meta';
      btn.append(name, meta);
      listEl.append(btn);
    }
    btn.dataset.browseId = id;
    btn.dataset.kind = row.kind;
    if (row.kind === 'type') {
      btn.dataset.mode = row.mode;
      btn.dataset.roomId = row.roomId;
      if (btn.dataset.matchId) delete btn.dataset.matchId;
    } else {
      btn.dataset.matchId = row.matchId;
      if (btn.dataset.mode) delete btn.dataset.mode;
      if (btn.dataset.roomId) delete btn.dataset.roomId;
    }
    if (row.from && btn.dataset.from !== row.from) btn.dataset.from = row.from;
    if (btn.getAttribute('aria-label') !== formatted.label) btn.setAttribute('aria-label', formatted.label);
    const nameEl = btn.querySelector('.koth-lobby-name');
    const metaEl = btn.querySelector('.koth-lobby-meta');
    if (nameEl && nameEl.textContent !== formatted.title) nameEl.textContent = formatted.title;
    if (metaEl && metaEl.textContent !== formatted.meta) metaEl.textContent = formatted.meta;
  }
  const wanted = rows.map((item) => item.id);
  const current = [...listEl.querySelectorAll('[data-browse-id], [data-match-id]')].map((btn) => (
    btn.dataset.browseId || (btn.dataset.matchId ? `koth:${btn.dataset.matchId}` : '')
  ));
  const orderChanged = wanted.length !== current.length || wanted.some((id, i) => id !== current[i]);
  if (orderChanged) {
    for (const id of wanted) {
      const btn = listEl.querySelector(`[data-browse-id="${CSS.escape(id)}"]`);
      if (btn) listEl.append(btn);
    }
  }
}

/**
 * @param {object} opts
 * @param {object} opts.kothShard
 * @param {object} [opts.gameLobby]
 * @param {object} [opts.matchLobby]
 * @param {() => void} [opts.onLeaveSolo]
 * @param {() => unknown} [opts.onRestoreBackdrop]
 * @param {() => void} [opts.onCloseMenu]
 */
export function setupKothLobby({
  kothShard,
  gameLobby,
  matchLobby,
  onLeaveSolo,
  onRestoreBackdrop,
  onCloseMenu,
}) {
  const controls = document.getElementById('koth-controls');
  const lobbyEl = document.getElementById('koth-lobby');
  const listEl = document.getElementById('koth-lobby-list');
  const emptyEl = document.getElementById('koth-lobby-empty');
  const waitingEl = document.getElementById('koth-waiting');
  const waitingTitle = document.getElementById('koth-waiting-title');
  const waitingMeta = document.getElementById('koth-waiting-meta');
  const waitingPlayers = document.getElementById('koth-waiting-players');
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
  const menuPlayers = document.getElementById('menu-koth-players');
  const menuClaim = document.getElementById('menu-koth-claim');
  const menuLeave = document.getElementById('menu-koth-leave');

  if (!controls || !lobbyEl || !listEl || !emptyEl || !start || !join) return { refresh() {} };

  if (!kothShard) {
    controls.hidden = true;
    if (menuKoth) menuKoth.hidden = true;
    return { refresh() {} };
  }

  if (menuKoth) menuKoth.hidden = false;

  let kothEmptySince = 0;

  function paintLists(kothLobbies, extra = []) {
    syncLobbyList(listEl, emptyEl, kothLobbies.concat(extra));
    if (menuList) syncLobbyList(menuList, menuEmpty, kothLobbies, 'btn koth-lobby-row');
  }

  function syncTypeFallback(want) {
    gameLobby?.setAutoListen?.(want);
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
    setText(waitingTitle, row.title);
    setText(waitingMeta, row.meta);
    const people = lobbyPeople(presence);
    syncLobbyPlayers(waitingPlayers, people);
    syncLobbyPlayers(menuPlayers, people);
    if (menuClaim) {
      setHidden(menuClaim, !presence.canJoin);
      setText(menuClaim, presence.joinLabel || 'Claim Seat');
    }
  }

  function refresh() {
    const presence = kothShard.getLobbyPresence?.() ?? { browsing: kothShard.canStartOrJoinLive?.() };
    const browsing = Boolean(presence.browsing ?? kothShard.canStartOrJoinLive?.());
    const canJoin = Boolean(presence.canJoin ?? kothShard.canJoin?.());
    const typeLobbyActive = Boolean(matchLobby?.isActive?.());
    const center = shouldCenterKothLobby(presence);
    const showWaiting = shouldShowKothWaitingHud(presence);

    if (!shouldShowKothBrowser(presence, { typeLobbyActive })) {
      kothEmptySince = 0;
      syncTypeFallback(false);
      setHidden(controls, true);
      setHidden(menuKoth, true);
      return;
    }
    if (menuKoth) setHidden(menuKoth, false);

    controls.classList.toggle('koth-controls-center', center);

    if (browsing && !canJoin && !showWaiting) {
      const kothLobbies = kothShard.listLiveLobbies?.() ?? [];
      if (kothLobbies.length > 0) {
        kothEmptySince = 0;
        syncTypeFallback(false);
      } else {
        if (!kothEmptySince) kothEmptySince = Date.now();
        const emptyForMs = Date.now() - kothEmptySince;
        syncTypeFallback(shouldAutoListenTypeLobbies({
          browsing: true,
          parked: Boolean(presence.parked),
          typeLobbyActive,
          kothCount: 0,
          emptyForMs,
        }));
      }
      const typeLobbies = kothLobbies.length === 0 ? collectTypeBrowseLobbies(gameLobby) : [];
      setHidden(controls, false);
      setHidden(lobbyEl, false);
      setHidden(waitingEl, true);
      setHidden(join, true);
      paintLists(kothLobbies, typeLobbies);
      setHidden(menuBrowse, false);
      setHidden(menuLive, true);
      return;
    }

    kothEmptySince = 0;
    syncTypeFallback(false);

    if (showWaiting || canJoin) {
      setHidden(controls, false);
      setHidden(lobbyEl, true);
      setHidden(waitingEl, false);
      setHidden(join, !canJoin);
      if (canJoin) setText(join, presence.joinLabel || kothShard.joinActionLabel?.() || 'Join Match');
    } else {
      setHidden(controls, true);
    }

    setHidden(menuBrowse, true);
    setHidden(menuLive, false);
    paintLive(presence);
  }

  function joinRow(btn) {
    if (!btn) return;
    if (btn.dataset.kind === 'type' || btn.dataset.roomId) {
      if (!matchLobby?.joinRoom || matchLobby.isActive?.()) return;
      onCloseMenu?.();
      matchLobby.joinRoom(btn.dataset.mode, btn.dataset.roomId, btn.dataset.from);
      refresh();
      return;
    }
    if (!btn.dataset.matchId) return;
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
    joinRow(e.target instanceof Element ? e.target.closest('[data-browse-id], [data-match-id]') : null);
  });
  menuList?.addEventListener('click', (e) => {
    joinRow(e.target instanceof Element ? e.target.closest('[data-browse-id], [data-match-id]') : null);
  });
  start.addEventListener('click', () => startLobby(start));
  menuStart?.addEventListener('click', () => startLobby(menuStart));
  join.addEventListener('click', claimSeat);
  menuClaim?.addEventListener('click', claimSeat);
  menuLeave?.addEventListener('click', () => void leaveLobby());

  refresh();
  return { refresh };
}
