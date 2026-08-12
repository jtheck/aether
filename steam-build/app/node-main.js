'use strict';

const http = require('http');
const steam = require('./steam');

module.exports.steamBridge = steam.createBridgeApi();

const DEFAULT_URL = 'https://aether.garden';
const WINDOW_TITLE = 'Æther.Garden';
const ALLOWED_ORIGINS = new Set([
  'https://aether.garden',
  'https://www.aether.garden',
]);

const registeredShortcuts = [];

function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function resolveStartUrl() {
  const override = process.env.AETHER_URL;
  if (!override) return DEFAULT_URL;
  try {
    const parsed = new URL(override);
    if (!ALLOWED_ORIGINS.has(parsed.origin) && !isLocalDevOrigin(parsed.origin)) {
      console.warn('[steam-build] AETHER_URL origin not allowlisted:', parsed.origin);
      return DEFAULT_URL;
    }
    return parsed.href;
  } catch (err) {
    console.warn('[steam-build] Invalid AETHER_URL:', err.message);
    return DEFAULT_URL;
  }
}

function isAllowedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'about:') return true;
    if (ALLOWED_ORIGINS.has(parsed.origin)) return true;
    return isLocalDevOrigin(parsed.origin);
  } catch (_err) {
    return false;
  }
}

function activeWindow() {
  try {
    return nw.Window.get();
  } catch (_err) {
    return null;
  }
}

function openRemoteDevTools() {
  http.get('http://127.0.0.1:9222/json/list', function (res) {
    var body = '';
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () {
      try {
        var targets = JSON.parse(body);
        var page = null;
        for (var i = 0; i < targets.length; i++) {
          var t = targets[i];
          if (t.type === 'page' && t.devtoolsFrontendUrl) {
            page = t;
            break;
          }
        }
        if (page && page.devtoolsFrontendUrl) {
          nw.Shell.openExternal(page.devtoolsFrontendUrl);
          return;
        }
      } catch (_err) { /* fall through */ }
      nw.Shell.openExternal('http://127.0.0.1:9222');
    });
  }).on('error', function () {
    console.warn('[steam-build] Remote debug unavailable — restart with npm start (SDK flavor)');
  });
}

function toggleDevTools() {
  const win = activeWindow();
  if (!win) return;
  try {
    if (typeof win.isDevToolsOpen === 'function' && win.isDevToolsOpen()) {
      win.closeDevTools();
      return;
    }
    win.showDevTools();
    if (typeof win.isDevToolsOpen === 'function' && !win.isDevToolsOpen()) {
      openRemoteDevTools();
    }
  } catch (_err) {
    openRemoteDevTools();
  }
}

function toggleFullscreen() {
  const win = activeWindow();
  if (!win) return;
  try {
    var fs = win.isFullscreen || win.fullscreen;
    if (fs) win.leaveFullscreen();
    else win.enterFullscreen();
  } catch (err) {
    console.warn('[steam-build] Fullscreen toggle failed:', err.message);
  }
}

function registerGlobalShortcut(key, handler) {
  const shortcut = new nw.Shortcut({
    key: key,
    active: handler,
    failed: function () {
      console.warn('[steam-build] Failed to register shortcut:', key);
    },
  });
  nw.App.registerGlobalHotKey(shortcut);
  registeredShortcuts.push(shortcut);
}

function registerGlobalShortcuts() {
  if (registeredShortcuts.length) return;

  registerGlobalShortcut('F5', function () {
    const win = activeWindow();
    if (win) win.reload();
  });

  registerGlobalShortcut('Ctrl+R', function () {
    const win = activeWindow();
    if (win) win.reload();
  });

  registerGlobalShortcut('Ctrl+Shift+R', function () {
    const win = activeWindow();
    if (win) win.reload(true);
  });

  registerGlobalShortcut('F11', toggleFullscreen);
  registerGlobalShortcut('Ctrl+Shift+I', toggleDevTools);
}

function lockTitle(win) {
  if (!win) return;
  try {
    if (win.title !== WINDOW_TITLE) win.title = WINDOW_TITLE;
  } catch (_err) { /* window tearing down */ }
}

function wireWindow(win) {
  if (!win || win._aetherWired) return;
  win._aetherWired = true;

  const startUrl = resolveStartUrl();
  if (win.window && win.window.location && win.window.location.href !== startUrl) {
    try {
      win.navigate(startUrl);
    } catch (_nav) { /* first load may already match package.json main */ }
  }

  lockTitle(win);
  win.on('loaded', function () { lockTitle(win); });
  if (!win._aetherTitleTimer) {
    win._aetherTitleTimer = setInterval(function () { lockTitle(win); }, 1000);
  }

  win.on('new-win-policy', function (_frame, url, policy) {
    if (isAllowedUrl(url)) {
      policy.setNewWindow(false);
      return;
    }
    policy.ignore();
    nw.Shell.openExternal(url);
  });

  win.on('navigation', function (_frame, url, policy) {
    if (!isAllowedUrl(url)) policy.ignore();
  });
}

function ensureSteam() {
  if (steam._bootstrapped) return;
  steam._bootstrapped = true;
  if (!steam.shouldEnableSteam || !steam.shouldEnableSteam()) return;
  try {
    steam.bootstrap();
    module.exports.steamBridge = steam.createBridgeApi();
  } catch (err) {
    console.warn('[steam-build] Steam bootstrap failed:', err.message);
  }
}

function ensureBridgeServer() {
  try {
    require('./bridge-server').start({ onDevToolsToggle: toggleDevTools });
  } catch (err) {
    console.warn('[steam-build] Bridge server failed:', err.message);
  }
}

function ensureSteamDeferred() {
  if (steam._deferScheduled) return;
  steam._deferScheduled = true;
  setTimeout(function () {
    try {
      require('./steam-client').setOnSteamRestartRequired(function () {
        console.log('[steam-build] Steam requested relaunch — quitting so Steam can restart the app');
        nw.App.quit();
      });
      ensureSteam();
    } catch (err) {
      console.warn('[steam-build] Steam deferred start failed:', err.message);
    }
  }, 2000);
}

function attachToCurrentWindow() {
  ensureBridgeServer();
  try {
    registerGlobalShortcuts();
  } catch (_err) { /* NW not ready */ }
  try {
    wireWindow(nw.Window.get());
  } catch (_err) { /* window not ready */ }
  ensureSteamDeferred();
}

nw.App.on('open', attachToCurrentWindow);
nw.App.on('reopen', attachToCurrentWindow);

nw.App.on('quit', function () {
  try { require('./steam-client').shutdown(); } catch (_e) { /* ignore */ }
  try { require('./bridge-server').stop(); } catch (_e) { /* ignore */ }
});

setTimeout(attachToCurrentWindow, 0);
setTimeout(attachToCurrentWindow, 250);
setTimeout(attachToCurrentWindow, 1000);
setTimeout(attachToCurrentWindow, 3000);
