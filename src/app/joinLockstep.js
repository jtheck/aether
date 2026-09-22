// Late-join lockstep — keep a 3rd+ client following the live clock after
// catch-up reset, and put seat / catch-up-ready messages on the broadcast
// fallback that 3-tab meshes need when WebRTC between some pairs fails.

/** Joiner enters quorum the tick AFTER spawn so the spawn tick does not wait on them. */
export function joinQuorumTick(joinTick) {
  return (joinTick | 0) + 1;
}

/** Claiming while this far behind would stall everyone waiting for us. */
export const CLAIM_MAX_LAG_TICKS = 6;
/**
 * Attach seeds every peer confirm at the tip it landed on, so lag reads as zero
 * until real confirms replace them. Let them land before trusting the number.
 */
export const CLAIM_SETTLE_MS = 1000;

/**
 * A client must reach the live tip before claiming so its scheduled spawn is
 * still in the future and its first post-spawn confirm can admit it promptly.
 */
export function canClaimSeatNow({
  catchUpReady = false,
  lagTicks = 0,
  msSinceAttach = Infinity,
} = {}) {
  if (!catchUpReady) return false;
  if (msSinceAttach < CLAIM_SETTLE_MS) return false;
  return (lagTicks | 0) <= CLAIM_MAX_LAG_TICKS;
}

/**
 * Spawn tick for an accepted claim. Sized off the claimer's own reported lag so
 * a joiner that slipped a little behind between claiming and being accepted can
 * still reach the tick everyone will wait at.
 */
export function joinSpawnTick({
  hostTick = 0,
  delayTicks = 24,
  claimerLagTicks = 0,
} = {}) {
  return (hostTick | 0) + (delayTicks | 0) + Math.max(0, claimerLagTicks | 0);
}

/**
 * How long to wait for a reserved joiner's first confirm before dropping them.
 *
 * Reserved joiners do not enter quorum until they speak, so they cannot freeze
 * the match. Give hidden tabs enough time to advance through browser-throttled
 * timers; this only holds the offered seat, not the live simulation.
 */
export const JOIN_CONFIRM_GRACE_MS = 60000;

export function joinConfirmExpired({
  now = 0,
  deadline = 0,
  confirmed = false,
} = {}) {
  if (confirmed) return false;
  if (!deadline) return false;
  return now >= deadline;
}

export function shouldAddJoinerToQuorumNow({ confirmedTick = 0, joinTick = 0 } = {}) {
  return (confirmedTick | 0) >= joinQuorumTick(joinTick);
}

/**
 * A remote joiner enters the quorum on its FIRST CONFIRM at or past the agreed
 * tick — never on the agreed tick alone.
 *
 * Scheduling it by tick meant every peer parked at `joinTick + 1` waiting on a
 * client that might be seconds away, or might never arrive: the join froze the
 * whole table. Waiting for the joiner to speak means nobody ever waits on a
 * ghost. Admitting at slightly different local ticks is safe because the joiner
 * authors no commands before its first confirm tick, so the frames collected in
 * the differing window are identical (empty) on every peer.
 */
export function canAdmitJoinerToQuorum({ confirmTick = 0, earliestTick = 0 } = {}) {
  if (!earliestTick) return false;
  return (confirmTick | 0) >= (earliestTick | 0);
}

/** After reset(), peerConfirmedTick is empty — seed through the attached tip. */
export function seedPeerConfirmTick(tipTick) {
  return (tipTick | 0) + 1;
}

export function shouldHoldLockstepDuringCatchup({
  catchupInFlight = false,
  catchupRequested = false,
  replayingCatchUp = false,
} = {}) {
  return Boolean(catchupInFlight || catchupRequested || replayingCatchUp);
}

export function framesAfterTick(frames, fromTick) {
  const min = fromTick | 0;
  return (frames ?? []).filter((frame) => frame && (frame.tick | 0) > min);
}

/** Start every live player at tip+1, then take any higher held confirms. */
export function mergeHeldConfirms(held, playerIds, tipTick) {
  const ready = seedPeerConfirmTick(tipTick);
  const out = new Map();
  for (const id of playerIds ?? []) out.set(id | 0, ready);
  for (const entry of held ?? []) {
    const id = entry.playerId | 0;
    const tick = entry.tick | 0;
    if (tick > (out.get(id) ?? 0)) out.set(id, tick);
  }
  return out;
}

const BROADCAST_FALLBACK_TYPES = new Set([
  'join_accept',
  'join_ready',
  'join_intent',
  'match_snapshot',
  'match_reset',
  'tick_confirm',
  'request_tick_confirm',
  'command_frame',
  'slot_defeat',
  'shard_gone',
  'catchup_ready',
  'slot_offer',
  'slot_claim',
  'slot_offer_end',
  // Presence only advertises a peer's OWN sponsor, so an observer that misses
  // its assignment never learns who to pull from — and every player refuses it
  // because their tree says somebody else owns that observer.
  'sponsor_assign',
  'sponsor_handoff',
]);

/** Control messages that must survive a missing WebRTC edge (3+ local tabs). */
export function shouldBroadcastLockstepFallback(type) {
  return BROADCAST_FALLBACK_TYPES.has(type);
}

/** A claim with no JOIN_ACCEPT by now is lost — release the HUD and retry. */
export const SLOT_CLAIM_TIMEOUT_MS = 9000;
export const MAX_SLOT_CLAIM_ATTEMPTS = 3;

/**
 * Seat-offer epochs only move forward. Peers mirror the king's offer, so a
 * heartbeat carrying an already-closed epoch must not re-arm it (that is what
 * made an offer appear and vanish while the first two players were starting).
 */
export function shouldApplyOfferState({
  incomingEpoch = 0,
  currentEpoch = 0,
  endedEpoch = 0,
} = {}) {
  // Epochs are wall-clock milliseconds — well past 2^31, so no bitwise coercion.
  const next = Number(incomingEpoch) || 0;
  if (next <= 0) return false;
  if (next < (Number(currentEpoch) || 0)) return false;
  return next > (Number(endedEpoch) || 0);
}

/**
 * Ledger shape for a SNAPSHOT_OFFER envelope.
 *
 * `ledgerTransferId` is a promise that chunks are on their way. Advertising one
 * without sending the chunks parks the joiner on "Receiving catch-up ledger…"
 * until the retry timer, which then makes the identical offer — the loop that
 * kept 3rd+ players on the loading-screen world while the lobby said they were
 * in the match.
 */
export function catchupOfferLedger({ ledger = [], transferId = '' } = {}) {
  const frames = ledger ?? [];
  const chunked = Boolean(transferId) && frames.length > 0;
  return {
    chunked,
    ledger: chunked ? [] : frames,
    ledgerFrameCount: frames.length,
    ledgerTransferId: chunked ? transferId : undefined,
  };
}
