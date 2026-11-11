import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { CMD } from './commands.js';
import {
  AI_CONTROL_GROUP_COUNT,
  AI_DIFFICULTY,
  AI_PATH,
  AI_ROAM_GROUP_SLOTS,
  AI_STANCE,
  aiControlGroup,
  aiPlayersFromOwnerIntents,
  excludeHumanAiPlayers,
  generateAiCommands,
  mergeAiPlayers,
  parseAiDifficulty,
  replyCount,
  resolveAiStrategy,
  shownHostiles,
} from './ai.js';

describe('resolveAiStrategy', () => {
  it('keeps passive as the eco hold partner', () => {
    const s = resolveAiStrategy({ owner: 1, temperament: 'passive' });
    assert.equal(s.economy, true);
    assert.equal(s.path, AI_PATH.ECO);
    assert.equal(s.stance, AI_STANCE.HOLD);
    assert.equal(s.heat, 0);
    assert.equal(s.difficulty, AI_DIFFICULTY.EASY);
  });

  it('puts army-path seats on defend, not a map-wide push', () => {
    for (const name of ['steady', 'aggressive', 'reckless']) {
      const s = resolveAiStrategy({ owner: 1, temperament: name });
      assert.equal(s.economy, true);
      assert.equal(s.path, AI_PATH.ARMY);
      assert.equal(s.stance, AI_STANCE.DEFEND);
    }
  });

  it('leans cautious into tech after the eco baseline', () => {
    const s = resolveAiStrategy({ owner: 1, temperament: 'cautious' });
    assert.equal(s.path, AI_PATH.TECH);
    assert.equal(s.stance, AI_STANCE.DEFEND);
  });

  it('lets an entry override economy and stance', () => {
    const s = resolveAiStrategy({
      owner: 2,
      temperament: 'steady',
      economy: false,
      stance: AI_STANCE.ATTACK,
    });
    assert.equal(s.economy, false);
    assert.equal(s.stance, AI_STANCE.ATTACK);
  });

  it('lets difficulty split from temperament', () => {
    const s = resolveAiStrategy({
      owner: 1,
      temperament: 'passive',
      difficulty: 'expert',
    });
    assert.equal(s.heat, 0);
    assert.equal(s.difficulty, AI_DIFFICULTY.EXPERT);
    assert.equal(parseAiDifficulty('hard'), AI_DIFFICULTY.HARD);
  });

  it('accepts live patches on heat and reactInterval', () => {
    const s = resolveAiStrategy({
      owner: 1,
      temperament: 'passive',
      heat: 3,
      guardAt: 0.05,
      reactInterval: 20,
    });
    assert.equal(s.heat, 3);
    assert.equal(s.guardAt, 0.05);
    assert.equal(s.reactInterval, 20);
  });
});

function seedYard(aiX, foeX) {
  const w = createWorld(1);
  w.agoras = [{ owner: 1, x: fx.fromFloat(-80), z: 0 }];
  spawn(w, { x: fx.fromFloat(aiX), y: 0, type: UNIT.WARRIOR, owner: 1 });
  spawn(w, { x: fx.fromFloat(foeX), y: 0, type: UNIT.WARRIOR, owner: 0 });
  return w;
}

function firstAttackMove(w, entry) {
  for (let t = 0; t < 80; t++) {
    w.tick = t;
    const cmds = generateAiCommands(w, entry);
    const move = cmds.find((c) => c.type === CMD.ATTACK_MOVE);
    if (move) return move;
  }
  return null;
}

describe('army stance', () => {
  it('hold never F2s, even when a foe is in the yard', () => {
    const w = seedYard(-80, -70);
    assert.equal(
      firstAttackMove(w, { owner: 1, temperament: 'passive' }),
      null,
    );
  });

  it('defend ignores a foe across the map', () => {
    const w = seedYard(-80, 80);
    assert.equal(
      firstAttackMove(w, { owner: 1, temperament: 'steady' }),
      null,
    );
  });

  it('defend intercepts a foe in the agora yard', () => {
    const w = seedYard(-80, -40);
    const move = firstAttackMove(w, { owner: 1, temperament: 'steady' });
    assert.ok(move);
    assert.equal(move.entities.length, 1);
  });

  it('attack still pushes when opted in (stress)', () => {
    const w = seedYard(-80, 80);
    const move = firstAttackMove(w, {
      owner: 1,
      temperament: 'steady',
      stance: AI_STANCE.ATTACK,
    });
    assert.ok(move);
  });
});

function pad(owner, x, extra = {}) {
  return {
    owner,
    founder: owner,
    x: fx.fromFloat(x),
    z: 0,
    progress: 0,
    tug: 0,
    capturer: -1,
    contested: 0,
    captured: 0,
    phase: 0,
    ...extra,
  };
}

function seedCapture(opts) {
  const w = createWorld(1);
  w.agoraOccupyEndsMatch = 1;
  w.agoras = [
    pad(1, -80, opts.home ?? {}),
    pad(0, 80, opts.enemy ?? {}),
  ];
  spawn(w, { x: fx.fromFloat(opts.aiX ?? -80), y: 0, type: UNIT.WARRIOR, owner: 1 });
  spawn(w, { x: fx.fromFloat(opts.foeX ?? -80), y: 0, type: UNIT.WARRIOR, owner: 0 });
  if (opts.order != null) w.order[0] = opts.order;
  return w;
}

describe('agora capture gradient', () => {
  it('passive still ignores a filling lock bar', () => {
    const w = seedCapture({ home: { progress: 280 }, foeX: -80 });
    assert.equal(firstAttackMove(w, { owner: 1, temperament: 'passive' }), null);
  });

  it('cautious waits until the bar is clearly filling', () => {
    const quiet = seedCapture({ home: { progress: 40 }, foeX: -80 });
    quiet.order[0] = quiet.ORDER.ATTACK_MOVE;
    assert.equal(firstAttackMove(quiet, { owner: 1, temperament: 'cautious' }), null);

    const loud = seedCapture({ home: { progress: 140 }, foeX: -80 });
    loud.order[0] = loud.ORDER.ATTACK_MOVE;
    assert.ok(firstAttackMove(loud, { owner: 1, temperament: 'cautious' }));
  });

  it('steady comes home once any real capture starts', () => {
    const w = seedCapture({ home: { progress: 40 }, foeX: -80 });
    w.order[0] = w.ORDER.ATTACK_MOVE;
    assert.ok(firstAttackMove(w, { owner: 1, temperament: 'steady' }));
  });

  it('aggressive piles onto an enemy pad that is already being taken', () => {
    const w = seedCapture({
      foeX: 80,
      enemy: { progress: 80 },
    });
    const move = firstAttackMove(w, { owner: 1, temperament: 'aggressive' });
    assert.ok(move);
    assert.ok(fx.toFloat(move.tx[0]) > 40);
  });

  it('steady will not march on a quiet enemy agora', () => {
    const w = seedCapture({ foeX: 80 });
    for (let t = 0; t < 800; t++) {
      w.tick = t;
      const move = generateAiCommands(w, { owner: 1, temperament: 'steady' })
        .find((c) => c.type === CMD.ATTACK_MOVE);
      assert.equal(move, undefined);
    }
  });

  it('aggressive and reckless sometimes seek a quiet enemy agora', () => {
    const marches = (temperament) => {
      const w = seedCapture({ foeX: 80 });
      let n = 0;
      let held = 0;
      for (let t = 0; t < 800; t++) {
        w.tick = t;
        const move = generateAiCommands(w, { owner: 1, temperament })
          .find((c) => c.type === CMD.ATTACK_MOVE);
        if (move && fx.toFloat(move.tx[0]) > 40) n++;
        else held++;
      }
      return { n, held };
    };
    const aggressive = marches('aggressive');
    const reckless = marches('reckless');
    assert.ok(aggressive.n > 0 && aggressive.held > 0);
    assert.ok(reckless.n > 0 && reckless.held > 0);

    const a = seedCapture({ foeX: 80 });
    const b = seedCapture({ foeX: 80 });
    for (let t = 0; t < 800; t++) {
      a.tick = t;
      b.tick = t;
      const ma = generateAiCommands(a, { owner: 1, temperament: 'reckless' });
      const mb = generateAiCommands(b, { owner: 1, temperament: 'reckless' });
      assert.equal(ma.length, mb.length);
      if (ma[0]) assert.equal(ma[0].tx[0], mb[0].tx[0]);
    }
  });

  it('keeps one veteran control group roaming and leaves the later bands home', () => {
    assert.equal(AI_CONTROL_GROUP_COUNT, 6);
    assert.equal(AI_ROAM_GROUP_SLOTS, 1);
    const w = seedCapture({ foeX: 80 });
    for (let i = 0; i < 5; i++) {
      spawn(w, { x: fx.fromFloat(-80), y: 0, type: UNIT.WARRIOR, owner: 1 });
    }
    const patrol = aiControlGroup(w, 1, 0, 4);
    const reserve = aiControlGroup(w, 1, 1, 4);
    assert.deepEqual(patrol, [0, 2, 3, 4]);
    assert.deepEqual(reserve, [5, 6]);
    assert.equal(aiControlGroup(w, 1, 5, 4).length, 0);
    assert.equal(aiControlGroup(w, 1, 6, 4).length, 0);

    w.alive[0] = 0;
    assert.deepEqual(aiControlGroup(w, 1, 0, 4), [2, 3, 4, 5]);
    w.alive[0] = 1;

    const patrolSet = new Set(patrol);
    let orders = 0;
    for (let t = 0; t < 800; t++) {
      w.tick = t;
      const move = generateAiCommands(w, { owner: 1, temperament: 'aggressive' })
        .find((c) => c.type === CMD.ATTACK_MOVE);
      if (!move) continue;
      orders++;
      assert.deepEqual(move.entities, patrol);
      for (let k = 0; k < move.entities.length; k++) {
        assert.equal(patrolSet.has(move.entities[k]), true);
        assert.equal(reserve.includes(move.entities[k]), false);
      }
    }
    assert.ok(orders > 0);
  });
});

describe('garden intent', () => {
  it('turns a painted personality into a fair player and skips a seated human', () => {
    const painted = aiPlayersFromOwnerIntents([
      [2, 'reckless'],
      [0, 'aggressive'],
      [2, 'passive'],
      [9, 'nope'],
    ]);
    assert.equal(painted.length, 2);
    assert.equal(painted[0].owner, 2);
    assert.equal(painted[0].temperament, 'reckless');
    assert.equal(painted[0].vision, 'fair');
    assert.equal(painted[0].script, undefined);
    const merged = excludeHumanAiPlayers(
      mergeAiPlayers([{ owner: 1, temperament: 'steady' }], painted),
      [0],
    );
    assert.deepEqual(merged.map((entry) => entry.owner), [1, 2]);
    assert.equal(merged[0].temperament, 'steady');
  });
});

describe('tit for tat', () => {
  it('replyCount overpays with heat, never past what we have', () => {
    assert.equal(replyCount(2, 8, 0), 0);
    assert.equal(replyCount(2, 8, 1), 2);
    assert.equal(replyCount(2, 8, 2), 3);
    assert.equal(replyCount(2, 8, 3), 4);
    assert.equal(replyCount(2, 8, 4), 6);
    assert.equal(replyCount(2, 2, 4), 2);
    assert.equal(replyCount(0, 8, 4), 0);
  });

  it('sitting on their quiet pad is not a show', () => {
    const w = seedCapture({ foeX: 80 });
    const shown = shownHostiles(w, 1, 140);
    assert.equal(shown.onHomePad, 0);
    assert.equal(shown.onEnemyPad, 0);
    assert.equal(shown.padPlay, false);
    assert.equal(shown.shown, 0);
  });

  it('answers the number on the pad, louder with heat', () => {
    const w = createWorld(1);
    w.agoras = [pad(1, -80), pad(0, 80)];
    for (let i = 0; i < 8; i++) {
      spawn(w, { x: fx.fromFloat(-96 - i), y: 0, type: UNIT.WARRIOR, owner: 1 });
    }
    spawn(w, { x: fx.fromFloat(-82), y: 0, type: UNIT.WARRIOR, owner: 0 });
    spawn(w, { x: fx.fromFloat(-78), y: 0, type: UNIT.WARRIOR, owner: 0 });

    const shown = shownHostiles(w, 1, 70);
    assert.equal(shown.onHomePad, 2);
    assert.equal(shown.shown, 2);

    const cautious = firstAttackMove(w, { owner: 1, temperament: 'cautious' });
    assert.ok(cautious);
    assert.equal(cautious.entities.length, 2);

    const reckless = firstAttackMove(w, { owner: 1, temperament: 'reckless' });
    assert.ok(reckless);
    assert.equal(reckless.entities.length, 6);
  });
});
