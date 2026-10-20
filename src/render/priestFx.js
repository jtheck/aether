// Priest smite and heal. Both are meshes, not stretched billboard discs.
// Smite is a tapered crescent that sweeps across the target.
// Heal is thin gold threads climbing the body, plus one rising wave.
// The quad is only a canvas; the light dies inside it.
// The holy-slash projectile stays in the sim for the hit; it is not drawn.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';

const SLASH_CAP = 64;
const HEAL_CAP = 48;
export const HOLY_SLASH_SEGMENTS = 18;
const SLASH_HALF_ANGLE = 0.75;
const SLASH_RADIUS = 1;
const SLASH_HALF_WIDTH = 0.14;
const SLASH_EDGE = 0.5;
const SLASH_WORLD = 4.4;
const SLASH_LIFE = 0.48;
const SLASH_TILT = -0.42;
const HEAL_LIFE = 0.85;
const HEAL_HEIGHT = 4.1;
const HEAL_HALF_WIDTH = 1.2;

function stationRadii(t) {
  const taper = Math.sin(t * Math.PI);
  const half = SLASH_HALF_WIDTH * taper;
  return [SLASH_RADIUS - half, SLASH_RADIUS + half * SLASH_EDGE];
}

/**
 * Crescent in local XY, chord along Y, belly toward +X, tips pinched to points.
 * uv.x is along the cut (0..1). uv.y is across the blade (0 spine, 1 edge).
 */
export function holySlashGeometry(segments = HOLY_SLASH_SEGMENTS) {
  const n = Math.max(4, segments | 0);
  const rings = n + 1;
  const positions = new Float32Array(rings * 2 * 3);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array(rings * 2 * 2);
  const indices = new Uint32Array(n * 6);
  const mid = stationRadii(0.5);
  const shiftX = (mid[0] + mid[1]) * 0.5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = -SLASH_HALF_ANGLE + t * SLASH_HALF_ANGLE * 2;
    const radii = stationRadii(t);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const base = i * 2;
    const p = base * 3;
    positions[p] = c * radii[0] - shiftX;
    positions[p + 1] = s * radii[0];
    positions[p + 3] = c * radii[1] - shiftX;
    positions[p + 4] = s * radii[1];
    normals[p + 2] = 1;
    normals[p + 5] = 1;
    const u = base * 2;
    uvs[u] = t;
    uvs[u + 1] = 0;
    uvs[u + 2] = t;
    uvs[u + 3] = 1;
    if (i === n) continue;
    const i0 = base;
    const i1 = i0 + 1;
    const j0 = i0 + 2;
    const j1 = j0 + 1;
    const k = i * 6;
    indices[k] = i0;
    indices[k + 1] = j0;
    indices[k + 2] = i1;
    indices[k + 3] = i1;
    indices[k + 4] = j0;
    indices[k + 5] = j1;
  }
  return { positions, normals, uvs, indices };
}

/** Oversized canvas. uv.x is -1..1 across, uv.y is 0..1 feet to above the crown. */
export function holyInfusionGeometry() {
  const positions = new Float32Array([
    -1, 0, 0,
    1, 0, 0,
    -1, 1, 0,
    1, 1, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const uvs = new Float32Array([
    -1, 0,
    1, 0,
    -1, 1,
    1, 1,
  ]);
  const indices = new Uint32Array([0, 1, 3, 0, 3, 2]);
  return { positions, normals, uvs, indices };
}

/**
 * In-plane rotation whose chord (local +Y) cuts across the shot, tilted off horizontal.
 * right/up are the camera-plane axes. vx/vz is the shot in the ground plane.
 */
export function slashChordAngle(rx, rz, ux, uz, vx, vz) {
  const ar = vx * rx + vz * rz;
  const au = vx * ux + vz * uz;
  let px = -au;
  let py = ar;
  let pl = Math.hypot(px, py);
  if (pl < 0.2) {
    px = 0.62;
    py = -0.78;
    pl = Math.hypot(px, py);
  }
  px /= pl;
  py /= pl;
  const cs = Math.cos(SLASH_TILT);
  const sn = Math.sin(SLASH_TILT);
  const tx = px * cs - py * sn;
  const ty = px * sn + py * cs;
  return Math.atan2(-tx, ty);
}

/**
 * Shot direction only nudges the cut. The strike angle and how flat the arch
 * is are rolled per hit, so a volley in one view is not one repeated pose.
 * @param {() => number} [rand]
 */
export function rollSlashPose(rand = Math.random) {
  return {
    spin: (rand() - 0.5) * Math.PI,
    flat: 0.34 + rand() * 0.28,
    sweepDir: rand() < 0.5 ? -1 : 1,
  };
}

function viewBasis(eye, x, y, z) {
  let fx = (eye?.x ?? x) - x;
  let fy = (eye?.y ?? y) - y;
  let fz = (eye?.z ?? z) - z;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-4) {
    fx = 0;
    fy = 0.45;
    fz = 1;
    fl = Math.hypot(fx, fy, fz);
  }
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-4) {
    rx = 1;
    ry = 0;
    rz = 0;
  } else {
    rx /= rl;
    ry /= rl;
    rz /= rl;
  }
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  return { rx, ry, rz, ux, uy, uz, fx, fy, fz };
}

function writePlane(matrices, slot, x, y, z, basis, angle, sx, sy) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = basis.rx * c + basis.ux * s;
  const ry = basis.ry * c + basis.uy * s;
  const rz = basis.rz * c + basis.uz * s;
  const ux = -basis.rx * s + basis.ux * c;
  const uy = -basis.ry * s + basis.uy * c;
  const uz = -basis.rz * s + basis.uz * c;
  const o = slot * 16;
  matrices[o] = rx * sx;
  matrices[o + 1] = ry * sx;
  matrices[o + 2] = rz * sx;
  matrices[o + 3] = 0;
  matrices[o + 4] = ux * sy;
  matrices[o + 5] = uy * sy;
  matrices[o + 6] = uz * sy;
  matrices[o + 7] = 0;
  matrices[o + 8] = basis.fx;
  matrices[o + 9] = basis.fy;
  matrices[o + 10] = basis.fz;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function slashMaterial() {
  return createShaderMaterial({
    name: 'priest-smite-slash',
    attributes: ['position', 'uv'],
    uniforms: ['world', 'viewProjection'],
    useThinInstanceColors: true,
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    depthCompare: 'always',
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) along: f32,
  @location(1) across: f32,
  @location(2) fade: f32,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let wp = (shaderSystem.world * instanceWorld) * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.along = input.uv.x;
  out.across = input.uv.y;
  out.fade = input.instanceColor.a;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) along: f32,
  @location(1) across: f32,
  @location(2) fade: f32,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let tip = pow(max(sin(input.along * 3.14159265), 0.0), 0.55);
  let edge = smoothstep(0.42, 0.9, input.across);
  let body = smoothstep(0.0, 0.08, input.across);
  let hot = edge * tip;
  let rgb = mix(vec3<f32>(1.0, 0.78, 0.32), vec3<f32>(1.0, 1.0, 0.94), hot);
  let alpha = tip * body * (0.62 + hot * 0.85) * input.fade;
  return vec4<f32>(rgb * (2.1 + hot * 1.8), alpha);
}`,
  });
}

function healMaterial() {
  return createShaderMaterial({
    name: 'priest-heal-infusion',
    attributes: ['position', 'uv'],
    uniforms: ['world', 'viewProjection'],
    useThinInstanceColors: true,
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    depthCompare: 'always',
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) across: f32,
  @location(1) up: f32,
  @location(2) life: f32,
  @location(3) fade: f32,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let wp = (shaderSystem.world * instanceWorld) * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.across = input.uv.x;
  out.up = input.uv.y;
  out.life = input.instanceColor.r;
  out.fade = input.instanceColor.a;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) across: f32,
  @location(1) up: f32,
  @location(2) life: f32,
  @location(3) fade: f32,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let x = input.across;
  let y = input.up;
  let life = input.life;
  let ny = y * 2.0 - 1.0;
  let ellipse = x * x * 1.25 + ny * ny * 1.15;
  let mask = smoothstep(1.02, 0.22, ellipse);
  let wash = exp(-x * x * 7.0) * smoothstep(0.0, 0.06, y) * smoothstep(1.0, 0.78, y);
  // Three thin threads, each with a bright bead climbing the body.
  let s0 = sin(y * 11.0 + life * 6.5) * 0.16;
  let s1 = sin(y * 9.0 + life * 7.2 + 2.1) * 0.16;
  let s2 = sin(y * 10.0 + life * 5.8 + 4.2) * 0.16;
  let c0 = fract(y * 0.65 - life * 1.25);
  let c1 = fract(y * 0.65 - life * 1.25 + 0.33);
  let c2 = fract(y * 0.65 - life * 1.25 + 0.66);
  let b0 = smoothstep(0.0, 0.05, c0) * (1.0 - smoothstep(0.05, 0.2, c0));
  let b1 = smoothstep(0.0, 0.05, c1) * (1.0 - smoothstep(0.05, 0.2, c1));
  let b2 = smoothstep(0.0, 0.05, c2) * (1.0 - smoothstep(0.05, 0.2, c2));
  let t0 = exp(-(x - (-0.28 + s0)) * (x - (-0.28 + s0)) * 140.0) * (0.25 + b0);
  let t1 = exp(-(x - s1) * (x - s1) * 140.0) * (0.25 + b1);
  let t2 = exp(-(x - (0.28 + s2)) * (x - (0.28 + s2)) * 140.0) * (0.25 + b2);
  let threads = t0 + t1 + t2;
  let waveY = life * 1.2 - 0.08;
  let wave = exp(-(y - waveY) * (y - waveY) * 55.0) * exp(-x * x * 10.0);
  let hot = clamp(threads * 0.55 + wave, 0.0, 1.0);
  let rgb = mix(vec3<f32>(1.0, 0.58, 0.12), vec3<f32>(1.0, 0.9, 0.5), hot);
  let alpha = (wash * 0.16 + threads * 0.34 + wave * 0.4) * mask * input.fade;
  return vec4<f32>(rgb, alpha);
}`,
  });
}

function setDrawCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
  mesh.visible = count > 0;
}

function makePool(engine, scene, name, geometry, material, cap, order) {
  const mesh = createMeshFromData(
    engine,
    name,
    geometry.positions,
    geometry.normals,
    geometry.indices,
    geometry.uvs,
  );
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.renderOrder = order;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  mesh.material = material;
  const matrices = new Float32Array(cap * 16);
  const colors = new Float32Array(cap * 4);
  const items = new Array(cap);
  setThinInstances(mesh, matrices, cap);
  setThinInstanceColors(mesh, colors);
  if (mesh.thinInstances) mesh.thinInstances._gpuCullingEnabled = false;
  addToScene(scene, mesh);
  setDrawCount(mesh, 0);
  return { mesh, matrices, colors, items, cap, count: 0 };
}

function spawn(pool, item) {
  let slot;
  if (pool.count >= pool.cap) {
    slot = 0;
    for (let i = 1; i < pool.count; i++) {
      if (pool.items[i].age > pool.items[slot].age) slot = i;
    }
  } else {
    slot = pool.count++;
  }
  pool.items[slot] = item;
}

function easeOut(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(init: object) => unknown} [emit]
 */
export function createPriestFx(engine, scene, emit) {
  const slashes = makePool(
    engine,
    scene,
    'priest-smite',
    holySlashGeometry(),
    slashMaterial(),
    SLASH_CAP,
    206,
  );
  const heals = makePool(
    engine,
    scene,
    'priest-heal',
    holyInfusionGeometry(),
    healMaterial(),
    HEAL_CAP,
    204,
  );

  function slash(x, y, z, vx, vz, zoom = 1) {
    const zom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const shot = { x, y, z, vx: vx || 0, vz: vz || 0, zoom: zom, ...rollSlashPose() };
    spawn(slashes, { ...shot, age: 0, life: SLASH_LIFE, lag: 0, gain: 1, scale: 1 });
    spawn(slashes, { ...shot, age: 0, life: SLASH_LIFE, lag: 0.14, gain: 0.4, scale: 1.06 });
  }

  function heal(x, ground, z, zoom = 1) {
    const zom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const body = {
      age: 0,
      life: HEAL_LIFE,
      x,
      y: ground,
      z,
      zoom: zom,
    };
    spawn(heals, { ...body, scale: 1, gain: 1 });
    emitMotes(x, ground, z, zom);
  }

  function emitMotes(x, ground, z, zoom) {
    if (!emit) return;
    for (let i = 0; i < 7; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 0.35 * zoom;
      emit({
        position: [
          x + Math.cos(ang) * rad,
          ground + 0.2 * zoom + Math.random() * 1.1 * zoom,
          z + Math.sin(ang) * rad,
        ],
        velocity: [
          (Math.random() - 0.5) * 0.35,
          (2.8 + Math.random() * 1.8) * Math.max(0.85, zoom),
          (Math.random() - 0.5) * 0.35,
        ],
        gravity: [0, 0.25, 0],
        color: [1, 0.74, 0.22, 0.75],
        lifetime: 0.5 + Math.random() * 0.25,
        startSize: (0.08 + Math.random() * 0.06) * zoom,
        endSize: 0.02 * zoom,
        drag: 0.7,
      });
    }
  }

  function paintSlash(index, it, eye) {
    const t = Math.min(1, it.age / it.life);
    const sweepT = Math.max(0, Math.min(1, (t - it.lag) / 0.5));
    const basis = viewBasis(eye, it.x, it.y, it.z);
    const aim = slashChordAngle(basis.rx, basis.rz, basis.ux, basis.uz, it.vx, it.vz);
    const sweep = (-0.22 + easeOut(sweepT) * 0.5) * (it.sweepDir || 1);
    const angle = it.spin + aim * 0.15 + sweep;
    const fadeIn = t < 0.08 ? t / 0.08 : 1;
    const fadeOut = t < 0.28 ? 1 : Math.max(0, 1 - (t - 0.28) / 0.72);
    const fade = (t < it.lag ? 0 : fadeIn * fadeOut * it.gain);
    const s = SLASH_WORLD * it.zoom * it.scale * (0.9 + 0.1 * Math.min(1, sweepT / 0.35));
    // Chord stays long; the belly scale is what flattens this particular arch.
    const bow = s * (it.flat || 0.5);
    const chord = s * 1.16;
    // Sit just in front of the body so the unit mesh doesn't swallow the cut.
    const bias = 0.9 * it.zoom;
    writePlane(
      slashes.matrices,
      index,
      it.x + basis.fx * bias,
      it.y + basis.fy * bias,
      it.z + basis.fz * bias,
      basis,
      angle,
      bow,
      chord,
    );
    const c = index * 4;
    slashes.colors[c] = 1;
    slashes.colors[c + 1] = 1;
    slashes.colors[c + 2] = 1;
    slashes.colors[c + 3] = fade;
  }

  function paintHeal(index, it, eye) {
    const t = Math.min(1, it.age / it.life);
    const env = (t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.62) / 0.38)) * it.gain;
    const basis = viewBasis(eye, it.x, it.y, it.z);
    const halfW = HEAL_HALF_WIDTH * it.zoom * it.scale;
    const height = HEAL_HEIGHT * it.zoom * it.scale;
    const bias = 1.15 * it.zoom;
    writePlane(
      heals.matrices,
      index,
      it.x + basis.fx * bias,
      it.y + basis.fy * bias,
      it.z + basis.fz * bias,
      basis,
      0,
      halfW,
      height,
    );
    const c = index * 4;
    heals.colors[c] = t;
    heals.colors[c + 1] = 1;
    heals.colors[c + 2] = 1;
    heals.colors[c + 3] = env;
  }

  return {
    slash,
    heal,
    update(deltaMs, eye) {
      const dt = Math.min(0.1, Math.max(0, deltaMs) / 1000);
      let slashCount = 0;
      for (let i = 0; i < slashes.count; i++) {
        const it = slashes.items[i];
        it.age += dt;
        if (it.age >= it.life) continue;
        slashes.items[slashCount] = it;
        paintSlash(slashCount, it, eye);
        slashCount++;
      }
      slashes.count = slashCount;
      let healCount = 0;
      for (let i = 0; i < heals.count; i++) {
        const it = heals.items[i];
        it.age += dt;
        if (it.age >= it.life) continue;
        heals.items[healCount] = it;
        paintHeal(healCount, it, eye);
        healCount++;
      }
      heals.count = healCount;
    },
    clear() {
      slashes.count = 0;
      heals.count = 0;
      setDrawCount(slashes.mesh, 0);
      setDrawCount(heals.mesh, 0);
    },
    commit() {
      setDrawCount(slashes.mesh, slashes.count);
      setDrawCount(heals.mesh, heals.count);
      setThinInstanceColors(slashes.mesh, slashes.colors);
      setThinInstanceColors(heals.mesh, heals.colors);
      flushThinInstances(slashes.mesh);
      flushThinInstances(heals.mesh);
    },
  };
}
