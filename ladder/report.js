// A ranked report. The season is not in the body — the function stamps SEASON.
// 1v1: exactly two humans, each their own side (team is the seat).
// Teams: two to four humans on exactly two sides. One agreeing report from each side settles it.

import { START_RATING, ratingDelta } from './elo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MATCH_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function playerKey(playerId) {
  return `p#${playerId}`;
}

export function boardPartition(board, season) {
  return `${board}#${season}`;
}

export function resultPartition(board, matchId) {
  return `result#${board}#${matchId}`;
}

function uint32(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < -2147483648 || value > 4294967295) return null;
  return value >>> 0;
}

function seatOf(value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 15) return null;
  return value;
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, report: object, canonical: string } | { ok: false, error: string }}
 */
export function parseReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'body must be an object' };
  }
  const board = body.board === '1v1' || body.board === 'teams' ? body.board : '';
  if (!board) return { ok: false, error: 'board must be 1v1 or teams' };

  const matchId = String(body.matchId ?? '').toLowerCase();
  if (!MATCH_ID.test(matchId)) return { ok: false, error: 'invalid matchId' };

  const reporter = String(body.playerId ?? '').toLowerCase();
  if (!UUID.test(reporter)) return { ok: false, error: 'invalid playerId' };

  if (typeof body.tick !== 'number' || !Number.isInteger(body.tick) || body.tick < 0 || body.tick > 1e12) {
    return { ok: false, error: 'invalid tick' };
  }
  const checksum = uint32(body.checksum);
  if (checksum == null) return { ok: false, error: 'invalid checksum' };
  const winnerSeat = seatOf(body.winnerSeat);
  if (winnerSeat == null) return { ok: false, error: 'invalid winnerSeat' };
  if (!Array.isArray(body.players)) return { ok: false, error: 'players required' };

  const need = board === '1v1' ? 2 : null;
  if (need != null && body.players.length !== need) return { ok: false, error: '1v1 needs two players' };
  if (board === 'teams' && (body.players.length < 2 || body.players.length > 4)) {
    return { ok: false, error: 'teams needs two to four players' };
  }

  const players = [];
  const seenIds = new Set();
  const seenSeats = new Set();
  for (const raw of body.players) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid player' };
    const playerId = String(raw.playerId ?? '').toLowerCase();
    if (!UUID.test(playerId)) return { ok: false, error: 'invalid player' };
    if (seenIds.has(playerId)) return { ok: false, error: 'duplicate player' };
    seenIds.add(playerId);
    const seat = seatOf(raw.seat);
    if (seat == null) return { ok: false, error: 'invalid seat' };
    if (seenSeats.has(seat)) return { ok: false, error: 'duplicate seat' };
    seenSeats.add(seat);
    let team = seat;
    if (board === 'teams') {
      team = seatOf(raw.team);
      if (team == null) return { ok: false, error: 'invalid team' };
    }
    const name = String(raw.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
    players.push({ playerId, seat, team, name });
  }

  if (!seenIds.has(reporter)) return { ok: false, error: 'reporter is not in the match' };
  const winner = players.find((p) => p.seat === winnerSeat);
  if (!winner) return { ok: false, error: 'winner is not in the match' };

  const teams = new Set(players.map((p) => p.team));
  if (teams.size !== 2) return { ok: false, error: 'a match needs two sides' };

  players.sort((a, b) => a.seat - b.seat);
  const report = {
    board,
    matchId,
    playerId: reporter,
    tick: body.tick,
    checksum,
    winnerSeat,
    players,
  };
  return { ok: true, report, canonical: canonicalOf(report) };
}

export function canonicalOf(report) {
  const players = report.players.map((p) => `${p.playerId}:${p.seat}:${p.team}`).join(',');
  return [report.board, report.matchId, report.tick, report.checksum, report.winnerSeat, players].join('|');
}

/**
 * Stored reports are one per player. They settle when every side has a reporter
 * and every stored report carries the same canonical line.
 * @param {object} report normalized report
 * @param {{ playerId: string, canonical: string }[]} stored
 */
export function judgeReports(report, stored) {
  if (stored.some((row) => row.canonical !== canonicalOf(report))) {
    return { status: 'conflict' };
  }
  const reporters = new Set(stored.map((row) => row.playerId));
  const sides = new Set();
  for (const player of report.players) {
    if (reporters.has(player.playerId)) sides.add(player.team);
  }
  const need = new Set(report.players.map((player) => player.team));
  if (sides.size < need.size) return { status: 'pending' };
  return { status: 'ready' };
}

/**
 * @param {object} report
 * @param {Record<string, { rating: number, games: number, wins: number }>} ratings
 */
export function rateMatch(report, ratings) {
  const winner = report.players.find((player) => player.seat === report.winnerSeat);
  const winnerTeam = winner.team;
  return report.players.map((player) => {
    const current = ratings[player.playerId] ?? { rating: START_RATING, games: 0, wins: 0 };
    const others = report.players.filter((other) => other.team !== player.team);
    let sum = 0;
    for (const other of others) {
      sum += ratings[other.playerId]?.rating ?? START_RATING;
    }
    const won = player.team === winnerTeam;
    const delta = ratingDelta(current.rating, sum / others.length, won ? 1 : 0);
    return {
      playerId: player.playerId,
      oldRating: current.rating,
      oldGames: current.games,
      rating: current.rating + delta,
      games: current.games + 1,
      wins: current.wins + (won ? 1 : 0),
      delta,
    };
  });
}
