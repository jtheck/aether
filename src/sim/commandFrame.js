// Tick-indexed command frames — the wire format for lockstep P2P and SimSession.

/** @typedef {{ type: number, entities: number[], tx?: number[], ty?: number[], target?: number }} SimCommand */
/** @typedef {{ tick: number, playerId: number, commands: SimCommand[], commandId?: string, playerCommandSeq?: number }} CommandFrame */

/** Merge frames for one tick into a single command list (deterministic player order). */
export function mergeFrames(frames) {
  if (!frames?.length) return null;
  const sorted = [...frames].sort((a, b) => a.playerId - b.playerId);
  let out = null;
  for (const frame of sorted) {
    if (!frame.commands?.length) continue;
    out = out ? [...out, ...frame.commands] : [...frame.commands];
  }
  return out;
}

/**
 * Buffer a frame in the ledger. Returns false if the frame is late (tick already committed).
 * @param {Map<number, Map<number, SimCommand[]>>} ledger
 */
export function bufferFrame(ledger, frame, confirmedTick) {
  if (frame.tick <= confirmedTick) return false;
  let byPlayer = ledger.get(frame.tick);
  if (!byPlayer) {
    byPlayer = new Map();
    ledger.set(frame.tick, byPlayer);
  }
  const incoming = frame.commands ?? [];
  const existing = byPlayer.get(frame.playerId);
  if (existing?.length) byPlayer.set(frame.playerId, [...existing, ...incoming]);
  else byPlayer.set(frame.playerId, incoming);
  return true;
}

/** @param {Map<number, Map<number, SimCommand[]>>} ledger */
export function collectFramesForTick(ledger, tick, playerIds) {
  const byPlayer = ledger.get(tick);
  const frames = [];
  for (const playerId of playerIds) {
    const commands = byPlayer?.get(playerId);
    if (commands?.length) frames.push({ tick, playerId, commands });
  }
  return frames;
}

/** Drop ledger entries at or before confirmedTick. */
export function pruneLedger(ledger, confirmedTick) {
  for (const tick of ledger.keys()) {
    if (tick <= confirmedTick) ledger.delete(tick);
  }
}
