// Headset fade that matches the desktop splash veil. HTML never reaches the
// visor, so chapter loads would otherwise whip the rig while the table swaps.
// Narrator copy rides the black so the hold at 00:00 is still readable.

import { xrEye, xrEyeFrustum, xrHudEye } from './xrEye.js';
import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  setShaderTexture,
  setShaderUniform,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

/** Closer than chrome HUD so the veil covers the visor. */
export const XR_FADE_DEPTH = 0.28;
/** Extra tangent so stereo edges stay covered. */
export const XR_FADE_COVER = 1.45;
const FADE_ORDER = 520;
const CARD_W = 1024;
const CARD_H = 512;
/** Ground narrator stays down until the veil is almost gone. */
export const XR_FADE_SPEECH_CUT = 0.08;

let liveFade = 0;
let liveLines = /** @type {object[]} */ ([]);

export function xrFadeOpacity() {
  return liveFade;
}

export function xrFadeLines() {
  return liveLines;
}

export function xrFadeMix(from, to, elapsed, duration) {
  if (!(duration > 0)) return to;
  const u = Math.max(0, Math.min(1, elapsed / duration));
  const ease = 1 - (1 - u) * (1 - u);
  return from + (to - from) * ease;
}

function quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz) {
  const trace = xx + yy + zz;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (yz - zy) / s;
    y = (zx - xz) / s;
    z = (xy - yx) / s;
  } else if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    w = (yz - zy) / s;
    x = 0.25 * s;
    y = (xy + yx) / s;
    z = (zx + xz) / s;
  } else if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    w = (zx - xz) / s;
    x = (xy + yx) / s;
    y = 0.25 * s;
    z = (yz + zy) / s;
  } else {
    const s = Math.sqrt(1 + zz - xx - yy) * 2;
    w = (xy - yx) / s;
    x = (zx + xz) / s;
    y = (yz + zy) / s;
    z = 0.25 * s;
  }
  return { x, y, z, w };
}

function setQuat(mesh, q) {
  const rq = mesh.rotationQuaternion;
  if (!rq) return;
  if (typeof rq.set === 'function') rq.set(q.x, q.y, q.z, q.w);
  else {
    rq.x = q.x;
    rq.y = q.y;
    rq.z = q.z;
    rq.w = q.w;
  }
}

function makeQuad() {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}

/**
 * Visor-locked plate that covers the eye frustum.
 * Column 2 of the eye matrix is look-forward (same as stick-forward).
 * Mesh +Z faces the camera.
 * @param {Float32Array | number[]} wm
 * @param {{ h?: number, v?: number }} [frustum]
 * @param {number} [depth]
 */
export function xrFadePlane(wm, frustum, depth = XR_FADE_DEPTH) {
  const d = depth > 0.05 ? depth : XR_FADE_DEPTH;
  const fx = wm?.[8] || 0;
  const fy = wm?.[9] || 0;
  const fz = wm?.[10] || 1;
  const ux = wm?.[4] || 0;
  const uy = wm?.[5] || 1;
  const uz = wm?.[6] || 0;
  const hTan = Math.max(0.4, frustum?.h || 1) * XR_FADE_COVER;
  const vTan = Math.max(0.4, frustum?.v || 1) * XR_FADE_COVER;
  return {
    x: (wm?.[12] || 0) + fx * d,
    y: (wm?.[13] || 0) + fy * d,
    z: (wm?.[14] || 0) + fz * d,
    width: 2 * d * hTan,
    height: 2 * d * vTan,
    yAxis: [ux, uy, uz],
    zAxis: [-fx, -fy, -fz],
  };
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export function paintFadeNarrator(ctx, w, h, lines) {
  ctx.clearRect(0, 0, w, h);
  const list = Array.isArray(lines) ? lines.filter((line) => String(line?.text || '').trim()) : [];
  if (!list.length) return;
  const maxW = w * 0.78;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const blocks = [];
  for (let i = 0; i < list.length; i++) {
    const faded = i < list.length - 1;
    ctx.font = faded ? '36px sans-serif' : '48px sans-serif';
    blocks.push({
      rows: wrapText(ctx, list[i].text, maxW),
      faded,
      speaker: String(list[i].speaker || '').trim(),
    });
  }
  const lineH = 56;
  let count = 0;
  for (const block of blocks) count += block.rows.length + (block.speaker ? 1 : 0);
  let y = h * 0.5 - ((count - 1) * lineH) * 0.5;
  for (const block of blocks) {
    ctx.globalAlpha = block.faded ? 0.55 : 1;
    if (block.speaker) {
      ctx.font = 'bold 32px sans-serif';
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(block.speaker, w * 0.5, y);
      y += lineH;
    }
    ctx.font = block.faded ? '36px sans-serif' : '48px sans-serif';
    ctx.fillStyle = block.faded ? '#bbbbbb' : '#eeeeee';
    for (const row of block.rows) {
      ctx.fillText(row, w * 0.5, y);
      y += lineH;
    }
    y += 10;
  }
  ctx.globalAlpha = 1;
}

function placeMesh(mesh, pose, worldW, worldH) {
  let yx = pose.yAxis[0];
  let yy = pose.yAxis[1];
  let yz = pose.yAxis[2];
  const yl = Math.hypot(yx, yy, yz) || 1;
  yx /= yl;
  yy /= yl;
  yz /= yl;
  let zx = pose.zAxis[0];
  let zy = pose.zAxis[1];
  let zz = pose.zAxis[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = yy * zz - yz * zy;
  let xy = yz * zx - yx * zz;
  let xz = yx * zy - yy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  if (mesh.position) {
    mesh.position.x = pose.x;
    mesh.position.y = pose.y;
    mesh.position.z = pose.z;
  }
  if (mesh.scaling) {
    mesh.scaling.x = worldW;
    mesh.scaling.y = worldH;
    mesh.scaling.z = 1;
  }
  const q = quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz);
  if (![q.x, q.y, q.z, q.w, pose.x, pose.y, pose.z].every(Number.isFinite)) return;
  setQuat(mesh, q);
  setSubtreeVisible(mesh, true);
  mesh.markLocalDirty?.();
}

function makePlate(engine, scene, name, textured) {
  const { positions, normals, uvs, indices } = makeQuad();
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = FADE_ORDER;
  mesh.boundMin = [-40, -40, -40];
  mesh.boundMax = [40, 40, 40];
  if (!mesh.rotationQuaternion) mesh.rotationQuaternion = { x: 0, y: 0, z: 0, w: 1 };
  const uniforms = [
    'world',
    'viewProjection',
    { name: 'fade', type: 'f32', defaultValue: 1 },
  ];
  const mat = createShaderMaterial({
    name,
    attributes: ['position', 'normal', 'uv'],
    uniforms,
    samplers: textured ? ['glyph'] : [],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    depthCompare: 'always',
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
    fragmentSource: textured
      ? `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let c = textureSample(glyph, glyphSampler, input.uv);
  return vec4<f32>(c.rgb, c.a * shaderUniforms.fade);
}`
      : `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, shaderUniforms.fade);
}`,
  });
  mesh.material = mat;
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);
  return { mesh, mat };
}

/**
 * @param {object} engine
 * @param {object} scene
 */
export function createXrFade(engine, scene) {
  if (typeof document === 'undefined') {
    return {
      set() {},
      setLines() {},
      opacity: () => 0,
      update() {},
      clear() {},
    };
  }
  const plate = makePlate(engine, scene, 'xr-fade', false);
  const card = makePlate(engine, scene, 'xr-fade-card', true);
  card.mesh.renderOrder = FADE_ORDER + 1;
  const blank = new Uint8Array(CARD_W * CARD_H * 4);
  const tex = createTexture2DFromPixels(engine, blank, CARD_W, CARD_H, {
    srgb: true,
    minFilter: 'linear',
    magFilter: 'linear',
  });
  setShaderTexture(card.mat, 'glyph', tex);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let paintedKey = '';
  let current = 0;
  let from = 0;
  let target = 0;
  let started = 0;
  let duration = 0;
  let visible = false;

  function hide() {
    liveFade = current;
    if (!visible) return;
    setSubtreeVisible(plate.mesh, false);
    setSubtreeVisible(card.mesh, false);
    if (plate.mesh.position) plate.mesh.position.y = -9999;
    if (card.mesh.position) card.mesh.position.y = -9999;
    plate.mesh.markLocalDirty?.();
    card.mesh.markLocalDirty?.();
    visible = false;
  }

  function paint(lines) {
    if (!ctx) return;
    const key = (lines || []).map((line) => `${line.speaker || ''}|${line.text}`).join('\n');
    if (key === paintedKey) return;
    paintFadeNarrator(ctx, CARD_W, CARD_H, lines);
    const pixels = ctx.getImageData(0, 0, CARD_W, CARD_H);
    const bytes = new Uint8Array(pixels.data);
    engine._device.queue.writeTexture(
      { texture: tex.texture },
      bytes,
      { bytesPerRow: CARD_W * 4, rowsPerImage: CARD_H },
      { width: CARD_W, height: CARD_H },
    );
    paintedKey = key;
  }

  function set(opacity, ms = 0) {
    const next = Math.max(0, Math.min(1, Number(opacity) || 0));
    from = current;
    target = next;
    if (!(ms > 0) || Math.abs(from - target) < 0.02) {
      current = target;
      liveFade = current;
      started = 0;
      duration = 0;
      return;
    }
    started = performance.now();
    duration = ms;
  }

  function setLines(lines) {
    if (Array.isArray(lines)) {
      liveLines = lines;
      return;
    }
    const narrator = Array.isArray(lines?.narrator) ? lines.narrator : [];
    const spoken = Array.isArray(lines?.spoken) ? lines.spoken : [];
    const extra = spoken.filter((line) => {
      const pos = line?.pos;
      return !(pos && Number.isFinite(pos.x) && Number.isFinite(pos.z));
    });
    liveLines = narrator.concat(extra);
  }

  function stepOpacity() {
    if (!(duration > 0)) {
      current = target;
      liveFade = current;
      return current;
    }
    current = xrFadeMix(from, target, performance.now() - started, duration);
    if (Math.abs(current - target) < 0.01) {
      current = target;
      duration = 0;
    }
    liveFade = current;
    return current;
  }

  function update() {
    const eye = xrEye();
    const opacity = stepOpacity();
    const lines = liveLines.filter((line) => String(line?.text || '').trim());
    if (!eye || (opacity <= 0.01 && !lines.length)) {
      hide();
      return;
    }
    const frustum = xrEyeFrustum();
    if (opacity > 0.01) {
      const pose = xrFadePlane(eye.worldMatrix, frustum);
      placeMesh(plate.mesh, pose, pose.width, pose.height);
      setShaderUniform(plate.mat, 'fade', opacity);
    } else {
      setSubtreeVisible(plate.mesh, false);
      if (plate.mesh.position) plate.mesh.position.y = -9999;
    }
    if (lines.length) {
      try {
        paint(lines);
      } catch {
        /* raster can miss a frame */
      }
      const hud = xrHudEye() || eye;
      const cardPose = xrFadePlane(hud.worldMatrix, frustum, XR_FADE_DEPTH * 0.92);
      const cardH = cardPose.height * 0.42;
      const cardW = cardH * (CARD_W / CARD_H);
      placeMesh(card.mesh, cardPose, cardW, cardH);
      setShaderUniform(card.mat, 'fade', opacity > 0.01 ? opacity : 1);
    } else {
      setSubtreeVisible(card.mesh, false);
    }
    visible = true;
  }

  function clear() {
    current = 0;
    target = 0;
    duration = 0;
    liveFade = 0;
    liveLines = [];
    hide();
  }

  return {
    set,
    setLines,
    opacity: () => current,
    update,
    clear,
  };
}
