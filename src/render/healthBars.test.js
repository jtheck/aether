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
  chipLineHeight,
  chipLineLayout,
  manaRingLit,
  MANA_RING_DIM,
  teamWedgeBounds,
  teamWedgeBottom,
  teamWedgeLayout,
  teamEdgeRgb,
  teamWedgeOnEdge,
  teamWedgeTop,
  TEAM_WEDGE_EDGE_LIFT,
  TEAM_WEDGE_INSET,
  TEAM_WEDGE_SHORT_PX,
  TEAM_WEDGE_SQRT3,
  TEAM_WEDGE_X_LEFT,
  TEAM_WEDGE_X_TIP,
  TEAM_WEDGE_Y_LINE,
  TEAM_WEDGE_Y_LOW,
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
  RGB_MANA_RING,
  RGB_SEAT,
  underDotRgb,
  underDotTint,
  underDotFrame,
  DOT_ALTERNATE_WIDTH_MUL,
  AGORA_CHIP_COUNT,
  AGORA_DASH_COUNT,
  AGORA_SEG_COUNT,
  AGORA_FX_INK,
  AGORA_FX_DANDELION,
  AGORA_FX_MIX,
  AGORA_LARGE_CHIP_COUNT,
  AGORA_TINT_NEUTRAL,
  agoraChipFilled,
  agoraChipIsSmall,
  agoraChipLeadIndex,
  agoraChipPulseMul,
  agoraChipRgb,
  agoraChipSizeMul,
  agoraChipTintOwner,
  agoraDashFill,
  agoraDashFillAlong,
  agoraDashFillRgb,
  agoraMeterParts,
  agoraRowLayout,
  agoraFlipStyle,
  agoraFlipFxKind,
  agoraFlipOrders,
  agoraQueuedFlips,
  agoraFromRight,
  agoraIsNeutral,
  emitAgoraDandelion,
  emitAgoraFlipFx,
  agoraUnlockDotBeat,
  agoraUnlockTimings,
  pickAgoraWind,
  agoraClaimedDotIndex,
  agoraCaptureMix,
  agoraLeadBlinkBlack,
  agoraProgressRatio,
  agoraPropTint,
  AGORA_CAPTURER_LIFT,
  AGORA_LEAD_PULSE_MUL,
  AGORA_BLINK_PERIOD_MS,
  AGORA_CONTESTED_RGB,
  AGORA_INK_RGB,
  AGORA_DASH_FILL_RGB,
  AGORA_DASH_TRACK_RGB,
  AGORA_FLIP_DROP_END,
  DOT_DIAMETER_AGORA_LARGE_MUL,
  DOT_DIAMETER_AGORA_DASH_W_MUL,
  DOT_DIAMETER_AGORA_DASH_H_MUL,
  DOT_DIAMETER_AGORA_SMALL_MUL,
  DOT_SPACING_AGORA_MUL,
  CHIP_BIG_CORNER_MUL,
  CHIP_LEAD_CORNER_MUL,
  CHIP_BASELINE_MUL,
  CHIP_BASELINE_ALPHA,
  CHIP_BODY_ALPHA,
  CHIP_EDGE_ALPHA,
  CHIP_RIGHT_MUL,
  CHIP_RIGHT_SHADE,
  hpChipShade,
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
  keepNearest,
} from './overlayLod.js';

describe('health chip overlay budget', () => {
  it('keeps the billboard pool overlay-sized, not entity-scaled', () => {
    assert.equal(HEALTH_BAR_CAPACITY, OVERLAY_MAX_BARS + OVERLAY_MAX_BUILDING_BARS);
    assert.ok(HEALTH_BAR_CAPACITY <= 4096);
    assert.ok(OVERLAY_MAX_BARS >= 3072);
    assert.ok(OVERLAY_MAX_SHIELDS >= 256);
    assert.ok(OVERLAY_MAX_SHIELDS <= 2048);
  });

  it('keeps the nearest shield candidates when the pool overflows', () => {
    const ids = new Int32Array([0, 1, 2, 3]);
    const d2 = new Float32Array([9, 1, 4, 16]);
    const n = keepNearest(ids, d2, 4, 2);
    assert.equal(n, 2);
    const picked = new Set([ids[0], ids[1]]);
    assert.equal(picked.has(1), true);
    assert.equal(picked.has(2), true);
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

  it('hangs a 30-60-90 under the line with the short edge on the left', () => {
    const size = 64;
    const g = teamWedgeBounds(size);
    const lineTop = g.yLine - g.lineH * 0.5;
    const lineBot = g.yLine + g.lineH * 0.5;
    const leftTop = teamWedgeTop(g.xL, size);
    const leftBot = teamWedgeBottom(g.xL, size);
    const midPx = (g.xL + g.x1) * 0.5;
    const midBot = teamWedgeBottom(midPx, size);
    assert.equal(teamWedgeTop(g.xL - 1, size), null);
    assert.equal(leftTop, lineTop);
    assert.equal(teamWedgeTop(g.x1, size), lineTop);
    assert.equal(leftBot, g.yLow);
    assert.equal(g.yLow, size * TEAM_WEDGE_Y_LOW);
    assert.ok(leftBot > lineBot);
    assert.ok(Math.abs(teamWedgeBottom(g.x1, size) - lineBot) < 1e-6);
    assert.ok(Math.abs(midBot - (leftBot + lineBot) * 0.5) < 1e-6);
    assert.ok(g.yLine < 0 && g.yLow > g.yLine);
    assert.equal(teamWedgeOnEdge(g.xL + 1, size), true);
    assert.equal(teamWedgeOnEdge(midPx, size), false);
    const lit = teamEdgeRgb([0.2, 0.5, 1]);
    assert.ok(lit[0] > 0.2 && lit[1] > 0.5 && lit[2] === 1);
    assert.ok(Math.abs(lit[0] - (0.2 + 0.8 * TEAM_WEDGE_EDGE_LIFT)) < 1e-6);
    const spacing = 0.82;
    const totalWidth = (UNIT_CHIP_COUNT - 1) * spacing;
    const wedge = teamWedgeLayout(totalWidth, spacing, 1);
    const { width: lineW, along: lineAlong } = chipLineLayout(totalWidth, spacing);
    const lineLeft = lineAlong - lineW * 0.5;
    const spanX = TEAM_WEDGE_X_TIP - TEAM_WEDGE_X_LEFT;
    const spanY = TEAM_WEDGE_Y_LOW - TEAM_WEDGE_Y_LINE;
    const longLeg = spanX * wedge.width;
    const shortLeg = spanY * wedge.height;
    assert.ok(Math.abs(longLeg / shortLeg - TEAM_WEDGE_SQRT3) < 1e-6);
    assert.ok(Math.abs(TEAM_WEDGE_SQRT3 - Math.sqrt(3)) < 1e-12);
    assert.equal(TEAM_WEDGE_SHORT_PX, 8);
    const tip = wedge.along + TEAM_WEDGE_X_TIP * wedge.width;
    const left = wedge.along + TEAM_WEDGE_X_LEFT * wedge.width;
    assert.ok(Math.abs(tip - (lineLeft + longLeg * TEAM_WEDGE_INSET)) < 1e-6);
    assert.ok(tip > lineLeft);
    assert.ok(left < lineLeft);
    assert.ok(Math.abs(wedge.baselineShift - TEAM_WEDGE_Y_LINE * wedge.height) < 1e-6);
    assert.ok(TEAM_WEDGE_INSET > 0.5);
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

  it('rounds HP chips; the circle frame stays round', () => {
    assert.equal(CHIP_SMALL_CORNER_MUL, CHIP_BIG_CORNER_MUL);
    assert.equal(CHIP_LEAD_CORNER_MUL, 1);
    assert.ok(CHIP_BIG_CORNER_MUL > 0.36);
    assert.ok(CHIP_BIG_CORNER_MUL < 0.7);
    assert.equal(chipDotFrame(0), 0);
    assert.equal(chipDotFrame(1), 0);
    assert.equal(chipDotFrame(2), 0);
    assert.ok(CHIP_BASELINE_MUL > 0.05 && CHIP_BASELINE_MUL < 0.12);
    assert.equal(CHIP_BASELINE_ALPHA, 0.5);
    assert.equal(CHIP_BODY_ALPHA, 0.55);
    assert.ok(CHIP_BODY_ALPHA < CHIP_EDGE_ALPHA);
    assert.ok(CHIP_BASELINE_ALPHA < CHIP_BODY_ALPHA);
    assert.equal(CHIP_EDGE_ALPHA, 1);
    assert.equal(CHIP_RIGHT_SHADE, 1);
    assert.ok(CHIP_RIGHT_MUL > CHIP_BASELINE_MUL);
    assert.ok(CHIP_RIGHT_SHADE > CHIP_BODY_ALPHA);
    const half = 10;
    const line = half * (CHIP_BASELINE_MUL / 0.36);
    const right = half * (CHIP_RIGHT_MUL / 0.36);
    assert.equal(hpChipShade(0, -half + line * 0.5, half), CHIP_EDGE_ALPHA);
    assert.equal(hpChipShade(half - right * 0.5, 0, half), CHIP_RIGHT_SHADE);
    assert.equal(hpChipShade(-half + line * 0.5, 0, half), CHIP_BODY_ALPHA);
    assert.equal(hpChipShade(0, 0, half), CHIP_BODY_ALPHA);
    assert.equal(hpChipShade(0, half - line * 0.5, half), CHIP_BASELINE_ALPHA);
    assert.ok(hpChipShade(half - right * 0.5, 0, half) > hpChipShade(0, 0, half));
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
    assert.deepEqual(underDotTint({ manaReady: 3 }), RGB_MANA_RING);
    assert.ok(RGB_MANA_RING[0] > RGB_MANA[0] && RGB_MANA_RING[1] > RGB_MANA[1] && RGB_MANA_RING[2] >= RGB_MANA[2]);
    assert.ok(RGB_MANA_RING[0] < 0.55 && RGB_MANA_RING[1] < 0.75);
    assert.equal(manaRingLit(1, 1), 1);
    assert.equal(manaRingLit(-1, -1), 0);
    assert.equal(manaRingLit(1, 0), 1);
    assert.equal(manaRingLit(0, 1), 1);
    assert.ok(manaRingLit(1, 0) > manaRingLit(-1, 0));
    assert.ok(manaRingLit(0, 1) > manaRingLit(0, -1));
    assert.ok(MANA_RING_DIM > 0.15 && MANA_RING_DIM < 0.5);
    assert.notEqual(underDotFrame({ manaReady: 3 }), underDotFrame({ seatsFilled: 2 }));
    assert.equal(underDotFrame({ seatsFilled: 2, manaReady: 3 }), underDotFrame({ seatsFilled: 1 }));
    assert.deepEqual(underDotTint({ seatsFilled: 2 }), RGB_SEAT);
    assert.deepEqual(underDotRgb({ seatsFilled: 2 }), RGB_SEAT);
    assert.ok(Math.abs(RGB_SEAT[0] - RGB_SEAT[1]) < 0.06);
    assert.ok(RGB_SEAT[2] > RGB_SEAT[0]);
  });

  it('uses 5 dots o-o-o-o-o; contest right-to-left inks, gain left-to-right seeds', () => {
    assert.equal(AGORA_CHIP_COUNT, 5);
    assert.equal(AGORA_DASH_COUNT, 4);
    assert.equal(AGORA_SEG_COUNT, 5);
    assert.equal(AGORA_LARGE_CHIP_COUNT, 5);
    assert.ok(DOT_DIAMETER_AGORA_LARGE_MUL > DOT_DIAMETER_AGORA_DASH_H_MUL);
    assert.ok(DOT_DIAMETER_AGORA_DASH_W_MUL / DOT_DIAMETER_AGORA_DASH_H_MUL < 1.4);
    assert.ok(DOT_DIAMETER_AGORA_LARGE_MUL > DOT_DIAMETER_FIRST_MUL);
    assert.equal(DOT_DIAMETER_AGORA_SMALL_MUL, DOT_DIAMETER_AGORA_DASH_H_MUL);
    assert.equal(agoraChipSizeMul(0), DOT_DIAMETER_AGORA_LARGE_MUL);
    assert.equal(agoraChipIsSmall(1), false);
    assert.equal(agoraChipFilled(0), 0);
    assert.equal(agoraChipFilled(1, 5, 180), 0);
    assert.equal(agoraChipFilled(36, 5, 180), 1);
    assert.equal(agoraChipFilled(180, 5, 180), 5);
    const contest = { progress: 18, capturer: 1, owner: 0 };
    assert.equal(agoraFromRight(contest), true);
    assert.equal(agoraIsNeutral(contest), false);
    assert.ok(Math.abs(agoraDashFill(3, contest) - 0.5) < 1e-6);
    assert.equal(agoraDashFill(2, contest), 0);
    assert.equal(agoraChipLeadIndex(contest), 4);
    assert.equal(agoraChipTintOwner(4, contest), 0);
    assert.deepEqual(agoraChipRgb(4, contest, 0), AGORA_INK_RGB);
    assert.equal(agoraFlipFxKind(contest), AGORA_FX_INK);
    const firstPip = { progress: 36, capturer: 1, owner: 0 };
    assert.equal(agoraDashFill(3, firstPip), 1);
    assert.equal(agoraChipTintOwner(4, firstPip), 1);
    assert.equal(agoraChipLeadIndex(firstPip), 3);
    const mid = { progress: 90, capturer: 1, owner: 0 };
    assert.equal(agoraChipLeadIndex(mid), 2);
    assert.equal(agoraChipTintOwner(4, mid), 1);
    assert.equal(agoraChipTintOwner(3, mid), 1);
    assert.equal(agoraChipTintOwner(0, mid), 0);
    const lastPip = { progress: 150, capturer: 1, owner: 0 };
    assert.equal(agoraDashFill(0, lastPip), 1);
    assert.equal(agoraChipLeadIndex(lastPip), 0);
    assert.equal(agoraChipTintOwner(1, lastPip), 1);
    assert.equal(agoraChipTintOwner(0, lastPip), 0);
    const gain = { phase: 1, tug: 27, capturer: 1, owner: 0, founder: 0 };
    assert.equal(agoraFromRight(gain), false);
    assert.equal(agoraIsNeutral(gain), true);
    assert.equal(agoraDashFill(0, gain), 1);
    assert.ok(Math.abs(agoraDashFill(1, gain) - 0.5) < 1e-6);
    assert.equal(agoraChipLeadIndex(gain), 1);
    assert.equal(agoraChipTintOwner(0, gain), 1);
    assert.equal(agoraChipTintOwner(1, gain), AGORA_TINT_NEUTRAL);
    assert.deepEqual(agoraChipRgb(1, gain, 0), AGORA_CONTESTED_RGB);
    assert.equal(agoraFlipFxKind(gain), AGORA_FX_DANDELION);
    assert.equal(agoraFlipFxKind({ phase: 1, tug: 20, capturer: 1, contested: 1, direction: 0 }), AGORA_FX_MIX);
    assert.equal(agoraFlipFxKind({ phase: 1, tug: 20, capturer: 1, contested: 1, direction: -1 }), AGORA_FX_INK);
    const unlockT = agoraUnlockTimings();
    assert.ok(unlockT.total < 1700);
    assert.equal(agoraUnlockDotBeat(4, unlockT.melt0 + 1).kind, 'melt');
    assert.equal(agoraUnlockDotBeat(0, unlockT.melt0 + 1).kind, 'hold');
    assert.equal(agoraUnlockDotBeat(0, unlockT.build0 + 1).kind, 'build');
    assert.equal(agoraUnlockDotBeat(4, unlockT.build0 + 1).kind, 'gone');
    const tugStart = { phase: 1, tug: 1, capturer: 1, owner: 0, founder: 0 };
    assert.equal(agoraChipLeadIndex(tugStart), 0);
    assert.ok(agoraChipPulseMul(0, tugStart, 0) > 1);
    assert.equal(agoraChipPulseMul(1, tugStart, 0), 1);
    const stalled = { progress: 0, capturer: -1, owner: 0, contested: 1 };
    assert.equal(agoraChipLeadIndex(stalled), 4);
    assert.deepEqual(agoraChipRgb(4, stalled, 0), AGORA_INK_RGB);
    assert.deepEqual(agoraDashFillRgb({ capturer: 1 }), AGORA_DASH_FILL_RGB);
    assert.deepEqual(AGORA_DASH_TRACK_RGB, [0, 0, 0]);
    assert.deepEqual(AGORA_DASH_FILL_RGB, [1, 1, 1]);
    const lockFirst = agoraQueuedFlips(0, 0, 0, 1);
    assert.deepEqual(lockFirst, [{ order: 0, phase: 0 }]);
    assert.equal(agoraClaimedDotIndex(0, { phase: 0 }), 4);
    const lockEnd = agoraQueuedFlips(0, 1, 4, 0);
    assert.deepEqual(lockEnd, [{ order: 4, phase: 0 }]);
    assert.equal(agoraClaimedDotIndex(4, { phase: 0 }), 0);
    const tugEnd = agoraQueuedFlips(1, 0, 4, 0);
    assert.deepEqual(tugEnd, [{ order: 4, phase: 1 }]);
    assert.equal(agoraClaimedDotIndex(0, { phase: 1 }), 0);
    const blow = agoraFlipStyle(AGORA_FLIP_DROP_END * 0.5, AGORA_FX_DANDELION);
    assert.deepEqual(blow.rgb, AGORA_CONTESTED_RGB);
    assert.ok(blow.drop < 0);
    let dandelionN = 0;
    const wind = pickAgoraWind();
    emitAgoraDandelion((p) => {
      dandelionN += 1;
      assert.equal(p.color[0], 1);
      assert.ok(p.velocity[0] * wind.x > 0);
    }, 0, 1, 0, 1, wind);
    assert.ok(dandelionN >= 8);
    const mixKinds = [];
    emitAgoraFlipFx(AGORA_FX_MIX, (p) => mixKinds.push(p.color[0]), 0, 1, 0, 1, 0, wind);
    assert.ok(mixKinds.includes(0));
    assert.ok(mixKinds.includes(1));
    assert.equal(emitAgoraFlipFx(AGORA_FX_DANDELION, null, 0, 0, 0, 1), 0);
    const claimed = agoraChipRgb(4, firstPip, AGORA_BLINK_PERIOD_MS * 0.75);
    const base = ownerTint(1);
    assert.ok(claimed[1] > base[1]);
    assert.ok(agoraCaptureMix({ capturer: 1, progress: 90 }) > 0.4);
    assert.equal(agoraCaptureMix({ owner: 0, progress: 90 }), 0);
    const idle = agoraPropTint({ owner: 0 });
    const mixed = agoraPropTint({ owner: 0, capturer: 1, progress: 180 });
    assert.deepEqual(idle, ownerTint(0));
    assert.ok(Math.abs(mixed[0] - ownerTint(1)[0]) < Math.abs(idle[0] - ownerTint(1)[0]));
    assert.ok(AGORA_CAPTURER_LIFT > 0);
    const row = agoraRowLayout(1);
    assert.equal(row.dotAlong.length, 5);
    assert.equal(row.dashAlong.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.ok(row.dotAlong[i] < row.dashAlong[i]);
      assert.ok(row.dashAlong[i] < row.dotAlong[i + 1]);
    }
    assert.ok(agoraDashFillAlong(0, 2, 0.5, true) > 0);
    assert.ok(agoraDashFillAlong(0, 2, 0.5, false) < 0);
    const ink = agoraFlipStyle(AGORA_FLIP_DROP_END * 0.5);
    assert.deepEqual(ink.rgb, AGORA_INK_RGB);
    assert.ok(ink.size < 1);
    assert.ok(ink.drop > 0);
    const arrive = agoraFlipStyle(0.9);
    assert.equal(arrive.rgb, null);
    assert.ok(arrive.size > 0.5);
  });
});
