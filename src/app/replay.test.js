import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimSession } from './simSession.js';
import {
  buildReplayFile,
  formatReplayBytes,
  jsonByteLength,
  liveConfigFromReplay,
  parseReplayFile,
  replayConfigFromLive,
  replayEndTick,
  replayFileName,
  saveReplayToDisk,
  REPLAY_KIND,
} from './replay.js';

describe('replayConfigFromLive', () => {
  it('keeps worker rebuild fields and drops the garden blob', () => {
    const cfg = replayConfigFromLive({
      seed: 99,
      mode: 'onevsone',
      mapW: 80,
      mapH: 80,
      fieldSize: 'tiny',
      humanPlayers: [0, 1],
      activeSlots: [0, 1],
      aiPlayers: [{ owner: 1, temperament: 'steady' }],
      noCenterBlock: true,
      agoraOccupyEndsMatch: 1,
      garden: { s: 99, u: [1, 2, 3] },
      gardenUrl: '/maps/chapter1.garden',
      chapter: 'ch1',
      matchId: 'lobby-1',
      ownerSkins: { 0: 'first_responder' },
      ownerColors: { 0: '#FF0000', 1: '#00FF00' },
    });
    assert.equal(cfg.seed, 99);
    assert.equal(cfg.mode, 'onevsone');
    assert.equal(cfg.mapW, 80);
    assert.equal(cfg.fieldSize, 'tiny');
    assert.deepEqual(cfg.humanPlayers, [0, 1]);
    assert.equal(cfg.garden, undefined);
    assert.equal(cfg.gardenUrl, '/maps/chapter1.garden');
    assert.equal(cfg.noCenterBlock, true);
    assert.equal(cfg.matchId, 'lobby-1');
    assert.deepEqual(cfg.ownerColors, { 0: '#FF0000', 1: '#00FF00' });
  });

  it('does not invent noCenterBlock for KOTH', () => {
    const cfg = replayConfigFromLive({
      seed: 1,
      mode: 'koth',
      activeSlots: [0, 2],
      humanPlayers: [0, 2],
      armyPerSide: 0,
    });
    assert.equal(cfg.noCenterBlock, undefined);
    assert.equal(cfg.mode, 'koth');
    assert.deepEqual(cfg.activeSlots, [0, 2]);
  });
});

describe('buildReplayFile', () => {
  it('wraps the tape, checksum, and names', () => {
    const source = [{ tick: 12, playerId: 0, commands: [{ type: 1, entities: [4] }] }];
    const file = buildReplayFile({
      confirmedTick: 400,
      _lastChecksum: 0xabc,
      replayConfig: { seed: 3, mode: 'teams' },
      exportReplayLedger() {
        return source;
      },
    }, { names: { 0: 'Blind' }, savedAt: '2026-09-08T00:00:00.000Z' });
    assert.equal(file.kind, REPLAY_KIND);
    assert.equal(file.v, 1);
    assert.equal(file.tick, 400);
    assert.equal(file.checksum, 0xabc);
    assert.equal(file.names[0], 'Blind');
    assert.equal(file.frames[0].tick, 12);
    file.frames[0].commands[0].entities.push(9);
    assert.deepEqual(source[0].commands[0].entities, [4]);
  });
});

describe('replay size copy', () => {
  it('labels bytes, kb, and mb', () => {
    assert.equal(formatReplayBytes(800), '800 B');
    assert.equal(formatReplayBytes(1536), '1.5 KB');
    assert.equal(formatReplayBytes(20 * 1024), '20 KB');
    assert.equal(formatReplayBytes(2.2 * 1024 * 1024), '2.2 MB');
  });

  it('measures JSON payload bytes', () => {
    const n = jsonByteLength({ a: 1 });
    assert.ok(n >= 7);
  });

  it('names the download from mode and day', () => {
    assert.equal(
      replayFileName({ config: { mode: 'onevsone' } }, new Date('2026-09-08T12:00:00Z')),
      'aether-onevsone-2026-09-08.gecho',
    );
  });
});

describe('replay tape vs catch-up prune', () => {
  it('keeps the save tape when a KOTH checkpoint drops catch-up frames', () => {
    const session = Object.create(SimSession.prototype);
    session.committedLedgerFrames = [
      { tick: 10, playerId: 0, commands: [{ type: 1 }] },
      { tick: 50, playerId: 0, commands: [{ type: 1 }] },
    ];
    session.fullLedgerFrames = [
      { tick: 10, playerId: 0, commands: [{ type: 1 }] },
      { tick: 50, playerId: 0, commands: [{ type: 1 }] },
    ];
    session.replayFrames = [
      { tick: 10, playerId: 0, commands: [{ type: 1 }] },
      { tick: 50, playerId: 0, commands: [{ type: 1 }] },
    ];
    session.pruneCommittedBefore(40);
    assert.deepEqual(session.committedLedgerFrames.map((f) => f.tick), [50]);
    assert.deepEqual(session.replayFrames.map((f) => f.tick), [10, 50]);
  });
});

describe('parseReplayFile', () => {
  it('round-trips a built tape and rejects junk', () => {
    const built = buildReplayFile({
      confirmedTick: 80,
      _lastChecksum: 7,
      replayConfig: replayConfigFromLive({
        seed: 4,
        mode: 'onevsone',
        humanPlayers: [0, 1],
        activeSlots: [0, 1],
        gardenUrl: '/maps/chapter1.garden',
      }),
      exportReplayLedger() {
        return [{ tick: 3, playerId: 0, commands: [{ type: 1, entities: [2] }] }];
      },
    }, { names: { 0: 'Blind' }, savedAt: '2026-09-08T00:00:00.000Z' });
    const parsed = parseReplayFile(JSON.stringify(built));
    assert.equal(parsed.kind, REPLAY_KIND);
    assert.equal(parsed.tick, 80);
    assert.equal(parsed.names[0], 'Blind');
    assert.equal(parsed.config.mode, 'onevsone');
    assert.equal(parsed.frames[0].tick, 3);
    assert.throws(() => parseReplayFile('{"kind":"nope"}'), /Not an Aether replay/);
    assert.throws(() => parseReplayFile('not-json'), /valid JSON/);
  });
});

describe('liveConfigFromReplay', () => {
  it('loads as a local spectator with no player input', () => {
    const file = parseReplayFile({
      v: 1,
      kind: REPLAY_KIND,
      tick: 40,
      config: { seed: 9, mode: 'teams', humanPlayers: [0, 2], activeSlots: [0, 2] },
      frames: [],
    });
    const cfg = liveConfigFromReplay(file);
    assert.equal(cfg.role, 'spectator');
    assert.equal(cfg.localPlayerId, -1);
    assert.equal(cfg.localSolo, true);
    assert.equal(cfg.inputEnabled, false);
    assert.equal(cfg.watchingReplay, true);
    assert.deepEqual(cfg.humanPlayers, [0, 2]);
  });
});

describe('saveReplayToDisk', () => {
  it('writes through the folder picker and does not download', async () => {
    const writes = [];
    const result = await saveReplayToDisk(
      { kind: REPLAY_KIND, config: { mode: 'koth' }, frames: [] },
      {
        async showSaveFilePicker() {
          return {
            async createWritable() {
              return {
                async write(text) { writes.push(text); },
                async close() { writes.push('closed'); },
              };
            },
          };
        },
        download() {
          writes.push('download');
          return true;
        },
      },
    );
    assert.equal(result, 'picked');
    assert.equal(writes.at(-1), 'closed');
    assert.ok(!writes.includes('download'));
  });

  it('does not download when the picker is cancelled', async () => {
    let downloaded = false;
    const result = await saveReplayToDisk(
      { kind: REPLAY_KIND, config: { mode: 'koth' } },
      {
        async showSaveFilePicker() {
          const err = new Error('cancel');
          err.name = 'AbortError';
          throw err;
        },
        download() {
          downloaded = true;
          return true;
        },
      },
    );
    assert.equal(result, 'cancelled');
    assert.equal(downloaded, false);
  });
});

describe('replayEndTick', () => {
  it('uses the later of header tick and last frame tick', () => {
    assert.equal(replayEndTick({ tick: 10, frames: [{ tick: 40 }] }), 40);
    assert.equal(replayEndTick({ tick: 90, frames: [{ tick: 12 }] }), 90);
  });
});
