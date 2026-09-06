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

function ensureNodeSteamExecutable() {
  if (process.platform === 'win32') return;
  try { fs.chmodSync(nodeSteamPath(), 0o755); } catch (_err) { /* ignore */ }
}

function askWorkerQuit() {
  return new Promise(function (resolve) {
    var req = http.request({
      host: HOST,
      port: PORT,
      path: '/quit',
      method: 'POST',
    }, function (res) {
      res.resume();
      resolve();
    });
    req.on('error', function () { resolve(); });
    req.setTimeout(400, function () { req.destroy(); resolve(); });
    req.end();
  });
}

function killWorkerPid(pid) {
  if (!pid) return;
  try { process.kill(pid, 'SIGTERM'); } catch (_err) { /* already gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch (_err2) { /* already gone */ }
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
  ensureNodeSteamExecutable();

  workerStarting = true;
  return askWorkerQuit().then(function () {
    return new Promise(function (resolve) { setTimeout(resolve, 150); });
  }).then(function () {
    worker = spawn(nodeBin, [workerScriptPath()], {
      cwd: __dirname,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
      detached: false,
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
    var pid = worker && worker.pid;
    worker = null;
    try {
      var req = http.request({ host: HOST, port: PORT, path: '/quit', method: 'POST' });
      req.on('error', function () {});
      req.end();
    } catch (_err) { /* ignore */ }
    killWorkerPid(pid);
  },
  setOnSteamRestartRequired: function (fn) {
    onSteamRestartRequired = fn;
  },
};
