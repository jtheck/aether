'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.AETHER_STEAM_PORT || '9786', 10);
const HOST = '127.0.0.1';

let sdk = null;
let available = false;
let initError = null;
let callbacksInterval = null;

function readAppId() {
  const fromEnv = process.env.AETHER_STEAM_APP_ID;
  if (fromEnv) {
    const id = parseInt(fromEnv, 10);
    if (Number.isFinite(id)) return id;
  }
  const filePath = path.join(__dirname, 'steam_appid.txt');
  if (fs.existsSync(filePath)) {
    const id = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    if (Number.isFinite(id)) return id;
  }
  return null;
}

function sdkRootPath() {
  return path.join(__dirname, 'steamworks_sdk');
}

function startCallbacks() {
  if (callbacksInterval || !sdk) return;
  callbacksInterval = setInterval(function () {
    try {
      if (sdk && sdk.isInitialized && sdk.isInitialized()) sdk.runCallbacks();
    } catch (_err) { /* ignore */ }
  }, 1000 / 30);
}

function initSteam() {
  if (available) return true;
  if (initError) return false;

  let SteamworksSDK;
  try {
    SteamworksSDK = require('steamworks-ffi-node').default;
  } catch (err) {
    initError = err;
    console.error('[steam-worker] load failed:', err.message);
    return false;
  }

  const appId = readAppId();
  if (appId == null) {
    initError = new Error('No App ID');
    return false;
  }

  try {
    sdk = SteamworksSDK.getInstance();
    sdk.setSdkPath(sdkRootPath());

    if (
      process.env.AETHER_STEAM_SKIP_RESTART !== '1' &&
      sdk.restartAppIfNecessary(appId)
    ) {
      process.exit(42);
    }

    if (!sdk.init({ appId: appId })) {
      throw new Error('Steam API init returned false');
    }

    available = true;
    startCallbacks();
    console.log('[steam-worker] ready appId', appId);
    return true;
  } catch (err) {
    initError = err;
    sdk = null;
    available = false;
    console.error('[steam-worker] init failed:', err.message);
    return false;
  }
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      try {
        var raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, data) {
  var body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    if (!available && !initError) initSteam();
    return sendJson(res, 200, {
      ok: true,
      available: available,
      error: initError ? initError.message : null,
    });
  }

  if (req.method === 'GET' && req.url === '/info') {
    if (!available && !initSteam()) {
      return sendJson(res, 200, { available: false, error: initError ? initError.message : null });
    }
    try {
      return sendJson(res, 200, {
        available: true,
        appId: readAppId(),
        name: sdk.friends.getPersonaName(),
      });
    } catch (err) {
      return sendJson(res, 200, { available: false, error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/unlock') {
    if (!available && !initSteam()) return sendJson(res, 200, { ok: false });
    try {
      var body = await readBody(req);
      var ok = await sdk.achievements.unlockAchievement(String(body.name || ''));
      return sendJson(res, 200, { ok: !!ok });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/is-unlocked') {
    if (!available && !initSteam()) return sendJson(res, 200, { unlocked: false });
    try {
      var body2 = await readBody(req);
      var unlocked = await sdk.achievements.isAchievementUnlocked(String(body2.name || ''));
      return sendJson(res, 200, { unlocked: !!unlocked });
    } catch (err) {
      return sendJson(res, 200, { unlocked: false, error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/presence') {
    if (!available && !initSteam()) return sendJson(res, 200, { ok: false });
    try {
      var body3 = await readBody(req);
      sdk.richPresence.setRichPresence(String(body3.key || 'status'), body3.value == null ? '' : String(body3.value));
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/overlay') {
    if (!available && !initSteam()) return sendJson(res, 200, { ok: false });
    var map = {
      friends: 'Friends', community: 'Community', players: 'Players',
      settings: 'Settings', stats: 'Stats', achievements: 'Achievements',
    };
    try {
      var body4 = await readBody(req);
      var panel = map[String(body4.dialog || '').toLowerCase()];
      if (!panel) return sendJson(res, 200, { ok: false });
      sdk.overlay.activateGameOverlay(panel);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 200, { ok: false, error: err.message });
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(function (req, res) {
  handle(req, res).catch(function (err) {
    sendJson(res, 500, { error: err.message });
  });
});

server.listen(PORT, HOST, function () {
  console.log('[steam-worker] listening on http://' + HOST + ':' + PORT);
  initSteam();
});

process.on('SIGINT', function () { process.exit(0); });
process.on('SIGTERM', function () { process.exit(0); });
