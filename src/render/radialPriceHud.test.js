import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { priceOverlayPos } from './radialPriceHud.js';

describe('radial price overlay', () => {
  it('keeps canvas CSS px when the canvas sits at the viewport origin', () => {
    const canvas = {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600 };
      },
    };
    assert.deepEqual(priceOverlayPos(120, 80, canvas), { x: 120, y: 80 });
  });

  it('adds the canvas rect so DPR-scaled framebuffer coords are not used', () => {
    const canvas = {
      getBoundingClientRect() {
        return { left: 12, top: 40, width: 390, height: 700 };
      },
    };
    assert.deepEqual(priceOverlayPos(100, 200, canvas), { x: 112, y: 240 });
  });
});
