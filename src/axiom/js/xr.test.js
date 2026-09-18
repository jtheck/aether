import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  XR_MODE,
  bindXrButton,
  isImmersiveVrSupported,
  requestImmersiveVr,
} from './xr.js';

describe('isImmersiveVrSupported', () => {
  it('is false without a WebXR impl', async () => {
    assert.equal(await isImmersiveVrSupported(undefined), false);
    assert.equal(await isImmersiveVrSupported({}), false);
  });

  it('asks for immersive-vr and swallows throws', async () => {
    const modes = [];
    assert.equal(
      await isImmersiveVrSupported({
        isSessionSupported(mode) {
          modes.push(mode);
          return Promise.resolve(true);
        },
      }),
      true,
    );
    assert.deepEqual(modes, [XR_MODE]);
    assert.equal(
      await isImmersiveVrSupported({
        isSessionSupported() {
          return Promise.reject(new Error('no xr'));
        },
      }),
      false,
    );
  });
});

describe('requestImmersiveVr', () => {
  it('retries without local-floor when the floor space is missing', async () => {
    const inits = [];
    const xr = {
      requestSession(mode, init) {
        inits.push({ mode, init });
        if (init?.requiredFeatures) return Promise.reject(new Error('no floor'));
        return Promise.resolve({ id: 'session' });
      },
    };
    assert.deepEqual(await requestImmersiveVr(xr), { id: 'session' });
    assert.deepEqual(inits, [
      { mode: XR_MODE, init: { requiredFeatures: ['local-floor'] } },
      { mode: XR_MODE, init: undefined },
    ]);
  });
});

describe('bindXrButton', () => {
  it('enters on click and exits on Escape', () => {
    const clicks = [];
    const keys = [];
    const button = {
      click: null,
      key: null,
      addEventListener(type, fn) {
        if (type === 'click') this.click = fn;
      },
      removeEventListener(type, fn) {
        if (type === 'click' && this.click === fn) this.click = null;
      },
    };
    const root = {
      addEventListener(type, fn) {
        if (type === 'keydown') this.key = fn;
      },
      removeEventListener(type, fn) {
        if (type === 'keydown' && this.key === fn) this.key = null;
      },
    };
    const unbind = bindXrButton(
      button,
      {
        enterXR() {
          clicks.push('in');
        },
        exitXR() {
          keys.push('out');
        },
      },
      { root },
    );
    button.click();
    root.key({ key: 'Escape' });
    root.key({ key: 'g' });
    assert.deepEqual(clicks, ['in']);
    assert.deepEqual(keys, ['out']);
    unbind();
    assert.equal(button.click, null);
    assert.equal(root.key, null);
  });
});
