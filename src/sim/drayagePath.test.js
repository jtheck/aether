import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import {
  createField,
  findPath,
  tileCenterX,
  tileCenterY,
  worldToTile,
} from './field.js';
import { createWorld, spawn } from './world.js';
import { applyCommands, CMD } from './commands.js';
import { ownerHasTech, TECH, serializeTech, grantTech } from './tech.js';
import { addResource } from './resources.js';
import { MAX_WAYPOINTS, PATH_STYLE, queuePath, planPath } from './path.js';
import { UNIT } from './unitTypes.js';
import { growTreeAt } from './trees.js';
import {
  rallyPathWorldPoints,
  createBuilding,
  buildingTrainsOnlyFlyers,
} from './buildings.js';
import { buildingProductionSystem } from './buildingProduction.js';

function openField(w = 24, h = 24) {
  const field = createField(1, { width: w, height: h });
  field.pass.fill(1);
  field.activeMask.fill(1);
  field.slowMask.fill(0);
  return field;
}

describe('drayage slow-aware rally pathing', () => {
  it('geometric A* cuts through a slow belt; slowAware prefers the clear detour', () => {
    const field = openField();
    for (let tx = 3; tx <= 12; tx++) {
      field.slowMask[8 * field.width + tx] = 1;
    }

    const sx = tileCenterX(2);
    const sy = tileCenterY(8);
    const ex = tileCenterX(13);
    const ey = tileCenterY(8);
    const wx = new Int32Array(MAX_WAYPOINTS);
    const wy = new Int32Array(MAX_WAYPOINTS);

    const nGeom = findPath(field, sx, sy, ex, ey, wx, wy, MAX_WAYPOINTS);
    assert.ok(nGeom > 0, 'geometric path exists');
    assert.equal(nGeom, 1);
    assert.equal(worldToTile(wy[0]), 8);

    const wx2 = new Int32Array(MAX_WAYPOINTS);
    const wy2 = new Int32Array(MAX_WAYPOINTS);
    const nSmart = findPath(field, sx, sy, ex, ey, wx2, wy2, MAX_WAYPOINTS, {
      slowAware: true,
    });
    assert.ok(nSmart > 0, 'slowAware path exists');
    let leftRow = false;
    for (let i = 0; i < nSmart; i++) {
      if (worldToTile(wy2[i]) !== 8) leftRow = true;
    }
    assert.ok(
      leftRow,
      'slowAware path should leave the slow row (detour around trees)',
    );
  });

  it('CMD.RESEARCH queues a track then grants Drayage on complete', () => {
    const w = createWorld(7);
    const field = openField(32, 32);
    w.buildings = [
      createBuilding({
        owner: 0,
        type: 'barracks',
        x: fx.toFloat(tileCenterX(8)),
        z: fx.toFloat(tileCenterY(8)),
        yaw: 0,
      }),
    ];
    assert.equal(ownerHasTech(w, 0, TECH.DRAYAGE), false);
    addResource(w, 0, 'wood', 40);
    addResource(w, 0, 'stone', 20);
    applyCommands(w, field, [
      {
        type: CMD.RESEARCH,
        playerId: 0,
        buildingIndex: 0,
        techId: 'drayage',
      },
    ]);
    assert.equal(ownerHasTech(w, 0, TECH.DRAYAGE), false, 'not instant');
    assert.equal(w.buildings[0].tracks.length, 1);
    assert.equal(w.buildings[0].tracks[0].kind, 'upgrade');
    assert.equal(w.buildings[0].tracks[0].id, 'drayage');

    for (let i = 0; i < 60; i++) {
      buildingProductionSystem(w, field);
    }
    assert.equal(ownerHasTech(w, 0, TECH.DRAYAGE), true);
    assert.equal(w.buildings[0].tracks.length, 0);
    const ser = serializeTech(w);
    assert.ok((ser[0] & TECH.DRAYAGE) !== 0);
  });

  it('grantTech is idempotent', () => {
    const w = createWorld(3);
    assert.equal(grantTech(w, 0, 'drayage'), true);
    assert.equal(grantTech(w, 0, 'drayage'), false);
    assert.equal(ownerHasTech(w, 0, TECH.DRAYAGE), true);
  });

  it('perch (flyers) rally is a straight air stem, not ground A*', () => {
    assert.equal(buildingTrainsOnlyFlyers('perch'), true);
    assert.equal(buildingTrainsOnlyFlyers('barracks'), false);
    const field = openField();
    // Impassable wall — ground A* would detour or fail; air ignores it.
    for (let tz = 0; tz < field.height; tz++) {
      field.pass[tz * field.width + 8] = 0;
    }
    const b = {
      type: 'perch',
      x: fx.toFloat(tileCenterX(4)),
      z: fx.toFloat(tileCenterY(8)),
      yaw: 0,
    };
    const rx = fx.toFloat(tileCenterX(12));
    const rz = fx.toFloat(tileCenterY(8));
    const pts = rallyPathWorldPoints(field, b, rx, rz, { slowAware: true });
    assert.ok(pts.length >= 2);
    const end = pts[pts.length - 1];
    assert.ok(Math.abs(end.x - rx) < 0.05);
    assert.ok(Math.abs(end.z - rz) < 0.05);
    // No mid waypoints off the straight corridor (air = stem only).
    assert.ok(pts.length <= 3, `expected short air stem, got ${pts.length}`);
  });

  it('rallyPathWorldPoints honors slowAware', () => {
    const field = openField();
    for (let tx = 3; tx <= 12; tx++) {
      field.slowMask[8 * field.width + tx] = 1;
    }
    const b = {
      type: 'barracks',
      x: fx.toFloat(tileCenterX(2)),
      z: fx.toFloat(tileCenterY(8)),
      yaw: 0,
    };
    const rx = fx.toFloat(tileCenterX(13));
    const rz = fx.toFloat(tileCenterY(8));

    const dumb = rallyPathWorldPoints(field, b, rx, rz, null);
    const smart = rallyPathWorldPoints(field, b, rx, rz, { slowAware: true });
    assert.ok(dumb.length >= 2);
    assert.ok(smart.length >= 2);

    let smartLeft = false;
    for (const p of smart) {
      if (worldToTile(fx.fromFloat(p.z)) !== 8) smartLeft = true;
    }
    assert.ok(smartLeft, 'Drayage rally preview should detour off the slow belt');
  });
});

describe('unit path styles', () => {
  for (const type of [UNIT.MONK, UNIT.ENGINEER]) {
    const name = type === UNIT.MONK ? 'monk' : 'engineer';
    it(`${name} queuePath is slow-aware and detours a slow belt`, () => {
      const field = openField();
      for (let tx = 3; tx <= 12; tx++) {
        field.slowMask[8 * field.width + tx] = 1;
      }
      const sx = tileCenterX(2);
      const sy = tileCenterY(8);
      const ex = tileCenterX(13);
      const ey = tileCenterY(8);
      const w = createWorld(1);
      const id = spawn(w, { x: sx, y: sy, type, owner: 0 });
      queuePath(w, id, ex, ey);
      assert.equal(w.pathSlowAware[id], PATH_STYLE.SLOW_AWARE);
      planPath(w, field, id, ex, ey, true);
      assert.ok(w.navWpCount[id] > 0, `${name} found a path`);
      let leftRow = false;
      for (let i = 0; i < w.navWpCount[id]; i++) {
        if (worldToTile(w.navWy[i]) !== 8) leftRow = true;
      }
      assert.ok(leftRow, `${name} should leave the slow row`);
    });
  }

  it('treeSeek A* prefers a tree corridor over a clear parallel', () => {
    const field = openField();
    for (let tx = 3; tx <= 12; tx++) {
      growTreeAt(field, 6 * field.width + tx, 40);
    }
    const sx = tileCenterX(2);
    const sy = tileCenterY(8);
    const ex = tileCenterX(13);
    const ey = tileCenterY(8);
    const wx = new Int32Array(MAX_WAYPOINTS);
    const wy = new Int32Array(MAX_WAYPOINTS);
    const nGeom = findPath(field, sx, sy, ex, ey, wx, wy, MAX_WAYPOINTS);
    assert.ok(nGeom > 0);
    assert.equal(worldToTile(wy[0]), 8);

    const wx2 = new Int32Array(MAX_WAYPOINTS);
    const wy2 = new Int32Array(MAX_WAYPOINTS);
    const nSeek = findPath(field, sx, sy, ex, ey, wx2, wy2, MAX_WAYPOINTS, {
      treeSeek: true,
    });
    assert.ok(nSeek > 0, 'treeSeek path exists');
    let hitTrees = false;
    for (let i = 0; i < nSeek; i++) {
      if (worldToTile(wy2[i]) === 6) hitTrees = true;
    }
    assert.ok(hitTrees, 'treeSeek path should visit the tree row');
  });
});
