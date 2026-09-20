(function () {
  'use strict';
  if (window.aetherDesktop) return;

  var BRIDGE = 'http://127.0.0.1:9787';
  var steamCache = { available: false };
  var STEAM_APP_ID = 5043860;

  function workshopPageUrl(dialog, appId) {
    var raw = String(dialog || '').trim();
    var id = (appId | 0) || STEAM_APP_ID;
    if (raw.toLowerCase() === 'workshop') {
      return id > 0 ? 'https://steamcommunity.com/app/' + id + '/workshop/' : '';
    }
    if (raw.toLowerCase() === 'workshop-legal') {
      return 'https://steamcommunity.com/sharedfiles/workshoplegalagreement';
    }
    var m = /^workshop:(\d{1,20})$/i.exec(raw);
    return m ? 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + m[1] : '';
  }

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
        var url = workshopPageUrl(dialog, steamCache.appId);
        if (url) {
          try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_err) { /* ignore */ }
          return true;
        }
        postJson('/steam/overlay', { dialog: dialog });
        return true;
      },
      listWorkshopMaps: function () {
        return fetch(BRIDGE + '/steam/workshop/subscribed', { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (data) { return (data && data.items) || []; })
          .catch(function () { return []; });
      },
      loadWorkshopGarden: function (id, file) {
        return postJson('/steam/workshop/garden', { id: String(id || ''), file: file || '' })
          .then(function (data) {
            return data && data.ok ? data.garden : null;
          });
      },
      publishWorkshopGarden: function (body) {
        return postJson('/steam/workshop/publish', body || {});
      },
      downloadWorkshopItem: function (id, highPriority) {
        postJson('/steam/workshop/download', { id: String(id || ''), highPriority: !!highPriority });
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
    if (e.key === 'F12') {
      e.preventDefault();
      e.stopImmediatePropagation();
      postJson('/devtools/toggle', {});
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      e.stopImmediatePropagation();
      postJson('/window/toggle-fullscreen', {});
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      e.stopImmediatePropagation();
      postJson('/window/reload', {});
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      postJson('/window/reload', { hard: e.shiftKey });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      postJson('/devtools/toggle', {});
    }
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

    isFullscreen: function () {
      try {
        var win = typeof nw !== 'undefined' && nw.Window ? nw.Window.get() : null;
        return !!(win && (win.isFullscreen || win.fullscreen));
      } catch (_err) {
        return false;
      }
    },

    leaveFullscreen: function () {
      try {
        var win = typeof nw !== 'undefined' && nw.Window ? nw.Window.get() : null;
        if (win && (win.isFullscreen || win.fullscreen)) {
          win.leaveFullscreen();
          return Promise.resolve(true);
        }
      } catch (_err) { /* isolated page — fall through to the HTTP bridge */ }
      return postJson('/window/leave-fullscreen', {}).then(function (data) {
        return !!(data && data.ok);
      });
    },

    enterFullscreen: function () {
      try {
        var win = typeof nw !== 'undefined' && nw.Window ? nw.Window.get() : null;
        if (win) {
          if (!(win.isFullscreen || win.fullscreen)) win.enterFullscreen();
          return Promise.resolve(true);
        }
      } catch (_err) { /* isolated page — fall through to the HTTP bridge */ }
      return postJson('/window/enter-fullscreen', {}).then(function (data) {
        return !!(data && data.ok);
      });
    },
  };
})();
