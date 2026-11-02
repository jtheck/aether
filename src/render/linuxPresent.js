// Linux Vulkan can drop the device on Lite's mip render pass, and a lost
// WebGPU canvas presents white while the sim keeps running. That pass is
// skipped here; the mips were already written on the CPU. The swapchain
// texture itself is also unusable here: drawing it or copying it loses the
// device with "A valid external Instance reference no longer exists." The
// scene is drawn into a private texture and copied out after that frame's
// submits, onto a 2d canvas. The WebGPU canvas stays hidden: its swapchain
// image is white here and covers the page. Each copy uses a new buffer, and
// the next frame draws into the other texture until the copy finishes.
//
// `?present=cpu` forces this path on any OS so it can be checked locally.
// Nothing is stored on WebGPU objects; those reject new properties.

import { isLinuxGpu } from './gpuPlatform.js';

const watched = new WeakSet();
const configuredDevices = new WeakSet();
const mipViews = new WeakMap();
const contextDevices = new WeakMap();
const canvasConfigs = new WeakMap();
const mirrors = new WeakMap();
const sessions = new Set();

// Texture COPY_SRC is 0x1. Buffer COPY_DST is 0x8. MAP_READ is 0x1.
const TEX_COPY_SRC = 0x1;
const BUF_COPY_DST = 0x8;
const MAP_READ = 0x1;

let deviceLogInstalled = false;
let mipSkipInstalled = false;
let readbackInstalled = false;
let readbackWarned = false;
let readbackDead = false;
let nativeSubmit = null;

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
  device.addEventListener?.('uncapturederror', (event) => {
    const err = event.error;
    console.error('[gpu] uncaptured', err?.message || err);
  });
  device.lost?.then((info) => {
    // The boot probe calls destroy() on a device that never draws.
    if (!configuredDevices.has(device) && info?.reason === 'destroyed') return;
    console.error('[gpu] device lost', info?.reason || '', info?.message || '');
    if (configuredDevices.has(device)) stopReadback(info?.message || info?.reason);
  });
}

function stopReadback(reason) {
  if (readbackDead) return;
  readbackDead = true;
  console.error('[gpu] present readback stopped', reason || '');
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
        configuredDevices.add(config.device);
      }
      if (config) canvasConfigs.set(this, config);
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

function ensurePair(context, device) {
  const canvas = context.canvas;
  const width = canvas?.width | 0;
  const height = canvas?.height | 0;
  if (!device || width < 1 || height < 1) return null;
  const current = mirrors.get(context);
  if (current && current.device === device && current.width === width && current.height === height) {
    return current;
  }
  const cfg = canvasConfigs.get(context);
  const format = cfg?.format || globalThis.navigator?.gpu?.getPreferredCanvasFormat?.();
  if (!format) return null;
  const viewFormats = (cfg?.viewFormats || []).filter((entry) => entry && entry !== format);
  const usage = (globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10)
    | (globalThis.GPUTextureUsage?.COPY_SRC ?? TEX_COPY_SRC)
    | (globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x4);
  try {
    const textures = [0, 1].map((index) => device.createTexture({
      label: `present-mirror-${index}`,
      size: { width, height },
      format,
      usage,
      ...(viewFormats.length ? { viewFormats } : {}),
    }));
    const pair = { textures, device, width, height };
    mirrors.set(context, pair);
    return pair;
  } catch (err) {
    console.error('[gpu] present mirror failed', err?.message || err);
    return null;
  }
}

function sessionFor(context) {
  for (const session of sessions) {
    if (session.context === context) return session;
  }
  const session = {
    context,
    device: null,
    pair: null,
    rendering: 0,
    held: false,
    drawn: [false, false],
    busy: false,
    locked: -1,
    copyIndex: -1,
    copyQueued: false,
    ticket: 0,
    overlay: null,
    ctx2d: null,
    image: null,
    copyFailed: false,
    waitLogged: false,
  };
  sessions.add(session);
  return session;
}

function ensureOverlay(session) {
  if (session.overlay?.isConnected) return session.overlay;
  const overlay = document.createElement('canvas');
  overlay.id = 'gpu-present';
  overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9990;';
  document.body.appendChild(overlay);
  const src = session.context.canvas;
  if (src?.style) {
    src.style.opacity = '0';
    src.style.pointerEvents = 'auto';
  }
  session.overlay = overlay;
  session.ctx2d = overlay.getContext('2d', { alpha: false });
  if (session.ctx2d) session.ctx2d.imageSmoothingEnabled = false;
  return overlay;
}

function paint(session, src, width, height, bytesPerRow) {
  const overlay = ensureOverlay(session);
  if (!session.ctx2d) return;
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
    session.image = null;
  }
  if (!session.image) session.image = session.ctx2d.createImageData(width, height);
  const dst = session.image.data;
  const tight = width * 4;
  if (bytesPerRow === tight) dst.set(src.subarray(0, tight * height));
  else {
    for (let y = 0; y < height; y++) {
      dst.set(src.subarray(y * bytesPerRow, y * bytesPerRow + tight), y * tight);
    }
  }
  session.ctx2d.putImageData(session.image, 0, 0);
  if (!readbackWarned) {
    readbackWarned = true;
    console.warn('[gpu] presenting frames on an overlay');
  }
}

function noteCopyFailed(session, err) {
  if (session.copyFailed) return;
  session.copyFailed = true;
  console.error('[gpu] present copy failed', err?.message || err);
}

const BLIT_WGSL = `
struct V { @builtin(position) p: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0))[i];
  return V(vec4f(p, 0.0, 1.0));
}
@group(0) @binding(0) var t: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return textureLoad(t, vec2i(p.xy), 0);
}
`;

const blitPipelines = new WeakMap();

function blitPipeline(device) {
  let pipeline = blitPipelines.get(device);
  if (pipeline) return pipeline;
  const module = device.createShaderModule({ label: 'present-blit', code: BLIT_WGSL });
  pipeline = device.createRenderPipeline({
    label: 'present-blit',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  blitPipelines.set(device, pipeline);
  return pipeline;
}

function ensureRgba(session, width, height) {
  const current = session.rgba;
  if (current && current.width === width && current.height === height) return current.texture;
  const texture = session.device.createTexture({
    label: 'present-rgba',
    size: { width, height },
    format: 'rgba8unorm',
    usage: (globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10)
      | (globalThis.GPUTextureUsage?.COPY_SRC ?? TEX_COPY_SRC),
  });
  session.rgba = { texture, width, height };
  return texture;
}

function encodeCopy(session, texture) {
  const device = session.device;
  const width = texture?.width | 0;
  const height = texture?.height | 0;
  const copySrc = globalThis.GPUTextureUsage?.COPY_SRC ?? TEX_COPY_SRC;
  if (!device || width < 1 || height < 1 || (texture.usage & copySrc) === 0) return null;
  const bytesPerRow = (width * 4 + 255) & ~255;
  let buffer = null;
  try {
    const rgba = ensureRgba(session, width, height);
    const pipeline = blitPipeline(device);
    buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: (globalThis.GPUBufferUsage?.COPY_DST ?? BUF_COPY_DST)
        | (globalThis.GPUBufferUsage?.MAP_READ ?? MAP_READ),
    });
    const encoder = device.createCommandEncoder({ label: 'present-copy' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: rgba.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture.createView() }],
    }));
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: rgba },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    return {
      session,
      command: encoder.finish(),
      buffer,
      width,
      height,
      bytesPerRow,
      ticket: session.ticket,
    };
  } catch (err) {
    try { buffer?.destroy(); } catch { /* create failed first */ }
    throw err;
  }
}

function finishCopy(session, ticket) {
  if (session.ticket !== ticket) return;
  session.busy = false;
  session.locked = -1;
  if (session.copyIndex >= 0) scheduleCopy(session);
}

function mapCopy(job) {
  const session = job.session;
  const mode = globalThis.GPUMapMode?.READ ?? MAP_READ;
  const timer = setTimeout(() => {
    if (session.ticket !== job.ticket || session.waitLogged) return;
    session.waitLogged = true;
    console.error('[gpu] present copy still waiting');
  }, 5000);
  let pending;
  try {
    pending = job.buffer.mapAsync(mode);
  } catch (err) {
    clearTimeout(timer);
    try { job.buffer.destroy(); } catch { /* already gone */ }
    noteCopyFailed(session, err);
    finishCopy(session, job.ticket);
    return;
  }
  pending.then(() => {
    clearTimeout(timer);
    const src = new Uint8Array(job.buffer.getMappedRange());
    try {
      paint(session, src, job.width, job.height, job.bytesPerRow);
    } finally {
      job.buffer.unmap();
    }
  }, (err) => {
    noteCopyFailed(session, err);
  }).finally(() => {
    clearTimeout(timer);
    try { job.buffer.destroy(); } catch { /* already gone */ }
    finishCopy(session, job.ticket);
  });
}

function scheduleCopy(session) {
  if (session.copyQueued || session.busy || session.copyIndex < 0 || readbackDead) return;
  session.copyQueued = true;
  setTimeout(() => {
    session.copyQueued = false;
    if (session.busy || session.copyIndex < 0 || readbackDead || !nativeSubmit) return;
    const texture = session.pair?.textures?.[session.copyIndex];
    if (!texture) return;
    let job = null;
    try {
      session.ticket = (session.ticket + 1) >>> 0;
      job = encodeCopy(session, texture);
    } catch (err) {
      noteCopyFailed(session, err);
      return;
    }
    if (!job) return;
    const index = session.copyIndex;
    session.copyIndex = -1;
    session.busy = true;
    session.locked = index;
    try {
      nativeSubmit.call(session.device.queue, [job.command]);
    } catch (err) {
      session.busy = false;
      session.locked = -1;
      try { job.buffer.destroy(); } catch { /* not submitted */ }
      noteCopyFailed(session, err);
      return;
    }
    mapCopy(job);
  }, 0);
}

function installReadback() {
  if (readbackInstalled) return;
  const contextProto = globalThis.GPUCanvasContext?.prototype;
  const queueProto = globalThis.GPUQueue?.prototype;
  if (!contextProto?.getCurrentTexture || !queueProto?.submit) return;
  readbackInstalled = true;
  const origGet = contextProto.getCurrentTexture;
  contextProto.getCurrentTexture = function getCurrentTexture() {
    if (!isGameCanvas(this.canvas)) return origGet.call(this);
    const device = contextDevices.get(this) || null;
    const pair = device && ensurePair(this, device);
    if (!pair) return mirrors.get(this)?.textures?.[0] || origGet.call(this);
    const session = sessionFor(this);
    session.device = device;
    if (session.pair !== pair) {
      session.pair = pair;
      session.drawn = [false, false];
      session.rendering = 0;
      session.held = false;
      session.locked = -1;
      session.copyIndex = -1;
      session.ticket = (session.ticket + 1) >>> 0;
      session.busy = false;
    }
    if (!session.held) {
      let index = session.rendering ^ 1;
      if (session.busy && index === session.locked) index ^= 1;
      session.rendering = index;
      session.held = true;
    }
    return pair.textures[session.rendering];
  };
  const origSubmit = queueProto.submit;
  nativeSubmit = origSubmit;
  queueProto.submit = function submit(buffers) {
    for (const session of sessions) {
      if (!session.held || session.device?.queue !== this) continue;
      session.held = false;
      session.copyIndex = session.rendering;
      scheduleCopy(session);
    }
    return origSubmit.call(this, buffers);
  };
}

installDeviceLog();
if (isLinuxGpu()) installMipSkip();
if (readbackEnabled()) installReadback();
