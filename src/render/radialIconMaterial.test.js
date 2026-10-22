import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMenuPlateMaterial, createRadialIconMaterial, applyMenuOverlay, setMenuOriginFix, syncRadialIconShade } from './radialIconMaterial.js';
import { RADIAL_HUD_BLEND_ALPHA } from './radialPose.js';

describe('radial icon material', () => {
  it('draws both sides in the menu overlay', () => {
    const mat = createRadialIconMaterial({
      name: 'Yellow.005',
      baseColorFactor: [0.2, 0.4, 0.6, 1],
    });
    assert.equal(mat.backFaceCulling, false);
    assert.equal(mat.depthWrite, false);
    assert.equal(mat.depthCompare, 'always');
    assert.equal(mat.needAlphaBlending, true);
    assert.equal(mat.alpha, RADIAL_HUD_BLEND_ALPHA);
    assert.ok(mat.alpha < 1);
    assert.deepEqual(mat.diffuseColor, [0.2, 0.4, 0.6]);

    mat.diffuseColor = [0.25, 0.5, 0.75];
    mat.emissiveColor = [0.125, 0.25, 0.5];
    mat.alpha = 0.25;
    syncRadialIconShade(mat);
    const diffuse = mat._uniformValues.get('iconDiffuse').value;
    const emissive = mat._uniformValues.get('iconEmissive').value;
    assert.equal(diffuse[0], 0.25);
    assert.equal(diffuse[1], 0.5);
    assert.equal(diffuse[2], 0.75);
    assert.equal(emissive[0], 0.125);
    assert.equal(mat._uniformValues.get('iconAlpha').value[0], 0.25);
    setMenuOriginFix(mat, 4, 5, 6);
    assert.equal(mat._uniformValues.get('originFix').value[0], 4);
    assert.equal(mat._uniformValues.get('originFix').value[2], 6);
    syncRadialIconShade(null);
  });

  it('keeps plate pixels on the disc while the mesh sorts at the anchor', () => {
    const mat = createMenuPlateMaterial([0.5, 0.25, 0.125], [0.4, 0.8, 1], 0.5);
    assert.equal(mat.depthWrite, false);
    assert.equal(mat.depthCompare, 'always');
    mat.diffuseColor = [0.5, 1, 0.25];
    mat.emissiveColor = [0.2, 0.5, 1];
    mat.alpha = 0.4;
    syncRadialIconShade(mat);
    assert.ok(Math.abs(mat._uniformValues.get('plateDiffuse').value[1] - 1) < 1e-5);
    assert.ok(Math.abs(mat._uniformValues.get('plateEmissive').value[1] - 0.5) < 1e-5);
    assert.ok(Math.abs(mat._uniformValues.get('plateAlpha').value[0] - 0.4) < 1e-5);
    const mesh = { position: { x: 0, y: 0, z: 0 }, material: mat };
    applyMenuOverlay(mesh, 10, 4, -2, { x: 1, y: 2, z: 3, ok: true });
    assert.deepEqual(mesh.position, { x: 1, y: 2, z: 3 });
    const fix = mat._uniformValues.get('originFix').value;
    assert.equal(fix[0], 9);
    assert.equal(fix[1], 2);
    assert.equal(fix[2], -5);
  });
});
