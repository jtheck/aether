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
    /** @type {Map<number, { x: Float32Array, z: Float32Array }>} */
    this.snapshots = new Map();

    this.confirmedTick = 0;
    this.simAcc = 0;
    this.waitingForWorker = false;
    this.inFlightTick = 0;
    this.lateFramesDropped = 0;

    /** peerId -> highest tick they've confirmed ready for (multiplayer). */
    this.peerConfirmedTick = new Map();

    this.onCommit = null;
    this.onCatchupReady = null;
    this._commandSeq = 0;
    this.lastSnapshotAt = 0;
    this.pauseLockstep = false;
    this.koth = null;
    this.kothMatchOver = 0;
    /** @type {Map<number, number[]>} tick -> playerIds joining lockstep */
    this.pendingJoins = new Map();
    this.matchConfig = null;
  }

  async start(config) {
    const { count } = await this.client.init({ ...config, aiPlayers: this.aiPlayers });
    this._count = count;
    this.client.onStepDone((tick, checksum, extra) => {
      this.confirmedTick = tick;
      this._lastChecksum = checksum;
      if (extra?.koth) this.koth = extra.koth;
      if (extra?.kothMatchOver != null) this.kothMatchOver = extra.kothMatchOver;
      this.waitingForWorker = false;
      this.inFlightTick = 0;
      this._captureSnapshot(tick);
      this.lastSnapshotAt = performance.now();
      pruneLedger(this.ledger, tick, LEDGER_KEEP);
      this.onCommit?.(tick, checksum);
      this._drainPendingCommits();
    });
    this._captureSnapshot(0);
    this.lastSnapshotAt = performance.now();
    return { count };
  }

  get count() {
    return this._count ?? this.state.count;
  }

  /** First tick index not yet committed (in-flight counts as reserved). */
  _nextOpenTick() {
    return this.confirmedTick + 1 + (this.waitingForWorker ? 1 : 0);
  }

  /** Schedule a local player command into the lockstep ledger. */
  submitCommand(command) {
    if (this.role !== 'player') return null;
    const tick = this._nextOpenTick() + this.inputDelayTicks;
    const frame = {
      tick,
      playerId: this.localPlayerId,
      commands: [command],
      playerCommandSeq: ++this._commandSeq,
    };
    if (!bufferFrame(this.ledger, frame, this.confirmedTick)) {
      this.lateFramesDropped++;
    }
    return frame;
  }

  /** Incoming P2P frame — late frames are dropped, never applied retroactively. */
  bufferRemoteFrame(frame) {
    if (!bufferFrame(this.ledger, frame, this.confirmedTick)) {
      this.lateFramesDropped++;
      return false;
    }
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
    const displayTick = Math.max(0, this.confirmedTick - this.inputDelayTicks);
    const prevTick = Math.max(0, displayTick - 1);
    const prev = this.snapshots.get(prevTick) ?? this.snapshots.get(0);
    const cur = this.snapshots.get(displayTick) ?? prev;
    return { prev, cur, displayTick };
  }

  setHumanPlayers(playerIds) {
    this.humanPlayers = [...playerIds].sort((a, b) => a - b);
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
  submitAtTick(tick, command) {
    if (this.role !== 'player') return null;
    const frame = {
      tick,
      playerId: this.localPlayerId,
      commands: [command],
      playerCommandSeq: ++this._commandSeq,
    };
    bufferFrame(this.ledger, frame, this.confirmedTick);
    return frame;
  }

  /** Full ledger for catch-up export (not pruned by retention). */
  exportFullLedger() {
    const frames = [];
    for (const [tick, byPlayer] of this.ledger) {
      for (const [playerId, commands] of byPlayer) {
        if (commands?.length) frames.push({ tick, playerId, commands });
      }
    }
    frames.sort((a, b) => a.tick - b.tick || a.playerId - b.playerId);
    return frames;
  }
  /** Export command ledger slice for catch-up gap-fill. */
  exportLedger(fromTick, toTick) {
    const frames = [];
    for (const [tick, byPlayer] of this.ledger) {
      if (tick <= fromTick || tick > toTick) continue;
      for (const [playerId, commands] of byPlayer) {
        if (commands?.length) frames.push({ tick, playerId, commands });
      }
    }
    frames.sort((a, b) => a.tick - b.tick || a.playerId - b.playerId);
    return frames;
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

  async reset(config) {
    this.ledger.clear();
    this.snapshots.clear();
    this.peerConfirmedTick.clear();
    this.pendingJoins.clear();
    this.confirmedTick = 0;
    this.simAcc = 0;
    this.waitingForWorker = false;
    this.inFlightTick = 0;
    this.client.terminate();
    this.client = new SimClient();
    this.state = this.client.state;
    return this.start(config);
  }

  terminate() {
    this.client.terminate();
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
