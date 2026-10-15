import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { combatSystem } from './combat.js';
import { createField } from './field.js';
import { MANA_MAX } from './mana.js';
import { PRIEST_HEAL_AMOUNT, priestHealLandsMost, takePriestHealUpdates } from './priestHeal.js';
import { isAlly, setTeamAssignments } from './teams.js';
import { getUnitDef, UNIT } from './unitTypes.js';
import { createWorld, lockAttackFocus, ORDER, spawn } from './world.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function tick(w, field) {
  combatSystem(w, field);
  w.tick++;
}

describe('priest heal', () => {
  it('uses a flat half of a 50 HP unit, and only when most of it lands', () => {
    assert.equal(PRIEST_HEAL_AMOUNT, 25);
    assert.equal(priestHealLandsMost(18), false);
    assert.equal(priestHealLandsMost(19), true);
    assert.equal(priestHealLandsMost(25), true);
  });

  it('tops off a nearby ally while idle and spends the attack cooldown', () => {
    const w = createWorld(40);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const ally = spawn(w, {
      x: fx.fromInt(8),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: getUnitDef(UNIT.WARRIOR).hp - 4,
    });
    const mana = w.mana[priest];
    tick(w, field);
    assert.equal(w.hp[ally], getUnitDef(UNIT.WARRIOR).hp);
    assert.equal(w.order[priest], ORDER.IDLE);
    assert.equal(w.attackCd[priest], getUnitDef(UNIT.PRIEST).attackCooldown - 1);
    assert.equal(w.abilityCd[priest], 0);
    assert.equal(w.mana[priest], mana);
    assert.equal(mana, MANA_MAX);
    assert.equal(w.projectiles.activeCount, 0);
    const fxPatch = takePriestHealUpdates(w);
    assert.equal(fxPatch.count, 1);
    assert.equal(takePriestHealUpdates(w), null);
  });

  it('heals instead of smiting when an ally can take most of the pulse', () => {
    const w = createWorld(41);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const ally = spawn(w, {
      x: fx.fromInt(6),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: getUnitDef(UNIT.WARRIOR).hp - 19,
    });
    const foe = spawn(w, {
      x: fx.fromInt(12),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
      hp: 80,
    });
    w.order[priest] = ORDER.ATTACK;
    w.targetEntity[priest] = foe;
    lockAttackFocus(w, priest);
    tick(w, field);
    assert.equal(w.hp[ally], getUnitDef(UNIT.WARRIOR).hp);
    assert.equal(w.hp[foe], 80);
    assert.equal(w.projectiles.activeCount, 0);
    assert.equal(w.order[priest], ORDER.ATTACK);
    assert.equal(w.targetEntity[priest], foe);
  });

  it('smites when the nearby ally would waste most of the heal', () => {
    const w = createWorld(42);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const ally = spawn(w, {
      x: fx.fromInt(6),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: getUnitDef(UNIT.WARRIOR).hp - 18,
    });
    const foe = spawn(w, {
      x: fx.fromInt(12),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    w.order[priest] = ORDER.ATTACK;
    w.targetEntity[priest] = foe;
    lockAttackFocus(w, priest);
    const allyHp = w.hp[ally];
    tick(w, field);
    assert.equal(w.hp[ally], allyHp);
    assert.equal(w.projectiles.activeCount, 1);
    assert.equal(w.attackCd[priest], getUnitDef(UNIT.PRIEST).attackCooldown - 1);
  });

  it('does not heal mechanicals, idle or in a fight', () => {
    const w = createWorld(43);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const wagon = spawn(w, {
      x: fx.fromInt(4),
      y: 0,
      type: UNIT.WAGON,
      owner: 0,
      hp: 20,
    });
    tick(w, field);
    assert.equal(w.hp[wagon], 20);
    assert.equal(w.attackCd[priest], 0);

    const foe = spawn(w, {
      x: fx.fromInt(12),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    w.order[priest] = ORDER.ATTACK;
    w.targetEntity[priest] = foe;
    lockAttackFocus(w, priest);
    tick(w, field);
    assert.equal(w.hp[wagon], 20);
    assert.equal(w.projectiles.activeCount, 1);
  });

  it('will not heal again until the attack cooldown is ready', () => {
    const w = createWorld(44);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const ally = spawn(w, {
      x: fx.fromInt(8),
      y: 0,
      type: UNIT.ARCHER,
      owner: 0,
      hp: getUnitDef(UNIT.ARCHER).hp - 40,
    });
    tick(w, field);
    const after = w.hp[ally];
    assert.equal(after, getUnitDef(UNIT.ARCHER).hp - 40 + PRIEST_HEAL_AMOUNT);
    assert.ok(w.attackCd[priest] > 0);
    tick(w, field);
    assert.equal(w.hp[ally], after);
  });

  it('does not heal across the battlefield or while still closing to smite', () => {
    const w = createWorld(48);
    const field = openField();
    const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const ally = spawn(w, {
      x: fx.fromInt(30),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: 40,
    });
    const foe = spawn(w, {
      x: fx.fromInt(12),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
      hp: 80,
    });
    w.order[priest] = ORDER.ATTACK;
    w.targetEntity[priest] = foe;
    lockAttackFocus(w, priest);
    tick(w, field);
    assert.equal(w.hp[ally], 40, 'smite range is not heal range');
    assert.equal(w.hp[foe], 80);
    assert.equal(w.projectiles.activeCount, 1);

    const chasing = createWorld(49);
    const priest2 = spawn(chasing, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
    const close = spawn(chasing, {
      x: fx.fromInt(6),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: 40,
    });
    const farFoe = spawn(chasing, {
      x: fx.fromInt(80),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 1,
    });
    chasing.order[priest2] = ORDER.ATTACK;
    chasing.targetEntity[priest2] = farFoe;
    lockAttackFocus(chasing, priest2);
    tick(chasing, field);
    assert.equal(chasing.hp[close], 40, 'no heal until a smite would fire');
    assert.equal(chasing.projectiles.activeCount, 0);
    assert.equal(chasing.attackCd[priest2], 0);
  });

  it('ignores allies outside the huddle and will top itself off while idle', () => {
    const w = createWorld(47);
    const field = openField();
    const priest = spawn(w, {
      x: 0,
      y: 0,
      type: UNIT.PRIEST,
      owner: 0,
      hp: getUnitDef(UNIT.PRIEST).hp - 3,
    });
    const far = spawn(w, {
      x: fx.fromInt(50),
      y: 0,
      type: UNIT.WIZARD,
      owner: 0,
      hp: 10,
    });
    tick(w, field);
    assert.equal(w.hp[far], 10);
    assert.equal(w.hp[priest], getUnitDef(UNIT.PRIEST).hp);
  });

  it('prefers the ally who can absorb more of the pulse', () => {
    const w = createWorld(45);
    const field = openField();
    const priest = spawn(w, {
      x: 0,
      y: 0,
      type: UNIT.PRIEST,
      owner: 0,
      hp: getUnitDef(UNIT.PRIEST).hp - 13,
    });
    const worse = spawn(w, {
      x: fx.fromInt(4),
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      hp: getUnitDef(UNIT.WARRIOR).hp - 13,
    });
    const better = spawn(w, {
      x: fx.fromInt(10),
      y: 0,
      type: UNIT.MONK,
      owner: 0,
      hp: getUnitDef(UNIT.MONK).hp - 40,
    });
    const worseHp = w.hp[worse];
    const priestHp = w.hp[priest];
    tick(w, field);
    assert.equal(w.hp[better], getUnitDef(UNIT.MONK).hp - 40 + PRIEST_HEAL_AMOUNT);
    assert.equal(w.hp[worse], worseHp);
    assert.equal(w.hp[priest], priestHp);
  });

  it('heals a teammate on another seat', () => {
    setTeamAssignments([0, 0]);
    try {
      assert.equal(isAlly(0, 1), true);
      const w = createWorld(46);
      const field = openField();
      const priest = spawn(w, { x: 0, y: 0, type: UNIT.PRIEST, owner: 0 });
      const ally = spawn(w, {
        x: fx.fromInt(8),
        y: 0,
        type: UNIT.WARRIOR,
        owner: 1,
        hp: 40,
      });
      tick(w, field);
      assert.equal(w.hp[ally], 40 + PRIEST_HEAL_AMOUNT);
      assert.ok(w.attackCd[priest] > 0);
    } finally {
      setTeamAssignments(null);
    }
  });
});
