// Field reticle for gamepad play — a plus + ring sitting on the terrain.
// View-center follow lives in the renderer; this only paints a world point.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const LIFT = 0.55;
const REF_RADIUS = 80;
const BASE_SIZE = 3.6;
const SIZE_MIN = 0.45;
const SIZE_MAX = 2.2;

/**
 * World width so the mark stays readable as the orbit radius changes.
 * @param {number} radius
 * @param {number} [refRadius]
 * @param {number} [base]
 */
export function gamepadCursorScale(radius, refRadius = REF_RADIUS, base = BASE_SIZE) {
  const r = Number.isFinite(radius) ? radius : refRadius;
  const k = Math.max(SIZE_MIN, Math.min(SIZE_MAX, r / refRadius));
  return base * k;
}

/**
 * Grow the plus so its ring matches a world-space brush radius.
 * Quad is 1×1 local XZ; the painted ring sits near |p| = 0.90.
 * @param {number} baseScale
 * @param {number} [brushWorld]
 * @param {number} [ringNdc]
 */
export function gamepadCursorBrushScale(baseScale, brushWorld, ringNdc = 0.90) {
  const base = Number.isFinite(baseScale) && baseScale > 0 ? baseScale : BASE_SIZE;
  if (!(brushWorld > 0)) return base;
  const ringFrac = 0.5 * (Number.isFinite(ringNdc) && ringNdc > 0.1 ? ringNdc : 0.90);
  return Math.max(base, brushWorld / ringFrac);
}

/**
 * Sit the mark just above the sampled ground.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} [lift]
 */
export function gamepadCursorWorldPos(x, y, z, lift = LIFT) {
  return { x, y: y + lift, z };
}

function makeMesh(engine) {
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(engine, 'gamepad-cursor', positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = 180;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  return mesh;
}

function makeMaterial() {
  return createShaderMaterial({
    name: 'gamepad-cursor',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'tint', type: 'vec3<f32>', defaultValue: [0.92, 0.95, 0.98] },
    ],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.uv = input.uv;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let p = input.uv * 2.0 - 1.0;
  let d = length(p);
  let ring = smoothstep(0.74, 0.82, d) * (1.0 - smoothstep(0.90, 0.98, d));
  let vx = 1.0 - smoothstep(0.055, 0.12, abs(p.x));
  let vy = 1.0 - smoothstep(0.62, 0.78, abs(p.y));
  let hx = 1.0 - smoothstep(0.62, 0.78, abs(p.x));
  let hy = 1.0 - smoothstep(0.055, 0.12, abs(p.y));
  let plus = max(vx * vy, hx * hy);
  let nub = 1.0 - smoothstep(0.10, 0.20, d);
  var alpha = max(ring * 0.92, plus * 0.88);
  alpha = max(alpha, nub * 0.5);
  if (alpha < 0.03) { discard; }
  let wash = shaderUniforms.tint;
  return vec4<f32>(wash * alpha, alpha);
}`,
  });
}

/**
 * @param {object} engine
 * @param {object} scene
 */
export function createGamepadCursor(engine, scene) {
  const mesh = makeMesh(engine);
  mesh.material = makeMaterial();
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);

  /** @type {{ x: number, y: number, z: number } | null} */
  let target = null;
  let visible = false;

  function hide() {
    if (visible) {
      setSubtreeVisible(mesh, false);
      if (mesh.position) mesh.position.y = -9999;
      mesh.markLocalDirty?.();
      visible = false;
    }
  }

  /**
   * @param {{ x: number, y?: number, z: number } | null | undefined} pos
   */
  function set(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
      target = null;
      hide();
      return;
    }
    target = {
      x: pos.x,
      y: Number.isFinite(pos.y) ? pos.y : 0,
      z: pos.z,
    };
  }

  /**
   * @param {object} [camera]
   * @param {{ brushWorld?: number }} [opts]
   */
  function update(camera, opts) {
    if (!target) {
      hide();
      return;
    }
    const world = gamepadCursorWorldPos(target.x, target.y, target.z);
    const s = gamepadCursorBrushScale(gamepadCursorScale(camera?.radius), opts?.brushWorld);
    if (mesh.position) {
      mesh.position.x = world.x;
      mesh.position.y = world.y;
      mesh.position.z = world.z;
    }
    if (mesh.scaling) {
      mesh.scaling.x = s;
      mesh.scaling.y = 1;
      mesh.scaling.z = s;
    }
    if (!visible) {
      setSubtreeVisible(mesh, true);
      visible = true;
    }
    mesh.markLocalDirty?.();
  }

  return {
    set,
    update,
    clear() {
      set(null);
    },
    get() {
      return target;
    },
  };
}
