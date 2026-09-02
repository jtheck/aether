// Desktop Steam API (NW.js shell only). No-ops in the browser.
// Requires aetherDesktop.steam from steam-build bridge.js.

export const ACH_FIRST_LAUNCH = 'ACH_FIRST_LAUNCH';
export const ACH_FIRST_MATCH = 'ACH_FIRST_MATCH';
export const ACH_KOTH_DEFEAT = 'ACH_KOTH_DEFEAT';

/** Agora occupy loss — not a score wipe, not a spectator. */
export function isKothAgoraDefeat(session) {
  if (!session) return false;
  if ((session.role ?? 'player') !== 'player') return false;
  const winner = session.matchWinner;
  if (winner == null || winner < 0) return false;
  return winner !== (session.localPlayerId ?? 0);
}

function steamFrom(root) {
  return root.aetherDesktop && root.aetherDesktop.steam;
}

/**
 * @param {{
 *   root?: object,
 *   steam?: () => object | null | undefined,
 * }} [opts]
 */
export function createAetherSteam(opts = {}) {
  const root = opts.root ?? (typeof globalThis !== 'undefined' ? globalThis : {});

  function steam() {
    return opts.steam ? opts.steam() : steamFrom(root);
  }

  const api = {
    ACH_FIRST_LAUNCH,
    ACH_FIRST_MATCH,
    ACH_KOTH_DEFEAT,
    _firstLaunchHandled: false,
    _firstMatchHandled: false,
    _kothDefeatHandled: false,

    isAvailable() {
      const s = steam();
      return !!(s && s.isAvailable && s.isAvailable());
    },

    getInfo() {
      const s = steam();
      return s && s.getInfo ? s.getInfo() : { available: false };
    },

    isAchievementUnlocked(name) {
      const s = steam();
      return s && s.isAchievementUnlocked ? s.isAchievementUnlocked(name) : false;
    },

    unlockAchievement(name) {
      const s = steam();
      return s && s.unlockAchievement ? s.unlockAchievement(name) : false;
    },

    setPresence(key, value) {
      const s = steam();
      return s && s.setPresence ? s.setPresence(key, value) : false;
    },

    /** First time the garden is playable (splash down / interactive). */
    notifyPlayReady() {
      if (api._firstLaunchHandled) return false;
      if (!api.isAvailable()) return false;
      api._firstLaunchHandled = true;
      api.unlockAchievement(ACH_FIRST_LAUNCH);
      api.setPresence('status', 'In Garden');
      return true;
    },

    /** First time the player creates a KOTH lobby (not join / claim / 1v1). */
    notifyKothLobbyCreated() {
      if (api._firstMatchHandled) return false;
      if (!api.isAvailable()) return false;
      api._firstMatchHandled = true;
      api.unlockAchievement(ACH_FIRST_MATCH);
      api.setPresence('status', 'Hosting KOTH');
      return true;
    },

    /** First agora-capture loss (Defeat — Player N captured the agora). */
    notifyKothDefeat(session) {
      if (api._kothDefeatHandled) return false;
      if (!isKothAgoraDefeat(session)) return false;
      if (!api.isAvailable()) return false;
      api._kothDefeatHandled = true;
      api.unlockAchievement(ACH_KOTH_DEFEAT);
      api.setPresence('status', 'Defeated');
      return true;
    },

    /** DevTools smoke test — API name must exist on the Steamworks partner site. */
    test(achievementId) {
      const id = achievementId || ACH_FIRST_LAUNCH;
      const info = api.getInfo();
      if (!info.available) {
        console.warn('[aetherSteam] not available', info);
        return info;
      }
      const unlocked = api.unlockAchievement(id);
      api.setPresence('status', 'Testing Steam');
      const result = { achievementId: id, unlocked, info };
      console.log('[aetherSteam] test', result);
      return result;
    },
  };

  return api;
}

export const aetherSteam = createAetherSteam();

if (typeof window !== 'undefined') window.aetherSteam = aetherSteam;
