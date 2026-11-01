// Linux Vulkan throws from queue.copyExternalImageToTexture and can drop the
// device on that throw, which leaves a white canvas. Lite uses the call for
// every image upload, including glTF. Always read the image on the CPU and
// writeTexture, and never issue the native copy.
//
// Lite then renders each mip by sampling the previous one. That pass is the
// first GPU draw her machine reaches, and a lost device presents white. On
// Linux the mips are written here instead, and linuxPresent skips the pass.

import { isLinuxGpu } from './gpuPlatform.js';

const patched = new WeakSet();
let warned = false;

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn('[gpu] uploading images on the CPU');
}

/**
 * @param {GPUExtent3D | number[] | ArrayLike<number> | null | undefined} copySize
 * @returns {{ width: number, height: number } | null}
 */
export function externalImageExtent(copySize) {
  if (copySize == null) return null;
  let width;
  let height;
  if (typeof copySize === 'object' && ('width' in copySize || 'height' in copySize)) {
    width = copySize.width;
    height = copySize.height ?? 1;
  } else {
    width = copySize[0];
    height = copySize[1] ?? 1;
  }
  width = width | 0;
  height = height | 0;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function origin2(origin) {
  if (!origin) return { x: 0, y: 0 };
  if (typeof origin === 'object' && ('x' in origin || 'y' in origin)) {
    return { x: origin.x | 0, y: origin.y | 0 };
  }
  return { x: origin[0] | 0, y: origin[1] | 0 };
}

function premultiply(straight, texelCount) {
  const out = new Uint8ClampedArray(texelCount * 4);
  for (let i = 0; i < texelCount; i++) {
    const o = i * 4;
    const a = straight[o + 3];
    out[o] = (straight[o] * a + 127) / 255 | 0;
    out[o + 1] = (straight[o + 1] * a + 127) / 255 | 0;
    out[o + 2] = (straight[o + 2] * a + 127) / 255 | 0;
    out[o + 3] = a;
  }
  return out;
}

function flipRows(straight, width, height) {
  const stride = width * 4;
  const out = new Uint8ClampedArray(height * stride);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * stride;
    out.set(straight.subarray(src, src + stride), y * stride);
  }
  return out;
}

/**
 * Bytes writeTexture should store. `straight` is unpremultiplied RGBA for the
 * copy rectangle, top row first. `flipY` matches copyExternalImageToTexture.
 * @param {ArrayLike<number>} straight
 * @param {GPUCopyExternalImageDestInfo} destination
 * @param {GPUExtent3D | number[]} copySize
 * @param {boolean} [flipY]
 */
export function externalImageWritePlan(straight, destination, copySize, flipY = false) {
  const extent = externalImageExtent(copySize);
  if (!extent || !destination?.texture || !straight) return null;
  const { width, height } = extent;
  const texelCount = width * height;
  if (straight.length < texelCount * 4) return null;
  let data = straight;
  if (flipY && height > 1) data = flipRows(data, width, height);
  if (destination.premultipliedAlpha) data = premultiply(data, texelCount);
  const packed = packTextureRows(data, width, height);
  /** @type {{ texture: GPUTexture, mipLevel?: number, origin?: GPUOrigin3D }} */
  const dest = { texture: destination.texture };
  if (destination.mipLevel) dest.mipLevel = destination.mipLevel;
  if (destination.origin) dest.origin = destination.origin;
  const tightBytes = width * height * 4;
  const tight = data instanceof Uint8Array
    ? data.subarray(0, tightBytes)
    : new Uint8Array(data.buffer, data.byteOffset, tightBytes);
  return {
    destination: dest,
    data: packed.data,
    dataLayout: { bytesPerRow: packed.bytesPerRow, rowsPerImage: height },
    size: { width, height, depthOrArrayLayers: 1 },
    tight,
  };
}

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(linear) {
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * One box-filter step. `srgb` averages RGB in linear light, matching Lite's
 * mip pass on an `-srgb` texture. Returns the next mip's tight RGBA.
 * @param {ArrayLike<number>} src
 * @param {number} width
 * @param {number} height
 * @param {boolean} srgb
 */
export function downsampleStored(src, width, height, srgb) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const dst = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(height - 1, y * 2);
    const y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x0 + 1);
      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        if (srgb) {
          const l = SRGB_TO_LINEAR[src[i00 + c]] + SRGB_TO_LINEAR[src[i10 + c]]
            + SRGB_TO_LINEAR[src[i01 + c]] + SRGB_TO_LINEAR[src[i11 + c]];
          dst[o + c] = linearToSrgbByte(l * 0.25);
        } else {
          dst[o + c] = (src[i00 + c] + src[i10 + c] + src[i01 + c] + src[i11 + c] + 2) >> 2;
        }
      }
      dst[o + 3] = (src[i00 + 3] + src[i10 + 3] + src[i01 + 3] + src[i11 + 3] + 2) >> 2;
    }
  }
  return { data: dst, width: w, height: h };
}

let mipWarned = false;

function writeCpuMipChain(queue, destination, pixels, width, height) {
  const texture = destination?.texture;
  const levels = texture?.mipLevelCount | 0;
  if (levels <= 1 || texture.width !== width || texture.height !== height) return;
  if ((destination.mipLevel | 0) > 0) return;
  const origin = destination.origin;
  const ox = origin ? (origin.x ?? origin[0] ?? 0) : 0;
  const oy = origin ? (origin.y ?? origin[1] ?? 0) : 0;
  if ((ox | 0) !== 0 || (oy | 0) !== 0) return;
  const srgb = String(texture.format || '').endsWith('-srgb');
  let src = pixels;
  let w = width;
  let h = height;
  for (let level = 1; level < levels && !(w === 1 && h === 1); level++) {
    const next = downsampleStored(src, w, h, srgb);
    const packed = packTextureRows(next.data, next.width, next.height);
    queue.writeTexture(
      { texture, mipLevel: level },
      packed.data,
      { bytesPerRow: packed.bytesPerRow, rowsPerImage: next.height },
      { width: next.width, height: next.height, depthOrArrayLayers: 1 },
    );
    src = next.data;
    w = next.width;
    h = next.height;
  }
  if (!mipWarned) {
    mipWarned = true;
    console.warn('[gpu] filling mipmaps on the CPU');
  }
}

function packTextureRows(pixels, width, height) {
  const tight = width * 4;
  const bytesPerRow = (tight + 255) & ~255;
  const src = pixels instanceof Uint8Array
    ? pixels
    : new Uint8Array(pixels.buffer, pixels.byteOffset, Math.min(pixels.byteLength, tight * height));
  if (bytesPerRow === tight && src.byteLength === tight * height) {
    return { data: src, bytesPerRow };
  }
  const out = new Uint8Array(bytesPerRow * height);
  const rowBytes = Math.min(tight, src.byteLength);
  for (let y = 0; y < height; y++) {
    const start = y * tight;
    if (start >= src.byteLength) break;
    out.set(src.subarray(start, Math.min(src.byteLength, start + rowBytes)), y * bytesPerRow);
  }
  return { data: out, bytesPerRow };
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Unpremultiplied RGBA for the source rectangle. Null when the image cannot
 * be drawn (no canvas, detached bitmap, tainted source).
 * @param {GPUCopyExternalImageSourceInfo} sourceInfo
 * @param {GPUExtent3D | number[]} copySize
 * @returns {Uint8ClampedArray | null}
 */
export function readExternalImagePixels(sourceInfo, copySize) {
  const image = sourceInfo?.source;
  const extent = externalImageExtent(copySize);
  if (!image || !extent) return null;
  const { width, height } = extent;
  const canvas = makeCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  if (!ctx) return null;
  const origin = origin2(sourceInfo.origin);
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(image, origin.x, origin.y, width, height, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

/**
 * @param {object} [queueProto]
 * @param {{ readPixels?: typeof readExternalImagePixels, warn?: () => void }} [options]
 * @returns {boolean} true the first time this prototype is patched
 */
export function installExternalImageUploadFallback(queueProto = globalThis.GPUQueue?.prototype, options = {}) {
  if (!queueProto || patched.has(queueProto)) return false;
  if (typeof queueProto.copyExternalImageToTexture !== 'function') return false;
  const readPixels = options.readPixels ?? readExternalImagePixels;
  const warn = options.warn ?? warnOnce;
  queueProto.copyExternalImageToTexture = function copyExternalImageToTexture(source, destination, copySize) {
    const straight = readPixels(source, copySize);
    const plan = externalImageWritePlan(straight, destination, copySize, !!source?.flipY);
    if (!plan || typeof this.writeTexture !== 'function') {
      throw new TypeError('Failed to copy content from external image');
    }
    this.writeTexture(plan.destination, plan.data, plan.dataLayout, plan.size);
    if (isLinuxGpu()) {
      writeCpuMipChain(this, plan.destination, plan.tight, plan.size.width, plan.size.height);
    }
    warn();
  };
  patched.add(queueProto);
  return true;
}

installExternalImageUploadFallback();
