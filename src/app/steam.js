// Desktop Steam API (NW.js shell only). No-ops in the browser.
// Requires aetherDesktop.steam from steam-build bridge.js.

import { packsOwnedFromSteamDlc } from './dlcCatalog.js';
import { isAlly } from '../sim/teams.js';

export const ACH_FIRST_LAUNCH = 'ACH_FIRST_LAUNCH';
export const ACH_FIRST_MATCH = 'ACH_FIRST_MATCH';
export const ACH_KOTH_DEFEAT = 'ACH_KOTH_DEFEAT';
export const ACH_LINUX_LAUNCH = 'ACH_LINUX_LAUNCH';
export const ACH_FORGE_OPEN = 'ACH_FORGE_OPEN';

export const OVERLAY_POLL_MS = 50;

/** Chromium eats Shift+Tab — the page must open Friends itself. */
export function isSteamOverlayHotkey(e) {
  if (!e) return false;
  if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  return e.key === 'Tab' || e.code === 'Tab';
}

/**
 * Open Friends on Shift+Tab and park getGamepads while the overlay is up.
 * Chromium's pad poll steals XInput and freezes the overlay.
 */
export function createSteamOverlayGuard(opts = {}) {
  const steam = opts.steam ?? aetherSteam;
  const root = opts.root ?? (typeof globalThis !== 'undefined' ? globalThis : {});
  const win = opts.window ?? root.window ?? (typeof window !== 'undefined' ? window : null);
  const startInterval = opts.interval ?? ((fn, ms) => (
    typeof setInterval === 'function' ? setInterval(fn, ms) : 0
  ));
  const stopInterval = opts.clearInterval ?? ((id) => {
    if (typeof clearInterval === 'function') clearInterval(id);
  });
  const pollMs = opts.pollMs ?? OVERLAY_POLL_MS;

  let remote = false;
  let latched = false;
  let sawRemoteOn = false;
  let timer = 0;

  function isActive() {
    return remote || latched;
  }

  function setRemote(on) {
    const next = !!on;
    if (next) {
      sawRemoteOn = true;
      latched = false;
    } else if (sawRemoteOn) {
      latched = false;
    }
    remote = next;
    return remote;
  }

  function pollRemote() {
    if (!steam || typeof steam.overlayActive !== 'function') return;
    try {
      const value = steam.overlayActive();
      if (value && typeof value.then === 'function') {
        value.then((on) => { setRemote(!!on); }).catch(() => {});
        return;
      }
      setRemote(!!value);
    } catch (_err) { /* bridge not up */ }
  }

  function onPointerDown() {
    if (remote || !latched) return;
    latched = false;
  }

  function onKeyDown(e) {
    if (!isSteamOverlayHotkey(e)) return;
    if (!(root.aetherDesktop || steam?.isAvailable?.())) return;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    latched = true;
    steam?.openOverlay?.('Friends');
  }

  if (root.aetherDesktop) {
    pollRemote();
    timer = startInterval(pollRemote, pollMs);
  }
  win?.addEventListener?.('keydown', onKeyDown, true);
  win?.addEventListener?.('pointerdown', onPointerDown, true);

  return {
    isActive,
    setRemote,
    dispose() {
      if (timer) stopInterval(timer);
      timer = 0;
      win?.removeEventListener?.('keydown', onKeyDown, true);
      win?.removeEventListener?.('pointerdown', onPointerDown, true);
    },
  };
}

/** Native Linux desktop shell (Steam worker) or a browser-like Linux UA. */
export function isLinuxRuntime(info, root) {
  if (info && info.platform === 'linux') return true;
  const nav = root && root.navigator;
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  if (/android/i.test(ua)) return false;
  if (!/mozilla|chrome|chromium|nwjs/i.test(ua)) return false;
  const platform = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
  return /linux/i.test(platform) || /linux/i.test(ua);
}

function sessionHasCapturedAgora(session) {
  const list = session?.agoras;
  if (!list?.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].captured) return true;
  }
  return false;
}

/** Agora occupy loss — not a score wipe, not a spectator. */
export function isKothAgoraDefeat(session) {
  if (!session) return false;
  if ((session.role ?? 'player') !== 'player') return false;
  const winner = session.matchWinner;
  if (winner == null || winner < 0) return false;
  if (isAlly(winner, session.localPlayerId ?? 0)) return false;
  return sessionHasCapturedAgora(session);
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
    ACH_LINUX_LAUNCH,
    ACH_FORGE_OPEN,
    _firstLaunchHandled: false,
    _firstMatchHandled: false,
    _kothDefeatHandled: false,
    _forgeOpenedHandled: false,

    isAvailable() {
      const s = steam();
      return !!(s && s.isAvailable && s.isAvailable());
    },

    getInfo() {
      const s = steam();
      return s && s.getInfo ? s.getInfo() : { available: false };
    },

    /** Catalog pack ids owned on this Steam account. Empty in the browser. */
    ownedPacks() {
      const info = api.getInfo();
      return packsOwnedFromSteamDlc(info?.dlc);
    },

    ownsPack(id) {
      return api.ownedPacks().includes(id);
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

    /** Subscribed Workshop maps (Steam shell). Empty in the browser. */
    listWorkshopMaps() {
      const s = steam();
      if (!s || !s.listWorkshopMaps) return Promise.resolve([]);
      return Promise.resolve(s.listWorkshopMaps()).then((items) => (
        Array.isArray(items) ? items : []
      )).catch(() => []);
    },

    /** Installed .garden JSON for a subscribed item. Null in the browser. */
    loadWorkshopGarden(id, file) {
      const s = steam();
      if (!s || !s.loadWorkshopGarden) return Promise.resolve(null);
      return Promise.resolve(s.loadWorkshopGarden(id, file)).then((garden) => (
        garden && typeof garden === 'object' ? garden : null
      )).catch(() => null);
    },

    downloadWorkshopItem(id, highPriority) {
      const s = steam();
      return s && s.downloadWorkshopItem ? s.downloadWorkshopItem(id, highPriority) : false;
    },

    /** Create a Workshop item from garden JSON. Null / failed in the browser. */
    publishWorkshopGarden(body) {
      const s = steam();
      if (!s || !s.publishWorkshopGarden) {
        return Promise.resolve({ ok: false, error: 'workshop unavailable' });
      }
      return Promise.resolve(s.publishWorkshopGarden(body || {})).then((result) => (
        result && typeof result === 'object' ? result : { ok: false, error: 'publish failed' }
      )).catch((err) => ({ ok: false, error: err?.message || 'publish failed' }));
    },

    openOverlay(dialog) {
      const s = steam();
      return s && s.openOverlay ? s.openOverlay(dialog) : false;
    },

    /** Steam overlay is up — Chromium must stop polling the pad. */
    overlayActive() {
      const s = steam();
      return !!(s && s.overlayActive && s.overlayActive());
    },

    /** Steam Deck / Big Picture overlay keyboard. No-ops in the browser. */
    showGamepadTextInput(body) {
      const s = steam();
      if (!s || !s.showGamepadTextInput) {
        return Promise.resolve({ ok: false, submitted: false, text: '' });
      }
      return Promise.resolve(s.showGamepadTextInput(body || {})).then((result) => (
        result && typeof result === 'object'
          ? result
          : { ok: false, submitted: false, text: '' }
      )).catch(() => ({ ok: false, submitted: false, text: '' }));
    },

    /** First time the garden is playable (splash down / interactive). */
    notifyPlayReady() {
      if (api._firstLaunchHandled) return false;
      if (!api.isAvailable()) return false;
      api._firstLaunchHandled = true;
      api.unlockAchievement(ACH_FIRST_LAUNCH);
      if (isLinuxRuntime(api.getInfo(), root)) api.unlockAchievement(ACH_LINUX_LAUNCH);
      api.setPresence('status', 'gardening');
      return true;
    },

    /** First time the player creates a KOTH lobby (not join / claim / 1v1). */
    notifyKothLobbyCreated() {
      if (api._firstMatchHandled) return false;
      if (!api.isAvailable()) return false;
      api._firstMatchHandled = true;
      api.unlockAchievement(ACH_FIRST_MATCH);
      api.setPresence('status', 'hosting garden');
      return true;
    },

    /** First time the Forge Field Editor is opened (settings link or /forge). */
    notifyForgeOpened() {
      if (api._forgeOpenedHandled) return false;
      if (!api.isAvailable()) return false;
      api._forgeOpenedHandled = true;
      api.unlockAchievement(ACH_FORGE_OPEN);
      api.setPresence('status', 'forging garden');
      return true;
    },

    /** First agora-capture loss (Defeat — Player N captured the agora). */
    notifyKothDefeat(session) {
      if (api._kothDefeatHandled) return false;
      if (!isKothAgoraDefeat(session)) return false;
      if (!api.isAvailable()) return false;
      api._kothDefeatHandled = true;
      api.unlockAchievement(ACH_KOTH_DEFEAT);
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
      const result = { achievementId: id, unlocked, info };
      console.log('[aetherSteam] test', result);
      return result;
    },
  };

  return api;
}

export const aetherSteam = createAetherSteam();

if (typeof window !== 'undefined') window.aetherSteam = aetherSteam;
