import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatGameNumber } from './formatGameNumber.js';

describe('formatGameNumber', () => {
  it('writes lowercase hex without a prefix', () => {
    assert.equal(formatGameNumber(0), '0');
    assert.equal(formatGameNumber(9), '9');
    assert.equal(formatGameNumber(10), 'a');
    assert.equal(formatGameNumber(16), '10');
    assert.equal(formatGameNumber(90), '5a');
    assert.equal(formatGameNumber(100), '64');
    assert.equal(formatGameNumber(255), 'ff');
  });

  it('truncates toward zero and keeps a minus for negatives', () => {
    assert.equal(formatGameNumber(10.9), 'a');
    assert.equal(formatGameNumber(-10), '-a');
    assert.equal(formatGameNumber(undefined), '0');
  });
});
