// Menu icon shade. Baked building/unit meshes are clockwise on the outside
// (world materials are double-sided, so the board still looks right). A
// culled StandardMaterial keeps the counterclockwise inside and throws the
// outside away - the farm ground's top is one of those discarded faces, so
// the wheat reads as sitting behind it.
//
// Standard materials also drop depth writes while alpha < 1, and these icons
// stay just under 1 so the edge fade can blend. Without a depth write the
// later mesh (the ground) paints over the nearer one. This shader keeps the
// blend, draws both sides, and lets the nearer surface win.

import { createShaderMaterial, setShaderUniform } from '../vendor/lite/liteVendor.js';
import { RADIAL_HUD_BLEND_ALPHA } from './radialPose.js';

const ICON_EMISSIVE = [0.82, 0.82, 0.82];

function previewColorFromMaterial(mat) {
  const color =
    mat?.baseColorFactor ??
    mat?._baseColorFactor ??
    mat?.diffuseColor;
  if (color?.length >= 3) {
    return [
      Math.max(0.12, Math.min(1, color[0])),
      Math.max(0.12, Math.min(1, color[1])),
      Math.max(0.12, Math.min(1, color[2])),
    ];
  }
  return [0.72, 0.75, 0.8];
}

/**
 * Lit icon material. Callers keep writing diffuseColor / emissiveColor / alpha;
 * {@link syncRadialIconShade} copies those into the shader.
 * The mesh must be thin-instanced - the vertex stage reads instance world.
 * @param {object | null | undefined} source
 */
export function createRadialIconMaterial(source) {
  const color = previewColorFromMaterial(source);
  const mat = createShaderMaterial({
    name: `${source?.name ?? 'icon'}-radial`,
    attributes: ['position', 'normal'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'iconDiffuse', type: 'vec3<f32>', defaultValue: color },
      { name: 'iconEmissive', type: 'vec3<f32>', defaultValue: [...ICON_EMISSIVE] },
      { name: 'iconAlpha', type: 'f32', defaultValue: RADIAL_HUD_BLEND_ALPHA },
    ],
    needAlphaBlending: true,
    backFaceCulling: false,
    depthWrite: true,
    depthCompare: 'greater-equal',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let world = shaderSystem.world * instanceWorld;
  let wp = world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.worldPos = wp.xyz;
  out.worldN = (world * vec4<f32>(input.normal, 0.0)).xyz;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = shaderUniforms.iconAlpha;
  if (alpha <= 0.001) { discard; }
  var n = normalize(input.worldN);
  let toEye = scene.vEyePosition.xyz - input.worldPos;
  if (dot(n, toEye) < 0.0) { n = -n; }
  let shade = 0.34 + 0.66 * max(dot(n, normalize(vec3<f32>(0.35, 0.82, 0.42))), 0.0);
  let rgb = min(shaderUniforms.iconDiffuse * shade + shaderUniforms.iconEmissive, vec3<f32>(1.0));
  return vec4<f32>(rgb, alpha);
}`,
  });
  mat._radialIcon = true;
  mat.diffuseColor = color;
  mat.emissiveColor = [...ICON_EMISSIVE];
  mat.specularColor = [0, 0, 0];
  mat.alpha = RADIAL_HUD_BLEND_ALPHA;
  mat._radialBaseAlpha = 1;
  return mat;
}

/** Push diffuse / emissive / alpha into the icon shader. No-op for ring materials. */
export function syncRadialIconShade(mat) {
  if (!mat?._radialIcon) return;
  const diffuse = mat.diffuseColor;
  const emissive = mat.emissiveColor;
  if (diffuse?.length >= 3) {
    setShaderUniform(mat, 'iconDiffuse', [diffuse[0], diffuse[1], diffuse[2]]);
  }
  if (emissive?.length >= 3) {
    setShaderUniform(mat, 'iconEmissive', [emissive[0], emissive[1], emissive[2]]);
  }
  setShaderUniform(mat, 'iconAlpha', mat.alpha ?? 1);
}
