// v1-style health chips: five soft circles + optional armor/holy rings on the small dots.
// Agora capture recolor is intentionally omitted.

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

const DOT_COUNT = 5;
const TEX = 64;
const FRAME_SOFT = 0;
const FRAME_RING_HOLY = 1;
const FRAME_RING_ARMOR = 2;

/** Matches game/health-display.js rhythm (half of prior v2 size). */
const DOT_DIAMETER_MUL = 0.11;
const DOT_DIAMETER_ALTERNATE_MUL = 0.2;
const DOT_SPACING_MUL = 1.06;
const HOLY_RING_VS_NORMAL = 1.04;
const ARMOR_RING_VS_NORMAL = 1.26;

/** Max sprites per unit: 5 dots + 2 holy rings + 2 armor rings. */
const SPRITES_PER_SLOT = 9;
/**
 * Tiny toward-camera pull so chips clear the ground plane only.
 * Large bias made them draw over units — keep natural unit occlusion.
 */
const CAMERA_DEPTH_BIAS = 0.55;
/** Toward-camera XZ offset — reads as "below the unit" on a typical RTS view. */
const BELOW_SCREEN_OFFSET = 2.4;

function writeSoftCircle(pixels, ox, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.48;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy) / r;
      let a = 0;
      if (d <= 0.79) a = 0.84;
      else if (d < 1) {
        // Feather outer ~21% like v1 DynamicTexture stops.
        const t = (d - 0.79) / 0.21;
        a = t < 0.48 ? 0.84 + (0.38 - 0.84) * (t / 0.48) : 0.38 * (1 - (t - 0.48) / 0.52);
        a = Math.max(0, a);
      }
      const i = ((y * size * 3) + ox + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(a * 255);
    }
  }
}

function writeRing(pixels, ox, size, alpha) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const ir = size * 0.34;
  const or = size * 0.485;
  const aByte = Math.round(alpha * 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const on = d <= or && d >= ir;
      const i = ((y * size * 3) + ox + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = on ? aByte : 0;
    }
  }
}

function createHealthChipAtlas(engine) {
  const w = TEX * 3;
  const h = TEX;
  const pixels = new Uint8Array(w * h * 4);
  writeSoftCircle(pixels, 0, TEX);
  writeRing(pixels, TEX, TEX, 0.92);
  writeRing(pixels, TEX * 2, TEX, 0.94);
  const texture = createTexture2DFromPixels(engine, pixels, w, h, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createGridSpriteAtlas(texture, {
    cellWidthPx: TEX,
    cellHeightPx: TEX,
    columns: 3,
    rows: 1,
  });
}

function fillRgb(ratio) {
  if (ratio > 0.66) return [0.12, 0.92, 0.2];
  if (ratio > 0.33) return [0.95, 0.78, 0.12];
  return [0.92, 0.18, 0.12];
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
  for (let i = 0; i < DOT_COUNT; i++) dots.push(makeSpriteState());
  return {
    active: false,
    dots,
    /** Rings only on alternate (small) dots — indices 1 and 3. */
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
 * @param {{ capacity?: number }} [opts]
 */
export function createHealthBars(engine, scene, opts = {}) {
  const capacity = Math.max(1, opts.capacity ?? 256);
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

  function hide(slot) {
    if (!slot.active) return;
    for (let i = 0; i < DOT_COUNT; i++) hideSprite(slot.dots[i]);
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
   * Place chips: above ground, shifted toward camera on XZ (below unit on screen).
   * Only a tiny view-ray nudge so terrain doesn't eat them; units still occlude.
   */
  function placeChipAnchor(x, y, z) {
    const eye = cameraEye();
    if (!eye) return [x, y, z];
    const dx = eye[0] - x;
    const dy = eye[1] - y;
    const dz = eye[2] - z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return [x, y, z];
    const inv = 1 / len;
    const xzLen = Math.hypot(dx, dz) || 1;
    const ox = x + (dx / xzLen) * BELOW_SCREEN_OFFSET;
    const oz = z + (dz / xzLen) * BELOW_SCREEN_OFFSET;
    const b = CAMERA_DEPTH_BIAS;
    return [ox + dx * inv * b, y + dy * inv * b, oz + dz * inv * b];
  }

  return {
    begin() {
      used = 0;
    },

    /**
     * Place one v1-style chip row.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} unitSize
     * @param {number} ratio 0..1
     * @param {{ armor?: boolean, holy?: boolean }} [flags]
     */
    write(x, y, z, unitSize, ratio, flags = {}) {
      if (used >= capacity) return;
      const slot = slots[used++];
      const r = Math.max(0, Math.min(1, ratio));
      const armor = !!flags.armor;
      const holy = !!flags.holy;

      const normalDot = Math.max(0.35, unitSize * DOT_DIAMETER_MUL);
      const spacing = normalDot * DOT_SPACING_MUL;
      const totalWidth = (DOT_COUNT - 1) * spacing;
      const [rx, rz] = cameraRight();
      const rgb = fillRgb(r);
      const filled = Math.min(DOT_COUNT, Math.ceil(r * DOT_COUNT - 1e-6));
      const [bx, by, bz] = placeChipAnchor(x, y, z);

      // Armor behind, then holy, then chips (draw order ≈ add/update order).
      for (let ri = 0; ri < 2; ri++) {
        const dotIndex = ri === 0 ? 1 : 3;
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
          spr.color[3] = 0.94;
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
          spr.color[3] = 0.92;
          showSprite(system, spr, FRAME_RING_HOLY);
        } else {
          hideSprite(slot.holy[ri]);
        }
      }

      for (let i = 0; i < DOT_COUNT; i++) {
        const spr = slot.dots[i];
        const d =
          i === 1 || i === 3 ? normalDot * DOT_DIAMETER_ALTERNATE_MUL : normalDot;
        const along = (i * spacing) - (totalWidth * 0.5);
        spr.position[0] = bx + rx * along;
        spr.position[1] = by;
        spr.position[2] = bz + rz * along;
        spr.sizeWorld[0] = d;
        spr.sizeWorld[1] = d;
        if (i < filled) {
          spr.color[0] = rgb[0];
          spr.color[1] = rgb[1];
          spr.color[2] = rgb[2];
          spr.color[3] = 1;
        } else {
          spr.color[0] = 0.14;
          spr.color[1] = 0.14;
          spr.color[2] = 0.14;
          spr.color[3] = 0.5;
        }
        showSprite(system, spr, FRAME_SOFT);
      }

      slot.showArmor = armor;
      slot.showHoly = holy;
      slot.active = true;
    },

    end() {
      for (let s = used; s < capacity; s++) hide(slots[s]);
    },

    clear() {
      clearBillboardSprites(system);
      for (let s = 0; s < capacity; s++) {
        const slot = slots[s];
        for (let i = 0; i < DOT_COUNT; i++) slot.dots[i].handle = null;
        for (let i = 0; i < 2; i++) {
          slot.holy[i].handle = null;
          slot.armor[i].handle = null;
        }
        slot.showHoly = false;
        slot.showArmor = false;
        slot.active = false;
      }
      used = 0;
    },
  };
}
