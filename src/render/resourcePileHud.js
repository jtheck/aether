// Resource piles in the scene. The bank art is authored as an SVG and shown
// as HTML on the monitor. The headset never sees that overlay, so while XR
// is presenting we rasterize the same element onto a camera-locked quad.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  createTexture2DFromPixels,
  setShaderTexture,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const ICON_DEPTH = 0.8;
const HUD_RENDER_ORDER = 418;

/**
 * Texture size for a bank element. Width is a multiple of 64 so the
 * WebGPU upload row stride (width * 4) stays 256-byte aligned.
 * @param {number} cssW
 * @param {number} cssH
 */
export function resourcePileTextureSize(cssW, cssH) {
  const wCss = Math.max(1, cssW);
  const hCss = Math.max(1, cssH);
  const scale = Math.min(3, Math.max(2, 960 / wCss));
  let w = Math.ceil((wCss * scale) / 64) * 64;
  w = Math.max(64, Math.min(1024, w));
  const h = Math.max(1, Math.round((w * hCss) / wCss));
  return { w, h };
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

function iconKeyOf(root) {
  const live = root.querySelectorAll('.resource-icon');
  let s = root.querySelector('svg')?.dataset?.ordered || '0';
  s += ':';
  for (let i = 0; i < live.length; i++) {
    const el = live[i];
    s += el.classList.contains('is-on') ? '1' : el.classList.contains('is-flash') ? 'f' : '0';
  }
  return s;
}

function countKeyOf(root) {
  const nodes = root.querySelectorAll('.resource-bank-counts [data-kind]');
  let s = '';
  for (let i = 0; i < nodes.length; i++) {
    s += `${nodes[i].getAttribute('data-kind')}=${nodes[i].textContent};`;
  }
  return s;
}

function tintStroke(el, color) {
  const shapes = el.querySelectorAll('path, circle, line, polyline, polygon');
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const style = shape.getAttribute('style') || '';
    const next = /stroke\s*:/i.test(style)
      ? style.replace(/stroke\s*:\s*[^;]+/i, `stroke:${color}`)
      : `${style}${style && !style.endsWith(';') ? ';' : ''}stroke:${color}`;
    shape.setAttribute('style', next);
    shape.setAttribute('stroke', color);
  }
}

function applyBankVisibility(root, clone) {
  const live = root.querySelectorAll('.resource-icon');
  const copy = clone.querySelectorAll('.resource-icon');
  const n = Math.min(live.length, copy.length);
  for (let i = 0; i < n; i++) {
    const on = live[i].classList.contains('is-on');
    const flash = live[i].classList.contains('is-flash');
    const opacity = on ? '1' : flash ? '0.6' : '0';
    copy[i].setAttribute('opacity', opacity);
    if (flash) tintStroke(copy[i], '#ec3');
  }
}

function loadSvgImage(root, texW, texH) {
  const svg = root.querySelector('svg');
  if (!svg) return Promise.resolve(null);
  const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
  applyBankVisibility(root, clone);
  clone.setAttribute('width', String(texW));
  clone.setAttribute('height', String(texH));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function drawCounts(ctx, root, scale) {
  const nodes = root.querySelectorAll('.resource-bank-counts [data-kind]');
  ctx.font = `${Math.max(8, Math.round(11 * scale))}px Roboto, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(205, 214, 228, 0.85)';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  for (let i = 0; i < nodes.length; i++) {
    const el = /** @type {HTMLElement} */ (nodes[i]);
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
    ctx.fillText(el.textContent || '', left * scale, top * scale);
  }
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
 * @param {{ rayFromCanvas?: Function, canvas?: HTMLCanvasElement }} [screen]
 */
export function createResourcePileHud(engine, scene, screen = {}) {
  const { positions, normals, uvs, indices } = makeQuad();
  const mesh = createMeshFromData(engine, 'resource-piles', positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = HUD_RENDER_ORDER;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  const mat = createShaderMaterial({
    name: 'resource-piles',
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['world', 'viewProjection'],
    samplers: ['pile'],
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
  return textureSample(pile, pileSampler, input.uv);
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
  setShaderTexture(mat, 'pile', tex);
  let texW = 64;
  let texH = 4;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let visible = false;
  let iconKey = '';
  /** @type {HTMLImageElement | null} */
  let image = null;
  let paintedKey = '';
  let job = 0;
  let warned = false;
  let retryAt = 0;

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
    setShaderTexture(mat, 'pile', tex);
  }

  async function refresh(root, cssW, cssH) {
    if (!ctx || !root.querySelector('svg')) return;
    if (performance.now() < retryAt) return;
    const size = resourcePileTextureSize(cssW, cssH);
    const icons = iconKeyOf(root);
    const full = `${icons}\n${countKeyOf(root)}\n${size.w}x${size.h}`;
    if (full === paintedKey && image) return;
    const id = ++job;
    if (icons !== iconKey || !image) {
      const img = await loadSvgImage(root, size.w, size.h);
      if (id !== job) return;
      if (!img) {
        retryAt = performance.now() + 1000;
        if (!warned) {
          warned = true;
          console.warn('[resourcePileHud] icon raster failed');
        }
        return;
      }
      image = img;
      iconKey = icons;
    }
    if (id !== job || !image) return;
    canvas.width = size.w;
    canvas.height = size.h;
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(image, 0, 0, size.w, size.h);
    drawCounts(ctx, root, size.w / cssW);
    const pixels = ctx.getImageData(0, 0, size.w, size.h);
    const src = pixels.data;
    const bytes = src.byteOffset === 0 ? src : new Uint8Array(src);
    ensureTexture(size.w, size.h);
    uploadTexture(engine, tex, bytes, size.w, size.h);
    paintedKey = full;
  }

  /**
   * @param {object | null | undefined} camera
   * @param {boolean} active headset is presenting
   */
  function update(camera, active) {
    const root = document.getElementById('resource-bank');
    if (!active || !root || root.hidden || !screen.rayFromCanvas || !screen.canvas) {
      hide();
      return;
    }
    const bank = root.getBoundingClientRect();
    const host = screen.canvas.getBoundingClientRect();
    if (!(bank.width > 8) || !(bank.height > 8)) {
      hide();
      return;
    }
    void refresh(root, bank.width, bank.height);
    if (!paintedKey) {
      hide();
      return;
    }

    const toHud = screen.chromePoint || screen.hudPoint || ((x, y) => ({ x, y }));
    const cx = bank.left - host.left + bank.width * 0.5;
    const cy = bank.top - host.top + bank.height * 0.5;
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
      mesh.scaling.x = bank.width * pixel;
      mesh.scaling.y = bank.height * pixel;
      mesh.scaling.z = 1;
    }
    setQuat(mesh, quatFromBasis(rgtX, rgtY, rgtZ, upX, upY, upZ, fx, fy, fz));
    setSubtreeVisible(mesh, true);
    mesh.markLocalDirty?.();
    visible = true;
  }

  return { update, clear: hide };
}
