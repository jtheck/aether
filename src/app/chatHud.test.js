import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_LINE_FADE_MS, CHAT_LINE_HOLD_MS, chatLinePhase } from './chatHud.js';

describe('chat line fade', () => {
  it('holds a fresh line, then fades, then drops it', () => {
    assert.equal(chatLinePhase(0, false), 'shown');
    assert.equal(chatLinePhase(CHAT_LINE_HOLD_MS - 1, false), 'shown');
    assert.equal(chatLinePhase(CHAT_LINE_HOLD_MS, false), 'fading');
    assert.equal(chatLinePhase(CHAT_LINE_HOLD_MS + CHAT_LINE_FADE_MS - 1, false), 'fading');
    assert.equal(chatLinePhase(CHAT_LINE_HOLD_MS + CHAT_LINE_FADE_MS, false), 'gone');
  });

  it('shows every line again while the text entry recall is up', () => {
    assert.equal(chatLinePhase(CHAT_LINE_HOLD_MS + CHAT_LINE_FADE_MS + 5000, true), 'shown');
  });
});
