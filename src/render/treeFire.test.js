import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMP_SOCKET_SCALE,
  TREE_FIRE_ANCHORS,
  TREE_MESH_HEIGHT,
  TREE_MODEL_SCALE,
  forEachTreeFireAnchor,
  treeCrownCenterY,
  treeFireHeight,
  treeFireTongueScale,
  treeLocalToWorld,
  treeMeshToWorld,
  treeWorldScale,
} from './treeFire.js';

describe('tree fire anchors', () => {
  it('scales with the scenery tree model, not camp sockets', () => {
    const mature = treeWorldScale(1.47);
    const leaf = treeFireTongueScale('leaf', 1.47);
    const trunk = treeFireTongueScale('trunk', 1.47);
    assert.ok(Math.abs(mature - TREE_MODEL_SCALE * 1.47) < 1e-9);
    assert.ok(treeFireHeight(1.47) < TREE_MESH_HEIGHT * 2);
    assert.ok(leaf > CAMP_SOCKET_SCALE * 0.65, 'tongues are large enough to join');
    assert.ok(leaf < CAMP_SOCKET_SCALE, 'a tongue is not a full hearth');
    assert.ok(trunk < leaf);
    assert.ok(trunk > leaf * 0.6);
  });

  it('lists a high point with the tree lean', () => {
    const upright = treeLocalToWorld(0, 0, 0, 0, 2, 0, 0, 0);
    const leaned = treeLocalToWorld(0, 0, 0, 0, 2, 0, 0, Math.PI / 2);
    assert.ok(Math.abs(upright.x) < 1e-9);
    assert.ok(Math.abs(upright.y - 2) < 1e-9);
    assert.ok(leaned.x < -1.5, 'positive lean tips toward -X at yaw 0');
    assert.ok(Math.abs(leaned.y) < 1e-9);
  });

  it('pins tongues inside the canopy, not on the leaf tips', () => {
    const leaf = TREE_FIRE_ANCHORS.filter((a) => a.kind === 'leaf');
    const trunk = TREE_FIRE_ANCHORS.filter((a) => a.kind === 'trunk');
    assert.ok(leaf.length >= 6);
    assert.ok(trunk.length >= 1);
    const ys = leaf.map((a) => a.y).sort((a, b) => a - b);
    assert.ok(ys[0] < 1.8, 'fire starts down in the foliage');
    assert.ok(ys[ys.length - 1] < TREE_MESH_HEIGHT, 'no anchors above the mesh');
    assert.ok(ys[ys.length - 1] - ys[0] > 2, 'anchors span the canopy');
    const mid = ys[ys.length >> 1];
    assert.ok(mid < 3.4, 'most of the fire sits in the leafy mass, not the tip');
    // Outer foliage reaches ~3.5. Tips that far out read as lights on the branches.
    for (const a of TREE_FIRE_ANCHORS) {
      const r = Math.hypot(a.x + 0.35, a.z + 0.15);
      assert.ok(r < 2.2, 'fire stays in the trunk and inner canopy');
    }
  });

  it('keeps world sites on the tree', () => {
    const sites = [];
    forEachTreeFireAnchor({ x: 10, y: 0, z: 4, stockScale: 1.47 }, (s) => sites.push(s));
    assert.equal(sites.length, TREE_FIRE_ANCHORS.length);
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const s of sites) {
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      assert.ok(s.scale > CAMP_SOCKET_SCALE * 0.5);
      assert.ok(s.scale < CAMP_SOCKET_SCALE);
    }
    assert.ok(minY < 2.2, 'trunk / low canopy is lit');
    assert.ok(maxY < treeFireHeight(1.47) + 0.2, 'tongues stay on the tree');
    assert.ok(maxY - minY > 2.5);
    assert.ok(maxX - minX > 2, 'fire is across the canopy, not one stack');
    assert.ok(Math.abs(treeCrownCenterY(0, 1.47) - 2.7 * treeWorldScale(1.47)) < 1e-9);
  });

  it('rides lean so tongues stay on the listing tree', () => {
    const up = [];
    const lean = [];
    forEachTreeFireAnchor({ x: 0, y: 0, z: 0, stockScale: 1.47, lean: 0 }, (s) => up.push(s));
    forEachTreeFireAnchor({ x: 0, y: 0, z: 0, stockScale: 1.47, lean: 0.7 }, (s) => lean.push(s));
    const upMean = up.reduce((a, s) => a + s.x, 0) / up.length;
    const leanMean = lean.reduce((a, s) => a + s.x, 0) / lean.length;
    assert.ok(leanMean < upMean - 0.15);
  });

  it('maps a mesh vert onto the instance', () => {
    const p = treeMeshToWorld(10, 0, 4, 0.494, 4.157, 0.597, 1.47, 0, 0);
    assert.ok(Math.abs(p.x - 10) < 2);
    assert.ok(p.y > 3);
  });
});
