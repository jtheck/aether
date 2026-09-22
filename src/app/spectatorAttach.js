// Spectator attach — keep the loading-screen 3-villager stub from counting
// as the live KOTH world. Catch-up may only skip after the host sim is applied.

/**
 * Loading-screen / leftover 1v1 backdrop must not count as the live match.
 * Catch-up may only skip when we have actually attached the host world.
 */
export function canSkipCatchupRequest({
  catchUpReady = false,
  liveSimAttached = false,
  catchupInFlight = false,
} = {}) {
  if (catchupInFlight) return true;
  return Boolean(catchUpReady && liveSimAttached);
}

/**
 * Tick to put on SNAPSHOT_REQUEST.
 * The loading-screen stub's confirmedTick must not be used as the live clock.
 * Before attach, only a host-authored `requestedTick` (snapshot) or presence
 * `hostTick` is valid — never `sessionTick`.
 */
export function catchupRequestTick({
  requestedTick = 0,
  sessionTick = 0,
  hostTick = 0,
  liveSimAttached = false,
} = {}) {
  const req = requestedTick | 0;
  if (liveSimAttached) return req > 0 ? req : (sessionTick | 0);
  return req > 0 ? req : (hostTick | 0);
}

/** Solo-king offers still need a checkpoint. Tick 0 after a reset is a real world. */
export function soloLiveOfferHasWorld(msg) {
  return Boolean(msg?.checkpoint);
}

/** Tick 0 is a real world — a solo king that just went live sits there. */
export function canUseCatchupCheckpoint({ cached = null, tipTick = 0 } = {}) {
  return Boolean(cached?.checkpoint) && (cached.tick | 0) <= (tipTick | 0);
}

/**
 * When the offer tick is the checkpoint tick, the tip leftover hash from a
 * previous board must not be sent — that is the 5abf113 vs d9b73327 failure.
 */
export function catchupOfferChecksum({
  offerTick = 0,
  checkpointTick = 0,
  useCheckpoint = false,
  cachedChecksum,
  tipChecksum,
} = {}) {
  if (useCheckpoint && (offerTick | 0) === (checkpointTick | 0) && cachedChecksum != null) {
    return cachedChecksum >>> 0;
  }
  return tipChecksum >>> 0;
}

export function sameCatchupChecksum(got, expected) {
  if (expected == null) return true;
  if (got == null) return false;
  return (got >>> 0) === (expected >>> 0);
}

/** Wait for an advertised checkpoint, including tick 0 after a match reset.
 *  Legacy offers used checkpointTick: 0 to mean "none" — those omit checksum. */
export function needsCatchupCheckpoint(msg, checkpoint) {
  if (checkpoint) return false;
  if (msg?.checkpointTick == null) return false;
  if ((msg.checkpointTick | 0) > 0) return true;
  return msg.checkpointChecksum != null;
}

/** Replay every player who authored a ledger frame, not just the live roster. */
export function catchupReplayPlayerIds(humanPlayers = [], ledgerFrames = []) {
  const ids = new Set();
  for (const id of humanPlayers) ids.add(id | 0);
  for (const frame of ledgerFrames) {
    if (frame && frame.playerId != null) ids.add(frame.playerId | 0);
  }
  return [...ids].sort((a, b) => a - b);
}

export function isSoloLiveSpectatorOffer(msg, rosterActiveCount = 0) {
  return Boolean(msg?.soloLive && (rosterActiveCount | 0) <= 1);
}

/** Backdrop 1v1 / staging must not stomp a live spectator session. */
export function isLoadingScreenBackdropConfig(cfg) {
  if (!cfg?.localSolo) return false;
  const mode = cfg.mode;
  return mode === 'skirmish' || mode === 'staging' || mode === 'sandbox';
}

/** Public KOTH (not the loading-screen 1v1). */
export function isLiveNetworkConfig(cfg) {
  return cfg?.mode === 'koth' && !cfg.localSolo;
}

/**
 * localSoloHold blocks leftover staging stomps. Auto-follow onto a live
 * shard must still apply — P3 never clicks a lobby row, so onLeaveSolo
 * never runs and they stay on the placeholder 1v1.
 */
export function shouldIgnoreLiveConfig({ cfg, localSoloHold = false } = {}) {
  if (!localSoloHold) return false;
  return !isLiveNetworkConfig(cfg);
}

export function shouldBlockBackdropApply({ cfg, liveSpectating = false } = {}) {
  return Boolean(liveSpectating && isLoadingScreenBackdropConfig(cfg));
}

/**
 * A MATCH_SNAPSHOT re-keys the board. Re-applying one we already have (they
 * arrive again over broadcast / relay) pauses lockstep and wipes a reserved
 * seat, so only a genuinely new start key may restart catch-up.
 */
export function shouldRestartSpectatorCatchup({
  liveStartKey = '',
  nextKey = '',
  liveSimAttached = false,
  catchupInFlight = false,
  catchupRequested = false,
} = {}) {
  if (!nextKey || liveStartKey !== nextKey) return true;
  if (liveSimAttached || catchupInFlight || catchupRequested) return false;
  return true;
}

export function shouldKeepSpectatorJoin({
  pendingLocalJoin = false,
  joining = false,
} = {}) {
  return Boolean(pendingLocalJoin || joining);
}

/** P2P offers put ledger:[] on the envelope and ship frames in chunks. */
export function expectCatchupLedgerChunks(msg) {
  return Boolean(msg?.ledgerTransferId && (msg.ledgerFrameCount | 0) > 0);
}

/**
 * Resolve checkpoint + ledger from the offer, chunk parts, and a cached world.
 * An empty ledger with ledgerFrameCount 0 is complete (tip checkpoint).
 */
export function resolveCatchupOfferWorld(msg, parts = {}, cached = null) {
  const advertisedTick = msg?.checkpointTick;
  const checkpointTick = advertisedTick | 0;
  let checkpoint = msg?.checkpoint ?? parts.checkpoint ?? null;
  const cacheTickMatches = advertisedTick != null && cached != null && (cached.tick | 0) === checkpointTick;
  const cacheAdvertised = cacheTickMatches && (
    (checkpointTick | 0) > 0 || msg.checkpointChecksum != null
  );
  if (!checkpoint && cached?.checkpoint && cacheAdvertised) {
    const want = msg.checkpointChecksum;
    if (want == null || sameCatchupChecksum(cached.checksum, want)) {
      checkpoint = cached.checkpoint;
    }
  }
  const ledger = parts.ledger ?? (
    expectCatchupLedgerChunks(msg) ? null : (msg?.ledger ?? [])
  );
  return { checkpoint, ledger };
}
