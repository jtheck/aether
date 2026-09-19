import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gamepadCursorBrushScale, gamepadCursorScale, gamepadCursorWorldPos } from './gamepadCursor.js';

describe('gamepadCursorScale', () => {
  it('holds the reference size at the mid orbit', () => {
    assert.equal(gamepadCursorScale(80), 3.6);
  });

  it('clamps so close / far zoom stay readable', () => {
    assert.ok(gamepadCursorScale(12) >= 3.6 * 0.45);
    assert.ok(gamepadCursorScale(400) <= 3.6 * 2.2);
  });
});

describe('gamepadCursorBrushScale', () => {
  it('keeps the idle size until the brush is larger than the ring', () => {
    const base = gamepadCursorScale(80);
    assert.equal(gamepadCursorBrushScale(base, 0), base);
    assert.ok(gamepadCursorBrushScale(base, 8) > base);
  });
});

describe('gamepadCursorWorldPos', () => {
  it('lifts the mark above the sampled ground', () => {
    assert.deepEqual(gamepadCursorWorldPos(4, 2, -1), { x: 4, y: 2.55, z: -1 });
  });
});
