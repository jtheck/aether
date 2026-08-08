// Lockstep conductor: command ledger, tick gate, snapshot timeline, worker commits.
// Solo = one human player + optional deterministic AI peers in the worker.
// Multiplayer = same object; P2P feeds bufferRemoteFrame() and peer confirmations.

import * as fx from '../sim/fixed.js';
import { bufferFrame, collectFramesForTick, pruneLedger } from '../sim/commandFrame.js';
import { applyTreeUpdatesToField } from '../sim/trees.js';
import { SimClient } from './simClient.js';

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
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
   * @param {Array<number | { owner: number, temperament?: string }>} [options.aiPlayers] — deterministic AI generated in worker
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
    this.snapshotRing = new Array(Math.max(4, this.inputDelayTicks + 3));
    /** @type {Map<number, object>} */
    this.projectileSnapshots = new Map();
    this.projectileSnapshotRing = new Array(this.snapshotRing.length);

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
    /** EMA of wall time between snapshots — used so render blend matches real tick cost. */
    this._displayBlendMs = TICK_MS;
    /** Last alpha / display tick actually drawn — pause freezes to these (not live clock). */
    this._lastDisplayAlpha = 0;
    this._lastDisplayTick = 0;
    /** Frozen render blend while pauseLockstep (null when running). */
    this._pausedDisplayAlpha = null;
    this._pausedDisplayTick = null;
    this.pauseLockstep = false;
    this.replayingCatchUp = false;
    /** @type {{ tick: number, targetTick: number } | null} */
    this.catchupProgress = null;
    this.resetting = false;
    this._bgPumpTimer = null;
    this.koth = null;
    this.kothMatchOver = 0;
    this.matchWinner = -1;
    this.agoras = [];
    this.buildings = [];
    /** Owner tech bitmasks from the worker (see sim/tech.js). */
    this.tech = [];
    this.simMetrics = null;
    /** EMA of worker metrics.timing (ms). */
    this.simTimingEma = null;
    /** Last raw timing sample (ms). */
    this.simTimingLast = null;
    /** @type {Map<number, number[]>} tick -> playerIds joining lockstep */
    this.pendingJoins = new Map();
    this.matchConfig = null;
    this._resetChain = Promise.resolve();
    /** When set, onWorldRebuilt ignores stale resets (see applyLiveConfig). */
    this._pendingWorldGen = null;
    /** Latest mid-match world checkpoint (for observer catch-up). */
    this._checkpoint = null;
    this._checkpointTick = 0;
    this._checkpointChecksum = 0;
    /** Called after worker init / world rebuild (count is live entity total). */
    this.onWorldRebuilt = null;
    /** Fired when placed building list updates from the worker. */
    this.onBuildingsChanged = null;
    /** Fired when owner tech bits change (e.g. Drayage researched). */
    this.onTechChanged = null;
    /** Tile field snapshot from worker (tree stock/burn mutate in place). */
    this.field = null;
    /** @type {Array<{ tiles: Uint32Array, stock: Uint8Array, burn: Uint8Array }> | null} */
    this.pendingTreeUpdates = null;
    /** @type {Array<object> | null} */
    this.pendingFireZoneUpdates = null;
  }

  async start(config) {
    const { count, field, agoras, buildings, tech } = await this.client.init({
      ...config,
      aiPlayers: this.aiPlayers,
    });
    this._count = count;
    this.field = field ?? this.client.field;
    this.agoras = agoras ?? this.client._agoras ?? [];
    this.buildings = buildings ?? this.client._buildings ?? [];
    this.tech = tech ?? this.client._tech ?? [];
    this.kothMatchOver = 0;
    this.matchWinner = -1;
    this._bindStepHandler();
    this._captureSnapshot(0);
    this.lastSnapshotAt = performance.now();
    return {
      count,
      field: this.field,
      agoras: this.agoras,
      buildings: this.buildings,
      tech: this.tech,
    };
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
    // Bound clock debt: slow ticks (stress) must not accumulate a catch-up storm.
    if (this.simAcc > TICK_MS * 3) this.simAcc = TICK_MS * 3;
    this._drainPendingCommits();
  }

  /**
   * Keep lockstep advancing when the tab is backgrounded (rAF pauses).
   * Without this, peer tick_confirms stop and the other player freezes.
   * Browsers may throttle the interval; still better than a hard stall.
   */
  setBackgroundPump(enabled) {
    if (this._bgPumpTimer != null) {
      clearInterval(this._bgPumpTimer);
      this._bgPumpTimer = null;
    }
    if (!enabled) return;
    let last = performance.now();
    this._bgPumpTimer = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      this.pump(dt);
    }, TICK_MS);
  }

  _drainPendingCommits() {
    if (this.pauseLockstep) return;
    while (this.simAcc >= TICK_MS && !this.waitingForWorker) {
      this.simAcc -= TICK_MS;
      if (!this._tryCommitNextTick()) break;
    }
  }

  /**
   * Fraction through the current display tick (0–1).
   * Blend window tracks real inter-snapshot time so a slow worker (stress) eases
   * across the whole interval instead of freezing at alpha=1 after TICK_MS.
   * While paused, hold the last *drawn* alpha so projectiles don't take one more step.
   */
  get displayAlpha() {
    const blend = Math.max(TICK_MS, this._displayBlendMs || TICK_MS);
    if (this.pauseLockstep) {
      if (this._pausedDisplayAlpha == null) {
        this._pausedDisplayAlpha = this._lastDisplayAlpha;
      }
      return this._pausedDisplayAlpha;
    }
    if (this._pausedDisplayAlpha != null) {
      const a = this._pausedDisplayAlpha;
      this._pausedDisplayAlpha = null;
      this._pausedDisplayTick = null;
      this.lastSnapshotAt = performance.now() - a * blend;
      this._lastDisplayAlpha = a;
      return a;
    }
    const live = Math.min(1, (performance.now() - this.lastSnapshotAt) / blend);
    this._lastDisplayAlpha = live;
    return live;
  }

  _displayTick() {
    if (this.pauseLockstep) {
      if (this._pausedDisplayTick == null) {
        this._pausedDisplayTick = this._lastDisplayTick;
      }
      return this._pausedDisplayTick;
    }
    const displayTick = Math.max(0, this.confirmedTick - this.inputDelayTicks);
    this._lastDisplayTick = displayTick;
    return displayTick;
  }

  /** Snapshot pair for render interpolation (display lags sim by inputDelayTicks). */
  displaySnapshots() {
    if (this.resetting) return { prev: null, cur: null, displayTick: this.confirmedTick };
    const displayTick = this._displayTick();
    const prevTick = Math.max(0, displayTick - 1);
    const prev = this.snapshots.get(prevTick) ?? this.snapshots.get(0);
    const cur = this.snapshots.get(displayTick) ?? prev;
    return { prev, cur, displayTick };
  }

  displayProjectileSnapshots() {
    if (this.resetting) return { prev: null, cur: null };
    const displayTick = this._displayTick();
    const prevTick = Math.max(0, displayTick - 1);
    const prev =
      this.projectileSnapshots.get(prevTick) ?? this.projectileSnapshots.get(0) ?? null;
    const cur = this.projectileSnapshots.get(displayTick) ?? prev;
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

  /** Cache a world checkpoint and optionally prune older committed frames. */
  cacheCheckpoint(checkpoint, checksum) {
    if (!checkpoint) return;
    this._checkpoint = checkpoint;
    this._checkpointTick = checkpoint.tick | 0;
    this._checkpointChecksum = (checksum ?? checkpoint.checksum) >>> 0;
  }

  getCachedCheckpoint() {
    if (!this._checkpoint) return null;
    return {
      checkpoint: this._checkpoint,
      tick: this._checkpointTick,
      checksum: this._checkpointChecksum,
    };
  }

  async exportCheckpoint() {
    const msg = await this.client.exportCheckpointAsync();
    this.cacheCheckpoint(msg.checkpoint, msg.checksum);
    this.pruneCommittedBefore(msg.tick | 0);
    return msg;
  }

  async importCheckpoint(checkpoint, expectedChecksum) {
    const msg = await this.client.importCheckpointAsync(checkpoint, expectedChecksum);
    this._count = msg.count ?? this._count;
    this.confirmedTick = msg.tick | 0;
    this._lastChecksum = msg.checksum;
    if (msg.koth) this.koth = msg.koth;
    if (msg.kothMatchOver != null) this.kothMatchOver = msg.kothMatchOver;
    this.cacheCheckpoint(checkpoint, msg.checksum);
    this.onWorldRebuilt?.(this.count);
    return msg;
  }

  /** Drop committed ledger frames at/before checkpointTick (keep frames after). */
  pruneCommittedBefore(checkpointTick) {
    const keepFrom = checkpointTick | 0;
    this.committedLedgerFrames = this.committedLedgerFrames.filter((f) => (f.tick | 0) > keepFrom);
    this.fullLedgerFrames = this.fullLedgerFrames.filter((f) => (f.tick | 0) > keepFrom);
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
    const task = this._resetChain.then(() => this._resetInner(config));
    this._resetChain = task.catch(() => {});
    return task;
  }

  async _resetInner(config) {
    this.resetting = true;
    this.ledger.clear();
    this.fullLedgerFrames = [];
    this.committedLedgerFrames = [];
    this.snapshots.clear();
    this.projectileSnapshots.clear();
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
    this._displayBlendMs = TICK_MS;
    try {
      const result = await this.start(config);
      const rebuilt = this.onWorldRebuilt?.(this.count);
      if (rebuilt != null && typeof rebuilt.then === 'function') await rebuilt;
      return result;
    } finally {
      this.resetting = false;
    }
  }

  terminate() {
    this.setBackgroundPump(false);
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
    this.snapshotRing = other.snapshotRing;
    this.projectileSnapshots = other.projectileSnapshots;
    this.projectileSnapshotRing = other.projectileSnapshotRing;
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
    this._displayBlendMs = other._displayBlendMs || TICK_MS;
    this._pausedDisplayAlpha = null;
    this._pausedDisplayTick = null;
    this.pauseLockstep = false;
    this.resetting = false;
    this.koth = other.koth;
    this.kothMatchOver = other.kothMatchOver;
    this._lastChecksum = other._lastChecksum;
    this.simMetrics = other.simMetrics;
    this.simTimingEma = other.simTimingEma ? { ...other.simTimingEma } : null;
    this.simTimingLast = other.simTimingLast ? { ...other.simTimingLast } : null;
    this.field = other.field ?? other.client?.field ?? null;
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
      if (extra?.matchWinner != null) this.matchWinner = extra.matchWinner;
      if (extra?.buildings) {
        this.buildings = extra.buildings;
        if (extra.buildingsChanged) this.onBuildingsChanged?.(this.buildings);
      }
      if (extra?.tech) {
        this.tech = extra.tech;
        if (extra.techChanged) this.onTechChanged?.(this.tech);
      }
      if (extra?.metrics) {
        this.simMetrics = extra.metrics;
        const timing = extra.metrics.timing;
        if (timing) {
          this.simTimingLast = timing;
          if (!this.simTimingEma) this.simTimingEma = {};
          const alpha = 0.12;
          for (const key of Object.keys(timing)) {
            const n = Number(timing[key]);
            if (!Number.isFinite(n)) continue;
            const prev = this.simTimingEma[key];
            this.simTimingEma[key] = prev == null ? n : prev + (n - prev) * alpha;
          }
        }
      }
      if (extra?.treeUpdates) {
        applyTreeUpdatesToField(this.field, extra.treeUpdates);
        if (!this.pendingTreeUpdates) this.pendingTreeUpdates = [];
        this.pendingTreeUpdates.push(extra.treeUpdates);
      }
      if (extra?.fireZoneUpdates) {
        if (!this.pendingFireZoneUpdates) this.pendingFireZoneUpdates = [];
        this.pendingFireZoneUpdates.push(extra.fireZoneUpdates);
      }
      if (extra?.frogUpdates) {
        if (!this.pendingFrogUpdates) this.pendingFrogUpdates = [];
        this.pendingFrogUpdates.push(extra.frogUpdates);
      }
      if (extra?.lightningUpdates) {
        if (!this.pendingLightningUpdates) this.pendingLightningUpdates = [];
        this.pendingLightningUpdates.push(extra.lightningUpdates);
      }
      if (extra?.holyArmorUpdates) {
        if (!this.pendingHolyArmorUpdates) this.pendingHolyArmorUpdates = [];
        this.pendingHolyArmorUpdates.push(extra.holyArmorUpdates);
      }
      if (extra?.sporeBloomUpdates) {
        if (!this.pendingSporeBloomUpdates) this.pendingSporeBloomUpdates = [];
        this.pendingSporeBloomUpdates.push(extra.sporeBloomUpdates);
      }
      if (extra?.monkKickUpdates) {
        if (!this.pendingMonkKickUpdates) this.pendingMonkKickUpdates = [];
        this.pendingMonkKickUpdates.push(extra.monkKickUpdates);
      }
      this.waitingForWorker = false;
      this.inFlightTick = 0;
      const committedFrames = this.inFlightFrames;
      this.inFlightFrames = [];
      this._recordCommittedTick(tick, committedFrames);
      this._captureSnapshot(tick);
      const now = performance.now();
      // Don't advance the render blend clock while paused — display is frozen to
      // the last drawn tick/alpha (an in-flight commit may still land).
      if (!this.pauseLockstep) {
        if (this.lastSnapshotAt > 0) {
          const measured = Math.max(1, now - this.lastSnapshotAt);
          // First real interval: adopt immediately so stress doesn't spend the
          // opening ticks frozen on a 50ms blend window.
          if (this._displayBlendMs <= TICK_MS) {
            this._displayBlendMs = measured;
          } else {
            this._displayBlendMs = this._displayBlendMs * 0.65 + measured * 0.35;
          }
        }
        this.lastSnapshotAt = now;
      }
      pruneLedger(this.ledger, tick, LEDGER_KEEP);
      this.onCommit?.(tick, checksum);
      this._drainPendingCommits();
    });
  }

  /** Drain tree stock/burn patches for the renderer (since last call). */
  takePendingTreeUpdates() {
    const out = this.pendingTreeUpdates;
    this.pendingTreeUpdates = null;
    return out;
  }

  /** Drain ground-fire zone spawn/despawn patches for the renderer. */
  takePendingFireZoneUpdates() {
    const out = this.pendingFireZoneUpdates;
    this.pendingFireZoneUpdates = null;
    return out;
  }

  /** Drain plague-of-frogs hop patches for the renderer. */
  takePendingFrogUpdates() {
    const out = this.pendingFrogUpdates;
    this.pendingFrogUpdates = null;
    return out;
  }

  /** Drain wizard lightning strike FX for the renderer. */
  takePendingLightningUpdates() {
    const out = this.pendingLightningUpdates;
    this.pendingLightningUpdates = null;
    return out;
  }

  /** Drain priest holy-armor cast pulses for the renderer. */
  takePendingHolyArmorUpdates() {
    const out = this.pendingHolyArmorUpdates;
    this.pendingHolyArmorUpdates = null;
    return out;
  }

  /** Drain myco spore-bloom cast/seed FX for the renderer. */
  takePendingSporeBloomUpdates() {
    const out = this.pendingSporeBloomUpdates;
    this.pendingSporeBloomUpdates = null;
    return out;
  }

  /** Drain monk kick cast pulses for the renderer. */
  takePendingMonkKickUpdates() {
    const out = this.pendingMonkKickUpdates;
    this.pendingMonkKickUpdates = null;
    return out;
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
    const slot = tick % this.snapshotRing.length;
    let snap = this.snapshotRing[slot];
    if (snap?.tick != null) this.snapshots.delete(snap.tick);
    if (!snap || snap.x.length < n || !snap.faceX || snap.faceX.length < n) {
      snap = {
        tick,
        x: new Float32Array(n),
        z: new Float32Array(n),
        faceX: new Float32Array(n),
        faceZ: new Float32Array(n),
      };
    }
    snap.tick = tick;
    this.snapshotRing[slot] = snap;
    this.snapshots.set(tick, snap);
    const { px, py, faceX, faceY } = this.state;
    for (let i = 0; i < n; i++) {
      snap.x[i] = fx.toFloat(px[i]);
      snap.z[i] = fx.toFloat(py[i]);
      if (faceX && faceY) {
        snap.faceX[i] = fx.toFloat(faceX[i]);
        snap.faceZ[i] = fx.toFloat(faceY[i]);
      } else {
        snap.faceX[i] = 0;
        snap.faceZ[i] = 1;
      }
    }
    this._captureProjectileSnapshot(tick);
  }

  _captureProjectileSnapshot(tick) {
    const state = this.state.projectiles;
    const n = state?.highWater ?? 0;
    const slot = tick % this.projectileSnapshotRing.length;
    let snap = this.projectileSnapshotRing[slot];
    if (snap?.tick != null) this.projectileSnapshots.delete(snap.tick);
    if (!snap || snap.x.length < n) {
      snap = {
        tick,
        highWater: n,
        activeCount: 0,
        x: new Float32Array(n),
        z: new Float32Array(n),
        vx: new Float32Array(n),
        vz: new Float32Array(n),
        generation: new Uint32Array(n),
        age: new Uint16Array(n),
        lifetime: new Uint16Array(n),
        alive: new Uint8Array(n),
        type: new Uint8Array(n),
        owner: new Uint8Array(n),
        despawnReason: new Uint8Array(n),
      };
    }
    snap.tick = tick;
    snap.highWater = n;
    snap.activeCount = state?.activeCount ?? 0;
    snap.alive.fill(0);
    for (let i = 0; i < n; i++) {
      snap.x[i] = fx.toFloat(state.px[i]);
      snap.z[i] = fx.toFloat(state.py[i]);
      snap.vx[i] = fx.toFloat(state.vx[i]);
      snap.vz[i] = fx.toFloat(state.vy[i]);
      snap.generation[i] = state.generation[i];
      snap.age[i] = state.age[i];
      snap.lifetime[i] = state.lifetime[i];
      snap.alive[i] = state.alive[i];
      snap.type[i] = state.type[i];
      snap.owner[i] = state.owner[i];
      snap.despawnReason[i] = state.despawnReason[i];
    }
    this.projectileSnapshotRing[slot] = snap;
    this.projectileSnapshots.set(tick, snap);
  }
}
