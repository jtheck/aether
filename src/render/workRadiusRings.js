// Gather-reach rings — terrain-draped annulus with a priest-bubble rim fade.
// Additive so the band glows instead of milking the dirt; empty center so it
// never reads as a filled disc. Vertices sample ground height so the ribbon
// sits on the terrain instead of burying through it.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  invalidateRenderBundles,
  updateMeshPositions,
} from '../vendor/lite/liteVendor.js';

/** How far inward the film fades, in world units. */
const FADE_WU = 4.4;
/** Sit this far above the sampled ground at each rim vertex. */
const LIFT = 0.75;
const SEGMENTS = 64;
const MAX_RINGS = 64;
const VERTS_PER_RING = SEGMENTS * 2;
const IDX_PER_RING = SEGMENTS * 6;
const MAX_VERTS = MAX_RINGS * VERTS_PER_RING;
const MAX_IDX = MAX_RINGS * IDX_PER_RING;

function createRingMaterial() {
  return createShaderMaterial({
    name: 'work-radius-ring',
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['world', 'viewProjection', 'cameraPosition'],
    needAlphaBlending: true,
    blendMode: 'additive',
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
  // uv.y = 1 at the outer rim, 0 at the inner fade. Same film curve as the
  // holy-shield bubble, mapped to radial distance instead of view angle.
  let t = 1.0 - input.uv.y;
  let rim = pow(1.0 - t, 1.55);
  let edge = pow(1.0 - t, 4.8);
  let alpha = clamp(rim * 0.55 + edge * 0.85, 0.0, 1.0);
  if (alpha < 0.02) { discard; }
  let film = mix(vec3<f32>(0.42, 0.84, 1.0), vec3<f32>(1.0, 0.93, 0.52), edge);
  let rgb = film * (rim * 1.35 + edge * 2.4);
  return vec4<f32>(rgb, alpha);
}`,
  });
}

function allocMesh(engine) {
  const positions = new Float32Array(MAX_VERTS * 3);
  const normals = new Float32Array(MAX_VERTS * 3);
  const uvs = new Float32Array(MAX_VERTS * 2);
  const indices = new Uint32Array(MAX_IDX);

  for (let i = 0; i < MAX_VERTS; i++) normals[i * 3 + 1] = 1;

  for (let ring = 0; ring < MAX_RINGS; ring++) {
    const vb = ring * VERTS_PER_RING;
    for (let i = 0; i < SEGMENTS; i++) {
      const o = (vb + i * 2) * 2;
      // Outer / inner — uv.y drives the film fade.
      uvs[o] = i / SEGMENTS;
      uvs[o + 1] = 1;
      uvs[o + 2] = i / SEGMENTS;
      uvs[o + 3] = 0;
    }
    const ib = ring * IDX_PER_RING;
    for (let i = 0; i < SEGMENTS; i++) {
      const o0 = vb + i * 2;
      const o1 = vb + ((i + 1) % SEGMENTS) * 2;
      const n0 = o0 + 1;
      const n1 = o1 + 1;
      const t = ib + i * 6;
      indices[t] = o0;
      indices[t + 1] = o1;
      indices[t + 2] = n1;
      indices[t + 3] = o0;
      indices[t + 4] = n1;
      indices[t + 5] = n0;
    }
  }

  const mesh = createMeshFromData(engine, 'work-radius-ring', positions, normals, indices, uvs);
  mesh.pickable = false;
  mesh.receiveShadows = false;
  mesh.renderOrder = 175;
  mesh.boundMin = [-1e5, -1e5, -1e5];
  mesh.boundMax = [1e5, 1e5, 1e5];
  return { mesh, positions };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createWorkRadiusRings(engine, scene, groundYAt) {
  const { mesh, positions } = allocMesh(engine);
  mesh.material = createRingMaterial();
  addToScene(scene, mesh);
  mesh.visible = false;
  if (mesh._gpu) mesh._gpu.indexCount = 0;

  function setIndexCount(n) {
    const idx = n * IDX_PER_RING;
    if (mesh._gpu && mesh._gpu.indexCount !== idx) {
      mesh._gpu.indexCount = idx;
      invalidateRenderBundles(engine);
    }
    mesh.visible = n > 0;
  }

  function writeRing(slot, spec) {
    const radius = spec.radius;
    const innerR = Math.max(radius - FADE_WU, radius * 0.55);
    const vb = slot * VERTS_PER_RING;
    const cx = spec.x;
    const cz = spec.z;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ox = cx + c * radius;
      const oz = cz + s * radius;
      const ix = cx + c * innerR;
      const iz = cz + s * innerR;
      const oy = (groundYAt(ox, oz) || 0) + LIFT;
      const iy = (groundYAt(ix, iz) || 0) + LIFT;
      const o = (vb + i * 2) * 3;
      positions[o] = ox;
      positions[o + 1] = oy;
      positions[o + 2] = oz;
      positions[o + 3] = ix;
      positions[o + 4] = iy;
      positions[o + 5] = iz;
    }
  }

  function clear() {
    setIndexCount(0);
  }

  return {
    /**
     * @param {{ x: number, z: number, radius: number }[] | null | undefined} rings
     */
    sync(rings) {
      const list = rings ?? [];
      const n = Math.min(list.length, MAX_RINGS);
      if (n === 0) {
        clear();
        return;
      }
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        const spec = list[i];
        if (!(spec?.radius > 0)) continue;
        writeRing(drawn, spec);
        drawn++;
      }
      if (drawn === 0) {
        clear();
        return;
      }
      updateMeshPositions(engine, mesh, positions, 0, drawn * VERTS_PER_RING);
      setIndexCount(drawn);
    },

    commit() {},

    clear,
  };
}
