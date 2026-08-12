'use strict';

const steamClient = require('./steam-client');

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
      steamClient.openOverlay(String(dialog || '')).catch(function () {});
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
