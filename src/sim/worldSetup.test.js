import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from './fixed.js';
import { TINY_MAP_W, SKIRMISH_MAP_W, worldHalfFFromMap } from './field.js';
import { UNIT } from './unitTypes.js';
import { createAgoras } from './agora.js';
import { getResource, STARTING_RESOURCES } from './resources.js';
import { BASE_PYRAMID_BANK, KOTH_STARTING_RESOURCES } from './storage.js';
import {
  KOTH_ARMY,
  KOTH_UNITS_PER_ARMY,
  PLAYER_ARMY,
  SPAWN_BASE_INSET,
  STRESS_ARMY_COUNT,
  STRESS_MENU_PER_SIDE,
  STRESS_RING_INNER_FRAC,
  UNITS_PER_ARMY,
  buildWorldFromConfig,
  cornerBases,
  defaultMatchAgoras,
  kothBases,
  laneBases,
  sideBases,
  spawnBases,
  spawnKothSlot,
  pickKothSpawnPoint,
  spawnCameraHomeXZ,
  KOTH_SPAWN_COUNT,
  stressSliceMidAngle,
  usesCornerSpawnBases,
} from './worldSetup.js';

describe('spawn bases', () => {
  it('uses the side-midline intersection for tiny-map corners', () => {
    const half = worldHalfFFromMap(TINY_MAP_W);
    const m = half * SPAWN_BASE_INSET;
    const corners = cornerBases(half);
    assert.deepEqual(corners[0], [-m, -m]);
    assert.deepEqual(corners[1], [m, m]);
    assert.equal(Math.abs(corners[0][0]), Math.abs(kothBases(half)[0][0]));
    assert.ok(Math.abs(corners[0][0]) < half);
    assert.ok(usesCornerSpawnBases(TINY_MAP_W));
    assert.equal(usesCornerSpawnBases(SKIRMISH_MAP_W), false);
  });

  it('picks corners on tiny and sides on larger 1v1 boards', () => {
    const tinyHalf = worldHalfFFromMap(TINY_MAP_W);
    const smallHalf = worldHalfFFromMap(SKIRMISH_MAP_W);
    assert.deepEqual(spawnBases(tinyHalf, { mapW: TINY_MAP_W }), cornerBases(tinyHalf));
    assert.deepEqual(spawnBases(smallHalf, { mapW: SKIRMISH_MAP_W }), sideBases(smallHalf));
    assert.deepEqual(
      spawnBases(tinyHalf, { laneBases: true, mapW: TINY_MAP_W }),
      laneBases(tinyHalf),
    );
  });

  it('places tiny skirmish agoras in opposite corners facing center', () => {
    const w = buildWorldFromConfig({
      seed: 1,
      mode: 'skirmish',
      mapW: TINY_MAP_W,
      mapH: TINY_MAP_W,
      activeSlots: [0, 1],
    });
    const half = worldHalfFFromMap(TINY_MAP_W);
    const expected = defaultMatchAgoras(half, TINY_MAP_W);
    assert.equal(w.agoras.length, 2);
    assert.equal(fx.toFloat(w.agoras[0].x), expected[0].x);
    assert.equal(fx.toFloat(w.agoras[0].z), expected[0].z);
    assert.equal(fx.toFloat(w.agoras[1].x), expected[1].x);
    assert.equal(fx.toFloat(w.agoras[1].z), expected[1].z);
    assert.ok(expected[0].x < 0 && expected[0].z < 0);
    assert.ok(expected[1].x > 0 && expected[1].z > 0);
  });
});

describe('1vAI home agoras', () => {
  it('does not place agoras on a plain KOTH board', () => {
    const w = buildWorldFromConfig({ seed: 2, mode: 'koth', activeSlots: [0, 1] });
    assert.equal(w.agoras.length, 0);
  });

  it('camps the usual mix around a home agora for each seat', () => {
    const w = buildWorldFromConfig({
      seed: 3,
      mode: '1vai',
      activeSlots: [0, 1],
    });
    const half = w.worldHalfF;
    const expected = defaultMatchAgoras(half, w.mapW);
    assert.equal(w.agoras.length, 2);
    assert.equal(w.agoraOccupyEndsMatch, 1);
    assert.ok(!w.koth);
    assert.equal(w.agoras[0].owner, expected[0].owner);
    assert.equal(w.agoras[1].owner, expected[1].owner);
    assert.ok(Math.hypot(fx.toFloat(w.agoras[0].x) - expected[0].x, fx.toFloat(w.agoras[0].z) - expected[0].z) < 0.01);
    assert.ok(Math.hypot(fx.toFloat(w.agoras[1].x) - expected[1].x, fx.toFloat(w.agoras[1].z) - expected[1].z) < 0.01);

    const expectedTypes = new Map(PLAYER_ARMY.map((c) => [c.type, c.count]));
    for (const owner of [0, 1]) {
      const camp = livingOf(w, owner);
      assert.equal(camp.length, UNITS_PER_ARMY);
      const types = new Map();
      for (const i of camp) types.set(w.type[i], (types.get(w.type[i]) ?? 0) + 1);
      for (const [t, n] of expectedTypes) assert.equal(types.get(t) ?? 0, n);

      const ax = fx.toFloat(w.agoras[owner].x);
      const az = fx.toFloat(w.agoras[owner].z);
      let villR = 0;
      let villN = 0;
      let warR = 0;
      let warN = 0;
      let warDot = 0;
      for (const i of camp) {
        const x = fx.toFloat(w.px[i]) - ax;
        const z = fx.toFloat(w.py[i]) - az;
        const r = Math.hypot(x, z);
        assert.ok(r > 8, `owner ${owner} unit stacked on the agora`);
        if (w.type[i] === UNIT.VILLAGER) {
          villR += r;
          villN++;
        } else if (w.type[i] === UNIT.WARRIOR) {
          warR += r;
          warN++;
          warDot += x * -ax + z * -az;
        }
      }
      assert.ok(villN > 0 && warN > 0);
      assert.ok(villR / villN < warR / warN, 'villagers should hug the agora');
      assert.ok(warDot > 0, 'warriors should stand toward map center');
    }
  });
});

describe('koth combat spawn', () => {
  it('opens each seat on a full pre-silo pyramid and a double food stash', () => {
    const w = buildWorldFromConfig({ seed: 5, mode: 'koth', activeSlots: [0, 1] });
    for (const owner of [0, 1]) {
      assert.equal(getResource(w, owner, 'wood'), BASE_PYRAMID_BANK.wood);
      assert.equal(getResource(w, owner, 'stone'), BASE_PYRAMID_BANK.stone);
      assert.equal(getResource(w, owner, 'mineral'), BASE_PYRAMID_BANK.mineral);
      assert.equal(getResource(w, owner, 'food'), KOTH_STARTING_RESOURCES.food);
    }
  });

  it('leaves skirmish on the usual opening bank', () => {
    const w = buildWorldFromConfig({ seed: 6, mode: 'skirmish', activeSlots: [0, 1] });
    assert.equal(getResource(w, 0, 'wood'), STARTING_RESOURCES.wood);
    assert.equal(getResource(w, 0, 'food'), STARTING_RESOURCES.food);
  });

  it('parks a dirigible and APC on opposite flanks, each loaded with villagers and an engineer', () => {
    const w = buildWorldFromConfig({ seed: 4, mode: 'koth', activeSlots: [0] });
    const ids = livingOf(w, 0);
    assert.equal(ids.length, KOTH_UNITS_PER_ARMY);

    const types = new Map();
    for (const i of ids) types.set(w.type[i], (types.get(w.type[i]) ?? 0) + 1);
    assert.equal(types.get(UNIT.VILLAGER) ?? 0, 10);
    assert.equal(types.get(UNIT.ENGINEER) ?? 0, 2);
    assert.equal(types.get(UNIT.WAGON) ?? 0, 0);
    for (const col of KOTH_ARMY) assert.equal(types.get(col.type) ?? 0, col.count);

    const bases = kothBases(w.worldHalfF);
    const [cx0, cz0] = centroidOf(w, 0);
    const [bx, bz] = nearestPad(bases, cx0, cz0);
    const { fX, fZ, rX, rZ } = (() => {
      const len = Math.hypot(bx, bz) || 1;
      return { fX: -bx / len, fZ: -bz / len, rX: bz / len, rZ: -bx / len };
    })();

    let dirigi = -1;
    let apc = -1;
    let maxInfLat = 0;
    let warR = 0;
    let warN = 0;
    let casterR = 0;
    let casterN = 0;
    for (const i of ids) {
      const x = fx.toFloat(w.px[i]) - bx;
      const z = fx.toFloat(w.py[i]) - bz;
      const lat = x * rX + z * rZ;
      const originR = Math.hypot(fx.toFloat(w.px[i]), fx.toFloat(w.py[i]));
      if (w.type[i] === UNIT.DIRIGIBLE) dirigi = i;
      else if (w.type[i] === UNIT.APC) apc = i;
      else if (w.carriedBy[i] < 0) maxInfLat = Math.max(maxInfLat, Math.abs(lat));
      if (w.type[i] === UNIT.WARRIOR) {
        warR += originR;
        warN++;
      } else if (w.type[i] === UNIT.WIZARD || w.type[i] === UNIT.WARLOCK) {
        casterR += originR;
        casterN++;
      }
    }
    assert.ok(dirigi >= 0 && apc >= 0);
    for (const vehicle of [dirigi, apc]) {
      let vill = 0;
      let engi = 0;
      for (const i of ids) {
        if (w.carriedBy[i] !== vehicle) continue;
        if (w.type[i] === UNIT.VILLAGER) vill++;
        else if (w.type[i] === UNIT.ENGINEER) engi++;
      }
      assert.equal(vill, 5);
      assert.equal(engi, 1);
    }
    const dLat = (fx.toFloat(w.px[dirigi]) - bx) * rX + (fx.toFloat(w.py[dirigi]) - bz) * rZ;
    const aLat = (fx.toFloat(w.px[apc]) - bx) * rX + (fx.toFloat(w.py[apc]) - bz) * rZ;
    assert.ok(dLat < 0 && aLat > 0, 'dirigible left, APC right');
    assert.ok(Math.abs(dLat) > maxInfLat + 8, 'dirigible should sit outside the infantry');
    assert.ok(Math.abs(aLat) > maxInfLat + 8, 'APC should sit outside the infantry');
    assert.ok(warN > 0 && casterN > 0);
    assert.ok(warR / warN < casterR / casterN, 'melee should stand closer to the hill than casters');

    const dFwd = (fx.toFloat(w.px[dirigi]) - bx) * fX + (fx.toFloat(w.py[dirigi]) - bz) * fZ;
    const aFwd = (fx.toFloat(w.px[apc]) - bx) * fX + (fx.toFloat(w.py[apc]) - bz) * fZ;
    assert.ok(dFwd > 8 && aFwd > 8, 'flank vehicles should stand with the battle line');
  });
});

const STRESS_SUPPORT = new Set([
  UNIT.VILLAGER,
  UNIT.ENGINEER,
  UNIT.WAGON,
  UNIT.DIRIGIBLE,
  UNIT.APC,
]);

function livingOf(w, owner) {
  const ids = [];
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.owner[i] === owner) ids.push(i);
  }
  return ids;
}

function centroidOf(w, owner) {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const i of livingOf(w, owner)) {
    x += fx.toFloat(w.px[i]);
    z += fx.toFloat(w.py[i]);
    n++;
  }
  return n ? [x / n, z / n] : [0, 0];
}

function nearestPad(bases, x, z) {
  let best = bases[0];
  let bestD = Infinity;
  for (const b of bases) {
    const d = Math.hypot(x - b[0], z - b[1]);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function nearestPadIndex(bases, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < bases.length; i++) {
    const d = Math.hypot(x - bases[i][0], z - bases[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function radiusOf(w, i) {
  return Math.hypot(fx.toFloat(w.px[i]), fx.toFloat(w.py[i]));
}

function angleOf(w, i) {
  return Math.atan2(fx.toFloat(w.py[i]), fx.toFloat(w.px[i]));
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

describe('stress pie ring', () => {
  it('keeps the menu default at 1000 per player', () => {
    assert.equal(STRESS_MENU_PER_SIDE, 1000);
    assert.equal(STRESS_ARMY_COUNT, 5);
  });

  it('lays five slices: inner monks, combat mass, support behind', () => {
    const perSide = 80;
    const w = buildWorldFromConfig({ seed: 0x57e55, stressPerSide: perSide });
    assert.equal(w.count, perSide * STRESS_ARMY_COUNT);
    const half = w.worldHalfF;
    const innerMin = half * STRESS_RING_INNER_FRAC * 0.85;

    for (let owner = 0; owner < STRESS_ARMY_COUNT; owner++) {
      const ids = livingOf(w, owner);
      assert.equal(ids.length, perSide);
      const rows = ids.map((i) => ({ i, r: radiusOf(w, i), t: w.type[i] }));
      rows.sort((a, b) => a.r - b.r);
      assert.ok(rows[0].r > innerMin, `owner ${owner} starts too close to origin`);

      const innerR = rows[0].r;
      const innerRank = rows.filter((u) => u.r < innerR + 2);
      assert.ok(innerRank.length >= 1);
      assert.ok(innerRank.every((u) => u.t === UNIT.MONK), `owner ${owner} inner rank is not monks`);

      const support = rows.filter((u) => STRESS_SUPPORT.has(u.t));
      assert.equal(support.length, STRESS_SUPPORT.size);
      const types = new Set(support.map((u) => u.t));
      assert.equal(types.size, STRESS_SUPPORT.size);
      const maxFront = Math.max(...rows.filter((u) => !STRESS_SUPPORT.has(u.t)).map((u) => u.r));
      assert.ok(support.every((u) => u.r > maxFront + 8), `owner ${owner} support is not behind the ring`);

      const mid = stressSliceMidAngle(owner);
      const halfSlice = Math.PI / STRESS_ARMY_COUNT;
      for (const u of rows) {
        assert.ok(
          angDiff(angleOf(w, u.i), mid) < halfSlice,
          `owner ${owner} unit left its pie slice`,
        );
      }

      const combat = rows.filter((u) => u.t !== UNIT.MONK && !STRESS_SUPPORT.has(u.t));
      assert.ok(combat.length > 0);
      assert.ok(combat.every((u) => u.t !== UNIT.MONK));
    }
  });

  it('spawns 1000 units per player for the menu default', () => {
    const w = buildWorldFromConfig({ seed: 1, stressPerSide: STRESS_MENU_PER_SIDE });
    assert.equal(w.count, STRESS_MENU_PER_SIDE * STRESS_ARMY_COUNT);
    for (let owner = 0; owner < STRESS_ARMY_COUNT; owner++) {
      assert.equal(livingOf(w, owner).length, STRESS_MENU_PER_SIDE);
    }
  });
});

describe('koth spawn pads', () => {
  it('places five even-spaced pads on a ring', () => {
    const half = 100;
    const bases = kothBases(half);
    assert.equal(bases.length, KOTH_SPAWN_COUNT);
    const r = half * SPAWN_BASE_INSET;
    const step = (Math.PI * 2) / KOTH_SPAWN_COUNT;
    for (const [x, z] of bases) {
      assert.ok(Math.abs(Math.hypot(x, z) - r) < 1e-6);
    }
    for (let i = 0; i < bases.length; i++) {
      const a = Math.atan2(bases[i][1], bases[i][0]);
      const b = Math.atan2(bases[(i + 1) % bases.length][1], bases[(i + 1) % bases.length][0]);
      let d = b - a;
      while (d <= 0) d += Math.PI * 2;
      assert.ok(Math.abs(d - step) < 1e-6);
    }
  });

  it('opens two seats on different pads', () => {
    const w = buildWorldFromConfig({ seed: 7, mode: 'koth', activeSlots: [0, 1] });
    const bases = kothBases(w.worldHalfF);
    const i0 = nearestPadIndex(bases, ...centroidOf(w, 0));
    const i1 = nearestPadIndex(bases, ...centroidOf(w, 1));
    assert.notEqual(i0, i1);
  });

  it('drops a joiner on an emptier pad than the first army', () => {
    const w = buildWorldFromConfig({ seed: 8, mode: 'koth', activeSlots: [0] });
    const bases = kothBases(w.worldHalfF);
    const first = nearestPadIndex(bases, ...centroidOf(w, 0));
    spawnKothSlot(w, 1);
    const second = nearestPadIndex(bases, ...centroidOf(w, 1));
    assert.notEqual(first, second);
  });

  it('avoids pads that already have an agora', () => {
    const w = buildWorldFromConfig({
      seed: 9,
      mode: 'koth',
      skipDefaultSpawns: true,
      activeSlots: [],
    });
    const bases = kothBases(w.worldHalfF);
    w.agoras = createAgoras(
      bases.slice(0, 4).map((b, i) => ({ owner: i, x: b[0], z: b[1] })),
    );
    spawnKothSlot(w, 0);
    assert.equal(nearestPadIndex(bases, ...centroidOf(w, 0)), 4);

    w.agoras = createAgoras([{ owner: 0, x: bases[0][0], z: bases[0][1] }]);
    for (let n = 0; n < 16; n++) {
      const p = pickKothSpawnPoint(w, bases);
      assert.notEqual(nearestPadIndex(bases, p[0], p[1]), 0);
    }
  });

  it('aims the intro camera at the home agora when one exists', () => {
    const w = buildWorldFromConfig({
      seed: 3,
      mode: '1vai',
      activeSlots: [0, 1],
    });
    const home = spawnCameraHomeXZ(w, 0);
    assert.ok(home);
    assert.ok(Math.hypot(home.x - fx.toFloat(w.agoras[0].x), home.z - fx.toFloat(w.agoras[0].z)) < 0.01);
  });

  it('aims the intro camera at the combat-drop pad', () => {
    const w = buildWorldFromConfig({ seed: 4, mode: 'koth', activeSlots: [0] });
    const home = spawnCameraHomeXZ(w, 0);
    assert.ok(home);
    const [cx, cz] = centroidOf(w, 0);
    const pad = nearestPad(kothBases(w.worldHalfF), cx, cz);
    assert.ok(Math.hypot(home.x - pad[0], home.z - pad[1]) < 0.01);
  });
});
