import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paintSpeechBubble } from './storySpeechWorld.js';

function mockCtx() {
  const ops = [];
  const ctx = {
    font: '16px sans-serif',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    measureText(text) {
      const px = parseFloat(ctx.font) || 16;
      return { width: String(text).length * px * 0.52 };
    },
    fillText(text, x, y) {
      ops.push({ op: 'fill', text, x, y, font: ctx.font, fill: ctx.fillStyle });
    },
    strokeText(text, x, y) {
      ops.push({ op: 'stroke', text, x, y, font: ctx.font, width: ctx.lineWidth });
    },
    fillRect() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx, ops };
}

function fills(ops) {
  return ops.filter((op) => op.op === 'fill');
}

function assertInside(ops, h) {
  for (const op of fills(ops)) {
    const px = parseFloat(op.font) || 0;
    assert.ok(op.y - px * 0.55 > 0, `${op.text} clips the top`);
    assert.ok(op.y + px * 0.55 < h, `${op.text} clips the bottom`);
  }
}

describe('paintSpeechBubble', () => {
  it('strokes each glyph and keeps a long line inside the plaque', () => {
    const { ctx, ops } = mockCtx();
    const h = 384;
    paintSpeechBubble(ctx, 1024, h, {
      speaker: 'Doc',
      style: 'think',
      text: 'Something has poisoned the heartwood. There is no curing this from here tonight.',
    });
    const drawn = fills(ops);
    assert.ok(drawn.some((op) => op.text === 'Doc' && op.fill === '#ffcc44'));
    assert.ok(drawn.some((op) => op.font.startsWith('italic ') && op.fill === '#99d6ff'));
    assert.equal(ops.filter((op) => op.op === 'stroke').length, drawn.length);
    assert.ok(drawn.length > 2);
    assertInside(ops, h);
  });

  it('draws a shout larger than a whisper', () => {
    const shout = mockCtx();
    const whisper = mockCtx();
    paintSpeechBubble(shout.ctx, 1024, 384, { speaker: 'Goblin', style: 'shout', text: 'North!' });
    paintSpeechBubble(whisper.ctx, 1024, 384, { speaker: 'Lady', style: 'whisper', text: 'North.' });
    const shoutBody = fills(shout.ops).find((op) => op.text === 'North!');
    const whisperBody = fills(whisper.ops).find((op) => op.text === 'North.');
    assert.ok(parseFloat(shoutBody.font) > parseFloat(whisperBody.font));
  });
});
