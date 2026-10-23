import { ladderSlices } from './ladderBoard.js';
import { seasonInfo } from './ladderSeason.js';
import { ladderLooking, ladderQueueReady, leaveLadder, loadLadderBoard, queueLadder, touchLadderName } from './ladderApi.js';
import { rememberLadderId } from './ladderId.js';
import { clearLadderAssignment, setLadderAssignment } from './ladderSession.js';
import { getPlayerColor, getPlayerName } from './settings.js';
import { focusMenuEl } from './input/gamepad.js';

function fill(el, rows, playerId) {
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
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.appendChild(td);
    }
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

  let page = 0;
  let boardId = '1v1';
  let board = { rows: [] };
  let looking = null;
  let note = '';
  let searching = false;
  let played = false;
  let pollTimer = 0;
  let lookTimer = 0;
  const playerId = rememberLadderId();

  function findLabel() {
    const type = boardId === 'teams' ? '2v2' : boardId === 'koth' ? 'KOTH' : '1v1';
    return `Find ${type} Ladder Match`;
  }

  function matchNames(match) {
    const players = match.players || [];
    if (match.board === 'koth') {
      return players.map((player) => `${player.name}  ${player.rating}`).join('   ·   ');
    }
    if (match.board !== 'teams') {
      return players.map((player) => `${player.name}  ${player.rating}`).join('   vs   ');
    }
    const label = (side) => side.map((player) => `${player.name}  ${player.rating}`).join(', ');
    const left = players.filter((player) => player.team !== 1);
    const right = players.filter((player) => player.team === 1);
    return `${label(left)}   vs   ${label(right)}`;
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
    fill(topEl, view.top, playerId);
    if (aroundWrap) aroundWrap.hidden = view.around.length === 0;
    fill(aroundEl, view.around, playerId);
    fill(pageEl, view.pageRows, playerId);
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
    if (go) go.hidden = true;
    matchLobby.leaveRoom?.();
    clearLadderAssignment();
    await leaveLadder(playerId, boardId).catch(() => {});
    paint();
  }

  function showCountdown(match) {
    const names = matchNames(match);
    if (goNames) goNames.textContent = names;
    if (goCount) goCount.textContent = 'Connecting';
    if (go) go.hidden = false;
    onCloseMenu?.();
    setOpen(false);
  }

  function startMatch(match) {
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
    if (matchLobby.isActive() || searching) return;
    searching = true;
    note = '';
    if (findBtn) findBtn.textContent = 'Cancel search';
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
      goCount.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(ms / 1000))) : 'Connecting';
    }
  }

  return {
    refresh,
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
