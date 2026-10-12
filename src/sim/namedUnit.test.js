import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { applyGardenPlacements } from './garden.js';
import { buildField } from './field.js';
import { applyTableSilhouette, createFullCellMask, createFullCellRadius } from './tableShape.js';
import {
  NAMED_UNIT_SCALE,
  namedUnitDamage,
  namedUnitHp,
  unitAttackDamage,
  unitMaxHp,
} from './namedUnit.js';

describe('named heroes', () => {
  it('is 29% tougher and hits 29% harder', () => {
    const base = getUnitDef(UNIT.MYCO);
    assert.equal(namedUnitHp(base.hp), Math.round(base.hp * NAMED_UNIT_SCALE));
    assert.equal(namedUnitDamage(base.attackDamage, true), Math.round(base.attackDamage * NAMED_UNIT_SCALE));
    assert.equal(NAMED_UNIT_SCALE, 1.29);

    const w = createWorld(1);
    const plain = spawn(w, { type: UNIT.MYCO, owner: 0 });
    const hero = spawn(w, { type: UNIT.MYCO, owner: 0, named: true, hp: 17 });
    const fresh = spawn(w, { type: UNIT.MYCO, owner: 1, named: true });
    assert.equal(w.named[plain], 0);
    assert.equal(w.hp[plain], base.hp);
    assert.equal(w.named[hero], 1);
    assert.equal(w.hp[hero], 17);
    assert.equal(unitMaxHp(w, hero, base.hp), namedUnitHp(base.hp));
    assert.equal(w.hp[fresh], namedUnitHp(base.hp));
    assert.equal(unitAttackDamage(w, fresh, base.attackDamage), namedUnitDamage(base.attackDamage, true));
    assert.equal(unitAttackDamage(w, plain, base.attackDamage), base.attackDamage);
  });

  it('marks a named garden unit and leaves a blank one ordinary', () => {
    const field = buildField(3, { width: 32, height: 32 });
    applyTableSilhouette(field, {
      cellSize: 16,
      cellMask: createFullCellMask(32, 32, 16),
      cellRadius: createFullCellRadius(32, 32, 16, 0),
    });
    const world = createWorld(3);
    applyGardenPlacements(world, field, {
      units: [
        { owner: 0, type: UNIT.MYCO, tx: 4, tz: 6, name: 'Stumpey' },
        { owner: 0, type: UNIT.MYCO, tx: 8, tz: 6, name: '' },
      ],
    });
    const base = getUnitDef(UNIT.MYCO);
    assert.equal(world.named[0], 1);
    assert.equal(world.hp[0], namedUnitHp(base.hp));
    assert.equal(world.named[1], 0);
    assert.equal(world.hp[1], base.hp);
  });
});
