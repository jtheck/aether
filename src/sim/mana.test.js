import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';
import { LIGHTNING_COOLDOWN, takeLightningUpdates } from './lightning.js';
import { HOLY_ARMOR_COOLDOWN } from './holyArmor.js';
import { SPORE_BLOOM_COOLDOWN } from './sporeBloom.js';
import { FROG_PLAGUE_COOLDOWN } from './frogs.js';
import {
  CAST_GCD,
  MANA_BANK,
  MANA_CHARGE,
  MANA_MAX,
  WARLOCK_FIREBALL_PERIOD,
  canCastAbility,
  manaPeriodForType,
  manaReadyCount,
  tickMana,
} from './mana.js';

describe('mana bank', () => {
  it('starts casters with three ready spells', () => {
    const w = createWorld(1);
    const wiz = spawn(w, { type: UNIT.WIZARD });
    const vill = spawn(w, { type: UNIT.VILLAGER, x: fx.fromInt(4) });
    assert.equal(w.mana[wiz], MANA_MAX);
    assert.equal(manaReadyCount(w.mana[wiz]), MANA_BANK);
    assert.equal(w.mana[vill], 0);
    assert.equal(canCastAbility(w, wiz), true);
  });

  it('matches ability cooldown periods', () => {
    assert.equal(manaPeriodForType(UNIT.WARLOCK), WARLOCK_FIREBALL_PERIOD);
    assert.equal(manaPeriodForType(UNIT.PRIEST), HOLY_ARMOR_COOLDOWN);
    assert.equal(manaPeriodForType(UNIT.MYCO), SPORE_BLOOM_COOLDOWN);
    assert.equal(manaPeriodForType(UNIT.SHAMAN), FROG_PLAGUE_COOLDOWN);
    assert.equal(manaPeriodForType(UNIT.WIZARD), LIGHTNING_COOLDOWN);
    assert.equal(manaPeriodForType(UNIT.VILLAGER), 0);
  });

  it('banks three casts and blocks a fourth until regen', () => {
    const field = createField(1);
    const w = createWorld(2);
    const wizard = spawn(w, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
    spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 1 });
    const cast = {
      type: CMD.CAST,
      entities: [wizard],
      tx: fx.fromInt(8),
      ty: 0,
    };
    for (let n = 0; n < MANA_BANK; n++) {
      while (w.abilityCd[wizard] > 0) step(w, field, []);
      step(w, field, [cast]);
      takeLightningUpdates(w);
    }
    assert.equal(manaReadyCount(w.mana[wizard]), 0);
    while (w.abilityCd[wizard] > 0) step(w, field, []);
    step(w, field, [cast]);
    assert.equal(takeLightningUpdates(w), null, 'empty bank cannot recast');
    assert.equal(manaReadyCount(w.mana[wizard]), 0);
  });

  it('regens one charge over the old cooldown; myco spirit is faster', () => {
    const field = createField(1);
    const plain = createWorld(3);
    const wiz = spawn(plain, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
    plain.mana[wiz] = 0;
    plain.manaAcc[wiz] = 0;
    for (let t = 0; t < LIGHTNING_COOLDOWN; t++) step(plain, field, []);
    assert.equal(manaReadyCount(plain.mana[wiz]), 1);

    const boosted = createWorld(4);
    const bwiz = spawn(boosted, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
    spawn(boosted, { x: fx.fromInt(4), y: 0, type: UNIT.MYCO, owner: 0 });
    boosted.mana[bwiz] = 0;
    boosted.manaAcc[bwiz] = 0;
    const faster = Math.ceil((LIGHTNING_COOLDOWN * 5) / 6);
    for (let t = 0; t < faster; t++) step(boosted, field, []);
    assert.equal(manaReadyCount(boosted.mana[bwiz]), 1, 'spirit reaches a charge sooner');

    const control = createWorld(5);
    const cwiz = spawn(control, { x: 0, y: 0, type: UNIT.WIZARD, owner: 0 });
    control.mana[cwiz] = 0;
    control.manaAcc[cwiz] = 0;
    for (let t = 0; t < faster; t++) step(control, field, []);
    assert.equal(manaReadyCount(control.mana[cwiz]), 0, 'no spirit yet at the boosted time');
  });

  it('does not spirit-boost a hostile caster', () => {
    const field = createField(1);
    const w = createWorld(6);
    const ally = spawn(w, { x: fx.fromInt(-3), y: 0, type: UNIT.WIZARD, owner: 0 });
    const foe = spawn(w, { x: 0, y: 0, type: UNIT.WIZARD, owner: 1 });
    spawn(w, { x: fx.fromInt(3), y: 0, type: UNIT.MYCO, owner: 0 });
    w.mana[ally] = 0;
    w.manaAcc[ally] = 0;
    w.mana[foe] = 0;
    w.manaAcc[foe] = 0;
    step(w, field, []);
    assert.equal(w.manaAcc[ally], 6, 'nearby allied caster gets spirit');
    assert.equal(w.manaAcc[foe], 5, 'hostile uses base regen');
    assert.ok(CAST_GCD > 0);
    assert.equal(MANA_CHARGE, 100);
    assert.ok(typeof tickMana === 'function');
  });
});
