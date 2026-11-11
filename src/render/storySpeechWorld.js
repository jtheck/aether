// Story lines in the headset. Unit speech stands on the speaker. Speakerless
// narrator copy lives on the visor fade plate, not on the ground.

import { xrEye } from './xrEye.js';
import { LINE_STYLE_LOOK } from '../story/speech.js';
import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  setShaderTexture,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const BUBBLES = 5;
const BUBBLE_W = 512;
const BUBBLE_H = 192;

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
  // Canvas row 0 is the top of the glyphs and samples at v = 0, so that
  // edge is local +Y (the top of the panel). The panel's local +X is the
  // viewer's left, so the left of the text sits on that edge.
  const uvs = new Float32Array([1, 1, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
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

/**
 * @param {object} engine
 * @param {object} scene
 * @param {string} name
 * @param {number} width
 * @param {number} height
 */
function createPanel(engine, scene, name, width, height) {
  const { positions, normals, uvs, indices } = makeQuad();
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = 240;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  const mat = createShaderMaterial({
    name,
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['world', 'viewProjection'],
    samplers: ['glyph'],
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
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(glyph, glyphSampler, input.uv);
}`,
  });
  mesh.material = mat;
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);
  const blank = new Uint8Array(width * height * 4);
  const tex = createTexture2DFromPixels(engine, blank, width, height, {
    srgb: true,
    minFilter: 'linear',
    magFilter: 'linear',
  });
  setShaderTexture(mat, 'glyph', tex);
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  let key = '';
  let visible = false;
  let paintWarned = false;

  function hide() {
    if (!visible) return;
    setSubtreeVisible(mesh, false);
    if (mesh.position) mesh.position.y = -9999;
    mesh.markLocalDirty?.();
    visible = false;
  }

  function paint(nextKey, draw) {
    if (!ctx || nextKey === key) return;
    try {
      ctx.clearRect(0, 0, width, height);
      draw(ctx, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);
      const bytes = new Uint8Array(pixels.data);
      engine._device.queue.writeTexture(
        { texture: tex.texture },
        bytes,
        { bytesPerRow: width * 4, rowsPerImage: height },
        { width, height },
      );
      key = nextKey;
    } catch (err) {
      if (!paintWarned) {
        paintWarned = true;
        console.warn(`[storySpeech] ${name} raster failed`, err);
      }
    }
  }

  /**
   * local Y is the top of the text, local Z is the face normal.
   * @param {number[]} yAxis
   * @param {number[]} zAxis
   */
  function place(x, y, z, worldW, worldH, yAxis, zAxis) {
    let yx = yAxis[0];
    let yy = yAxis[1];
    let yz = yAxis[2];
    const yl = Math.hypot(yx, yy, yz) || 1;
    yx /= yl;
    yy /= yl;
    yz /= yl;
    let zx = zAxis[0];
    let zy = zAxis[1];
    let zz = zAxis[2];
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
      mesh.position.x = x;
      mesh.position.y = y;
      mesh.position.z = z;
    }
    if (mesh.scaling) {
      mesh.scaling.x = worldW;
      mesh.scaling.y = worldH;
      mesh.scaling.z = 1;
    }
    const q = quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz);
    if (![q.x, q.y, q.z, q.w, x, y, z].every(Number.isFinite)) return;
    setQuat(mesh, q);
    setSubtreeVisible(mesh, true);
    mesh.markLocalDirty?.();
    visible = true;
  }

  return { hide, paint, place };
}

function veil(ctx, w, h) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.08, w * 0.5, h * 0.5, w * 0.48);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintBubble(ctx, w, h, line) {
  veil(ctx, w, h);
  const look = LINE_STYLE_LOOK[line.style] || LINE_STYLE_LOOK.normal;
  const maxW = w * 0.84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(String(line.speaker || ''), w * 0.5, h * 0.32);
  ctx.font = '32px sans-serif';
  ctx.fillStyle = look.color || '#fff6d9';
  const rows = wrapText(ctx, line.text, maxW).slice(0, 3);
  let y = h * 0.55;
  for (const row of rows) {
    ctx.fillText(row, w * 0.5, y);
    y += 36;
  }
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} [groundHeight]
 */
export function createStorySpeechWorld(engine, scene, groundHeight) {
  if (typeof document === 'undefined') {
    return { set() {}, update() {}, clear() {} };
  }
  const bubbles = [];
  for (let i = 0; i < BUBBLES; i++) {
    bubbles.push(createPanel(engine, scene, `story-say-${i}`, BUBBLE_W, BUBBLE_H));
  }
  /** @type {{ spoken?: object[], narrator?: object[] } | null} */
  let payload = null;
  let warned = false;

  function hideAll() {
    for (const bubble of bubbles) bubble.hide();
  }

  function clear() {
    payload = null;
    hideAll();
  }

  function hasAnchor(line) {
    const pos = line?.pos;
    return !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.z);
  }

  function draw() {
    const eye = xrEye();
    const spoken = payload?.spoken || [];
    if (!eye) {
      hideAll();
      return;
    }
    const anchored = [];
    for (let i = 0; i < spoken.length; i++) {
      const line = spoken[i];
      if (hasAnchor(line)) anchored.push(line);
    }
    if (!anchored.length) {
      hideAll();
      return;
    }
    const wm = eye.worldMatrix;

    for (let i = 0; i < bubbles.length; i++) {
      const line = anchored[i];
      if (!line) {
        bubbles[i].hide();
        continue;
      }
      const pos = line.pos;
      const paintKey = `${line.speaker}|${line.style}|${line.text}`;
      bubbles[i].paint(paintKey, (ctx, w, h) => paintBubble(ctx, w, h, line));
      let nx = wm[12] - pos.x;
      let nz = wm[14] - pos.z;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const width = Math.max(4.5, Math.min(nl * 0.22, 14));
      const height = width * (BUBBLE_H / BUBBLE_W);
      bubbles[i].place(
        pos.x + nx * 1.1,
        (Number.isFinite(pos.y) ? pos.y : 0) + 1.4,
        pos.z + nz * 1.1,
        width,
        height,
        [0, 1, 0],
        [nx, 0, nz],
      );
    }

  }

  function update() {
    try {
      draw();
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn('[storySpeech] update failed', err);
      }
    }
  }

  return {
    set(next) {
      payload = next && (next.spoken?.length || next.narrator?.length) ? next : null;
      if (!payload) clear();
    },
    update,
    clear,
  };
}
