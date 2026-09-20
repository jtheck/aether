'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  K_I_GAME_OVERLAY_ACTIVATED,
  createOverlayActive,
  readActiveFlag,
} = require('./overlayActive');

describe('createOverlayActive', () => {
  it('tracks the overlay latch and skips a missing Steam loader', () => {
    const overlay = createOverlayActive();
    assert.equal(overlay.K_I_GAME_OVERLAY_ACTIVATED, 331);
    assert.equal(K_I_GAME_OVERLAY_ACTIVATED, 331);
    assert.equal(overlay.isActive(), false);
    overlay.setActive(true);
    assert.equal(overlay.isActive(), true);
    overlay.setActive(0);
    assert.equal(overlay.isActive(), false);
    assert.equal(overlay.attach(null), false);
    assert.equal(overlay.attach({}), false);
  });
});

describe('readActiveFlag', () => {
  it('reads the first Steam callback byte', () => {
    const koffi = {
      decode() { return 1; },
    };
    assert.equal(readActiveFlag(koffi, {}), true);
    assert.equal(readActiveFlag({
      decode() { throw new Error('nope'); },
    }, { m_bActive: 1 }), true);
    assert.equal(readActiveFlag({ decode() { return 0; } }, {}), false);
    assert.equal(readActiveFlag({}, null), false);
  });
});
