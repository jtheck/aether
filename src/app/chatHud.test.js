import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_LINE_FADE_MS, CHAT_LINE_HOLD_MS, chatLinePhase, storyLineRecords } from './chatHud.js';

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

  it('keeps a later chapter line that reuses a clip id', () => {
    const first = storyLineRecords([
      { id: 'intro-line-4', name: 'Stumpey', text: 'Big problems... we oughtta get outta here.' },
    ], 0, 1);
    const next = storyLineRecords([
      { id: 'intro-line-4', name: 'Stumpey', text: 'Towers left and right. Do not stop.' },
    ], first.seq, 2);
    assert.equal(first.records[0].text, 'Big problems... we oughtta get outta here.');
    assert.equal(next.records[0].text, 'Towers left and right. Do not stop.');
    assert.notEqual(first.records[0].id, next.records[0].id);
  });
});
