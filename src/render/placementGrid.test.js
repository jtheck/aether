import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildField } from '../sim/field.js';
import * as fx from '../sim/fixed.js';
import { buildingFootprintBounds, snapBuildingWorld } from '../sim/buildings.js';
import {
  PLACEMENT_GRID_PAD,
  classifyGridTile,
  placementFillKind,
  placementGridWindow,
} from './placementGrid.js';

function snap(type, xF, zF) {
  return snapBuildingWorld(type, fx.fromFloat(xF), fx.fromFloat(zF));
}

describe('placement grid window', () => {
  it('pads the claim on every side without changing the footprint', () => {
    buildField(1, { width: 64, height: 64 });
    const s = snap('camp', 8, 12);
    const claim = buildingFootprintBounds('camp', s.x, s.z);
    const win = placementGridWindow('camp', s.x, s.z);
    assert.ok(win);
    assert.equal(win.claimX0, claim.x0);
    assert.equal(win.claimZ0, claim.z0);
    assert.equal(win.claimX1, claim.x0 + claim.w);
    assert.equal(win.claimZ1, claim.z0 + claim.h);
    assert.equal(win.x0, claim.x0 - PLACEMENT_GRID_PAD);
    assert.equal(win.z0, claim.z0 - PLACEMENT_GRID_PAD);
    assert.equal(win.x1 - win.x0, claim.w + PLACEMENT_GRID_PAD * 2);
    assert.equal(win.z1 - win.z0, claim.h + PLACEMENT_GRID_PAD * 2);
  });

  it('keeps odd and even footprints local (not a full-map window)', () => {
    buildField(2, { width: 64, height: 64 });
    const camp = placementGridWindow('camp', snap('camp', 0, 0).x, snap('camp', 0, 0).z);
    const farm = placementGridWindow('farm', snap('farm', 4, 4).x, snap('farm', 4, 4).z);
    assert.equal(camp.x1 - camp.x0, 2 + PLACEMENT_GRID_PAD * 2);
    assert.equal(farm.x1 - farm.x0, 3 + PLACEMENT_GRID_PAD * 2);
    assert.ok(camp.x1 - camp.x0 < 16);
    assert.ok(farm.x1 - farm.x0 < 16);
  });

  it('returns null for unknown types', () => {
    assert.equal(placementGridWindow('nope', 0, 0), null);
  });
});

describe('placement grid tile class', () => {
  it('matches G-grid occupancy: blocked, structure, tree-slow, clear', () => {
    const n = 16;
    const field = {
      width: n,
      height: n,
      pass: new Uint8Array(n * n).fill(1),
      slowMask: new Uint8Array(n * n),
      structureSlowMask: new Uint8Array(n * n),
      activeMask: new Uint8Array(n * n).fill(1),
    };
    field.pass[0] = 0;
    field.structureSlowMask[1] = 1;
    field.slowMask[2] = 1;
    field.activeMask[3] = 0;
    assert.equal(classifyGridTile(field, 0, 0), 'blocked');
    assert.equal(classifyGridTile(field, 1, 0), 'structure');
    assert.equal(classifyGridTile(field, 2, 0), 'slow');
    assert.equal(classifyGridTile(field, 4, 0), 'clear');
    assert.equal(classifyGridTile(field, 3, 0), null);
    assert.equal(classifyGridTile(field, -1, 0), null);
  });

  it('paints the claim with the ghost: green if valid, red if not', () => {
    const win = {
      claimX0: 2,
      claimZ0: 2,
      claimX1: 4,
      claimZ1: 4,
    };
    assert.equal(placementFillKind('clear', 2, 2, win), 'clear');
    assert.equal(placementFillKind('slow', 3, 3, win), 'clear');
    assert.equal(placementFillKind('blocked', 2, 2, win), 'clear');
    assert.equal(placementFillKind('clear', 2, 2, { ...win, valid: false }), 'blocked');
    assert.equal(placementFillKind('slow', 3, 3, { ...win, valid: false }), 'blocked');
    assert.equal(placementFillKind('clear', 0, 0, win), null);
    assert.equal(placementFillKind('clear', 0, 0, { ...win, valid: false }), null);
    assert.equal(placementFillKind('slow', 0, 0, win), 'slow');
    assert.equal(placementFillKind('structure', 1, 1, win), 'structure');
  });
});
