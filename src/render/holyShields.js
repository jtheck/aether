// Holy-armor absorb bubble — rim fresnel, clear center.
// Cheap soap-film look: view-angle alpha * a slight hue walk, additive so it
// glows instead of milking the unit.

import { createShaderMaterial } from '../vendor/lite/liteVendor.js';

export function createHolyShieldMaterial() {
  return createShaderMaterial({
    name: 'holy-shield-bubble',
    attributes: ['position', 'normal'],
    uniforms: ['world', 'viewProjection', 'cameraPosition'],
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let finalWorld = shaderSystem.world * instanceWorld;
  let wp = finalWorld * vec4<f32>(input.position, 1.0);
  out.worldPos = wp.xyz;
  out.position = shaderSystem.viewProjection * wp;
  out.worldN = normalize((finalWorld * vec4<f32>(input.normal, 0.0)).xyz);
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.worldN);
  let V = normalize(shaderSystem.cameraPosition - input.worldPos);
  let ndv = abs(dot(N, V));
  // Cheap multiply: rgb * fresnel. Facing pixels drop out; silhouette holds the film.
  let rim = pow(1.0 - ndv, 3.2);
  let edge = pow(1.0 - ndv, 7.5);
  let alpha = clamp(rim * 0.65 + edge, 0.0, 1.0);
  let film = mix(vec3<f32>(0.42, 0.84, 1.0), vec3<f32>(1.0, 0.93, 0.52), edge);
  let rgb = film * (rim * 1.35 + edge * 2.4);
  return vec4<f32>(rgb, alpha);
}`,
  });
}

/** Fireball core — same rim fresnel + hue walk as the holy bubble, in ember colors. */
export function createFireballCoreMaterial() {
  return createShaderMaterial({
    name: 'fireball-core-orb',
    attributes: ['position', 'normal'],
    uniforms: ['world', 'viewProjection', 'cameraPosition'],
    needAlphaBlending: true,
    blendMode: 'additive',
    depthWrite: false,
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let finalWorld = shaderSystem.world * instanceWorld;
  let wp = finalWorld * vec4<f32>(input.position, 1.0);
  out.worldPos = wp.xyz;
  out.position = shaderSystem.viewProjection * wp;
  out.worldN = normalize((finalWorld * vec4<f32>(input.normal, 0.0)).xyz);
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldN: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let N = normalize(input.worldN);
  let V = normalize(shaderSystem.cameraPosition - input.worldPos);
  let ndv = abs(dot(N, V));
  let rim = pow(1.0 - ndv, 3.2);
  let edge = pow(1.0 - ndv, 7.5);
  // Keep a readable ember body — the priest bubble drops facing pixels out,
  // which vanishes at fireball scale. Hue still walks to gold on the lip.
  let face = 0.62;
  let alpha = clamp(face * 0.9 + rim * 0.45 + edge, 0.0, 1.0);
  let film = mix(vec3<f32>(1.0, 0.36, 0.05), vec3<f32>(1.0, 0.95, 0.46), edge);
  let rgb = film * (face * 1.2 + rim * 1.15 + edge * 2.5);
  return vec4<f32>(rgb, alpha);
}`,
  });
}
