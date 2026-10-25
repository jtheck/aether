import { fetchOfficialHouseMaps } from '../houseMapCatalog.js';
import { ladderSlices } from './ladderBoard.js';
import { seasonInfo } from './ladderSeason.js';
import { ladderLooking, ladderQueueReady, leaveLadder, loadLadderBoard, loadLadderRecent, loadLadderSnapshot, queueLadder, touchLadderName } from './ladderApi.js';
import { mountMatchSnapshot, snapCaption } from './matchSnapshotView.js';
import { rememberLadderId } from './ladderId.js';
import { clearLadderAssignment, getLadderAssignment, setLadderAssignment } from './ladderSession.js';
import { getPlayerColor, getPlayerName } from './settings.js';
import { focusMenuEl } from './input/gamepad.js';

const PLAYER_HEX = /^#[0-9a-fA-F]{6}$/;

function ratingText(player) {
  const rating = player?.rating;
  return Number.isFinite(rating) ? String(rating | 0) : '';
}

function matchSide(players, mirror) {
  const side = document.createElement('div');
  side.className = 'ladder-side';
  for (const player of players) {
    const row = document.createElement('div');
    row.className = 'ladder-player';
    const name = document.createElement('div');
    name.className = 'ladder-player-name';
    const text = document.createElement('span');
    text.textContent = player?.name || 'Player';
    const color = PLAYER_HEX.test(player?.color || '') ? player.color : '';
    const swatch = color ? document.createElement('span') : null;
    if (swatch) {
      swatch.className = 'ladder-swatch';
      swatch.style.background = color;
      if (!mirror) name.append(swatch);
    }
    name.append(text);
    if (swatch && mirror) name.append(swatch);
    row.append(name);
    const rating = ratingText(player);
    if (rating) {
      const ratingEl = document.createElement('div');
      ratingEl.className = 'ladder-rating';
      ratingEl.textContent = rating;
      row.append(ratingEl);
    }
    side.append(row);
  }
  return side;
}

function renderLadderMatchup(goNames, card, match) {
  if (!goNames) return;
  const players = match?.players || [];
  const teams = match?.board === 'teams';
  const hill = match?.board === 'koth';
  const left = hill ? players : teams ? players.filter((player) => player.team !== 1) : players.slice(0, 1);
  const right = hill ? [] : teams ? players.filter((player) => player.team === 1) : players.slice(1, 2);
  goNames.replaceChildren();
  goNames.append(matchSide(left, false));
  if (!hill) {
    const vs = document.createElement('div');
    vs.className = 'ladder-vs';
    vs.textContent = 'vs';
    goNames.append(vs, matchSide(right, true));
  }
  const phrase = (side) => side
    .map((player) => [player?.name || 'Player', ratingText(player)].filter(Boolean).join(', '))
    .join(', ');
  const label = hill ? phrase(left) : `${phrase(left)} versus ${phrase(right)}`;
  card?.setAttribute('aria-label', label || 'Ladder match');
}

function recentWhen(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fill(el, rows, playerId, openId) {
  if (!el) return;
  el.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'No one yet.';
    el.appendChild(empty);
    return;
  }
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const label of ['#', 'Name', 'Rating', 'W', 'L']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.playerId === playerId) tr.className = 'is-you';
    const losses = row.losses ?? Math.max(0, (row.games | 0) - (row.wins ?? 0));
    const cells = [row.rank, row.name || '-', row.rating, row.wins ?? 0, losses];
    cells.forEach((value, index) => {
      const td = document.createElement('td');
      if (index === 1 && row.playerId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ladder-name';
        btn.dataset.playerId = row.playerId;
        btn.textContent = String(value);
        if (row.playerId === openId) btn.classList.add('is-on');
        td.append(btn);
      } else {
        td.textContent = String(value);
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }
  el.appendChild(table);
}

export function setupLadderDialog({ matchLobby, getUserId, onCloseMenu, onKothPlace }) {
  const openBtn = document.getElementById('ladder-open');
  const pop = document.getElementById('ladder_pop');
  const closeBtn = document.getElementById('ladder_close');
  const board1 = document.getElementById('ladder_board_1v1');
  const boardTeams = document.getElementById('ladder_board_teams');
  const boardHill = document.getElementById('ladder_board_koth');
  const title = document.getElementById('ladder_title');
  const seasonNum = document.getElementById('ladder_season_num');
  const seasonStart = document.getElementById('ladder_season_start');
  const findBtn = document.getElementById('ladder_find');
  const status = document.getElementById('ladder_status');
  const hist = document.getElementById('ladder_hist');
  const histTitle = document.getElementById('ladder_hist_name');
  const histList = document.getElementById('ladder_hist_list');
  const histClose = document.getElementById('ladder_hist_close');
  const histBack = document.getElementById('ladder_hist_back');
  const histMeta = document.getElementById('ladder_hist_meta');
  const topEl = document.getElementById('ladder_top');
  const aroundEl = document.getElementById('ladder_around');
  const aroundWrap = document.getElementById('ladder_around_wrap');
  const pageEl = document.getElementById('ladder_page');
  const prev = document.getElementById('ladder_prev');
  const next = document.getElementById('ladder_next');
  const pageLabel = document.getElementById('ladder_page_label');
  const go = document.getElementById('ladder_go');
  const goNames = document.getElementById('ladder_go_names');
  const goCount = document.getElementById('ladder_go_count');
  const goCancel = document.getElementById('ladder_go_cancel');
  if (!openBtn || !pop || !matchLobby) return { refresh() {}, close() {} };
  void fetchOfficialHouseMaps('onevsone');

  let page = 0;
  let shownId = '';
  let shownName = '';
  let recentDoc = null;
  let recentGen = 0;
  let boardId = '1v1';
  let board = { rows: [] };
  let looking = null;
  let note = '';
  let searching = false;
  let played = false;
  let dropGen = 0;
  let holdMatch = false;
  let droppedMatchId = '';
  let pollTimer = 0;
  let lookTimer = 0;
  const playerId = rememberLadderId();

  function ladderType() {
    return boardId === 'teams' ? '2v2' : boardId === 'koth' ? 'KOTH' : '1v1';
  }

  function findLabel() {
    return `Find ${ladderType()} Ladder Match`;
  }

  function cancelLabel() {
    return `Cancel ${ladderType()} search`;
  }

  function paintCount(text) {
    if (!goCount) return;
    goCount.textContent = text;
    goCount.classList.toggle('is-wait', text === 'Connecting');
  }

  function paintMatchup(match) {
    renderLadderMatchup(goNames, go?.querySelector('.ladder-card'), match);
  }

  function paint() {
    const view = ladderSlices(board.rows || [], playerId, page);
    page = view.page;
    const season = seasonInfo(board.season || '2026-1');
    if (title) title.textContent = season.name || 'Ladder';
    if (seasonNum) seasonNum.textContent = season.number == null ? '' : `(Season #${season.number})`;
    if (seasonStart) seasonStart.textContent = season.started;
    board1?.setAttribute('aria-pressed', boardId === '1v1' ? 'true' : 'false');
    boardTeams?.setAttribute('aria-pressed', boardId === 'teams' ? 'true' : 'false');
    boardHill?.setAttribute('aria-pressed', boardId === 'koth' ? 'true' : 'false');
    if (findBtn && !searching) findBtn.textContent = findLabel();
    fill(topEl, view.top, playerId, shownId);
    if (aroundWrap) aroundWrap.hidden = view.around.length === 0;
    fill(aroundEl, view.around, playerId, shownId);
    fill(pageEl, view.pageRows, playerId, shownId);
    if (pageLabel) pageLabel.textContent = `${view.page + 1} / ${view.pages}`;
    if (status && !searching) {
      status.textContent = note || (looking == null ? '' : `${looking} looking.`);
    }
  }

  async function refreshLooking() {
    try {
      looking = await ladderLooking(boardId);
    } catch {
      looking = null;
    }
    if (!searching) paint();
  }

  async function reload() {
    try {
      await touchLadderName(playerId, getPlayerName());
      const next = await loadLadderBoard(location.origin, boardId);
      board = next && Array.isArray(next.rows) ? next : { rows: [] };
    } catch {
      board = { rows: [] };
    }
    paint();
  }

  function setOpen(open) {
    pop.hidden = !open;
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (lookTimer) clearInterval(lookTimer);
    lookTimer = 0;
    if (open) {
      focusMenuEl(closeBtn);
      void reload();
      void refreshLooking();
      lookTimer = setInterval(() => { void refreshLooking(); }, 3000);
    } else {
      closeRecent();
    }
  }

  function stopSearch() {
    searching = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
    if (findBtn) findBtn.textContent = findLabel();
  }

  async function cancelSearch() {
    const queued = boardId;
    stopSearch();
    await leaveLadder(playerId, queued).catch(() => {});
    paint();
  }

  async function cancelConnect() {
    dropGen += 1;
    holdMatch = false;
    droppedMatchId = '';
    if (go) go.hidden = true;
    matchLobby.leaveRoom?.();
    clearLadderAssignment();
    await leaveLadder(playerId, boardId).catch(() => {});
    paint();
  }

  async function requeueAfterDrop() {
    const gen = ++dropGen;
    holdMatch = true;
    droppedMatchId = getLadderAssignment()?.matchId || droppedMatchId;
    if (go) go.hidden = true;
    clearLadderAssignment();
    stopSearch();
    try { await leaveLadder(playerId, boardId); } catch { /* queue anyway */ }
    if (gen !== dropGen) return;
    holdMatch = false;
    if (matchLobby.isActive()) return;
    setOpen(true);
    void beginSearch();
  }

  function showCountdown(match) {
    paintMatchup(match);
    paintCount('Connecting');
    if (go) go.hidden = false;
    onCloseMenu?.();
    setOpen(false);
  }

  function startMatch(match) {
    if (holdMatch) return;
    if (match?.matchId && match.matchId === droppedMatchId) return;
    const board = match.board === 'teams' ? 'teams' : match.board === 'koth' ? 'koth' : '1v1';
    setLadderAssignment({ ...match, you: playerId, board });
    if (board === 'koth') {
      onKothPlace?.({ ...match, you: playerId, board });
      onCloseMenu?.();
      setOpen(false);
      return;
    }
    showCountdown(match);
    const mode = board === 'teams' ? 'teams' : board === 'koth' ? 'koth' : 'onevsone';
    if (match.role === 'host') {
      matchLobby.createRoom(mode, {
        roomId: match.matchId,
        seed: match.seed,
        ranked: true,
        roster: board === '1v1' ? null : match.players,
      });
      return;
    }
    const mine = (match.players || []).find((player) => player.playerId === playerId);
    let tries = 0;
    const attempt = () => {
      if (matchLobby.isActive()) return;
      const ok = matchLobby.joinRoom(mode, match.matchId, match.hostUserId, {
        ranked: true,
        seed: match.seed,
        seat: mine?.seat,
      });
      tries += 1;
      if (!ok && tries < 8) setTimeout(attempt, 400);
    };
    setTimeout(attempt, 300);
  }

  async function poll() {
    const userId = getUserId?.() ?? '';
    if (!userId) {
      if (status) status.textContent = 'Still connecting. Hold on.';
      return;
    }
    let res = null;
    try {
      res = await queueLadder({
        playerId,
        userId,
        name: getPlayerName(),
        color: getPlayerColor(),
        board: boardId,
      });
    } catch {
      res = null;
    }
    if (!searching || !res) return;
    if (res.status === 'join' && res.board === 'koth' && res.matchId) {
      stopSearch();
      startMatch(res);
      return;
    }
    if (res.status === 'matched') {
      if (res.matchId && res.matchId === droppedMatchId) return;
      const players = res.players || [];
      const accepted = boardId === 'teams'
        ? res.board === 'teams' && players.length === 4
        : boardId === 'koth'
          ? res.board === 'koth' && players.length >= 3 && players.length <= 5
          : res.board == null || res.board === '1v1';
      if (!accepted) return;
      stopSearch();
      startMatch(res);
      return;
    }
    if (status && res.status === 'waiting') {
      status.textContent = `${res.looking ?? 1} looking.  ${res.low}–${res.high}`;
    }
  }

  async function beginSearch() {
    if (holdMatch || matchLobby.isActive() || searching) return;
    searching = true;
    note = '';
    if (findBtn) findBtn.textContent = cancelLabel();
    if (boardId === 'teams' || boardId === 'koth') {
      let ready = false;
      try { ready = await ladderQueueReady(boardId); } catch { ready = false; }
      if (!searching) return;
      if (!ready) {
        stopSearch();
        note = boardId === 'koth'
          ? 'KOTH queue is not on the server yet.'
          : '2v2 queue is not on the server yet.';
        paint();
        return;
      }
    }
    void poll();
    pollTimer = setInterval(() => { void poll(); }, 2000);
  }

  async function showBoard(next) {
    if (next === boardId) return;
    if (searching) await cancelSearch();
    note = '';
    boardId = next;
    page = 0;
    await reload();
    void refreshLooking();
  }

  function closeRecent() {
    shownId = '';
    shownName = '';
    recentGen += 1;
    if (histBack) histBack.hidden = true;
    if (histMeta) histMeta.hidden = true;
    if (hist) hist.hidden = true;
    paint();
  }

  function versus(matchId) {
    const entry = (recentDoc?.recent || []).find((row) => row.matchId === matchId);
    const who = entry?.opponent || '';
    return who ? `${shownName} vs. ${who}` : shownName;
  }

  function paintSnapshot(doc, matchId) {
    if (!histList) return;
    histList.replaceChildren();
    if (histBack) histBack.hidden = false;
    if (histTitle) histTitle.textContent = versus(matchId);
    if (histMeta) {
      const text = doc?.samples ? snapCaption(doc) : '';
      histMeta.textContent = text;
      histMeta.hidden = !text;
    }
    if (!doc?.samples) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'No snapshot for this match.';
      histList.append(empty);
      return;
    }
    mountMatchSnapshot(histList, doc, { caption: false });
  }

  function paintRecent(doc) {
    recentDoc = doc;
    if (histBack) histBack.hidden = true;
    if (histMeta) histMeta.hidden = true;
    if (histTitle) histTitle.textContent = shownName || 'Recent';
    if (!histList) return;
    histList.replaceChildren();
    const rows = Array.isArray(doc?.recent) ? doc.recent : null;
    if (!rows || !rows.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = rows ? 'No matches yet.' : 'Could not load recent matches.';
      histList.append(empty);
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of ['Date', 'Mode', 'Map', 'Opponent', 'Result', 'MMR']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }
    table.append(head);
    for (const entry of rows) {
      const tr = document.createElement('tr');
      if (entry.matchId) {
        tr.className = 'ladder-match';
        tr.dataset.matchId = entry.matchId;
      }
      const win = entry.result !== 'loss';
      const delta = Number.isFinite(entry.delta) ? entry.delta : 0;
      const cells = [
        [recentWhen(entry.at), 'when'],
        [entry.mode || '', ''],
        [entry.map || '', ''],
        [entry.opponent || '', ''],
        [win ? 'Win' : 'Loss', win ? 'is-win' : 'is-loss'],
        [delta > 0 ? `+${delta}` : String(delta), 'num'],
      ];
      for (const [value, cls] of cells) {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = String(value);
        tr.append(td);
      }
      table.append(tr);
    }
    histList.append(table);
  }

  async function showRecent(row) {
    if (!hist || !row?.playerId) return;
    if (shownId === row.playerId) {
      closeRecent();
      return;
    }
    shownId = row.playerId;
    shownName = row.name || 'Recent';
    const gen = ++recentGen;
    hist.hidden = false;
    if (histTitle) histTitle.textContent = shownName;
    if (histList) {
      histList.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'note';
      loading.textContent = 'Loading…';
      histList.append(loading);
    }
    paint();
    focusMenuEl(histClose);
    let doc = null;
    try {
      doc = await loadLadderRecent(row.playerId, location.origin);
    } catch {
      doc = null;
    }
    if (gen !== recentGen) return;
    paintRecent(doc);
  }

  async function openSnapshot(matchId) {
    const gen = recentGen;
    if (histList) {
      histList.replaceChildren();
      const loading = document.createElement('p');
      loading.className = 'note';
      loading.textContent = 'Loading…';
      histList.append(loading);
    }
    let doc = null;
    try {
      doc = await loadLadderSnapshot(matchId, location.origin);
    } catch {
      doc = null;
    }
    if (gen !== recentGen) return;
    paintSnapshot(doc, matchId);
  }

  function onRosterClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('.ladder-name') : null;
    if (!btn?.dataset.playerId) return;
    const row = (board.rows || []).find((item) => item.playerId === btn.dataset.playerId);
    void showRecent(row || { playerId: btn.dataset.playerId, name: btn.textContent });
  }
  histList?.addEventListener('click', (e) => {
    const tr = e.target instanceof Element ? e.target.closest('tr.ladder-match') : null;
    if (!tr?.dataset.matchId) return;
    void openSnapshot(tr.dataset.matchId);
  });
  histBack?.addEventListener('click', () => paintRecent(recentDoc));
  histClose?.addEventListener('click', () => closeRecent());
  hist?.addEventListener('click', (e) => {
    if (e.target === hist) closeRecent();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !hist || hist.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    closeRecent();
  }, true);
  topEl?.addEventListener('click', onRosterClick);
  aroundEl?.addEventListener('click', onRosterClick);
  pageEl?.addEventListener('click', onRosterClick);

  openBtn.addEventListener('click', () => setOpen(pop.hidden));
  closeBtn?.addEventListener('click', () => {
    if (searching) void cancelSearch();
    setOpen(false);
  });
  goCancel?.addEventListener('click', () => { void cancelConnect(); });
  findBtn?.addEventListener('click', () => {
    if (searching) void cancelSearch();
    else void beginSearch();
  });
  board1?.addEventListener('click', () => { void showBoard('1v1'); });
  boardTeams?.addEventListener('click', () => { void showBoard('teams'); });
  boardHill?.addEventListener('click', () => { void showBoard('koth'); });
  prev?.addEventListener('click', () => {
    page -= 1;
    paint();
  });
  next?.addEventListener('click', () => {
    page += 1;
    paint();
  });

  const tickTimer = setInterval(() => refresh(), 200);

  function refresh() {
    const state = matchLobby.isActive() ? matchLobby.getState() : null;
    if (state?.ranked && state.phase === 'playing') played = true;
    if (played && (!state || state.phase === 'idle')) {
      played = false;
      setOpen(true);
    }
    const matchOver = document.getElementById('match-over');
    const counting = Boolean(
      state?.ranked
      && state.phase !== 'playing'
      && state.phase !== 'idle'
      && matchOver?.hidden !== false,
    );
    if (!counting) {
      if (go) go.hidden = true;
      return;
    }
    if (go) go.hidden = false;
    if (goCount) {
      const ms = matchLobby.countdownMs?.() ?? 0;
      paintCount(state.phase === 'countdown' ? String(Math.max(1, Math.ceil(ms / 1000))) : 'Connecting');
    }
  }

  return {
    refresh,
    requeue() { void requeueAfterDrop(); },
    close() {
      if (searching) void cancelSearch();
      setOpen(false);
    },
    dispose() {
      clearInterval(tickTimer);
      if (lookTimer) clearInterval(lookTimer);
      stopSearch();
    },
  };
}
