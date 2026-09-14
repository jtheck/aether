import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MAX_LEN,
  createChatLog,
  isChatMessage,
  makeChatMessage,
  sanitizeChatText,
} from './chat.js';

describe('chat helpers', () => {
  it('sanitizes whitespace, control chars, and length', () => {
    assert.equal(sanitizeChatText('  a\t\tb\nc  '), 'a b c');
    assert.equal(sanitizeChatText('x\u0000\u0007y'), 'x y');
    assert.equal(sanitizeChatText('a'.repeat(500)).length, CHAT_MAX_LEN);
    assert.equal(sanitizeChatText('   '), '');
  });

  it('builds a self-describing message or null when empty', () => {
    const msg = makeChatMessage({ from: 'u1', name: 'Alice', color: '#f00', text: '  hi  ' });
    assert.equal(msg.type, 'chat');
    assert.equal(msg.from, 'u1');
    assert.equal(msg.name, 'Alice');
    assert.equal(msg.color, '#f00');
    assert.equal(msg.text, 'hi');
    assert.ok(msg.id && typeof msg.ts === 'number');
    assert.ok(isChatMessage(msg));
    assert.equal(makeChatMessage({ from: 'u1', text: '   ' }), null);
  });

  it('log dedupes by id, defaults name, and caps size', () => {
    const log = createChatLog(3);
    assert.equal(log.add({ type: 'chat', id: 'a', from: 'u', text: 'one', ts: 1 }), true);
    assert.equal(log.add({ type: 'chat', id: 'a', from: 'u', text: 'one', ts: 1 }), false);
    assert.equal(log.add({ type: 'not-chat', id: 'z', text: 'no' }), false);
    log.add({ type: 'chat', id: 'b', text: 'two', ts: 2 });
    log.add({ type: 'chat', id: 'c', text: 'three', ts: 3 });
    log.add({ type: 'chat', id: 'd', text: 'four', ts: 4 });
    const list = log.list();
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((m) => m.id), ['b', 'c', 'd']);
    assert.equal(list[0].name, 'Player');
    // Evicted id can be re-added (seen set stays bounded).
    assert.equal(log.add({ type: 'chat', id: 'a', text: 'again', ts: 5 }), true);
  });
});
