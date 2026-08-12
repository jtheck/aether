'use strict';

const http = require('http');
const steamClient = require('./steam-client');

const PORT = parseInt(process.env.AETHER_BRIDGE_PORT || '9787', 10);
const HOST = '127.0.0.1';

let server = null;
let onDevToolsToggle = null;

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
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && req.url === '/steam/info') {
    try {
      var info = await steamClient.getInfo();
      return sendJson(res, 200, info || { available: false });
    } catch (err) {
      return sendJson(res, 200, { available: false, error: err.message });
    }
  }

  if (req.method === 'POST' && req.url === '/steam/unlock') {
    var body = await readBody(req);
    var ok = await steamClient.unlockAchievement(String(body.name || ''));
    return sendJson(res, 200, { ok: !!ok });
  }

  if (req.method === 'POST' && req.url === '/steam/is-unlocked') {
    var body2 = await readBody(req);
    var unlocked = await steamClient.isAchievementUnlocked(String(body2.name || ''));
    return sendJson(res, 200, { unlocked: !!unlocked });
  }

  if (req.method === 'POST' && req.url === '/steam/presence') {
    var body3 = await readBody(req);
    var ok2 = await steamClient.setPresence(String(body3.key || 'status'), body3.value);
    return sendJson(res, 200, { ok: !!ok2 });
  }

  if (req.method === 'POST' && req.url === '/steam/overlay') {
    var body4 = await readBody(req);
    var ok3 = await steamClient.openOverlay(String(body4.dialog || ''));
    return sendJson(res, 200, { ok: !!ok3 });
  }

  if (req.method === 'POST' && req.url === '/devtools/toggle') {
    if (onDevToolsToggle) onDevToolsToggle();
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'not found' });
}

function start(opts) {
  if (opts && opts.onDevToolsToggle) onDevToolsToggle = opts.onDevToolsToggle;
  if (server) return server;
  server = http.createServer(function (req, res) {
    handle(req, res).catch(function (err) {
      sendJson(res, 500, { error: err.message });
    });
  });
  server.listen(PORT, HOST, function () {
    console.log('[steam-build] Bridge server http://' + HOST + ':' + PORT);
  });
  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      console.warn('[steam-build] Bridge port', PORT, 'in use — another Aether instance may be running');
      return;
    }
    console.error('[steam-build] Bridge server error:', err.message);
  });
  return server;
}

function stop() {
  if (server) server.close();
  server = null;
}

module.exports = { start, stop, PORT, HOST, setDevToolsToggle: function (fn) { onDevToolsToggle = fn; } };
