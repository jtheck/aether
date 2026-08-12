'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.AETHER_STEAM_PORT || '9786', 10);
const HOST = '127.0.0.1';

let worker = null;
let workerStarting = false;
let onSteamRestartRequired = null;

function nodeSteamPath() {
  var bin = process.platform === 'win32' ? 'node.exe' : 'node';
  return path.join(__dirname, 'node-steam', bin);
}

function workerScriptPath() {
  return path.join(__dirname, 'steam-worker.js');
}

function httpJson(method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var payload = body ? JSON.stringify(body) : null;
    var req = http.request({
      host: HOST,
      port: PORT,
      path: urlPath,
      method: method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pingHealth() {
  return httpJson('GET', '/health').catch(function () {
    return { ok: false, available: false };
  });
}

function ensureWorkerProcess() {
  if (worker && !worker.killed) return Promise.resolve(true);
  if (workerStarting) {
    return new Promise(function (resolve) {
      var t = setInterval(function () {
        if (!workerStarting) {
          clearInterval(t);
          resolve(!!worker);
        }
      }, 50);
    });
  }

  var nodeBin = nodeSteamPath();
  if (!fs.existsSync(nodeBin)) {
    console.warn('[steam-build] node-steam binary missing:', nodeBin);
    return Promise.resolve(false);
  }

  workerStarting = true;
  return pingHealth().then(function (health) {
    if (health.ok) {
      workerStarting = false;
      return true;
    }

    worker = spawn(nodeBin, [workerScriptPath()], {
      cwd: __dirname,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    });

    worker.on('exit', function (code) {
      worker = null;
      if (code === 42 && typeof onSteamRestartRequired === 'function') {
        onSteamRestartRequired();
      }
    });

    return waitForHealth(15000);
  }).finally(function () {
    workerStarting = false;
  });
}

function waitForHealth(timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    (function poll() {
      pingHealth().then(function (h) {
        if (h.ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, 100);
      });
    })();
  });
}

module.exports = {
  ensureWorkerProcess: ensureWorkerProcess,
  getInfo: function () {
    return ensureWorkerProcess().then(function (ok) {
      if (!ok) return { available: false, error: 'Steam worker not running' };
      return httpJson('GET', '/info');
    }).catch(function (err) {
      return { available: false, error: err.message };
    });
  },
  unlockAchievement: function (name) {
    return ensureWorkerProcess().then(function (ok) {
      if (!ok) return false;
      return httpJson('POST', '/unlock', { name: name }).then(function (r) { return !!r.ok; });
    }).catch(function () { return false; });
  },
  isAchievementUnlocked: function (name) {
    return ensureWorkerProcess().then(function (ok) {
      if (!ok) return false;
      return httpJson('POST', '/is-unlocked', { name: name }).then(function (r) { return !!r.unlocked; });
    }).catch(function () { return false; });
  },
  setPresence: function (key, value) {
    return ensureWorkerProcess().then(function (ok) {
      if (!ok) return false;
      return httpJson('POST', '/presence', { key: key, value: value }).then(function (r) { return !!r.ok; });
    }).catch(function () { return false; });
  },
  openOverlay: function (dialog) {
    return ensureWorkerProcess().then(function (ok) {
      if (!ok) return false;
      return httpJson('POST', '/overlay', { dialog: dialog }).then(function (r) { return !!r.ok; });
    }).catch(function () { return false; });
  },
  shutdown: function () {
    if (worker && !worker.killed) worker.kill();
    worker = null;
  },
  setOnSteamRestartRequired: function (fn) {
    onSteamRestartRequired = fn;
  },
};
