import { postLadderIncident, postLadderReport } from './ladderApi.js';

let assignment = null;
let finished = false;

export function setLadderAssignment(next) {
  assignment = next;
  finished = false;
}

export function clearLadderAssignment() {
  assignment = null;
  finished = false;
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
