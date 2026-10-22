// Side-menu type drawers + center match room + reduced sidebar copy.

import { sameUserId } from '../lobby/ids.js';
import { rosterStatusLabel } from './viewFollow.js';
import { FIELD_SIZES, MODE_IDS, getMode, mapTypeFitsLobby, selectableAdventureChapters } from '../lobby/modes.js';
import { aetherSteam } from './steam.js';
import { stashSessionGarden, writeCampaignPack } from './gardenSession.js';
import { formatWorkshopRef, isWorkshopRef } from './workshop.js';
import { flattenCampaignChapters, formatPackRef, isCampaignBundle, normalizeCampaignIndex } from '../story/campaignPack.js';
import { fetchOfficialHouseMaps } from '../houseMapCatalog.js';

/**
 * @param {object} lobby
 * @returns {{ title: string, meta: string, label: string }}
 */
export function formatTypeLobbyRow(lobby) {
  const title = (lobby.hostName ?? '').trim() || 'Open lobby';
  const seats = `${lobby.playerCount ?? 0}/${lobby.maxPlayers ?? 0}`;
  const chapter = String(lobby.settings?.chapter || '');
  const field = lobby.mode !== 'adventure' && chapter ? 'custom map' : lobby.settings?.fieldSize;
  const watching = lobby.spectatorCount
    ?? (Array.isArray(lobby.spectators) ? lobby.spectators.length : 0);
  const bits = [seats];
  if (field) bits.push(field);
  if (watching > 0) bits.push(`${watching} watching`);
  const meta = bits.join('  ·  ');
  return { title, meta, label: `Join ${title}, ${seats}` };
}

/**
 * Headline while lockstep is parked on one or more peers.
 * Empty when no one is identified yet.
 * @param {string[]} names
 */
export function formatLockstepStallTitle(names) {
  const list = [];
  const seen = new Set();
  for (const raw of names || []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  if (list.length === 0) return '';
  if (list.length === 1) return `${list[0]} is lagging`;
  if (list.length === 2) return `${list[0]} and ${list[1]} are lagging`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} are lagging`;
}

/** Seat names for the player ids lockstep is waiting on. */
export function namesForLockstepWaiters(seats, waiterIds) {
  const names = [];
  for (const id of waiterIds || []) {
    const playerId = id | 0;
    const seat = (seats || []).find((s) => (
      s?.kind === 'human' && Number.isInteger(s.index) && s.index === playerId
    ));
    names.push((seat?.name || '').trim() || `Player ${playerId + 1}`);
  }
  return names;
}

/**
 * @param {object} state
 * @returns {{ title: string, meta: string }}
 */
export function formatMatchStatus(state) {
  const mode = getMode(state.mode);
  const name = (state.hostName ?? '').trim();
  const seats = `${state.playerCount ?? 0}/${state.maxPlayers ?? mode?.maxPlayers ?? 0}`;
  if (state.watching) return { title: name ? `Watching ${name}` : 'Watching', meta: seats };
  if (state.hosting) return { title: `Your ${mode?.name ?? 'lobby'}`, meta: seats };
  return { title: name ? `In ${name}'s ${mode?.name ?? 'lobby'}` : 'In lobby', meta: seats };
}

/** @param {{ name?: string, userId?: string | null }} seat @param {string | null} localId */
export function formatSeatName(seat, localId, kingOwner = -1) {
  const name = (seat.name || 'Player').trim() || 'Player';
  const you = sameUserId(seat.userId, localId) ? ' (you)' : '';
  const crowned = !seat.watching && kingOwner >= 0 && (seat.index | 0) === kingOwner;
  return `${crowned ? '👑 ' : ''}${name}${you}`;
}

/** @param {string} modeId */
export function formatCreateLobbyLabel(modeId) {
  const mode = getMode(modeId);
  return mode ? `Create ${mode.name} lobby` : 'Create lobby';
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
    if (!keep.has(btn.dataset.roomId) || btn.dataset.spectate === '1') btn.remove();
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

function paintMoves(row, userId, hostMoves) {
  let moves = row.querySelector('.lobby-seat-moves');
  if (!hostMoves) {
    moves?.remove();
    return;
  }
  if (!moves) {
    moves = document.createElement('span');
    moves.className = 'lobby-seat-moves';
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'lobby-seat-move';
    up.dataset.dir = '-1';
    up.textContent = '↑';
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'lobby-seat-move';
    down.dataset.dir = '1';
    down.textContent = '↓';
    moves.append(up, down);
    row.append(moves);
  }
  for (const btn of moves.querySelectorAll('button')) {
    btn.dataset.userId = userId || '';
    btn.hidden = !userId;
  }
}

function paintSeats(container, seats, {
  teams, localId, compact, spectators, hostMoves, followUserId, kingOwner = -1, laggingIds = null,
}) {
  if (!container) return;
  const groups = teams
    ? [
      { label: 'Team A', items: seats.filter((s) => s.team === 0) },
      { label: 'Team B', items: seats.filter((s) => s.team === 1) },
    ]
    : [{ label: compact ? '' : 'Players', items: seats }];
  if (spectators?.length) {
    groups.push({
      label: 'Watching',
      items: spectators.map((s) => ({
        kind: 'human',
        name: s.name,
        userId: s.userId,
        color: s.color,
        ready: false,
        replay: Boolean(s.replay),
        watching: true,
      })),
    });
  }

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
        setText(nameEl, formatSeatName(seat, localId, seat.watching ? -1 : kingOwner));
        if (nameEl) nameEl.style.color = seat.color || '';
        const lagging = Boolean(
          laggingIds
          && Number.isInteger(seat.index)
          && laggingIds.has(seat.index),
        );
        setText(statusEl, rosterStatusLabel({ ...seat, lagging }));
        const canFollow = Boolean(seat.replay) && !sameUserId(seat.userId, localId);
        const following = canFollow && followUserId && sameUserId(seat.userId, followUserId);
        if (canFollow) row.dataset.replayUser = seat.userId;
        else delete row.dataset.replayUser;
        if (statusEl) {
          statusEl.style.cursor = canFollow ? 'pointer' : '';
          statusEl.style.textDecoration = following ? 'underline' : '';
          statusEl.title = canFollow ? (following ? 'Following' : 'Follow replay') : '';
        }
        paintMoves(row, seat.userId, hostMoves);
      } else {
        setText(nameEl, 'Waiting…');
        if (nameEl) nameEl.style.color = '';
        setText(statusEl, '');
        delete row.dataset.replayUser;
        if (statusEl) {
          statusEl.style.cursor = '';
          statusEl.style.textDecoration = '';
          statusEl.title = '';
        }
        paintMoves(row, '', hostMoves);
      }
    });
  });
}

function optionEl(id, name) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = name;
  return opt;
}

/** Flat options, with a `group` field gathered under that episode header. */
export function groupSelectOptions(values, labelOf = (v) => v) {
  const rows = [];
  let current = null;
  for (const v of values || []) {
    const id = typeof v === 'string' ? v : v.id;
    const name = typeof v === 'string' ? labelOf(v) : (v.name || id);
    const group = typeof v === 'string' ? '' : String(v.group || '');
    if (group && current?.group === group) {
      current.options.push({ id, name });
      continue;
    }
    if (group) {
      current = { group, options: [{ id, name }] };
      rows.push(current);
      continue;
    }
    current = null;
    rows.push({ id, name });
  }
  return rows;
}

function fillSelect(select, values, current, labelOf = (v) => v) {
  if (!select) return;
  const sig = (values || []).map((v) => (typeof v === 'string' ? v : `${v.group || ''}\0${v.id}\0${v.name || ''}`)).join('\n');
  if (select.dataset.optSig !== sig) {
    select.dataset.optSig = sig;
    select.replaceChildren();
    for (const row of groupSelectOptions(values, labelOf)) {
      if (row.group) {
        const heading = document.createElement('optgroup');
        heading.label = row.group;
        for (const opt of row.options) heading.appendChild(optionEl(opt.id, opt.name));
        select.appendChild(heading);
      } else {
        select.appendChild(optionEl(row.id, row.name));
      }
    }
  }
  if (current != null && select.value !== String(current)) select.value = String(current);
}

function workshopChapterLabel(item, garden) {
  const title = item.title || garden.name || item.id;
  if ((item.gardens?.length || 0) > 1) return `${title} - ${garden.name || garden.file}`;
  return title;
}

export function chapterSelectOptions(workshopItems, current, search, hostname, localChapters) {
  const official = selectableAdventureChapters(search, hostname)
    .filter((c) => c.garden)
    .map((c) => ({ id: c.id, name: c.name, group: c.episode || '' }));
  const local = Array.isArray(localChapters) ? localChapters.filter((row) => row?.id) : [];
  const extra = [];
  for (const item of workshopItems || []) {
    const index = normalizeCampaignIndex(item.campaign);
    if (index) {
      const packed = flattenCampaignChapters(index);
      const title = item.title || item.campaign?.name || item.id;
      for (const ch of packed) {
        extra.push({
          id: formatWorkshopRef(item.id, ch.file),
          name: packed.length > 1 ? (ch.name || ch.file) : title,
          group: packed.length > 1 ? [title, ch.episode].filter(Boolean).join(' - ') : '',
        });
      }
      continue;
    }
    for (const garden of item.gardens || []) {
      extra.push({
        id: formatWorkshopRef(item.id, garden.file),
        name: workshopChapterLabel(item, garden),
      });
    }
  }
  const cur = String(current || '');
  const known = official.concat(local, extra);
  if (cur && !known.some((row) => row.id === cur)) {
    const name = cur.toLowerCase().startsWith('pack:')
      ? 'Custom campaign'
      : cur === 'session'
        ? 'Custom map'
        : isWorkshopRef(cur)
          ? 'Workshop map'
          : '';
    if (name) extra.unshift({ id: cur, name });
  }
  return official.concat(local, extra);
}

/** Workshop, official house maps, and loaded gardens for 1v1 / teams. Empty chapter = generated field. */
export function customMapSelectOptions(workshopItems, current, localMaps, modeId, officialMaps) {
  const official = (Array.isArray(officialMaps) ? officialMaps : [])
    .filter((row) => row?.id && mapTypeFitsLobby(row.mapType, modeId));
  const local = (Array.isArray(localMaps) ? localMaps : [])
    .filter((row) => row?.id)
    .map((row) => ({ id: row.id, name: row.name || row.id, group: row.group || '' }));
  const extra = [];
  for (const item of workshopItems || []) {
    if (normalizeCampaignIndex(item.campaign)) continue;
    for (const garden of item.gardens || []) {
      if (!mapTypeFitsLobby(garden.mapType, modeId)) continue;
      extra.push({
        id: formatWorkshopRef(item.id, garden.file),
        name: workshopChapterLabel(item, garden),
      });
    }
  }
  const cur = String(current || '');
  const known = [...official, ...local, ...extra];
  if (cur && !known.some((row) => row.id === cur)) {
    extra.unshift({
      id: cur,
      name: cur === 'session' ? 'Custom map' : isWorkshopRef(cur) ? 'Workshop map' : 'Custom map',
    });
  }
  return [...official, ...local, ...extra];
}

/**
 * @param {object} opts
 * @param {object} opts.gameLobby
 * @param {object} opts.matchLobby
 * @param {() => boolean} [opts.isKothLive]
 * @param {() => string | null} [opts.getUserId]
 * @param {() => void} [opts.onCloseMenu]
 * @param {(userId: string) => void} [opts.onFollowReplay]
 * @param {() => string | null} [opts.getFollowUser]
 */
export function setupLobbyUi({
  gameLobby, matchLobby, isKothLive, getUserId, onCloseMenu, onFollowReplay, getFollowUser, getKing,
}) {
  const drawersRoot = document.getElementById('menu-lobbies');
  const sidebar = document.getElementById('menu-match');
  const overlay = document.getElementById('match-lobby-overlay');
  const overlayPanel = overlay?.querySelector?.('.match-lobby-panel');
  const overlayMin = document.getElementById('match-lobby-min');
  const matchOverEl = document.getElementById('match-over');
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
    const create = drawers.get(mode)?.create;
    if (create) create.textContent = formatCreateLobbyLabel(mode);
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
  const mapSelect = document.getElementById('match-lobby-map');
  const spectatorInput = document.getElementById('match-lobby-spectators');
  const fieldRow = document.getElementById('match-lobby-field-row');
  const seedRow = document.getElementById('match-lobby-seed-row');
  const chapterRow = document.getElementById('match-lobby-chapter-row');
  const mapRow = document.getElementById('match-lobby-map-row');
  const spectatorRow = document.getElementById('match-lobby-spectators-row');

  function kothLive() {
    return Boolean(isKothLive?.());
  }

  let lastSig = '';
  let overlayParked = false;
  let workshopItems = [];
  let localChapters = [];
  let localMaps = [];
  /** @type {Record<string, { id: string, name: string, group?: string, mapType?: string }[]>} */
  let officialHouseMaps = { onevsone: [], teams: [] };
  let lastWorkshopPull = 0;
  let lastOfficialPull = 0;

  function pullOfficialHouseMaps() {
    const now = Date.now();
    if (now - lastOfficialPull < 3000) return;
    lastOfficialPull = now;
    void Promise.all([
      fetchOfficialHouseMaps('onevsone'),
      fetchOfficialHouseMaps('teams'),
    ]).then(([onevsone, teams]) => {
      const sig = `${onevsone.map((r) => r.id).join()}|${teams.map((r) => r.id).join()}`;
      const prev = `${officialHouseMaps.onevsone.map((r) => r.id).join()}|${officialHouseMaps.teams.map((r) => r.id).join()}`;
      if (sig === prev) return;
      officialHouseMaps = { onevsone, teams };
      lastSig = '';
      refresh();
    });
  }

  function pullWorkshopChapters() {
    const now = Date.now();
    if (now - lastWorkshopPull < 3000) return;
    lastWorkshopPull = now;
    void aetherSteam.listWorkshopMaps().then((items) => {
      const next = Array.isArray(items) ? items : [];
      const sig = next.flatMap((item) => (item.gardens || []).map((g) => `${item.id}:${g.file}`)).join();
      const prev = workshopItems.flatMap((item) => (item.gardens || []).map((g) => `${item.id}:${g.file}`)).join();
      if (sig === prev) return;
      workshopItems = next;
      lastSig = '';
      refresh();
    });
  }

  function refresh() {
    const live = kothLive();
    const active = matchLobby.isActive();
    const state = active ? matchLobby.getState() : null;
    const open = [...drawers].map(([m, ui]) => `${m}:${ui.toggle?.getAttribute('aria-expanded')}`).join();
    const lists = MODE_IDS.map((m) => gameLobby.listLobbies(m).map((l) => `${l.roomId}:${l.playerCount}`).join(',')).join('|');
    const matchOverOn = Boolean(matchOverEl) && !matchOverEl.hidden;
    const sig = [
      live, active, open, lists,
      state?.phase, state?.playerCount, state?.countdownEndsAt,
      Boolean(matchLobby.lockstepStalled?.()),
      (matchLobby.lockstepWaiters?.() ?? []).join(','),
      Math.ceil((matchLobby.countdownMs?.() ?? 0) / 200),
      state?.settings?.fieldSize, state?.settings?.seed, state?.settings?.chapter,
      state?.settings?.allowSpectators,
      state?.loadingMap,
      workshopItems.flatMap((item) => (item.gardens || []).map((g) => `${item.id}:${g.file}:${g.mapType || ''}`)).join(),
      localChapters.map((row) => row.id).join(),
      localMaps.map((row) => row.id).join(),
      officialHouseMaps.onevsone.map((row) => row.id).join(),
      officialHouseMaps.teams.map((row) => row.id).join(),
      JSON.stringify(state?.seats ?? []),
      JSON.stringify(state?.spectators ?? []),
      state?.watching,
      state?.ranked,
      overlayParked, matchOverOn,
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
    const stalled = Boolean(matchLobby.lockstepStalled?.());
    const waiterIds = stalled ? (matchLobby.lockstepWaiters?.() ?? []) : [];
    const laggingIds = new Set(waiterIds.map((id) => id | 0));
    const stallTitle = formatLockstepStallTitle(namesForLockstepWaiters(state?.seats, waiterIds))
      || 'Waiting for players…';
    const ranked = Boolean(state?.ranked);
    const showOverlay = ranked
      ? matchOverOn
      : (active && (!inPlay || stalled)) || matchOverOn;
    // No room: the score card stands alone. A fresh lobby must not wear it.
    const scoreOnly = Boolean(matchOverOn && !active);
    overlay?.classList.toggle('is-ranked-result', Boolean((ranked && matchOverOn) || scoreOnly));
    const overlayOpening = Boolean(overlay?.hidden && showOverlay);
    if (overlayOpening) overlayParked = false;
    overlay?.classList.toggle('is-lag', Boolean(showOverlay && inPlay && stalled));
    overlay?.classList.toggle('is-parked', Boolean(showOverlay && overlayParked && !(inPlay && stalled)));
    setHidden(sidebar, !active || ranked);
    setHidden(overlay, !showOverlay);
    setHidden(overlayPanel, !active && !scoreOnly);
    setHidden(panelLeave, scoreOnly);
    if (overlayMin) {
      const compact = Boolean(overlay?.classList.contains('is-parked'));
      overlayMin.textContent = compact ? '+' : '−';
      overlayMin.setAttribute('aria-label', compact ? 'Expand lobby' : 'Minimize lobby');
    }
    if (overlayOpening) onCloseMenu?.();
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

    setText(sideStatus, inPlay && stalled ? stallTitle : status.title);
    setText(sideMeta, status.meta);
    setText(panelTitle, inPlay && stalled
      ? stallTitle
      : `${mode?.name ?? 'Lobby'} - ${state.hosting ? 'host' : status.title}`);
    const hostMoves = state.hosting && (state.phase === 'waiting' || state.phase === 'countdown');
    const followUserId = getFollowUser?.() ?? null;
    const kingOwner = state.mode === 'koth' ? (getKing?.() ?? -1) : -1;
    paintSeats(sideSeats, state.seats, {
      teams: Boolean(mode?.teams), localId, compact: true, spectators: state.spectators, hostMoves, followUserId, kingOwner, laggingIds,
    });
    paintSeats(panelSeats, state.seats, {
      teams: Boolean(mode?.teams), localId, compact: false, spectators: state.spectators, hostMoves, followUserId, kingOwner, laggingIds,
    });

    setHidden(sideReady, state.hosting || state.watching);
    setHidden(panelReady, state.hosting || state.watching);
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

    const note = inPlay && stalled
      ? stallTitle
      : inPlay
      ? 'Match running.'
      : state.phase === 'countdown' || state.phase === 'starting'
        ? formatCountdown(matchLobby.countdownMs())
        : matchOverOn
          ? (state.hosting ? 'Ready up to play again.' : 'Ready up for another round.')
          : (state.hosting ? 'Ready up, then start.' : 'Waiting for host.');
    setText(panelNote, ranked && matchOverOn ? '' : note);
    if (panelLeave) setText(panelLeave, ranked && matchOverOn ? 'Done' : 'Leave');

    const hostControls = state.hosting && state.phase === 'waiting';
    if (mode?.hasChapter || mode?.customMap) pullWorkshopChapters();
    if (mode?.customMap) pullOfficialHouseMaps();
    fillSelect(fieldSelect, FIELD_SIZES, state.settings.fieldSize);
    fillSelect(chapterSelect, chapterSelectOptions(
      workshopItems,
      state.settings.chapter,
      undefined,
      undefined,
      localChapters,
    ), state.settings.chapter);
    const mapOptions = customMapSelectOptions(
      workshopItems,
      state.settings.chapter,
      localMaps,
      state.mode,
      officialHouseMaps[state.mode] || [],
    );
    fillSelect(
      mapSelect,
      mapOptions.length ? [{ id: '', name: '' }, ...mapOptions] : [],
      state.settings.chapter || '',
    );
    if (seedInput && document.activeElement !== seedInput && String(seedInput.value) !== String(state.settings.seed)) {
      seedInput.value = String(state.settings.seed);
    }
    if (spectatorInput && document.activeElement !== spectatorInput) {
      spectatorInput.checked = state.settings.allowSpectators !== false;
    }
    if (fieldSelect) fieldSelect.disabled = !hostControls;
    if (seedInput) seedInput.disabled = !hostControls;
    if (chapterSelect) chapterSelect.disabled = !hostControls;
    if (mapSelect) mapSelect.disabled = !hostControls;
    if (spectatorInput) spectatorInput.disabled = !hostControls;
    for (const id of ['match-lobby-load-map', 'match-lobby-load-garden']) {
      const loadMap = document.getElementById(id);
      if (loadMap) loadMap.disabled = !hostControls;
    }
    const usingCustomMap = Boolean(mode?.customMap && state.settings.chapter);
    setHidden(fieldRow, Boolean(mode?.hasChapter) || usingCustomMap);
    setHidden(seedRow, Boolean(mode?.hasChapter) || usingCustomMap);
    setHidden(chapterRow, !mode?.hasChapter);
    setHidden(mapRow, !mode?.customMap);
    setHidden(document.getElementById('match-lobby-load-row'), !mode?.customMap);
    setHidden(spectatorRow, !mode?.spectators);
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

  function onReplayClick(e) {
    if (!(e.target instanceof Element) || e.target.closest('[data-dir]')) return;
    const row = e.target.closest('[data-replay-user]');
    const id = row?.dataset.replayUser;
    if (!id) return;
    onFollowReplay?.(id);
  }
  function onMoveClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-dir][data-user-id]') : null;
    if (!btn) return;
    matchLobby.movePerson(btn.dataset.userId, Number(btn.dataset.dir));
    refresh();
  }
  sideSeats?.addEventListener('click', onReplayClick);
  panelSeats?.addEventListener('click', onReplayClick);
  sideSeats?.addEventListener('click', onMoveClick);
  panelSeats?.addEventListener('click', onMoveClick);
  sideReady?.addEventListener('click', toggleReady);
  panelReady?.addEventListener('click', toggleReady);
  sideStart?.addEventListener('click', () => { matchLobby.requestStart(); refresh(); });
  panelStart?.addEventListener('click', () => { matchLobby.requestStart(); refresh(); });
  sideLeave?.addEventListener('click', () => { matchLobby.leaveRoom(); refresh(); });
  panelLeave?.addEventListener('click', () => { matchLobby.leaveRoom(); refresh(); });
  overlayMin?.addEventListener('click', () => {
    overlayParked = !overlayParked;
    refresh();
  });

  fieldSelect?.addEventListener('change', () => matchLobby.setSetting('fieldSize', fieldSelect.value));
  chapterSelect?.addEventListener('change', () => matchLobby.setSetting('chapter', chapterSelect.value));
  mapSelect?.addEventListener('change', () => matchLobby.setSetting('chapter', mapSelect.value));
  spectatorInput?.addEventListener('change', () => {
    matchLobby.setSetting('allowSpectators', spectatorInput.checked);
  });
  const openMapFile = () => document.getElementById('match-lobby-map-file')?.click();
  document.getElementById('match-lobby-load-map')?.addEventListener('click', openMapFile);
  document.getElementById('match-lobby-load-garden')?.addEventListener('click', openMapFile);
  document.getElementById('match-lobby-map-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const state = matchLobby.getState();
    if (!state?.hosting) return;
    const mode = getMode(state.mode);
    file.text().then(async (text) => {
      const data = JSON.parse(text);
      const rowsFromCampaign = () => flattenCampaignChapters(data).map((ch) => ({
        id: formatPackRef(ch.file),
        name: ch.name || ch.file,
        group: ch.episode || data.name || 'Campaign',
      }));
      if (isCampaignBundle(data)) {
        await writeCampaignPack(text);
        const rows = rowsFromCampaign();
        if (mode?.customMap) localMaps = rows;
        else localChapters = rows;
        if (rows[0]) matchLobby.setSetting('chapter', rows[0].id);
      } else if (data && typeof data === 'object' && (data.v | 0) >= 3 && (data.w | 0) > 0) {
        await stashSessionGarden(text);
        const row = { id: 'session', name: String(data.n || data.name || file.name || 'Custom map') };
        if (mode?.customMap) localMaps = [row];
        else localChapters = [row];
        matchLobby.setSetting('chapter', 'session');
      } else {
        throw new Error('unrecognized map');
      }
      lastSig = '';
      refresh();
    }).catch((err) => {
      console.error(err);
    });
  });
  seedInput?.addEventListener('change', () => matchLobby.setSetting('seed', seedInput.value));

  for (const el of drawersRoot.querySelectorAll('button, input, select')) {
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }
  overlay?.addEventListener('keydown', (e) => e.stopPropagation());

  refresh();
  return {
    refresh,
    setOverlayParked(on) {
      overlayParked = Boolean(on);
      refresh();
    },
  };
}
