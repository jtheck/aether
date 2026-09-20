'use strict';

const INPUT_MODE_NORMAL = 0;
const LINE_MODE_SINGLE = 0;
const DEFAULT_MAX = 24;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_INTERVAL_MS = 100;

function clampMax(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX;
  return Math.max(1, Math.min(256, v | 0));
}

function readEntered(utils, maxChars) {
  if (!utils) return { ok: false, text: '' };
  let len = 0;
  try {
    len = utils.getEnteredGamepadTextLength() | 0;
  } catch {
    return { ok: false, text: '' };
  }
  if (!(len > 0)) return { ok: false, text: '' };
  try {
    const text = utils.getEnteredGamepadTextInput(Math.max(len, maxChars + 1));
    return { ok: true, text: text == null ? '' : String(text) };
  } catch {
    return { ok: false, text: '' };
  }
}

function waitForEntered(utils, opts) {
  const maxChars = clampMax(opts && opts.maxChars);
  const now = (opts && opts.now) || Date.now;
  const sleep = (opts && opts.sleep) || function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };
  const runCallbacks = (opts && opts.runCallbacks) || function () {};
  const deadline = now() + ((opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const interval = (opts && opts.intervalMs) || DEFAULT_INTERVAL_MS;

  function step() {
    try { runCallbacks(); } catch (_err) { /* ignore */ }
    const got = readEntered(utils, maxChars);
    if (got.ok) return Promise.resolve({ ok: true, submitted: true, text: got.text });
    if (now() >= deadline) return Promise.resolve({ ok: true, submitted: false, text: '' });
    return sleep(interval).then(step);
  }

  return step();
}

function showAndWait(utils, body, opts) {
  if (!utils || typeof utils.showGamepadTextInput !== 'function') {
    return Promise.resolve({ ok: false, submitted: false, text: '' });
  }
  const maxChars = clampMax(body && body.maxChars);
  let opened = false;
  try {
    opened = !!utils.showGamepadTextInput(
      INPUT_MODE_NORMAL,
      LINE_MODE_SINGLE,
      String((body && body.description) || 'Name'),
      maxChars,
      String((body && body.existing) || ''),
    );
  } catch (err) {
    return Promise.resolve({
      ok: false,
      submitted: false,
      text: '',
      error: err && err.message ? err.message : 'show failed',
    });
  }
  if (!opened) return Promise.resolve({ ok: false, submitted: false, text: '' });
  return waitForEntered(utils, Object.assign({ maxChars: maxChars }, opts));
}

module.exports = {
  INPUT_MODE_NORMAL,
  LINE_MODE_SINGLE,
  clampMax,
  readEntered,
  waitForEntered,
  showAndWait,
};
