import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RESOURCE_SLOT_LABELS } from '../sim/storage.js';
import { normalizeResourceKind } from './resourceBank.js';
import { stripFilterCss } from '../render/resourceIconSheet.js';

describe('resource icon labels', () => {
  it('maps authored folder names onto bank kinds', () => {
    assert.equal(normalizeResourceKind('wood'), 'wood');
    assert.equal(normalizeResourceKind('stone'), 'stone');
    assert.equal(normalizeResourceKind('mineral'), 'mineral');
    assert.equal(normalizeResourceKind('minerals'), 'mineral');
    assert.equal(normalizeResourceKind('Food'), 'food');
    assert.equal(normalizeResourceKind('g144'), '');
  });

  it('strips Inkscape invert filters from inline styles', () => {
    assert.equal(
      stripFilterCss('display:inline;stroke:#f1ffff;filter:url(#filter145)'),
      'display:inline;stroke:#f1ffff',
    );
    assert.equal(
      stripFilterCss('stroke:#f1ffff;filter:url(#filter146);fill:none'),
      'stroke:#f1ffff;fill:none',
    );
    assert.equal(stripFilterCss('filter:url(#filter147)'), '');
  });

  it('the authored svg has 12 labeled icons per kind', () => {
    const svgPath = fileURLToPath(new URL('../../assets/images/resource_icons.svg', import.meta.url));
    const svg = readFileSync(svgPath, 'utf8');
    const kinds = ['stone', 'wood', 'food', 'mineral'];
    for (const kind of kinds) {
      const start = svg.indexOf(`inkscape:label="${kind}"`);
      assert.ok(start >= 0, `${kind} folder`);
      const rest = kinds.filter((k) => k !== kind);
      let end = svg.length;
      for (const other of rest) {
        const i = svg.indexOf(`inkscape:label="${other}"`, start + 1);
        if (i > start && i < end) end = i;
      }
      const block = svg.slice(start, end);
      for (const slot of RESOURCE_SLOT_LABELS) {
        assert.ok(
          block.includes(`inkscape:label="${slot}"`),
          `${kind} missing slot ${slot}`,
        );
      }
    }
  });
});
