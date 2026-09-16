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
  TARGET_DOT_PX_FAR,
  chipHorizonScale,
  chipLookDownScale,
  chipScreenPixels,
  chipScreenUpDir,
  chipScreenUpPixels,
  meshRoofY,
  roofChipLift,
  unitChipLift,
  worldSizeForScreenPx,
  chipLineHeight,
  chipLineLayout,
  LINE_MIN_PX,
  LINE_ATLAS_HALF_MUL,
  LINE_RIGHT_TRIM,
  snapScreenYToPixelCenter,
  UNIT_CHIP_COUNT,
  BUILDING_CHIP_COUNT,
  chipBarState,
  chipBarFilled,
  chipDotAlpha,
  chipDotVisible,
  chipIsLeadingTeam,
  chipDotFrame,
  chipFillAlpha,
  chipFillRgb,
  CHIP_FILL_ALPHA_GREEN,
  CHIP_FILL_ALPHA_RED,
  CHIP_TEAM_FILL_ALPHA,
  chipIsTeamDot,
  chipSizeMul,
  chipWidthMul,
  underDotCount,
  UNDER_DOT_MAX,
  MANA_BANK_DOTS,
  DOT_DIAMETER_UNDER_MUL,
  RGB_MANA,
  RGB_SEAT,
  underDotRgb,
  DOT_ALTERNATE_WIDTH_MUL,
  AGORA_CHIP_COUNT,
  AGORA_LARGE_CHIP_COUNT,
  AGORA_TINT_NEUTRAL,
  agoraChipFilled,
  agoraChipIsSmall,
  agoraChipLeadIndex,
  agoraChipPulseMul,
  agoraChipRgb,
  agoraChipSizeMul,
  agoraChipTintOwner,
  agoraCaptureMix,
  agoraPropTint,
  AGORA_CAPTURER_LIFT,
  AGORA_CAPTURER_PULSE_MUL,
  DOT_DIAMETER_AGORA_LARGE_MUL,
  DOT_DIAMETER_AGORA_SMALL_MUL,
  DOT_SPACING_AGORA_MUL,
  CHIP_BIG_CORNER_MUL,
  CHIP_LEAD_CORNER_MUL,
  CHIP_BASELINE_MUL,
  CHIP_BASELINE_ALPHA,
  CHIP_BODY_ALPHA,
  CHIP_EDGE_ALPHA,
  CHIP_SMALL_CORNER_MUL,
  DOT_DIAMETER_ALTERNATE_MUL,
  DOT_DIAMETER_FIRST_MUL,
  DOT_DIAMETER_LEAD_MUL,
} from './healthBars.js';
import { OWNER_TINTS, ownerTint, setLocalOwnerTint } from './ownerTints.js';
import { CAMERA_CLOSE_SPAN, cameraZoomNormalized } from './cameraController.js';
import {
  HEALTH_BAR_CAPACITY,
  OVERLAY_MAX_BARS,
  OVERLAY_MAX_BUILDING_BARS,
  OVERLAY_MAX_SHIELDS,
} from './overlayLod.js';

describe('health chip overlay budget', () => {
  it('keeps the billboard pool overlay-sized, not entity-scaled', () => {
    assert.equal(HEALTH_BAR_CAPACITY, OVERLAY_MAX_BARS + OVERLAY_MAX_BUILDING_BARS);
    assert.ok(HEALTH_BAR_CAPACITY <= 4096);
    assert.ok(OVERLAY_MAX_BARS >= 3072);
    assert.ok(OVERLAY_MAX_SHIELDS <= 256);
  });
});

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

  it('uses a smaller far-step pixel target', () => {
    assert.equal(TARGET_DOT_PX_FAR, TARGET_DOT_PX * 0.5);
    const fov = 0.8;
    const vh = 1080;
    const near = worldSizeForScreenPx(TARGET_DOT_PX, 200, vh, fov);
    const far = worldSizeForScreenPx(TARGET_DOT_PX_FAR, 200, vh, fov);
    assert.ok(far < near);
    assert.ok(Math.abs(chipScreenPixels(far, 200, vh, fov) - TARGET_DOT_PX_FAR) < 1e-6);
  });

  it('keeps the underline one pixel and fills the atlas cell', () => {
    const fov = 0.8;
    const vh = 1080;
    assert.equal(LINE_MIN_PX, 1);
    assert.ok(LINE_ATLAS_HALF_MUL > 0.4);
    const tiny = 0.01;
    const far = chipLineHeight(tiny, 400, vh, fov);
    assert.ok(Math.abs(chipScreenPixels(far, 400, vh, fov) - LINE_MIN_PX) < 1e-6);
    const close = chipLineHeight(2, 80, vh, fov);
    assert.ok(Math.abs(chipScreenPixels(close, 80, vh, fov) - LINE_MIN_PX) < 1e-6);
  });

  it('trims a third of the underline from the right', () => {
    assert.equal(LINE_RIGHT_TRIM, 1 / 3);
    const totalWidth = 6;
    const spacing = 1;
    const full = totalWidth + spacing * 0.55;
    const { width, along } = chipLineLayout(totalWidth, spacing);
    assert.ok(Math.abs(width - full * (2 / 3)) < 1e-6);
    const left = along - width * 0.5;
    const right = along + width * 0.5;
    assert.ok(Math.abs(left + full * 0.5) < 1e-6);
    assert.ok(right < full * 0.5 - 1e-6);
  });

  it('snaps the underline onto a device-pixel center', () => {
    assert.equal(snapScreenYToPixelCenter(50, 1), 50.5);
    assert.equal(snapScreenYToPixelCenter(50.4, 1), 50.5);
    assert.equal(snapScreenYToPixelCenter(50.9, 1), 50.5);
    assert.equal(snapScreenYToPixelCenter(50.25, 2), 50.25);
    assert.equal(snapScreenYToPixelCenter(50.4, 2), 50.25);
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
  it('uses one bar and changes color at 66% and 33%', () => {
    const full = chipBarState(1, UNIT_CHIP_COUNT);
    assert.equal(full.filled, 7);
    assert.equal(full.band, 0);

    const lastGreen = chipBarState(2 / 3 + 1e-4, UNIT_CHIP_COUNT);
    assert.equal(lastGreen.filled, 5);
    assert.equal(lastGreen.band, 0);

    const yellowAtTwoThirds = chipBarState(2 / 3, UNIT_CHIP_COUNT);
    assert.equal(yellowAtTwoThirds.filled, 5);
    assert.equal(yellowAtTwoThirds.band, 1);

    const lastYellow = chipBarState(1 / 3 + 1e-4, UNIT_CHIP_COUNT);
    assert.equal(lastYellow.filled, 3);
    assert.equal(lastYellow.band, 1);

    const redAtOneThird = chipBarState(1 / 3, UNIT_CHIP_COUNT);
    assert.equal(redAtOneThird.filled, 3);
    assert.equal(redAtOneThird.band, 2);

    const lastRed = chipBarState(0.01, UNIT_CHIP_COUNT);
    assert.equal(lastRed.filled, 1);
    assert.equal(lastRed.band, 2);

    assert.equal(chipBarState(0, UNIT_CHIP_COUNT).filled, 0);
    assert.equal(chipBarState(1, BUILDING_CHIP_COUNT).filled, 9);
    assert.equal(chipBarFilled(0.01, UNIT_CHIP_COUNT, 1), 0);
    assert.equal(chipBarFilled(0.01, UNIT_CHIP_COUNT, 2), 1);
    assert.ok(chipBarFilled(1, UNIT_CHIP_COUNT, 50) > 1);
  });

  it('uses health alpha on HP chips and keeps the left team pip separate', () => {
    assert.equal(CHIP_FILL_ALPHA_GREEN, 0.5);
    assert.equal(CHIP_FILL_ALPHA_RED, 1);
    assert.equal(chipFillAlpha(1), CHIP_FILL_ALPHA_GREEN);
    assert.equal(chipFillAlpha(0), CHIP_FILL_ALPHA_RED);
    assert.equal(chipDotAlpha(0, true, 1), CHIP_FILL_ALPHA_GREEN);
    assert.equal(chipDotAlpha(0, true, 0), CHIP_FILL_ALPHA_RED);
    assert.equal(chipDotAlpha(1, true, 0), CHIP_FILL_ALPHA_RED);
    assert.equal(CHIP_TEAM_FILL_ALPHA, 1);
    assert.equal(chipDotAlpha(0, false, 0), 1);
    assert.equal(chipIsLeadingTeam(9), true);
    assert.equal(chipIsLeadingTeam(0), false);
    assert.equal(chipDotVisible(0, 1), true);
    assert.equal(chipDotVisible(1, 1), false);
    assert.equal(chipDotVisible(0, 0), false);
  });

  it('rounds HP chips; the left team pip is a circle', () => {
    assert.equal(CHIP_SMALL_CORNER_MUL, CHIP_BIG_CORNER_MUL);
    assert.equal(CHIP_LEAD_CORNER_MUL, 1);
    assert.ok(CHIP_BIG_CORNER_MUL > 0.36);
    assert.ok(CHIP_BIG_CORNER_MUL < 0.7);
    assert.equal(chipDotFrame(0), 0);
    assert.equal(chipDotFrame(1), 0);
    assert.equal(chipDotFrame(2), 0);
    assert.ok(CHIP_BASELINE_MUL > 0.05 && CHIP_BASELINE_MUL < 0.12);
    assert.equal(CHIP_BASELINE_ALPHA, 0.5);
    assert.equal(CHIP_BODY_ALPHA, 0.85);
    assert.ok(CHIP_BODY_ALPHA < CHIP_EDGE_ALPHA);
    assert.ok(CHIP_BASELINE_ALPHA < CHIP_BODY_ALPHA);
    assert.equal(CHIP_EDGE_ALPHA, 1);
  });

  it('keeps team color off the HP chips', () => {
    setLocalOwnerTint(-1, null);
    const hp = chipBarState(1, UNIT_CHIP_COUNT).rgb;
    assert.equal(chipIsTeamDot(0), false);
    assert.equal(chipIsTeamDot(1), false);
    assert.deepEqual(chipFillRgb(0, hp, 1), hp);
    assert.deepEqual(chipFillRgb(1, hp, 1), hp);
    assert.notDeepEqual(hp, OWNER_TINTS[1]);
  });

  it('uses even HP chips and a smaller dark-blue mana bauble', () => {
    assert.ok(chipSizeMul(0, UNIT_CHIP_COUNT) > chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.equal(chipSizeMul(0, UNIT_CHIP_COUNT), DOT_DIAMETER_FIRST_MUL);
    assert.equal(chipSizeMul(6, UNIT_CHIP_COUNT), chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.equal(chipSizeMul(1, UNIT_CHIP_COUNT), chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.equal(chipSizeMul(0, BUILDING_CHIP_COUNT), chipSizeMul(0, UNIT_CHIP_COUNT));
    assert.equal(chipSizeMul(8, BUILDING_CHIP_COUNT), chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.equal(DOT_DIAMETER_ALTERNATE_MUL, 0.58);
    assert.equal(DOT_ALTERNATE_WIDTH_MUL, 1);
    assert.equal(chipWidthMul(1), 1);
    assert.equal(chipWidthMul(0), 1);
    assert.ok(DOT_DIAMETER_LEAD_MUL > chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.ok(DOT_DIAMETER_UNDER_MUL < chipSizeMul(2, UNIT_CHIP_COUNT));
    assert.ok(RGB_MANA[2] > RGB_MANA[0] && RGB_MANA[2] > RGB_MANA[1]);
    assert.ok(RGB_MANA[1] < RGB_MANA[2] * 0.55);
    assert.ok(RGB_MANA[2] - Math.min(RGB_MANA[0], RGB_MANA[1]) > 0.45);
    assert.ok(DOT_SPACING_AGORA_MUL > 1);
    assert.equal(underDotCount({ manaReady: 3 }), MANA_BANK_DOTS);
    assert.equal(underDotCount({ manaReady: 1 }), 1);
    assert.equal(underDotCount({ seatsFilled: 4 }), 4);
    assert.equal(underDotCount({ seatsFilled: 8 }), UNDER_DOT_MAX);
    assert.equal(underDotCount({ building: true, manaReady: 3 }), 0);
    assert.equal(underDotCount({ agora: true, seatsFilled: 2 }), 0);
    assert.equal(underDotCount({ seatsFilled: 2, manaReady: 3 }), 2);
    assert.deepEqual(underDotRgb({ manaReady: 3 }), RGB_MANA);
    assert.deepEqual(underDotRgb({ seatsFilled: 2 }), RGB_SEAT);
    assert.ok(Math.abs(RGB_SEAT[0] - RGB_SEAT[1]) < 0.06);
    assert.ok(RGB_SEAT[2] > RGB_SEAT[0]);
  });

  it('uses 9 alternating circles; invade from the right, tug from the left', () => {
    assert.equal(AGORA_CHIP_COUNT, 9);
    assert.equal(AGORA_LARGE_CHIP_COUNT, 5);
    assert.ok(DOT_DIAMETER_AGORA_LARGE_MUL > DOT_DIAMETER_AGORA_SMALL_MUL);
    assert.ok(DOT_DIAMETER_AGORA_LARGE_MUL > DOT_DIAMETER_FIRST_MUL);
    assert.equal(agoraChipSizeMul(0), DOT_DIAMETER_AGORA_LARGE_MUL);
    assert.equal(agoraChipSizeMul(1), DOT_DIAMETER_AGORA_SMALL_MUL);
    assert.equal(agoraChipIsSmall(1), true);
    assert.equal(agoraChipFilled(0), 0);
    assert.equal(agoraChipFilled(1, 9, 300), 1);
    assert.equal(agoraChipFilled(300, 9, 300), 9);
    const invade = { progress: 1, capturer: 1, owner: 0, count: 9 };
    assert.equal(agoraChipTintOwner(8, invade), 1);
    assert.equal(agoraChipTintOwner(0, invade), 0);
    const tug = { phase: 1, tug: 1, capturer: 1, owner: 0, founder: 0 };
    assert.equal(agoraChipTintOwner(1, tug), 0);
    assert.equal(agoraChipTintOwner(0, tug), 1);
    assert.equal(agoraChipTintOwner(2, tug), AGORA_TINT_NEUTRAL);
    assert.equal(agoraChipTintOwner(3, tug), 0);
    const invadeLead = { progress: 1, capturer: 1, owner: 0, count: 9 };
    assert.equal(agoraChipLeadIndex(invadeLead), 8);
    const tugLead = { phase: 1, tug: 1, capturer: 1, owner: 0, founder: 0 };
    assert.equal(agoraChipLeadIndex(tugLead), 0);
    assert.equal(agoraChipPulseMul(2, tugLead, 0), 1);
    assert.ok(agoraChipPulseMul(0, tugLead, 0) > 1);
    assert.ok(agoraChipPulseMul(0, tugLead, 99) > agoraChipPulseMul(0, tugLead, 0));
    const invadeRow = { progress: 100, capturer: 1, owner: 0, count: 9 };
    assert.equal(agoraChipLeadIndex(invadeRow), 6);
    assert.ok(agoraChipPulseMul(6, invadeRow, 0) > agoraChipPulseMul(7, invadeRow, 0));
    assert.ok(agoraChipPulseMul(7, invadeRow, 0) > 1);
    assert.equal(agoraChipPulseMul(0, invadeRow, 0), 1);
    const lifted = agoraChipRgb(8, { progress: 1, capturer: 1, owner: 0, count: 9 });
    const base = ownerTint(1);
    assert.ok(lifted[1] > base[1]);
    assert.ok(agoraCaptureMix({ capturer: 1, progress: 150 }) > 0.4);
    assert.equal(agoraCaptureMix({ owner: 0, progress: 150 }), 0);
    const idle = agoraPropTint({ owner: 0 });
    const mixed = agoraPropTint({ owner: 0, capturer: 1, progress: 300 });
    assert.deepEqual(idle, ownerTint(0));
    assert.ok(Math.abs(mixed[0] - ownerTint(1)[0]) < Math.abs(idle[0] - ownerTint(1)[0]));
    assert.ok(AGORA_CAPTURER_LIFT > 0);
    assert.ok(AGORA_CAPTURER_PULSE_MUL > 0);
  });
});
