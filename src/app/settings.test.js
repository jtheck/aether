import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AA_ENABLED,
  MSAA_SAMPLES_OFF,
  MSAA_SAMPLES_ON,
  aaEnabledForAdapter,
  ensureAaEnabledDefault,
  getAaEnabled,
  msaaSamples,
  setAaEnabled,
} from './settings.js';

const store = Object.create(null);

globalThis.localStorage = {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
  },
  setItem(key, value) {
    store[key] = String(value);
  },
  removeItem(key) {
    delete store[key];
  },
};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('aaEnabledForAdapter', () => {
  it('turns MSAA off on software and mobile parts', () => {
    assert.equal(aaEnabledForAdapter({ vendor: 'Microsoft', architecture: 'WARP' }), false);
    assert.equal(aaEnabledForAdapter({ vendor: 'mesa' }), false);
    assert.equal(aaEnabledForAdapter({ vendor: 'google', architecture: 'swiftshader' }), false);
    assert.equal(aaEnabledForAdapter({ vendor: 'qualcomm' }), false);
    assert.equal(aaEnabledForAdapter({ vendor: 'arm' }), false);
    assert.equal(aaEnabledForAdapter({ vendor: 'intel', architecture: 'gen-12lp' }), false);
  });

  it('leaves 4× MSAA on for discrete-class adapters', () => {
    assert.equal(aaEnabledForAdapter({ vendor: 'nvidia' }), true);
    assert.equal(aaEnabledForAdapter({ vendor: 'amd' }), true);
    assert.equal(aaEnabledForAdapter({ vendor: 'intel', architecture: 'xe-hpg' }), true);
    assert.equal(aaEnabledForAdapter({ vendor: 'apple' }), true);
    assert.equal(aaEnabledForAdapter(null), DEFAULT_AA_ENABLED);
  });
});

describe('aaLevel storage', () => {
  it('treats a missing key as the default and writes 0 / 4', () => {
    assert.equal(getAaEnabled(), DEFAULT_AA_ENABLED);
    assert.equal(setAaEnabled(false), false);
    assert.equal(store.aaLevel, '0');
    assert.equal(getAaEnabled(), false);
    assert.equal(setAaEnabled(true), true);
    assert.equal(store.aaLevel, '4');
    assert.equal(getAaEnabled(), true);
  });

  it('treats leftover v1 aaLevel values as on when positive', () => {
    store.aaLevel = '1';
    assert.equal(getAaEnabled(), true);
    store.aaLevel = '2';
    assert.equal(getAaEnabled(), true);
    store.aaLevel = '3';
    assert.equal(getAaEnabled(), true);
    store.aaLevel = '0';
    assert.equal(getAaEnabled(), false);
  });

  it('maps the toggle onto Lite sample counts', () => {
    assert.equal(msaaSamples(false), MSAA_SAMPLES_OFF);
    assert.equal(msaaSamples(true), MSAA_SAMPLES_ON);
  });
});

describe('ensureAaEnabledDefault', () => {
  it('does not overwrite a stored preference', async () => {
    store.aaLevel = '0';
    assert.equal(await ensureAaEnabledDefault(), false);
    assert.equal(store.aaLevel, '0');
  });

  it('seeds from the adapter when unset', async () => {
    const prev = globalThis.navigator;
    globalThis.navigator = {
      gpu: {
        requestAdapter: async () => ({
          isFallbackAdapter: false,
          info: { vendor: 'nvidia', architecture: 'ampere' },
        }),
      },
    };
    try {
      assert.equal(await ensureAaEnabledDefault(), true);
      assert.equal(store.aaLevel, '4');
    } finally {
      globalThis.navigator = prev;
    }
  });
});

