// Lockstep conductor: command ledger, tick gate, snapshot timeline, worker commits.
// Solo = one human player + optional deterministic AI peers in the worker.
// Multiplayer = same object; P2P feeds bufferRemoteFrame() and peer confirmations.

import * as fx from '../sim/fixed.js';
import { bufferFrame, collectFramesForTick, pruneLedger } from '../sim/commandFrame.js';
import { SimClient } from './simClient.js';

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const SNAPSHOT_KEEP = 128;
const LEDGER_KEEP = 7200;

export { TICK_HZ, TICK_MS };

export function matchSecondsFromTick(tick) {
  return Math.max(0, Math.floor(tick / TICK_HZ));
}

/** Wall-clock-style label from sim tick age (e.g. `42s`, `2:05`). */
export function formatMatchTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}:${String(r).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}:${String(rm).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export class SimSession {
  /**
   * @param {object} options
   * @param {number} options.localPlayerId
   * @param {number[]} options.humanPlayers — peers required before advancing a tick
   * @param {number[]} [options.aiPlayers] — deterministic AI generated in worker
   * @param {number} [options.inputDelayTicks]
   */
  constructor(options) {
    this.localPlayerId = options.localPlayerId;
    this.humanPlayers = options.humanPlayers;
    this.aiPlayers = options.aiPlayers ?? [];
    this.inputDelayTicks = options.inputDelayTicks ?? 1;
    this.role = options.role ?? 'player';

    this.client = new SimClient();
    this.state = this.client.state;

    /** @type {Map<number, Map<number, import('../sim/commandFrame.js').SimCommand[]>>} */
    this.ledger = new Map();
    /** @type {import('../sim/commandFrame.js').CommandFrame[]} */
    this.fullLedgerFrames = [];
    /** @type {import('../sim/commandFrame.js').CommandFrame[]} frames proven by committed worker ticks */
    this.committedLedgerFrames = [];
    /** @type {Map<number, { x: Float32Array, z: Float32Array }>} */
    this.snapshots = new Map();

    this.confirmedTick = 0;
    this.simAcc = 0;
    this.waitingForWorker = false;
    this.inFlightTick = 0;
    this.inFlightFrames = [];
    this.lateFramesDropped = 0;

    /** peerId -> highest tick they've confirmed ready for (multiplayer). */
    this.peerConfirmedTick = new Map();

    this.onCommit = null;
    this.onCatchupReady = null;
    this._commandSeq = 0;
    this._seenFrameIds = new Set();
    this.lastSnapshotAt = 0;
    this.pauseLockstep = false;
    this.replayingCatchUp = false;
    this.resetting = false;
    this.koth = null;
    this.kothMatchOver = 0;
    /** @type {Map<number, number[]>} tick -> playerIds joining lockstep */
    this.pendingJoins = new Map();
    this.matchConfig = null;
  }

  async start(config) {
    const { count } = await this.client.init({ ...config, aiPlayers: this.aiPlayers });
    this._count = count;
    this._bindStepHandler();
    this._captureSnapshot(0);
    this.lastSnapshotAt = performance.now();
    return { count };
  }

  get count() {
    return this.state?.count ?? this._count ?? 0;
  }

  /** First tick index not yet committed (in-flight counts as reserved). */
  _nextOpenTick() {
    return this.confirmedTick + 1 + (this.waitingForWorker ? 1 : 0);
  }

  /** Schedule a local player command into the lockstep ledger. */
  submitCommand(command) {
    if (this.role !== 'player') return null;
    const commandId = `${this.localPlayerId}:${++this._commandSeq}`;
    const tick = this._nextOpenTick() + this.inputDelayTicks;
    const frame = {
      tick,
      playerId: this.localPlayerId,
      commands: [command],
      commandId,
      playerCommandSeq: this._commandSeq,
    };
    if (!bufferFrame(this.ledger, frame, this.confirmedTick)) {
      this.lateFramesDropped++;
      return null;
    }
    this._seenFrameIds.add(commandId);
    this._recordFullFrame(frame);
    return frame;
  }

  /** Incoming P2P frame — late frames are dropped, never applied retroactively. */
  bufferRemoteFrame(frame) {
    if (frame?.commandId) {
      if (this._seenFrameIds.has(frame.commandId)) return true;
      this._seenFrameIds.add(frame.commandId);
    }
    if (!bufferFrame(this.ledger, frame, this.confirmedTick)) {
      this.lateFramesDropped++;
      return false;
    }
    this._recordFullFrame(frame);
    return true;
  }

  /** Peer confirmed they have all commands through this tick (multiplayer). */
  setPeerConfirmedTick(playerId, tick) {
    const prev = this.peerConfirmedTick.get(playerId) ?? 0;
    if (tick > prev) this.peerConfirmedTick.set(playerId, tick);
  }

  /** Drive sim clock from render frame delta. */
  pump(deltaMs) {
    let dt = deltaMs;
    if (dt > 250) dt = 250;
    this.simAcc += dt;
    this._drainPendingCommits();
  }

  _drainPendingCommits() {
    if (this.pauseLockstep) return;
    while (this.simAcc >= TICK_MS && !this.waitingForWorker) {
      this.simAcc -= TICK_MS;
      if (!this._tryCommitNextTick()) break;
    }
  }

  /** Fraction through the current display tick (0–1), keyed to last confirmed snapshot. */
  get displayAlpha() {
    return Math.min(1, (performance.now() - this.lastSnapshotAt) / TICK_MS);
  }

  /** Snapshot pair for render interpolation (display lags sim by inputDelayTicks). */
  displaySnapshots() {
    if (this.resetting) return { prev: null, cur: null, displayTick: this.confirmedTick };
    const displayTick = Math.max(0, this.confirmedTick - this.inputDelayTicks);
    const prevTick = Math.max(0, displayTick - 1);
    const prev = this.snapshots.get(prevTick) ?? this.snapshots.get(0);
    const cur = this.snapshots.get(displayTick) ?? prev;
    return { prev, cur, displayTick };
  }

  setHumanPlayers(playerIds) {
    this.humanPlayers = [...playerIds].sort((a, b) => a - b);
  }

  setLocalPlayerId(playerId) {
    this.localPlayerId = playerId;
  }

  setRole(role) {
    this.role = role;
  }

  /** Export position snapshot + checksum for catch-up. */
  exportSnapshot(tick) {
    const snap = this.snapshots.get(tick);
    if (!snap) return null;
    return {
      tick,
      checksum: this._lastChecksum,
      positions: { x: snap.x.slice(), z: snap.z.slice() },
    };
  }

  /** Schedule a player to enter lockstep quorum at a future tick. */
  scheduleJoin(tick, playerId) {
    let list = this.pendingJoins.get(tick);
    if (!list) {
      list = [];
      this.pendingJoins.set(tick, list);
    }
    if (!list.includes(playerId)) list.push(playerId);
  }

  /** Convene peer: inject a command at a specific tick (spawn slot, etc.). */
  submitAtTick(tick, command, options = {}) {
    if (this.role !== 'player') return null;
    const sourcePlayerId = options.playerId ?? this.localPlayerId;
    const seq = ++this._commandSeq;
    const commandId = options.commandId ?? `${sourcePlayerId}:${seq}`;
    if (this._seenFrameIds.has(commandId)) return null;
    const frame = {
      tick,
      playerId: sourcePlayerId,
      commands: [command],
      commandId,
      playerCommandSeq: seq,
    };
    if (!bufferFrame(this.ledger, frame, this.confirmedTick)) {
      this.lateFramesDropped++;
      return null;
    }
    this._seenFrameIds.add(commandId);
    this._recordFullFrame(frame);
    return frame;
  }

  /** Full ledger for catch-up export (not pruned by retention). */
  exportFullLedger() {
    return this.committedLedgerFrames
      .map((frame) => ({ ...frame, commands: frame.commands?.map((cmd) => ({ ...cmd })) ?? [] }))
      .sort((a, b) => a.tick - b.tick || a.playerId - b.playerId);
  }
  /** Export command ledger slice for catch-up gap-fill. */
  exportLedger(fromTick, toTick) {
    return this.exportFullLedger().filter((frame) => frame.tick > fromTick && frame.tick <= toTick);
  }

  /** @deprecated */
  _exportLedgerSlice(fromTick, toTick) {
    return this.exportLedger(fromTick, toTick);
  }

  ingestCatchup(offer) {
    if (offer.ledger) {
      for (const frame of offer.ledger) this.bufferRemoteFrame(frame);
    }
    this.onCatchupReady?.(offer);
  }

  replaceFullLedger(frames) {
    this.fullLedgerFrames = [];
    this.committedLedgerFrames = [];
    this._seenFrameIds.clear();
    for (const frame of frames ?? []) {
      this._recordFullFrame(frame);
      this._recordCommittedFrame(frame);
      if (frame.commandId) this._seenFrameIds.add(frame.commandId);
    }
  }

  async reset(config) {
    this.resetting = true;
    this.ledger.clear();
    this.fullLedgerFrames = [];
    this.committedLedgerFrames = [];
    this.snapshots.clear();
    this.peerConfirmedTick.clear();
    this.pendingJoins.clear();
    this._seenFrameIds.clear();
    this.confirmedTick = 0;
    this.simAcc = 0;
    this.waitingForWorker = false;
    this.inFlightTick = 0;
    this.inFlightFrames = [];
    this.client.terminate();
    this.client = new SimClient();
    this.state = this.client.state;
    try {
      return await this.start(config);
    } finally {
      this.resetting = false;
    }
  }

  terminate() {
    this.client?.terminate?.();
  }

  adoptFrom(other) {
    this.client?.terminate?.();
    this.client = other.client;
    other.client = null;
    this.state = other.state;
    this._count = other._count;
    // The replay rebuilds authoritative state up to other.confirmedTick from the
    // full historical ledger, so its own pending ledger is empty. Keep THIS
    // session's pending ledger instead: it holds the live command frames that
    // streamed in during the (awaited) replay. Only drop frames the replay
    // already baked in (tick <= confirmedTick); the rest bridge the catch-up gap.
    pruneLedger(this.ledger, other.confirmedTick, 0);
    this.fullLedgerFrames = other.fullLedgerFrames;
    this.committedLedgerFrames = other.committedLedgerFrames;
    this.snapshots = other.snapshots;
    this.peerConfirmedTick = other.peerConfirmedTick;
    this.pendingJoins = other.pendingJoins;
    this._seenFrameIds = other._seenFrameIds;
    this.confirmedTick = other.confirmedTick;
    this.simAcc = 0;
    this.waitingForWorker = false;
    this.inFlightTick = 0;
    this.inFlightFrames = [];
    this.lateFramesDropped = other.lateFramesDropped;
    this._commandSeq = other._commandSeq;
    this.lastSnapshotAt = performance.now();
    this.pauseLockstep = false;
    this.resetting = false;
    this.koth = other.koth;
    this.kothMatchOver = other.kothMatchOver;
    this._lastChecksum = other._lastChecksum;
    this._bindStepHandler();
  }

  _recordFullFrame(frame) {
    if (!frame || !frame.commands?.length) return;
    if (frame.commandId && this.fullLedgerFrames.some((existing) => existing.commandId === frame.commandId)) return;
    this.fullLedgerFrames.push({
      ...frame,
      commands: frame.commands.map((cmd) => ({ ...cmd })),
    });
  }

  _recordCommittedFrame(frame) {
    if (!frame || !frame.commands?.length) return;
    const key = frame.commandId ?? `${frame.tick}:${frame.playerId}:${JSON.stringify(frame.commands)}`;
    const exists = this.committedLedgerFrames.some((existing) => {
      const existingKey = existing.commandId ?? `${existing.tick}:${existing.playerId}:${JSON.stringify(existing.commands)}`;
      return existingKey === key;
    });
    if (exists) return;
    this.committedLedgerFrames.push({
      ...frame,
      commands: frame.commands.map((cmd) => ({ ...cmd })),
    });
  }

  _recordCommittedTick(tick, framesUsed) {
    for (const frame of framesUsed ?? []) this._recordCommittedFrame(frame);
  }

  _bindStepHandler() {
    this.client.onStepDone((tick, checksum, extra) => {
      this.confirmedTick = tick;
      this._lastChecksum = checksum;
      if (extra?.koth) this.koth = extra.koth;
      if (extra?.kothMatchOver != null) this.kothMatchOver = extra.kothMatchOver;
      this.waitingForWorker = false;
      this.inFlightTick = 0;
      const committedFrames = this.inFlightFrames;
      this.inFlightFrames = [];
      this._recordCommittedTick(tick, committedFrames);
      this._captureSnapshot(tick);
      this.lastSnapshotAt = performance.now();
      pruneLedger(this.ledger, tick, LEDGER_KEEP);
      this.onCommit?.(tick, checksum);
      this._drainPendingCommits();
    });
  }

  _canAdvance(tick) {
    for (const playerId of this.humanPlayers) {
      if (playerId === this.localPlayerId) continue;
      const confirmed = this.peerConfirmedTick.get(playerId) ?? 0;
      if (confirmed < tick) return false;
    }
    return true;
  }

  _tryCommitNextTick() {
    const next = this.confirmedTick + 1;

    const joining = this.pendingJoins.get(next);
    if (joining?.length) {
      for (const pid of joining) {
        if (!this.humanPlayers.includes(pid)) this.humanPlayers.push(pid);
      }
      this.humanPlayers.sort((a, b) => a - b);
      this.pendingJoins.delete(next);
    }

    if (!this._canAdvance(next)) return false;

    const frames = collectFramesForTick(this.ledger, next, this.humanPlayers);
    this.waitingForWorker = true;
    this.inFlightTick = next;
    this.inFlightFrames = frames.map((frame) => ({
      ...frame,
      commands: frame.commands.map((cmd) => ({ ...cmd })),
    }));
    this.client.commitTick(next, frames);
    return true;
  }

  _captureSnapshot(tick) {
    const n = this.count;
    let snap = this.snapshots.get(tick);
    if (!snap) {
      snap = { x: new Float32Array(n), z: new Float32Array(n) };
      this.snapshots.set(tick, snap);
    }
    const { px, py } = this.state;
    for (let i = 0; i < n; i++) {
      snap.x[i] = fx.toFloat(px[i]);
      snap.z[i] = fx.toFloat(py[i]);
    }
    const minKeep = tick - SNAPSHOT_KEEP;
    for (const t of this.snapshots.keys()) {
      if (t < minKeep) this.snapshots.delete(t);
    }
  }
}
