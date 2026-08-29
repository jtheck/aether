// Reusable render-only particle pool backed by Lite facing billboards.

import {
  addBillboardSprite,
  addFacingBillboardSystem,
  billboardBlendAdditive,
  billboardBlendAlpha,
  clearBillboardSprites,
  createFacingBillboardSystem,
  createGridSpriteAtlas,
  createTexture2DFromPixels,
  loadTexture2D,
  removeBillboardSprite,
  updateBillboardSprite,
} from '../vendor/lite/liteVendor.js';
import { capacityFor } from '../sim/capacity.js';

const TEXTURE_SIZE = 32;
/** v1 Babylon fire/smoke sprite (`game/fx.js` ParticlePresets). */
export const PUFF_SPRITE_URL = '/assets/images/explosion.png';
/** Lean boot; grows by powers of two (Lite billboard buffers grow on add). */
export const PARTICLE_INITIAL_CAPACITY = 8192;
/** Absolute ceiling so a runaway emitter cannot OOM. */
export const PARTICLE_HARD_MAX = 262144;
/**
 * Size-aware camera cull: keep if dist ≤ max(MIN, size × K).
 * Tiny staff sparks (~0.16) fall off near MIN; fireball-scale (~2–8+) keep far.
 * K set so fireball-sized FX reach ~3× the prior mid-tune range.
 */
export const PARTICLE_CULL_MIN_RANGE = 220;
export const PARTICLE_CULL_SIZE_K = 660;

function atlasFromAlphaDisk(engine, soft) {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const center = (TEXTURE_SIZE - 1) * 0.5;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const distance = Math.hypot(dx, dy);
      let alpha;
      if (soft) {
        alpha = Math.max(0, Math.min(1, (1 - distance) * 2));
        alpha = alpha * alpha;
      } else {
        // Crisp disc with a 1px AA rim so round drops read solid, not foggy.
        const edge = 1.05;
        const aa = 2 / center;
        alpha = distance >= edge ? 0 : distance > edge - aa ? (edge - distance) / aa : 1;
      }
      const offset = (y * TEXTURE_SIZE + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = createTexture2DFromPixels(engine, pixels, TEXTURE_SIZE, TEXTURE_SIZE, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createGridSpriteAtlas(texture, {
    cellWidthPx: TEXTURE_SIZE,
    cellHeightPx: TEXTURE_SIZE,
    columns: 1,
    rows: 1,
  });
}

/** 4-point star (plus diamond tips) for warlock trail / shadow sparks. */
function atlasFromAlphaStar(engine) {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const center = (TEXTURE_SIZE - 1) * 0.5;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      // Cross arms + diamond core.
      const arm = Math.min(ax, ay) < 0.18 && Math.max(ax, ay) < 1.0;
      const diamond = ax + ay < 0.55;
      let alpha = 0;
      if (arm || diamond) {
        const edge = Math.min(
          arm ? 1 - Math.max(ax, ay) : 1,
          diamond ? (0.55 - (ax + ay)) / 0.55 : 1,
        );
        alpha = Math.max(0, Math.min(1, edge * 1.4));
      }
      const offset = (y * TEXTURE_SIZE + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  const texture = createTexture2DFromPixels(engine, pixels, TEXTURE_SIZE, TEXTURE_SIZE, {
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createGridSpriteAtlas(texture, {
    cellWidthPx: TEXTURE_SIZE,
    cellHeightPx: TEXTURE_SIZE,
    columns: 1,
    rows: 1,
  });
}

function sizePair(value, fallback = 1) {
  if (Array.isArray(value)) {
    return [Math.max(0, value[0] ?? fallback), Math.max(0, value[1] ?? value[0] ?? fallback)];
  }
  const n = Math.max(0, value ?? fallback);
  return [n, n];
}

function makeParticle() {
  const position = [0, 0, 0];
  const sizeWorld = [1, 1];
  const drawColor = [1, 1, 1, 1];
  return {
    handle: null,
    position,
    sizeWorld,
    drawColor,
    patch: { position, sizeWorld, color: drawColor, rotation: 0 },
    vx: 0,
    vy: 0,
    vz: 0,
    gravityX: 0,
    gravityY: 0,
    gravityZ: 0,
    drag: 0,
    age: 0,
    lifetime: 1,
    startSizeW: 1,
    startSizeH: 1,
    peakSizeW: 1,
    peakSizeH: 1,
    endSizeW: 1,
    endSizeH: 1,
    hangTime: 0,
    fadeOut: true,
    killY: -Infinity,
    startAlpha: 1,
    noCull: false,
    cullSize: 1,
    rotation: 0,
    spin: 0,
  };
}

async function atlasFromPuffSprite(engine) {
  const texture = await loadTexture2D(engine, PUFF_SPRITE_URL, {
    srgb: false,
    mipMaps: true,
    invertY: false,
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    minFilter: 'linear',
    magFilter: 'linear',
  });
  return createGridSpriteAtlas(texture, {
    cellWidthPx: texture.width,
    cellHeightPx: texture.height,
    columns: 1,
    rows: 1,
  });
}

function cullRange(size, scale = 1) {
  const s = Math.max(0.05, scale);
  return Math.max(PARTICLE_CULL_MIN_RANGE * s, size * PARTICLE_CULL_SIZE_K * s);
}

/**
 * CPU particle simulation with pooled Lite facing billboards.
 * Particle positions and velocities use world-units and seconds.
 * Capacity starts lean and grows by powers of two (billboard systems grow with it).
 * Far tiny particles are skipped / released via size-aware camera distance.
 *
 * @param {object} engine
 * @param {object} scene
 * @param {{
 *   capacity?: number,
 *   hardMax?: number,
 *   cullRangeScale?: number,
 *   muted?: boolean,
 *   getEye?: () => { x: number, y: number, z: number } | null,
 * }} [options]
 */
export async function createParticleSystem(engine, scene, options = {}) {
  const bootInitial = Math.max(1, options.capacity ?? PARTICLE_INITIAL_CAPACITY);
  let capacity = bootInitial;
  let hardMax = Math.max(1, options.hardMax ?? PARTICLE_HARD_MAX);
  if (hardMax < capacity) capacity = hardMax;
  let cullRangeScale = Math.max(0.05, options.cullRangeScale ?? 1);
  let muted = !!options.muted;
  const getEye = options.getEye;
  const softAtlas = atlasFromAlphaDisk(engine, true);
  const hardAtlas = atlasFromAlphaDisk(engine, false);
  const starAtlas = atlasFromAlphaStar(engine);
  let puffAtlas = softAtlas;
  try {
    puffAtlas = await atlasFromPuffSprite(engine);
  } catch (err) {
    console.warn('[particles] puff sprite failed, using disk', err);
  }
  const systems = {
    additive: createFacingBillboardSystem(softAtlas, {
      capacity,
      blendMode: billboardBlendAdditive,
    }),
    alpha: createFacingBillboardSystem(softAtlas, {
      capacity,
      blendMode: billboardBlendAlpha,
    }),
    alphaHard: createFacingBillboardSystem(hardAtlas, {
      capacity,
      blendMode: billboardBlendAlpha,
    }),
    alphaHardStar: createFacingBillboardSystem(starAtlas, {
      capacity,
      blendMode: billboardBlendAlpha,
    }),
    puffAdditive: createFacingBillboardSystem(puffAtlas, {
      capacity,
      blendMode: billboardBlendAdditive,
    }),
    puffAlpha: createFacingBillboardSystem(puffAtlas, {
      capacity,
      blendMode: billboardBlendAlpha,
    }),
  };
  addFacingBillboardSystem(scene, systems.additive);
  addFacingBillboardSystem(scene, systems.alpha);
  addFacingBillboardSystem(scene, systems.alphaHard);
  addFacingBillboardSystem(scene, systems.alphaHardStar);
  addFacingBillboardSystem(scene, systems.puffAdditive);
  addFacingBillboardSystem(scene, systems.puffAlpha);

  const active = [];
  const free = [];
  let dropped = 0;
  let emitted = 0;
  let culled = 0;

  function ensureCapacity(needed) {
    if (needed <= capacity) return true;
    if (needed > hardMax) return false;
    capacity = capacityFor(needed, { initial: bootInitial });
    if (capacity > hardMax) capacity = hardMax;
    return needed <= capacity;
  }

  /** Drop newest first until active ≤ hardMax (GPU buffers do not shrink). */
  function trimToHardMax() {
    while (active.length > hardMax) release(active.length - 1);
  }

  /** @returns {boolean} true if too far from camera for this size */
  function isTooFar(x, y, z, size) {
    if (!getEye) return false;
    const eye = getEye();
    if (!eye) return false;
    const range = cullRange(size, cullRangeScale);
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    return dx * dx + dy * dy + dz * dz > range * range;
  }

  function emit(init = {}) {
    if (muted) return null;
    const position = init.position ?? [0, 0, 0];
    const startSize = sizePair(init.startSize ?? init.size ?? 1);
    const endSize = sizePair(init.endSize ?? startSize, startSize[0]);
    // peakSize only matters for hang/swell particles (ink drips, dust puffs).
    const peakSize = sizePair(init.peakSize ?? startSize, startSize[0]);
    const sizeHint = Math.max(
      startSize[0],
      startSize[1],
      peakSize[0],
      peakSize[1],
      endSize[0],
      endSize[1],
    );
    const noCull = init.cull === false || init.noCull === true;
    if (!noCull && isTooFar(position[0], position[1], position[2], sizeHint)) {
      culled++;
      return null;
    }

    if (!ensureCapacity(active.length + 1)) {
      dropped++;
      return null;
    }
    const particle = free.pop() ?? makeParticle();
    const velocity = init.velocity ?? [0, 0, 0];
    const gravity = init.gravity ?? [0, 0, 0];
    const color = init.color ?? [1, 1, 1, 1];
    particle.position[0] = position[0];
    particle.position[1] = position[1];
    particle.position[2] = position[2];
    particle.vx = velocity[0];
    particle.vy = velocity[1];
    particle.vz = velocity[2];
    particle.gravityX = gravity[0];
    particle.gravityY = gravity[1];
    particle.gravityZ = gravity[2];
    particle.drag = Math.max(0, init.drag ?? 0);
    particle.age = 0;
    particle.lifetime = Math.max(0.001, init.lifetime ?? 0.5);
    particle.startSizeW = startSize[0];
    particle.startSizeH = startSize[1];
    particle.peakSizeW = peakSize[0];
    particle.peakSizeH = peakSize[1];
    particle.endSizeW = endSize[0];
    particle.endSizeH = endSize[1];
    particle.hangTime = Math.max(0, Math.min(particle.lifetime * 0.95, init.hangTime ?? 0));
    particle.fadeOut = init.fadeOut !== false;
    particle.killY = Number.isFinite(init.killY) ? init.killY : -Infinity;
    particle.startAlpha = color[3] ?? 1;
    particle.drawColor[0] = color[0];
    particle.drawColor[1] = color[1];
    particle.drawColor[2] = color[2];
    particle.drawColor[3] = particle.startAlpha;
    particle.sizeWorld[0] = particle.startSizeW;
    particle.sizeWorld[1] = particle.startSizeH;
    particle.noCull = noCull;
    particle.cullSize = sizeHint;
    particle.rotation = init.rotation ?? 0;
    particle.spin = init.spin ?? 0;
    particle.patch.rotation = particle.rotation;
    const puff = init.sprite === 'puff';
    const system =
      init.shape === 'star' && init.blend === 'alpha'
        ? systems.alphaHardStar
        : init.hard && init.blend === 'alpha'
          ? systems.alphaHard
          : init.blend === 'alpha'
            ? puff
              ? systems.puffAlpha
              : systems.alpha
            : puff
              ? systems.puffAdditive
              : systems.additive;
    // Lite doubles billboard capacity when count exceeds current _capacity.
    particle.handle = addBillboardSprite(system, {
      position: particle.position,
      sizeWorld: particle.sizeWorld,
      color: particle.drawColor,
      rotation: particle.rotation,
      frame: 0,
    });
    active.push(particle);
    emitted++;
    return particle;
  }

  function emitBurst(init = {}) {
    if (muted) return;
    const count = Math.max(0, Math.floor(init.count ?? 1));
    const speed = init.speed ?? 1;
    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      const vertical = init.verticalSpeed ?? 0;
      emit({
        ...init,
        velocity: [
          Math.cos(angle) * speed,
          vertical,
          Math.sin(angle) * speed,
        ],
      });
    }
  }

  function release(index) {
    const particle = active[index];
    removeBillboardSprite(particle.handle);
    particle.handle = null;
    const last = active.pop();
    if (index < active.length) active[index] = last;
    free.push(particle);
  }

  function update(deltaMs) {
    const dt = Math.min(0.1, Math.max(0, deltaMs / 1000));
    const eye = getEye?.() ?? null;
    for (let i = active.length - 1; i >= 0; i--) {
      const particle = active[i];
      particle.age += dt;
      if (particle.age >= particle.lifetime) {
        release(i);
        continue;
      }
      const hang = particle.hangTime;
      const hanging = hang > 0 && particle.age < hang;
      if (!hanging) {
        particle.vx += particle.gravityX * dt;
        particle.vy += particle.gravityY * dt;
        particle.vz += particle.gravityZ * dt;
        const damping = Math.exp(-particle.drag * dt);
        particle.vx *= damping;
        particle.vy *= damping;
        particle.vz *= damping;
        particle.position[0] += particle.vx * dt;
        particle.position[1] += particle.vy * dt;
        particle.position[2] += particle.vz * dt;
        if (particle.position[1] < particle.killY) {
          release(i);
          continue;
        }
      }
      if (hanging) {
        // Form in place: swell start → peak, stay opaque.
        const t = particle.age / hang;
        const ease = t * t * (3 - 2 * t);
        particle.sizeWorld[0] =
          particle.startSizeW + (particle.peakSizeW - particle.startSizeW) * ease;
        particle.sizeWorld[1] =
          particle.startSizeH + (particle.peakSizeH - particle.startSizeH) * ease;
      } else if (hang > 0) {
        const fallSpan = Math.max(0.001, particle.lifetime - hang);
        const fallT = Math.min(1, (particle.age - hang) / fallSpan);
        particle.sizeWorld[0] =
          particle.peakSizeW + (particle.endSizeW - particle.peakSizeW) * fallT;
        particle.sizeWorld[1] =
          particle.peakSizeH + (particle.endSizeH - particle.peakSizeH) * fallT;
      } else {
        // Ordinary particles: linear start → end over lifetime (pre-hangTime behavior).
        const progress = particle.age / particle.lifetime;
        particle.sizeWorld[0] =
          particle.startSizeW + (particle.endSizeW - particle.startSizeW) * progress;
        particle.sizeWorld[1] =
          particle.startSizeH + (particle.endSizeH - particle.startSizeH) * progress;
      }

      if (eye && !particle.noCull) {
        const size = Math.max(
          particle.sizeWorld[0],
          particle.sizeWorld[1],
          particle.cullSize || 0,
        );
        const range = cullRange(size, cullRangeScale);
        const dx = particle.position[0] - eye.x;
        const dy = particle.position[1] - eye.y;
        const dz = particle.position[2] - eye.z;
        if (dx * dx + dy * dy + dz * dz > range * range) {
          culled++;
          release(i);
          continue;
        }
      }

      particle.drawColor[3] = particle.fadeOut
        ? particle.startAlpha * (1 - particle.age / particle.lifetime)
        : particle.startAlpha;
      if (particle.spin) {
        particle.rotation += particle.spin * dt;
        particle.patch.rotation = particle.rotation;
      }
      updateBillboardSprite(particle.handle, particle.patch);
    }
  }

  function clear() {
    clearBillboardSprites(systems.additive);
    clearBillboardSprites(systems.alpha);
    clearBillboardSprites(systems.alphaHard);
    clearBillboardSprites(systems.alphaHardStar);
    clearBillboardSprites(systems.puffAdditive);
    clearBillboardSprites(systems.puffAlpha);
    while (active.length) {
      const particle = active.pop();
      particle.handle = null;
      free.push(particle);
    }
  }

  return {
    emit,
    emitBurst,
    update,
    clear,
    dispose: clear,
    /**
     * Live quality knob. Lowers drop excess actives; cannot reclaim GPU
     * billboard buffer peak until clear+reload.
     * @param {{ hardMax?: number, cullRangeScale?: number }} opts
     */
    configure(opts = {}) {
      if (opts.hardMax != null) {
        hardMax = Math.max(1, opts.hardMax | 0);
        trimToHardMax();
      }
      if (opts.cullRangeScale != null) {
        cullRangeScale = Math.max(0.05, opts.cullRangeScale);
      }
      if (opts.muted != null) {
        muted = !!opts.muted;
        if (muted) clear();
      }
    },
    setMuted(on) {
      muted = !!on;
      if (muted) clear();
      return muted;
    },
    stats() {
      return {
        active: active.length,
        capacity,
        hardMax,
        dropped,
        culled,
        emitted,
        cullRangeScale,
        muted,
      };
    },
  };
}
