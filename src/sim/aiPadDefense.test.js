import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField } from './field.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { CMD } from './commands.js';
import { addResource } from './resources.js';
import { generatePadDefenseCommands } from './aiPadDefense.js';

describe('aiPadDefense', () => {
  it('brigands idle villagers when hostiles skim the yard', () => {
    const field = createField(1, { width: 64, height: 64 });
    const w = createWorld(4);
    w.agoras = [{ owner: 1, founder: 1, x: fx.fromFloat(-80), z: 0 }];
    const vill = spawn(w, { x: fx.fromFloat(-95), y: 0, type: UNIT.VILLAGER, owner: 1 });
    spawn(w, { x: fx.fromFloat(-78), y: 0, type: UNIT.WARRIOR, owner: 0 });
    addResource(w, 1, 'food', 200);
    addResource(w, 1, 'wood', 200);
    w.order[vill] = ORDER.IDLE;
    w.tick = 13;
    const cmds = generatePadDefenseCommands(w, field, { owner: 1, temperament: 'passive' });
    const cast = cmds.find((c) => c.type === CMD.CAST && c.abilityId === 'villager_brigand');
    assert.ok(cast, 'expected villager brigand cast');
    assert.deepEqual(cast.entities, [vill]);
  });
});
