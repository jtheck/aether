import { sameUserId } from './ids.js';
import { getMode } from './modes.js';

/**
 * @typedef {{
 *   index: number,
 *   team: number,
 *   userId: string | null,
 *   name: string,
 *   color: string,
 *   dlc?: string[],
 *   skins?: Record<number, string>,
 *   ready: boolean,
 *   replay?: boolean,
 *   ai?: string,
 *   kind: 'empty' | 'human' | 'ai',
 * }} LobbySeat
 */

/** Lobby Auto cycle. Same ids as the sim temperaments, in play order. */
export const LOBBY_AI_PRESETS = ['passive', 'cautious', 'steady', 'aggressive', 'reckless'];

const LOBBY_AI_LABEL = {
  passive: 'Passive',
  cautious: 'Cautious',
  steady: 'Steady',
  aggressive: 'Aggressive',
  reckless: 'Reckless',
};

/** Cool to hot. Passive barely fights; Reckless is the alarm color. */
const LOBBY_AI_COLOR = {
  passive: '#8ea4b8',
  cautious: '#c6b15a',
  steady: '#d4893a',
  aggressive: '#e15a32',
  reckless: '#ff4d4d',
};

/** @param {string | null | undefined} id */
export function lobbyAiLabel(id) {
  return LOBBY_AI_LABEL[id] || 'Auto';
}

/** @param {string | null | undefined} id */
export function lobbyAiColor(id) {
  return LOBBY_AI_COLOR[id] || '';
}

/** @param {string | null | undefined} id */
export function lobbyAiPreset(id) {
  return LOBBY_AI_PRESETS.includes(id) ? id : '';
}

function copyDlc(list) {
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : [];
}

function copySkins(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<number | string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** @param {string} modeId @returns {LobbySeat[]} */
export function createRoster(modeId) {
  const mode = getMode(modeId);
  const n = mode?.maxPlayers ?? 0;
  const teams = Boolean(mode?.teams);
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    team: teams ? (i < 2 ? 0 : 1) : 0,
    userId: null,
    name: '',
    color: '',
    dlc: [],
    skins: {},
    ready: false,
    ai: '',
    kind: 'empty',
  }));
}

/** @param {LobbySeat[]} seats */
export function cloneRoster(seats) {
  return seats.map((s) => ({ ...s, dlc: copyDlc(s.dlc), skins: copySkins(s.skins) }));
}

/** @param {LobbySeat[]} seats */
export function countHumans(seats) {
  let n = 0;
  for (const s of seats) if (s.kind === 'human') n += 1;
  return n;
}

/** Humans plus Auto seats. Browse count, so a filled computer slot is not an open seat. */
export function countPlaying(seats) {
  let n = 0;
  for (const s of seats) if (s.kind === 'human' || s.kind === 'ai') n += 1;
  return n;
}

/** @param {LobbySeat[]} seats @param {string | null | undefined} userId */
export function seatOf(seats, userId) {
  if (userId == null || userId === '') return null;
  return seats.find((s) => sameUserId(s.userId, userId)) ?? null;
}

/**
 * @param {LobbySeat[]} seats
 * @param {{ userId: string, name?: string, color?: string, dlc?: string[], skins?: Record<number, string>, ready?: boolean }} player
 * @param {number | null} [at] Seat index. Empty means the first open seat. A taken index is refused.
 */
export function claimSeat(seats, player, at = null) {
  const next = cloneRoster(seats);
  if (player?.userId == null || player.userId === '') {
    return { seats: next, index: -1, ok: false };
  }
  const existing = seatOf(next, player.userId);
  if (existing) {
    if (player.name != null) existing.name = player.name;
    if (player.color != null) existing.color = player.color;
    if (player.dlc != null) existing.dlc = copyDlc(player.dlc);
    if (player.skins != null) existing.skins = copySkins(player.skins);
    if (player.ready != null) existing.ready = player.ready;
    return { seats: next, index: existing.index, ok: true };
  }
  const want = Number.isInteger(at) ? at : null;
  const empty = want == null
    ? next.find((s) => s.kind === 'empty')
    : next.find((s) => s.index === want && s.kind === 'empty');
  if (!empty) return { seats: next, index: -1, ok: false };
  empty.userId = player.userId;
  empty.name = player.name ?? '';
  empty.color = player.color ?? '';
  empty.dlc = copyDlc(player.dlc);
  empty.skins = copySkins(player.skins);
  empty.ready = Boolean(player.ready);
  empty.replay = Boolean(player.replay);
  empty.ai = '';
  empty.kind = 'human';
  return { seats: next, index: empty.index, ok: true };
}

/** @param {LobbySeat[]} seats @param {string} userId */
export function releaseSeat(seats, userId) {
  const next = cloneRoster(seats);
  const s = seatOf(next, userId);
  if (!s) return next;
  blankSeat(s);
  return next;
}

/** @param {LobbySeat[]} seats @param {string} userId @param {boolean} replay */
export function setSeatReplay(seats, userId, replay) {
  const next = cloneRoster(seats);
  const s = seatOf(next, userId);
  if (s) s.replay = Boolean(replay);
  return next;
}

/** @param {LobbySeat[]} seats @param {string} userId @param {boolean} ready */
export function setSeatReady(seats, userId, ready) {
  const next = cloneRoster(seats);
  const s = seatOf(next, userId);
  if (s) s.ready = Boolean(ready);
  return next;
}

/** @param {LobbySeat[]} seats */
export function allHumansReady(seats) {
  const humans = seats.filter((s) => s.kind === 'human');
  return humans.length > 0 && humans.every((s) => s.ready);
}

/** Seats that will actually play. Adventure and King of the Hill ignore Auto. */
function playingSeats(mode, seats) {
  const allowAi = Boolean(mode?.allowAi);
  const out = [];
  for (const s of seats) {
    if (s.kind === 'human' || (allowAi && s.kind === 'ai')) out.push(s);
  }
  return out;
}

/** Teams needs a player or Auto on each side. Empty seats do not count. */
function bothTeamsOccupied(playing) {
  let team0 = false;
  let team1 = false;
  for (const s of playing) {
    if (s.team === 0) team0 = true;
    else if (s.team === 1) team1 = true;
    if (team0 && team1) return true;
  }
  return false;
}

/** @param {string} modeId @param {LobbySeat[]} seats */
export function canStart(modeId, seats) {
  const mode = getMode(modeId);
  if (!mode) return false;
  const playing = playingSeats(mode, seats);
  const humans = playing.filter((s) => s.kind === 'human');
  if (humans.length < 1 || playing.length < mode.minHumans) return false;
  if (mode.teams && !bothTeamsOccupied(playing)) return false;
  return humans.every((s) => s.ready);
}

/**
 * @typedef {{ userId: string, name: string, color: string }} LobbySpectator
 */

/** @param {LobbySpectator[]} list @param {{ userId?: string, name?: string, color?: string }} player */
export function addSpectator(list, player) {
  const next = (list ?? []).map((s) => ({ ...s }));
  if (player?.userId == null || player.userId === '') return { spectators: next, ok: false };
  const existing = next.find((s) => sameUserId(s.userId, player.userId));
  if (existing) {
    if (player.name != null) existing.name = player.name;
    if (player.color != null) existing.color = player.color;
    return { spectators: next, ok: true };
  }
  next.push({
    userId: player.userId,
    name: player.name ?? '',
    color: player.color ?? '',
  });
  return { spectators: next, ok: true };
}

/** @param {LobbySpectator[]} list @param {string | null | undefined} userId */
export function removeSpectator(list, userId) {
  return (list ?? []).filter((s) => !sameUserId(s.userId, userId));
}

function blankSeat(seat) {
  seat.userId = null;
  seat.name = '';
  seat.color = '';
  seat.dlc = [];
  seat.skins = {};
  seat.ready = false;
  seat.replay = false;
  seat.ai = '';
  seat.kind = 'empty';
}

function writeSeat(seat, player, hostId) {
  seat.userId = player.userId;
  seat.name = player.name ?? '';
  seat.color = player.color ?? '';
  seat.dlc = copyDlc(player.dlc);
  seat.skins = copySkins(player.skins);
  seat.kind = 'human';
  seat.ready = sameUserId(player.userId, hostId);
  seat.replay = Boolean(player.replay);
  seat.ai = '';
}

function swapSeatPlayers(a, b) {
  const hold = {
    userId: a.userId,
    name: a.name,
    color: a.color,
    dlc: copyDlc(a.dlc),
    skins: copySkins(a.skins),
    ready: a.ready,
    replay: Boolean(a.replay),
    ai: a.ai || '',
    kind: a.kind,
  };
  a.userId = b.userId;
  a.name = b.name;
  a.color = b.color;
  a.dlc = copyDlc(b.dlc);
  a.skins = copySkins(b.skins);
  a.ready = b.ready;
  a.replay = Boolean(b.replay);
  a.ai = b.ai || '';
  a.kind = b.kind;
  b.userId = hold.userId;
  b.name = hold.name;
  b.color = hold.color;
  b.dlc = hold.dlc;
  b.skins = hold.skins;
  b.ready = hold.ready;
  b.replay = hold.replay;
  b.ai = hold.ai;
  b.kind = hold.kind;
}

/**
 * Host cycles one open seat: empty, then each Auto preset, then empty again.
 * A taken seat is refused. Team stays on the seat index.
 * @param {LobbySeat[]} seats
 * @param {number} index
 */
export function cycleSeatAuto(seats, index) {
  const next = cloneRoster(seats);
  const seat = next.find((s) => s.index === index);
  if (!seat || seat.kind === 'human') return { seats: next, ok: false };
  if (seat.kind !== 'ai') {
    seat.kind = 'ai';
    seat.ai = LOBBY_AI_PRESETS[0];
    seat.userId = null;
    seat.name = '';
    seat.color = '';
    seat.dlc = [];
    seat.skins = {};
    seat.ready = false;
    seat.replay = false;
    return { seats: next, ok: true };
  }
  const at = LOBBY_AI_PRESETS.indexOf(seat.ai);
  if (at < 0 || at + 1 >= LOBBY_AI_PRESETS.length) {
    blankSeat(seat);
    return { seats: next, ok: true };
  }
  seat.ai = LOBBY_AI_PRESETS[at + 1];
  return { seats: next, ok: true };
}

/**
 * Host moves one person one row. Seats stay in index order, then Watching.
 * Crossing into Watching frees the seat. Crossing out fills the bottom open seat,
 * or swaps with the last seat when the roster is full. The host stays ready.
 * @param {LobbySeat[]} seats
 * @param {LobbySpectator[]} spectators
 * @param {string} userId
 * @param {number} dir -1 up, +1 down
 * @param {{ hostId?: string, allowSpectators?: boolean, teams?: boolean, seatIndex?: number }} [opts]
 */
export function moveRosterPerson(seats, spectators, userId, dir, opts = {}) {
  const nextSeats = cloneRoster(seats);
  const nextSpecs = (spectators ?? []).map((s) => ({ ...s }));
  const priorIndex = new Map(
    seats.filter((s) => s.kind === 'human' && s.userId).map((s) => [s.userId, s.index]),
  );
  const priorTeam = new Map(
    seats.filter((s) => s.kind === 'human' && s.userId).map((s) => [s.userId, s.team]),
  );
  const allowSpectators = opts.allowSpectators !== false;
  const hostId = opts.hostId;
  let seat = userId ? seatOf(nextSeats, userId) : null;
  if (!seat && Number.isInteger(opts.seatIndex)) {
    seat = nextSeats.find((s) => s.index === opts.seatIndex && s.kind === 'ai') ?? null;
  }
  const specIndex = userId ? nextSpecs.findIndex((s) => sameUserId(s.userId, userId)) : -1;
  if (!seat && specIndex < 0) return { seats: nextSeats, spectators: nextSpecs, ok: false };

  if (seat && opts.teams) {
    const order = [
      ...nextSeats.filter((s) => s.team === 0),
      ...nextSeats.filter((s) => s.team === 1),
    ];
    const pos = order.findIndex((s) => s.index === seat.index);
    const onTeam = nextSeats.filter((s) => s.team === seat.team).length;
    const neighbor = dir < 0 ? order[pos - 1] : order[pos + 1];
    if (neighbor && neighbor.team !== seat.team) {
      if (onTeam <= 1) return { seats: nextSeats, spectators: nextSpecs, ok: false };
      seat.team = neighbor.team;
    } else if (neighbor) {
      swapSeatPlayers(seat, neighbor);
    } else if (dir > 0 && allowSpectators && seat.kind === 'human') {
      nextSpecs.unshift({
        userId: seat.userId, name: seat.name, color: seat.color, replay: Boolean(seat.replay),
      });
      blankSeat(seat);
    } else {
      return { seats: nextSeats, spectators: nextSpecs, ok: false };
    }
  } else if (seat) {
    if (dir < 0) {
      if (seat.index <= 0) return { seats: nextSeats, spectators: nextSpecs, ok: false };
      swapSeatPlayers(nextSeats[seat.index], nextSeats[seat.index - 1]);
    } else if (seat.index < nextSeats.length - 1) {
      swapSeatPlayers(nextSeats[seat.index], nextSeats[seat.index + 1]);
    } else if (allowSpectators && seat.kind === 'human') {
      nextSpecs.unshift({
        userId: seat.userId, name: seat.name, color: seat.color, replay: Boolean(seat.replay),
      });
      blankSeat(seat);
    } else {
      return { seats: nextSeats, spectators: nextSpecs, ok: false };
    }
  } else if (dir > 0) {
    if (specIndex >= nextSpecs.length - 1) return { seats: nextSeats, spectators: nextSpecs, ok: false };
    const hold = nextSpecs[specIndex];
    nextSpecs[specIndex] = nextSpecs[specIndex + 1];
    nextSpecs[specIndex + 1] = hold;
  } else if (specIndex > 0) {
    const hold = nextSpecs[specIndex];
    nextSpecs[specIndex] = nextSpecs[specIndex - 1];
    nextSpecs[specIndex - 1] = hold;
  } else {
    const empty = [...nextSeats].reverse().find((s) => s.kind === 'empty');
    const spec = nextSpecs[specIndex];
    if (empty) {
      writeSeat(empty, spec, hostId);
      nextSpecs.splice(specIndex, 1);
    } else if (nextSeats.length) {
      const last = nextSeats[nextSeats.length - 1];
      const displaced = last.kind === 'human'
        ? { userId: last.userId, name: last.name, color: last.color, replay: Boolean(last.replay) }
        : null;
      writeSeat(last, spec, hostId);
      if (displaced?.userId) nextSpecs[specIndex] = displaced;
      else nextSpecs.splice(specIndex, 1);
    } else {
      return { seats: nextSeats, spectators: nextSpecs, ok: false };
    }
  }

  for (const s of nextSeats) {
    if (s.kind !== 'human' || !s.userId) continue;
    if (priorIndex.get(s.userId) === s.index && priorTeam.get(s.userId) === s.team) continue;
    s.ready = sameUserId(s.userId, hostId);
  }
  return { seats: nextSeats, spectators: nextSpecs, ok: true };
}

/** @param {LobbySpectator[]} list @param {string | null | undefined} userId */
export function spectatorOf(list, userId) {
  if (userId == null || userId === '') return null;
  return (list ?? []).find((s) => sameUserId(s.userId, userId)) ?? null;
}

/** @param {string} modeId @param {LobbySeat[]} seats */
export function startBlockReason(modeId, seats) {
  const mode = getMode(modeId);
  if (!mode) return 'Unknown mode';
  const playing = playingSeats(mode, seats);
  const humans = playing.filter((s) => s.kind === 'human');
  if (humans.length < 1 || playing.length < mode.minHumans) {
    return mode.minHumans <= 1 ? 'Need a player' : `Need ${mode.minHumans} players`;
  }
  if (mode.teams && !bothTeamsOccupied(playing)) return 'Need both teams';
  if (!humans.every((s) => s.ready)) return 'Waiting for ready';
  return '';
}
