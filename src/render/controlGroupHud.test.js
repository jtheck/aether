import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_GROUP_DEFS,
  CONTROL_GROUP_EDGE_PX,
  CONTROL_GROUP_SIZE_PX,
  layoutControlGroups,
  pickControlGroupAt,
  tallyGlyphs,
  tallyMarkLayout,
  visibleControlGroupDefs,
} from './controlGroupHud.js';

describe('control group HUD layout', () => {
  it('shows four pads by default and six when extra is on', () => {
    assert.equal(visibleControlGroupDefs(false).length, 4);
    assert.equal(visibleControlGroupDefs(true).length, 6);
    assert.deepEqual(
      visibleControlGroupDefs(false).map((d) => d.name),
      ['red', 'green', 'blue', 'yellow'],
    );
    assert.deepEqual(
      visibleControlGroupDefs(true).map((d) => d.name),
      ['red', 'green', 'blue', 'yellow', 'black', 'white'],
    );
  });

  it('puts two (or three) pads on each side, vertically centered', () => {
    const vw = 1280;
    const vh = 720;
    const four = layoutControlGroups(vw, vh, false);
    assert.equal(four.length, 4);
    const left = four.filter((r) => r.x < vw * 0.5);
    const right = four.filter((r) => r.x > vw * 0.5);
    assert.equal(left.length, 2);
    assert.equal(right.length, 2);
    assert.equal(left[0].name, 'red');
    assert.equal(left[1].name, 'green');
    assert.equal(right[0].name, 'blue');
    assert.equal(right[1].name, 'yellow');
    assert.equal(left[0].x, CONTROL_GROUP_EDGE_PX);
    assert.equal(right[0].x, vw - CONTROL_GROUP_EDGE_PX - CONTROL_GROUP_SIZE_PX);
    const stackMid = (left[0].y + left[1].y + left[1].h) * 0.5;
    assert.ok(Math.abs(stackMid - vh * 0.5) < 1);

    const six = layoutControlGroups(vw, vh, true);
    assert.equal(six.filter((r) => r.x < vw * 0.5).length, 3);
    assert.equal(six.filter((r) => r.x > vw * 0.5).length, 3);
    assert.equal(six.find((r) => r.name === 'black')?.x, CONTROL_GROUP_EDGE_PX);
    assert.ok(six.find((r) => r.name === 'white')?.x > vw * 0.5);
  });

  it('carries every sixteen into an X and caps at XX', () => {
    assert.deepEqual(tallyGlyphs(0), { xCount: 0, hashes: 0 });
    assert.deepEqual(tallyGlyphs(15), { xCount: 0, hashes: 15 });
    assert.deepEqual(tallyGlyphs(16), { xCount: 1, hashes: 0 });
    assert.deepEqual(tallyGlyphs(17), { xCount: 1, hashes: 1 });
    assert.deepEqual(tallyGlyphs(31), { xCount: 1, hashes: 15 });
    assert.deepEqual(tallyGlyphs(32), { xCount: 2, hashes: 0 });
    assert.deepEqual(tallyGlyphs(99), { xCount: 2, hashes: 0 });
  });

  it('lays out prison tallies as four uprights plus a slash per five', () => {
    assert.deepEqual(tallyMarkLayout(0), []);
    assert.equal(tallyMarkLayout(4).at(-1)?.stroke, 3);
    assert.equal(tallyMarkLayout(5).at(-1)?.stroke, 4);
    assert.equal(tallyMarkLayout(5).length, 5);
    assert.deepEqual(tallyMarkLayout(1)[0], {
      group: 0, stroke: 0, row: 0, col: 0, inGroup: 1,
    });
    assert.deepEqual(tallyMarkLayout(6).at(-1), {
      group: 1, stroke: 0, row: 0, col: 1, inGroup: 1,
    });
    assert.equal(tallyMarkLayout(11).at(-1)?.col, 0);
    assert.equal(tallyMarkLayout(11).at(-1)?.row, 1);
    assert.equal(tallyMarkLayout(15).length, 15);
    assert.equal(tallyMarkLayout(16).length, 0);
    assert.equal(tallyMarkLayout(17)[0]?.col, 0);
    assert.equal(tallyMarkLayout(17)[0]?.row, 0);
    assert.equal(tallyMarkLayout(20).length, 4);
    assert.equal(tallyMarkLayout(40).length, 0);
  });

  it('picks the pad under a canvas point (including slop)', () => {
    const rects = layoutControlGroups(800, 600, false);
    const red = rects.find((r) => r.name === 'red');
    assert.equal(pickControlGroupAt(rects, red.x + 4, red.y + 4), red.id);
    assert.equal(pickControlGroupAt(rects, 400, 300), null);
    assert.equal(CONTROL_GROUP_DEFS[0].id, 0);
  });
});
