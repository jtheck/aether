(function () {
  'use strict';
  if (window.aetherDesktop) return;

  var BRIDGE = 'http://127.0.0.1:9787';
  var steamCache = { available: false };

  function resolveNodeBridge() {
    try {
      if (typeof process !== 'undefined' && process.mainModule && process.mainModule.exports) {
        var bridge = process.mainModule.exports.steamBridge;
        if (bridge) return bridge;
      }
    } catch (_err) { /* isolated page — no Node */ }
    return null;
  }

  function postJson(path, body) {
    return fetch(BRIDGE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  function httpSteamBridge() {
    return {
      isAvailable: function () {
        return !!steamCache.available;
      },
      getInfo: function () {
        return steamCache;
      },
      unlockAchievement: function (name) {
        postJson('/steam/unlock', { name: name });
        return true;
      },
      isAchievementUnlocked: function (name) {
        postJson('/steam/is-unlocked', { name: name }).then(function (data) {
          if (data && data.unlocked) steamCache._unlocked = steamCache._unlocked || {};
          if (data && data.unlocked) steamCache._unlocked[name] = true;
        });
        return !!(steamCache._unlocked && steamCache._unlocked[name]);
      },
      clearAchievement: function () { return false; },
      listAchievements: function () { return []; },
      setPresence: function (key, value) {
        postJson('/steam/presence', { key: key, value: value });
        return true;
      },
      clearPresence: function () {
        return httpSteamBridge().setPresence('status', '');
      },
      openOverlay: function (dialog) {
        postJson('/steam/overlay', { dialog: dialog });
        return true;
      },
    };
  }

  var steamPollTimer = null;

  function pollSteamInfo() {
    fetch(BRIDGE + '/steam/info', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (info) {
        if (info && typeof info === 'object') steamCache = info;
        if (steamCache.available && steamPollTimer) {
          clearInterval(steamPollTimer);
          steamPollTimer = null;
        }
      })
      .catch(function () { /* bridge server not up yet */ });
  }

  var nodeBridge = resolveNodeBridge();
  var steamApi = nodeBridge || httpSteamBridge();

  if (!nodeBridge) {
    pollSteamInfo();
    steamPollTimer = setInterval(pollSteamInfo, 1000);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'F12') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    postJson('/devtools/toggle', {});
  }, true);

  function lockDocumentTitle() {
    try {
      if (document.title !== 'Æther.Garden') document.title = 'Æther.Garden';
    } catch (_err) { /* ignore */ }
  }
  lockDocumentTitle();
  document.addEventListener('DOMContentLoaded', lockDocumentTitle);
  setInterval(lockDocumentTitle, 1000);

  window.aetherDesktop = {
    isDesktop: true,
    runtime: 'nwjs',
    steam: steamApi,

    getInfo: function () {
      if (!nodeBridge) pollSteamInfo();
      var steamInfo = window.aetherDesktop.steam.getInfo();
      return Promise.resolve({
        isDesktop: true,
        runtime: 'nwjs',
        platform: typeof process !== 'undefined' && process.platform ? process.platform : navigator.platform,
        startUrl: window.location.origin,
        steam: steamInfo,
      });
    },

    quit: function () {
      try {
        if (typeof nw !== 'undefined' && nw.App) nw.App.quit();
      } catch (_err) { /* ignore */ }
    },
  };
})();
