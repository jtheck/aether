// Catch-up replay — rebuild sim from match config + command ledger, verify checksum.

import { collectFramesForTick } from '../sim/commandFrame.js';
import { formatMatchTime, matchSecondsFromTick } from './simSession.js';

/** Sim ticks committed per display frame during visible catch-up (~1 match-second at 60fps). */
export const CATCHUP_TICKS_PER_FRAME = 20;

export { formatMatchTime, matchSecondsFromTick };

/**
 * @param {import('./simSession.js').SimSession} session
 * @param {object} matchConfig — seed, mode, activeSlots, humanPlayers
 * @param {import('../sim/commandFrame.js').CommandFrame[]} ledgerFrames
 * @param {number} targetTick
 * @param {number} [expectedChecksum]
 * @param {{ ticksPerFrame?: number, onProgress?: (p: { tick: number, targetTick: number }) => void }} [options]
 */
export async function replayCatchUp(session, matchConfig, ledgerFrames, targetTick, expectedChecksum, options = {}) {
  await session.reset({
    seed: matchConfig.seed,
    mode: 'koth',
    activeSlots: matchConfig.activeSlots,
  });
  session.setHumanPlayers(matchConfig.humanPlayers ?? []);
  session.setLocalPlayerId(-1);
  session.setRole('spectator');

  const checksum = await replayCatchUpInto(
    session,
    matchConfig,
    ledgerFrames,
    targetTick,
    expectedChecksum,
    options,
  );
  session.replaceFullLedger?.(ledgerFrames);
  return checksum;
}

/**
 * @param {import('./simSession.js').SimSession} session — must already be reset/started for this match
 */
export async function replayCatchUpInto(session, matchConfig, ledgerFrames, targetTick, expectedChecksum, options = {}) {
  const ticksPerFrame = options.ticksPerFrame ?? CATCHUP_TICKS_PER_FRAME;
  const onProgress = options.onProgress;
  const byTick = groupFramesByTick(ledgerFrames);

  session.setHumanPlayers(matchConfig.humanPlayers ?? []);
  session.setRole('spectator');
  session.replayingCatchUp = true;
  session.pauseLockstep = true;

  try {
    await runReplayTicks(session, byTick, matchConfig.humanPlayers ?? [], targetTick, ticksPerFrame, onProgress);

    if (expectedChecksum != null && session._lastChecksum !== expectedChecksum) {
      throw new Error(
        `Catch-up checksum mismatch: got ${session._lastChecksum?.toString(16)}, expected ${expectedChecksum.toString(16)}`,
      );
    }
    // Resume lockstep only after a clean replay. Failures leave pauseLockstep
    // set so pump() cannot free-run a half-caught-up world during retry.
    session.pauseLockstep = false;
    return session._lastChecksum;
  } finally {
    session.replayingCatchUp = false;
  }
}

async function runReplayTicks(session, byTick, humanPlayers, targetTick, ticksPerFrame, onProgress) {
  const commitOne = async (tick) => {
    const frames = collectFramesForTick(byTick, tick, humanPlayers);
    const { checksum, extra } = await session.client.commitTickAsync(tick, frames);
    session.confirmedTick = tick;
    session._lastChecksum = checksum;
    if (extra?.koth) session.koth = extra.koth;
    if (extra?.kothMatchOver != null) session.kothMatchOver = extra.kothMatchOver;
    session._captureSnapshot(tick);
  };

  if (ticksPerFrame <= 0) {
    for (let t = 1; t <= targetTick; t++) await commitOne(t);
    return;
  }

  for (let t = 1; t <= targetTick; ) {
    const batchEnd = Math.min(t + ticksPerFrame - 1, targetTick);
    for (let tick = t; tick <= batchEnd; tick++) await commitOne(tick);
    session.lastSnapshotAt = performance.now();
    onProgress?.({ tick: batchEnd, targetTick });
    if (batchEnd < targetTick) await waitAnimationFrame();
    t = batchEnd + 1;
  }
}

function waitAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
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
