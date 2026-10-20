import { START_RATING } from './elo.js';
import { INDEX_KEY, boardDocument, boardKey, mergeIndex } from './publish.js';
import { countLooking, handleLeave, handleName, handleQueue } from './queue.js';
import {
  boardPartition,
  judgeReports,
  parseReport,
  playerKey,
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
        const which = event.queryStringParameters.board === 'teams' ? 'teams' : '1v1';
        const looking = await countLooking(store, clock(), which);
        return respond(200, { ok: true, looking, board: which }, origin, origins);
      }
      if (board === '1v1' || board === 'teams') {
        const raw = await store.getObject(boardKey(season, board));
        let doc = { season, board, updatedAt: now(), rows: [] };
        if (raw) {
          try { doc = JSON.parse(raw); } catch { /* keep the empty board */ }
        }
        return respond(200, doc, origin, origins);
      }
      return respond(200, { ok: true, season, boards: ['1v1', 'teams'] }, origin, origins);
    }
    if (method !== 'POST') return respond(405, { ok: false, error: 'method not allowed' }, origin, origins);

    const raw = readBody(event);
    if (raw.length > 8192) return respond(400, { ok: false, error: 'body too large' }, origin, origins);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return respond(400, { ok: false, error: 'invalid json' }, origin, origins);
    }

    if (body?.action === 'name') {
      const named = await handleName(store, body, { season });
      if (named.body?.updated) {
        for (const namedBoard of named.body.boards || []) {
          await publish(store, { season, envSeason: season, board: namedBoard, now });
        }
      }
      return respond(named.status, named.body, origin, origins);
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

    const parsed = parseReport(body);
    if (!parsed.ok) return respond(400, { ok: false, error: parsed.error }, origin, origins);
    const { report, canonical } = parsed;
    const resultPk = resultPartition(report.board, report.matchId);

    const already = await store.getItem(resultPk, SETTLED);
    if (already) {
      await publish(store, { season: already.season, envSeason: season, board: report.board, now });
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
          at: now(),
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
