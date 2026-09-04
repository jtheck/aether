import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCKSTEP_STALL_UI_MS, SimSession } from './simSession.js';

function sessionTwoPlayer() {
  const session = Object.create(SimSession.prototype);
  session.localPlayerId = 0;
  session.humanPlayers = [0, 1];
  session.peerConfirmedTick = new Map();
  session.pendingJoins = new Map();
  session.pendingLeaves = new Map();
  session.confirmedTick = 10;
  session.pauseLockstep = false;
  session.resetting = false;
  session.replayingCatchUp = false;
  session._lockstepBlockedAt = 0;
  return session;
}

describe('simSession lockstep leave', () => {
  it('stops waiting for a peer after they are removed from quorum', () => {
    const session = sessionTwoPlayer();
    session.setPeerConfirmedTick(1, 8);
    assert.equal(session._canAdvance(11), false);
    session.removeHumanPlayer(1);
    assert.deepEqual(session.humanPlayers, [0]);
    assert.equal(session._canAdvance(11), true);
    assert.equal(session.peerConfirmedTick.has(1), false);
  });

  it('applies a scheduled leave before the confirm check', () => {
    const session = sessionTwoPlayer();
    session.confirmedTick = 4;
    session.setPeerConfirmedTick(1, 3);
    session.scheduleLeave(5, 1);
    session._applyPendingRoster(5);
    assert.deepEqual(session.humanPlayers, [0]);
    assert.equal(session._canAdvance(5), true);
  });

  it('reports stall time only while a peer confirm is missing', () => {
    const session = sessionTwoPlayer();
    session.confirmedTick = 2;
    const t0 = 1_000;
    assert.equal(session.lockstepBlockedMs(t0), 0);
    assert.ok(session.lockstepBlockedMs(t0 + LOCKSTEP_STALL_UI_MS) >= LOCKSTEP_STALL_UI_MS);
    session.setPeerConfirmedTick(1, 3);
    assert.equal(session.lockstepBlockedMs(t0 + LOCKSTEP_STALL_UI_MS + 50), 0);
  });

  it('clears stall after the missing peer leaves', () => {
    const session = sessionTwoPlayer();
    session.confirmedTick = 2;
    session.lockstepBlockedMs(500);
    assert.deepEqual(session.lockstepWaiters(), [1]);
    session.removeHumanPlayer(1);
    assert.deepEqual(session.lockstepWaiters(), []);
    assert.equal(session.lockstepBlockedMs(4_000), 0);
  });
});
