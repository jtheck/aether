import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { applyCommands, CMD } from './commands.js';
import { applyDamage } from './damage.js';
import { createField } from './field.js';
import { setTeamAssignments } from './teams.js';
import { UNIT } from './unitTypes.js';
import { createWorld, spawn } from './world.js';
import {
  armStoryProtectFromGarden,
  gardenHasStartCinematic,
  storyProtectsOwner,
} from './storyProtect.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

describe('story protect', () => {
  it('arms from a start reel and ignores a win-only story', () => {
    const w = createWorld(1);
    armStoryProtectFromGarden(w, {
      story: { reels: [{ when: 'start', duration: 4, clips: [{ kind: 'camera' }] }] },
    });
    assert.equal(w.storyProtect, 1);
    assert.equal(gardenHasStartCinematic({
      story: { reels: [{ when: 'win', duration: 3, clips: [{ kind: 'line' }] }] },
    }), false);
    armStoryProtectFromGarden(w, { story: { reels: [] } });
    assert.equal(w.storyProtect, 0);
  });

  it('blocks damage on the party table without becoming a heal or an ally', () => {
    setTeamAssignments([0, 0, 0, 0]);
    const w = createWorld(2);
    w.storyProtect = 1;
    const field = openField();
    const hero = spawn(w, { x: 0, y: 0, type: UNIT.WARRIOR, owner: 0, hp: 40 });
    const pal = spawn(w, { x: fx.fromInt(4), y: 0, type: UNIT.ARCHER, owner: 2, hp: 40 });
    const foe = spawn(w, { x: fx.fromInt(8), y: 0, type: UNIT.WARRIOR, owner: 4, hp: 40 });
    assert.equal(storyProtectsOwner(w, 0), true);
    assert.equal(storyProtectsOwner(w, 2), true);
    assert.equal(storyProtectsOwner(w, 4), false);
    assert.equal(applyDamage(w, hero, 20, foe), false);
    assert.equal(w.hp[hero], 40);
    assert.equal(applyDamage(w, pal, 20, foe), false);
    assert.equal(w.hp[pal], 40);
    assert.equal(applyDamage(w, foe, 15, hero), true);
    assert.equal(w.hp[foe], 25);
    applyCommands(w, field, [{ type: CMD.STORY_PROTECT, on: 0 }]);
    assert.equal(applyDamage(w, hero, 10, foe), true);
    assert.equal(w.hp[hero], 30);
    setTeamAssignments(null);
  });
});
