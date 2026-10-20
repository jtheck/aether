import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createField } from './field.js';
import { UNIT, getUnitDef } from './unitTypes.js';
import { createWorld, spawn, ORDER } from './world.js';
import { applyDamage, kill } from './damage.js';
import { CHAMPION_KILLS, becomeChampion } from './champion.js';
import { namedUnitHp } from './namedUnit.js';
import { checksum } from './checksum.js';
import { exportWorldCheckpoint, importWorldCheckpoint } from './worldCheckpoint.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function warriorAndFoes(w, n, { hp } = {}) {
  const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp });
  const foes = [];
  for (let i = 0; i < n; i++) {
    foes.push(spawn(w, {
      x: fx.fromInt(4 + i),
      y: 0,
      type: UNIT.ARCHER,
      owner: 1,
      hp: 1,
    }));
  }
  return { war, foes };
}

describe('warrior champion promotion', () => {
  it('promotes on the fifth wounded enemy and keeps the wound', () => {
    const w = createWorld(1);
    const warriorHp = getUnitDef(UNIT.WARRIOR).hp;
    const missing = 20;
    const { war, foes } = warriorAndFoes(w, CHAMPION_KILLS, { hp: warriorHp - missing });
    w.order[war] = ORDER.ATTACK;
    w.targetEntity[war] = foes[0];

    for (let i = 0; i < CHAMPION_KILLS - 1; i++) {
      applyDamage(w, foes[i], 5, war);
      assert.equal(w.alive[foes[i]], 0);
      assert.equal(w.type[war], UNIT.WARRIOR);
      assert.equal(w.kills[war], i + 1);
    }

    applyDamage(w, foes[CHAMPION_KILLS - 1], 5, war);
    const champ = getUnitDef(UNIT.CHAMPION);
    assert.equal(w.type[war], UNIT.CHAMPION);
    assert.equal(w.kills[war], CHAMPION_KILLS);
    assert.equal(w.hp[war], champ.hp - missing);
    assert.equal(w.speed[war], champ.speed);
    assert.equal(w.order[war], ORDER.ATTACK);
    assert.equal(w.targetEntity[war], foes[0]);
  });

  it('ignores allies, sourceless hits, and a dead attacker', () => {
    const w = createWorld(2);
    const { war, foes } = warriorAndFoes(w, 3);
    const ally = spawn(w, { x: fx.fromInt(2), y: 0, type: UNIT.ARCHER, owner: 0, hp: 1 });
    applyDamage(w, ally, 50, war);
    assert.equal(w.alive[ally], 0);
    assert.equal(w.kills[war], 0);

    applyDamage(w, foes[0], 50, -1);
    assert.equal(w.alive[foes[0]], 0);
    assert.equal(w.kills[war], 0);

    kill(w, war);
    applyDamage(w, foes[1], 50, war);
    assert.equal(w.kills[war], 0);
    assert.equal(w.type[war], UNIT.WARRIOR);
  });

  it('does not promote a warrior who is already a champion', () => {
    const w = createWorld(3);
    const { war, foes } = warriorAndFoes(w, 1);
    assert.equal(becomeChampion(w, war), true);
    const hp = w.hp[war];
    applyDamage(w, foes[0], 50, war);
    assert.equal(w.type[war], UNIT.CHAMPION);
    assert.equal(w.hp[war], hp);
    assert.equal(w.kills[war], 0);
  });

  it('scales a named warrior onto the champion health pool', () => {
    const w = createWorld(4);
    const base = getUnitDef(UNIT.WARRIOR).hp;
    const missing = 10;
    const war = spawn(w, {
      x: 0,
      y: 0,
      type: UNIT.WARRIOR,
      owner: 0,
      named: true,
      hp: namedUnitHp(base) - missing,
    });
    const foe = spawn(w, { x: fx.fromInt(3), y: 0, type: UNIT.ARCHER, owner: 1, hp: 1 });
    w.kills[war] = CHAMPION_KILLS - 1;
    applyDamage(w, foe, 5, war);
    assert.equal(w.type[war], UNIT.CHAMPION);
    assert.equal(w.hp[war], namedUnitHp(getUnitDef(UNIT.CHAMPION).hp) - missing);
  });

  it('counts an enemy they wounded when someone else lands the last hit', () => {
    const w = createWorld(6);
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const other = spawn(w, { x: fx.fromInt(1), y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.ARCHER, owner: 1, hp: 30 });
    applyDamage(w, foe, 5, war);
    applyDamage(w, foe, 5, war);
    applyDamage(w, foe, 5, other);
    assert.equal(w.kills[war], 0);
    assert.equal(w.alive[foe], 1);
    applyDamage(w, foe, 50, -1);
    assert.equal(w.alive[foe], 0);
    assert.equal(w.kills[war], 1);
    assert.equal(w.kills[other], 1);
    assert.equal(w.type[war], UNIT.WARRIOR);
  });

  it('does not credit a warrior who has left the fight', () => {
    const w = createWorld(9);
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.ARCHER, owner: 1, hp: 30 });
    applyDamage(w, foe, 5, war);
    w.px[war] = fx.fromFloat(200);
    applyDamage(w, foe, 50, -1);
    assert.equal(w.alive[foe], 0);
    assert.equal(w.kills[war], 0);
    assert.equal(w.type[war], UNIT.WARRIOR);
  });

  it('does not credit a warrior who died before the enemy fell', () => {
    const w = createWorld(7);
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.ARCHER, owner: 1, hp: 30 });
    applyDamage(w, foe, 5, war);
    kill(w, war);
    applyDamage(w, foe, 50, -1);
    assert.equal(w.kills[war], 0);
  });

  it('keeps a partial kill count across a checkpoint', () => {
    const w = createWorld(5);
    const field = openField();
    const { war } = warriorAndFoes(w, 1);
    w.kills[war] = CHAMPION_KILLS - 1;
    const blob = exportWorldCheckpoint(w, field, checksum(w, field));
    const w2 = createWorld(5);
    const field2 = openField();
    importWorldCheckpoint(w2, field2, blob);
    assert.equal(w2.kills[war], CHAMPION_KILLS - 1);
    assert.equal(w2.type[war], UNIT.WARRIOR);

    delete blob.entities.arrays.kills;
    const w3 = createWorld(5);
    importWorldCheckpoint(w3, openField(), blob);
    assert.equal(w3.kills[war], 0);
  });

  it('keeps a wound across a checkpoint until the enemy falls', () => {
    const w = createWorld(8);
    const field = openField();
    const war = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0 });
    const foe = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.ARCHER, owner: 1, hp: 30 });
    applyDamage(w, foe, 5, war);
    const blob = exportWorldCheckpoint(w, field, checksum(w, field));
    const w2 = createWorld(8);
    importWorldCheckpoint(w2, openField(), blob);
    assert.equal(w2.kills[war], 0);
    assert.equal(w2.alive[foe], 1);
    applyDamage(w2, foe, 50, -1);
    assert.equal(w2.kills[war], 1);
    assert.equal(w2.type[war], UNIT.WARRIOR);
  });
});
