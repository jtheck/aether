import { sameUserId } from './ids.js';
import { gardenUrlForChapter, getMode, mapTilesForField } from './modes.js';

/**
 * Team id per owner index. Null = FFA (1v1). Adventure is one allied team.
 * @param {string} modeId
 * @param {number} ownerCount
 */
export function teamByOwnerForMode(modeId, ownerCount) {
  const n = Math.max(1, ownerCount | 0);
  const mode = getMode(modeId);
  if (!mode) return null;
  if (mode.id === 'onevsone') return null;
  const out = new Array(n);
  if (mode.teams) {
    for (let i = 0; i < n; i++) out[i] = i < 2 ? 0 : 1;
    return out;
  }
  // Adventure — everyone allied.
  out.fill(0);
  return out;
}

/**
 * @param {string} modeId
 * @param {number} localPlayerId
 * @param {number[] | null} teamByOwner
 * @param {number[]} activeSlots
 */
export function shareVisionForLobby(modeId, localPlayerId, teamByOwner, activeSlots) {
  if (modeId === 'adventure') return { sharedVision: true, shareVisionWith: undefined };
  if (modeId === 'teams' && teamByOwner && localPlayerId >= 0) {
    const myTeam = teamByOwner[localPlayerId];
    return {
      sharedVision: false,
      shareVisionWith: activeSlots.filter((id) => id !== localPlayerId && teamByOwner[id] === myTeam),
    };
  }
  return { sharedVision: false, shareVisionWith: [] };
}

/**
 * Deterministic live config from a lobby snapshot. Owner id = seat index.
 * @param {object} state
 * @param {string | null} localUserId
 */
export function liveConfigFromLobby(state, localUserId) {
  const humans = (state.seats ?? []).filter((s) => s.kind === 'human');
  const activeSlots = humans.map((s) => s.index).sort((a, b) => a - b);
  const local = humans.find((s) => sameUserId(s.userId, localUserId));
  const localPlayerId = local ? local.index : -1;
  const maxOwner = activeSlots.length ? activeSlots[activeSlots.length - 1] + 1 : 0;
  const { mapW, mapH } = mapTilesForField(state.settings?.fieldSize);
  const teamByOwner = teamByOwnerForMode(state.mode, Math.max(maxOwner, getMode(state.mode)?.maxPlayers ?? 0));
  const vision = shareVisionForLobby(state.mode, localPlayerId, teamByOwner, activeSlots);
  const localSolo = activeSlots.length < 2;
  return {
    mode: state.mode,
    seed: (state.settings?.seed ?? 0) >>> 0,
    localPlayerId,
    humanPlayers: activeSlots,
    activeSlots,
    aiPlayers: [],
    role: localPlayerId >= 0 ? 'player' : 'spectator',
    mapW,
    mapH,
    noCenterBlock: true,
    laneBases: Boolean(getMode(state.mode)?.teams),
    teamByOwner,
    matchId: state.roomId,
    fog: true,
    fieldSize: state.settings?.fieldSize ?? '',
    chapter: state.settings?.chapter ?? '',
    gardenUrl: gardenUrlForChapter(state.settings?.chapter),
    localSolo,
    inputDelayTicks: localSolo ? 0 : 1,
    ...vision,
  };
}
