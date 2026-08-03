// Catch-up replay — rebuild sim from match config + command ledger, verify checksum.
// Prefer mid-match world checkpoint + ledger delta when available.

import { collectFramesForTick } from '../sim/commandFrame.js';
import { formatMatchTime, matchSecondsFromTick } from './simSession.js';

/** Sim ticks committed per display frame during visible catch-up.
 *  Higher = faster catch-up (less rAF overhead). Large armies still pay per-tick
 *  worker cost — late joiners can treadmill if the live match outruns replay. */
export const CATCHUP_TICKS_PER_FRAME = 80;

export { formatMatchTime, matchSecondsFromTick };

/**
 * @param {import('./simSession.js').SimSession} session
 * @param {object} matchConfig — seed, mode, activeSlots, humanPlayers
 * @param {import('../sim/commandFrame.js').CommandFrame[]} ledgerFrames
 * @param {number} targetTick
 * @param {number} [expectedChecksum]
 * @param {{
 *   ticksPerFrame?: number,
 *   onProgress?: (p: { tick: number, targetTick: number }) => void,
 *   checkpoint?: object | null,
 *   checkpointTick?: number,
 *   baseLedger?: import('../sim/commandFrame.js').CommandFrame[],
 * }} [options]
 */
export async function replayCatchUp(session, matchConfig, ledgerFrames, targetTick, expectedChecksum, options = {}) {
  await session.reset({
    seed: matchConfig.seed,
    mode: 'koth',
    activeSlots: matchConfig.activeSlots,
    armyPerSide: matchConfig.armyPerSide ?? 0,
  });
  session.setHumanPlayers(matchConfig.humanPlayers ?? []);
  session.setLocalPlayerId(-1);
  session.setRole('spectator');

  const checkpoint = options.checkpoint ?? null;
  const checkpointTick = (options.checkpointTick ?? checkpoint?.tick ?? 0) | 0;

  if (checkpoint && checkpointTick > 0) {
    const imported = await session.importCheckpoint(checkpoint, checkpoint.checksum);
    session.confirmedTick = imported.tick;
    session._lastChecksum = imported.checksum;
    if (imported.koth) session.koth = imported.koth;
    if (imported.kothMatchOver != null) session.kothMatchOver = imported.kothMatchOver;
    session._captureSnapshot?.(imported.tick);
  }

  const checksum = await replayCatchUpInto(
    session,
    matchConfig,
    ledgerFrames,
    targetTick,
    expectedChecksum,
    {
      ...options,
      fromTick: checkpoint && checkpointTick > 0 ? checkpointTick : 0,
    },
  );

  const base = options.baseLedger ?? [];
  const merged = checkpoint && checkpointTick > 0
    ? [...base, ...ledgerFrames]
    : ledgerFrames;
  session.replaceFullLedger?.(merged);
  if (checkpoint && checkpointTick > 0) {
    session.cacheCheckpoint?.(checkpoint, checkpoint.checksum >>> 0);
  }
  return checksum;
}

/**
 * @param {import('./simSession.js').SimSession} session — must already be reset/started for this match
 */
export async function replayCatchUpInto(session, matchConfig, ledgerFrames, targetTick, expectedChecksum, options = {}) {
  const ticksPerFrame = options.ticksPerFrame ?? CATCHUP_TICKS_PER_FRAME;
  const onProgress = options.onProgress;
  const fromTick = (options.fromTick ?? 0) | 0;
  const byTick = groupFramesByTick(ledgerFrames);

  session.setHumanPlayers(matchConfig.humanPlayers ?? []);
  session.setRole('spectator');
  session.replayingCatchUp = true;
  session.pauseLockstep = true;
  session.catchupProgress = { tick: fromTick, targetTick: targetTick | 0 };

  try {
    await runReplayTicks(
      session,
      byTick,
      matchConfig.humanPlayers ?? [],
      fromTick,
      targetTick,
      ticksPerFrame,
      onProgress,
    );

    if (expectedChecksum != null && session._lastChecksum !== expectedChecksum) {
      throw new Error(
        `Catch-up checksum mismatch: got ${session._lastChecksum?.toString(16)}, expected ${expectedChecksum.toString(16)}`,
      );
    }
    // Resume lockstep only after a clean replay. Failures leave pauseLockstep
    // set so pump() cannot free-run a half-caught-up world during retry.
    session.pauseLockstep = false;
    session.catchupProgress = null;
    return session._lastChecksum;
  } finally {
    session.replayingCatchUp = false;
  }
}

async function runReplayTicks(session, byTick, humanPlayers, fromTick, targetTick, ticksPerFrame, onProgress) {
  const startTick = Math.max(1, (fromTick | 0) + 1);
  if (startTick > targetTick) {
    session.catchupProgress = { tick: targetTick | 0, targetTick: targetTick | 0 };
    onProgress?.({ tick: targetTick, targetTick });
    return;
  }

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
    for (let t = startTick; t <= targetTick; t++) await commitOne(t);
    return;
  }

  for (let t = startTick; t <= targetTick; ) {
    const batchEnd = Math.min(t + ticksPerFrame - 1, targetTick);
    for (let tick = t; tick <= batchEnd; tick++) await commitOne(tick);
    session.lastSnapshotAt = performance.now();
    session.catchupProgress = { tick: batchEnd, targetTick: targetTick | 0 };
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
