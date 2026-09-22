import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSkipCatchupRequest,
  canUseCatchupCheckpoint,
  catchupOfferChecksum,
  catchupReplayPlayerIds,
  catchupRequestTick,
  expectCatchupLedgerChunks,
  isLiveNetworkConfig,
  isLoadingScreenBackdropConfig,
  isSoloLiveSpectatorOffer,
  shouldIgnoreLiveConfig,
  needsCatchupCheckpoint,
  resolveCatchupOfferWorld,
  sameCatchupChecksum,
  shouldBlockBackdropApply,
  shouldKeepSpectatorJoin,
  shouldRestartSpectatorCatchup,
  soloLiveOfferHasWorld,
} from './spectatorAttach.js';

describe('spectator attach', () => {
  it('does not treat a ticking stub as already caught up', () => {
    assert.equal(canSkipCatchupRequest({
      catchUpReady: true,
      liveSimAttached: false,
      catchupInFlight: false,
    }), false);
    assert.equal(canSkipCatchupRequest({
      catchUpReady: true,
      liveSimAttached: true,
    }), true);
    assert.equal(canSkipCatchupRequest({
      catchUpReady: false,
      liveSimAttached: true,
    }), false);
    assert.equal(canSkipCatchupRequest({ catchupInFlight: true }), true);
  });

  it('ignores the loading-screen clock until the host world is attached', () => {
    assert.equal(catchupRequestTick({
      requestedTick: 0,
      sessionTick: 8400,
      hostTick: 120,
      liveSimAttached: false,
    }), 120);
    assert.equal(catchupRequestTick({
      requestedTick: 200,
      sessionTick: 8400,
      hostTick: 120,
      liveSimAttached: false,
    }), 200);
    assert.equal(catchupRequestTick({
      requestedTick: 0,
      sessionTick: 8400,
      hostTick: 0,
      liveSimAttached: false,
    }), 0);
    assert.equal(catchupRequestTick({
      requestedTick: 0,
      sessionTick: 500,
      hostTick: 120,
      liveSimAttached: true,
    }), 500);
  });

  it('requires a solo-live checkpoint before marking the spectator ready', () => {
    assert.equal(isSoloLiveSpectatorOffer({ soloLive: true }, 1), true);
    assert.equal(isSoloLiveSpectatorOffer({ soloLive: true }, 2), false);
    assert.equal(soloLiveOfferHasWorld({
      checkpoint: { tick: 40 },
      checkpointTick: 40,
    }), true);
    assert.equal(soloLiveOfferHasWorld({ checkpointTick: 40 }), false);
    assert.equal(soloLiveOfferHasWorld({ checkpoint: { tick: 0 }, checkpointTick: 0 }), true);
  });

  it('treats a tick-0 reset checkpoint as a real host world', () => {
    assert.equal(canUseCatchupCheckpoint({
      cached: { checkpoint: { tick: 0 }, tick: 0, checksum: 0xabc },
      tipTick: 0,
    }), true);
    assert.equal(canUseCatchupCheckpoint({ cached: null, tipTick: 0 }), false);
    assert.equal(catchupOfferChecksum({
      offerTick: 0,
      checkpointTick: 0,
      useCheckpoint: true,
      cachedChecksum: 0x111,
      tipChecksum: 0xd9b73327,
    }), 0x111);
    assert.equal(catchupOfferChecksum({
      offerTick: 200,
      checkpointTick: 80,
      useCheckpoint: true,
      cachedChecksum: 0x111,
      tipChecksum: 0xd9b73327,
    }), 0xd9b73327);
    assert.equal(needsCatchupCheckpoint({ checkpointTick: 0, checkpointChecksum: 0x111 }, null), true);
    assert.equal(needsCatchupCheckpoint({ checkpointTick: 0 }, null), false);
    assert.equal(needsCatchupCheckpoint({ checkpointTick: 80 }, null), true);
    assert.equal(needsCatchupCheckpoint({ checkpointTick: 0, checkpointChecksum: 0x111 }, { tick: 0 }), false);
    assert.equal(sameCatchupChecksum(0xd9b73327, -642305241), true);
    assert.equal(sameCatchupChecksum(0x05abf113, 0xd9b73327), false);
  });

  it('replays ledger authors even if the live roster omitted them', () => {
    assert.deepEqual(
      catchupReplayPlayerIds([0], [{ tick: 4, playerId: 1, commands: [{}] }]),
      [0, 1],
    );
  });

  it('resolves an offer when the spectator has no cached world', () => {
    const resolved = resolveCatchupOfferWorld(
      { checkpointTick: 80, checkpointChecksum: 0xabc, ledger: [], ledgerFrameCount: 0 },
      {},
      null,
    );
    assert.equal(resolved.checkpoint, null);
    assert.deepEqual(resolved.ledger, []);
  });

  it('does not reuse a leftover cache when the offer has no checkpoint', () => {
    const leftover = resolveCatchupOfferWorld(
      { ledger: [], ledgerFrameCount: 0 },
      {},
      { checkpoint: { tick: 0 }, tick: 0, checksum: 0x05abf113 },
    );
    assert.equal(leftover.checkpoint, null);
    const mismatch = resolveCatchupOfferWorld(
      { checkpointTick: 80, checkpointChecksum: 0xd9b73327, ledger: [], ledgerFrameCount: 0 },
      {},
      { checkpoint: { tick: 80 }, tick: 80, checksum: 0x05abf113 },
    );
    assert.equal(mismatch.checkpoint, null);
  });

  it('does not restart catch-up for a 3rd+ spectator already on this start', () => {
    assert.equal(shouldRestartSpectatorCatchup({
      liveStartKey: 'm:1:a|b',
      nextKey: 'm:1:a|b',
      liveSimAttached: true,
    }), false);
    assert.equal(shouldRestartSpectatorCatchup({
      liveStartKey: 'm:1:a|b',
      nextKey: 'm:1:a|b',
      catchupInFlight: true,
    }), false);
    assert.equal(shouldRestartSpectatorCatchup({
      liveStartKey: 'm:1:a|b',
      nextKey: 'm:1:a|b',
      catchupRequested: true,
    }), false);
    assert.equal(shouldRestartSpectatorCatchup({
      liveStartKey: '',
      nextKey: 'm:1:a|b',
    }), true);
    assert.equal(shouldRestartSpectatorCatchup({
      liveStartKey: 'old',
      nextKey: 'm:1:a|b',
    }), true);
  });

  it('keeps a reserved 3rd+ seat through the tick-0 start snapshot', () => {
    assert.equal(shouldKeepSpectatorJoin({ pendingLocalJoin: true }), true);
    assert.equal(shouldKeepSpectatorJoin({ joining: true }), true);
    assert.equal(shouldKeepSpectatorJoin({}), false);
  });

  it('does not wait for empty tip-checkpoint ledger chunks', () => {
    assert.equal(expectCatchupLedgerChunks({
      ledgerTransferId: 'cu:1',
      ledgerFrameCount: 0,
    }), false);
    assert.equal(expectCatchupLedgerChunks({
      ledgerTransferId: 'cu:1',
      ledgerFrameCount: 12,
    }), true);
    const tip = resolveCatchupOfferWorld(
      { checkpointTick: 80, ledger: [], ledgerFrameCount: 0 },
      {},
      { checkpoint: { tick: 80 }, tick: 80 },
    );
    assert.equal(tip.checkpoint.tick, 80);
    assert.deepEqual(tip.ledger, []);
  });

  it('lets a live KOTH config through localSoloHold so P3 leaves the 1v1 stub', () => {
    const live = { mode: 'koth', role: 'spectator', localSolo: false };
    const stub = { mode: 'skirmish', localSolo: true };
    assert.equal(isLiveNetworkConfig(live), true);
    assert.equal(isLiveNetworkConfig(stub), false);
    assert.equal(shouldIgnoreLiveConfig({ cfg: live, localSoloHold: true }), false);
    assert.equal(shouldIgnoreLiveConfig({ cfg: stub, localSoloHold: true }), true);
    assert.equal(shouldIgnoreLiveConfig({ cfg: live, localSoloHold: false }), false);
  });

  it('blocks the 3-villager backdrop from stomping a live spectator', () => {
    const stub = { mode: 'skirmish', localSolo: true };
    assert.equal(isLoadingScreenBackdropConfig(stub), true);
    assert.equal(shouldBlockBackdropApply({ cfg: stub, liveSpectating: true }), true);
    assert.equal(shouldBlockBackdropApply({ cfg: stub, liveSpectating: false }), false);
    assert.equal(shouldBlockBackdropApply({
      cfg: { mode: 'koth', localSolo: false },
      liveSpectating: true,
    }), false);
  });
});
