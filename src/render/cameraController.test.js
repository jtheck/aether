import { describe, it } from 'node:test';
import {
  SKIRMISH_MAP_W,
  STRESS_CAMERA_CHUNKS,
  STRESS_CAMERA_HALF_F,
  STRESS_MAP_W,
  tilesForOddChunks,
  worldHalfFFromMap,
} from '../sim/field.js';
import assert from 'node:assert/strict';
import {
  FOLLOW_ZIP_RATE,
  RMB_PAN_DRAG_THRESHOLD_PX,
  ZOOM_TEND_HOME,
  ZOOM_TEND_NEAR,
  cameraPlayRadius,
  chaseToward,
  STORY_EASE_MS,
  createCameraController,
  resolveCameraHalfF,
  zoomTendCatch,
} from './cameraController.js';

function fakeCamera() {
  const target = {
    x: 0,
    y: 0,
    z: 0,
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  return { target, alpha: 0, beta: 1, radius: 80 };
}

describe('chaseToward', () => {
  it('moves toward the target without overshooting in one frame', () => {
    const a = chaseToward(0, 0, 100, 0, 1 / 60, FOLLOW_ZIP_RATE);
    assert.ok(a.x > 0 && a.x < 100);
    assert.equal(a.z, 0);
  });

  it('settles on the target after a short hold', () => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < 30; i++) {
      ({ x, z } = chaseToward(x, z, 80, -40, 1 / 60, FOLLOW_ZIP_RATE));
    }
    assert.ok(Math.abs(x - 80) < 0.5);
    assert.ok(Math.abs(z + 40) < 0.5);
  });

  it('stays put when already on the target', () => {
    const a = chaseToward(5, 7, 5, 7, 0.016, FOLLOW_ZIP_RATE);
    assert.equal(a.x, 5);
    assert.equal(a.z, 7);
  });
});

describe('easePose', () => {
  it('eases toward a beat without snapping, then lets the player keep the offset', () => {
    const cam = fakeCamera();
    cam.target.set(0, 0, 0);
    cam.radius = 80;
    cam.alpha = 0;
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.easePose({ x: 40, z: -20, radius: 200, alpha: 1 }, { unclamped: true, ms: STORY_EASE_MS });
    ctrl.tick(16);
    assert.ok(cam.target.x > 0 && cam.target.x < 40);
    assert.ok(cam.radius > 80 && cam.radius < 200);
    for (let i = 0; i < 80; i++) ctrl.tick(16);
    assert.ok(Math.abs(cam.target.x - 40) < 1);
    assert.ok(Math.abs(cam.radius - 200) < 2);
    ctrl.nudgePan(8, 0);
    ctrl.tick(16);
    assert.ok(cam.target.x > 40);
  });
});

describe('setPose', () => {
  it('writes target, radius, and alpha without follow', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.setPose({ x: 12, z: -8, radius: 45, alpha: 0.5 }, { unclamped: true });
    assert.equal(cam.target.x, 12);
    assert.equal(cam.target.z, -8);
    assert.equal(cam.radius, 45);
    assert.equal(cam.alpha, 0.5);
    assert.equal(ctrl.isFollowing(), false);
    assert.deepEqual(ctrl.getPose(), { x: 12, z: -8, radius: 45, alpha: 0.5 });
  });
});

describe('resolveCameraHalfF', () => {
  it('follows the table when no bound is authored', () => {
    assert.equal(resolveCameraHalfF(416, 0), 416);
    assert.equal(resolveCameraHalfF(416), 416);
  });

  it('keeps an authored box inside the table', () => {
    assert.equal(resolveCameraHalfF(416, 288), 288);
    assert.equal(resolveCameraHalfF(200, 800), 200);
  });

  it('gives stress a play box that covers the pie ring', () => {
    const loading = worldHalfFFromMap(SKIRMISH_MAP_W);
    const table = worldHalfFFromMap(STRESS_MAP_W);
    assert.equal(STRESS_CAMERA_HALF_F, worldHalfFFromMap(tilesForOddChunks(STRESS_CAMERA_CHUNKS)));
    assert.ok(STRESS_CAMERA_HALF_F > loading);
    assert.ok(STRESS_CAMERA_HALF_F < table);
  });
});

describe('setWorldHalfF', () => {
  it('relaxes pan and zoom when the board grows', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.lookAtXZ(180, 0);
    assert.equal(cam.target.x, 180);
    const oldZoomOut = cam.upperRadiusLimit;
    ctrl.setWorldHalfF(800);
    ctrl.lookAtXZ(600, 0);
    assert.equal(cam.target.x, 600);
    assert.ok(cam.upperRadiusLimit > oldZoomOut);
    ctrl.reset();
    assert.ok(Math.abs(cam.radius - 800 * 1.8) < 1e-6);
  });

  it('snaps the target onto the new table when the board shrinks', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 800 });
    ctrl.lookAtXZ(600, 0);
    assert.equal(cam.target.x, 600);
    ctrl.setWorldHalfF(200);
    assert.ok(cam.target.x <= 200 - 8);
    assert.ok(cam.target.x >= -200 + 8);
    assert.ok(cam.upperRadiusLimit <= 200 * 2.15 + 1e-6);
  });
});

function keyEvent(key) {
  return {
    key,
    code: `Key${key.toUpperCase()}`,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {},
  };
}

describe('camera keys', () => {
  it('W/R strafe the look target and S/F rotate yaw', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const startAlpha = cam.alpha;
    const startX = cam.target.x;
    const startZ = cam.target.z;

    ctrl.handleKeyDown(keyEvent('s'));
    ctrl.tick(16);
    ctrl.handleKeyUp(keyEvent('s'));
    assert.notEqual(cam.alpha, startAlpha);
    assert.equal(cam.target.x, startX);
    assert.equal(cam.target.z, startZ);

    const afterRot = cam.alpha;
    ctrl.handleKeyDown(keyEvent('w'));
    ctrl.tick(16);
    ctrl.handleKeyUp(keyEvent('w'));
    assert.equal(cam.alpha, afterRot);
    assert.ok(cam.target.x !== startX || cam.target.z !== startZ);
  });

  it('pans from a cold idle without a prior rotate or zoom', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const startX = cam.target.x;
    const startZ = cam.target.z;
    ctrl.handleKeyDown(keyEvent('e'));
    ctrl.tick(16);
    ctrl.handleKeyUp(keyEvent('e'));
    assert.ok(cam.target.x !== startX || cam.target.z !== startZ);
  });

  it('wakes pan after the camera has coasted idle', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.handleKeyDown(keyEvent('e'));
    ctrl.tick(16);
    ctrl.handleKeyUp(keyEvent('e'));
    for (let i = 0; i < 180; i++) ctrl.tick(16);
    const restX = cam.target.x;
    const restZ = cam.target.z;
    ctrl.handleKeyDown(keyEvent('w'));
    ctrl.tick(16);
    ctrl.handleKeyUp(keyEvent('w'));
    assert.ok(cam.target.x !== restX || cam.target.z !== restZ);
  });
});

describe('lookAtXZ', () => {
  it('snaps the target without entering follow', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.lookAtXZ(40, -20);
    assert.equal(cam.target.x, 40);
    assert.equal(cam.target.z, -20);
    assert.equal(ctrl.isFollowing(), false);
  });

  it('updates an active follow target so Space stay-lock does not snap back', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    ctrl.followXZ(10, 10);
    ctrl.lookAtXZ(30, 12);
    assert.equal(cam.target.x, 30);
    assert.equal(cam.target.z, 12);
    assert.equal(ctrl.isFollowing(), true);
  });
});

function fakeCanvas() {
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
    },
  };
}

function rmb(partial = {}) {
  return {
    pointerType: 'mouse',
    pointerId: 1,
    button: 2,
    clientX: 400,
    clientY: 300,
    preventDefault() {},
    ...partial,
  };
}

describe('RMB click vs pan', () => {
  it('treats a short RMB hold as a click, not a pan', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, fakeCanvas(), { worldHalfF: 200 });
    ctrl.handlePointerDown(rmb());
    ctrl.handlePointerMove(rmb({ clientX: 406, clientY: 302 }));
    ctrl.tick(16);
    assert.equal(cam.target.x, 0);
    assert.equal(cam.target.z, 0);
    assert.equal(ctrl.handlePointerUp(rmb({ clientX: 406, clientY: 302 })), false);
  });

  it('latches a drag so pointer-up does not count as a click', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, fakeCanvas(), { worldHalfF: 200 });
    ctrl.handlePointerDown(rmb());
    ctrl.handlePointerMove(rmb({ clientX: 400 + RMB_PAN_DRAG_THRESHOLD_PX + 4, clientY: 300 }));
    assert.equal(
      ctrl.handlePointerUp(rmb({ clientX: 400 + RMB_PAN_DRAG_THRESHOLD_PX + 4, clientY: 300 })),
      true,
    );
  });

  it('commits on pointer-up when travel skipped move events', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, fakeCanvas(), { worldHalfF: 200 });
    ctrl.handlePointerDown(rmb());
    assert.equal(
      ctrl.handlePointerUp(rmb({ clientX: 400 + RMB_PAN_DRAG_THRESHOLD_PX + 8, clientY: 300 })),
      true,
    );
  });
});

describe('zoomTendCatch', () => {
  const dest = 170;
  const home = 12;
  const near = 10;

  it('does not pull a stop-short toward the dest', () => {
    assert.equal(zoomTendCatch(dest + 40, dest, dest + 22, home, near), false);
  });

  it('holds a landing that is already on the dest', () => {
    assert.equal(zoomTendCatch(dest + 8, dest, dest + 4, home, near), true);
  });

  it('lets a fly-through keep going', () => {
    assert.equal(zoomTendCatch(dest + 8, dest, dest - 80, home, near), false);
  });

  it('ignores a toss that would stop far short of the trough', () => {
    assert.equal(zoomTendCatch(dest + 200, dest, dest + 160, home, near), false);
  });

  it('holds when already on the trough if leftover would only drift', () => {
    assert.equal(zoomTendCatch(dest, dest, dest + 6, home, near), true);
  });
});

describe('zoom tend to play gaze', () => {
  function playDest(cam) {
    return cameraPlayRadius(cam.lowerRadiusLimit, cam.upperRadiusLimit);
  }

  function coast(ctrl, ms) {
    const steps = Math.ceil(ms / 16);
    for (let i = 0; i < steps; i++) ctrl.tick(16);
  }

  it('does not pull a stop-short toward the look-down trough', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    cam.radius = dest + 45;
    ctrl.nudgeZoom(-1.2);
    coast(ctrl, 1200);
    assert.ok(cam.radius > dest + 5, `radius ${cam.radius} should stay short of ${dest}`);
  });

  it('does not pull back a toss that flies through the trough', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    cam.radius = dest + 45;
    ctrl.nudgeZoom(-14);
    coast(ctrl, 1200);
    assert.ok(cam.radius < dest - 20, `radius ${cam.radius} should stay past ${dest}`);
  });

  it('does not pull back a toss away from the trough', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    cam.radius = dest + 12;
    ctrl.nudgeZoom(2.4);
    coast(ctrl, 1200);
    assert.ok(cam.radius > dest + 20, `radius ${cam.radius} should keep going out from ${dest}`);
  });

  it('leaves an active scroll alone', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    cam.radius = dest + 70;
    const start = cam.radius;
    for (let i = 0; i < 20; i++) {
      ctrl.nudgeZoom(-2);
      ctrl.tick(16);
    }
    assert.ok(cam.radius < start - 15);
    assert.ok(Math.abs(cam.radius - dest) > ZOOM_TEND_NEAR * (cam.upperRadiusLimit - cam.lowerRadiusLimit));
  });

  it('does not pull a short zoom-out onto the trough', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    cam.radius = dest - 45;
    ctrl.nudgeZoom(1.2);
    coast(ctrl, 1200);
    assert.ok(cam.radius < dest - 5, `radius ${cam.radius} should stay short of ${dest}`);
  });

  it('holds a toss that actually lands on the trough', () => {
    const cam = fakeCamera();
    const ctrl = createCameraController(cam, {}, { worldHalfF: 200 });
    const dest = playDest(cam);
    const span = cam.upperRadiusLimit - cam.lowerRadiusLimit;
    cam.radius = dest + ZOOM_TEND_HOME * span * 0.5;
    ctrl.nudgeZoom(-0.25);
    coast(ctrl, 800);
    assert.ok(Math.abs(cam.radius - dest) < 1, `radius ${cam.radius} should stay on ${dest}`);
  });
});
