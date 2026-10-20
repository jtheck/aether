import { postLadderIncident, postLadderKoth, postLadderReport } from './ladderApi.js';

let assignment = null;
let finished = false;
const postedBounties = new Set();

export function setLadderAssignment(next) {
  assignment = next;
  finished = false;
  postedBounties.clear();
}

export function clearLadderAssignment() {
  assignment = null;
  finished = false;
  postedBounties.clear();
}

export function getLadderAssignment() {
  return assignment;
}

function reportPlayers(match) {
  const listed = match.players || [];
  if (match.board === 'teams') {
    const players = [];
    for (const raw of listed) {
      if (!raw?.playerId || !Number.isInteger(raw.seat) || !Number.isInteger(raw.team)) return null;
      players.push({ playerId: raw.playerId, seat: raw.seat, team: raw.team, name: raw.name || '' });
    }
    return players.length >= 2 && players.length <= 4 ? players : null;
  }
  const host = listed.find((player) => player.playerId === match.hostPlayerId);
  const guest = listed.find((player) => player.playerId !== match.hostPlayerId);
  if (!host || !guest) return null;
  return [
    { playerId: host.playerId, seat: 0, name: host.name || '' },
    { playerId: guest.playerId, seat: 1, name: guest.name || '' },
  ];
}

export function noteLadderResult(session, playerId) {
  const match = assignment;
  if (!match || finished || !playerId) return;
  if (session?.matchWinner == null || session.matchWinner < 0) return;
  const players = reportPlayers(match);
  if (!players) return;
  finished = true;
  void postLadderReport({
    board: match.board === 'teams' ? 'teams' : '1v1',
    matchId: match.matchId,
    playerId,
    tick: session.confirmedTick | 0,
    checksum: session._lastChecksum ?? 0,
    winnerSeat: session.matchWinner | 0,
    players,
  }).catch(() => {});
}

/** Ranked hill. Each paying death is one ladder report, once per match and tick. */
export function noteHillBounties(session) {
  const match = assignment;
  if (!match || match.board !== 'koth') return;
  const log = session?.koth?.bounty;
  if (!Array.isArray(log)) return;
  const hill = session.koth;
  for (const event of log) {
    if (!(event?.points > 0)) continue;
    const key = `${match.matchId}|${event.tick | 0}|${event.victim | 0}`;
    if (postedBounties.has(key)) continue;
    const players = match.players || [];
    const victim = players.find((player) => player.seat === (event.victim | 0));
    if (!victim?.playerId) continue;
    const survivorIds = [];
    let missing = false;
    for (const player of players) {
      if (player.seat === (event.victim | 0)) continue;
      if (!hill.active?.[player.seat] || hill.eliminated?.[player.seat]) continue;
      if (!player.playerId) {
        missing = true;
        break;
      }
      survivorIds.push(player.playerId);
    }
    if (missing || !survivorIds.length) continue;
    postedBounties.add(key);
    noteKothElimination({
      matchId: match.matchId,
      tick: event.tick | 0,
      checksum: session._lastChecksum ?? 0,
      victimId: victim.playerId,
      survivorIds,
      points: event.points | 0,
      playerId: match.you,
    });
  }
}

export function noteKothElimination(report) {
  if (!report?.victimId || !(report.points > 0) || !report.survivorIds?.length) {
    return Promise.resolve(false);
  }
  return postLadderKoth(report).then((res) => {
    if (res?.ok === true || res?.status === 'settled' || res?.status === 'conflict') return true;
    if (res?.ok === false) {
      console.warn('[ladder] hill report rejected', res.error || res.status);
      return true;
    }
    return false;
  }).catch((err) => {
    console.warn('[ladder] hill report failed', err);
    return false;
  });
}

export function noteLadderDisconnect(lobbyUserId, playerId) {
  const match = assignment;
  if (!match || finished || !playerId) return;
  const subject = match.players.find((player) => player.userId === lobbyUserId);
  finished = true;
  void postLadderIncident({
    playerId,
    subjectId: subject?.playerId || '',
    matchId: match.matchId,
    kind: 'disconnect',
  }).catch(() => {});
}
