import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KOTH_APP_STATE, SHARD_PHASE } from './protocol.js';
import { isBrowsePresence, isLiveMatchMember, isMatchLeavePresence, isSpectatorMember } from './presence.js';

const matchId = 'koth-abc-12345678';

describe('koth presence membership', () => {
  it('treats a private sandbox announcer as browsing, not in the match', () => {
    const data = {
      from: 'peer-1',
      matchId: 'koth-other-ffffffff',
      phase: SHARD_PHASE.SANDBOX,
      appState: KOTH_APP_STATE.PRIVATE_SANDBOX,
      role: 'player',
    };
    assert.equal(isBrowsePresence(data), true);
    assert.equal(isLiveMatchMember(data, matchId), false);
    assert.equal(isSpectatorMember(data, matchId), false);
  });

  it('does not treat another match\'s spectator as in this lobby', () => {
    const data = {
      from: 'peer-2',
      matchId: 'koth-other-ffffffff',
      phase: SHARD_PHASE.LIVE,
      appState: KOTH_APP_STATE.SPECTATOR,
      role: 'spectator',
    };
    assert.equal(isLiveMatchMember(data, matchId), false);
    assert.equal(isSpectatorMember(data, matchId), false);
  });

  it('accepts a live spectator on this match', () => {
    const data = {
      from: 'peer-3',
      matchId,
      phase: SHARD_PHASE.LIVE,
      appState: KOTH_APP_STATE.SPECTATOR,
      role: 'spectator',
    };
    assert.equal(isBrowsePresence(data), false);
    assert.equal(isLiveMatchMember(data, matchId), true);
    assert.equal(isSpectatorMember(data, matchId), true);
  });

  it('accepts a live player on this match, but not as a spectator', () => {
    const data = {
      from: 'peer-4',
      matchId,
      phase: SHARD_PHASE.LIVE,
      appState: KOTH_APP_STATE.LIVE_PLAYER,
      role: 'player',
    };
    assert.equal(isLiveMatchMember(data, matchId), true);
    assert.equal(isSpectatorMember(data, matchId), false);
  });

  it('treats an explicit leave as not in the match', () => {
    const data = {
      from: 'peer-5',
      matchId,
      left: true,
      phase: SHARD_PHASE.LIVE,
      appState: KOTH_APP_STATE.SPECTATOR,
      role: 'spectator',
    };
    assert.equal(isMatchLeavePresence(data, matchId), true);
    assert.equal(isLiveMatchMember(data, matchId), false);
    assert.equal(isSpectatorMember(data, matchId), false);
  });
});
