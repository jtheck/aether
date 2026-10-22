import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT } from '../sim/unitTypes.js';
import {
  helpBuildingCards,
  helpPips,
  helpUnitCards,
  helpUnitLayout,
  HELP_PIPS,
  HELP_UNIT_ROWS,
} from './helpRoster.js';

describe('helpPips', () => {
  it('stays empty at zero and full at the maximum', () => {
    assert.equal(helpPips(0, 120), 0);
    assert.equal(helpPips(120, 120), HELP_PIPS);
    assert.equal(helpPips(-1, 120), 0);
  });

  it('rounds a mid value into the middle of the row', () => {
    assert.equal(helpPips(60, 120), 3);
  });
});

describe('help roster cards', () => {
  it('rates a champion as the tough end and an engineer as no damage', () => {
    const cards = helpUnitCards();
    const warrior = cards.find((c) => c.name === 'Warrior');
    const engineer = cards.find((c) => c.name === 'Engineer');
    const dirigible = cards.find((c) => c.name === 'Dirigible');
    const champion = cards.find((c) => c.name === 'Champion');
    assert.equal(champion.stats.find((s) => s.label === 'Health').pips, HELP_PIPS);
    assert.ok(warrior.stats.find((s) => s.label === 'Health').pips < HELP_PIPS);
    assert.match(champion.note, /nearby/i);
    assert.equal(engineer.stats.find((s) => s.label === 'Damage').pips, 0);
    assert.equal(dirigible.stats.find((s) => s.label === 'Speed').pips, HELP_PIPS);
    const brigand = cards.find((c) => c.id === String(UNIT.BRIGAND));
    assert.ok(brigand);
    assert.match(brigand.note, /Temporary/i);
  });

  it('pairs bases with upgrades and leaves a gap for missing upgrades', () => {
    const layout = helpUnitLayout();
    assert.equal(layout.length, HELP_UNIT_ROWS.length * 2);
    const villagerIdx = layout.findIndex((s) => s.kind === 'unit' && s.id === String(UNIT.VILLAGER));
    assert.deepEqual(layout[villagerIdx + 1], { kind: 'unit', id: String(UNIT.BRIGAND) });
    const engineerIdx = layout.findIndex((s) => s.kind === 'unit' && s.id === String(UNIT.ENGINEER));
    assert.deepEqual(layout[engineerIdx + 1], { kind: 'gap' });
    const warriorIdx = layout.findIndex((s) => s.kind === 'unit' && s.id === String(UNIT.WARRIOR));
    assert.deepEqual(layout[warriorIdx + 1], { kind: 'unit', id: String(UNIT.CHAMPION) });
  });

  it('rates the factory as the toughest, longest building', () => {
    const cards = helpBuildingCards();
    const factory = cards.find((c) => c.id === 'factory');
    const farm = cards.find((c) => c.id === 'farm');
    assert.equal(factory.stats.find((s) => s.label === 'Health').pips, HELP_PIPS);
    assert.equal(factory.stats.find((s) => s.label === 'Time').pips, HELP_PIPS);
    assert.ok(farm.stats.find((s) => s.label === 'Health').pips < HELP_PIPS);
  });
});
