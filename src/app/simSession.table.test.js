import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCKSTEP_CATCHUP_DONE_TICKS,
  LOCKSTEP_CATCHUP_LAG_TICKS,
  SimSession,
  clearSessionTableState,
  shouldFastForwardLockstep,
} from './simSession.js';

describe('clearSessionTableState', () => {
  it('drops KOTH leftovers and queued FX so a new board cannot inherit them', () => {
    const session = {
      koth: { scores: [9, 1] },
      kothMatchOver: 1,
      matchWinner: 2,
      _checkpoint: { tick: 40 },
      _checkpointTick: 40,
      _checkpointChecksum: 99,
      _lastChecksum: 0xd9b73327,
      pendingTreeUpdates: [{ tiles: [1] }],
      pendingRockUpdates: [{ tiles: [2] }],
      pendingFireZoneUpdates: [{ spawned: [1] }],
      pendingFrogUpdates: [{ hops: [1] }],
      pendingLightningUpdates: [{ count: 3 }],
      pendingHolyArmorUpdates: [{ pulses: [1] }],
      pendingSporeBloomUpdates: [{ seeds: [1] }],
      pendingMonkKickUpdates: [{ kicks: [1] }],
      buildings: [{ type: 'keep' }],
      field: { width: 208 },
    };
    clearSessionTableState(session);
    assert.equal(session.koth, null);
    assert.equal(session.kothMatchOver, 0);
    assert.equal(session.matchWinner, -1);
    assert.equal(session._checkpoint, null);
    assert.equal(session._checkpointTick, 0);
    assert.equal(session._checkpointChecksum, 0);
    assert.equal(session._lastChecksum, 0);
    assert.equal(session.pendingTreeUpdates, null);
    assert.equal(session.pendingRockUpdates, null);
    assert.equal(session.pendingFireZoneUpdates, null);
    assert.equal(session.pendingFrogUpdates, null);
    assert.equal(session.pendingLightningUpdates, null);
    assert.equal(session.pendingHolyArmorUpdates, null);
    assert.equal(session.pendingSporeBloomUpdates, null);
    assert.equal(session.pendingMonkKickUpdates, null);
    // Live table data is replaced by start() — don't wipe it here.
    assert.equal(session.buildings.length, 1);
    assert.equal(session.field.width, 208);
  });

  it('is a no-op on null', () => {
    clearSessionTableState(null);
  });
});

describe('background lightning FX', () => {
  it('drops a pending chorus when the tab starts background-pumping', () => {
    const session = Object.create(SimSession.prototype);
    session._bgPumpTimer = null;
    session.pendingLightningUpdates = [{ count: 40 }, { count: 12 }];
    session.setBackgroundPump(true);
    assert.equal(session.pendingLightningUpdates, null);
    session.queueLightningUpdates({ count: 8 });
    assert.equal(session.pendingLightningUpdates, null);
    session.setBackgroundPump(false);
  });

  it('queues strike FX again once the tab is foreground', () => {
    const session = Object.create(SimSession.prototype);
    session._bgPumpTimer = null;
    session.pendingLightningUpdates = null;
    session.queueLightningUpdates({ count: 2 });
    assert.deepEqual(session.pendingLightningUpdates, [{ count: 2 }]);
  });
});

describe('catch-up to the live tip', () => {
  it('burns down a backlog a fresh joiner cannot close at real time', () => {
    assert.equal(shouldFastForwardLockstep({ lagTicks: 0 }), false);
    assert.equal(shouldFastForwardLockstep({ lagTicks: 1 }), false);
    assert.equal(shouldFastForwardLockstep({ lagTicks: LOCKSTEP_CATCHUP_LAG_TICKS }), true);
    assert.equal(shouldFastForwardLockstep({ lagTicks: 400 }), true);
  });

  it('keeps draining until almost level, so the clock does not oscillate', () => {
    const mid = LOCKSTEP_CATCHUP_LAG_TICKS - 1;
    assert.equal(shouldFastForwardLockstep({ lagTicks: mid, draining: false }), false);
    assert.equal(shouldFastForwardLockstep({ lagTicks: mid, draining: true }), true);
    assert.equal(
      shouldFastForwardLockstep({ lagTicks: LOCKSTEP_CATCHUP_DONE_TICKS, draining: true }),
      false,
    );
  });

  it('measures lag against the slowest peer confirm, never past the quorum', () => {
    const session = Object.create(SimSession.prototype);
    session.humanPlayers = [0, 1, 2];
    session.localPlayerId = -1;
    session.confirmedTick = 900;
    session.peerConfirmedTick = new Map([[0, 1001], [1, 1000], [2, 1004]]);
    assert.equal(session.liveTickCeiling(), 1000);
    assert.equal(session.lagBehindLiveTicks(), 100);

    // A solo player has no peers to wait on and is never "behind".
    session.humanPlayers = [0];
    session.localPlayerId = 0;
    assert.equal(session.liveTickCeiling(), 900);
    assert.equal(session.lagBehindLiveTicks(), 0);
  });

  it('does not fast-forward a healthy match that is one tick apart', () => {
    const session = Object.create(SimSession.prototype);
    session.humanPlayers = [0, 1];
    session.localPlayerId = 0;
    session.confirmedTick = 500;
    session.peerConfirmedTick = new Map([[1, 501]]);
    assert.equal(
      shouldFastForwardLockstep({ lagTicks: session.lagBehindLiveTicks() }),
      false,
    );
  });
});
