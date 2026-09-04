import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimSession, clearSessionTableState } from './simSession.js';

describe('clearSessionTableState', () => {
  it('drops KOTH leftovers and queued FX so a new board cannot inherit them', () => {
    const session = {
      koth: { scores: [9, 1] },
      kothMatchOver: 1,
      matchWinner: 2,
      _checkpoint: { tick: 40 },
      _checkpointTick: 40,
      _checkpointChecksum: 99,
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
