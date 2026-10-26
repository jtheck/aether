import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, spawn } from './world.js';
import { applyDamage, kill } from './damage.js';
import { takeDeathNotes } from './deathFlee.js';
import { UNIT } from './unitTypes.js';
import * as fx from './fixed.js';

describe('death flee heading', () => {
  it('runs a villager away from whoever killed them', () => {
    const w = createWorld(1);
    const foe = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 1 });
    const vil = spawn(w, { x: fx.fromInt(6), y: 0, type: UNIT.VILLAGER, owner: 0 });
    applyDamage(w, vil, 999, foe);
    const notes = takeDeathNotes(w);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, vil);
    assert.ok(notes[0].x > 0.9);
    assert.ok(Math.abs(notes[0].z) < 0.1);
    assert.equal(takeDeathNotes(w), null);
  });

  it('uses the unit they were fighting when the killing blow has no source', () => {
    const w = createWorld(1);
    const foe = spawn(w, { x: 0, y: fx.fromInt(5), type: UNIT.WARRIOR, owner: 1 });
    const brig = spawn(w, { x: 0, y: 0, type: UNIT.BRIGAND, owner: 0 });
    w.targetEntity[brig] = foe;
    kill(w, brig);
    const notes = takeDeathNotes(w);
    assert.equal(notes.length, 1);
    assert.ok(notes[0].z < -0.9);
    assert.ok(Math.abs(notes[0].x) < 0.1);
  });

  it('falls back to opposite the way they were facing', () => {
    const w = createWorld(1);
    const vil = spawn(w, {
      x: 0,
      y: 0,
      type: UNIT.VILLAGER,
      owner: 0,
      faceX: -fx.ONE,
      faceY: 0,
    });
    kill(w, vil);
    const notes = takeDeathNotes(w);
    assert.ok(notes[0].x > 0.9);
    assert.ok(Math.abs(notes[0].z) < 0.1);
  });

  it('does not record a heading for a dirigible', () => {
    const w = createWorld(1);
    const ship = spawn(w, { x: 0, y: 0, type: UNIT.DIRIGIBLE, owner: 0 });
    kill(w, ship);
    assert.equal(takeDeathNotes(w), null);
  });
});
