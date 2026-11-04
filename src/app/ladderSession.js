import { postLadderIncident, postLadderKoth, postLadderReport, postLadderSnapshot } from './ladderApi.js';
import { mapLabels, mapLine } from './matchSnapshotView.js';

let assignment = null;
let finished = false;
let settledBy = '';
let snapshotSent = false;
let lossGen = 0;
let disconnectTimer = null;
let claimBody = null;
const postedBounties = new Set();

/** Same window the match lobby waits before a ranked disconnect becomes a loss. */
const DISCONNECT_GRACE_MS = 8000;

function resetLossClaim() {
  lossGen += 1;
  claimBody = null;
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = null;
}

export function setLadderAssignment(next) {
  resetLossClaim();
  assignment = next;
  finished = false;
  settledBy = '';
  snapshotSent = false;
  postedBounties.clear();
}

export function clearLadderAssignment() {
  resetLossClaim();
  assignment = null;
  finished = false;
  settledBy = '';
  snapshotSent = false;
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

function snapshotPlayers(match) {
  if (match.board === 'teams' || match.board === '1v1' || match.board == null) {
    const reported = reportPlayers(match);
    if (reported) return reported.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      name: player.name || '',
    }));
  }
  const players = [];
  for (const raw of match.players || []) {
    if (!raw?.playerId || !Number.isInteger(raw.seat)) continue;
    players.push({ playerId: raw.playerId, seat: raw.seat, name: raw.name || '' });
  }
  return players.length >= 2 ? players : null;
}

function postMatchSnapshot(session, match, playerId, loss) {
  const snap = session?.snap;
  const players = snapshotPlayers(match);
  if (!snap?.samples?.length || !players || !playerId) return;
  const index = new Map((snap.owners || []).map((owner, i) => [owner | 0, i]));
  const at = (arr, seat) => arr?.[index.get(seat)] | 0;
  const samples = snap.samples.map((sample) => ({
    tick: sample.tick | 0,
    villagers: players.map((player) => at(sample.v, player.seat)),
    army: players.map((player) => at(sample.a, player.seat)),
    income: players.map((player) => at(sample.i, player.seat)),
    bank: players.map((player) => at(sample.b, player.seat)),
    actions: players.map((player) => at(sample.p, player.seat)),
  }));
  const seats = new Set(players.map((player) => player.seat));
  const bySeat = new Map(players.map((player) => [player.seat, player.playerId]));
  const tech = [];
  for (const row of snap.tech || []) {
    if (!seats.has(row.owner | 0)) continue;
    tech.push({
      playerId: bySeat.get(row.owner | 0),
      kind: row.kind,
      id: row.id,
      tick: row.tick | 0,
    });
  }
  const stats = players.map((player) => {
    const src = session.ownerStats?.[player.seat] || {};
    return {
      playerId: player.playerId,
      kills: src.kills | 0,
      losses: src.losses | 0,
      trained: src.trained | 0,
      razes: src.razes | 0,
      buildingsLost: src.buildingsLost | 0,
      gathered: src.gathered | 0,
      spent: src.spent | 0,
    };
  });
  const map = mapLabels(session?.replayGarden, session?.replayConfig);
  const line = mapLine(session?.replayGarden, session?.replayConfig);
  void postLadderSnapshot({
    matchId: match.matchId,
    playerId,
    tick: snap.tick | 0,
    players,
    samples,
    tech,
    stats,
    ...(line ? { map: line } : null),
    ...(map.type ? { mapType: map.type } : null),
    ...(map.size ? { mapSize: map.size } : null),
    ...(map.seed ? { mapSeed: map.seed } : null),
    ...(loss === 'forfeit' || loss === 'disconnect' ? { loss } : null),
  }).then((res) => {
    if (res?.ok === false) console.warn('[ladder] snapshot rejected', res.error || res.status);
  }).catch(() => {});
  return true;
}

export function noteLadderResult(session, playerId) {
  const match = assignment;
  if (!match || !playerId) return;
  if (!snapshotSent && postMatchSnapshot(session, match, playerId, finished ? (settledBy || 'forfeit') : '')) {
    snapshotSent = true;
  }
  if (finished) return;
  if (session?.matchWinner == null || session.matchWinner < 0) return;
  const players = reportPlayers(match);
  if (!players) return;
  finished = true;
  const line = mapLine(session?.replayGarden, session?.replayConfig);
  void postLadderReport({
    board: match.board === 'teams' ? 'teams' : '1v1',
    matchId: match.matchId,
    playerId,
    tick: session.confirmedTick | 0,
    checksum: session._lastChecksum ?? 0,
    winnerSeat: session.matchWinner | 0,
    players,
    ...(line ? { map: line } : null),
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
    const line = mapLine(session?.replayGarden, session?.replayConfig);
    noteKothElimination({
      matchId: match.matchId,
      tick: event.tick | 0,
      checksum: session._lastChecksum ?? 0,
      victimId: victim.playerId,
      survivorIds,
      points: event.points | 0,
      playerId: match.you,
      ...(line ? { map: line } : null),
    });
    postMatchSnapshot(session, match, match.you);
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

function reportedRoster() {
  return assignment ? reportPlayers(assignment) : null;
}

function seatForPlayer(players, playerId) {
  return players.find((player) => player.playerId === playerId)?.seat ?? null;
}

function seatForUser(players, lobbyUserId) {
  const raw = (assignment?.players || []).find((player) => player.userId === lobbyUserId);
  if (!raw?.playerId) return null;
  return seatForPlayer(players, raw.playerId);
}

function winnerAgainst(players, loserSeat) {
  const loser = players.find((player) => player.seat === loserSeat);
  if (!loser) return null;
  const team = loser.team ?? loser.seat;
  const foe = players.find((player) => (player.team ?? player.seat) !== team);
  return foe ? foe.seat : null;
}

function lossBody(playerId, winnerSeat, loss, sim) {
  const match = assignment;
  const players = reportedRoster();
  if (!match || match.board !== '1v1' || !players || winnerSeat == null || !playerId) return null;
  const line = mapLine(sim?.replayGarden, sim?.replayConfig);
  return {
    board: '1v1',
    matchId: match.matchId,
    playerId,
    tick: 0,
    checksum: 0,
    winnerSeat,
    players,
    loss,
    ...(line ? { map: line } : null),
  };
}

function postLoss(body, gen) {
  postLadderReport(body).then((res) => {
    if (gen !== lossGen) return;
    if (res?.status !== 'pending' || body.lossConfirm !== true) return;
    disconnectTimer = setTimeout(() => postLoss(body, gen), DISCONNECT_GRACE_MS);
    disconnectTimer.unref?.();
  }).catch(() => {});
}

/** Forfeit button. The player who leaves takes the loss immediately. */
export function noteLadderSelfForfeit(playerId, sim) {
  const players = reportedRoster();
  if (!assignment || finished || assignment.board !== '1v1' || !players || !playerId) return;
  const winnerSeat = winnerAgainst(players, seatForPlayer(players, playerId));
  const body = lossBody(playerId, winnerSeat, 'forfeit', sim);
  if (!body) return;
  finished = true;
  settledBy = 'forfeit';
  resetLossClaim();
  postLoss(body, lossGen);
}

/** The opponent pressed Forfeit. Their side loses. */
export function noteLadderForfeitBy(lobbyUserId, playerId, sim) {
  const players = reportedRoster();
  if (!assignment || finished || assignment.board !== '1v1' || !players || !playerId) return;
  const winnerSeat = winnerAgainst(players, seatForUser(players, lobbyUserId));
  const body = lossBody(playerId, winnerSeat, 'forfeit', sim);
  if (!body) return;
  finished = true;
  settledBy = 'forfeit';
  resetLossClaim();
  postLoss(body, lossGen);
}

/** Link dropped or confirms stopped. The loss is not final until the grace expires. */
export function beginLadderDisconnect(lobbyUserId, playerId, sim) {
  const players = reportedRoster();
  if (!assignment || finished || assignment.board !== '1v1' || !players || !playerId) return;
  const winnerSeat = winnerAgainst(players, seatForUser(players, lobbyUserId));
  const body = lossBody(playerId, winnerSeat, 'disconnect', sim);
  if (!body) return;
  if (claimBody && claimBody.matchId === body.matchId && claimBody.winnerSeat === body.winnerSeat) return;
  claimBody = body;
  const gen = ++lossGen;
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = null;
  postLoss(body, gen);
}

/** They came back before the grace expired. */
export function cancelLadderDisconnect() {
  if (finished) return;
  const body = claimBody;
  resetLossClaim();
  if (!body) return;
  postLoss({ ...body, loss: 'cancel', lossConfirm: false }, lossGen);
}

/** Grace expired. Record the disconnect as a loss. */
export function confirmLadderDisconnect(lobbyUserId, playerId, sim) {
  const players = reportedRoster();
  if (!assignment || finished || assignment.board !== '1v1' || !players || !playerId) return;
  const winnerSeat = winnerAgainst(players, seatForUser(players, lobbyUserId));
  const body = lossBody(playerId, winnerSeat, 'disconnect', sim);
  if (!body) return;
  body.lossConfirm = true;
  finished = true;
  settledBy = 'disconnect';
  const gen = lossGen;
  postLoss(body, gen);
}

export function noteLadderDisconnect(lobbyUserId, playerId) {
  const match = assignment;
  if (!match || !playerId) return;
  const subject = match.players.find((player) => player.userId === lobbyUserId);
  void postLadderIncident({
    playerId,
    subjectId: subject?.playerId || '',
    matchId: match.matchId,
    kind: 'disconnect',
  }).catch(() => {});
}
