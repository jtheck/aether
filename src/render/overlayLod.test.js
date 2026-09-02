import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAY_BAR_NEAR_DISTANCE,
  OVERLAY_BAR_NEAR_DISTANCE_SQ,
  markNearestN,
  markSelectedThenNearest,
  overlayBarIsFar,
} from './overlayLod.js';

function pack(ids, d2) {
  const idBuf = new Int32Array(ids);
  const dBuf = new Float32Array(d2);
  return { idBuf, dBuf };
}

describe('overlay bar near/far', () => {
  it('treats look-at distance past the near radius as far', () => {
    assert.equal(overlayBarIsFar(0, 0), false);
    assert.equal(overlayBarIsFar(OVERLAY_BAR_NEAR_DISTANCE, 0), false);
    assert.equal(overlayBarIsFar(OVERLAY_BAR_NEAR_DISTANCE + 1, 0), true);
    assert.ok(OVERLAY_BAR_NEAR_DISTANCE_SQ > 0);
  });
});

describe('markSelectedThenNearest', () => {
  it('keeps a far selected unit even when nearer wounded fill the disk', () => {
    const { idBuf, dBuf } = pack([1, 2, 3, 4], [400, 1, 4, 9]);
    const selected = new Uint8Array(8);
    selected[1] = 1;
    const allowed = new Uint8Array(8);
    const n = markSelectedThenNearest(idBuf, dBuf, 4, 3, selected, allowed);
    assert.equal(n, 3);
    assert.equal(allowed[1], 1);
    assert.equal(allowed[2], 1);
    assert.equal(allowed[3], 1);
    assert.equal(allowed[4], 0);
  });

  it('fills leftover slots with the nearest wounded', () => {
    const { idBuf, dBuf } = pack([10, 11, 12], [100, 4, 25]);
    const selected = new Uint8Array(16);
    selected[10] = 1;
    const allowed = new Uint8Array(16);
    markSelectedThenNearest(idBuf, dBuf, 3, 2, selected, allowed);
    assert.equal(allowed[10], 1);
    assert.equal(allowed[11], 1);
    assert.equal(allowed[12], 0);
  });

  it('nearest-N among selected when selection exceeds the budget', () => {
    const { idBuf, dBuf } = pack([1, 2, 3], [9, 1, 4]);
    const selected = new Uint8Array(8);
    selected[1] = 1;
    selected[2] = 1;
    selected[3] = 1;
    const allowed = new Uint8Array(8);
    markSelectedThenNearest(idBuf, dBuf, 3, 2, selected, allowed);
    assert.equal(allowed[2], 1);
    assert.equal(allowed[3], 1);
    assert.equal(allowed[1], 0);
  });
});

describe('markNearestN', () => {
  it('still picks the closest without selected priority', () => {
    const { idBuf, dBuf } = pack([1, 2, 3], [400, 1, 4]);
    const allowed = new Uint8Array(8);
    markNearestN(idBuf, dBuf, 3, 2, allowed);
    assert.equal(allowed[2], 1);
    assert.equal(allowed[3], 1);
    assert.equal(allowed[1], 0);
  });
});
