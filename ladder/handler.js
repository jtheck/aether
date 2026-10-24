import { START_RATING } from './elo.js';
import { INDEX_KEY, boardDocument, boardKey, mergeIndex } from './publish.js';
import { countLooking, handleHill, handleHillSplit, handleLeave, handleName, handleQueue } from './queue.js';
import {
  historyPuts,
  isLadderPlayerId,
  isMatchId,
  matchSnapshotKey,
  playerRecentKey,
  recentPartition,
  RECENT_SK,
} from './recent.js';
import { parseSnapshot } from './snapshot.js';
import {
  boardPartition,
  judgeReports,
  parseKothReport,
  parseReport,
  playerKey,
  rateElimination,
  rateMatch,
  resultPartition,
} from './report.js';

const SETTLED = 'settled';

function header(headers, name) {
  if (!headers) return '';
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  }
  return '';
}

function responseHeaders(origin, allowedOrigins) {
  const headers = {
    'content-type': 'application/json',
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  };
  if (origin && allowedOrigins.includes(origin.toLowerCase())) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'origin';
  }
  return headers;
}

function respond(statusCode, body, origin, allowedOrigins) {
  return {
    statusCode,
    headers: responseHeaders(origin, allowedOrigins),
    body: JSON.stringify(body),
  };
}

function readBody(event) {
  if (!event?.body) return '';
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64').toString('utf8');
  return String(event.body);
}

async function loadRatings(store, season, report) {
  const pk = boardPartition(report.board, season);
  const ratings = {};
  for (const player of report.players) {
    const row = await store.getItem(pk, playerKey(player.playerId));
    ratings[player.playerId] = {
      rating: row?.rating ?? START_RATING,
      games: row?.games ?? 0,
      wins: row?.wins ?? 0,
    };
  }
  return ratings;
}

async function writeBoard(store, season, board, now) {
  const rows = await store.listByPrefix(boardPartition(board, season), 'p#');
  const doc = boardDocument({
    season,
    board,
    rows,
    updatedAt: now(),
  });
  await store.putObject(boardKey(season, board), JSON.stringify(doc));
  return doc;
}

async function writeIndex(store, season, board) {
  const raw = await store.getObject(INDEX_KEY);
  let existing = null;
  if (raw) {
    try {
      existing = JSON.parse(raw);
    } catch {
      existing = null;
    }
  }
  const index = mergeIndex(existing, { season, board });
  await store.putObject(INDEX_KEY, JSON.stringify(index));
  return index;
}

async function publish(store, { season, envSeason, board, now }) {
  const doc = await writeBoard(store, season, board, now);
  if (season === envSeason) await writeIndex(store, season, board);
  return doc;
}

async function loadHistories(store, playerIds) {
  const loaded = {};
  for (const playerId of playerIds) {
    loaded[playerId] = await store.getItem(recentPartition(playerId), RECENT_SK);
  }
  return loaded;
}

async function ladderName(store, season, playerId) {
  for (const board of ['1v1', 'teams', 'koth']) {
    const row = await store.getItem(boardPartition(board, season), playerKey(playerId));
    const name = String(row?.name || '').trim();
    if (name) return name;
  }
  return 'Player';
}

function sideNames(players) {
  return players.map((player) => player.name || 'Player').join(', ') || 'Player';
}

function matchEntries(report, rated, at) {
  const winner = report.players.find((player) => player.seat === report.winnerSeat);
  const mode = report.board === 'teams' ? '2v2' : '1v1';
  const entries = {};
  for (const row of rated) {
    const player = report.players.find((item) => item.playerId === row.playerId);
    const opponents = report.players.filter((item) => item.team !== player.team);
    entries[row.playerId] = {
      at,
      mode,
      result: player.team === winner.team ? 'win' : 'loss',
      opponent: sideNames(opponents),
      delta: row.delta,
      rating: row.rating,
      matchId: report.matchId,
    };
  }
  return entries;
}

function kothEntries(report, rated, names, at) {
  const victimName = names[report.victimId] || 'Player';
  const survivorName = report.survivorIds.map((id) => names[id] || 'Player').join(', ') || 'Player';
  const entries = {};
  for (const row of rated) {
    const won = row.playerId !== report.victimId;
    entries[row.playerId] = {
      at,
      mode: 'KOTH',
      result: won ? 'win' : 'loss',
      opponent: won ? victimName : survivorName,
      delta: row.delta,
      rating: row.rating,
      matchId: report.matchId,
    };
  }
  return entries;
}

async function acceptSnapshot(store, parsed, now) {
  const pk = `snap#${parsed.snapshot.matchId}`;
  await store.putItem({
    pk,
    sk: `p#${parsed.reporterId}`,
    playerId: parsed.reporterId,
    canonical: parsed.canonical,
    snapshot: parsed.snapshot,
  });
  const rows = await store.listByPrefix(pk, 'p#');
  const agreed = rows.filter((row) => row.canonical === parsed.canonical);
  const reporters = new Set(agreed.map((row) => row.playerId));
  if (reporters.size < 2) return { status: 200, body: { ok: true, status: 'pending' } };
  const doc = { ...parsed.snapshot, updatedAt: now() };
  await store.putObject(matchSnapshotKey(parsed.snapshot.matchId), JSON.stringify(doc));
  return { status: 200, body: { ok: true, status: 'saved' } };
}

async function publishRecent(store, playerIds, now) {
  for (const playerId of playerIds) {
    if (!isLadderPlayerId(playerId)) continue;
    const row = await store.getItem(recentPartition(playerId), RECENT_SK);
    if (!row) continue;
    const doc = {
      playerId,
      updatedAt: now(),
      recent: Array.isArray(row.recent) ? row.recent : [],
    };
    await store.putObject(playerRecentKey(playerId), JSON.stringify(doc));
  }
}

/**
 * @param {object} opts
 * @param {object} opts.store
 * @param {string} opts.season
 * @param {string[]} [opts.allowedOrigins]
 * @param {() => string} [opts.now]
 */
async function recordIncident(store, { season, kind, matchId, reporterId, subjectId, detail, at }) {
  const subject = subjectId || reporterId;
  if (!subject) return;
  await store.putItem({
    pk: `incident#${subject}`,
    sk: `${at}#${kind}#${matchId || 'none'}`,
    season,
    kind,
    matchId: matchId || '',
    reporterId: reporterId || '',
    subjectId: subject,
    detail: detail || '',
    at,
  });
}

async function settleKoth(store, { season, report, canonical, now }) {
  const resultPk = `result#koth#${report.matchId}#${report.tick}#${report.victimId}`;
  const already = await store.getItem(resultPk, SETTLED);
  if (already) {
    if (already.canonical !== canonical) {
      await recordIncident(store, {
        season,
        kind: 'discrepancy',
        matchId: report.matchId,
        reporterId: report.playerId,
        subjectId: report.victimId,
        detail: 'koth report disagreed',
        at: now(),
      });
      return {
        statusCode: 409,
        rated: false,
        body: { ok: false, status: 'conflict', season, board: 'koth', matchId: report.matchId },
      };
    }
    return {
      statusCode: 200,
      rated: true,
      body: { ok: true, status: 'settled', season: already.season, board: 'koth', matchId: report.matchId, ratings: already.deltas },
    };
  }

  const pk = boardPartition('koth', season);
  const ratings = {};
  const ids = [report.victimId, ...report.survivorIds];
  const names = {};
  for (const id of ids) names[id] = await ladderName(store, season, id);
  let result = { ok: false, reason: 'conflict' };
  let next = [];
  let deltas = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const raced = await store.getItem(resultPk, SETTLED);
    if (raced) {
      result = { ok: false, reason: 'exists' };
      deltas = raced.deltas;
      break;
    }
    for (const id of ids) {
      const row = await store.getItem(pk, playerKey(id));
      ratings[id] = {
        rating: row?.rating ?? START_RATING,
        games: row?.games ?? 0,
        wins: row?.wins ?? 0,
      };
    }
    next = rateElimination(report, ratings);
    deltas = next.map((row) => ({
      playerId: row.playerId,
      rating: row.rating,
      delta: row.delta,
      games: row.games,
      wins: row.wins,
    }));
    const at = now();
    const histories = await loadHistories(store, ids);
    result = await store.settle({
      settled: {
        pk: resultPk,
        sk: SETTLED,
        canonical,
        board: 'koth',
        season,
        matchId: report.matchId,
        tick: report.tick,
        checksum: report.checksum,
        deltas,
        at,
      },
      players: next.map((row) => ({
        pk,
        sk: playerKey(row.playerId),
        playerId: row.playerId,
        name: '',
        oldRating: row.oldRating,
        oldGames: row.oldGames,
        rating: row.rating,
        games: row.games,
        wins: row.wins,
      })),
      histories: historyPuts(kothEntries(report, next, names, at), histories),
    });
    if (result.ok || result.reason === 'exists') break;
  }
  if (!result.ok && result.reason !== 'exists') {
    return { statusCode: 500, rated: false, body: { ok: false, error: 'could not settle' } };
  }
  const settled = result.ok ? null : await store.getItem(resultPk, SETTLED);
  if (settled && settled.canonical !== canonical) {
    return {
      statusCode: 409,
      rated: false,
      body: { ok: false, status: 'conflict', season, board: 'koth', matchId: report.matchId },
    };
  }
  return {
    statusCode: 200,
    rated: true,
    body: {
      ok: true,
      status: 'settled',
      season,
      board: 'koth',
      matchId: report.matchId,
      ratings: settled?.deltas ?? deltas,
    },
  };
}

export function createHandler({
  store,
  season,
  allowedOrigins = [],
  now = () => new Date().toISOString(),
  clock = () => Date.now(),
  random = Math.random,
}) {
  const origins = allowedOrigins.map((origin) => origin.toLowerCase());

  return async function handler(event) {
    const origin = header(event?.headers, 'origin');
    const method = String(event?.requestContext?.http?.method ?? event?.httpMethod ?? 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: responseHeaders(origin, origins), body: '' };
    }
    if (!season) return respond(500, { ok: false, error: 'SEASON is not set' }, origin, origins);

    if (method === 'GET') {
      const board = String(event?.queryStringParameters?.board ?? '');
      if (event?.queryStringParameters?.looking != null) {
        const asked = event.queryStringParameters.board;
        const which = asked === 'teams' || asked === 'koth' ? asked : '1v1';
        const looking = await countLooking(store, clock(), which);
        return respond(200, { ok: true, looking, board: which }, origin, origins);
      }
      const player = String(event?.queryStringParameters?.player ?? '').toLowerCase();
      if (player) {
        if (!isLadderPlayerId(player)) return respond(400, { ok: false, error: 'invalid player' }, origin, origins);
        const rawRecent = await store.getObject(playerRecentKey(player));
        if (rawRecent) {
          try { return respond(200, JSON.parse(rawRecent), origin, origins); } catch { /* rebuild below */ }
        }
        const row = await store.getItem(recentPartition(player), RECENT_SK);
        return respond(200, {
          playerId: player,
          updatedAt: now(),
          recent: Array.isArray(row?.recent) ? row.recent : [],
        }, origin, origins);
      }
      if (board === '1v1' || board === 'teams' || board === 'koth') {
        const raw = await store.getObject(boardKey(season, board));
        let doc = { season, board, updatedAt: now(), rows: [] };
        if (raw) {
          try { doc = JSON.parse(raw); } catch { /* keep the empty board */ }
        }
        return respond(200, doc, origin, origins);
      }
      const match = String(event?.queryStringParameters?.match ?? '').toLowerCase();
      if (match) {
        if (!isMatchId(match)) return respond(400, { ok: false, error: 'invalid match' }, origin, origins);
        const rawSnap = await store.getObject(matchSnapshotKey(match));
        if (!rawSnap) return respond(404, { ok: false, error: 'no snapshot' }, origin, origins);
        try { return respond(200, JSON.parse(rawSnap), origin, origins); } catch {
          return respond(404, { ok: false, error: 'no snapshot' }, origin, origins);
        }
      }
      return respond(200, { ok: true, season, boards: ['1v1', 'teams', 'koth'] }, origin, origins);
    }
    if (method !== 'POST') return respond(405, { ok: false, error: 'method not allowed' }, origin, origins);

    const raw = readBody(event);
    if (raw.length > 65536) return respond(400, { ok: false, error: 'body too large' }, origin, origins);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return respond(400, { ok: false, error: 'invalid json' }, origin, origins);
    }
    if (body?.action === 'snapshot') {
      const parsed = parseSnapshot(body);
      if (!parsed.ok) return respond(400, { ok: false, error: parsed.error }, origin, origins);
      const saved = await acceptSnapshot(store, parsed, now);
      return respond(saved.status, saved.body, origin, origins);
    }
    if (raw.length > 8192) return respond(400, { ok: false, error: 'body too large' }, origin, origins);

    if (body?.action === 'name') {
      const named = await handleName(store, body, { season });
      if (named.body?.updated) {
        for (const namedBoard of named.body.boards || []) {
          await publish(store, { season, envSeason: season, board: namedBoard, now });
        }
      }
      return respond(named.status, named.body, origin, origins);
    }
    if (body?.action === 'hill') {
      const hill = await handleHill(store, body, { now: clock() });
      return respond(hill.status, hill.body, origin, origins);
    }
    if (body?.action === 'hill-split') {
      const split = await handleHillSplit(store, body, { now: clock() });
      return respond(split.status, split.body, origin, origins);
    }
    if (body?.action === 'queue') {
      const queued = await handleQueue(store, body, { season, now: clock(), random });
      return respond(queued.status, queued.body, origin, origins);
    }
    if (body?.action === 'leave') {
      const left = await handleLeave(store, body);
      return respond(left.status, left.body, origin, origins);
    }
    if (body?.action === 'incident') {
      await recordIncident(store, {
        season,
        kind: body.kind === 'disconnect' ? 'disconnect' : 'discrepancy',
        matchId: String(body.matchId ?? '').slice(0, 80),
        reporterId: String(body.playerId ?? '').toLowerCase(),
        subjectId: String(body.subjectId ?? '').toLowerCase(),
        detail: String(body.detail ?? '').slice(0, 240),
        at: now(),
      });
      return respond(200, { ok: true, status: 'recorded' }, origin, origins);
    }

    if (body?.action === 'koth') {
      const parsedKoth = parseKothReport(body);
      if (!parsedKoth.ok) return respond(400, { ok: false, error: parsedKoth.error }, origin, origins);
      const settled = await settleKoth(store, { season, report: parsedKoth.report, canonical: parsedKoth.canonical, now });
      if (settled.rated) {
        await publish(store, { season, envSeason: season, board: 'koth', now });
        await publishRecent(store, [parsedKoth.report.victimId, ...parsedKoth.report.survivorIds], now);
      }
      return respond(settled.statusCode, settled.body, origin, origins);
    }

    const parsed = parseReport(body);
    if (!parsed.ok) return respond(400, { ok: false, error: parsed.error }, origin, origins);
    const { report, canonical } = parsed;
    const resultPk = resultPartition(report.board, report.matchId);

    const already = await store.getItem(resultPk, SETTLED);
    if (already) {
      await publish(store, { season: already.season, envSeason: season, board: report.board, now });
      await publishRecent(store, (already.deltas || []).map((row) => row.playerId), now);
      return respond(200, {
        ok: true,
        status: 'settled',
        season: already.season,
        board: report.board,
        matchId: report.matchId,
        ratings: already.deltas,
      }, origin, origins);
    }

    const put = await store.putReportIfAbsent({
      pk: resultPk,
      sk: playerKey(report.playerId),
      playerId: report.playerId,
      canonical,
      at: now(),
    });
    if (!put.created && put.existing?.canonical !== canonical) {
      await recordIncident(store, {
        season,
        kind: 'discrepancy',
        matchId: report.matchId,
        reporterId: report.playerId,
        subjectId: report.players.find((player) => player.playerId !== report.playerId)?.playerId,
        detail: 'report disagreed with the stored report',
        at: now(),
      });
      return respond(409, {
        ok: false,
        status: 'conflict',
        season,
        board: report.board,
        matchId: report.matchId,
      }, origin, origins);
    }

    const stored = await store.listByPrefix(resultPk, 'p#');
    const judgement = judgeReports(report, stored);
    if (judgement.status === 'conflict') {
      const other = stored.find((row) => row.playerId !== report.playerId);
      await recordIncident(store, {
        season,
        kind: 'discrepancy',
        matchId: report.matchId,
        reporterId: report.playerId,
        subjectId: other?.playerId,
        detail: 'reports disagreed',
        at: now(),
      });
    }
    if (judgement.status !== 'ready') {
      return respond(judgement.status === 'conflict' ? 409 : 200, {
        ok: judgement.status !== 'conflict',
        status: judgement.status,
        season,
        board: report.board,
        matchId: report.matchId,
      }, origin, origins);
    }

    let rated = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await store.getItem(resultPk, SETTLED);
      if (existing) {
        rated = existing.deltas;
        break;
      }
      const ratings = await loadRatings(store, season, report);
      const next = rateMatch(report, ratings);
      const playerPk = boardPartition(report.board, season);
      const at = now();
      const ids = report.players.map((player) => player.playerId);
      const histories = await loadHistories(store, ids);
      const result = await store.settle({
        settled: {
          pk: resultPk,
          sk: SETTLED,
          board: report.board,
          season,
          matchId: report.matchId,
          tick: report.tick,
          checksum: report.checksum,
          winnerSeat: report.winnerSeat,
          deltas: next.map((row) => ({
            playerId: row.playerId,
            rating: row.rating,
            delta: row.delta,
            games: row.games,
            wins: row.wins,
          })),
          at,
        },
        players: next.map((row) => ({
          pk: playerPk,
          sk: playerKey(row.playerId),
          playerId: row.playerId,
          name: report.players.find((player) => player.playerId === row.playerId)?.name || '',
          oldRating: row.oldRating,
          oldGames: row.oldGames,
          rating: row.rating,
          games: row.games,
          wins: row.wins,
        })),
        histories: historyPuts(matchEntries(report, next, at), histories),
      });
      if (result.ok || result.reason === 'exists') {
        const settled = result.ok ? null : await store.getItem(resultPk, SETTLED);
        rated = settled?.deltas ?? next.map((row) => ({
          playerId: row.playerId,
          rating: row.rating,
          delta: row.delta,
          games: row.games,
          wins: row.wins,
        }));
        break;
      }
    }
    if (!rated) return respond(500, { ok: false, error: 'could not settle' }, origin, origins);

    await publish(store, { season, envSeason: season, board: report.board, now });
    await publishRecent(store, report.players.map((player) => player.playerId), now);
    return respond(200, {
      ok: true,
      status: 'settled',
      season,
      board: report.board,
      matchId: report.matchId,
      ratings: rated,
    }, origin, origins);
  };
}
