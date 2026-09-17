'use strict';

const steamClient = require('./steam-client');
const workshopMaps = require('./workshopMaps');
const DEFAULT_APP_ID = 5043860;

function openWorkshopExternal(dialog) {
  var appId = (lastInfo && lastInfo.appId) || DEFAULT_APP_ID;
  var url = workshopMaps.workshopOverlayUrl(dialog, appId);
  if (!url) return false;
  try {
    if (typeof nw !== 'undefined' && nw.Shell && typeof nw.Shell.openExternal === 'function') {
      nw.Shell.openExternal(url);
      return true;
    }
  } catch (_err) { /* inject / isolated context */ }
  return false;
}

let workerReady = false;
let lastInfo = { available: false, error: null };
let bootstrapStarted = false;

function shouldEnableSteam() {
  if (process.env.AETHER_STEAM === '0') return false;
  return true;
}

function bootstrap() {
  if (!shouldEnableSteam()) {
    return { available: false, error: null };
  }
  if (bootstrapStarted) {
    return { available: workerReady, error: lastInfo.error || null };
  }
  bootstrapStarted = true;

  steamClient.ensureWorkerProcess()
    .then(function (started) {
      if (!started) {
        lastInfo = { available: false, error: 'Could not start Steam worker (missing node-steam?)' };
        return lastInfo;
      }
      return steamClient.getInfo();
    })
    .then(function (info) {
      lastInfo = info || { available: false };
      workerReady = !!lastInfo.available;
      if (workerReady) {
        console.log('[steam-build] Steam worker ready');
      } else if (lastInfo.error) {
        console.warn('[steam-build] Steam worker unavailable:', lastInfo.error);
      }
    })
    .catch(function (err) {
      lastInfo = { available: false, error: err.message };
      workerReady = false;
      console.warn('[steam-build] Steam bootstrap failed:', err.message);
    });

  var polls = 0;
  var pollTimer = setInterval(function () {
    if (workerReady || polls++ > 30) {
      clearInterval(pollTimer);
      return;
    }
    steamClient.getInfo().then(function (info) {
      lastInfo = info || lastInfo;
      if (info && info.available) {
        workerReady = true;
        clearInterval(pollTimer);
        console.log('[steam-build] Steam worker ready');
      }
    }).catch(function () {});
  }, 500);

  return { available: false, error: null };
}

function createBridgeApi() {
  return {
    isAvailable: function () {
      return workerReady;
    },

    getInfo: function () {
      if (!shouldEnableSteam()) {
        return { available: false, error: lastInfo.error || null };
      }
      return lastInfo;
    },

    unlockAchievement: function (name) {
      if (!shouldEnableSteam()) return false;
      steamClient.unlockAchievement(String(name)).catch(function (err) {
        console.warn('[steam-build] unlockAchievement:', err.message);
      });
      return true;
    },

    isAchievementUnlocked: function (name) {
      if (!workerReady) return false;
      steamClient.isAchievementUnlocked(String(name)).catch(function () {});
      return false;
    },

    clearAchievement: function () {
      return false;
    },

    listAchievements: function () {
      return [];
    },

    setPresence: function (key, value) {
      if (!shouldEnableSteam()) return false;
      steamClient.setPresence(String(key), value).catch(function () {});
      return true;
    },

    clearPresence: function () {
      return createBridgeApi().setPresence('status', '');
    },

    openOverlay: function (dialog) {
      if (!shouldEnableSteam()) return false;
      var raw = String(dialog || '');
      // Overlay is bound to the main game HWND. Forge is a second window, so the
      // overlay lands offset, covers the board, and eats clicks. Workshop pages
      // go to the OS browser instead.
      if (workshopMaps.workshopOverlayUrl(raw, (lastInfo && lastInfo.appId) || DEFAULT_APP_ID)) {
        return openWorkshopExternal(raw);
      }
      steamClient.openOverlay(raw).catch(function () {});
      return true;
    },

    listWorkshopMaps: function () {
      if (!shouldEnableSteam()) return Promise.resolve([]);
      return steamClient.listWorkshopMaps().then(function (data) {
        return (data && data.items) || [];
      }).catch(function () { return []; });
    },

    loadWorkshopGarden: function (id, file) {
      if (!shouldEnableSteam()) return Promise.resolve(null);
      return steamClient.loadWorkshopGarden(id, file).then(function (data) {
        return data && data.ok ? data.garden : null;
      }).catch(function () { return null; });
    },

    publishWorkshopGarden: function (body) {
      if (!shouldEnableSteam()) {
        return Promise.resolve({ ok: false, error: 'workshop unavailable' });
      }
      return steamClient.publishWorkshopGarden(body || {}).then(function (result) {
        return result && typeof result === 'object' ? result : { ok: false, error: 'publish failed' };
      }).catch(function (err) {
        return { ok: false, error: err && err.message ? err.message : 'publish failed' };
      });
    },

    downloadWorkshopItem: function (id, highPriority) {
      if (!shouldEnableSteam()) return false;
      steamClient.downloadWorkshopItem(id, highPriority).catch(function () {});
      return true;
    },
  };
}

module.exports = {
  bootstrap,
  createBridgeApi,
  shouldEnableSteam,
  isAvailable: function () {
    return workerReady;
  },
};
