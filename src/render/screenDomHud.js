// Headset copy of the flat page chrome the eye never sees: the top clock /
// pop / fps line, and the spectator (or shared-vision) roster when it is up.
// The monitor keeps the HTML. While XR is presenting we rasterize those
// elements onto quads. They sit a little closer to center than the control pads.

import { resourcePileTextureSize } from './resourcePileHud.js';
import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  setShaderTexture,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const ICON_DEPTH = 0.8;
const HUD_RENDER_ORDER = 428;
const PAD = 4;
/** Headset size versus the monitor box. A 13px line is a speck on the eye. */
const PANEL_SCALE = 2.5;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {Map<string, { img: CanvasImageSource | null, failed: boolean }>} */
const iconCache = new Map();
let iconVer = 0;

/**
 * @param {{ left: number, top: number, width: number, height: number }[]} rects
 * @returns {{ left: number, top: number, width: number, height: number } | null}
 */
export function clientRectUnion(rects) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let n = 0;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
    n++;
  }
  if (!n) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {number} pad
 */
export function padClientRect(rect, pad) {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
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
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
}

/**
 * Canvas font at the raster scale. The layout coordinates are already scaled;
 * the CSS font size is not, so an unscaled face draws as a tiny stamp.
 * @param {CSSStyleDeclaration | { fontSize?: string, fontFamily?: string, fontWeight?: string, fontStyle?: string }} style
 * @param {number} scale
 */
export function hudCanvasFont(style, scale) {
  const px = parseFloat(style?.fontSize);
  const size = (Number.isFinite(px) && px > 0 ? px : 13) * (scale > 0 ? scale : 1);
  const family = style?.fontFamily || 'sans-serif';
  const weight = style?.fontWeight && style.fontWeight !== 'normal' ? `${style.fontWeight} ` : '';
  const italic = style?.fontStyle && style.fontStyle !== 'normal' ? `${style.fontStyle} ` : '';
  return `${italic}${weight}${size}px ${family}`;
}

function glyphAlign(el, style) {
  let j = style.justifySelf;
  if (!j || j === 'auto' || j === 'normal') {
    const parent = el.parentElement;
    const fromParent = parent ? getComputedStyle(parent).justifyItems : '';
    const item = fromParent ? fromParent.split(' ').pop() : '';
    if (item && item !== 'auto' && item !== 'normal' && item !== 'legacy') j = item;
    else j = style.textAlign;
  }
  if (j === 'center' || j === 'middle') return 'center';
  if (j === 'end' || j === 'right' || j === 'flex-end') return 'right';
  return 'left';
}

function loadIcon(svg, w, h) {
  const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const key = `${w}x${h}:${xml}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const rec = { img: null, failed: false };
  iconCache.set(key, rec);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    rec.img = img;
    iconVer += 1;
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    rec.failed = true;
  };
  img.src = url;
  return rec;
}

function uploadTexture(engine, tex, data, width, height) {
  engine._device.queue.writeTexture(
    { texture: tex.texture },
    data,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {string} name
 */
function createQuad(engine, scene, name) {
  const { positions, normals, uvs, indices } = makeQuad();
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = HUD_RENDER_ORDER;
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

  const blank = new Uint8Array(64 * 4 * 4);
  let tex = createTexture2DFromPixels(engine, blank, 64, 4, {
    srgb: true,
    minFilter: 'linear',
    magFilter: 'linear',
  });
  setShaderTexture(mat, 'glyph', tex);
  let texW = 64;
  let texH = 4;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let paintedKey = '';
  let retryAt = 0;
  let warned = false;
  let visible = false;

  function hide() {
    if (!visible) return;
    setSubtreeVisible(mesh, false);
    if (mesh.position) mesh.position.y = -9999;
    mesh.markLocalDirty?.();
    visible = false;
  }

  function ensureTexture(w, h) {
    if (tex && texW === w && texH === h) return;
    const data = new Uint8Array(w * h * 4);
    tex = createTexture2DFromPixels(engine, data, w, h, {
      srgb: true,
      minFilter: 'linear',
      magFilter: 'linear',
    });
    texW = w;
    texH = h;
    setShaderTexture(mat, 'glyph', tex);
  }

  function drawTree(el, alpha, union, scale) {
    if (!ctx || !el || el.hidden) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const opacity = Number(style.opacity);
    const next = alpha * (Number.isFinite(opacity) ? opacity : 1);
    const tag = el.tagName.toLowerCase();
    if (tag === 'svg') {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const dw = Math.max(1, Math.round(box.width * scale));
        const dh = Math.max(1, Math.round(box.height * scale));
        const rec = loadIcon(el, dw, dh);
        if (rec.img) {
          ctx.globalAlpha = next;
          ctx.drawImage(
            rec.img,
            (box.left - union.left) * scale,
            (box.top - union.top) * scale,
            dw,
            dh,
          );
        }
      }
      return;
    }
    let text = '';
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) text += nodes[i].textContent;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        ctx.font = hudCanvasFont(style, scale);
        ctx.fillStyle = style.color || '#cdd6e4';
        ctx.globalAlpha = next;
        ctx.textBaseline = 'middle';
        const align = glyphAlign(el, style);
        ctx.textAlign = align;
        const x = align === 'center'
          ? (box.left + box.width * 0.5 - union.left) * scale
          : align === 'right'
            ? (box.right - union.left) * scale
            : (box.left - union.left) * scale;
        const y = (box.top + box.height * 0.5 - union.top) * scale;
        ctx.fillText(text, x, y);
      }
    }
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) drawTree(kids[i], next, union, scale);
  }

  /**
   * @param {HTMLElement} root
   * @param {{ left: number, top: number, width: number, height: number }} union
   * @param {string} key
   */
  function paint(root, union, key) {
    if (!ctx) return;
    if (performance.now() < retryAt) return;
    if (key === paintedKey) return;
    try {
      const size = resourcePileTextureSize(union.width, union.height);
      const scale = size.w / union.width;
      canvas.width = size.w;
      canvas.height = size.h;
      ctx.clearRect(0, 0, size.w, size.h);
      drawTree(root, 1, union, scale);
      ctx.globalAlpha = 1;
      const pixels = ctx.getImageData(0, 0, size.w, size.h);
      const src = pixels.data;
      const bytes = src.byteOffset === 0 ? src : new Uint8Array(src);
      ensureTexture(size.w, size.h);
      uploadTexture(engine, tex, bytes, size.w, size.h);
      paintedKey = key;
    } catch (err) {
      retryAt = performance.now() + 1000;
      if (!warned) {
        warned = true;
        console.warn(`[screenDomHud] ${name} raster failed`, err);
      }
    }
  }

  /**
   * @param {object | null | undefined} camera
   * @param {{ rayFromCanvas?: Function, canvas?: HTMLCanvasElement, hudPoint?: Function, hudScale?: Function }} screen
   * @param {{ left: number, top: number, width: number, height: number }} union
   */
  function place(camera, screen, union) {
    const host = screen.canvas.getBoundingClientRect();
    const cx = union.left - host.left + union.width * 0.5;
    const cy = union.top - host.top + union.height * 0.5;
    const toHud = screen.chromePoint || screen.hudPoint || ((x, y) => ({ x, y }));
    const p = toHud(cx, cy);
    const ray = screen.rayFromCanvas(p.x, p.y);
    const rayR = screen.rayFromCanvas(p.x + 1, p.y);
    if (!ray || !rayR) {
      hide();
      return;
    }
    const wx = ray.ox + ray.dx * ICON_DEPTH;
    const wy = ray.oy + ray.dy * ICON_DEPTH;
    const wz = ray.oz + ray.dz * ICON_DEPTH;
    const rx = rayR.ox + rayR.dx * ICON_DEPTH;
    const ry = rayR.oy + rayR.dy * ICON_DEPTH;
    const rz = rayR.oz + rayR.dz * ICON_DEPTH;
    const pixel = Math.hypot(rx - wx, ry - wy, rz - wz);
    if (!(pixel > 1e-6)) {
      hide();
      return;
    }

    const wm = camera?.worldMatrix;
    const eye = wm && Number.isFinite(wm[12])
      ? { x: wm[12], y: wm[13], z: wm[14] }
      : { x: ray.ox, y: ray.oy, z: ray.oz };
    let fx = eye.x - wx;
    let fy = eye.y - wy;
    let fz = eye.z - wz;
    const flen = Math.hypot(fx, fy, fz) || 1;
    fx /= flen;
    fy /= flen;
    fz /= flen;
    let rgtX = rx - wx;
    let rgtY = ry - wy;
    let rgtZ = rz - wz;
    const rlen = Math.hypot(rgtX, rgtY, rgtZ) || 1;
    rgtX /= rlen;
    rgtY /= rlen;
    rgtZ /= rlen;
    let upX = fy * rgtZ - fz * rgtY;
    let upY = fz * rgtX - fx * rgtZ;
    let upZ = fx * rgtY - fy * rgtX;
    const ulen = Math.hypot(upX, upY, upZ) || 1;
    upX /= ulen;
    upY /= ulen;
    upZ /= ulen;
    rgtX = upY * fz - upZ * fy;
    rgtY = upZ * fx - upX * fz;
    rgtZ = upX * fy - upY * fx;

    if (mesh.position) {
      mesh.position.x = wx;
      mesh.position.y = wy;
      mesh.position.z = wz;
    }
    if (mesh.scaling) {
      mesh.scaling.x = union.width * pixel * PANEL_SCALE;
      mesh.scaling.y = union.height * pixel * PANEL_SCALE;
      mesh.scaling.z = 1;
    }
    setQuat(mesh, quatFromBasis(rgtX, rgtY, rgtZ, upX, upY, upZ, fx, fy, fz));
    setSubtreeVisible(mesh, true);
    mesh.markLocalDirty?.();
    visible = true;
  }

  return {
    hide,
    get ready() { return !!paintedKey; },
    paint,
    place,
  };
}

function boxOf(el) {
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right };
}

function styleKey(root) {
  const nodes = root.querySelectorAll('[style]');
  let s = '';
  for (let i = 0; i < nodes.length; i++) s += nodes[i].getAttribute('style') || '';
  return s;
}

/**
 * @param {HTMLElement} root
 * @param {{ width: number, height: number }} union
 */
function contentKey(root, union) {
  const text = (root.innerText || '').replace(/\s+/g, ' ').trim();
  const svgs = root.querySelectorAll('svg').length;
  return `${text}|${svgs}|${iconVer}|${styleKey(root)}|${Math.round(union.width)}x${Math.round(union.height)}`;
}

function measureStatus() {
  const root = document.getElementById('status');
  if (!root) return null;
  const parts = [root];
  const pop = document.getElementById('status-pop');
  const time = document.getElementById('status-time');
  const side = document.getElementById('status-side');
  if (pop) parts.push(pop);
  if (time) parts.push(time);
  if (side) parts.push(side);
  const rect = clientRectUnion(parts.map((el) => boxOf(el)).filter(Boolean));
  if (!rect) return null;
  if (!(root.innerText || '').trim()) return null;
  return { root, rect: padClientRect(rect, PAD) };
}

function measureObserver() {
  const root = document.getElementById('observer-data');
  if (!root || root.hidden) return null;
  const rect = boxOf(root);
  if (!rect) return null;
  const text = (root.innerText || '').trim();
  if (!text && root.querySelectorAll('svg').length === 0) return null;
  return { root, rect: padClientRect(rect, PAD) };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {{ rayFromCanvas?: Function, canvas?: HTMLCanvasElement, hudPoint?: Function, hudScale?: Function }} screen
 */
export function createScreenDomHud(engine, scene, screen) {
  if (typeof document === 'undefined') return { update() {}, clear() {} };
  const panels = [
    { measure: measureStatus, quad: createQuad(engine, scene, 'hud-status') },
    { measure: measureObserver, quad: createQuad(engine, scene, 'hud-observer') },
  ];

  function clear() {
    for (let i = 0; i < panels.length; i++) panels[i].quad.hide();
  }

  /**
   * @param {object | null | undefined} camera
   * @param {boolean} active
   */
  function update(camera, active) {
    if (!active || !screen?.rayFromCanvas || !screen.canvas) {
      clear();
      return;
    }
    const host = screen.canvas.getBoundingClientRect();
    if (!(host.width > 8) || !(host.height > 8)) {
      clear();
      return;
    }
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const measured = panel.measure();
      if (!measured) {
        panel.quad.hide();
        continue;
      }
      const key = contentKey(measured.root, measured.rect);
      panel.quad.paint(measured.root, measured.rect, key);
      if (!panel.quad.ready) {
        panel.quad.hide();
        continue;
      }
      panel.quad.place(camera, screen, measured.rect);
    }
  }

  return { update, clear };
}
