// Linux Vulkan can drop the device on Lite's mip render pass, and a lost
// WebGPU canvas presents white while the sim keeps running. That pass is
// skipped here; the mips were already written on the CPU. The same machines
// also fail to composite the swapchain, so the frame is copied out and drawn
// onto a 2d canvas above it.
//
// `?present=cpu` forces the readback on any OS so it can be checked locally.
// Nothing is stored on WebGPU objects; those reject new properties.

import { isLinuxGpu } from './gpuPlatform.js';

const queues = new WeakMap();
const watched = new WeakSet();
const mipViews = new WeakMap();
const contextDevices = new WeakMap();
const sessions = new Set();

const COPY_SRC = 0x4;
const COPY_DST = 0x8;
const MAP_READ = 0x1;

let deviceLogInstalled = false;
let mipSkipInstalled = false;
let guardsInstalled = false;
let readbackInstalled = false;
let inReadback = false;
let readbackWarned = false;

function readbackEnabled() {
  if (isLinuxGpu()) return true;
  try {
    return /(?:^|[?&])present=cpu(?:&|$)/.test(globalThis.location?.search || '');
  } catch {
    return false;
  }
}

function isGameCanvas(canvas) {
  if (!canvas || canvas.id !== 'canvas') return false;
  const path = globalThis.location?.pathname || '/';
  return path === '/' || path === '/index.html';
}

function watchDevice(device) {
  if (!device || watched.has(device)) return;
  watched.add(device);
  if (device.queue) queues.set(device.queue, device);
  device.addEventListener?.('uncapturederror', (event) => {
    const err = event.error;
    console.error('[gpu] uncaptured', err?.message || err);
  });
  device.lost?.then((info) => {
    console.error('[gpu] device lost', info?.reason || '', info?.message || '');
  });
}

function installDeviceLog() {
  if (deviceLogInstalled) return;
  deviceLogInstalled = true;
  const adapterProto = globalThis.GPUAdapter?.prototype;
  if (adapterProto && typeof adapterProto.requestDevice === 'function') {
    const orig = adapterProto.requestDevice;
    adapterProto.requestDevice = function requestDevice(...args) {
      return Promise.resolve(orig.apply(this, args)).then((device) => {
        watchDevice(device);
        return device;
      });
    };
  }
  const contextProto = globalThis.GPUCanvasContext?.prototype;
  if (contextProto && typeof contextProto.configure === 'function') {
    const orig = contextProto.configure;
    contextProto.configure = function configure(config) {
      if (config?.device) {
        watchDevice(config.device);
        contextDevices.set(this, config.device);
      }
      return orig.call(this, config);
    };
  }
}

function installMipSkip() {
  if (mipSkipInstalled) return;
  const texProto = globalThis.GPUTexture?.prototype;
  const encProto = globalThis.GPUCommandEncoder?.prototype;
  if (!texProto?.createView || !encProto?.beginRenderPass) return;
  mipSkipInstalled = true;
  const origView = texProto.createView;
  texProto.createView = function createView(desc) {
    const view = origView.call(this, desc);
    const level = desc?.baseMipLevel | 0;
    if (level > 0) mipViews.set(view, level);
    return view;
  };
  const origBegin = encProto.beginRenderPass;
  const dummy = {
    setPipeline() {},
    setBindGroup() {},
    setVertexBuffer() {},
    setIndexBuffer() {},
    setViewport() {},
    setScissorRect() {},
    draw() {},
    drawIndexed() {},
    drawIndirect() {},
    end() {},
  };
  encProto.beginRenderPass = function beginRenderPass(desc) {
    const colors = desc?.colorAttachments;
    const view = colors?.[0]?.view;
    if (view && mipViews.get(view) > 0 && colors.length === 1 && !desc.depthStencilAttachment) {
      return dummy;
    }
    return origBegin.call(this, desc);
  };
}

function guardQueueMethod(proto, name) {
  const orig = proto[name];
  if (typeof orig !== 'function') return;
  proto[name] = function guarded(...args) {
    const device = queues.get(this);
    if (!device?.pushErrorScope) return orig.apply(this, args);
    let scoped = false;
    try {
      device.pushErrorScope('validation');
      scoped = true;
    } catch {
      /* device already lost */
    }
    try {
      return orig.apply(this, args);
    } finally {
      if (scoped) {
        device.popErrorScope().then((err) => {
          if (err) console.error(`[gpu] ${name} rejected`, err.message);
        }, () => {});
      }
    }
  };
}

function installQueueGuards() {
  if (guardsInstalled) return;
  const queueProto = globalThis.GPUQueue?.prototype;
  if (!queueProto?.submit) return;
  guardsInstalled = true;
  guardQueueMethod(queueProto, 'writeTexture');
  guardQueueMethod(queueProto, 'writeBuffer');
  const origSubmit = queueProto.submit;
  queueProto.submit = function submit(buffers) {
    if (inReadback) return origSubmit.call(this, buffers);
    const device = queues.get(this);
    let scoped = false;
    if (device?.pushErrorScope) {
      try {
        device.pushErrorScope('validation');
        scoped = true;
      } catch {
        scoped = false;
      }
    }
    try {
      return origSubmit.call(this, buffers);
    } finally {
      if (scoped) {
        device.popErrorScope().then((err) => {
          if (err) console.error('[gpu] submit rejected', err.message);
        }, () => {});
      }
    }
  };
}

function sessionFor(context) {
  for (const session of sessions) {
    if (session.context === context) return session;
  }
  const session = {
    context,
    device: null,
    texture: null,
    dirty: false,
    busy: false,
    buffer: null,
    overlay: null,
    ctx2d: null,
    image: null,
  };
  sessions.add(session);
  return session;
}

function ensureOverlay(session) {
  if (session.overlay?.isConnected) return session.overlay;
  const overlay = document.createElement('canvas');
  overlay.id = 'gpu-present';
  overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  document.body.appendChild(overlay);
  const src = session.context.canvas;
  if (src?.style) {
    if (!src.style.position) src.style.position = 'relative';
    src.style.zIndex = '0';
  }
  session.overlay = overlay;
  session.ctx2d = overlay.getContext('2d', { alpha: false });
  if (session.ctx2d) session.ctx2d.imageSmoothingEnabled = false;
  return overlay;
}

function paint(session, src, width, height, bytesPerRow, format) {
  const overlay = ensureOverlay(session);
  if (!session.ctx2d) return;
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
    session.image = null;
  }
  if (!session.image) session.image = session.ctx2d.createImageData(width, height);
  const dst = session.image.data;
  const bgra = String(format).startsWith('bgra');
  if (!bgra && bytesPerRow === width * 4) {
    dst.set(src.subarray(0, width * height * 4));
  } else {
    const s32 = new Uint32Array(src.buffer, src.byteOffset, src.byteLength >> 2);
    const d32 = new Uint32Array(dst.buffer, dst.byteOffset, dst.byteLength >> 2);
    const srcStride = bytesPerRow >> 2;
    for (let y = 0; y < height; y++) {
      const row = y * srcStride;
      const out = y * width;
      if (!bgra) {
        for (let x = 0; x < width; x++) d32[out + x] = s32[row + x];
      } else {
        for (let x = 0; x < width; x++) {
          const v = s32[row + x];
          d32[out + x] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v & 0x00ff0000) >> 16);
        }
      }
    }
  }
  session.ctx2d.putImageData(session.image, 0, 0);
  if (!readbackWarned) {
    readbackWarned = true;
    console.warn('[gpu] presenting frames through a readback');
  }
}

function copyTexture(session, texture) {
  const device = session.device;
  const width = texture.width | 0;
  const height = texture.height | 0;
  if (!device || width < 1 || height < 1 || (texture.usage & COPY_SRC) === 0) {
    session.busy = false;
    return;
  }
  const bytesPerRow = (width * 4 + 255) & ~255;
  const size = bytesPerRow * height;
  if (!session.buffer || session.buffer.size !== size) {
    try { session.buffer?.destroy(); } catch { /* already gone */ }
    try {
      session.buffer = device.createBuffer({
        size,
        usage: (globalThis.GPUBufferUsage?.COPY_DST ?? COPY_DST) | (globalThis.GPUBufferUsage?.MAP_READ ?? MAP_READ),
      });
    } catch (err) {
      console.error('[gpu] present readback buffer failed', err?.message || err);
      session.buffer = null;
      session.busy = false;
      return;
    }
  }
  const buffer = session.buffer;
  let command;
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    command = encoder.finish();
  } catch (err) {
    console.error('[gpu] present readback failed', err?.message || err);
    session.busy = false;
    return;
  }
  let scoped = false;
  try {
    if (device.pushErrorScope) {
      device.pushErrorScope('validation');
      scoped = true;
    }
    inReadback = true;
    device.queue.submit([command]);
  } catch (err) {
    console.error('[gpu] present readback failed', err?.message || err);
    session.busy = false;
    if (scoped) device.popErrorScope().catch(() => {});
    return;
  } finally {
    inReadback = false;
  }
  const finish = () => {
    const mode = globalThis.GPUMapMode?.READ ?? MAP_READ;
    return buffer.mapAsync(mode).then(() => {
      const src = new Uint8Array(buffer.getMappedRange());
      try {
        paint(session, src, width, height, bytesPerRow, texture.format);
      } finally {
        buffer.unmap();
      }
    });
  };
  const done = scoped
    ? device.popErrorScope().then((err) => {
      if (err) throw err;
      return finish();
    })
    : finish();
  done.catch((err) => {
    console.error('[gpu] present readback failed', err?.message || err);
  }).finally(() => {
    session.busy = false;
  });
}

function startReadbacks(queue) {
  for (const session of sessions) {
    if (!session.dirty || session.busy) continue;
    if (session.device?.queue !== queue) continue;
    if (!session.texture) continue;
    session.dirty = false;
    session.busy = true;
    copyTexture(session, session.texture);
  }
}

function installReadback() {
  if (readbackInstalled) return;
  const contextProto = globalThis.GPUCanvasContext?.prototype;
  const queueProto = globalThis.GPUQueue?.prototype;
  if (!contextProto?.getCurrentTexture || !queueProto?.submit) return;
  readbackInstalled = true;
  const origGet = contextProto.getCurrentTexture;
  contextProto.getCurrentTexture = function getCurrentTexture() {
    const texture = origGet.call(this);
    if (isGameCanvas(this.canvas)) {
      const session = sessionFor(this);
      session.device = contextDevices.get(this) || null;
      session.texture = texture;
      session.dirty = true;
    }
    return texture;
  };
  const origSubmit = queueProto.submit;
  queueProto.submit = function submit(buffers) {
    if (inReadback) return origSubmit.call(this, buffers);
    try {
      return origSubmit.call(this, buffers);
    } finally {
      startReadbacks(this);
    }
  };
}

installDeviceLog();
if (isLinuxGpu()) {
  installMipSkip();
  installQueueGuards();
}
if (readbackEnabled()) installReadback();
