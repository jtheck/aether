// Holy-armor absorb mark. Side arcs of a ring in local XY (camera right is +X).
// The instance matrix turns it toward the camera. Top and bottom are not drawn.

import { createMeshFromData, createShaderMaterial } from '../vendor/lite/liteVendor.js';

/** Outer radius 1 so instance scale matches the old sphere (scale = world radius). */
export const HOLY_SHIELD_RING_OUTER = 1;
/** Inner edge of the falloff. The bright lip is only the outer rim; the rest fades out. */
export const HOLY_SHIELD_RING_INNER = 0.92;
/** Quads along one flank. The old 24 was a full circle, so each side only got ~6. */
export const HOLY_SHIELD_SIDE_SEGMENTS = 24;
/** Fireball orb matches the old diameter-1 sphere (outer radius 0.5) but keeps a body. */
export const FIREBALL_ORB_OUTER = 0.5;
/** Radius where the red core hands off to the bright rim. The band is only the outer edge. */
export const FIREBALL_ORB_INNER = 0.45;
/** Quads around the full disc. One fireball, so this can stay smooth. */
export const FIREBALL_ORB_SEGMENTS = 48;

/**
 * Left and right arcs of an annulus in XY. Local +X is camera-right, so each
 * flank is a 90° curve of its own. Top and bottom are not in the mesh.
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 */
export function holyShieldRingGeometry(
  segments = HOLY_SHIELD_SIDE_SEGMENTS,
  inner = HOLY_SHIELD_RING_INNER,
  outer = HOLY_SHIELD_RING_OUTER,
) {
  const n = Math.max(4, segments | 0);
  const rings = n + 1;
  const positions = new Float32Array(2 * rings * 2 * 3);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(2 * n * 6);
  // Right flank around +X, left flank around -X. Endpoints sit on the diagonals.
  const arcs = [
    [-Math.PI / 4, Math.PI / 4],
    [(3 * Math.PI) / 4, (5 * Math.PI) / 4],
  ];
  for (let arc = 0; arc < arcs.length; arc++) {
    const a0 = arcs[arc][0];
    const a1 = arcs[arc][1];
    const vertBase = arc * rings;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = (vertBase + i) * 2 * 3;
      positions[o] = c * inner;
      positions[o + 1] = s * inner;
      positions[o + 3] = c * outer;
      positions[o + 4] = s * outer;
      normals[o + 2] = 1;
      normals[o + 5] = 1;
    }
    const indexBase = arc * n * 6;
    for (let i = 0; i < n; i++) {
      const i0 = (vertBase + i) * 2;
      const i1 = i0 + 1;
      const j0 = i0 + 2;
      const j1 = j0 + 1;
      const t = indexBase + i * 6;
      indices[t] = i0;
      indices[t + 1] = i1;
      indices[t + 2] = j1;
      indices[t + 3] = i0;
      indices[t + 4] = j1;
      indices[t + 5] = j0;
    }
  }
  return { positions, normals, indices };
}

export function createHolyShieldMesh(engine) {
  const ring = holyShieldRingGeometry();
  return createMeshFromData(engine, 'holy-shield-ring', ring.positions, ring.normals, ring.indices);
}

/** Filled disc in local XY. The instance matrix turns it toward the camera. */
export function fireballDiscGeometry(
  segments = FIREBALL_ORB_SEGMENTS,
  radius = FIREBALL_ORB_OUTER,
) {
  const n = Math.max(8, segments | 0);
  const positions = new Float32Array((n + 1) * 3);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(n * 3);
  normals[2] = 1;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const o = (i + 1) * 3;
    positions[o] = Math.cos(a) * radius;
    positions[o + 1] = Math.sin(a) * radius;
    normals[o + 2] = 1;
    const next = i + 1 === n ? 1 : i + 2;
    const t = i * 3;
    indices[t] = 0;
    indices[t + 1] = i + 1;
    indices[t + 2] = next;
  }
  return { positions, normals, indices };
}

export function createFireballMesh(engine) {
  const disc = fireballDiscGeometry();
  return createMeshFromData(engine, 'fireball-core', disc.positions, disc.normals, disc.indices);
}

export function createHolyShieldMaterial() {
  return createShaderMaterial({
    name: 'holy-shield-bubble',
    attributes: ['position'],
    uniforms: ['world', 'viewProjection'],
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    // Both sides. A one-sided ring disappears if the facing basis is flipped.
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) radial: f32,
  @location(1) flank: f32,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let finalWorld = shaderSystem.world * instanceWorld;
  let wp = finalWorld * vec4<f32>(input.position, 1.0);
  let local = input.position.xy;
  let r = max(length(local), 0.001);
  out.radial = r;
  out.flank = abs(local.x) / r;
  out.position = shaderSystem.viewProjection * wp;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) radial: f32,
  @location(1) flank: f32,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let edge = clamp((input.radial - ${HOLY_SHIELD_RING_INNER.toFixed(2)}) / ${(HOLY_SHIELD_RING_OUTER - HOLY_SHIELD_RING_INNER).toFixed(2)}, 0.0, 1.0);
  let film = mix(vec3<f32>(0.42, 0.84, 1.0), vec3<f32>(1.0, 0.93, 0.52), edge);
  let lip = edge * edge * edge;
  // 1 on the left/right, 0 toward the top and bottom, so the arc ends dissolve.
  let flank = smoothstep(0.72, 0.96, input.flank);
  let rgb = film * (1.1 + lip * 1.8);
  let alpha = lip * 0.85 * flank;
  return vec4<f32>(rgb, alpha);
}`,
  });
}

/** Fireball core — filled camera-facing disc, hot center, bright ember rim. */
export function createFireballCoreMaterial() {
  const span = (FIREBALL_ORB_OUTER - FIREBALL_ORB_INNER).toFixed(2);
  return createShaderMaterial({
    name: 'fireball-core-orb',
    attributes: ['position'],
    uniforms: ['world', 'viewProjection'],
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) radial: f32,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let finalWorld = shaderSystem.world * instanceWorld;
  let wp = finalWorld * vec4<f32>(input.position, 1.0);
  out.radial = length(input.position.xy);
  out.position = shaderSystem.viewProjection * wp;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) radial: f32,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let edge = clamp((input.radial - ${FIREBALL_ORB_INNER.toFixed(2)}) / ${span}, 0.0, 1.0);
  let lip = edge * edge;
  let film = mix(vec3<f32>(1.0, 0.08, 0.02), vec3<f32>(1.0, 0.95, 0.46), lip);
  let rgb = film * (1.05 + lip * 1.7);
  let alpha = 0.62 + lip * 0.22;
  return vec4<f32>(rgb, alpha);
}`,
  });
}
