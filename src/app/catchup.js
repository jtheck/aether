// Catch-up replay — rebuild sim from match config + command ledger, verify checksum.

import { collectFramesForTick } from '../sim/commandFrame.js';

/**
 * @param {import('./simSession.js').SimSession} session
 * @param {object} matchConfig — seed, mode, activeSlots, humanPlayers
 * @param {import('../sim/commandFrame.js').CommandFrame[]} ledgerFrames
 * @param {number} targetTick
 * @param {number} [expectedChecksum]
 */
export async function replayCatchUp(session, matchConfig, ledgerFrames, targetTick, expectedChecksum) {
  const byTick = groupFramesByTick(ledgerFrames);

  await session.reset({
    seed: matchConfig.seed,
    mode: 'koth',
    activeSlots: matchConfig.activeSlots,
  });

  session.setHumanPlayers(matchConfig.humanPlayers);
  session.setRole('spectator');
  session.pauseLockstep = true;

  for (let t = 1; t <= targetTick; t++) {
    const frames = collectFramesForTick(byTick, t, matchConfig.humanPlayers);
    const { checksum, extra } = await session.client.commitTickAsync(t, frames);
    session.confirmedTick = t;
    session._lastChecksum = checksum;
    if (extra?.koth) session.koth = extra.koth;
    if (extra?.kothMatchOver != null) session.kothMatchOver = extra.kothMatchOver;
    session._captureSnapshot(t);
  }

  session.pauseLockstep = false;

  if (expectedChecksum != null && session._lastChecksum !== expectedChecksum) {
    throw new Error(
      `Catch-up checksum mismatch: got ${session._lastChecksum?.toString(16)}, expected ${expectedChecksum.toString(16)}`,
    );
  }

  return session._lastChecksum;
}

/** @param {import('../sim/commandFrame.js').CommandFrame[]} frames */
function groupFramesByTick(frames) {
  /** @type {Map<number, Map<number, import('../sim/commandFrame.js').SimCommand[]>>} */
  const ledger = new Map();
  for (const frame of frames) {
    let byPlayer = ledger.get(frame.tick);
    if (!byPlayer) {
      byPlayer = new Map();
      ledger.set(frame.tick, byPlayer);
    }
    const incoming = frame.commands ?? [];
    const existing = byPlayer.get(frame.playerId);
    if (existing?.length) byPlayer.set(frame.playerId, [...existing, ...incoming]);
    else byPlayer.set(frame.playerId, incoming);
  }
  return ledger;
}
