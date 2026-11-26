// Story lines in the headset. A unit that is in front of the eye carries its
// own text. A unit that isn't sticks to a HUD column. Speakerless narrator
// copy lives on the visor fade plate.

import { xrEye, xrHudEye } from './xrEye.js';
import { LINE_STYLE_LOOK } from '../story/speech.js';
import {
  assignSpeechColumns,
  speechColumnPose,
  speechInFront,
  speechSide,
  speechUnitPose,
} from './storySpeechPose.js';
import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  setShaderTexture,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const BUBBLES = 5;
const BUBBLE_W = 1024;
const BUBBLE_H = 352;
const SPEECH_FONT = 'Roboto, sans-serif';

/** Body size relative to `normal`, matching LINE_STYLE_LOOK. */
const STYLE_SCALE = Object.freeze({
  normal: 1,
  shout: 20 / 15,
  whisper: 12 / 15,
  think: 14 / 15,
  command: 18 / 15,
  scared: 1,
});

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

function wrapSpeech(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  function pushWord(word) {
    if (ctx.measureText(word).width <= maxWidth) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > maxWidth) {
        lines.push(cur);
        cur = word;
      } else cur = next;
      return;
    }
    if (cur) {
      lines.push(cur);
      cur = '';
    }
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk && ctx.measureText(next).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else chunk = next;
    }
    cur = chunk;
  }
  for (const word of words) pushWord(word);
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function styleFace(style) {
  return {
    scale: STYLE_SCALE[style] || 1,
    italic: style === 'think',
  };
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

function ink(ctx, text, x, y, font, color, px) {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, px * 0.11);
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = px * 0.2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, px * 0.04);
  ctx.fillText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Headset unit-speech line. Glyphs only: a dark stroke holds them on the
 * world, with no plate behind the words.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {{ speaker?: string, text?: string, style?: string }} line
 */
export function paintSpeechBubble(ctx, w, h, line) {
  const look = LINE_STYLE_LOOK[line?.style] || LINE_STYLE_LOOK.normal;
  const face = styleFace(line?.style);
  const speaker = String(line?.speaker || '').trim();
  const maxW = w * 0.86;
  let bodyPx = Math.max(12, Math.round(h * 0.42 * face.scale));
  let namePx = Math.max(11, Math.round(h * 0.24));
  let rows = [''];
  let nameStep = 0;
  let bodyStep = bodyPx;
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${bodyPx}px ${SPEECH_FONT}`;
    rows = wrapSpeech(ctx, line?.text, maxW).slice(0, 2);
    bodyStep = Math.round(bodyPx * 1.18);
    nameStep = speaker ? Math.round((namePx + bodyPx) * 0.58) : 0;
    const span = nameStep + Math.max(0, rows.length - 1) * bodyStep;
    const top = (speaker ? namePx : bodyPx) * 0.62;
    const bot = bodyPx * 0.62;
    if (span + top + bot <= h * 0.92 || bodyPx <= Math.round(h * 0.11)) break;
    bodyPx = Math.max(12, Math.round(bodyPx * 0.86));
    namePx = Math.max(11, Math.round(namePx * 0.9));
  }
  const span = nameStep + Math.max(0, rows.length - 1) * bodyStep;
  let y = (h - span) * 0.5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = w * 0.5;
  if (speaker) {
    ink(ctx, speaker, x, y, `bold ${namePx}px ${SPEECH_FONT}`, '#ffcc44', namePx);
    y += nameStep;
  }
  const bodyFont = `${face.italic ? 'italic ' : ''}${bodyPx}px ${SPEECH_FONT}`;
  const color = look.color || '#fff6d9';
  for (const row of rows) {
    if (!row) continue;
    ink(ctx, row, x, y, bodyFont, color, bodyPx);
    y += bodyStep;
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
  /** @type {Map<string, { side: number, index: number }>} */
  let held = new Map();
  let fontEpoch = 0;
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (fonts?.ready) {
    fonts.load?.(`64px ${SPEECH_FONT}`).catch(() => {});
    fonts.ready.then(() => { fontEpoch += 1; }).catch(() => {});
  }
  /** @type {{ spoken?: object[], narrator?: object[] } | null} */
  let payload = null;
  let warned = false;

  function hideAll() {
    for (const bubble of bubbles) bubble.hide();
  }

  function clear() {
    payload = null;
    held = new Map();
    hideAll();
  }

  function lineKey(line, nth) {
    const base = `${line.speaker}|${line.style}|${line.text}`;
    return nth ? `${base}#${nth}` : base;
  }

  function hasAnchor(line) {
    const pos = line?.pos;
    return !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.z);
  }

  function draw() {
    const eye = xrHudEye() || xrEye();
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
      held = new Map();
      hideAll();
      return;
    }
    const wm = eye.worldMatrix;
    const seen = new Map();
    const rows = [];
    const wishes = [];
    for (let i = 0; i < anchored.length; i++) {
      const line = anchored[i];
      const base = `${line.speaker}|${line.style}|${line.text}`;
      const nth = seen.get(base) || 0;
      seen.set(base, nth + 1);
      const key = lineKey(line, nth);
      const onUnit = speechInFront(wm, line.pos);
      rows.push({ line, key, onUnit });
      if (!onUnit) wishes.push({ key, side: speechSide(wm, line.pos) });
    }
    held = assignSpeechColumns(wishes, held);
    rows.sort((a, b) => Number(b.onUnit) - Number(a.onUnit));

    for (let i = 0; i < bubbles.length; i++) {
      const row = rows[i];
      const slot = row && !row.onUnit ? held.get(row.key) : null;
      if (!row || (!row.onUnit && !slot)) {
        bubbles[i].hide();
        continue;
      }
      const paintKey = `${fontEpoch}|${row.key}`;
      bubbles[i].paint(paintKey, (ctx, w, h) => paintSpeechBubble(ctx, w, h, row.line));
      const pose = row.onUnit
        ? speechUnitPose(wm, row.line.pos)
        : speechColumnPose(wm, slot.side, slot.index);
      bubbles[i].place(
        pose.x,
        pose.y,
        pose.z,
        pose.width,
        pose.height,
        pose.yAxis,
        pose.zAxis,
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
