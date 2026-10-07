// Health chips: unit row is 7 HP pips, buildings add one more on each end (9).
// Team color is a 30-60-90 under the line: short edge on the left, long
// edge flat on the line, hypotenuse to the right tip. The face matches
// the line; the left edge is a lighter tint.
// Each HP pip is a rounded square with a lighter rim on the top and right.
// Casters show up to 3 ready-mana dots under that line, each with a ring
// brighter on the right and bottom;
// vehicles reuse the dots (no ring) for filled passenger seats. HP is green
// above 66%, yellow above 33%, then red. Agora rows are o-o-o-o-o (dots on
// both ends, rectangles between).
// Contest (still owned) walks right → left and inks each pip. Unlock pauses,
// melts the whole row right → left, then seed-builds it left → right. After
// that the pad is neutral — anyone can fight — and gaining walks left → right
// with make-a-wish seeds. A stalled tug mixes ink and seeds until a side
// wins. Victory waits for the last pip, then every dot wishes together.
// Four dashes cover the first four pips; the last pip has no extra rectangle.

import {
  addBillboardSprite,
  addFacingBillboardSystem,
  billboardBlendAlpha,
  clearBillboardSprites,
  createFacingBillboardSystem,
  createGridSpriteAtlas,
  createTexture2DFromPixels,
  getViewProjectionMatrix,
  removeBillboardSprite,
  updateBillboardSprite,
} from '../vendor/lite/liteVendor.js';
import { CAMERA_BASE_FOV, CAMERA_CLOSE_SPAN, cameraZoomNormalized } from './cameraController.js';
import { HEALTH_BAR_CAPACITY } from './overlayLod.js';
import { ownerTint } from './ownerTints.js';
import {
  AGORA_CAPTURE_TICKS,
  AGORA_PHASE_LOCK,
  AGORA_PHASE_TUG,
  AGORA_RITE_FINALE,
  AGORA_RITE_UNLOCK,
  AGORA_TUG_TICKS,
} from '../sim/agora.js';

export const UNIT_CHIP_COUNT = 7;
export const BUILDING_CHIP_COUNT = 9;
/** Capture meter: five milestone dots. */
export const AGORA_CHIP_COUNT = 5;
/** Same as the dot count — contest and gain both use all five. */
export const AGORA_LARGE_CHIP_COUNT = AGORA_CHIP_COUNT;
/** Four rectangle connectors between the five dots (o-o-o-o-o). */
export const AGORA_DASH_COUNT = AGORA_CHIP_COUNT - 1;
/** Milestone segments — one per dot, not per dash. */
export const AGORA_SEG_COUNT = AGORA_CHIP_COUNT;
export const AGORA_FX_INK = 'ink';
export const AGORA_FX_DANDELION = 'dandelion';
export const AGORA_FX_MIX = 'mix';
/** Dots + dash tracks + dash fills. */
export const AGORA_SPRITE_COUNT = AGORA_CHIP_COUNT + AGORA_DASH_COUNT * 2;
/** Sentinel — tug large chips that are not yet claimed. */
export const AGORA_TINT_NEUTRAL = -2;
export const AGORA_NEUTRAL_RGB = [0.26, 0.26, 0.28];
const CHIP_COUNT_MAX = Math.max(BUILDING_CHIP_COUNT, AGORA_SPRITE_COUNT);
/** Ready-mana bank / max vehicle seats drawn under the HP line. */
export const UNDER_DOT_MAX = 6;
export const MANA_BANK_DOTS = 3;
const TEX = 64;
const FRAME_ROUND = 0;
const FRAME_SQUARE = 1;
const FRAME_LEAD_ROUND = 2;
const FRAME_RING_HOLY = 3;
const FRAME_RING_ARMOR = 4;
const FRAME_LINE = 5;
const FRAME_RECT = 6;
/** Filled mana disc with a pale ring. Not the team pip. */
const FRAME_MANA = 7;
/** Team wedge face. Agora dots and seat pips stay on the circle frame. */
const FRAME_TEAM_WEDGE = 8;
/** Lighter left edge of the team wedge, drawn over the face. */
const FRAME_TEAM_EDGE = 9;
const ATLAS_COLUMNS = 10;
/** Corner radius as a fraction of half-extent. 0 = sharp square, 1 = circle. */
export const CHIP_BIG_CORNER_MUL = 0.48;
export const CHIP_SMALL_CORNER_MUL = 0.48;
export const CHIP_LEAD_CORNER_MUL = 1;
/** Rim thickness on HP chips, as a fraction of the atlas cell. */
export const CHIP_BASELINE_MUL = 0.075;
/** Bottom edge — darker than the fill. */
export const CHIP_BASELINE_ALPHA = 0.5;
/** Top and right rim — lighter than the fill. */
export const CHIP_EDGE_ALPHA = 1;
/** Fill inside the rim. Dimmer so the right edge reads brighter. */
export const CHIP_BODY_ALPHA = 0.55;
/** Right-edge thickness, as a fraction of the atlas cell. Wider than the top rim. */
export const CHIP_RIGHT_MUL = 0.18;
/** Right edge — full atlas value, brighter than the fill and the top rim. */
export const CHIP_RIGHT_SHADE = 1;
/** Sprite alpha is raised so the dropped middle stays near the old look. */
export const CHIP_FILL_ALPHA_GREEN = 0.5;
export const CHIP_FILL_ALPHA_RED = 1;
export const CHIP_TEAM_FILL_ALPHA = 1;

/** Fallback world diameter if the camera eye is unknown. */
export const NORMAL_DOT_DIAMETER = 0.4;
/** Main-dot size in CSS pixels — world size scales with distance to hold this. */
export const TARGET_DOT_PX = 8;
/** Agora capture chips stay a bit larger than unit HP pips. */
export const TARGET_AGORA_DOT_PX = 14;
const DOT_DIAMETER_MAIN_MUL = 0.88;
/** First HP pip — a tick larger than the other chips. */
export const DOT_DIAMETER_FIRST_MUL = 0.96;
/** Leftover from the old interstitial team pips. */
export const DOT_DIAMETER_ALTERNATE_MUL = 0.58;
/** Circles stay 1:1 — leftover from the old wide squares. */
export const DOT_ALTERNATE_WIDTH_MUL = 1;
/** Horizontal scale of the team triangle vs a normal chip. */
export const DOT_DIAMETER_LEAD_MUL = 1.22 - 1 / TARGET_DOT_PX;
/** Short leg of the 30-60-90, in CSS pixels. The long leg along the line is √3 times this. */
export const TEAM_WEDGE_SHORT_PX = 8;
/** Long leg over short leg. */
export const TEAM_WEDGE_SQRT3 = Math.sqrt(3);
/** Fraction of the long leg that sits on the underline, past its left end. */
export const TEAM_WEDGE_INSET = 0.78;
/** Left edge of the cell, fraction from center. */
export const TEAM_WEDGE_X_LEFT = -0.44;
/** Where the hypotenuse meets the line, fraction from center. */
export const TEAM_WEDGE_X_TIP = 0.40;
/** Right edge of the cell — a short tail past the tip so the join stays seamless. */
export const TEAM_WEDGE_X_EXTENT = 0.46;
/** Team-line center in the cell. Negative is screen-up; the triangle hangs below. */
export const TEAM_WEDGE_Y_LINE = -0.42;
/** Bottom of the short left edge. Positive is screen-down. */
export const TEAM_WEDGE_Y_LOW = 0.46;
/** Left-edge highlight width, as a fraction of the atlas cell. */
export const TEAM_WEDGE_EDGE_MUL = 0.14;
/** How far the left edge mixes toward white, past the team color. */
export const TEAM_WEDGE_EDGE_LIFT = 0.42;
/** Ready-mana / filled-seat dots under the HP line — a hair under the HP chips. */
export const DOT_DIAMETER_UNDER_MUL = 0.86;
/** Center gap — visual tiles are smaller than the billboard, so this can sit under 0.72. */
const DOT_SPACING_MUL = 0.82;
/** Fallback only when the camera eye is unknown. */
const LINE_HEIGHT_MUL = 0.30;
/** Underline stays one CSS pixel; the atlas stroke fills the cell so this is real. */
export const LINE_MIN_PX = 1;
/** Atlas half-extent of the underline — near 0.5 so billboard height ≈ stroke. */
export const LINE_ATLAS_HALF_MUL = 0.48;
export const LINE_DOWN_MUL = 0.68;
/** Cut this fraction off the right end of the underline. */
export const LINE_RIGHT_TRIM = 1 / 3;
const UNDER_DOWN_MUL = 1.42;
const UNDER_SPACING_MUL = 1.22;
const UNDER_SPACING_PACKED_MUL = 0.98;
/** Saturated cobalt fill. The atlas darkens this under the pale ring tint. */
export const RGB_MANA = [0.16, 0.40, 0.92];
/** Ring around a ready-mana dot — lighter than the fill, not a white halo. */
export const RGB_MANA_RING = [0.40, 0.58, 0.96];
/** Disc radius in the mana cell. The ring sits between inner and outer. */
const MANA_DISC_OUTER = 0.44;
const MANA_DISC_INNER = 0.30;
/** Filled vehicle seats — same cool grey as HUD `--pop-ink` (`#b8c0cc`). */
export const RGB_SEAT = [184 / 255, 192 / 255, 204 / 255];
/** Agora milestone dots — a bit smaller so five still fit the roof. */
export const DOT_DIAMETER_AGORA_LARGE_MUL = 1.72;
/** Rectangle connectors between the dots — close to square, not a thin bar. */
export const DOT_DIAMETER_AGORA_DASH_W_MUL = 0.98;
export const DOT_DIAMETER_AGORA_DASH_H_MUL = 0.86;
/** Leftover name — dash height vs the old small-circle size. */
export const DOT_DIAMETER_AGORA_SMALL_MUL = DOT_DIAMETER_AGORA_DASH_H_MUL;
/** Center-to-center pitch of neighboring dots (dot + gaps + dash). */
export const DOT_SPACING_AGORA_MUL = 3.08;
export const AGORA_DASH_INNER_GAP_MUL = 0.22;
export const AGORA_DASH_TRACK_ALPHA = 0.42;
/** Extra size on the contested blink peak. */
export const AGORA_LEAD_PULSE_MUL = 0.46;
export const AGORA_CONTESTED_RGB = [1, 1, 1];
export const AGORA_INK_RGB = [0, 0, 0];
/** Empty dash track / live fill — ink and paper, not team swatches. */
export const AGORA_DASH_TRACK_RGB = [0, 0, 0];
export const AGORA_DASH_FILL_RGB = [1, 1, 1];
/** Full white-on / rest-color-off cycle. */
export const AGORA_BLINK_PERIOD_MS = 280;
/** Black drip → new color. */
export const AGORA_FLIP_MS = 560;
export const AGORA_FLIP_INK_END = 0;
export const AGORA_FLIP_DROP_END = 0.48;
/** Beat before the unlock row melts. */
export const AGORA_UNLOCK_PAUSE_MS = 200;
export const AGORA_LINE_STAGGER_MS = 72;
export const AGORA_LINE_FLIP_MS = 380;
export const AGORA_UNLOCK_BUILD_GAP_MS = 60;
/** Last pip plays, then every dot wishes together. */
export const AGORA_FINALE_WISH_AT_MS = AGORA_FLIP_MS + 90;
/** How often a stalled tug coughs mixed ink + seeds. */
export const AGORA_MIX_MS = 400;
/** Mix capturer chip RGB toward white so occupy reads hotter than the owner row. */
export const AGORA_CAPTURER_LIFT = 0.28;
const HOLY_RING_VS_NORMAL = 1.04;
const ARMOR_RING_VS_NORMAL = 1.26;
/** Lift above pick-sphere chest so the row sits over the head. */
export const HEAD_HEIGHT_MUL = 2.2;
export const CHIP_ABOVE_HEAD = 0.55;
export const CHIP_ABOVE_ROOF = 0.75;
export const DEFAULT_UNIT_CHIP_LIFT = 1.1 * HEAD_HEIGHT_MUL + CHIP_ABOVE_HEAD;
export const DEFAULT_BUILDING_ROOF = 8;
export const DEFAULT_AGORA_ROOF = 12;
/** Always push this many CSS pixels toward screen-up. */
export const CHIP_SCREEN_UP_PX = 8;
/** Extra screen-up pixels when looking straight down (cos β). */
export const CHIP_SCREEN_UP_TILT_PX = 20;
/** Size after the look-down tilt (close-in → play), before the half-zoom vanish. */
export const LOOK_DOWN_SCALE_MIN = 0.55;
/** Start shrinking toward vanish (size only; chips stay opaque). */
export const HORIZON_FADE_START = 0.5;
/** Hide at max zoom-out. */
export const HORIZON_HIDE = 1;
/** Skip draws when the horizon scale is at or below this. */
export const HORIZON_HIDE_EPS = 0.04;

/** Max sprites per slot: HP chips + lead + edge + line + under dots + rings. */
const SPRITES_PER_SLOT = CHIP_COUNT_MAX + 1 + 1 + 1 + UNDER_DOT_MAX + 4;
/**
 * Toward-camera pull so chips win depth against terrain and unit meshes.
 * (Billboard API always depth-tests; bias is the HUD-style always-visible path.)
 */
const CAMERA_DEPTH_BIAS = 10;
/** Extra toward-camera pull so opaque team pips win depth over HP chips. */
const TEAM_DEPTH_NUDGE_MUL = 0.4;

/** Signed distance to a rounded box centered at the origin. */
function sdRoundBox(px, py, half, corner) {
  const ax = Math.abs(px) - half + corner;
  const ay = Math.abs(py) - half + corner;
  const ox = Math.max(ax, 0);
  const oy = Math.max(ay, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(ax, ay), 0) - corner;
}

/**
 * Shade of an HP pip. `px`/`py` are atlas pixels from the chip center
 * (+x right, +y down, which is screen-down). The right edge is the bright rim.
 * @param {number} px
 * @param {number} py
 * @param {number} half chip half-extent in atlas pixels
 */
export function hpChipShade(px, py, half) {
  const line = half * (CHIP_BASELINE_MUL / 0.36);
  const right = half * (CHIP_RIGHT_MUL / 0.36);
  if (px > half - right) return CHIP_RIGHT_SHADE;
  if (py < -half + line) return CHIP_EDGE_ALPHA;
  if (py > half - line) return CHIP_BASELINE_ALPHA;
  return CHIP_BODY_ALPHA;
}

function writeSoftChip(pixels, ox, size, cornerMul, opts = {}) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  // Stay inside the atlas cell so linear filter doesn't pick up the next frame.
  const half = size * 0.36;
  const corner = half * Math.max(0, cornerMul);
  const feather = size * 0.02;
  const rim = !!(opts.topLine || opts.bottomLine || opts.rightLine);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const d = sdRoundBox(px, py, half, corner);
      let a = 0;
      if (d <= 0) a = 1;
      else if (d < feather) a = 1 - d / feather;
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      // Shade lives in RGB so the rim stays a lighter color when the sprite
      // is translucent. Empty texels stay black so the filter doesn't fringe.
      const shade = rim ? hpChipShade(px, py, half) : 1;
      const rgb = a > 0 ? Math.round(shade * 255) : 0;
      pixels[i] = rgb;
      pixels[i + 1] = rgb;
      pixels[i + 2] = rgb;
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

/** How much of the ring stays on the dim side (top / left). Right and bottom are full. */
export const MANA_RING_DIM = 0.32;

/**
 * Ring brightness from the disc center. +x is screen-right, +y is screen-down.
 * 0 at the top-left, 1 at the right and the bottom.
 * @param {number} nx
 * @param {number} ny
 */
export function manaRingLit(nx, ny) {
  return Math.max(0, Math.min(1, 0.5 + 0.5 * (nx + ny)));
}

/** Atlas RGB of the mana fill so it still lands on RGB_MANA under the ring tint. */
function manaFillBytes() {
  return RGB_MANA.map((c, i) => Math.round(255 * c / RGB_MANA_RING[i]));
}

function writeManaDisc(pixels, ox, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const outer = size * MANA_DISC_OUTER;
  const inner = size * MANA_DISC_INNER;
  const feather = size * 0.02;
  const fill = manaFillBytes();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      let a = 0;
      if (d <= outer) a = 1;
      else if (d < outer + feather) a = 1 - (d - outer) / feather;
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      if (a <= 0) {
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        continue;
      }
      let ring = 0;
      if (d >= inner + feather) ring = 1;
      else if (d > inner - feather) ring = (d - (inner - feather)) / (2 * feather);
      const lit = manaRingLit((x + 0.5 - cx) / outer, (y + 0.5 - cy) / outer);
      const strength = MANA_RING_DIM + (1 - MANA_RING_DIM) * lit;
      const k = ring * strength;
      pixels[i] = Math.round(fill[0] + (255 - fill[0]) * k);
      pixels[i + 1] = Math.round(fill[1] + (255 - fill[1]) * k);
      pixels[i + 2] = Math.round(fill[2] + (255 - fill[2]) * k);
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

function writeTeamWedge(pixels, ox, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const feather = size * 0.02;
  const g = teamWedgeBounds(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const pxClamp = Math.min(g.xR, Math.max(g.xL, px));
      const top = teamWedgeTop(pxClamp, size);
      let a = 0;
      const bottom = teamWedgeBottom(pxClamp, size);
      if (top != null && bottom != null) {
        const d = Math.min(py - top, bottom - py, px - g.xL, g.xR - px);
        if (d >= 0) a = 1;
        else if (d > -feather) a = 1 + d / feather;
      }
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      const rgb = a > 0 ? 255 : 0;
      pixels[i] = rgb;
      pixels[i + 1] = rgb;
      pixels[i + 2] = rgb;
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

function writeTeamEdge(pixels, ox, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const feather = size * 0.02;
  const g = teamWedgeBounds(size);
  const edge = size * TEAM_WEDGE_EDGE_MUL;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const pxClamp = Math.min(g.xR, Math.max(g.xL, px));
      const top = teamWedgeTop(pxClamp, size);
      const bottom = teamWedgeBottom(pxClamp, size);
      let a = 0;
      if (top != null && bottom != null && teamWedgeOnEdge(pxClamp, size)) {
        const d = Math.min(py - top, bottom - py, px - g.xL, g.xR - px, g.xL + edge - px);
        if (d >= 0) a = 1;
        else if (d > -feather) a = 1 + d / feather;
      }
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      const rgb = a > 0 ? 255 : 0;
      pixels[i] = rgb;
      pixels[i + 1] = rgb;
      pixels[i + 2] = rgb;
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

function writeUnderline(pixels, ox, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const halfW = size * LINE_ATLAS_HALF_MUL;
  const halfH = size * LINE_ATLAS_HALF_MUL;
  const feather = size * 0.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const ax = Math.abs(px) - halfW + halfH;
      const ay = Math.abs(py) - halfH + halfH;
      const oxp = Math.max(ax, 0);
      const oyp = Math.max(ay, 0);
      const d = Math.hypot(oxp, oyp) + Math.min(Math.max(ax, ay), 0) - halfH;
      let a = 0;
      if (d <= 0) a = 1;
      else if (d < feather) a = 1 - d / feather;
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      const rgb = a > 0 ? 255 : 0;
      pixels[i] = rgb;
      pixels[i + 1] = rgb;
      pixels[i + 2] = rgb;
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

function writeRoundedRing(pixels, ox, size, alpha) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const half = size * 0.44;
  const corner = half * 0.36;
  const inner = half * 0.68;
  const innerCorner = corner * 0.68;
  const aByte = Math.round(alpha * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const on = sdRoundBox(dx, dy, half, corner) <= 0 && sdRoundBox(dx, dy, inner, innerCorner) > 0;
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      pixels[i] = on ? 255 : 0;
      pixels[i + 1] = on ? 255 : 0;
      pixels[i + 2] = on ? 255 : 0;
      pixels[i + 3] = on ? aByte : 0;
    }
  }
}

function createHealthChipAtlas(engine) {
  const w = TEX * ATLAS_COLUMNS;
  const h = TEX;
  const pixels = new Uint8Array(w * h * 4);
  writeSoftChip(pixels, 0, TEX, CHIP_BIG_CORNER_MUL, {
    topLine: true,
    bottomLine: true,
    rightLine: true,
  });
  writeSoftChip(pixels, TEX, TEX, CHIP_SMALL_CORNER_MUL);
  writeSoftChip(pixels, TEX * 2, TEX, CHIP_LEAD_CORNER_MUL);
  writeRoundedRing(pixels, TEX * 3, TEX, 0.92);
  writeRoundedRing(pixels, TEX * 4, TEX, 0.94);
  writeUnderline(pixels, TEX * 5, TEX);
  writeSoftChip(pixels, TEX * 6, TEX, 0);
  writeManaDisc(pixels, TEX * FRAME_MANA, TEX);
  writeTeamWedge(pixels, TEX * FRAME_TEAM_WEDGE, TEX);
  writeTeamEdge(pixels, TEX * FRAME_TEAM_EDGE, TEX);
  const texture = createTexture2DFromPixels(engine, pixels, w, h, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createGridSpriteAtlas(texture, {
    cellWidthPx: TEX,
    cellHeightPx: TEX,
    columns: ATLAS_COLUMNS,
    rows: 1,
  });
}

/** World-Y lift from ground to the chip row (includes flyer / lob loft). */
export function unitChipLift(loft, pickHeight) {
  return (Number(loft) || 0) + (pickHeight ?? 1.1) * HEAD_HEIGHT_MUL + CHIP_ABOVE_HEAD;
}

/** Mesh-local max Y from baked `boundMax`, or 0 if unknown. */
export function meshRoofY(parts) {
  let maxY = 0;
  for (const p of parts ?? []) {
    const y = p?.boundMax?.[1];
    if (Number.isFinite(y) && y > maxY) maxY = y;
  }
  return maxY;
}

/** Chip lift above ground for a building / agora roof. */
export function roofChipLift(roofY, fallback = DEFAULT_BUILDING_ROOF) {
  const y = Number.isFinite(roofY) && roofY > 0.5 ? roofY : fallback;
  return y + CHIP_ABOVE_ROOF;
}

/**
 * Perspective size of a world-diameter sprite in CSS pixels.
 * @param {number} worldDiameter
 * @param {number} distance
 * @param {number} viewportHeight
 * @param {number} fov vertical FOV in radians
 */
export function chipScreenPixels(worldDiameter, distance, viewportHeight, fov) {
  const d = Math.max(1e-3, distance);
  const vh = Math.max(1, viewportHeight);
  const f = fov > 1e-3 ? fov : CAMERA_BASE_FOV;
  return (worldDiameter * vh) / (2 * d * Math.tan(f * 0.5));
}

/**
 * World diameter that covers `screenPx` at `distance` (inverse of chipScreenPixels).
 * @param {number} screenPx
 * @param {number} distance
 * @param {number} viewportHeight
 * @param {number} fov vertical FOV in radians
 */
export function worldSizeForScreenPx(screenPx, distance, viewportHeight, fov) {
  const d = Math.max(1e-3, distance);
  const vh = Math.max(1, viewportHeight);
  const f = fov > 1e-3 ? fov : CAMERA_BASE_FOV;
  return (screenPx * 2 * d * Math.tan(f * 0.5)) / vh;
}

/**
 * Underline height in world units. Always one CSS pixel once the camera
 * distance is known — chip scale used to shrink this under a pixel.
 */
export function chipLineHeight(normalDot, distance, viewportHeight, fov) {
  if (distance > 1e-3) {
    return worldSizeForScreenPx(LINE_MIN_PX, distance, viewportHeight, fov);
  }
  return Math.max(0, normalDot) * LINE_HEIGHT_MUL;
}

/** Underline width and row offset — left edge stays, right end is trimmed. */
export function chipLineLayout(totalWidth, spacing) {
  const full = Math.max(spacing, totalWidth + spacing * 0.55);
  const width = full * (1 - LINE_RIGHT_TRIM);
  return { width, along: -full * LINE_RIGHT_TRIM * 0.5 };
}

/**
 * 30-60-90 extents in atlas pixels. +x is toward the underline, +y is screen-down.
 * Right angle at the top-left, short leg down the left, long leg along the line.
 * @param {number} size
 */
export function teamWedgeBounds(size) {
  const xL = size * TEAM_WEDGE_X_LEFT;
  const xTip = size * TEAM_WEDGE_X_TIP;
  const xR = size * TEAM_WEDGE_X_EXTENT;
  const yLine = size * TEAM_WEDGE_Y_LINE;
  const yLow = size * TEAM_WEDGE_Y_LOW;
  const span = yLow - yLine;
  const lineH = span * (LINE_MIN_PX / TEAM_WEDGE_SHORT_PX);
  return { xL, xR, x1: xTip, yLow, yLine, lineH };
}

/**
 * Top edge. Flat on the team line for the whole wedge, including the tail.
 * Null when x is outside.
 * @param {number} px
 * @param {number} size
 */
export function teamWedgeTop(px, size) {
  const g = teamWedgeBounds(size);
  if (px < g.xL || px > g.xR) return null;
  return g.yLine - g.lineH * 0.5;
}

/**
 * Hypotenuse from the bottom of the short edge up to the line. The tail stays on the line.
 * Null when x is outside.
 * @param {number} px
 * @param {number} size
 */
export function teamWedgeBottom(px, size) {
  const g = teamWedgeBounds(size);
  if (px < g.xL || px > g.xR) return null;
  const lineBot = g.yLine + g.lineH * 0.5;
  if (px >= g.x1) return lineBot;
  const t = (px - g.xL) / (g.x1 - g.xL);
  return g.yLow + (lineBot - g.yLow) * t;
}

/** True on the vertical left strip. The face and the line tail are not part of it. */
export function teamWedgeOnEdge(px, size) {
  const g = teamWedgeBounds(size);
  return px <= g.xL + size * TEAM_WEDGE_EDGE_MUL;
}

/** Lighter than the team color, drawn over the short left edge. */
export function teamEdgeRgb(rgb) {
  const k = TEAM_WEDGE_EDGE_LIFT;
  return [
    rgb[0] + (1 - rgb[0]) * k,
    rgb[1] + (1 - rgb[1]) * k,
    rgb[2] + (1 - rgb[2]) * k,
  ];
}

/**
 * Place the 30-60-90 so its top edge is the underline and most of the long
 * leg sits on that line, in toward the chips.
 * @param {number} totalWidth
 * @param {number} spacing
 * @param {number} normalDot
 */
export function teamWedgeLayout(totalWidth, spacing, normalDot) {
  const spanY = TEAM_WEDGE_Y_LOW - TEAM_WEDGE_Y_LINE;
  const spanX = TEAM_WEDGE_X_TIP - TEAM_WEDGE_X_LEFT;
  const dot = Math.max(0, normalDot);
  const height = dot * (TEAM_WEDGE_SHORT_PX / TARGET_DOT_PX) / spanY;
  const width = dot * (TEAM_WEDGE_SHORT_PX * TEAM_WEDGE_SQRT3 / TARGET_DOT_PX) / spanX;
  const { width: lineW, along: lineAlong } = chipLineLayout(totalWidth, spacing);
  const lineLeft = lineAlong - lineW * 0.5;
  const longLeg = spanX * width;
  const along = lineLeft + longLeg * TEAM_WEDGE_INSET - TEAM_WEDGE_X_TIP * width;
  const baselineShift = TEAM_WEDGE_Y_LINE * height;
  return { along, width, height, lineLeft, baselineShift };
}

/** Snap a CSS-pixel Y to a device-pixel center so a 1px bar cannot strobe. */
export function snapScreenYToPixelCenter(screenY, devicePixelRatio = 1) {
  const dpr = devicePixelRatio > 1e-3 ? devicePixelRatio : 1;
  return (Math.floor(screenY * dpr) + 0.5) / dpr;
}

/**
 * Nudge a world point along screen-up so its projected Y sits on a pixel
 * center. `vp` is column-major view-projection.
 * @returns {[number, number, number]}
 */
export function snapWorldToPixelRow(px, py, pz, vp, viewH, deviceH, ux, uy, uz, dist, fov) {
  if (!vp || !(viewH > 1) || !(dist > 1e-3)) return [px, py, pz];
  let clipY = vp[1] * px + vp[5] * py + vp[9] * pz + vp[13];
  let clipW = vp[3] * px + vp[7] * py + vp[11] * pz + vp[15];
  if (!(Math.abs(clipW) > 1e-8)) return [px, py, pz];
  if (clipW < 0) {
    clipY = -clipY;
    clipW = -clipW;
  }
  const screenY = (1 - clipY / clipW) * 0.5 * viewH;
  const dpr = deviceH > 1 ? deviceH / viewH : 1;
  const errPx = snapScreenYToPixelCenter(screenY, dpr) - screenY;
  if (Math.abs(errPx) < 1e-6) return [px, py, pz];
  const world = worldSizeForScreenPx(errPx, dist, viewH, fov);
  return [px - ux * world, py - uy * world, pz - uz * world];
}

/**
 * 1 until half zoom, then smoothstep to 0 at max zoom-out.
 * @param {number} normalizedZoom 0 = closest, 1 = farthest
 */
export function chipHorizonScale(normalizedZoom) {
  const n = Math.max(0, Math.min(1, normalizedZoom));
  if (n <= HORIZON_FADE_START) return 1;
  if (n >= HORIZON_HIDE) return 0;
  const u = (n - HORIZON_FADE_START) / (HORIZON_HIDE - HORIZON_FADE_START);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Shrink as the camera tilts down from closest zoom; holds at the play size
 * after that so the half-zoom fade is a second, later shrink.
 * @param {number} normalizedZoom 0 = closest, 1 = farthest
 */
export function chipLookDownScale(normalizedZoom) {
  const n = Math.max(0, Math.min(1, normalizedZoom));
  const span = CAMERA_CLOSE_SPAN > 1e-3 ? CAMERA_CLOSE_SPAN : 0.12;
  const t = Math.min(1, n / span);
  const u = t * t * (3 - 2 * t);
  return 1 - u * (1 - LOOK_DOWN_SCALE_MIN);
}

/**
 * Screen-up in world space (look × camera-right). Horizon → +Y; top-down → XZ.
 * @param {number} alpha
 * @param {number} beta
 * @returns {[number, number, number]}
 */
export function chipScreenUpDir(alpha, beta) {
  const a = Number.isFinite(alpha) ? alpha : 0;
  const b = Number.isFinite(beta) ? beta : 0.82;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return [-Math.cos(a) * cb, sb, -Math.sin(a) * cb];
}

/** Extra screen-up pixels: a base gap plus more when the camera looks down. */
export function chipScreenUpPixels(beta) {
  const b = Number.isFinite(beta) ? beta : 0.82;
  return chipScreenUpPixelsForDown(Math.cos(b));
}

/** Same gap from how far the view points down (0 level, 1 straight down). */
export function chipScreenUpPixelsForDown(down) {
  return CHIP_SCREEN_UP_PX + CHIP_SCREEN_UP_TILT_PX * Math.max(0, down);
}

/**
 * Chip layout axes for a headset pose (Lite left-handed world matrix).
 * Right is the head's right, flattened so rows stay level when the head
 * rolls. Up is the head's up, which is screen-up in the eye.
 * @param {ArrayLike<number>} wm
 */
export function headsetChipAxes(wm) {
  let rx = wm[0];
  let rz = wm[2];
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-5) {
    rx /= rl;
    rz /= rl;
  } else {
    rx = 1;
    rz = 0;
  }
  return {
    eye: [wm[12], wm[13], wm[14]],
    right: [rx, rz],
    up: [wm[4], wm[5], wm[6]],
    down: Math.max(0, -wm[9]),
  };
}

const RGB_GREEN = [0.12, 0.92, 0.2];
const RGB_YELLOW = [0.95, 0.78, 0.12];
const RGB_RED = [0.92, 0.18, 0.12];
const CHIP_BAND = 1 / 3;

/**
 * One bar for full HP. Color flips at 66% (green→yellow) and 33% (yellow→red).
 * @param {number} ratio 0..1
 * @param {number} count chips in this row
 */
export function chipBarState(ratio, count) {
  const n = Math.max(1, count | 0);
  const r = Math.max(0, Math.min(1, ratio));
  const band = r > CHIP_BAND * 2 ? 0 : r > CHIP_BAND ? 1 : 2;
  const filled = r <= 0 ? 0 : Math.max(1, Math.min(n, Math.ceil(r * n - 1e-6)));
  const rgb = band === 0 ? RGB_GREEN : band === 1 ? RGB_YELLOW : RGB_RED;
  return { filled, rgb, band };
}

/** At 1 HP, hide the last pip — only the left team mark stays. */
export function chipBarFilled(ratio, count, hp) {
  if (Number.isFinite(hp) && (hp | 0) <= 1) return 0;
  return chipBarState(ratio, count).filled;
}

/** Size vs the normal chip. First pip is a tick larger; the rest match. */
export function chipSizeMul(index, _count) {
  if (index === 0) return DOT_DIAMETER_FIRST_MUL;
  return DOT_DIAMETER_MAIN_MUL;
}

/** Width vs height. Team circles stay round. */
export function chipWidthMul(_index) {
  return 1;
}

/** In-row chips are HP only — team color lives on the left pip + underline. */
export function chipIsTeamDot(_index) {
  return false;
}

/** In-row chips use the HP band color. */
export function chipFillRgb(_index, hpRgb, _owner) {
  return hpRgb;
}

/** Atlas frame: in-row chips are rounded HP. */
export function chipDotFrame(_index) {
  return FRAME_ROUND;
}

/** Opacity from HP ratio: 1 = green, 0 = red. */
export function chipFillAlpha(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  return CHIP_FILL_ALPHA_GREEN + (CHIP_FILL_ALPHA_RED - CHIP_FILL_ALPHA_GREEN) * (1 - r);
}

/** HP chips fade with the health band; empty slots stay opaque if drawn. */
export function chipDotAlpha(_index, filled, ratio) {
  if (!filled) return 1;
  return chipFillAlpha(ratio);
}

/** Ready-mana cobalt, or the HUD grey for filled seats. */
export function underDotRgb(flags = {}) {
  if ((flags.seatsFilled | 0) > 0) return RGB_SEAT;
  return RGB_MANA;
}

/** Sprite tint. Mana uses the pale ring; the fill is darkened in the atlas. */
export function underDotTint(flags = {}) {
  if ((flags.seatsFilled | 0) > 0) return RGB_SEAT;
  if ((flags.manaReady | 0) > 0) return RGB_MANA_RING;
  return RGB_MANA;
}

/** Mana discs carry a ring. Seat dots stay plain circles. */
export function underDotFrame(flags = {}) {
  if ((flags.manaReady | 0) > 0 && (flags.seatsFilled | 0) <= 0) return FRAME_MANA;
  return FRAME_LEAD_ROUND;
}

/** Ready mana charges, or filled vehicle seats — not both. */
export function underDotCount(flags = {}) {
  if (flags.agora || flags.building) return 0;
  const seats = flags.seatsFilled | 0;
  if (seats > 0) return Math.min(UNDER_DOT_MAX, seats);
  return Math.min(MANA_BANK_DOTS, flags.manaReady | 0);
}

/** Extra sprite slot: permanent team square to the left of the HP row. */
export const CHIP_LEAD_TEAM_INDEX = BUILDING_CHIP_COUNT;

export function chipIsLeadingTeam(index) {
  return index === CHIP_LEAD_TEAM_INDEX;
}

/** HP pips only. The left team pip is drawn separately. */
export function chipDotVisible(index, filledCount) {
  return index < filledCount;
}

export function agoraChipSizeMul(_index) {
  return DOT_DIAMETER_AGORA_LARGE_MUL;
}

/**
 * Completed segments + 0..1 fill of the live dash.
 * Dots flip only when a segment finishes; dashes move every tick.
 */
export function agoraMeterParts(progress, count = AGORA_CHIP_COUNT, maxTicks = AGORA_CAPTURE_TICKS) {
  const n = Math.max(1, count | 0);
  const max = Math.max(1, maxTicks | 0);
  const p = Math.max(0, progress | 0);
  if (p <= 0) return { filled: 0, frac: 0 };
  if (p >= max) return { filled: n, frac: 0 };
  const t = (p * n) / max;
  const filled = Math.min(n - 1, Math.floor(t + 1e-6));
  return { filled, frac: Math.min(1, Math.max(0, t - filled)) };
}

/** How many milestone dots a 0..maxTicks meter has claimed. */
export function agoraChipFilled(progress, count = AGORA_CHIP_COUNT, maxTicks = AGORA_CAPTURE_TICKS) {
  return agoraMeterParts(progress, count, maxTicks).filled;
}

/** 0..1 capture meter — dashes and milestones both use this. */
export function agoraProgressRatio(state = {}) {
  if ((state.phase | 0) === AGORA_PHASE_TUG) {
    return Math.min(1, Math.max(0, (state.tug | 0) / AGORA_TUG_TICKS));
  }
  return Math.min(1, Math.max(0, (state.progress | 0) / AGORA_CAPTURE_TICKS));
}

/** Neutral tug — anyone can fight. Contest (lock) still has an owner. */
export function agoraIsNeutral(state = {}) {
  return (state.phase | 0) === AGORA_PHASE_TUG;
}

/** Contest walks right → left; gaining on a neutral pad walks left → right. */
export function agoraFromRight(state = {}) {
  return !agoraIsNeutral(state);
}

function agoraMeterState(state = {}) {
  const segs = AGORA_SEG_COUNT;
  if ((state.phase | 0) === AGORA_PHASE_TUG) {
    return agoraMeterParts(state.tug, segs, AGORA_TUG_TICKS);
  }
  return agoraMeterParts(state.progress, segs, AGORA_CAPTURE_TICKS);
}

export function agoraChipIsSmall(_index) {
  return false;
}

/**
 * 0..1 realtime fill. Four dashes cover the first four fifths;
 * the last fifth is the last pip (no extra rectangle).
 */
export function agoraDashFill(index, state = {}) {
  const dashes = AGORA_DASH_COUNT;
  const segs = AGORA_SEG_COUNT;
  if (index < 0 || index >= dashes) return 0;
  const order = agoraFromRight(state) ? (dashes - 1 - index) : index;
  const start = order / segs;
  return Math.min(1, Math.max(0, (agoraProgressRatio(state) - start) * segs));
}

/** Dot claimed by completed-segment `order` (0-first). */
export function agoraClaimedDotIndex(order, state = {}) {
  const count = state.count ?? AGORA_CHIP_COUNT;
  if (agoraFromRight(state)) return count - 1 - order;
  return order;
}

/**
 * Flip beat. Ink: stay black and drip. Dandelion: stay white and lift away.
 * `rgb` is null once the new swatch should show.
 */
export function agoraFlipStyle(t, kind = AGORA_FX_INK) {
  const u = Math.max(0, Math.min(1, t));
  const dandelion = kind === AGORA_FX_DANDELION;
  if (u < AGORA_FLIP_DROP_END) {
    const span = Math.max(1e-6, AGORA_FLIP_DROP_END - AGORA_FLIP_INK_END);
    const k = Math.min(1, Math.max(0, (u - AGORA_FLIP_INK_END) / span));
    return {
      rgb: dandelion ? AGORA_CONTESTED_RGB : AGORA_INK_RGB,
      size: 1 - (dandelion ? 0.78 : 0.88) * k,
      drop: dandelion ? -0.22 * k : k,
    };
  }
  const k = (u - AGORA_FLIP_DROP_END) / (1 - AGORA_FLIP_DROP_END);
  const ease = k * k * (3 - 2 * k);
  return { rgb: null, size: 0.12 + 0.88 * ease, drop: dandelion ? 0 : (1 - ease) * 0.16 };
}

/** Dot currently being taken — contest from the right, gain from the left. */
export function agoraChipLeadIndex(state = {}) {
  const { filled, frac } = agoraMeterState(state);
  const live = (state.capturer | 0) >= 0 || (state.contested | 0) !== 0 || filled > 0 || frac > 0;
  if (!live || filled >= AGORA_SEG_COUNT) return -1;
  if (agoraFromRight(state)) return AGORA_CHIP_COUNT - 1 - filled;
  return filled;
}

export function agoraLeadBlinkBlack(nowMs = 0) {
  return (((Math.max(0, nowMs) / AGORA_BLINK_PERIOD_MS) % 1) < 0.5);
}

/** Contested lead swells on the white half, then eases back. */
export function agoraChipPulseMul(index, state = {}, nowMs = 0) {
  if (index !== agoraChipLeadIndex(state)) return 1;
  const u = (Math.max(0, nowMs) / AGORA_BLINK_PERIOD_MS) % 1;
  const wave = 0.5 + 0.5 * Math.cos(u * Math.PI * 2);
  return 1 + AGORA_LEAD_PULSE_MUL * wave;
}

/**
 * Segment orders that melt when filled jumps (claim or drain).
 * @param {number} prevFilled
 * @param {number} nextFilled
 */
export function agoraFlipOrders(prevFilled, nextFilled) {
  const lo = Math.min(prevFilled | 0, nextFilled | 0);
  const hi = Math.max(prevFilled | 0, nextFilled | 0);
  const orders = [];
  for (let order = lo; order < hi; order++) orders.push(order);
  return orders;
}

/**
 * Lock/tug completion snaps the phase on the same tick the last pip fills,
 * so leftover melts use the phase that just ended.
 * @returns {{ order: number, phase: number }[]}
 */
export function agoraQueuedFlips(prevPhase, nextPhase, prevFilled, nextFilled) {
  const from = prevPhase | 0;
  if (from === (nextPhase | 0)) {
    return agoraFlipOrders(prevFilled, nextFilled).map((order) => ({ order, phase: from }));
  }
  return agoraFlipOrders(prevFilled, AGORA_SEG_COUNT).map((order) => ({ order, phase: from }));
}

/** Contest inks; gaining on a neutral pad blows seeds; a stalled tug mixes both. */
export function agoraFlipFxKind(state = {}) {
  if (!agoraIsNeutral(state)) return AGORA_FX_INK;
  if ((state.direction | 0) < 0) return AGORA_FX_INK;
  if ((state.contested | 0) !== 0 && (state.direction | 0) === 0) return AGORA_FX_MIX;
  return AGORA_FX_DANDELION;
}

function agoraLockCompleteFlags(flags = {}) {
  return {
    owner: flags.owner,
    founder: flags.founder,
    capturer: flags.capturer,
    phase: AGORA_PHASE_LOCK,
    progress: AGORA_CAPTURE_TICKS,
    tug: 0,
    contested: 0,
  };
}

function agoraTugRestFlags(flags = {}) {
  return {
    owner: flags.owner,
    founder: flags.founder,
    capturer: flags.capturer,
    phase: AGORA_PHASE_TUG,
    progress: 0,
    tug: 0,
    contested: 0,
  };
}

/** Unlock choreography: pause, melt R→L, seed-build L→R. */
export function agoraUnlockTimings() {
  const n = AGORA_CHIP_COUNT;
  const pause = AGORA_UNLOCK_PAUSE_MS;
  const stagger = AGORA_LINE_STAGGER_MS;
  const flip = AGORA_LINE_FLIP_MS;
  const melt0 = pause;
  const meltSpan = (n - 1) * stagger + flip;
  const build0 = melt0 + meltSpan + AGORA_UNLOCK_BUILD_GAP_MS;
  const buildSpan = (n - 1) * stagger + flip;
  return { n, pause, stagger, flip, melt0, meltSpan, build0, buildSpan, total: build0 + buildSpan };
}

/**
 * @param {number} index
 * @param {number} elapsedMs
 * @returns {{ kind: 'hold'|'melt'|'gone'|'build'|'ready', t: number, fx: string | null }}
 */
export function agoraUnlockDotBeat(index, elapsedMs) {
  const t = agoraUnlockTimings();
  const i = index | 0;
  const meltAt = t.melt0 + (t.n - 1 - i) * t.stagger;
  const buildAt = t.build0 + i * t.stagger;
  const e = Math.max(0, elapsedMs);
  if (e < meltAt) return { kind: 'hold', t: 0, fx: null };
  if (e < meltAt + t.flip) return { kind: 'melt', t: (e - meltAt) / t.flip, fx: AGORA_FX_INK };
  if (e < buildAt) return { kind: 'gone', t: 1, fx: null };
  if (e < buildAt + t.flip) return { kind: 'build', t: (e - buildAt) / t.flip, fx: AGORA_FX_DANDELION };
  return { kind: 'ready', t: 1, fx: null };
}

function liftCapturerRgb(rgb) {
  const t = AGORA_CAPTURER_LIFT;
  return [
    rgb[0] + (1 - rgb[0]) * t,
    rgb[1] + (1 - rgb[1]) * t,
    rgb[2] + (1 - rgb[2]) * t,
  ];
}

function agoraChipRestRgb(index, state = {}) {
  const tint = agoraChipTintOwner(index, state);
  if (tint === AGORA_TINT_NEUTRAL) return AGORA_NEUTRAL_RGB;
  const rgb = ownerTint(tint);
  const capturer = state.capturer;
  if (capturer == null || (capturer | 0) < 0 || tint !== (capturer | 0)) return rgb;
  return liftCapturerRgb(rgb);
}

export function agoraChipRgb(index, state = {}, nowMs = 0) {
  if (index === agoraChipLeadIndex(state) && agoraLeadBlinkBlack(nowMs)) {
    return agoraIsNeutral(state) ? AGORA_CONTESTED_RGB : AGORA_INK_RGB;
  }
  return agoraChipRestRgb(index, state);
}

export function agoraDashFillRgb(_state = {}, _trackRgb = AGORA_DASH_TRACK_RGB) {
  return AGORA_DASH_FILL_RGB;
}

/** 0..1 occupy mix for flag / agora TeamColor (idle stays the owner swatch). */
export function agoraCaptureMix(state = {}) {
  const capturer = state.capturer;
  if (capturer == null || (capturer | 0) < 0) return 0;
  if ((state.phase | 0) === AGORA_PHASE_TUG) {
    return Math.min(1, Math.max(0, (state.tug | 0) / AGORA_TUG_TICKS));
  }
  if ((state.progress | 0) <= 0) return 0;
  return Math.min(1, Math.max(0, (state.progress | 0) / AGORA_CAPTURE_TICKS));
}

/** Flag / agora body RGB — pulls toward the capturer as the meter fills. */
export function agoraPropTint(state = {}) {
  const ownerRgb = ownerTint(state.owner | 0);
  const mix = agoraCaptureMix(state);
  if (mix <= 0) return ownerRgb;
  const capRgb = ownerTint(state.capturer | 0);
  const t = 0.2 + 0.72 * mix;
  return [
    ownerRgb[0] + (capRgb[0] - ownerRgb[0]) * t,
    ownerRgb[1] + (capRgb[1] - ownerRgb[1]) * t,
    ownerRgb[2] + (capRgb[2] - ownerRgb[2]) * t,
  ];
}

/**
 * Contest: capturer inks in from the right over the owner.
 * Neutral tug: dots stay grey until claimed from the left.
 * @param {number} index
 * @param {{ phase?: number, progress?: number, tug?: number, owner?: number, founder?: number, capturer?: number, count?: number }} state
 */
export function agoraChipTintOwner(index, state = {}) {
  const count = state.count ?? AGORA_CHIP_COUNT;
  const owner = state.owner | 0;
  const capturer = state.capturer | 0;
  const { filled } = agoraMeterState(state);
  if (agoraIsNeutral(state)) {
    if (capturer >= 0 && index < filled) return capturer;
    return AGORA_TINT_NEUTRAL;
  }
  if (capturer >= 0 && index >= count - filled) return capturer;
  return owner;
}

/** Centered o-o-o-o-o: dots on both ends, rectangles in the gaps. */
export function agoraRowLayout(normalDot) {
  const n = Math.max(1e-3, normalDot);
  const dotD = n * DOT_DIAMETER_AGORA_LARGE_MUL;
  const dashW = n * DOT_DIAMETER_AGORA_DASH_W_MUL;
  const dashH = n * DOT_DIAMETER_AGORA_DASH_H_MUL;
  const gap = n * AGORA_DASH_INNER_GAP_MUL;
  const pitch = dotD + gap + dashW + gap;
  const groupW = (AGORA_CHIP_COUNT - 1) * pitch + dotD;
  const left = -groupW * 0.5;
  const dashAlong = [];
  const dotAlong = [];
  for (let i = 0; i < AGORA_CHIP_COUNT; i++) {
    dotAlong.push(left + dotD * 0.5 + i * pitch);
  }
  for (let i = 0; i < AGORA_DASH_COUNT; i++) {
    dashAlong.push(left + dotD + gap + dashW * 0.5 + i * pitch);
  }
  return { dashAlong, dotAlong, dashW, dashH, dotD };
}

/** Shift a width-scaled dash so it grows from the invade (right) or tug (left) end. */
export function agoraDashFillAlong(trackAlong, trackW, fill, fromRight) {
  const f = Math.max(0, Math.min(1, fill));
  const fillW = trackW * f;
  const shift = (trackW - fillW) * 0.5;
  return fromRight ? trackAlong + shift : trackAlong - shift;
}

function agoraFlipKey(x, z) {
  return `${(x * 100 + 0.5) | 0},${(z * 100 + 0.5) | 0}`;
}

/** Warlock-style ink beads: hang, swell, then fall (alpha + hard disc). */
export function emitAgoraInkDrips(emit, px, py, pz, size, gy, count) {
  if (!emit) return 0;
  const n = Number.isFinite(count) ? Math.max(0, count | 0) : 5 + ((Math.random() * 3) | 0);
  const killY = (Number.isFinite(gy) ? gy : py - 8) - 0.5;
  for (let i = 0; i < n; i++) {
    const hang = 0.1 + Math.random() * 0.18;
    const peak = size * (0.45 + Math.random() * 0.35);
    emit({
      blend: 'alpha',
      hard: true,
      fadeOut: false,
      killY,
      position: [
        px + (Math.random() - 0.5) * size * 0.45,
        py - size * 0.12,
        pz + (Math.random() - 0.5) * size * 0.45,
      ],
      velocity: [
        (Math.random() - 0.5) * 0.4,
        -0.35 - Math.random() * 0.7,
        (Math.random() - 0.5) * 0.4,
      ],
      gravity: [0, -16 - Math.random() * 8, 0],
      color: [0, 0, 0, 1],
      hangTime: hang,
      lifetime: hang + 0.9 + Math.random() * 0.4,
      startSize: size * (0.28 + Math.random() * 0.18),
      peakSize: peak,
      endSize: peak * 0.75,
      drag: 0.1,
    });
  }
  return n;
}

/** One heading every seed in a burst darts along. */
export function pickAgoraWind() {
  const yaw = -0.38 + Math.random() * 0.76;
  const speed = 5.8 + Math.random() * 2.0;
  return {
    x: Math.cos(yaw) * speed,
    y: 1.7 + Math.random() * 1.1,
    z: Math.sin(yaw) * speed * 0.58,
  };
}

/** Logo-style clock: white seeds dart with the wind, not a radial burst. */
export function emitAgoraDandelion(emit, px, py, pz, size, wind) {
  if (!emit) return 0;
  const wdir = wind ?? pickAgoraWind();
  const n = 8 + ((Math.random() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const along = 0.82 + Math.random() * 0.42;
    const flutter = 0.32;
    const seed = size * (0.09 + Math.random() * 0.12);
    const star = i % 3 === 0;
    emit({
      blend: 'alpha',
      hard: !star,
      shape: star ? 'star' : undefined,
      fadeOut: true,
      position: [
        px + (Math.random() - 0.5) * size * 0.1,
        py + size * 0.04,
        pz + (Math.random() - 0.5) * size * 0.1,
      ],
      velocity: [
        wdir.x * along + (Math.random() - 0.5) * flutter,
        wdir.y * (0.52 + Math.random() * 0.5),
        wdir.z * along + (Math.random() - 0.5) * flutter,
      ],
      gravity: [wdir.x * 0.1, 0.22 + Math.random() * 0.32, wdir.z * 0.1],
      color: [1, 1, 1, 1],
      hangTime: 0.01 + Math.random() * 0.04,
      lifetime: 0.7 + Math.random() * 0.35,
      startSize: star ? seed * 1.15 : [seed, seed * (0.45 + Math.random() * 0.25)],
      peakSize: seed * 1.15,
      endSize: seed * 0.26,
      drag: 0.16 + Math.random() * 0.14,
      spin: (Math.random() - 0.5) * 10,
    });
  }
  return n;
}

export function emitAgoraFlipFx(kind, emit, px, py, pz, size, gy, wind) {
  if (kind === AGORA_FX_MIX) {
    emitAgoraInkDrips(emit, px, py, pz, size, gy, 3);
    return emitAgoraDandelion(emit, px, py, pz, size, wind);
  }
  if (kind === AGORA_FX_DANDELION) return emitAgoraDandelion(emit, px, py, pz, size, wind);
  return emitAgoraInkDrips(emit, px, py, pz, size, gy);
}

function ringDotIndices(count) {
  return count === BUILDING_CHIP_COUNT ? [3, 5] : [1, 5];
}

function makeSpriteState() {
  const position = [0, 0, 0];
  const sizeWorld = [1, 1];
  const color = [1, 1, 1, 1];
  return {
    handle: null,
    position,
    sizeWorld,
    color,
    patch: { position, sizeWorld, color, frame: 0 },
  };
}

function makeSlot() {
  const dots = [];
  for (let i = 0; i < CHIP_COUNT_MAX; i++) dots.push(makeSpriteState());
  const under = [];
  for (let i = 0; i < UNDER_DOT_MAX; i++) under.push(makeSpriteState());
  return {
    active: false,
    dots,
    lead: makeSpriteState(),
    edge: makeSpriteState(),
    line: makeSpriteState(),
    under,
    /** Rings on two inner HP chips. */
    holy: [makeSpriteState(), makeSpriteState()],
    armor: [makeSpriteState(), makeSpriteState()],
    showHoly: false,
    showArmor: false,
  };
}

function showSprite(system, spr, frame) {
  spr.patch.frame = frame;
  if (!spr.handle) {
    spr.handle = addBillboardSprite(system, {
      position: spr.position,
      sizeWorld: spr.sizeWorld,
      color: spr.color,
      rotation: 0,
      frame,
    });
  } else {
    updateBillboardSprite(spr.handle, spr.patch);
  }
}

function hideSprite(spr) {
  if (!spr.handle) return;
  removeBillboardSprite(spr.handle);
  spr.handle = null;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {{ capacity?: number, getViewportHeight?: () => number, getViewportWidth?: () => number, emit?: (init: object) => unknown, groundYAt?: (x: number, z: number) => number }} [opts]
 */
export function createHealthBars(engine, scene, opts = {}) {
  const capacity = Math.max(1, opts.capacity ?? HEALTH_BAR_CAPACITY);
  const emitFx = opts.emit;
  const groundYAt = opts.groundYAt;
  const atlas = createHealthChipAtlas(engine);
  const system = createFacingBillboardSystem(atlas, {
    capacity: capacity * SPRITES_PER_SLOT,
    blendMode: billboardBlendAlpha,
    // Draw after world transparent geometry.
    order: 900,
  });
  addFacingBillboardSystem(scene, system);

  /** @type {ReturnType<typeof makeSlot>[]} */
  const slots = [];
  for (let i = 0; i < capacity; i++) slots.push(makeSlot());
  let used = 0;
  /** Highest slot that was live last frame — `end()` only hides this tail. */
  let prevUsed = 0;
  let viewH = 720;
  let viewW = 1280;
  let deviceH = 720;
  /** @type {Float32Array | number[] | null} */
  let viewProjection = null;
  let fov = CAMERA_BASE_FOV;
  let horizonScale = 1;
  let sizeScale = 1;
  let chipNow = 0;
  /** @type {Map<string, { filled: number, phase: number, flips: { index: number, t0: number, emitted: boolean }[] }>} */
  const agoraFlips = new Map();
  /** @type {Set<string>} */
  const agoraSeen = new Set();

  function hide(slot) {
    if (!slot.active) return;
    for (let i = 0; i < CHIP_COUNT_MAX; i++) hideSprite(slot.dots[i]);
    hideSprite(slot.lead);
    hideSprite(slot.edge);
    hideSprite(slot.line);
    for (let i = 0; i < UNDER_DOT_MAX; i++) hideSprite(slot.under[i]);
    for (let i = 0; i < 2; i++) {
      hideSprite(slot.holy[i]);
      hideSprite(slot.armor[i]);
    }
    slot.showHoly = false;
    slot.showArmor = false;
    slot.active = false;
  }

  /** Layout axes for this frame: orbit camera on the desktop, head pose in XR. */
  let viewEye = null;
  let viewRight = [1, 0];
  let viewUp = chipScreenUpDir(0, 0.82);
  let viewUpPx = chipScreenUpPixels(0.82);

  function cameraRight() {
    return viewRight;
  }

  function cameraEye() {
    return viewEye;
  }

  function readViewAxes(cam, headset) {
    if (headset?.worldMatrix) {
      const axes = headsetChipAxes(headset.worldMatrix);
      viewEye = axes.eye;
      viewRight = axes.right;
      viewUp = axes.up;
      viewUpPx = chipScreenUpPixelsForDown(axes.down);
      return;
    }
    const wm = cam?.worldMatrix;
    viewEye = wm ? [wm[12], wm[13], wm[14]] : null;
    viewRight = cam && typeof cam.alpha === 'number'
      ? [-Math.sin(cam.alpha), Math.cos(cam.alpha)]
      : [1, 0];
    viewUp = chipScreenUpDir(cam?.alpha ?? 0, cam?.beta ?? 0.82);
    viewUpPx = chipScreenUpPixels(cam?.beta ?? 0.82);
  }

  /**
   * Place chips above the unit on screen (tilt-aware), then pull along the
   * view ray so terrain/meshes don't occlude them.
   */
  function placeChipAnchor(x, y, z) {
    const [ux, uy, uz] = viewUp;
    const eye = cameraEye();
    const dist = eye
      ? Math.max(1e-3, Math.hypot(eye[0] - x, eye[1] - y, eye[2] - z))
      : 80;
    const upW = worldSizeForScreenPx(viewUpPx, dist, viewH, fov);
    const lx = x + ux * upW;
    const ly = y + uy * upW;
    const lz = z + uz * upW;
    if (!eye) return [lx, ly, lz];
    const dx = eye[0] - lx;
    const dy = eye[1] - ly;
    const dz = eye[2] - lz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return [lx, ly, lz];
    const inv = 1 / len;
    // Cap so we never pull past the camera; scale up a bit when the cam is far.
    const pull = Math.min(len * 0.45, Math.max(CAMERA_DEPTH_BIAS, len * 0.08));
    return [lx + dx * inv * pull, ly + dy * inv * pull, lz + dz * inv * pull];
  }

  function viewportHeight() {
    const fromOpts = opts.getViewportHeight?.();
    if (Number.isFinite(fromOpts) && fromOpts > 1) return fromOpts;
    const c = engine?.canvas;
    const h = c?.clientHeight || c?.height;
    return Number.isFinite(h) && h > 1 ? h : 720;
  }

  function viewportWidth() {
    const fromOpts = opts.getViewportWidth?.();
    if (Number.isFinite(fromOpts) && fromOpts > 1) return fromOpts;
    const c = engine?.canvas;
    const w = c?.clientWidth || c?.width;
    return Number.isFinite(w) && w > 1 ? w : 1280;
  }

  return {
    begin() {
      used = 0;
      agoraSeen.clear();
      chipNow = typeof performance !== 'undefined' ? performance.now() : 0;
      viewH = viewportHeight();
      viewW = viewportWidth();
      deviceH = engine?.canvas?.height > 1 ? engine.canvas.height : viewH;
      // In XR, scene.camera is the shadow stand-in: its fov is widened for
      // both eyes and its projection is not any screen. Chips take the
      // desktop fov so they cover the same angle as on the monitor, and
      // skip pixel-row snapping (there is no single pixel grid).
      const headset = opts.getHeadsetView?.() ?? null;
      const cam = headset ?? scene?.camera;
      readViewAxes(cam, headset);
      viewProjection = !headset && cam && viewW > 1 && viewH > 1
        ? getViewProjectionMatrix(cam, viewW / viewH)
        : null;
      const camFov = cam?.fov;
      fov = Number.isFinite(camFov) && camFov > 1e-3 ? camFov : CAMERA_BASE_FOV;
      const minR = cam?.lowerRadiusLimit ?? 50;
      const maxR = cam?.upperRadiusLimit ?? cam?.radius ?? 900;
      const zoomN = cameraZoomNormalized(cam?.radius, minR, maxR);
      horizonScale = chipHorizonScale(zoomN);
      sizeScale = chipLookDownScale(zoomN) * horizonScale;
    },

    /**
     * Place one v1-style chip row above the entity (constant screen size).
     * @param {number} x
     * @param {number} y chip-row world Y (above head / roof)
     * @param {number} z
     * @param {number} _unitSize unused — chips are a fixed small size for all units
     * @param {number} ratio 0..1
     * @param {{ armor?: boolean, holy?: boolean, building?: boolean, agora?: boolean, owner?: number, founder?: number, capturer?: number, progress?: number, tug?: number, phase?: number, contested?: number, direction?: number, hold?: number, rite?: number, hp?: number, manaReady?: number, seatsFilled?: number }} [flags]
     */
    write(x, y, z, _unitSize, ratio, flags = {}) {
      if (used >= capacity) return;
      if (horizonScale <= HORIZON_HIDE_EPS) return;
      const slot = slots[used++];
      const r = Math.max(0, Math.min(1, ratio));
      const armor = !!flags.armor;
      const holy = !!flags.holy;
      const agora = !!flags.agora;
      const count = agora ? AGORA_CHIP_COUNT : flags.building ? BUILDING_CHIP_COUNT : UNIT_CHIP_COUNT;
      const targetPx = agora ? TARGET_AGORA_DOT_PX : TARGET_DOT_PX;

      const [bx, by, bz] = placeChipAnchor(x, y, z);
      const eye = cameraEye();
      const dist = eye
        ? Math.hypot(eye[0] - bx, eye[1] - by, eye[2] - bz)
        : 0;
      const baseDot = dist > 1e-3
        ? worldSizeForScreenPx(targetPx, dist, viewH, fov)
        : NORMAL_DOT_DIAMETER * (targetPx / TARGET_DOT_PX);
      const normalDot = baseDot * sizeScale;
      const spacing = normalDot * (agora ? DOT_SPACING_AGORA_MUL : DOT_SPACING_MUL);
      const totalWidth = (count - 1) * spacing;
      const [rx, rz] = cameraRight();
      const { rgb: hpRgb } = chipBarState(r, count);
      const filled = agora ? 0 : chipBarFilled(r, count, flags.hp);
      const ringAt = ringDotIndices(count);

      const [ux, uy, uz] = viewUp;

      /**
       * @param {ReturnType<typeof makeSpriteState>} spr
       * @param {number} along
       * @param {number} sx
       * @param {number} sy
       * @param {number[]} rgb
       * @param {number} alpha
       * @param {number} frame
       * @param {number} towardCam
       * @param {number} [down]
       * @param {boolean} [snapPixelY]
       */
      function placeAlong(spr, along, sx, sy, rgb, alpha, frame, towardCam, down = 0, snapPixelY = false) {
        let px = bx + rx * along;
        let py = by;
        let pz = bz + rz * along;
        if (down) {
          px -= ux * down;
          py -= uy * down;
          pz -= uz * down;
        }
        if (towardCam > 0 && eye) {
          const dx = eye[0] - px;
          const dy = eye[1] - py;
          const dz = eye[2] - pz;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-6) {
            const k = towardCam / len;
            px += dx * k;
            py += dy * k;
            pz += dz * k;
          }
        }
        if (snapPixelY) {
          const snapDist = eye
            ? Math.hypot(eye[0] - px, eye[1] - py, eye[2] - pz)
            : dist;
          [px, py, pz] = snapWorldToPixelRow(
            px, py, pz,
            viewProjection,
            viewH,
            deviceH,
            ux, uy, uz,
            snapDist,
            fov,
          );
        }
        spr.position[0] = px;
        spr.position[1] = py;
        spr.position[2] = pz;
        spr.sizeWorld[0] = sx;
        spr.sizeWorld[1] = sy;
        spr.color[0] = rgb[0];
        spr.color[1] = rgb[1];
        spr.color[2] = rgb[2];
        spr.color[3] = alpha;
        showSprite(system, spr, frame);
      }

      // Armor behind, then holy, then HP, then opaque team pips on top.
      for (let ri = 0; ri < 2; ri++) {
        const dotIndex = ringAt[ri];
        const along = (dotIndex * spacing) - (totalWidth * 0.5);
        const px = bx + rx * along;
        const pz = bz + rz * along;

        if (armor) {
          const spr = slot.armor[ri];
          const d = normalDot * ARMOR_RING_VS_NORMAL;
          spr.position[0] = px;
          spr.position[1] = by;
          spr.position[2] = pz;
          spr.sizeWorld[0] = d;
          spr.sizeWorld[1] = d;
          // Dark ring — tint the white atlas frame.
          spr.color[0] = 0.07;
          spr.color[1] = 0.07;
          spr.color[2] = 0.08;
          spr.color[3] = 1;
          showSprite(system, spr, FRAME_RING_ARMOR);
        } else {
          hideSprite(slot.armor[ri]);
        }

        if (holy) {
          const spr = slot.holy[ri];
          const d = normalDot * HOLY_RING_VS_NORMAL;
          spr.position[0] = px;
          spr.position[1] = by;
          spr.position[2] = pz;
          spr.sizeWorld[0] = d;
          spr.sizeWorld[1] = d;
          spr.color[0] = 1;
          spr.color[1] = 1;
          spr.color[2] = 1;
          spr.color[3] = 1;
          showSprite(system, spr, FRAME_RING_HOLY);
        } else {
          hideSprite(slot.holy[ri]);
        }
      }

      const teamNudge = normalDot * TEAM_DEPTH_NUDGE_MUL;
      const teamRgb = ownerTint(flags.owner);
      if (agora) {
        hideSprite(slot.lead);
        hideSprite(slot.edge);
        hideSprite(slot.line);
        for (let i = 0; i < UNDER_DOT_MAX; i++) hideSprite(slot.under[i]);
        const row = agoraRowLayout(normalDot);
        const trackRgb = AGORA_DASH_TRACK_RGB;
        const meter = agoraMeterState(flags);
        const flipKey = agoraFlipKey(x, z);
        agoraSeen.add(flipKey);
        let rec = agoraFlips.get(flipKey);
        const phase = flags.phase | 0;
        const rite = flags.rite | 0;
        if (!rec) {
          rec = {
            filled: meter.filled,
            phase,
            flips: [],
            rite: 0,
            riteT0: 0,
            mixT: 0,
            unlockMelt: 0,
            unlockBuild: 0,
            unlockWind: null,
            finaleWished: false,
          };
          agoraFlips.set(flipKey, rec);
        }
        if (rite === AGORA_RITE_UNLOCK) {
          if (rec.rite !== AGORA_RITE_UNLOCK) {
            rec.rite = AGORA_RITE_UNLOCK;
            rec.riteT0 = chipNow;
            rec.unlockMelt = 0;
            rec.unlockBuild = 0;
            rec.unlockWind = null;
            rec.flips.length = 0;
          }
          rec.phase = phase;
          rec.filled = 0;
        } else if (rite === AGORA_RITE_FINALE) {
          if (rec.rite !== AGORA_RITE_FINALE) {
            rec.rite = AGORA_RITE_FINALE;
            rec.riteT0 = chipNow;
            rec.finaleWished = false;
          }
          if (meter.filled !== rec.filled) {
            const queued = agoraQueuedFlips(rec.phase, phase, rec.filled, meter.filled);
            for (const ev of queued) {
              const flipState = { ...flags, phase: ev.phase };
              rec.flips.push({
                index: agoraClaimedDotIndex(ev.order, flipState),
                t0: chipNow,
                emitted: false,
                fx: agoraFlipFxKind(flipState),
              });
            }
            rec.filled = meter.filled;
          }
          rec.phase = phase;
        } else if (rec.rite !== 0) {
          rec.rite = 0;
          rec.finaleWished = false;
          rec.filled = meter.filled;
          rec.phase = phase;
        } else if (meter.filled !== rec.filled || rec.phase !== phase) {
          const queued = agoraQueuedFlips(rec.phase, phase, rec.filled, meter.filled);
          for (const ev of queued) {
            const flipState = { ...flags, phase: ev.phase };
            rec.flips.push({
              index: agoraClaimedDotIndex(ev.order, flipState),
              t0: chipNow,
              emitted: false,
              fx: agoraFlipFxKind(flipState),
            });
          }
          rec.phase = phase;
          rec.filled = meter.filled;
        }
        rec.flips = rec.flips.filter((f) => chipNow - f.t0 < AGORA_FLIP_MS);
        const unlockT = rite === AGORA_RITE_UNLOCK ? agoraUnlockTimings() : null;
        const unlockElapsed = unlockT ? chipNow - rec.riteT0 : -1;
        const lockView = agoraLockCompleteFlags(flags);
        const dashState = unlockT
          ? (unlockElapsed < unlockT.melt0 ? lockView : agoraTugRestFlags(flags))
          : flags;
        const fromRight = agoraFromRight(dashState);
        const gy = groundYAt?.(x, z) ?? y - 12;
        for (let i = 0; i < AGORA_CHIP_COUNT; i++) {
          const spr = slot.dots[i];
          if (unlockT) {
            const beat = agoraUnlockDotBeat(i, unlockElapsed);
            if (beat.kind === 'gone') {
              hideSprite(spr);
              continue;
            }
            let style = null;
            let rgb;
            if (beat.kind === 'melt' || beat.kind === 'build') {
              style = agoraFlipStyle(beat.t, beat.fx);
              rgb = style.rgb ?? agoraChipRestRgb(
                i,
                beat.kind === 'build' ? agoraTugRestFlags(flags) : lockView,
              );
            } else if (beat.kind === 'hold') {
              rgb = agoraChipRestRgb(i, lockView);
            } else {
              rgb = agoraChipRestRgb(i, agoraTugRestFlags(flags));
            }
            const d = row.dotD * (style ? style.size : 1);
            const drop = style ? row.dotD * style.drop : 0;
            placeAlong(spr, row.dotAlong[i], d, d, rgb, CHIP_TEAM_FILL_ALPHA, FRAME_LEAD_ROUND, 0, drop);
            const bit = 1 << i;
            if (beat.kind === 'melt' && !(rec.unlockMelt & bit)) {
              rec.unlockMelt |= bit;
              emitAgoraFlipFx(AGORA_FX_INK, emitFx, spr.position[0], spr.position[1], spr.position[2], row.dotD, gy);
            }
            if (beat.kind === 'build' && !(rec.unlockBuild & bit)) {
              rec.unlockBuild |= bit;
              rec.unlockWind = rec.unlockWind || pickAgoraWind();
              emitAgoraFlipFx(AGORA_FX_DANDELION, emitFx, spr.position[0], spr.position[1], spr.position[2], row.dotD, gy, rec.unlockWind);
            }
            continue;
          }
          const flip = rec.flips.find((f) => f.index === i);
          const flipT = flip ? (chipNow - flip.t0) / AGORA_FLIP_MS : -1;
          const style = flipT >= 0 ? agoraFlipStyle(flipT, flip.fx) : null;
          const rgb = style?.rgb ?? agoraChipRgb(i, flags, chipNow);
          const pulse = rite === AGORA_RITE_FINALE ? 1 : agoraChipPulseMul(i, flags, chipNow);
          const d = row.dotD * (style ? style.size : pulse);
          const drop = style ? row.dotD * style.drop : 0;
          placeAlong(spr, row.dotAlong[i], d, d, rgb, CHIP_TEAM_FILL_ALPHA, FRAME_LEAD_ROUND, 0, drop);
          if (flip && !flip.emitted) {
            flip.emitted = true;
            emitAgoraFlipFx(
              flip.fx,
              emitFx,
              spr.position[0],
              spr.position[1],
              spr.position[2],
              row.dotD,
              gy,
            );
          }
        }
        if (rite === AGORA_RITE_FINALE && !rec.finaleWished && chipNow - rec.riteT0 >= AGORA_FINALE_WISH_AT_MS) {
          rec.finaleWished = true;
          const wind = pickAgoraWind();
          for (let i = 0; i < AGORA_CHIP_COUNT; i++) {
            const spr = slot.dots[i];
            if (!spr.handle) continue;
            emitAgoraDandelion(emitFx, spr.position[0], spr.position[1], spr.position[2], row.dotD, wind);
          }
        } else if (
          !unlockT
          && rite !== AGORA_RITE_FINALE
          && agoraIsNeutral(flags)
          && (flags.contested | 0)
          && (flags.direction | 0) === 0
        ) {
          const lead = agoraChipLeadIndex(flags);
          if (lead >= 0 && (rec.mixT === 0 || chipNow - rec.mixT >= AGORA_MIX_MS)) {
            rec.mixT = chipNow;
            const spr = slot.dots[lead];
            emitAgoraFlipFx(
              AGORA_FX_MIX,
              emitFx,
              spr.position[0],
              spr.position[1],
              spr.position[2],
              row.dotD,
              gy,
              pickAgoraWind(),
            );
          }
        }
        for (let i = 0; i < AGORA_DASH_COUNT; i++) {
          placeAlong(
            slot.dots[AGORA_CHIP_COUNT + i],
            row.dashAlong[i],
            row.dashW,
            row.dashH,
            trackRgb,
            AGORA_DASH_TRACK_ALPHA,
            FRAME_RECT,
            0,
          );
          const fill = agoraDashFill(i, dashState);
          const fillSpr = slot.dots[AGORA_CHIP_COUNT + AGORA_DASH_COUNT + i];
          if (fill <= 0) {
            hideSprite(fillSpr);
            continue;
          }
          const fillRgb = agoraDashFillRgb(dashState, trackRgb);
          const fillW = row.dashW * fill;
          placeAlong(
            fillSpr,
            agoraDashFillAlong(row.dashAlong[i], row.dashW, fill, fromRight),
            fillW,
            row.dashH,
            fillRgb,
            CHIP_TEAM_FILL_ALPHA,
            FRAME_RECT,
            0,
          );
        }
        for (let i = AGORA_CHIP_COUNT + AGORA_DASH_COUNT * 2; i < CHIP_COUNT_MAX; i++) {
          hideSprite(slot.dots[i]);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const spr = slot.dots[i];
          if (!chipDotVisible(i, filled)) {
            hideSprite(spr);
            continue;
          }
          const d = normalDot * chipSizeMul(i, count);
          const along = (i * spacing) - (totalWidth * 0.5);
          placeAlong(
            spr,
            along,
            d * chipWidthMul(i),
            d,
            chipFillRgb(i, hpRgb, flags.owner),
            chipDotAlpha(i, true, r),
            chipDotFrame(i),
            0,
          );
        }
        for (let i = count; i < CHIP_COUNT_MAX; i++) hideSprite(slot.dots[i]);
        const lineDown = normalDot * LINE_DOWN_MUL;
        const wedge = teamWedgeLayout(totalWidth, spacing, normalDot);
        placeAlong(
          slot.lead,
          wedge.along,
          wedge.width,
          wedge.height,
          teamRgb,
          CHIP_TEAM_FILL_ALPHA,
          FRAME_TEAM_WEDGE,
          teamNudge,
          lineDown - wedge.baselineShift,
          true,
        );
        placeAlong(
          slot.edge,
          wedge.along,
          wedge.width,
          wedge.height,
          teamEdgeRgb(teamRgb),
          CHIP_TEAM_FILL_ALPHA,
          FRAME_TEAM_EDGE,
          teamNudge + normalDot * 0.15,
          lineDown - wedge.baselineShift,
          true,
        );
        const { width: lineW, along: lineAlong } = chipLineLayout(totalWidth, spacing);
        placeAlong(
          slot.line,
          lineAlong,
          lineW,
          chipLineHeight(normalDot, dist, viewH, fov),
          teamRgb,
          CHIP_TEAM_FILL_ALPHA,
          FRAME_LINE,
          teamNudge,
          lineDown,
          true,
        );
        const underN = underDotCount(flags);
        const underSpace = normalDot * (underN > 3 ? UNDER_SPACING_PACKED_MUL : UNDER_SPACING_MUL);
        const underWidth = Math.max(0, underN - 1) * underSpace;
        const underRgb = underDotTint(flags);
        const underFrame = underDotFrame(flags);
        const underD = normalDot * DOT_DIAMETER_UNDER_MUL;
        for (let i = 0; i < UNDER_DOT_MAX; i++) {
          const spr = slot.under[i];
          if (i >= underN) {
            hideSprite(spr);
            continue;
          }
          const along = (i * underSpace) - (underWidth * 0.5);
          placeAlong(
            spr,
            along,
            underD,
            underD,
            underRgb,
            CHIP_TEAM_FILL_ALPHA,
            underFrame,
            teamNudge,
            normalDot * UNDER_DOWN_MUL,
          );
        }
      }

      slot.showArmor = armor;
      slot.showHoly = holy;
      slot.active = true;
    },

    end() {
      for (let s = used; s < prevUsed; s++) hide(slots[s]);
      prevUsed = used;
      for (const key of agoraFlips.keys()) {
        if (!agoraSeen.has(key)) agoraFlips.delete(key);
      }
    },

    clear() {
      clearBillboardSprites(system);
      for (let s = 0; s < capacity; s++) {
        const slot = slots[s];
        for (let i = 0; i < CHIP_COUNT_MAX; i++) slot.dots[i].handle = null;
        slot.lead.handle = null;
        slot.edge.handle = null;
        slot.line.handle = null;
        for (let i = 0; i < UNDER_DOT_MAX; i++) slot.under[i].handle = null;
        for (let i = 0; i < 2; i++) {
          slot.holy[i].handle = null;
          slot.armor[i].handle = null;
        }
        slot.showHoly = false;
        slot.showArmor = false;
        slot.active = false;
      }
      used = 0;
      prevUsed = 0;
    },
  };
}
