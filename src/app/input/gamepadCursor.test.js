import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasAimClient,
  canvasCenterClient,
  CURSOR_EDGE_INSET,
  CURSOR_GAIN,
  CURSOR_PAN_EDGE_FRAC,
  gamepadCursorVisible,
  leashLimit,
  settleCursorLeash,
  stepCursorLeash,
} from './gamepadCursor.js';

describe('canvasCenterClient', () => {
  it('returns the canvas midpoint in client pixels', () => {
    assert.deepEqual(canvasCenterClient({ left: 40, top: 10, width: 200, height: 100 }), {
      clientX: 140,
      clientY: 60,
    });
  });

  it('rejects an empty rect', () => {
    assert.equal(canvasCenterClient(null), null);
    assert.equal(canvasCenterClient({ width: 0, height: 80 }), null);
  });
});

describe('canvasAimClient', () => {
  it('adds the leash offset to the canvas center', () => {
    assert.deepEqual(canvasAimClient({ left: 40, top: 10, width: 200, height: 100 }, 12, -8), {
      clientX: 152,
      clientY: 52,
    });
  });
});

describe('cursor leash', () => {
  it('starts the pan band far in from the screen edge', () => {
    assert.deepEqual(leashLimit(800, 600), {
      x: 400 - CURSOR_EDGE_INSET,
      y: 300 - CURSOR_EDGE_INSET,
      panX: 400 * (1 - CURSOR_PAN_EDGE_FRAC),
      panY: 300 * (1 - CURSOR_PAN_EDGE_FRAC),
    });
  });

  it('roams the view and eases pan up toward the cursor rim', () => {
    const leash = leashLimit(800, 600);
    const first = stepCursorLeash(0, 0, 1, 0, leash, CURSOR_GAIN);
    assert.equal(first.ox, CURSOR_GAIN);
    assert.equal(first.camLx, 0);
    const mid = stepCursorLeash(120, -80, 0.4, -0.2, leash, CURSOR_GAIN);
    assert.equal(mid.camLx, 0);
    assert.equal(mid.camLy, 0);
    const approach = stepCursorLeash(leash.panX + 8, 0, 1, 0, leash, CURSOR_GAIN);
    assert.ok(approach.ox < leash.x);
    assert.ok(approach.camLx > 0);
    const nearer = stepCursorLeash(leash.x - 40, 0, 1, 0, leash, CURSOR_GAIN);
    assert.ok(nearer.camLx > approach.camLx);
    const filled = stepCursorLeash(leash.x - 4, 0, 1, 0, leash, CURSOR_GAIN);
    assert.ok(Math.abs(filled.ox - leash.x) < 1e-6);
    assert.ok(filled.camLx > 0);
    const corner = stepCursorLeash(leash.x - 2, leash.y - 2, 0.6, 0.6, leash, CURSOR_GAIN);
    assert.ok(Math.abs(corner.ox - leash.x) < 1e-6);
    assert.ok(Math.abs(corner.oy - leash.y) < 1e-6);
    assert.ok(corner.camLx > 0 && corner.camLy > 0);
  });

  it('snaps home after the stick recenters', () => {
    const mid = settleCursorLeash(40, 0, 0.32, 1.5);
    assert.ok(mid.ox > 0 && mid.ox < 40);
    const home = settleCursorLeash(2, 0, 0.32, 1.5);
    assert.deepEqual(home, { ox: 0, oy: 0 });
  });
});

describe('gamepadCursorVisible', () => {
  it('shows only while a pad can play', () => {
    assert.equal(gamepadCursorVisible({ connected: true, playActive: true, menuOpen: false }), true);
    assert.equal(gamepadCursorVisible({ connected: true, playActive: false, menuOpen: false }), false);
    assert.equal(gamepadCursorVisible({ connected: true, playActive: true, menuOpen: true }), false);
    assert.equal(gamepadCursorVisible({ connected: false, playActive: true, menuOpen: false }), false);
  });
});
