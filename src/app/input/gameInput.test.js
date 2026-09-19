import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxSelectWinner,
  canAcceptIssuedCommands,
  canInspectBoard,
  inspectForeignOnClick,
  mergeBuildingSels,
  placementDownKind,
  placementHoverFollowsPointer,
  placementTapKind,
  radialClickKind,
  radialHubFramedBuilding,
  lassoPrefersLoop,
  lassoStaysLoop,
  screenPosInPoly,
  screenPosInRect,
  twoFingerConsumesBuildUi,
} from './buildingSelect.js';
import { createGameInput } from './gameInput.js';
import { CONTROL_GROUP_BLACK } from './controlGroups.js';
import { CMD } from '../../sim/commands.js';
import { BUILDING_YAW_SNAP } from '../../sim/buildings.js';

describe('building multi / box select helpers', () => {
  it('shift-add merges buildings without duplicating keys', () => {
    const current = [
      { kind: 'building', index: 0 },
      { kind: 'agora', index: 0 },
    ];
    const extra = [
      { kind: 'agora', index: 0 },
      { kind: 'building', index: 2 },
    ];
    assert.deepEqual(mergeBuildingSels(current, extra), [
      { kind: 'building', index: 0 },
      { kind: 'agora', index: 0 },
      { kind: 'building', index: 2 },
    ]);
  });

  it('units win a mixed box; buildings win when no units hit', () => {
    assert.equal(boxSelectWinner(2, 3), 'units');
    assert.equal(boxSelectWinner(0, 2), 'buildings');
    assert.equal(boxSelectWinner(0, 0), 'none');
  });

  it('screen-rect test matches canvas-local box edges', () => {
    assert.equal(screenPosInRect({ x: 10, y: 20 }, 10, 40, 20, 50), true);
    assert.equal(screenPosInRect({ x: 9, y: 20 }, 10, 40, 20, 50), false);
    assert.equal(screenPosInRect(null, 0, 10, 0, 10), false);
  });

  it('polygon test hits the interior of a closed loop', () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 50, y: 30 },
      { x: 10, y: 40 },
    ];
    assert.equal(screenPosInPoly({ x: 20, y: 15 }, loop), true);
    assert.equal(screenPosInPoly({ x: 60, y: 15 }, loop), false);
    assert.equal(screenPosInPoly(null, loop), false);
  });

  it('keeps a rubber-band as a box and a scenic path as a lasso', () => {
    const rubber = [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 40 },
      { x: 80, y: 80 },
    ];
    assert.equal(lassoPrefersLoop(rubber), false);
    const loop = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
      { x: 80, y: 80 },
      { x: 40, y: 80 },
      { x: 0, y: 80 },
      { x: 0, y: 40 },
    ];
    assert.equal(lassoPrefersLoop(loop), true);
    assert.equal(lassoStaysLoop(false, rubber), false);
    assert.equal(lassoStaysLoop(true, rubber), true);
  });

  it('hub click-through beats radial chrome so the building stays pickable', () => {
    assert.equal(radialClickKind({ picked: true, onHub: true, onChrome: true }), 'pick');
    assert.equal(radialClickKind({ picked: false, onHub: true, onChrome: true }), 'hub');
    assert.equal(radialClickKind({ picked: false, onHub: false, onChrome: true }), 'chrome');
    assert.equal(radialClickKind({ picked: false, onHub: false, onChrome: false }), 'world');
  });

  it('agora tap while placing exits; world taps park instead of stamping', () => {
    assert.equal(placementTapKind('pick', null), 'pick');
    assert.equal(placementTapKind('hub', null), 'exit');
    assert.equal(placementTapKind('chrome', { kind: 'agora' }), 'chrome');
    assert.equal(placementTapKind('world', { kind: 'agora' }), 'exit');
    assert.equal(placementTapKind('world', { kind: 'building' }), 'park');
    assert.equal(placementTapKind('world', null), 'park');
  });

  it('1^ wins over the parked ghost; ghost click rotates; else preview', () => {
    assert.equal(placementDownKind({ parked: true, hitConfirm: true, hitGhost: true }), 'confirm');
    assert.equal(placementDownKind({ parked: true, hitGhost: true }), 'rotate');
    assert.equal(placementDownKind({ parked: true }), 'preview');
    assert.equal(placementDownKind({ parked: false, hitGhost: true }), 'preview');
  });

  it('parked ghost ignores hover unless a reposition drag is live', () => {
    assert.equal(placementHoverFollowsPointer(false, false), true);
    assert.equal(placementHoverFollowsPointer(true, false), false);
    assert.equal(placementHoverFollowsPointer(true, true), true);
  });

  it('hub miss still picks the framed building', () => {
    const framed = { kind: 'building', index: 3 };
    assert.deepEqual(
      radialHubFramedBuilding({ picked: false, onHub: true }, framed),
      framed,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: true, onHub: true }, framed),
      null,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: false, onHub: false }, framed),
      null,
    );
    assert.equal(
      radialHubFramedBuilding({ picked: false, onHub: true }, null),
      null,
    );
  });

  it('foreign LMB inspects when idle and stays an order click with troops selected', () => {
    assert.equal(inspectForeignOnClick(false), true);
    assert.equal(inspectForeignOnClick(true), false);
    assert.equal(inspectForeignOnClick(true, false), true);
  });

  it('paused / story still inspect, but do not accept orders', () => {
    const live = { role: 'player', localPlayerId: 0 };
    assert.equal(canInspectBoard(live), true);
    assert.equal(canAcceptIssuedCommands(live), true);
    assert.equal(canInspectBoard({ ...live, pauseLockstep: true }), true);
    assert.equal(canAcceptIssuedCommands({ ...live, pauseLockstep: true }), false);
    assert.equal(canInspectBoard({ ...live, storyDriving: true }), true);
    assert.equal(canAcceptIssuedCommands({ ...live, storyDriving: true }), false);
    assert.equal(canInspectBoard({ ...live, replayingCatchUp: true }), false);
    assert.equal(canInspectBoard({ ...live, watchingReplay: true }), false);
    assert.equal(canInspectBoard({ ...live, resetting: true }), false);
    assert.equal(canInspectBoard({ role: 'spectator', localPlayerId: 0 }), false);
  });

  it('2-finger tap consumes placement, building selection, and an open radial', () => {
    assert.equal(twoFingerConsumesBuildUi(true, false, false), true);
    assert.equal(twoFingerConsumesBuildUi(false, true, false), true);
    assert.equal(twoFingerConsumesBuildUi(false, false, true), true);
    assert.equal(twoFingerConsumesBuildUi(false, false, false), false);
  });
});

function makePlaceHarness() {
  let placing = 'camp';
  let yaw = 0;
  let confirmHit = false;
  const confirms = [];
  const parks = [];
  const renderer = {
    pickSelectionHud: () => null,
    pickControlGroupHud: () => null,
    screenToGround: (x, y) => ({ x: x / 10, z: y / 10 }),
    clientPickingRay: (cx, cy) => {
      const x = cx / 10;
      const z = cy / 10;
      return { ox: x, oy: 20, oz: z, dx: 0, dy: -1, dz: 0 };
    },
    groundYAt: () => 0,
    hitSceneConfirm: () => confirmHit,
    setSelectionBox: () => {},
  };
  const input = createGameInput({
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    renderer,
    world: { count: 0, alive: [], owner: [], type: [], carriedBy: [] },
    selected: new Uint8Array(8),
    localPlayerId: 0,
    getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
    enqueueCommand: () => {},
    getPlacingType: () => placing,
    setPlacingType: (t) => { placing = t; },
    onPlacementMove: (x, z) => ({ x, z, valid: true }),
    onPlacementConfirm: (x, z, y) => {
      confirms.push({ x, z, y });
      return true;
    },
    onPlacementParked: (on) => { parks.push(on); },
    getPlacementYaw: () => yaw,
    setPlacementYaw: (y) => { yaw = y; },
    isPlacingRally: () => false,
    isRadialOpen: () => false,
    getAgoras: () => [],
    getBuildings: () => [],
  });
  return {
    input,
    confirms,
    parks,
    setConfirmHit: (on) => { confirmHit = on; },
    getYaw: () => yaw,
  };
}

function placePtr(partial) {
  return {
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    type: 'pointerdown',
    clientX: 200,
    clientY: 200,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...partial,
  };
}

function makeOrderHarness() {
  const cmds = [];
  const selected = new Uint8Array(4);
  const world = {
    count: 1,
    alive: [1],
    owner: [0],
    type: [1],
    carriedBy: [-1],
    px: [0],
    py: [0],
  };
  const renderer = {
    pickSelectionHud: () => null,
    pickControlGroupHud: () => null,
    screenToGround: (x, y) => ({ x: x / 10, z: y / 10, y: 0 }),
    clientPickingRay: (cx, cy) => ({
      ox: cx / 10,
      oy: 20,
      oz: cy / 10,
      dx: 0,
      dy: -1,
      dz: 0,
    }),
    rayHitSpheresAllInto: () => 0,
    groundYAt: () => 0,
    setSelectionBox: () => {},
  };
  const input = createGameInput({
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    renderer,
    world,
    selected,
    localPlayerId: 0,
    getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
    enqueueCommand: (cmd) => cmds.push(cmd),
    getAgoras: () => [],
    getBuildings: () => [],
  });
  selected[0] = 1;
  input.setSelectedBuffer(selected);
  return { input, cmds };
}

function makePadSelectHarness(opts = {}) {
  const selected = new Uint8Array(4);
  const paths = [];
  const boxes = [];
  const brushes = [];
  const world = {
    count: 2,
    alive: [1, 1],
    owner: [0, 0],
    type: [1, 1],
    carriedBy: [-1, -1],
    px: [0, 0],
    py: [0, 0],
  };
  const xs = opts.worldX ?? [0, 800];
  const input = createGameInput({
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    renderer: {
      pickSelectionHud: () => null,
      pickControlGroupHud: () => null,
      screenToGround: () => ({ x: 0, z: 0, y: 0 }),
      worldToScreen: (x) => ({ x: 200 + x, y: 200 }),
      setSelectionBox: (a, b, c, d) => {
        if (a != null) boxes.push([a, b, c, d]);
      },
      setSelectionPath: (pts) => {
        if (pts) paths.push(pts);
      },
      setGamepadCursorBrush: (r) => {
        if (r > 0) brushes.push(r);
      },
    },
    world,
    selected,
    localPlayerId: 0,
    getUnitWorldPos: (i, out) => {
      out.x = xs[i] ?? 0;
      out.y = 0;
      out.z = 0;
      return out;
    },
    enqueueCommand: () => {},
    getAgoras: () => [],
    getBuildings: () => [],
  });
  return { input, selected, paths, boxes, brushes };
}

describe('gamepad select drag', () => {
  it('paints a brush lasso instead of a rubber-band and selects under the stroke', () => {
    const { input, selected, paths, boxes, brushes } = makePadSelectHarness();
    assert.equal(input.beginSelectDrag(200, 200), true);
    assert.equal(input.updateSelectDrag(260, 260), true);
    assert.equal(boxes.length, 0);
    assert.ok(paths.some((p) => p.length >= 3));
    assert.ok(brushes.at(-1) >= 36);
    assert.ok(brushes.at(-1) <= 72);
    assert.equal(input.endSelectDrag(260, 260), true);
    assert.equal(selected[0], 1);
    assert.equal(selected[1], 0);
  });

  it('walks a painted loop around the aim and keeps the hatch on the outer hull', () => {
    const { input, selected, paths } = makePadSelectHarness();
    assert.equal(input.beginSelectDrag(160, 160), true);
    const walk = [
      [240, 160],
      [240, 200],
      [240, 240],
      [200, 240],
      [160, 240],
      [160, 200],
    ];
    for (const [x, y] of walk) input.updateSelectDrag(x, y);
    assert.ok(paths.some((p) => p.length >= 3));
    assert.equal(input.endSelectDrag(160, 200), true);
    assert.equal(selected[0], 1);
    assert.equal(selected[1], 0);
  });

  it('doubles the brush to max size when both bumpers are down', () => {
    const { input, selected, brushes } = makePadSelectHarness({ worldX: [100, 800] });
    assert.equal(input.beginSelectDrag(200, 200, { both: true }), true);
    assert.equal(input.updateSelectDrag(200, 200, { both: true }), true);
    assert.equal(brushes.at(-1), 144);
    assert.equal(input.endSelectDrag(200, 200), true);
    assert.equal(selected[0], 1);
    assert.equal(selected[1], 0);
  });

  it('leaves a far unit outside a short single-bumper stroke', () => {
    const { input, selected, brushes } = makePadSelectHarness({ worldX: [100, 800] });
    assert.equal(input.beginSelectDrag(200, 200), true);
    assert.equal(input.updateSelectDrag(232, 200), true);
    assert.ok(brushes.at(-1) <= 72);
    assert.equal(input.endSelectDrag(232, 200), true);
    assert.equal(selected[0], 0);
    assert.equal(selected[1], 0);
  });
});

describe('gamepad trigger orders', () => {
  it('attack-moves on LT and force-moves on RT', async () => {
    const { input, cmds } = makeOrderHarness();
    assert.equal(input.attackMoveAt(200, 300), true);
    await new Promise((r) => setImmediate(r));
    assert.equal(cmds[0]?.type, CMD.ATTACK_MOVE);

    cmds.length = 0;
    assert.equal(input.forceMoveAt(200, 300), true);
    await new Promise((r) => setImmediate(r));
    assert.equal(cmds[0]?.type, CMD.MOVE);
  });

  it('casts the primary ability at the aim', () => {
    const { input, cmds } = makeOrderHarness();
    input.castAbilityAt(200, 300);
    assert.equal(cmds[0]?.type, CMD.CAST);
  });
});

describe('gamepad control groups', () => {
  function makeGroupHarness() {
    const selected = new Uint8Array(4);
    const world = {
      count: 1,
      alive: [1],
      owner: [0],
      type: [1],
      carriedBy: [-1],
      px: [0],
      py: [0],
    };
    const input = createGameInput({
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      renderer: {
        pickSelectionHud: () => null,
        pickControlGroupHud: () => null,
        screenToGround: () => ({ x: 0, z: 0, y: 0 }),
        setSelectionBox: () => {},
        setControlGroupHold: () => {},
        setControlGroupCount: () => {},
      },
      world,
      selected,
      localPlayerId: 0,
      getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
      enqueueCommand: () => {},
      getAgoras: () => [],
      getBuildings: () => [],
    });
    selected[0] = 1;
    input.setSelectedBuffer(selected);
    return { input, selected };
  }

  it('hold-assign then tap-selects; cancel does not tap', () => {
    const { input, selected } = makeGroupHarness();
    assert.equal(input.handleControlGroupDown(0, { assignNow: true }), true);
    input.clearSelection();
    assert.equal(selected[0], 0);

    assert.equal(input.handleControlGroupDown(0), true);
    assert.equal(input.handleControlGroupUp(0), true);
    assert.equal(selected[0], 1);

    input.clearSelection();
    assert.equal(input.handleControlGroupDown(5), true);
    assert.equal(input.handleControlGroupCancel(), true);
    assert.equal(input.handleControlGroupUp(5), false);
    assert.equal(selected[0], 0);
  });

  it('binds the owned agora to black on wire-up and after a reset', () => {
    const selected = new Uint8Array(4);
    const world = {
      count: 0,
      alive: [],
      owner: [],
      type: [],
      carriedBy: [],
      px: [],
      py: [],
    };
    const agoras = [{ owner: 1 }, { owner: 0 }];
    const input = createGameInput({
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      renderer: {
        pickSelectionHud: () => null,
        pickControlGroupHud: () => null,
        screenToGround: () => ({ x: 0, z: 0, y: 0 }),
        setSelectionBox: () => {},
        setControlGroupHold: () => {},
        setControlGroupCount: () => {},
      },
      world,
      selected,
      localPlayerId: 0,
      getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
      enqueueCommand: () => {},
      getAgoras: () => agoras,
      getBuildings: () => [],
    });

    assert.equal(input.handleControlGroupDown(CONTROL_GROUP_BLACK), true);
    assert.equal(input.handleControlGroupUp(CONTROL_GROUP_BLACK), true);
    assert.deepEqual(input.getSelectedBuilding(), { kind: 'agora', index: 1 });

    input.clearSelection();
    input.clearControlGroups();
    assert.equal(input.handleControlGroupDown(CONTROL_GROUP_BLACK), true);
    assert.equal(input.handleControlGroupUp(CONTROL_GROUP_BLACK), true);
    assert.deepEqual(input.getSelectedBuilding(), { kind: 'agora', index: 1 });
  });
});

describe('park then 1^ placement', () => {
  it('click parks the ghost; 1^ stamps; rotate release does not', async () => {
    const { input, confirms, parks, setConfirmHit, getYaw } = makePlaceHarness();
    input.handlePointerDown(placePtr({ clientX: 200, clientY: 200 }));
    await input.handlePointerUp(placePtr({ type: 'pointerup', clientX: 200, clientY: 200 }));
    assert.equal(confirms.length, 0);
    assert.equal(parks.at(-1), true);

    input.handlePointerDown(placePtr({ clientX: 200, clientY: 200 }));
    input.handlePointerMove(placePtr({ type: 'pointermove', clientX: 260, clientY: 200 }));
    await input.handlePointerUp(placePtr({ type: 'pointerup', clientX: 260, clientY: 200 }));
    assert.equal(confirms.length, 0);
    assert.ok(Math.abs(getYaw()) > 0);

    setConfirmHit(true);
    input.handlePointerDown(placePtr({ clientX: 200, clientY: 200 }));
    await input.handlePointerUp(placePtr({ type: 'pointerup', clientX: 200, clientY: 200 }));
    assert.equal(confirms.length, 1);
    assert.equal(parks.at(-1), false);
  });
});

describe('gamepad placement', () => {
  it('preview follows the aim, A stamps, bumpers yaw, cancel leaves', () => {
    const { input, confirms, getYaw } = makePlaceHarness();
    assert.equal(input.previewPlacementAt(200, 300), true);
    assert.equal(input.nudgePlacementYaw(1), true);
    assert.equal(getYaw(), BUILDING_YAW_SNAP);
    assert.equal(input.confirmPlacementAt(220, 310), true);
    assert.equal(confirms.length, 1);
    assert.equal(confirms[0].x, 22);
    assert.equal(confirms[0].z, 31);
    assert.equal(confirms[0].y, BUILDING_YAW_SNAP);
    assert.equal(input.cancelPlacement(), true);
    assert.equal(input.isPlacing(), false);
  });

  it('does not stamp when the ghost is blocked', () => {
    let placing = 'camp';
    const stamps = [];
    const blocked = createGameInput({
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      renderer: {
        pickSelectionHud: () => null,
        pickControlGroupHud: () => null,
        screenToGround: (x, y) => ({ x: x / 10, z: y / 10 }),
        setSelectionBox: () => {},
      },
      world: { count: 0, alive: [], owner: [], type: [], carriedBy: [] },
      selected: new Uint8Array(8),
      localPlayerId: 0,
      getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
      enqueueCommand: () => {},
      getPlacingType: () => placing,
      setPlacingType: (t) => { placing = t; },
      onPlacementMove: (x, z) => ({ x, z, valid: false }),
      onPlacementConfirm: () => {
        stamps.push(1);
        return false;
      },
      getAgoras: () => [],
      getBuildings: () => [],
    });
    assert.equal(blocked.previewPlacementAt(100, 100), true);
    assert.equal(blocked.confirmPlacementAt(100, 100), false);
    assert.equal(stamps.length, 1);
  });

  it('walks and plants a rally at the aim', () => {
    const moves = [];
    const plants = [];
    let rallying = true;
    const input = createGameInput({
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
      renderer: {
        pickSelectionHud: () => null,
        pickControlGroupHud: () => null,
        screenToGround: (x, y) => ({ x: x / 10, z: y / 10 }),
        setSelectionBox: () => {},
      },
      world: { count: 0, alive: [], owner: [], type: [], carriedBy: [] },
      selected: new Uint8Array(8),
      localPlayerId: 0,
      getUnitWorldPos: () => ({ x: 0, y: 0, z: 0 }),
      enqueueCommand: () => {},
      getPlacingType: () => null,
      isPlacingRally: () => rallying,
      onRallyMove: (x, z) => moves.push({ x, z }),
      onRallyConfirm: (x, z) => plants.push({ x, z }),
      onRallyCancel: () => { rallying = false; },
      getAgoras: () => [],
      getBuildings: () => [],
    });
    assert.equal(input.isPlacing(), true);
    assert.equal(input.previewPlacementAt(80, 90), true);
    assert.deepEqual(moves.at(-1), { x: 8, z: 9 });
    assert.equal(input.nudgePlacementYaw(1), false);
    assert.equal(input.confirmPlacementAt(80, 90), true);
    assert.deepEqual(plants.at(-1), { x: 8, z: 9 });
    assert.equal(input.cancelPlacement(), true);
    assert.equal(rallying, false);
  });
});

