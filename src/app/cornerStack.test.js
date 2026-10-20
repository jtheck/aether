import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CORNER_BOTTOM, CORNER_GAP, chatLogClearance, cornerStackBottoms } from './cornerStack.js';

describe('corner stack', () => {
  it('parks an empty column on the chat anchor', () => {
    const stack = cornerStackBottoms();
    assert.equal(stack.chat, CORNER_BOTTOM);
    assert.equal(stack.replay, CORNER_BOTTOM);
    assert.equal(stack.lobby, CORNER_BOTTOM);
  });

  it('lifts replay above the chat entry and the lobby above replay', () => {
    const stack = cornerStackBottoms({ chat: 32, replay: 70, lobby: true });
    assert.equal(stack.chat, CORNER_BOTTOM);
    assert.equal(stack.replay, CORNER_BOTTOM + 32 + CORNER_GAP);
    assert.equal(stack.lobby, stack.replay + 70 + CORNER_GAP);
  });

  it('drops replay onto the chat anchor when chat is hidden', () => {
    const stack = cornerStackBottoms({ chat: 0, replay: 70, lobby: true });
    assert.equal(stack.replay, CORNER_BOTTOM);
    assert.equal(stack.lobby, CORNER_BOTTOM + 70 + CORNER_GAP);
  });

  it('sits the lobby on chat when replay is not running', () => {
    const stack = cornerStackBottoms({ chat: 36, replay: 0, lobby: true });
    assert.equal(stack.replay, CORNER_BOTTOM + 36);
    assert.equal(stack.lobby, CORNER_BOTTOM + 36 + CORNER_GAP);
  });

  it('clears the chat log above the tallest visible piece', () => {
    const low = chatLogClearance({ chat: 32 });
    assert.equal(low, CORNER_BOTTOM + 32 + CORNER_GAP);
    const high = chatLogClearance({ chat: 32, replay: 70, lobby: 180, lobbyOn: true });
    const stack = cornerStackBottoms({ chat: 32, replay: 70, lobby: true });
    assert.equal(high, stack.lobby + 180 + CORNER_GAP);
  });
});
