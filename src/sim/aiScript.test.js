import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn } from './world.js';
import { UNIT } from './unitTypes.js';
import { AI_STANCE } from './aiStrategy.js';
import { resolveAiStrategy } from './aiStrategy.js';
import {
  FREEPLAY_SKIRM_SCRIPT,
  advanceAiScript,
  effectiveAiEntry,
  matchAiWhen,
  mergeAiPatch,
} from './aiScript.js';

describe('aiScript', () => {
  it('merges patch fields onto runtime profile', () => {
    const patch = {};
    mergeAiPatch(patch, { stance: AI_STANCE.DEFEND, heat: 2, guardAt: 0.1 });
    assert.equal(patch.stance, AI_STANCE.DEFEND);
    assert.equal(patch.heat, 2);
    assert.equal(patch.guardAt, 0.1);
  });

  it('fires a once rule after tick threshold', () => {
    const w = createWorld(1);
    w.tick = 0;
    const entry = { owner: 1, script: [{ when: { tickGte: 100 }, once: true, patch: { difficulty: 'hard' } }] };
    const rt = { patch: {}, fired: [], lastFire: [] };
    advanceAiScript(w, entry, rt);
    assert.deepEqual(rt.patch, {});
    w.tick = 100;
    advanceAiScript(w, entry, rt);
    assert.equal(rt.patch.difficulty, 'hard');
    assert.equal(rt.fired[0], 1);
    w.tick = 200;
    advanceAiScript(w, entry, rt);
    assert.equal(rt.patch.difficulty, 'hard');
  });

  it('homeQuiet needs a calm pad', () => {
    const w = createWorld(1);
    w.agoras = [{ owner: 1, founder: 1, x: fx.fromFloat(-80), z: 0, capture: [] }];
    assert.equal(matchAiWhen(w, 1, { homeQuiet: true }), true);
    spawn(w, { x: fx.fromFloat(-79), y: 0, type: UNIT.WARRIOR, owner: 0 });
    assert.equal(matchAiWhen(w, 1, { homeQuiet: true }), false);
  });

  it('reads homeThreat from pad pressure', () => {
    const w = createWorld(1);
    w.agoras = [{ owner: 1, founder: 1, x: fx.fromFloat(-80), z: 0, capture: [] }];
    spawn(w, { x: fx.fromFloat(-79), y: 0, type: UNIT.WARRIOR, owner: 0 });
    assert.equal(matchAiWhen(w, 1, { homeThreat: true }), true);
  });

  it('effective entry drives resolveAiStrategy patches', () => {
    const w = createWorld(1);
    w.tick = FREEPLAY_SKIRM_SCRIPT[0].when.tickGte;
    const entry = { owner: 1, temperament: 'passive', script: FREEPLAY_SKIRM_SCRIPT };
    const rt = { patch: {}, fired: [], lastFire: [] };
    const eff = effectiveAiEntry(w, entry, rt);
    const s = resolveAiStrategy(eff);
    assert.equal(s.stance, AI_STANCE.HOLD);
    assert.ok(s.difficulty >= 1);
  });
});
