import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextSelectionRingDrawCount } from './selectionRingDraw.js';

describe('nextSelectionRingDrawCount', () => {
  it('stays at zero until a collar is shown', () => {
    const shown = new Uint8Array(8);
    assert.equal(nextSelectionRingDrawCount(shown, 0, false, 0), 0);
    assert.equal(nextSelectionRingDrawCount(shown, 5, true, 0), 6);
  });

  it('keeps holes below the highest visible collar', () => {
    const shown = new Uint8Array(8);
    let n = nextSelectionRingDrawCount(shown, 4, true, 0);
    n = nextSelectionRingDrawCount(shown, 1, true, n);
    assert.equal(n, 5);
    n = nextSelectionRingDrawCount(shown, 1, false, n);
    assert.equal(n, 5);
    assert.equal(shown[1], 0);
    assert.equal(shown[4], 1);
  });

  it('shrinks to zero when the tail collar hides and nothing below it is shown', () => {
    const shown = new Uint8Array(8);
    let n = nextSelectionRingDrawCount(shown, 0, true, 0);
    n = nextSelectionRingDrawCount(shown, 6, true, n);
    n = nextSelectionRingDrawCount(shown, 0, false, n);
    assert.equal(n, 7);
    n = nextSelectionRingDrawCount(shown, 6, false, n);
    assert.equal(n, 0);
  });
});