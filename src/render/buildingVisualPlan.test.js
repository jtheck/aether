import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planBuildingVisuals } from './buildings.js';

describe('planBuildingVisuals', () => {
  it('keeps the previous building when a new one is placed', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [
        { key: 'camp:1.00:2.00', type: 'camp' },
        { key: 'camp:8.00:2.00', type: 'camp' },
      ],
    );
    assert.deepEqual(plan.keep, ['camp:1.00:2.00']);
    assert.deepEqual(plan.create, ['camp:8.00:2.00']);
    assert.deepEqual(plan.moved, []);
    assert.deepEqual(plan.fall, []);
  });

  it('does not collapse a standing building while the new model is still loading', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      new Set(['farm:8.00:2.00']),
    );
    assert.deepEqual(plan.keep, ['camp:1.00:2.00']);
    assert.deepEqual(plan.fall, []);
    assert.deepEqual(plan.create, []);
  });

  it('does not collapse a building that is waiting on its own model', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [{ key: 'farm:8.00:2.00', type: 'farm' }],
      new Set(['camp:1.00:2.00']),
    );
    assert.deepEqual(plan.fall, []);
    assert.deepEqual(plan.create, ['farm:8.00:2.00']);
  });

  it('follows a move instead of collapsing the old spot', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [{ key: 'camp:8.00:2.00', type: 'camp' }],
    );
    assert.deepEqual(plan.moved, [{ from: 'camp:1.00:2.00', to: 'camp:8.00:2.00' }]);
    assert.deepEqual(plan.fall, []);
    assert.deepEqual(plan.create, []);
  });

  it('collapses a building that is actually gone', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [],
    );
    assert.deepEqual(plan.fall, ['camp:1.00:2.00']);
  });

  it('does not treat a different type as the building that moved', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [{ key: 'farm:8.00:2.00', type: 'farm' }],
    );
    assert.deepEqual(plan.fall, ['camp:1.00:2.00']);
    assert.deepEqual(plan.create, ['farm:8.00:2.00']);
    assert.deepEqual(plan.moved, []);
  });

  it('keeps a building that comes back instead of leaving it collapsed', () => {
    const plan = planBuildingVisuals(
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
      [{ key: 'camp:1.00:2.00', type: 'camp' }],
    );
    assert.deepEqual(plan.keep, ['camp:1.00:2.00']);
    assert.deepEqual(plan.fall, []);
  });
});
