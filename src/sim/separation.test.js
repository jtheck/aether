import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { createWorld, spawn, ORDER } from './world.js';
import { UNIT } from './unitTypes.js';
import { step } from './step.js';
import { CMD } from './commands.js';
import { createField } from './field.js';

function openField() {
  const field = createField(1);
  field.pass.fill(1);
  return field;
}

function minPairDist(w, ids) {
  let best = Infinity;
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const i = ids[a];
      const j = ids[b];
      const d = fx.toFloat(fx.len(w.px[j] - w.px[i], w.py[j] - w.py[i]));
      if (d < best) best = d;
    }
  }
  return best;
}

/** Right-click is ATTACK_MOVE — standing holders must soft-unstack (not IDLE-only). */
function attackMoveHoldersUnstack() {
  const field = openField();
  const w = createWorld(90);
  const ids = [];
  const pileX = fx.fromInt(10);
  const pileY = fx.fromInt(10);
  for (let k = 0; k < 8; k++) {
    const i = spawn(w, {
      x: pileX,
      y: pileY,
      type: UNIT.WARRIOR,
      owner: 0,
    });
    w.order[i] = ORDER.ATTACK_MOVE;
    w.hasTarget[i] = 1;
    w.tx[i] = pileX;
    w.ty[i] = pileY;
    w.navDestX[i] = pileX;
    w.navDestY[i] = pileY;
    w.navWpCount[i] = 0;
    w.vx[i] = 0;
    w.vy[i] = 0;
    ids.push(i);
  }

  assert.equal(minPairDist(w, ids), 0, 'start stacked on one pixel');

  for (let t = 0; t < 90; t++) step(w, field);

  // Slack deadzone settles below full spacing — still far from pixel-stack.
  const min = minPairDist(w, ids);
  assert.ok(min > 1.4, `ATTACK_MOVE holders should soft-separate (min=${min.toFixed(2)})`);
  for (const i of ids) {
    assert.equal(w.order[i], ORDER.IDLE, 'arrived attack-move settles to idle');
    assert.equal(w.navWpCount[i], 0, 'not re-pathing from separation');
    assert.equal(w.hasTarget[i], 0, 'destination cleared');
  }
}

/** Group move to one click — organic jitter + soft bloom, not a parade grid. */
function sharedDestinationBlooms() {
  const field = openField();
  const w = createWorld(91);
  const ids = [];
  for (let k = 0; k < 6; k++) {
    ids.push(
      spawn(w, {
        x: fx.fromInt(-20 + k * 3),
        y: fx.fromInt(0),
        type: UNIT.WARRIOR,
        owner: 0,
      }),
    );
  }

  const destX = fx.fromInt(40);
  const destY = fx.fromInt(0);
  step(w, field, [
    {
      type: CMD.ATTACK_MOVE,
      entities: ids,
      tx: ids.map(() => destX),
      ty: ids.map(() => destY),
    },
  ]);

  for (let t = 0; t < 400; t++) step(w, field);

  for (const i of ids) {
    assert.equal(w.navWpCount[i], 0, `unit ${i} finished pathing`);
    const d = fx.toFloat(fx.len(w.px[i] - destX, w.py[i] - destY));
    assert.ok(d < 8, `unit ${i} stayed near the click (d=${d.toFixed(2)})`);
  }

  const min = minPairDist(w, ids);
  assert.ok(min > 1.2, `arrivals must not stay pixel-stacked (min=${min.toFixed(2)})`);
}

/** Pathing units keep ownership of the route — sep must not yank them off-goal mid-march. */
function pathFollowWinsWhileMoving() {
  const field = openField();
  const w = createWorld(92);
  const a = spawn(w, {
    x: fx.fromInt(0),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const b = spawn(w, {
    x: fx.fromInt(1),
    y: fx.fromInt(0),
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const destX = fx.fromInt(80);
  const destY = fx.fromInt(0);
  step(w, field, [
    {
      type: CMD.MOVE,
      entities: [a, b],
      tx: [destX, destX],
      ty: [destY, destY],
    },
  ]);

  let sawPath = false;
  for (let t = 0; t < 40; t++) {
    step(w, field);
    if (w.navWpCount[a] > 0 || w.navWpCount[b] > 0) sawPath = true;
  }
  assert.ok(sawPath, 'units received a path');
  // Both should still be progressing toward the far dest, not parked in a blob.
  assert.ok(fx.toFloat(w.px[a]) > 2 || fx.toFloat(w.px[b]) > 2, 'making forward progress');
}

/** Overpacked standers must stop rippling once past the slack deadzone. */
function densePackSettles() {
  const field = openField();
  const w = createWorld(93);
  const ids = [];
  const pileX = fx.fromInt(0);
  const pileY = fx.fromInt(0);
  for (let k = 0; k < 20; k++) {
    const i = spawn(w, {
      x: pileX,
      y: pileY,
      type: UNIT.WARRIOR,
      owner: 0,
    });
    w.order[i] = ORDER.ATTACK_MOVE;
    w.hasTarget[i] = 1;
    w.tx[i] = pileX;
    w.ty[i] = pileY;
    w.navDestX[i] = pileX;
    w.navDestY[i] = pileY;
    ids.push(i);
  }

  for (let t = 0; t < 180; t++) step(w, field);

  const snap = ids.map((i) => [w.px[i], w.py[i]]);
  for (let t = 0; t < 60; t++) step(w, field);

  let maxDrift = 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    const dx = fx.toFloat(w.px[i] - snap[k][0]);
    const dy = fx.toFloat(w.py[i] - snap[k][1]);
    const d = Math.hypot(dx, dy);
    if (d > maxDrift) maxDrift = d;
  }
  assert.ok(
    maxDrift < 0.08,
    `dense pack should settle (maxDrift=${maxDrift.toFixed(4)} over 60 ticks)`,
  );
  assert.ok(minPairDist(w, ids) > 1.2, 'still not a pixel stack after settle');
}

/** Click inside a relaxed pack — nobody needs to smash onto the pixel. */
function clickInsidePackStaysPut() {
  const field = openField();
  const w = createWorld(94);
  const ids = [];
  // Soft-sep lattice near the settle distance — already a relaxed pack.
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      ids.push(
        spawn(w, {
          x: fx.fromFloat((x - 1) * 2.7),
          y: fx.fromFloat((z - 1) * 2.7),
          type: UNIT.WARRIOR,
          owner: 0,
        }),
      );
    }
  }
  const before = ids.map((i) => [w.px[i], w.py[i]]);
  const destX = 0;
  const destY = 0;
  step(w, field, [
    {
      type: CMD.ATTACK_MOVE,
      entities: ids,
      tx: ids.map(() => destX),
      ty: ids.map(() => destY),
    },
  ]);

  let pathing = 0;
  for (const i of ids) {
    if (w.navWpCount[i] > 0 || w.pathRequest[i] || w.hasTarget[i]) pathing++;
  }
  assert.equal(pathing, 0, 'pack already in gather disk — no paths issued');

  for (let t = 0; t < 30; t++) step(w, field);

  let maxDrift = 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k];
    const d = fx.toFloat(
      fx.len(w.px[i] - before[k][0], w.py[i] - before[k][1]),
    );
    if (d > maxDrift) maxDrift = d;
  }
  assert.ok(maxDrift < 0.5, `should not rush the click (maxDrift=${maxDrift.toFixed(3)})`);
}

/** Dirigibles don't soft-push infantry (and vice versa). */
function flyersIgnoreGroundSep() {
  const field = openField();
  const w = createWorld(95);
  const ground = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.WARRIOR,
    owner: 0,
  });
  const air = spawn(w, {
    x: 0,
    y: 0,
    type: UNIT.DIRIGIBLE,
    owner: 0,
  });
  for (let t = 0; t < 60; t++) step(w, field);
  const d = fx.toFloat(fx.len(w.px[air] - w.px[ground], w.py[air] - w.py[ground]));
  assert.ok(d < 0.05, `air/ground must not shove each other (d=${d.toFixed(3)})`);

  const a = spawn(w, {
    x: fx.fromInt(40),
    y: fx.fromInt(40),
    type: UNIT.DIRIGIBLE,
    owner: 0,
  });
  const b = spawn(w, {
    x: fx.fromInt(40),
    y: fx.fromInt(40),
    type: UNIT.DIRIGIBLE,
    owner: 0,
  });
  for (let t = 0; t < 90; t++) step(w, field);
  const airSep = fx.toFloat(fx.len(w.px[a] - w.px[b], w.py[a] - w.py[b]));
  assert.ok(airSep > 2.5, `flyers still soft-separate among themselves (d=${airSep.toFixed(2)})`);
}

attackMoveHoldersUnstack();
sharedDestinationBlooms();
pathFollowWinsWhileMoving();
densePackSettles();
clickInsidePackStaysPut();
flyersIgnoreGroundSep();
console.log('[PASS] soft separation (arrive disk, air/ground layers, settle)');
