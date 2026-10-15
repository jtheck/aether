'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const steam = require('./steam');

module.exports.steamBridge = steam.createBridgeApi();

const DEFAULT_URL = 'https://aether.garden';
const WINDOW_TITLE = 'Æther.Garden';
const URL_FILE = 'aether.url';
const ALLOWED_ORIGINS = new Set([
  'https://aether.garden',
  'https://www.aether.garden',
]);

function isLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function readUrlFile() {
  const dirs = [];
  try { dirs.push(path.dirname(process.execPath)); } catch (_err) { /* ignore */ }
  try { dirs.push(process.cwd()); } catch (_err2) { /* ignore */ }
  for (let i = 0; i < dirs.length; i++) {
    const file = path.join(dirs[i], URL_FILE);
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (raw) return raw;
    } catch (_read) { /* missing */ }
  }
  return '';
}

function resolveStartUrl() {
  const override = process.env.AETHER_URL || readUrlFile();
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

function isWindowFullscreen(win) {
  return !!(win && (win.isFullscreen || win.fullscreen));
}

function leaveFullscreen() {
  const win = activeWindow();
  if (!win || !isWindowFullscreen(win)) return false;
  try {
    win.leaveFullscreen();
    return true;
  } catch (err) {
    console.warn('[steam-build] Leave fullscreen failed:', err.message);
    return false;
  }
}

function enterFullscreen() {
  const win = activeWindow();
  if (!win) return false;
  if (isWindowFullscreen(win)) return true;
  try {
    win.enterFullscreen();
    return true;
  } catch (err) {
    console.warn('[steam-build] Enter fullscreen failed:', err.message);
    return false;
  }
}

function toggleFullscreen() {
  const win = activeWindow();
  if (!win) return false;
  try {
    if (isWindowFullscreen(win)) win.leaveFullscreen();
    else win.enterFullscreen();
    return true;
  } catch (err) {
    console.warn('[steam-build] Fullscreen toggle failed:', err.message);
    return false;
  }
}

function reloadWindow(hard) {
  const win = activeWindow();
  if (!win) return false;
  try {
    win.reload(!!hard);
    return true;
  } catch (err) {
    console.warn('[steam-build] Reload failed:', err.message);
    return false;
  }
}

function lockTitle(win) {
  if (!win) return;
  try {
    if (win.title !== WINDOW_TITLE) win.title = WINDOW_TITLE;
  } catch (_err) { /* window tearing down */ }
}

function teardownAndQuit() {
  if (teardownAndQuit._done) return;
  teardownAndQuit._done = true;
  try { require('./steam-client').shutdown(); } catch (_e) { /* ignore */ }
  try { require('./bridge-server').stop(); } catch (_e2) { /* ignore */ }
  try { nw.App.quit(); } catch (_e3) { /* ignore */ }
}

function currentHref(win) {
  try {
    return win.window && win.window.location ? String(win.window.location.href || '') : '';
  } catch (_err) {
    return '';
  }
}

function urlsMatch(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const pathA = ua.pathname.replace(/\/+$/, '');
    const pathB = ub.pathname.replace(/\/+$/, '');
    return ua.origin === ub.origin && pathA === pathB;
  } catch (_err) {
    return a === b;
  }
}

function applyStartUrl(win) {
  const startUrl = resolveStartUrl();
  if (!startUrl) return;
  const current = currentHref(win);
  if (current && urlsMatch(current, startUrl)) return;
  if (win._aetherNavigatedTo === startUrl) return;
  try {
    if (typeof win.navigate === 'function') {
      win._aetherNavigatedTo = startUrl;
      win.navigate(startUrl);
      return;
    }
  } catch (_nav) {
    win._aetherNavigatedTo = '';
  }
  try {
    if (win.window && win.window.location) {
      win._aetherNavigatedTo = startUrl;
      win.window.location.href = startUrl;
    }
  } catch (_loc) {
    win._aetherNavigatedTo = '';
  }
}

function wireWindow(win) {
  if (!win || win._aetherWired) return;
  win._aetherWired = true;

  applyStartUrl(win);

  lockTitle(win);
  win.on('loaded', function () {
    applyStartUrl(win);
    lockTitle(win);
  });
  if (!win._aetherTitleTimer) {
    win._aetherTitleTimer = setInterval(function () { lockTitle(win); }, 1000);
  }

  win.on('close', function () {
    if (win._aetherTitleTimer) {
      clearInterval(win._aetherTitleTimer);
      win._aetherTitleTimer = null;
    }
    teardownAndQuit();
    try { this.close(true); } catch (_close) { /* already closing */ }
  });
  win.on('closed', teardownAndQuit);

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
    require('./bridge-server').start({
      onDevToolsToggle: toggleDevTools,
      onLeaveFullscreen: leaveFullscreen,
      onEnterFullscreen: enterFullscreen,
      onToggleFullscreen: toggleFullscreen,
      onReload: reloadWindow,
    });
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
    wireWindow(nw.Window.get());
  } catch (_err) { /* window not ready */ }
  ensureSteamDeferred();
}

nw.App.on('open', attachToCurrentWindow);
nw.App.on('reopen', attachToCurrentWindow);

nw.App.on('quit', function () {
  teardownAndQuit();
});

setTimeout(attachToCurrentWindow, 0);
setTimeout(attachToCurrentWindow, 250);
setTimeout(attachToCurrentWindow, 1000);
setTimeout(attachToCurrentWindow, 3000);
