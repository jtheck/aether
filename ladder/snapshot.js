// One agreed graph per match. Names are display-only and stay out of the canonical line.

import { isLadderPlayerId, isMatchId } from './recent.js';

const KINDS = new Set(['building', 'research']);
const TECH_ID = /^[a-z]{2,16}$/;
const MAX_SAMPLES = 241;
const MAX_TECH = 64;
const MAX_N = 1000000;

function label(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 48);
}

function int(value, max = MAX_N) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

function series(list, count) {
  if (!Array.isArray(list) || list.length !== count) return null;
  const out = [];
  for (let i = 0; i < count; i++) {
    const n = int(list[i]);
    if (n == null) return null;
    out.push(n);
  }
  return out;
}

/**
 * @returns {{ ok: true, snapshot: object, canonical: string, reporterId: string } | { ok: false, error: string }}
 */
export function parseSnapshot(body) {
  if (!body || body.action !== 'snapshot') return { ok: false, error: 'not a snapshot' };
  const matchId = String(body.matchId ?? '').toLowerCase();
  if (!isMatchId(matchId)) return { ok: false, error: 'invalid match' };
  const reporterId = String(body.playerId ?? '').toLowerCase();
  if (!isLadderPlayerId(reporterId)) return { ok: false, error: 'invalid player' };
  const tick = int(body.tick, 1e12);
  if (tick == null) return { ok: false, error: 'invalid tick' };
  if (!Array.isArray(body.players) || body.players.length < 2 || body.players.length > 5) {
    return { ok: false, error: 'players' };
  }
  const players = [];
  const seats = new Set();
  const ids = new Set();
  for (const raw of body.players) {
    const playerId = String(raw?.playerId ?? '').toLowerCase();
    const seat = int(raw?.seat, 15);
    if (!isLadderPlayerId(playerId) || seat == null || seats.has(seat) || ids.has(playerId)) {
      return { ok: false, error: 'players' };
    }
    seats.add(seat);
    ids.add(playerId);
    const name = String(raw?.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
    players.push({ playerId, seat, name, index: players.length });
  }
  players.sort((a, b) => a.seat - b.seat);
  const order = players.map((player) => player.index);
  for (const player of players) delete player.index;
  if (!ids.has(reporterId)) return { ok: false, error: 'reporter' };
  if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > MAX_SAMPLES) {
    return { ok: false, error: 'samples' };
  }
  const count = players.length;
  const align = (list) => {
    const row = series(list, count);
    if (!row) return null;
    return order.map((index) => row[index]);
  };
  const samples = [];
  let prev = -1;
  for (const raw of body.samples) {
    const at = int(raw?.tick, 1e12);
    if (at == null || at <= prev || at > tick) return { ok: false, error: 'samples' };
    prev = at;
    const villagers = align(raw?.villagers);
    const army = align(raw?.army);
    const income = align(raw?.income);
    const bank = align(raw?.bank);
    const actions = align(raw?.actions);
    if (!villagers || !army || !income || !bank || !actions) return { ok: false, error: 'samples' };
    samples.push({ tick: at, villagers, army, income, bank, actions });
  }
  if (samples[samples.length - 1].tick !== tick) return { ok: false, error: 'samples' };
  if (!Array.isArray(body.tech) || body.tech.length > MAX_TECH) return { ok: false, error: 'tech' };
  const tech = [];
  const seenTech = new Set();
  for (const raw of body.tech) {
    const playerId = String(raw?.playerId ?? '').toLowerCase();
    const kind = raw?.kind === 'research' ? 'research' : raw?.kind === 'building' ? 'building' : '';
    const id = String(raw?.id ?? '');
    const at = int(raw?.tick, 1e12);
    if (!ids.has(playerId) || !KINDS.has(kind) || !TECH_ID.test(id) || at == null || at > tick) {
      return { ok: false, error: 'tech' };
    }
    const key = `${playerId}:${kind}:${id}`;
    if (seenTech.has(key)) return { ok: false, error: 'tech' };
    seenTech.add(key);
    tech.push({ playerId, kind, id, tick: at });
  }
  tech.sort((a, b) => a.tick - b.tick || a.playerId.localeCompare(b.playerId) || a.id.localeCompare(b.id));
  if (!Array.isArray(body.stats) || body.stats.length !== count) return { ok: false, error: 'stats' };
  const stats = [];
  const seenStats = new Set();
  for (const raw of body.stats) {
    const playerId = String(raw?.playerId ?? '').toLowerCase();
    if (!ids.has(playerId) || seenStats.has(playerId)) return { ok: false, error: 'stats' };
    seenStats.add(playerId);
    const row = { playerId };
    for (const key of ['kills', 'losses', 'trained', 'razes', 'buildingsLost', 'gathered', 'spent']) {
      const n = int(raw?.[key]);
      if (n == null) return { ok: false, error: 'stats' };
      row[key] = n;
    }
    stats.push(row);
  }
  stats.sort((a, b) => a.playerId.localeCompare(b.playerId));
  const named = new Map(players.map((player) => [player.playerId, player.name]));
  for (const row of stats) row.name = named.get(row.playerId) || '';
  const map = label(body.map);
  const mapType = label(body.mapType);
  const mapSize = label(body.mapSize);
  const mapSeed = label(body.mapSeed);
  const snapshot = { matchId, tick, players, samples, tech, stats };
  if (map) snapshot.map = map;
  if (mapType) snapshot.mapType = mapType;
  if (mapSize) snapshot.mapSize = mapSize;
  if (/^\d{1,12}$/.test(mapSeed)) snapshot.mapSeed = mapSeed;
  return { ok: true, snapshot, canonical: canonicalSnapshot(snapshot), reporterId };
}

export function canonicalSnapshot(snapshot) {
  return JSON.stringify({
    matchId: snapshot.matchId,
    tick: snapshot.tick,
    players: snapshot.players.map((player) => [player.playerId, player.seat]),
    samples: snapshot.samples,
    tech: snapshot.tech.map((row) => [row.playerId, row.kind, row.id, row.tick]),
    stats: snapshot.stats.map((row) => [
      row.playerId, row.kills, row.losses, row.trained, row.razes, row.buildingsLost, row.gathered, row.spent,
    ]),
  });
}
