import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCREENSHOT_HUD_ADD_MS,
  SCREENSHOT_HUD_HOLD_ADD_EVERY_MS,
  SCREENSHOT_HUD_MAX_LINGER_MS,
  SCREENSHOT_HUD_TAP_MS,
  createScreenshotHudClock,
} from './screenshotHud.js';

describe('screenshot HUD clock', () => {
  it('hides for the tap linger after a tap', () => {
    const clock = createScreenshotHudClock();
    assert.equal(clock.press(0).hidden, true);
    assert.equal(clock.release(30).hidden, true);
    assert.equal(clock.tick(SCREENSHOT_HUD_TAP_MS).hidden, true);
    assert.equal(clock.tick(30 + SCREENSHOT_HUD_TAP_MS).hidden, false);
  });

  it('stays hidden while held, then lingers after release', () => {
    const clock = createScreenshotHudClock();
    clock.press(0);
    assert.equal(clock.tick(800).hidden, true);
    assert.equal(clock.tick(800).holding, true);
    const after = clock.release(800);
    assert.equal(after.hidden, true);
    assert.equal(after.holding, false);
    assert.ok(after.lingerMs >= SCREENSHOT_HUD_TAP_MS);
    assert.equal(clock.tick(800 + after.lingerMs - 1).hidden, true);
    assert.equal(clock.tick(800 + after.lingerMs).hidden, false);
  });

  it('adds linger while the hold is ridden, up to a cap', () => {
    const clock = createScreenshotHudClock();
    clock.press(0);
    const held = clock.tick(SCREENSHOT_HUD_HOLD_ADD_EVERY_MS * 4);
    const adds = Math.floor((SCREENSHOT_HUD_HOLD_ADD_EVERY_MS * 4) / SCREENSHOT_HUD_HOLD_ADD_EVERY_MS);
    assert.equal(
      held.lingerMs,
      Math.min(
        SCREENSHOT_HUD_MAX_LINGER_MS,
        SCREENSHOT_HUD_TAP_MS + adds * SCREENSHOT_HUD_ADD_MS,
      ),
    );
    clock.press(0);
    clock.tick(60_000);
    assert.equal(clock.release(60_000).lingerMs, SCREENSHOT_HUD_MAX_LINGER_MS);
  });

  it('adds a few hundred ms when tapped again during the linger', () => {
    const clock = createScreenshotHudClock();
    clock.press(0);
    clock.release(20);
    const mid = clock.tick(1000);
    clock.press(1000);
    const again = clock.release(1020);
    assert.ok(again.lingerMs > mid.lingerMs);
    assert.equal(
      Math.round(again.lingerMs),
      Math.round(Math.min(
        SCREENSHOT_HUD_MAX_LINGER_MS,
        mid.lingerMs + SCREENSHOT_HUD_ADD_MS,
      )),
    );
  });

  it('does not stack a second tap add on key-repeat while held', () => {
    const clock = createScreenshotHudClock();
    clock.press(0);
    const first = clock.press(10);
    const second = clock.press(20);
    assert.equal(first.lingerMs, SCREENSHOT_HUD_TAP_MS);
    assert.equal(second.lingerMs, SCREENSHOT_HUD_TAP_MS);
  });
});
