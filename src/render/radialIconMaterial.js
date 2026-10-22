// Menu icon shade. Baked building/unit meshes are clockwise on the outside
// (world materials are double-sided, so the board still looks right). A
// culled StandardMaterial keeps the counterclockwise inside and throws the
// outside away - the farm ground's top is one of those discarded faces, so
// the wheat reads as sitting behind it. These shaders draw both sides.
//
// The whole radial menu sorts at one point just in front of the camera
// (menuOverlayAnchor). originFix is the visual position minus that point,
// added after the world matrix so the art stays on the disc and health
// chips, work-radius rings, and fog cannot paint over it. Depth test is
// always: the building in front of a far pad must not clip the menu.

import { createShaderMaterial, setShaderUniform } from '../vendor/lite/liteVendor.js';
import { RADIAL_HUD_BLEND_ALPHA } from './radialPose.js';

const ICON_EMISSIVE = [0.82, 0.82, 0.82];

function originFixUniform() {
  return { name: 'originFix', type: 'vec3<f32>', defaultValue: [0, 0, 0] };
}

function markMenuOverlay(mat) {
  mat._menuOverlay = true;
  mat._originFix = [0, 0, 0];
  return mat;
}

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
      originFixUniform(),
    ],
    needAlphaBlending: true,
    backFaceCulling: false,
    depthWrite: false,
    depthCompare: 'always',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let world = shaderSystem.world * instanceWorld;
  let wp0 = world * vec4<f32>(input.position, 1.0);
  let wp = vec4<f32>(wp0.xyz + shaderUniforms.originFix, 1.0);
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
  return markMenuOverlay(mat);
}

/**
 * Portrait card. Same diffuse / emissive / alpha writes as the mesh icons.
 * At rest the gate wash (emissive) tints the picture. Hover drops that wash
 * to a near-black and the picture shows at diffuse brightness instead.
 * @returns {object}
 */
export function createRadialSpriteMaterial() {
  const mat = createShaderMaterial({
    name: 'radial-sprite',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'iconDiffuse', type: 'vec3<f32>', defaultValue: [1, 1, 1] },
      { name: 'iconEmissive', type: 'vec3<f32>', defaultValue: [...ICON_EMISSIVE] },
      { name: 'iconAlpha', type: 'f32', defaultValue: RADIAL_HUD_BLEND_ALPHA },
      originFixUniform(),
    ],
    samplers: ['sprite'],
    needAlphaBlending: true,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    backFaceCulling: false,
    depthWrite: false,
    depthCompare: 'always',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  let world = shaderSystem.world * instanceWorld;
  let wp0 = world * vec4<f32>(input.position, 1.0);
  let wp = vec4<f32>(wp0.xyz + shaderUniforms.originFix, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.uv = input.uv;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let c = textureSample(sprite, spriteSampler, input.uv);
  let alpha = shaderUniforms.iconAlpha * c.a;
  if (alpha <= 0.001) { discard; }
  let wash = shaderUniforms.iconEmissive;
  let hot = max(wash.r, max(wash.g, wash.b));
  let tint = select(wash, shaderUniforms.iconDiffuse, hot < 0.2);
  return vec4<f32>(c.rgb * tint, alpha);
}`,
  });
  mat._radialIcon = true;
  mat.diffuseColor = [1, 1, 1];
  mat.emissiveColor = [...ICON_EMISSIVE];
  mat.specularColor = [0, 0, 0];
  mat.alpha = RADIAL_HUD_BLEND_ALPHA;
  mat._radialBaseAlpha = 1;
  return markMenuOverlay(mat);
}

/**
 * Unlit pad / ring / slash. Standard materials with disableLighting output
 * emissive * diffuse. Same origin fix as the icons.
 * @param {number[]} diffuse
 * @param {number[]} emissive
 * @param {number} alpha
 */
export function createMenuPlateMaterial(diffuse, emissive, alpha) {
  const diff = [diffuse[0], diffuse[1], diffuse[2]];
  const em = [emissive[0], emissive[1], emissive[2]];
  const mat = createShaderMaterial({
    name: 'radial-plate',
    attributes: ['position', 'normal'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'plateDiffuse', type: 'vec3<f32>', defaultValue: diff },
      { name: 'plateEmissive', type: 'vec3<f32>', defaultValue: em },
      { name: 'plateAlpha', type: 'f32', defaultValue: alpha },
      originFixUniform(),
    ],
    needAlphaBlending: true,
    backFaceCulling: true,
    depthWrite: false,
    depthCompare: 'always',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp0 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  let wp = vec4<f32>(wp0.xyz + shaderUniforms.originFix, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let alpha = shaderUniforms.plateAlpha;
  if (alpha <= 0.001) { discard; }
  let rgb = clamp(
    shaderUniforms.plateEmissive * shaderUniforms.plateDiffuse,
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
  return vec4<f32>(rgb, alpha);
}`,
  });
  mat._menuPlate = true;
  mat.diffuseColor = diff;
  mat.emissiveColor = em;
  mat.specularColor = [0, 0, 0];
  mat.alpha = alpha;
  return markMenuOverlay(mat);
}

function pushPlateShade(mat) {
  const diffuse = mat.diffuseColor;
  const emissive = mat.emissiveColor;
  if (diffuse?.length >= 3) {
    setShaderUniform(mat, 'plateDiffuse', [diffuse[0], diffuse[1], diffuse[2]]);
  }
  if (emissive?.length >= 3) {
    setShaderUniform(mat, 'plateEmissive', [emissive[0], emissive[1], emissive[2]]);
  }
  setShaderUniform(mat, 'plateAlpha', mat.alpha ?? 1);
}

/** Push diffuse / emissive / alpha into the icon or plate shader. */
export function syncRadialIconShade(mat) {
  if (mat?._menuPlate) {
    pushPlateShade(mat);
    return;
  }
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

/** World-space shift from the shared sort point back to the visual origin. */
export function setMenuOriginFix(mat, x, y, z) {
  if (!mat?._menuOverlay) return;
  const prev = mat._originFix;
  if (prev && prev[0] === x && prev[1] === y && prev[2] === z) return;
  const next = [x, y, z];
  mat._originFix = next;
  setShaderUniform(mat, 'originFix', next);
}

/**
 * Park `mesh` on the shared menu anchor. `x, y, z` stay the visual origin;
 * the material puts the triangles back there.
 * @param {object} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {{ x: number, y: number, z: number, ok?: boolean } | null | undefined} anchor
 */
export function applyMenuOverlay(mesh, x, y, z, anchor) {
  const ok = !!anchor?.ok;
  if (mesh?.position) {
    mesh.position.x = ok ? anchor.x : x;
    mesh.position.y = ok ? anchor.y : y;
    mesh.position.z = ok ? anchor.z : z;
  }
  setMenuOriginFix(
    mesh?.material,
    ok ? x - anchor.x : 0,
    ok ? y - anchor.y : 0,
    ok ? z - anchor.z : 0,
  );
}
