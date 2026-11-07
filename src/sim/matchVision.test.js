import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField } from './field.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { entitySeenByOwner, worldPointSeenByOwner } from './matchVision.js';
import { shownHostiles } from './aiStrategy.js';
import { resolveAiStrategy } from './aiStrategy.js';

describe('matchVision', () => {
  it('hides hostiles outside allied sight', () => {
    const field = createField(9, { width: 64, height: 64 });
    const w = createWorld(2);
    w.agoras = [{ owner: 1, founder: 1, x: fx.fromFloat(-80), z: 0 }];
    const vill = spawn(w, { x: fx.fromFloat(-95), y: 0, type: UNIT.VILLAGER, owner: 1 });
    const far = spawn(w, { x: fx.fromFloat(-50), y: 0, type: UNIT.WARRIOR, owner: 0 });
    assert.equal(entitySeenByOwner(w, field, 1, far), false);
    assert.equal(entitySeenByOwner(w, field, 1, vill), true);
  });

  it('shownHostiles ignores unseen yard raiders', () => {
    const field = createField(9, { width: 64, height: 64 });
    const w = createWorld(2);
    w.agoras = [{ owner: 1, founder: 1, x: fx.fromFloat(-80), z: 0 }];
    spawn(w, { x: fx.fromFloat(-95), y: 0, type: UNIT.VILLAGER, owner: 1 });
    spawn(w, { x: fx.fromFloat(-50), y: 0, type: UNIT.WARRIOR, owner: 0 });
    const fair = resolveAiStrategy({ owner: 1, temperament: 'passive', vision: 'fair' });
    const blind = shownHostiles(w, 1, 140, field, fair);
    assert.equal(blind.shown, 0);
    const omni = resolveAiStrategy({ owner: 1, temperament: 'passive', vision: 'omniscient' });
    const seen = shownHostiles(w, 1, 140, field, omni);
    assert.ok(seen.inYard > 0);
  });
});
