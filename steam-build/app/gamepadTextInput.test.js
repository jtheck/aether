'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  clampMax,
  readEntered,
  showAndWait,
} = require('./gamepadTextInput');

describe('clampMax', () => {
  it('keeps a name-length range', () => {
    assert.equal(clampMax(24), 24);
    assert.equal(clampMax(0), 1);
    assert.equal(clampMax(999), 256);
    assert.equal(clampMax('nope'), 24);
  });
});

describe('readEntered', () => {
  it('waits for a non-zero Steam length then reads the buffer', () => {
    assert.deepEqual(readEntered({
      getEnteredGamepadTextLength: () => 0,
      getEnteredGamepadTextInput: () => 'nope',
    }, 24), { ok: false, text: '' });
    assert.deepEqual(readEntered({
      getEnteredGamepadTextLength: () => 7,
      getEnteredGamepadTextInput: (n) => (n >= 7 ? 'Warden' : ''),
    }, 24), { ok: true, text: 'Warden' });
  });
});

describe('showAndWait', () => {
  it('returns the submitted name after the overlay keyboard closes', async () => {
    let shown = false;
    const utils = {
      showGamepadTextInput() {
        shown = true;
        return true;
      },
      getEnteredGamepadTextLength: () => (shown ? 7 : 0),
      getEnteredGamepadTextInput: () => 'Warden',
    };
    const result = await showAndWait(utils, { description: 'Player name', existing: 'Cultivator' }, {
      timeoutMs: 50,
      intervalMs: 1,
      now: Date.now,
      sleep: () => Promise.resolve(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.submitted, true);
    assert.equal(result.text, 'Warden');
  });

  it('no-ops when Steam will not open the keyboard', async () => {
    const result = await showAndWait({
      showGamepadTextInput: () => false,
    }, { existing: 'Cultivator' });
    assert.deepEqual(result, { ok: false, submitted: false, text: '' });
  });
});
