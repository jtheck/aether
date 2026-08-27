import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHIP_ABOVE_HEAD,
  CHIP_ABOVE_ROOF,
  CHIP_SCREEN_UP_PX,
  DEFAULT_BUILDING_ROOF,
  HEAD_HEIGHT_MUL,
  HORIZON_FADE_START,
  LOOK_DOWN_SCALE_MIN,
  TARGET_DOT_PX,
  chipHorizonScale,
  chipLookDownScale,
  chipScreenPixels,
  chipScreenUpDir,
  chipScreenUpPixels,
  meshRoofY,
  roofChipLift,
  unitChipLift,
  worldSizeForScreenPx,
  UNIT_CHIP_COUNT,
  BUILDING_CHIP_COUNT,
  chipBarState,
  chipSizeMul,
} from './healthBars.js';
import { CAMERA_CLOSE_SPAN, cameraZoomNormalized } from './cameraController.js';

describe('health chip placement', () => {
  it('lifts the row above pick-height (over the head, not the feet)', () => {
    const lift = unitChipLift(0, 1.1);
    assert.ok(lift > 1.1);
    assert.equal(lift, 1.1 * HEAD_HEIGHT_MUL + CHIP_ABOVE_HEAD);
  });

  it('includes flyer / lob loft in the lift', () => {
    assert.equal(unitChipLift(16, 1.1), 16 + 1.1 * HEAD_HEIGHT_MUL + CHIP_ABOVE_HEAD);
  });

  it('uses mesh roof Y when present', () => {
    const roof = meshRoofY([{ boundMax: [1, 9.4, 2] }, { boundMax: [0, 4, 0] }]);
    assert.equal(roof, 9.4);
    assert.equal(roofChipLift(roof), 9.4 + CHIP_ABOVE_ROOF);
  });

  it('falls back when the mesh is not loaded', () => {
    assert.equal(meshRoofY([]), 0);
    assert.equal(roofChipLift(0), DEFAULT_BUILDING_ROOF + CHIP_ABOVE_ROOF);
  });
});

describe('health chip screen-up lift', () => {
  it('points world +Y at the horizon and XZ when looking down', () => {
    const side = chipScreenUpDir(0, Math.PI / 2);
    assert.ok(Math.abs(side[0]) < 1e-6);
    assert.ok(Math.abs(side[1] - 1) < 1e-6);
    assert.ok(Math.abs(side[2]) < 1e-6);
    const down = chipScreenUpDir(0, 0);
    assert.ok(down[1] < 0.05);
    assert.ok(Math.hypot(down[0], down[1], down[2]) - 1 < 1e-6);
  });

  it('adds more screen-up pixels when the camera looks down', () => {
    const close = chipScreenUpPixels(1.2);
    const play = chipScreenUpPixels(0.82);
    assert.ok(close >= CHIP_SCREEN_UP_PX);
    assert.ok(play > close);
  });
});

describe('health chip screen-constant size', () => {
  it('holds the same pixel size up close and far', () => {
    const fov = 0.8;
    const vh = 1080;
    const close = worldSizeForScreenPx(TARGET_DOT_PX, 50, vh, fov);
    const far = worldSizeForScreenPx(TARGET_DOT_PX, 700, vh, fov);
    assert.ok(Math.abs(chipScreenPixels(close, 50, vh, fov) - TARGET_DOT_PX) < 1e-6);
    assert.ok(Math.abs(chipScreenPixels(far, 700, vh, fov) - TARGET_DOT_PX) < 1e-6);
    assert.ok(far > close * 10);
  });

  it('grows world size with distance and shrinks with viewport height', () => {
    const a = worldSizeForScreenPx(TARGET_DOT_PX, 100, 720, 0.8);
    const b = worldSizeForScreenPx(TARGET_DOT_PX, 200, 720, 0.8);
    const c = worldSizeForScreenPx(TARGET_DOT_PX, 100, 1440, 0.8);
    assert.ok(b > a);
    assert.ok(c < a);
  });
});

describe('health chip look-down shrink', () => {
  it('is full at closest zoom and smaller once the camera looks down', () => {
    assert.equal(chipLookDownScale(0), 1);
    assert.ok(chipLookDownScale(CAMERA_CLOSE_SPAN * 0.5) < 1);
    assert.equal(chipLookDownScale(CAMERA_CLOSE_SPAN), LOOK_DOWN_SCALE_MIN);
    assert.equal(chipLookDownScale(0.4), LOOK_DOWN_SCALE_MIN);
  });
});

describe('health chip horizon fade', () => {
  it('stays full until half zoom, then vanishes (size only)', () => {
    assert.equal(chipHorizonScale(0), 1);
    assert.equal(chipHorizonScale(HORIZON_FADE_START), 1);
    assert.equal(HORIZON_FADE_START, 0.5);
    const playN = cameraZoomNormalized(645, 50, 894);
    assert.ok(playN > HORIZON_FADE_START);
    assert.ok(chipHorizonScale(playN) > 0 && chipHorizonScale(playN) < 1);
    assert.equal(chipHorizonScale(1), 0);
  });
});

describe('health chip bars', () => {
  it('gives each HP third its own full bar', () => {
    const full = chipBarState(1, UNIT_CHIP_COUNT);
    assert.equal(full.filled, 7);
    assert.equal(full.band, 0);

    const lastGreen = chipBarState(2 / 3 + 1e-4, UNIT_CHIP_COUNT);
    assert.equal(lastGreen.filled, 1);
    assert.equal(lastGreen.band, 0);

    const yellowFull = chipBarState(2 / 3, UNIT_CHIP_COUNT);
    assert.equal(yellowFull.filled, 7);
    assert.equal(yellowFull.band, 1);

    const lastYellow = chipBarState(1 / 3 + 1e-4, UNIT_CHIP_COUNT);
    assert.equal(lastYellow.filled, 1);
    assert.equal(lastYellow.band, 1);

    const redFull = chipBarState(1 / 3, UNIT_CHIP_COUNT);
    assert.equal(redFull.filled, 7);
    assert.equal(redFull.band, 2);

    const lastRed = chipBarState(0.01, UNIT_CHIP_COUNT);
    assert.equal(lastRed.filled, 1);
    assert.equal(lastRed.band, 2);

    assert.equal(chipBarState(0, UNIT_CHIP_COUNT).filled, 0);
    assert.equal(chipBarState(1, BUILDING_CHIP_COUNT).filled, 9);
  });

  it('puts big chips on the ends (4 big / 3 small on units)', () => {
    assert.equal(chipSizeMul(0, UNIT_CHIP_COUNT), 1);
    assert.equal(chipSizeMul(6, UNIT_CHIP_COUNT), 1);
    assert.ok(chipSizeMul(1, UNIT_CHIP_COUNT) < 1);
    let big = 0;
    let small = 0;
    for (let i = 0; i < UNIT_CHIP_COUNT; i++) {
      if (chipSizeMul(i, UNIT_CHIP_COUNT) < 1) small++;
      else big++;
    }
    assert.equal(big, 4);
    assert.equal(small, 3);
    assert.equal(chipSizeMul(0, BUILDING_CHIP_COUNT), 1);
    assert.equal(chipSizeMul(8, BUILDING_CHIP_COUNT), 1);
    assert.ok(chipSizeMul(1, BUILDING_CHIP_COUNT) < 1);
  });
});
