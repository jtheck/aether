import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientRectUnion, hudCanvasFont, padClientRect } from './screenDomHud.js';

describe('clientRectUnion', () => {
  it('covers overflow past the root box', () => {
    const u = clientRectUnion([
      { left: 100, top: 10, width: 40, height: 16 },
      { left: 40, top: 10, width: 30, height: 16 },
      { left: 148, top: 8, width: 36, height: 18 },
      { left: 150, top: 10, width: 0, height: 16 },
    ]);
    assert.equal(u.left, 40);
    assert.equal(u.top, 8);
    assert.equal(u.width, 144);
    assert.equal(u.height, 18);
  });

  it('is empty when nothing has a box', () => {
    assert.equal(clientRectUnion([]), null);
    assert.equal(clientRectUnion([{ left: 0, top: 0, width: 0, height: 10 }]), null);
  });
});

describe('hudCanvasFont', () => {
  it('grows the face with the raster so glyphs fill their boxes', () => {
    const font = hudCanvasFont({
      fontSize: '13px',
      fontFamily: 'Roboto, sans-serif',
      fontWeight: '400',
      fontStyle: 'normal',
    }, 3);
    assert.equal(font, '400 39px Roboto, sans-serif');
  });

  it('falls back when the computed size is missing', () => {
    assert.equal(hudCanvasFont({}, 2), '26px sans-serif');
  });
});

describe('padClientRect', () => {
  it('grows evenly so the center stays put', () => {
    const r = padClientRect({ left: 10, top: 20, width: 40, height: 8 }, 4);
    assert.equal(r.left, 6);
    assert.equal(r.top, 16);
    assert.equal(r.width, 48);
    assert.equal(r.height, 16);
    assert.equal(r.left + r.width * 0.5, 30);
    assert.equal(r.top + r.height * 0.5, 24);
  });
});
