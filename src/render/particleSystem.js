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
  removeBillboardSprite,
  updateBillboardSprite,
} from '../vendor/lite/liteVendor.js';

const TEXTURE_SIZE = 32;

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
    patch: { position, sizeWorld, color: drawColor },
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
  };
}

/**
 * CPU particle simulation with pooled Lite billboard sprites.
 * Particle positions and velocities use world-units and seconds.
 */
export function createParticleSystem(engine, scene, options = {}) {
  const capacity = Math.max(1, options.capacity ?? 8192);
  const softAtlas = atlasFromAlphaDisk(engine, true);
  const hardAtlas = atlasFromAlphaDisk(engine, false);
  const starAtlas = atlasFromAlphaStar(engine);
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
  };
  addFacingBillboardSystem(scene, systems.additive);
  addFacingBillboardSystem(scene, systems.alpha);
  addFacingBillboardSystem(scene, systems.alphaHard);
  addFacingBillboardSystem(scene, systems.alphaHardStar);

  const active = [];
  const free = [];
  let dropped = 0;
  let emitted = 0;

  function emit(init = {}) {
    if (active.length >= capacity) {
      dropped++;
      return null;
    }
    const particle = free.pop() ?? makeParticle();
    const position = init.position ?? [0, 0, 0];
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
    const startSize = sizePair(init.startSize ?? init.size ?? 1);
    const endSize = sizePair(init.endSize ?? startSize, startSize[0]);
    // peakSize only matters for hang/swell particles (ink drips, dust puffs).
    // Default to startSize so a missing peak never collapses ordinary emitters.
    const peakSize = sizePair(init.peakSize ?? startSize, startSize[0]);
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
    const system =
      init.shape === 'star' && init.blend === 'alpha'
        ? systems.alphaHardStar
        : init.hard && init.blend === 'alpha'
          ? systems.alphaHard
          : init.blend === 'alpha'
            ? systems.alpha
            : systems.additive;
    particle.handle = addBillboardSprite(system, {
      position: particle.position,
      sizeWorld: particle.sizeWorld,
      color: particle.drawColor,
      rotation: init.rotation ?? 0,
      frame: 0,
    });
    active.push(particle);
    emitted++;
    return particle;
  }

  function emitBurst(init = {}) {
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
      particle.drawColor[3] = particle.fadeOut
        ? particle.startAlpha * (1 - particle.age / particle.lifetime)
        : particle.startAlpha;
      updateBillboardSprite(particle.handle, particle.patch);
    }
  }

  function clear() {
    clearBillboardSprites(systems.additive);
    clearBillboardSprites(systems.alpha);
    clearBillboardSprites(systems.alphaHard);
    clearBillboardSprites(systems.alphaHardStar);
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
    stats() {
      return { active: active.length, capacity, dropped, emitted };
    },
  };
}
