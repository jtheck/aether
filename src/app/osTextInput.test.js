import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTextFieldValue, textFieldMaxChars } from './osTextInput.js';

function field(partial = {}) {
  const events = [];
  return {
    tagName: 'INPUT',
    type: 'text',
    value: 'Cultivator',
    maxLength: 24,
    events,
    dispatchEvent(ev) { events.push(ev.type); return true; },
    ...partial,
  };
}

describe('textFieldMaxChars', () => {
  it('reads maxlength and falls back', () => {
    assert.equal(textFieldMaxChars(field()), 24);
    assert.equal(textFieldMaxChars({ maxLength: -1 }), 24);
  });
});

describe('applyTextFieldValue', () => {
  it('writes the value and fires input then change', () => {
    const el = field();
    assert.equal(applyTextFieldValue(el, 'Warden', Event), true);
    assert.equal(el.value, 'Warden');
    assert.deepEqual(el.events, ['input', 'change']);
  });
});
