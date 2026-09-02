import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { narratorLines } from './speech.js';

describe('story speech', () => {
  it('keeps narrator copy and drops spoken lines', () => {
    const kept = narratorLines([
      { speaker: 'Doc', text: 'Go.' },
      { text: 'The grove waits.' },
      { speaker: '  ', text: 'Still narrator.' },
    ]);
    assert.deepEqual(kept.map((l) => l.text), ['The grove waits.', 'Still narrator.']);
  });
});
