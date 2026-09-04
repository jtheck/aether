import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bakedMeshStem } from './bakedAssets.js';

describe('bakedMeshStem', () => {
  it('keeps base models as the filename', () => {
    assert.equal(bakedMeshStem('/assets/models/priest.glb'), 'priest');
  });

  it('namespaces DLC paths so they do not collide with the base bake', () => {
    assert.equal(
      bakedMeshStem('/assets/models/dlc/first_responder/priest-DLC1.glb'),
      'dlc_first_responder_priest-DLC1',
    );
  });
});
