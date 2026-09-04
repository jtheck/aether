// Health chips: unit row is 7 (4 big / 3 small, big on the ends), buildings
// add one more on each end (9). Big chips are translucent HP — green above
// 66%, yellow above 33%, then red — drawn behind opaque team-color circles.
// Agora rows are 9 circles (large / small…). Invade fills from the right;
// after unlock, small chips stay the founder color and the tug fills left.
// Optional armor/holy rings sit on the inner small tiles.

import {
  addBillboardSprite,
  addFacingBillboardSystem,
  billboardBlendAlpha,
  clearBillboardSprites,
  createFacingBillboardSystem,
  createGridSpriteAtlas,
  createTexture2DFromPixels,
  removeBillboardSprite,
  updateBillboardSprite,
} from '../vendor/lite/liteVendor.js';
import { CAMERA_CLOSE_SPAN, cameraZoomNormalized } from './cameraController.js';
import { HEALTH_BAR_CAPACITY } from './overlayLod.js';
import { ownerTint } from './ownerTints.js';
import { AGORA_CAPTURE_TICKS, AGORA_PHASE_TUG } from '../sim/agora.js';

export const UNIT_CHIP_COUNT = 7;
export const BUILDING_CHIP_COUNT = 9;
/** Capture meter: L S L S L S L S L circles. */
export const AGORA_CHIP_COUNT = 9;
export const AGORA_LARGE_CHIP_COUNT = 5;
/** Sentinel — tug large chips that are not yet claimed. */
export const AGORA_TINT_NEUTRAL = -2;
export const AGORA_NEUTRAL_RGB = [0.26, 0.26, 0.28];
const CHIP_COUNT_MAX = BUILDING_CHIP_COUNT;
/** One extra slot so a team square can sit past a full row. */
const CHIP_DOT_SLOTS = CHIP_COUNT_MAX + 1;
const TEX = 64;
const FRAME_ROUND = 0;
const FRAME_SQUARE = 1;
const FRAME_LEAD_ROUND = 2;
const FRAME_RING_HOLY = 3;
const FRAME_RING_ARMOR = 4;
const ATLAS_COLUMNS = 5;
/** Corner radius as a fraction of half-extent. 0 = sharp square, 1 = circle. */
export const CHIP_BIG_CORNER_MUL = 0.48;
export const CHIP_SMALL_CORNER_MUL = 0.48;
export const CHIP_LEAD_CORNER_MUL = 1;
/** Top/bottom bar thickness on big chips, as a fraction of the atlas cell. */
export const CHIP_BASELINE_MUL = 0.075;
/** Atlas alpha of those bars vs the chip fill. */
export const CHIP_BASELINE_ALPHA = 0.5;
/** Right-edge tick — full atlas alpha. */
export const CHIP_EDGE_ALPHA = 1;
/** Middle of the HP pip, under the right-edge tick. */
export const CHIP_BODY_ALPHA = 0.85;
/** Sprite alpha is raised so the dropped middle stays near the old look. */
export const CHIP_FILL_ALPHA_GREEN = 0.5;
export const CHIP_FILL_ALPHA_RED = 1;
export const CHIP_TEAM_FILL_ALPHA = 1;

/** Fallback world diameter if the camera eye is unknown. */
export const NORMAL_DOT_DIAMETER = 0.4;
/** Main-dot size in CSS pixels — world size scales with distance to hold this. */
export const TARGET_DOT_PX = 8;
/** Half size past the look-at near radius. */
export const TARGET_DOT_PX_FAR = TARGET_DOT_PX * 0.5;
const DOT_DIAMETER_MAIN_MUL = 0.88;
/** First HP pip — a tick larger than the other big chips. */
export const DOT_DIAMETER_FIRST_MUL = 0.96;
/** Small interstitial chips (team-color circles). Still below the big HP pips. */
export const DOT_DIAMETER_ALTERNATE_MUL = 0.58;
/** Circles stay 1:1 — leftover from the old wide squares. */
export const DOT_ALTERNATE_WIDTH_MUL = 1;
/** Permanent left team pip — a tick larger than the in-row team circles. */
export const DOT_DIAMETER_LEAD_MUL = 0.80;
/** Center gap — visual tiles are smaller than the billboard, so this can sit under 0.72. */
const DOT_SPACING_MUL = 0.54;
/** Agora circles — large on even slots, smaller on odd, with air between. */
export const DOT_DIAMETER_AGORA_LARGE_MUL = 1.42;
export const DOT_DIAMETER_AGORA_SMALL_MUL = 0.86;
export const DOT_SPACING_AGORA_MUL = 1.45;
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

/** Max sprites per slot: 10 dots + 2 holy rings + 2 armor rings. */
const SPRITES_PER_SLOT = CHIP_DOT_SLOTS + 4;
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

function writeSoftChip(pixels, ox, size, cornerMul, opts = {}) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  // Stay inside the atlas cell so linear filter doesn't pick up the next frame.
  const half = size * 0.36;
  const corner = half * Math.max(0, cornerMul);
  const feather = size * 0.02;
  const line = size * CHIP_BASELINE_MUL;
  const topLine = !!opts.topLine;
  const bottomLine = !!opts.bottomLine;
  const rightLine = !!opts.rightLine;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const d = sdRoundBox(px, py, half, corner);
      let a = 0;
      if (d <= 0) a = 1;
      else if (d < feather) a = 1 - d / feather;
      const i = ((y * size * ATLAS_COLUMNS) + ox + x) * 4;
      // Premult-safe: keep RGB 0 when the texel is empty so filtered
      // edges don't pick up a white fringe over the scene.
      const bar = (bottomLine && py > half - line) || (topLine && py < -half + line);
      const edge = rightLine && px > half - line;
      if (edge) a *= CHIP_EDGE_ALPHA;
      else if (bar) a *= CHIP_BASELINE_ALPHA;
      else if (topLine || bottomLine || rightLine) a *= CHIP_BODY_ALPHA;
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
  const f = fov > 1e-3 ? fov : 0.8;
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
  const f = fov > 1e-3 ? fov : 0.8;
  return (screenPx * 2 * d * Math.tan(f * 0.5)) / vh;
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
  const down = Math.max(0, Math.cos(b));
  return CHIP_SCREEN_UP_PX + CHIP_SCREEN_UP_TILT_PX * down;
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

/** Size vs the normal chip. Even = big, odd = small. 7: N S N S N S N. 9: + N S. */
export function chipSizeMul(index, _count) {
  if (index === 0) return DOT_DIAMETER_FIRST_MUL;
  return index % 2 === 1 ? DOT_DIAMETER_ALTERNATE_MUL : DOT_DIAMETER_MAIN_MUL;
}

/** Width vs height. Team circles stay round. */
export function chipWidthMul(_index) {
  return 1;
}

/** Odd slots are the small chips between the HP pips. */
export function chipIsTeamDot(index) {
  return (index & 1) === 1;
}

/** Big chips are HP color; small chips (and the left pip) are team color. */
export function chipFillRgb(index, hpRgb, owner) {
  return chipIsTeamDot(index) ? ownerTint(owner) : hpRgb;
}

/** Atlas frame: odd slots are team circles; even are rounded HP. */
export function chipDotFrame(index) {
  return chipIsTeamDot(index) ? FRAME_LEAD_ROUND : FRAME_ROUND;
}

/** Opacity from HP ratio: 1 = green, 0 = red. */
export function chipFillAlpha(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  return CHIP_FILL_ALPHA_GREEN + (CHIP_FILL_ALPHA_RED - CHIP_FILL_ALPHA_GREEN) * (1 - r);
}

/** Small chips match the left team pip; big HP chips use health alpha. */
export function chipDotAlpha(index, filled, ratio) {
  if (!filled) return 1;
  return chipIsTeamDot(index) ? CHIP_TEAM_FILL_ALPHA : chipFillAlpha(ratio);
}

/** Extra sprite slot: permanent team square to the left of the HP row. */
export const CHIP_LEAD_TEAM_INDEX = CHIP_COUNT_MAX;

export function chipIsLeadingTeam(index) {
  return index === CHIP_LEAD_TEAM_INDEX;
}

/** HP pips only. The left team pip is drawn separately. */
export function chipDotVisible(index, filledCount) {
  return index < filledCount;
}

export function agoraChipSizeMul(index) {
  return (index & 1) === 1 ? DOT_DIAMETER_AGORA_SMALL_MUL : DOT_DIAMETER_AGORA_LARGE_MUL;
}

/** How many pips a 0..maxTicks meter has earned. */
export function agoraChipFilled(progress, count = AGORA_CHIP_COUNT, maxTicks = AGORA_CAPTURE_TICKS) {
  const n = Math.max(1, count | 0);
  const max = Math.max(1, maxTicks | 0);
  const p = Math.max(0, progress | 0);
  if (p <= 0) return 0;
  return Math.min(n, Math.max(1, Math.ceil((p / max) * n - 1e-6)));
}

export function agoraChipIsSmall(index) {
  return (index & 1) === 1;
}

/**
 * Lock: capturer invades from the right.
 * Tug: small chips stay founder; large chips fill from the left (or stay neutral).
 * @param {number} index
 * @param {{ phase?: number, progress?: number, tug?: number, owner?: number, founder?: number, capturer?: number, count?: number }} state
 */
export function agoraChipTintOwner(index, state = {}) {
  const count = state.count ?? AGORA_CHIP_COUNT;
  const owner = state.owner | 0;
  const founder = state.founder != null ? state.founder | 0 : owner;
  const capturer = state.capturer | 0;
  if ((state.phase | 0) === AGORA_PHASE_TUG) {
    if (agoraChipIsSmall(index)) return founder;
    const filled = agoraChipFilled(state.tug, AGORA_LARGE_CHIP_COUNT);
    const largeIndex = index >> 1;
    if (capturer >= 0 && largeIndex < filled) return capturer;
    return AGORA_TINT_NEUTRAL;
  }
  const filled = agoraChipFilled(state.progress, count);
  if (capturer >= 0 && index >= count - filled) return capturer;
  return owner;
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
  for (let i = 0; i < CHIP_DOT_SLOTS; i++) dots.push(makeSpriteState());
  return {
    active: false,
    dots,
    /** Rings on the two small chips nearest the center of the inner 7. */
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
 * @param {{ capacity?: number, getViewportHeight?: () => number }} [opts]
 */
export function createHealthBars(engine, scene, opts = {}) {
  const capacity = Math.max(1, opts.capacity ?? HEALTH_BAR_CAPACITY);
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
  let fov = 0.8;
  let horizonScale = 1;
  let sizeScale = 1;

  function hide(slot) {
    if (!slot.active) return;
    for (let i = 0; i < CHIP_DOT_SLOTS; i++) hideSprite(slot.dots[i]);
    for (let i = 0; i < 2; i++) {
      hideSprite(slot.holy[i]);
      hideSprite(slot.armor[i]);
    }
    slot.showHoly = false;
    slot.showArmor = false;
    slot.active = false;
  }

  function cameraRight() {
    const cam = scene?.camera;
    if (!cam || typeof cam.alpha !== 'number') return [1, 0];
    const a = cam.alpha;
    return [-Math.sin(a), Math.cos(a)];
  }

  function cameraEye() {
    const wm = scene?.camera?.worldMatrix;
    if (!wm) return null;
    return [wm[12], wm[13], wm[14]];
  }

  /**
   * Place chips above the unit on screen (tilt-aware), then pull along the
   * view ray so terrain/meshes don't occlude them.
   */
  function placeChipAnchor(x, y, z) {
    const cam = scene?.camera;
    const a = cam?.alpha ?? 0;
    const beta = cam?.beta ?? 0.82;
    const [ux, uy, uz] = chipScreenUpDir(a, beta);
    const eye = cameraEye();
    const dist = eye
      ? Math.max(1e-3, Math.hypot(eye[0] - x, eye[1] - y, eye[2] - z))
      : 80;
    const upW = worldSizeForScreenPx(chipScreenUpPixels(beta), dist, viewH, fov);
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

  return {
    begin() {
      used = 0;
      viewH = viewportHeight();
      const cam = scene?.camera;
      const camFov = cam?.fov;
      fov = Number.isFinite(camFov) && camFov > 1e-3 ? camFov : 0.8;
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
     * @param {{ armor?: boolean, holy?: boolean, building?: boolean, agora?: boolean, far?: boolean, owner?: number, founder?: number, capturer?: number, progress?: number, tug?: number, phase?: number, hp?: number }} [flags]
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
      const targetPx = flags.far ? TARGET_DOT_PX_FAR : TARGET_DOT_PX;

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

      /**
       * @param {ReturnType<typeof makeSpriteState>} spr
       * @param {number} along
       * @param {number} d
       * @param {number[]} rgb
       * @param {number} alpha
       * @param {number} frame
       * @param {number} towardCam
       */
      function placeAlong(spr, along, d, rgb, alpha, frame, towardCam) {
        let px = bx + rx * along;
        let py = by;
        let pz = bz + rz * along;
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
        spr.position[0] = px;
        spr.position[1] = py;
        spr.position[2] = pz;
        spr.sizeWorld[0] = d;
        spr.sizeWorld[1] = d;
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
      if (agora) {
        for (let i = 0; i < CHIP_DOT_SLOTS; i++) {
          const spr = slot.dots[i];
          if (chipIsLeadingTeam(i) || i >= count) {
            hideSprite(spr);
            continue;
          }
          const d = normalDot * agoraChipSizeMul(i);
          const along = (i * spacing) - (totalWidth * 0.5);
          const tint = agoraChipTintOwner(i, flags);
          const rgb = tint === AGORA_TINT_NEUTRAL ? AGORA_NEUTRAL_RGB : ownerTint(tint);
          placeAlong(spr, along, d, rgb, CHIP_TEAM_FILL_ALPHA, FRAME_LEAD_ROUND, 0);
        }
      } else {
        for (let i = 0; i < count; i++) {
          if (chipIsTeamDot(i)) continue;
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
            chipFillRgb(i, hpRgb, flags.owner),
            chipDotAlpha(i, true, r),
            chipDotFrame(i),
            0,
          );
        }
        for (let i = 0; i < count; i++) {
          if (!chipIsTeamDot(i)) continue;
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
            d,
            ownerTint(flags.owner),
            CHIP_TEAM_FILL_ALPHA,
            FRAME_LEAD_ROUND,
            teamNudge,
          );
        }
        for (let i = count; i < CHIP_COUNT_MAX; i++) hideSprite(slot.dots[i]);
        const lead = slot.dots[CHIP_LEAD_TEAM_INDEX];
        const along = -spacing - (totalWidth * 0.5);
        placeAlong(
          lead,
          along,
          normalDot * DOT_DIAMETER_LEAD_MUL,
          ownerTint(flags.owner),
          CHIP_TEAM_FILL_ALPHA,
          FRAME_LEAD_ROUND,
          teamNudge,
        );
      }

      slot.showArmor = armor;
      slot.showHoly = holy;
      slot.active = true;
    },

    end() {
      for (let s = used; s < prevUsed; s++) hide(slots[s]);
      prevUsed = used;
    },

    clear() {
      clearBillboardSprites(system);
      for (let s = 0; s < capacity; s++) {
        const slot = slots[s];
        for (let i = 0; i < CHIP_DOT_SLOTS; i++) slot.dots[i].handle = null;
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
