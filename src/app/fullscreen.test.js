import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeMenuStep,
  isFilledWindow,
  isPageFullscreen,
  tryExitFullscreen,
} from './fullscreen.js';

describe('escapeMenuStep', () => {
  it('opens the menu, then settings, then tries exit', () => {
    assert.equal(escapeMenuStep({ menuOpen: false, page: 'main' }), 'open-menu');
    assert.equal(escapeMenuStep({ menuOpen: true, page: 'main' }), 'open-settings');
    assert.equal(escapeMenuStep({ menuOpen: true, page: 'settings' }), 'exit-fullscreen');
  });
});

describe('isPageFullscreen', () => {
  it('reads the Fullscreen API first', () => {
    assert.equal(isPageFullscreen({
      document: { fullscreenElement: {} },
      screen: { width: 800, height: 600 },
      innerWidth: 100,
      innerHeight: 100,
    }), true);
  });

  it('reads the desktop bridge', () => {
    assert.equal(isPageFullscreen({
      document: {},
      aetherDesktop: { isFullscreen: () => true },
      screen: { width: 800, height: 600 },
      innerWidth: 100,
      innerHeight: 100,
    }), true);
  });

  it('treats a filled window as F11-style fullscreen', () => {
    const filled = {
      document: {},
      screen: { width: 1920, height: 1080 },
      innerWidth: 1920,
      innerHeight: 1080,
    };
    assert.equal(isFilledWindow(filled), true);
    assert.equal(isPageFullscreen(filled), true);
    assert.equal(isPageFullscreen({
      ...filled,
      innerHeight: 1000,
    }), false);
  });
});

describe('tryExitFullscreen', () => {
  it('exits the Fullscreen API when a document element is fullscreen', async () => {
    let called = false;
    const root = {
      document: {
        fullscreenElement: {},
        exitFullscreen: async () => { called = true; },
      },
    };
    assert.equal(await tryExitFullscreen(root), true);
    assert.equal(called, true);
  });

  it('asks the desktop shell when the page is not API-fullscreen', async () => {
    let called = false;
    const root = {
      document: {},
      aetherDesktop: {
        leaveFullscreen: async () => { called = true; return true; },
      },
    };
    assert.equal(await tryExitFullscreen(root), true);
    assert.equal(called, true);
  });

  it('returns false when nothing can leave fullscreen', async () => {
    assert.equal(await tryExitFullscreen({ document: {} }), false);
  });
});
