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

const TEXTURE_SIZE = 16;

function createSoftParticleAtlas(engine) {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const center = (TEXTURE_SIZE - 1) * 0.5;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const distance = Math.hypot(dx, dy);
      const alpha = Math.max(0, Math.min(1, (1 - distance) * 2));
      const offset = (y * TEXTURE_SIZE + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * alpha * 255);
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
    startSize: 1,
    endSize: 1,
    startAlpha: 1,
  };
}

/**
 * CPU particle simulation with pooled Lite billboard sprites.
 * Particle positions and velocities use world-units and seconds.
 */
export function createParticleSystem(engine, scene, options = {}) {
  const capacity = Math.max(1, options.capacity ?? 8192);
  const atlas = createSoftParticleAtlas(engine);
  const systems = {
    additive: createFacingBillboardSystem(atlas, {
      capacity,
      blendMode: billboardBlendAdditive,
    }),
    alpha: createFacingBillboardSystem(atlas, {
      capacity,
      blendMode: billboardBlendAlpha,
    }),
  };
  addFacingBillboardSystem(scene, systems.additive);
  addFacingBillboardSystem(scene, systems.alpha);

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
    particle.startSize = Math.max(0, init.startSize ?? init.size ?? 1);
    particle.endSize = Math.max(0, init.endSize ?? particle.startSize);
    particle.startAlpha = color[3] ?? 1;
    particle.drawColor[0] = color[0];
    particle.drawColor[1] = color[1];
    particle.drawColor[2] = color[2];
    particle.drawColor[3] = particle.startAlpha;
    particle.sizeWorld[0] = particle.startSize;
    particle.sizeWorld[1] = particle.startSize;
    const system = init.blend === 'alpha' ? systems.alpha : systems.additive;
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
      const progress = particle.age / particle.lifetime;
      const size = particle.startSize + (particle.endSize - particle.startSize) * progress;
      particle.sizeWorld[0] = size;
      particle.sizeWorld[1] = size;
      particle.drawColor[3] = particle.startAlpha * (1 - progress);
      updateBillboardSprite(particle.handle, particle.patch);
    }
  }

  function clear() {
    clearBillboardSprites(systems.additive);
    clearBillboardSprites(systems.alpha);
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
