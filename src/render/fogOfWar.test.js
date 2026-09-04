import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from '../sim/fixed.js';
import { UNIT } from '../sim/unitTypes.js';
import {
  COVER_DECAY_MS,
  VISITED_ALPHA,
  createFogOfWar,
  structureKey,
  visionTilesForBuilding,
  visionTilesForDef,
  visionTilesForUnitType,
  worldToTileF,
} from './fogOfWar.js';

function fakeField(w, h) {
  return {
    width: w,
    height: h,
    heightMap: new Float32Array(w * h),
    terrainTypes: new Uint8Array(w * h),
  };
}

function fakeWorld(units) {
  const n = units.length;
  const world = {
    count: n,
    alive: new Uint8Array(n),
    owner: new Uint8Array(n),
    type: new Uint8Array(n),
    px: new Int32Array(n),
    py: new Int32Array(n),
    carriedBy: new Int32Array(n),
  };
  world.carriedBy.fill(-1);
  for (let i = 0; i < n; i++) {
    const u = units[i];
    world.alive[i] = 1;
    world.owner[i] = u.owner;
    world.type[i] = u.type;
    world.px[i] = fx.fromFloat(u.x);
    world.py[i] = fx.fromFloat(u.z);
  }
  return world;
}

describe('fogOfWar vision radii', () => {
  it('gives civilians a short circle and military a larger one', () => {
    assert.equal(visionTilesForDef({ category: 'civilian', aggroRange: 0 }), 8);
    assert.ok(visionTilesForUnitType(UNIT.WARRIOR) >= 10);
    assert.equal(visionTilesForBuilding('camp'), 7);
  });

  it('gives casters extra range, dirigibles more, and mirrors those on tower/agora', () => {
    const warrior = visionTilesForUnitType(UNIT.WARRIOR);
    const caster = visionTilesForUnitType(UNIT.WIZARD);
    const dirigible = visionTilesForUnitType(UNIT.DIRIGIBLE);
    assert.equal(visionTilesForUnitType(UNIT.WARLOCK), caster);
    assert.equal(visionTilesForUnitType(UNIT.PRIEST), caster);
    assert.equal(visionTilesForUnitType(UNIT.MYCO), caster);
    assert.equal(visionTilesForUnitType(UNIT.SHAMAN), caster);
    assert.ok(caster > warrior);
    assert.ok(dirigible > caster);
    assert.equal(visionTilesForBuilding('tower'), caster);
    assert.equal(visionTilesForBuilding('perch'), caster);
    assert.equal(visionTilesForBuilding('agora'), dirigible);
  });
});

describe('fogOfWar stamp + hide', () => {
  it('hides hostiles outside the stamp and shows everything when fog is off', () => {
    const field = fakeField(20, 20);
    const half = (20 * 4) / 2;
    const fog = createFogOfWar();
    fog.reset(field);
    const origin = worldToTileF(field, 0, 0);
    assert.equal(origin.tx, 10);
    assert.equal(origin.tz, 10);

    const world = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: half - 2, z: half - 2 },
    ]);

    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [] });
    assert.equal(fog.isEnabled(), true);
    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.isWorldSight(0, 0), true);
    assert.equal(fog.hidesHostile(1, 0, 0), false);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), true);
    assert.equal(fog.hidesHostile(0, half - 2, half - 2), false);

    fog.stamp({ world, field, localPlayerId: 0, enabled: false });
    assert.equal(fog.isEnabled(), false);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), false);
  });

  it('keeps sight when nobody changes tile, and drops it after they leave', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const stay = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    fog.stamp({ world: stay, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [], now: 1000 });
    assert.equal(fog.isWorldVisible(0, 0), true);
    fog.stamp({ world: stay, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [], now: 1100 });
    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.isWorldSight(0, 0), true);

    const gone = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 60, z: 60 }]);
    fog.stamp({ world: gone, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [], now: 1200 });
    assert.equal(fog.isWorldVisible(0, 0), false);
    assert.equal(fog.isWorldSight(0, 0), false);
    assert.equal(fog.isWorldVisible(60, 60), true);
  });
});

describe('fogOfWar last-known buildings', () => {
  it('hides unseen enemies, then freezes last-known while fogged', () => {
    const field = fakeField(20, 20);
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    const enemy = { owner: 1, type: 'camp', x: 36, z: 36, yaw: 0, tracks: [{ id: 'warrior', count: 1 }] };
    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [enemy], agoras: [] });
    assert.equal(fog.filterBuildings([enemy]).length, 0);

    const scouted = { ...enemy, x: 0, z: 0, tracks: [{ id: 'warrior', count: 1 }] };
    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [scouted], agoras: [] });
    assert.equal(fog.filterBuildings([scouted]).length, 1);
    assert.equal(structureKey(scouted), structureKey({ owner: 1, type: 'camp', x: 0, z: 0 }));

    const movedAway = { ...scouted, tracks: [{ id: 'warrior', count: 9 }] };
    const farWorld = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: -36, z: -36 }]);
    fog.stamp({
      world: farWorld,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [movedAway],
      agoras: [],
    });
    const shown = fog.filterBuildings([movedAway]);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].tracks[0].count, 1);
  });
});

describe('fogOfWar overlay decay', () => {
  it('keeps hostiles up until the trail is most opaque, then hides', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const atOrigin = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    fog.stamp({
      world: atOrigin,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1000,
    });
    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.isWorldExplored(0, 0), true);
    assert.equal(fog.overlayAlphaAt(0, 0), 0);
    assert.equal(fog.hidesHostile(1, 0, 0), false);

    const far = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: -36, z: -36 }]);
    fog.stamp({
      world: far,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1400,
    });
    assert.equal(fog.isWorldVisible(0, 0), false);
    assert.equal(fog.isWorldSight(0, 0), false);
    assert.equal(fog.isWorldExplored(0, 0), true);
    const mid = fog.overlayAlphaAt(0, 0);
    assert.ok(mid > 0 && mid < VISITED_ALPHA, `expected a fading trail, got ${mid}`);
    assert.equal(fog.hidesHostile(1, 0, 0), false);

    fog.stamp({
      world: far,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1400 + COVER_DECAY_MS,
    });
    assert.equal(fog.isWorldVisible(0, 0), false);
    assert.equal(fog.overlayAlphaAt(0, 0), VISITED_ALPHA);
    assert.equal(fog.hidesHostile(1, 0, 0), true);
    assert.equal(fog.overlayAlphaAt(64, 0), 255);
    assert.equal(fog.hidesHostile(1, 64, 0), true);
  });
});

describe('fogOfWar three levels', () => {
  it('keeps sight, visited, and never-seen as three overlay steps', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const atOrigin = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    fog.stamp({
      world: atOrigin,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1000,
    });
    const far = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: -36, z: -36 }]);
    fog.stamp({
      world: far,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1000 + COVER_DECAY_MS,
    });

    const sight = fog.overlayAlphaAt(-36, -36);
    const visited = fog.overlayAlphaAt(0, 0);
    const unseen = fog.overlayAlphaAt(64, 0);
    assert.equal(fog.isWorldVisible(-36, -36), true);
    assert.equal(fog.isWorldVisible(0, 0), false);
    assert.equal(fog.isWorldExplored(0, 0), true);
    assert.equal(fog.hidesHostile(1, 0, 0), true);
    assert.equal(fog.isWorldExplored(64, 0), false);
    assert.equal(sight, 0);
    assert.equal(visited, VISITED_ALPHA);
    assert.equal(unseen, 255);
    assert.ok(sight < visited && visited < unseen);
    assert.equal(fog.fogFactorAt(-36, -36), 0);
    assert.ok(Math.abs(fog.fogFactorAt(0, 0) - VISITED_ALPHA / 255) < 1e-6);
    assert.equal(fog.fogFactorAt(64, 0), 1);
  });
});

describe('fogOfWar vision union', () => {
  it('matches circle hide/skirt when many overlapping sources share a blob', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const units = [];
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) units.push({ owner: 0, type: UNIT.VILLAGER, x: x * 4, z: z * 4 });
    }
    fog.stamp({
      world: fakeWorld(units),
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
    });
    assert.equal(fog.isWorldVisible(4, 4), true);
    assert.equal(fog.hidesHostile(1, 4, 4), false);
    // Easternmost villager at x=8. 36wu past that is the fade skirt; 48wu is outside.
    assert.equal(fog.isWorldVisible(8 + 36, 0), false);
    assert.equal(fog.isWorldSight(8 + 36, 0), true);
    assert.equal(fog.hidesHostile(1, 8 + 36, 0), false);
    const skirt = fog.overlayAlphaAt(8 + 36, 0);
    assert.ok(skirt > 0 && skirt < 255, `expected a fade skirt, got ${skirt}`);
    assert.equal(fog.isWorldSight(8 + 48, 0), false);
    assert.equal(fog.hidesHostile(1, 8 + 48, 0), true);
    assert.equal(fog.overlayAlphaAt(8 + 48, 0), 255);
  });

  it('keeps two distant blobs correct when the AABB is most of the board', () => {
    const field = fakeField(80, 80);
    const fog = createFogOfWar();
    fog.reset(field);
    const units = [];
    for (let i = 0; i < 16; i++) {
      units.push({ owner: 0, type: UNIT.VILLAGER, x: -140 + (i % 4) * 4, z: -140 + ((i / 4) | 0) * 4 });
      units.push({ owner: 0, type: UNIT.VILLAGER, x: 140 + (i % 4) * 4, z: 140 + ((i / 4) | 0) * 4 });
    }
    fog.stamp({
      world: fakeWorld(units),
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
    });
    assert.equal(fog.isWorldVisible(-140, -140), true);
    assert.equal(fog.isWorldVisible(140, 140), true);
    assert.equal(fog.hidesHostile(1, 0, 0), true);
    assert.equal(fog.isWorldSight(0, 0), false);
  });
});

describe('fogOfWar stacked stamps', () => {
  it('keeps the larger radius when two allies share a tile', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const stacked = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 0, type: UNIT.WIZARD, x: 0, z: 0 },
    ]);
    fog.stamp({ world: stacked, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [] });
    // Wizard / caster hard circle is 18 tiles (72wu). A villager-only stamp would miss this.
    assert.equal(fog.isWorldVisible(64, 0), true);
    assert.equal(fog.hidesHostile(1, 64, 0), false);
  });
});

describe('fogOfWar overlay edge', () => {
  it('hides with the fade skirt, not the hard vision circle', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [] });

    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.overlayAlphaAt(0, 0), 0);
    assert.equal(fog.hidesHostile(1, 0, 0), false);

    // Civilian radius is 8 tiles (32wu). 36wu is one tile past the hard circle
    // but still inside the 3-tile fade — units stay up with the overlay.
    assert.equal(fog.isWorldVisible(36, 0), false);
    assert.equal(fog.isWorldSight(36, 0), true);
    assert.equal(fog.hidesHostile(1, 36, 0), false);
    const skirt = fog.overlayAlphaAt(36, 0);
    assert.ok(skirt > 0 && skirt < 255, `expected a fade skirt, got ${skirt}`);
    assert.equal(fog.isWorldExplored(36, 0), false);

    // 48wu is past the fade (8+3 tiles). Overlay is fully on; hostiles hide.
    assert.equal(fog.isWorldVisible(48, 0), false);
    assert.equal(fog.isWorldSight(48, 0), false);
    assert.equal(fog.hidesHostile(1, 48, 0), true);
    assert.equal(fog.overlayAlphaAt(48, 0), 255);

    assert.equal(fog.isWorldVisible(64, 0), false);
    assert.equal(fog.overlayAlphaAt(64, 0), 255);
    assert.equal(fog.fogFactorAt(0, 0), 0);
    assert.ok(fog.fogFactorAt(36, 0) > 0 && fog.fogFactorAt(36, 0) < 1);
    assert.equal(fog.fogFactorAt(64, 0), 1);
  });
});

describe('fogOfWar shared vision', () => {
  it('lets spectators stamp every listed owner without revealing wilderness', () => {
    const field = fakeField(20, 20);
    const half = (20 * 4) / 2;
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: half - 2, z: half - 2 },
    ]);

    fog.stamp({
      world,
      field,
      localPlayerId: -1,
      enabled: true,
      buildings: [],
      agoras: [],
      shareVisionWith: [0, 1],
    });
    assert.equal(fog.isEnabled(), true);
    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.isWorldVisible(half - 2, half - 2), true);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), false);
    assert.equal(fog.isWorldExplored(-36, -36), false);
    assert.equal(fog.overlayAlphaAt(-36, -36), 255);

    fog.stamp({
      world,
      field,
      localPlayerId: -1,
      enabled: true,
      buildings: [],
      agoras: [],
      shareVisionWith: [],
    });
    assert.equal(fog.isEnabled(), true);
    assert.equal(fog.isWorldVisible(0, 0), false);
    assert.equal(fog.isWorldExplored(-36, -36), false);
  });

  it('stamps listed hostiles without turning fog off', () => {
    const field = fakeField(20, 20);
    const half = (20 * 4) / 2;
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: half - 2, z: half - 2 },
    ]);

    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [] });
    assert.equal(fog.isWorldVisible(half - 2, half - 2), false);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), true);

    fog.stamp({
      world,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      shareVisionWith: [1],
    });
    assert.equal(fog.isWorldVisible(half - 2, half - 2), true);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), false);
    assert.equal(fog.isEnabled(), true);
    assert.equal(fog.isWorldExplored(-36, -36), false);
    assert.equal(fog.overlayAlphaAt(-36, -36), 255);
  });
});

describe('fogOfWar vision identity', () => {
  it('forgets explored tiles and last-known buildings when shared vision drops', () => {
    const field = fakeField(20, 20);
    const half = (20 * 4) / 2;
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: half - 2, z: half - 2 },
    ]);
    const enemyCamp = { owner: 1, type: 'camp', x: half - 2, z: half - 2, tracks: [{ id: 'warrior', count: 1 }] };

    fog.stamp({
      world,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [enemyCamp],
      agoras: [],
      shareVisionWith: [1],
    });
    assert.equal(fog.isWorldExplored(half - 2, half - 2), true);
    assert.equal(fog.filterBuildings([enemyCamp]).length, 1);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), false);

    fog.stamp({
      world,
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [enemyCamp],
      agoras: [],
      shareVisionWith: [],
    });
    assert.equal(fog.isWorldExplored(half - 2, half - 2), false);
    assert.equal(fog.filterBuildings([enemyCamp]).length, 0);
    assert.equal(fog.hidesHostile(1, half - 2, half - 2), true);
    assert.equal(fog.isWorldVisible(0, 0), true);
  });

  it('forgets last-known buildings when the local player id changes', () => {
    const field = fakeField(20, 20);
    const fog = createFogOfWar();
    fog.reset(field);
    const p0 = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    const enemyCamp = { owner: 1, type: 'camp', x: 0, z: 0, tracks: [{ id: 'warrior', count: 1 }] };
    fog.stamp({ world: p0, field, localPlayerId: 0, enabled: true, buildings: [enemyCamp], agoras: [] });
    assert.equal(fog.filterBuildings([enemyCamp]).length, 1);

    const p2 = fakeWorld([{ owner: 2, type: UNIT.VILLAGER, x: -36, z: -36 }]);
    fog.stamp({ world: p2, field, localPlayerId: 2, enabled: true, buildings: [enemyCamp], agoras: [] });
    assert.equal(fog.filterBuildings([enemyCamp]).length, 0);
    assert.equal(fog.isWorldExplored(0, 0), false);
  });
});

describe('fogOfWar dirty tiles', () => {
  it('lists cover-changed tiles so scenery can retint without a full pass', () => {
    const field = fakeField(40, 40);
    const fog = createFogOfWar();
    fog.reset(field);
    fog.stamp({
      world: fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]),
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
      now: 1000,
    });
    const dirty = new Set();
    fog.forEachDirtyTile((i) => dirty.add(i));
    const origin = worldToTileF(field, 0, 0);
    assert.ok(dirty.size > 0);
    assert.ok(dirty.has(origin.tz * field.width + origin.tx));
    assert.equal(fog.overlayNeedsFullPaint(), true);
  });
});

describe('fogOfWar field reset', () => {
  it('clears explored tiles on reset even when the board size is unchanged', () => {
    const field = fakeField(20, 20);
    const fog = createFogOfWar();
    fog.reset(field);
    fog.stamp({
      world: fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]),
      field,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
    });
    assert.equal(fog.isWorldExplored(0, 0), true);

    fog.reset(field);
    assert.equal(fog.isWorldExplored(0, 0), false);
    assert.equal(fog.isWorldVisible(0, 0), false);
  });

  it('drops explored tiles, last-known buildings, and shared vision across a board resize', () => {
    const large = fakeField(40, 40);
    const small = fakeField(20, 20);
    const halfLarge = (40 * 4) / 2;
    const fog = createFogOfWar();
    fog.reset(large);
    const world = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: halfLarge - 2, z: halfLarge - 2 },
    ]);
    const enemyCamp = {
      owner: 1,
      type: 'camp',
      x: halfLarge - 2,
      z: halfLarge - 2,
      tracks: [{ id: 'warrior', count: 1 }],
    };
    fog.stamp({
      world,
      field: large,
      localPlayerId: 0,
      enabled: true,
      buildings: [enemyCamp],
      agoras: [],
      shareVisionWith: [1],
    });
    assert.equal(fog.isWorldExplored(halfLarge - 2, halfLarge - 2), true);
    assert.equal(fog.filterBuildings([enemyCamp]).length, 1);
    assert.equal(fog.hidesHostile(1, halfLarge - 2, halfLarge - 2), false);

    fog.reset(small);
    assert.equal(fog.isWorldExplored(0, 0), false);
    assert.equal(fog.isWorldExplored(halfLarge - 2, halfLarge - 2), false);
    assert.equal(fog.filterBuildings([enemyCamp]).length, 0);

    const smallHalf = (20 * 4) / 2;
    const far = smallHalf - 2;
    const smallWorld = fakeWorld([
      { owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 },
      { owner: 1, type: UNIT.WARRIOR, x: far, z: far },
    ]);
    // Omit shareVisionWith — a field reset is a new match; leftover FFA share
    // must not keep stamping the old allies.
    fog.stamp({
      world: smallWorld,
      field: small,
      localPlayerId: 0,
      enabled: true,
      buildings: [],
      agoras: [],
    });
    assert.equal(fog.isWorldVisible(0, 0), true);
    assert.equal(fog.hidesHostile(1, far, far), true);
    assert.equal(fog.isWorldExplored(far, far), false);
  });
});

describe('fogOfWar agoras', () => {
  it('keeps enemy agoras visible even when their tile is fogged', () => {
    const field = fakeField(20, 20);
    const fog = createFogOfWar();
    fog.reset(field);
    const world = fakeWorld([{ owner: 0, type: UNIT.VILLAGER, x: 0, z: 0 }]);
    const enemyAgora = { owner: 1, x: 36, z: 36 };
    fog.stamp({ world, field, localPlayerId: 0, enabled: true, buildings: [], agoras: [enemyAgora] });
    assert.equal(fog.isWorldVisible(36, 36), false);
    const shown = fog.filterAgoras([enemyAgora]);
    assert.equal(shown.length, 1);
    assert.equal(shown[0], enemyAgora);
  });
});
