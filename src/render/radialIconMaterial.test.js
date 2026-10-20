import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRadialIconMaterial, syncRadialIconShade } from './radialIconMaterial.js';
import { RADIAL_HUD_BLEND_ALPHA } from './radialPose.js';

describe('radial icon material', () => {
  it('draws both sides and writes depth while staying blendable', () => {
    const mat = createRadialIconMaterial({
      name: 'Yellow.005',
      baseColorFactor: [0.2, 0.4, 0.6, 1],
    });
    assert.equal(mat.backFaceCulling, false);
    assert.equal(mat.depthWrite, true);
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
    syncRadialIconShade(null);
  });
});
