// Wind motion for tree tips, farm wheat and agora banners (Lite PBR material
// plugins, vertex stage). Billboard trees are Standard materials and stay still.
// Time is the render clock only - never sim ticks - so it cannot touch lockstep.
//
// Gust band: sin(dot(worldXZ, (0.014, 0.011)) - t * 0.5). Water in terrain.js
// uses the same band and clock - change both together.

import { markMaterialUboDirty } from '../vendor/lite/liteVendor.js';

/** Peak tree tip offset as a fraction of tree height at intensity 1 (idle breeze). */
const TREE_AMPLITUDE = 0.015;
/** Peak wheat tip offset as a fraction of stalk height. */
const WHEAT_AMPLITUDE = 0.035;
/** Peak banner bottom-edge offset as a fraction of cloth height. */
const BANNER_AMPLITUDE = 0.07;

/** @type {Set<object>} */
const windMaterials = new Set();
let windTime = 0;
let windIntensity = 1;

/** 1 = idle breeze. Raise for wind, storms, spells. Takes effect next frame. */
export function setWindIntensity(k) {
  windIntensity = Math.max(0, Number(k) || 0);
}
export const setTreeSwayIntensity = setWindIntensity;

const GUST = 'sin(dot(%B%,vec2<f32>(0.014,0.011))-material.swayT*0.5)';
const gust = (base) => GUST.replace('%B%', base);

/**
 * Trees: pin the base, move the tip, offset grows with (height / treeHeight)^2.
 * Runs at the end of the vertex stage so it lands after thin-instance world
 * composition regardless of fragment order. Phase comes from the instance
 * position so a forest does not move in lockstep. `swayH` is the whole tree height.
 */
const TREE_CODE = `
let swH=clamp(position.y/material.swayH,0.0,1.0);
let swB=finalWorld[3].xz;
let swG=0.5+0.5*${gust('swB')};
let swA=material.swayH*length(finalWorld[1].xyz)*${TREE_AMPLITUDE}*material.swayK*(0.6+1.2*swG*swG)*swH*swH;
let swP=material.swayT*1.7+swB.x*0.04+swB.y*0.03+sin(swB.x*0.9+swB.y*1.3)*0.25;
let swO=vec3<f32>(sin(swP),0.0,cos(swP*0.83+1.3))*swA;
out.clipPos=out.clipPos+scene.viewProjection*vec4<f32>(swO,0.0);
`;

/**
 * Wheat: base pinned, tips lean along the wind with a faster ripple that rolls
 * across the field (phase from model-space xz). `swayBase` / `swayH` are the
 * stalk part's min y and height.
 */
const WHEAT_CODE = `
let whH=clamp((position.y-material.swayBase)/material.swayH,0.0,1.0);
let whB=finalWorld[3].xz;
let whG=0.5+0.5*${gust('whB')};
let whA=material.swayH*length(finalWorld[1].xyz)*${WHEAT_AMPLITUDE}*material.swayK*(0.6+1.2*whG*whG)*whH*whH;
let whP=material.swayT*2.2+position.x*0.55+position.z*0.43+whB.x*0.04+whB.y*0.03;
let whO=vec3<f32>(0.786,0.0,0.618)*(sin(whP)*whA)+vec3<f32>(-0.618,0.0,0.786)*(sin(whP*0.7+1.0)*whA*0.35);
out.clipPos=out.clipPos+scene.viewProjection*vec4<f32>(whO,0.0);
`;

/**
 * Banner cloth: top edge pinned to the crossbar, flutter grows toward the free
 * bottom edge as a wave running down the cloth. Moves along the cloth's own
 * normal (model z) so it follows however the flag is turned. `swayBase` is the
 * top y, `swayH` the cloth height.
 */
const BANNER_CODE = `
let flT=clamp((material.swayBase-position.y)/material.swayH,0.0,1.0);
let flB=finalWorld[3].xz;
let flG=0.5+0.5*${gust('flB')};
let flA=material.swayH*${BANNER_AMPLITUDE}*material.swayK*(0.7+1.0*flG*flG)*flT*(0.4+0.6*flT);
let flP=material.swayT*2.6+flT*3.2+flB.x*0.05+flB.y*0.04;
let flO=finalWorld[2].xyz*(sin(flP)*flA)+finalWorld[0].xyz*(sin(flP*0.6+0.7)*flA*0.25);
out.clipPos=out.clipPos+scene.viewProjection*vec4<f32>(flO,0.0);
`;

/**
 * @param {string} name
 * @param {string} code
 * @param {Record<string, number>} params Extra static f32 uniforms the code reads.
 */
function createWindPlugin(name, code, params) {
  const paramNames = Object.keys(params);
  const fields = [
    { name: 'swayT', type: 'f32', visibility: 'vertex' },
    { name: 'swayK', type: 'f32', visibility: 'vertex' },
    ...paramNames.map((n) => ({ name: n, type: 'f32', visibility: 'vertex' })),
  ];
  return {
    name,
    getUniforms: () => ({ ubo: fields }),
    getCustomCode: (shaderType) =>
      shaderType === 'vertex' ? { CUSTOM_VERTEX_MAIN_END: code } : null,
    writeUbo(data, offsets) {
      data[offsets.get('swayT') / 4] = windTime;
      data[offsets.get('swayK') / 4] = windIntensity;
      for (const n of paramNames) data[offsets.get(n) / 4] = params[n];
    },
  };
}

function attach(meshes, plugin) {
  for (const mesh of meshes) {
    const mat = mesh.material;
    if (!mat || mat.plugins) continue;
    mat.plugins = [plugin];
    windMaterials.add(mat);
  }
}

/**
 * Tree model. Call before the first draw.
 * @param {object[]} meshes Parts of one tree model (need boundMax).
 */
export function attachTreeSway(meshes) {
  let height = 0;
  for (const mesh of meshes) height = Math.max(height, mesh.boundMax?.[1] ?? 0);
  if (!(height > 0)) return;
  attach(meshes, createWindPlugin('tree-sway', TREE_CODE, { swayH: height }));
}

/**
 * Farm model: only the tall part (the wheat) moves; the ground part stays put.
 * @param {object[]} meshes Parts of the farm model (need boundMin / boundMax).
 */
export function attachWheatSway(meshes) {
  const stalks = meshes.filter((m) => m.boundMin && m.boundMax && m.boundMax[1] - m.boundMin[1] > 2);
  if (!stalks.length) return;
  let base = Infinity;
  let top = -Infinity;
  for (const m of stalks) {
    base = Math.min(base, m.boundMin[1]);
    top = Math.max(top, m.boundMax[1]);
  }
  attach(stalks, createWindPlugin('wheat-sway', WHEAT_CODE, { swayBase: base, swayH: top - base }));
}

/**
 * Flag model: only the flat cloth quads flutter; pole and crossbar stay put.
 * @param {object[]} meshes Parts of the flag model (need boundMin / boundMax).
 */
export function attachBannerFlutter(meshes) {
  const cloth = meshes.filter((m) => m.boundMin && m.boundMax && m.boundMax[2] - m.boundMin[2] < 0.05);
  if (!cloth.length) return;
  let bottom = Infinity;
  let top = -Infinity;
  for (const m of cloth) {
    bottom = Math.min(bottom, m.boundMin[1]);
    top = Math.max(top, m.boundMax[1]);
  }
  if (!(top > bottom)) return;
  attach(cloth, createWindPlugin('banner-flutter', BANNER_CODE, { swayBase: top, swayH: top - bottom }));
}

/** Once per frame: advance the clock and re-upload the wind uniforms. */
export function tickWind() {
  if (!windMaterials.size) return;
  windTime = performance.now() / 1000;
  for (const mat of windMaterials) markMaterialUboDirty(mat);
}
