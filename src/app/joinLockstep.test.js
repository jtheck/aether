import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_MAX_LAG_TICKS,
  CLAIM_SETTLE_MS,
  JOIN_CONFIRM_GRACE_MS,
  canAdmitJoinerToQuorum,
  canClaimSeatNow,
  catchupOfferLedger,
  framesAfterTick,
  joinConfirmExpired,
  joinQuorumTick,
  joinSpawnTick,
  mergeHeldConfirms,
  seedPeerConfirmTick,
  shouldAddJoinerToQuorumNow,
  shouldApplyOfferState,
  shouldBroadcastLockstepFallback,
  shouldHoldLockstepDuringCatchup,
} from './joinLockstep.js';

describe('join lockstep', () => {
  it('adds the joiner to quorum the tick after spawn', () => {
    assert.equal(joinQuorumTick(40), 41);
    assert.equal(shouldAddJoinerToQuorumNow({ confirmedTick: 40, joinTick: 40 }), false);
    assert.equal(shouldAddJoinerToQuorumNow({ confirmedTick: 41, joinTick: 40 }), true);
  });

  it('seeds peer confirms through the attached tip so lockstep can start', () => {
    assert.equal(seedPeerConfirmTick(80), 81);
    const seeded = mergeHeldConfirms(
      [{ playerId: 1, tick: 120 }],
      [0, 1],
      80,
    );
    assert.equal(seeded.get(0), 81);
    assert.equal(seeded.get(1), 120);
  });

  it('holds live frames while catch-up is in flight and keeps later ones', () => {
    assert.equal(shouldHoldLockstepDuringCatchup({ catchupRequested: true }), true);
    assert.equal(shouldHoldLockstepDuringCatchup({}), false);
    assert.deepEqual(
      framesAfterTick([{ tick: 80 }, { tick: 81 }, { tick: 90 }], 80).map((f) => f.tick),
      [81, 90],
    );
    assert.deepEqual(
      framesAfterTick([
        { tick: 80, commands: [{ type: 'old' }] },
        { tick: 120, commands: [{ type: 'spawn_slot' }] },
      ], 80).map((f) => f.tick),
      [120],
    );
  });

  it('broadcasts seat and catch-up-ready when a WebRTC edge is missing', () => {
    assert.equal(shouldBroadcastLockstepFallback('slot_offer'), true);
    assert.equal(shouldBroadcastLockstepFallback('slot_claim'), true);
    assert.equal(shouldBroadcastLockstepFallback('catchup_ready'), true);
    assert.equal(shouldBroadcastLockstepFallback('request_tick_confirm'), true);
    assert.equal(shouldBroadcastLockstepFallback('shard_hello'), false);
  });

  it('broadcasts sponsor assignments so a joiner learns who to pull from', () => {
    assert.equal(shouldBroadcastLockstepFallback('sponsor_assign'), true);
    assert.equal(shouldBroadcastLockstepFallback('sponsor_handoff'), true);
  });

  it('only advertises a chunked ledger when chunks are really going out', () => {
    const frames = [{ tick: 1 }, { tick: 2 }];
    const chunked = catchupOfferLedger({ ledger: frames, transferId: 'cu:1' });
    assert.equal(chunked.chunked, true);
    assert.deepEqual(chunked.ledger, []);
    assert.equal(chunked.ledgerTransferId, 'cu:1');
    assert.equal(chunked.ledgerFrameCount, 2);

    // No transfer id: the frames must travel inline, and the receiver must not
    // be told to wait for chunks that nobody sent.
    const inline = catchupOfferLedger({ ledger: frames, transferId: '' });
    assert.equal(inline.chunked, false);
    assert.deepEqual(inline.ledger, frames);
    assert.equal(inline.ledgerTransferId, undefined);

    const empty = catchupOfferLedger({ ledger: [], transferId: 'cu:1' });
    assert.equal(empty.chunked, false);
    assert.equal(empty.ledgerTransferId, undefined);
    assert.equal(empty.ledgerFrameCount, 0);
  });

  it('will not let a lagging client claim and freeze the table', () => {
    assert.equal(canClaimSeatNow({ catchUpReady: true, lagTicks: 0 }), true);
    assert.equal(canClaimSeatNow({ catchUpReady: true, lagTicks: CLAIM_MAX_LAG_TICKS }), true);
    assert.equal(canClaimSeatNow({ catchUpReady: true, lagTicks: CLAIM_MAX_LAG_TICKS + 1 }), false);
    assert.equal(canClaimSeatNow({ catchUpReady: true, lagTicks: 300 }), false);
    assert.equal(canClaimSeatNow({ catchUpReady: false, lagTicks: 0 }), false);
  });

  it('waits for seeded peer confirms to be replaced by real ones', () => {
    // Attach seeds every confirm at the tip, so lag reads as zero for a moment.
    assert.equal(
      canClaimSeatNow({ catchUpReady: true, lagTicks: 0, msSinceAttach: 0 }),
      false,
    );
    assert.equal(
      canClaimSeatNow({ catchUpReady: true, lagTicks: 0, msSinceAttach: CLAIM_SETTLE_MS }),
      true,
    );
  });

  it('sizes the spawn tick so a slightly behind claimer can still reach it', () => {
    assert.equal(joinSpawnTick({ hostTick: 1000, delayTicks: 24 }), 1024);
    assert.equal(joinSpawnTick({ hostTick: 1000, delayTicks: 24, claimerLagTicks: 5 }), 1029);
    assert.equal(joinSpawnTick({ hostTick: 1000, delayTicks: 24, claimerLagTicks: -9 }), 1024);
  });

  it('admits a joiner on its first confirm, never on the agreed tick alone', () => {
    // Nobody may park at the joiner's quorum tick before the joiner speaks.
    assert.equal(canAdmitJoinerToQuorum({ confirmTick: 100, earliestTick: 0 }), false);
    assert.equal(canAdmitJoinerToQuorum({ confirmTick: 40, earliestTick: 41 }), false);
    assert.equal(canAdmitJoinerToQuorum({ confirmTick: 41, earliestTick: 41 }), true);
    assert.equal(canAdmitJoinerToQuorum({ confirmTick: 900, earliestTick: 41 }), true);
  });

  it('drops a reserved joiner that never entered lockstep', () => {
    assert.ok(JOIN_CONFIRM_GRACE_MS >= 60000, 'hidden tabs need a background-throttle-safe grace period');
    assert.equal(joinConfirmExpired({ now: 100, deadline: 200 }), false);
    assert.equal(joinConfirmExpired({ now: 200, deadline: 200 }), true);
    assert.equal(joinConfirmExpired({ now: 999, deadline: 200, confirmed: true }), false);
    assert.equal(joinConfirmExpired({ now: 999, deadline: 0 }), false);
  });

  it('never lets a closed seat offer come back to life', () => {
    assert.equal(shouldApplyOfferState({ incomingEpoch: 20, currentEpoch: 10 }), true);
    assert.equal(shouldApplyOfferState({ incomingEpoch: 10, currentEpoch: 10 }), true);
    assert.equal(shouldApplyOfferState({ incomingEpoch: 9, currentEpoch: 10 }), false);
    assert.equal(shouldApplyOfferState({ incomingEpoch: 10, endedEpoch: 10 }), false);
    assert.equal(shouldApplyOfferState({ incomingEpoch: 11, endedEpoch: 10 }), true);
    assert.equal(shouldApplyOfferState({ incomingEpoch: 0 }), false);
  });
});
