// In-scene confirm mark — a camera-facing "1^" that hovers at a world point.
// Used first for parked building placement; same widget can confirm other
// parked actions later. Hit test is screen-space so a finger can still land it.

import {
  addToScene,
  createDefaultTextData,
  createMeshFromData,
  createShaderMaterial,
  createTextLayer,
  createTextRenderer,
  disposeDefaultTextData,
  disposeTextRenderer,
  registerTextRenderer,
  setShaderUniform,
  setSubtreeVisible,
  updateDefaultTextData,
} from '../vendor/lite/liteVendor.js';

export const SCENE_CONFIRM_LABEL = '1^';
/** Screen offset above the projected world point (CSS px, y-down). */
export const SCENE_CONFIRM_LIFT_PX = 42;
export const SCENE_CONFIRM_SIZE_PX = 52;
export const SCENE_CONFIRM_HIT_PX = 30;
/** Sit this far above ground before projecting. */
export const SCENE_CONFIRM_WORLD_LIFT = 3.4;
const ICON_DEPTH = 0.8;
const HUD_RENDER_ORDER = 430;
const HOVER_LERP = 14;
const HOVER_SCALE = 0.1;
const LABEL_FONT_SIZE = 26;
const LABEL_SCREEN_SCALE = 0.82;
const LABEL_COLOR_OK = [0.93, 0.95, 0.98, 1];
const LABEL_COLOR_BAD = [0.95, 0.62, 0.58, 1];

/**
 * World point the mark tracks (center of the thing being confirmed).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} [lift]
 */
export function sceneConfirmWorldPos(x, y, z, lift = SCENE_CONFIRM_WORLD_LIFT) {
  return { x, y: y + lift, z };
}

/**
 * Canvas-local position of the mark from a projected world point.
 * @param {{ x: number, y: number } | null | undefined} scr
 * @param {number} [liftPx]
 */
export function sceneConfirmCanvasPos(scr, liftPx = SCENE_CONFIRM_LIFT_PX) {
  if (!scr || !Number.isFinite(scr.x) || !Number.isFinite(scr.y)) return null;
  return { x: scr.x, y: scr.y - liftPx };
}

/**
 * Circular hit around the mark's canvas position.
 * @param {{ x: number, y: number } | null | undefined} canvas
 * @param {number} px
 * @param {number} py
 * @param {number} [radiusPx]
 */
export function sceneConfirmHitAt(canvas, px, py, radiusPx = SCENE_CONFIRM_HIT_PX) {
  if (!canvas || !Number.isFinite(canvas.x) || !Number.isFinite(canvas.y)) return false;
  const dx = px - canvas.x;
  const dy = py - canvas.y;
  return dx * dx + dy * dy <= radiusPx * radiusPx;
}

function cameraEye(camera) {
  const wm = camera?.worldMatrix;
  if (wm && Number.isFinite(wm[12]) && Number.isFinite(wm[13]) && Number.isFinite(wm[14])) {
    return { x: wm[12], y: wm[13], z: wm[14] };
  }
  const p = camera?.position;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
    return { x: p.x, y: p.y, z: p.z };
  }
  return { x: 0, y: 40, z: 0 };
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

function makeDiscMesh(engine) {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(
    engine,
    'scene-confirm',
    positions,
    normals,
    indices,
    uvs,
  );
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = HUD_RENDER_ORDER;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  return mesh;
}

function makeDiscMaterial() {
  return createShaderMaterial({
    name: 'scene-confirm-disc',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'tint', type: 'vec3<f32>', defaultValue: [0.86, 0.9, 0.96] },
      { name: 'glow', type: 'f32', defaultValue: 0 },
    ],
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
  let p = input.uv * 2.0 - 1.0;
  let d = length(p);
  let fill = 1.0 - smoothstep(0.78, 0.86, d);
  let rim = smoothstep(0.62, 0.70, d) * (1.0 - smoothstep(0.86, 0.94, d));
  let alpha = max(fill * 0.42, rim * (0.82 + shaderUniforms.glow * 0.18));
  if (alpha < 0.02) { discard; }
  let wash = shaderUniforms.tint * (0.72 + shaderUniforms.glow * 0.28);
  return vec4<f32>(wash * alpha, alpha);
}`,
  });
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {{
 *   font?: object,
 *   worldToScreen?: Function,
 *   rayFromCanvas?: Function,
 *   getViewport?: Function,
 *   getPointerCanvas?: Function,
 *   canvas?: HTMLCanvasElement,
 * }} screen
 */
export function createSceneConfirm(engine, scene, screen) {
  const mesh = makeDiscMesh(engine);
  const mat = makeDiscMaterial();
  mesh.material = mat;
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);

  /** @type {{ data: object, layer: object, text: string } | null} */
  let caption = null;
  let textRenderer = null;
  let textRendererRegistered = false;
  let labelsDisposed = false;

  /** @type {{ x: number, y: number, z: number, valid: boolean } | null} */
  let target = null;
  /** @type {{ x: number, y: number } | null} */
  let hitCanvas = null;
  let hoverT = 0;
  let lastHoverMs = 0;
  let visible = false;

  function hideCaption() {
    if (!caption) return;
    caption.layer.opacity = 0;
    caption.layer.visible = false;
    caption.layer._version++;
  }

  function hide() {
    hitCanvas = null;
    hoverT = 0;
    if (visible) {
      setSubtreeVisible(mesh, false);
      if (mesh.position) mesh.position.y = -9999;
      mesh.markLocalDirty?.();
      visible = false;
    }
    hideCaption();
  }

  function ensureText() {
    if (caption || labelsDisposed || !screen.font) return;
    try {
      const data = createDefaultTextData(
        screen.font,
        LABEL_FONT_SIZE,
        SCENE_CONFIRM_LABEL,
        LABEL_COLOR_OK,
        { align: 'center' },
      );
      const layer = createTextLayer(data, { order: 0, opacity: 0, visible: false });
      caption = { data, layer, text: SCENE_CONFIRM_LABEL };
      textRenderer = createTextRenderer(engine, { layers: [layer], clear: false });
    } catch (err) {
      console.warn('[sceneConfirm] native label unavailable', err);
      caption = null;
      textRenderer = null;
    }
  }

  function placeCaption(px, py, scale, opacity, sx, sy, valid) {
    if (!caption) return;
    const color = valid ? LABEL_COLOR_OK : LABEL_COLOR_BAD;
    if (caption.text !== SCENE_CONFIRM_LABEL) {
      caption.text = SCENE_CONFIRM_LABEL;
    }
    updateDefaultTextData(caption.data, SCENE_CONFIRM_LABEL, color);
    const centerOffset = caption.data.width * scale * 0.5;
    caption.layer.positionPx.x = px * sx - centerOffset;
    caption.layer.positionPx.y = py * sy;
    caption.layer.rotationRad = 0;
    caption.layer.scale = scale;
    caption.layer.opacity = opacity;
    caption.layer.visible = true;
    caption.layer._version++;
  }

  /**
   * @param {{ x: number, y?: number, z: number, valid?: boolean } | null | undefined} pos
   */
  function set(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
      target = null;
      hide();
      return;
    }
    target = {
      x: pos.x,
      y: Number.isFinite(pos.y) ? pos.y : 0,
      z: pos.z,
      valid: pos.valid !== false,
    };
  }

  function pick(px, py) {
    return sceneConfirmHitAt(hitCanvas, px, py);
  }

  function update(camera) {
    ensureText();
    if (!target) {
      hide();
      return;
    }
    const vp = screen.getViewport?.();
    const worldToScreen = screen.worldToScreen;
    if (!vp || !worldToScreen || !screen.rayFromCanvas) {
      hide();
      return;
    }
    const vw = vp.width;
    const vh = vp.height;
    if (vw < 8 || vh < 8) {
      hide();
      return;
    }

    const world = sceneConfirmWorldPos(target.x, target.y, target.z);
    const canvas = sceneConfirmCanvasPos(worldToScreen(world.x, world.y, world.z));
    if (!canvas) {
      hide();
      return;
    }
    hitCanvas = canvas;

    const now = performance.now();
    const dt = lastHoverMs ? Math.min(0.05, (now - lastHoverMs) * 0.001) : 0.016;
    lastHoverMs = now;
    const ptr = screen.getPointerCanvas?.();
    const hovering = !!(ptr && sceneConfirmHitAt(canvas, ptr.x, ptr.y));
    hoverT += ((hovering ? 1 : 0) - hoverT) * Math.min(1, dt * HOVER_LERP);

    const ray = screen.rayFromCanvas(canvas.x, canvas.y);
    const rayR = screen.rayFromCanvas(canvas.x + 1, canvas.y);
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

    const eye = cameraEye(camera);
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

    const tint = target.valid ? [0.86, 0.9, 0.96] : [0.9, 0.42, 0.38];
    setShaderUniform(mat, 'tint', tint);
    setShaderUniform(mat, 'glow', hoverT);

    const s = SCENE_CONFIRM_SIZE_PX * pixel * (1 + hoverT * HOVER_SCALE);
    if (mesh.position) {
      mesh.position.x = wx;
      mesh.position.y = wy;
      mesh.position.z = wz;
    }
    if (mesh.scaling) {
      mesh.scaling.x = s;
      mesh.scaling.y = s;
      mesh.scaling.z = s;
    }
    setQuat(mesh, quatFromBasis(rgtX, rgtY, rgtZ, upX, upY, upZ, fx, fy, fz));
    setSubtreeVisible(mesh, true);
    mesh.markLocalDirty?.();
    visible = true;

    const sx = (vp.pixelWidth ?? vw) / vw;
    const sy = (vp.pixelHeight ?? vh) / vh;
    const scale = LABEL_SCREEN_SCALE * (1 + hoverT * 0.08);
    placeCaption(canvas.x, canvas.y, scale, 0.94, sx, sy, target.valid);
  }

  function registerLabels() {
    if (!textRenderer || textRendererRegistered || labelsDisposed) return;
    registerTextRenderer(textRenderer);
    textRendererRegistered = true;
  }

  function disposeLabels() {
    if (labelsDisposed) return;
    labelsDisposed = true;
    hide();
    if (textRenderer) disposeTextRenderer(textRenderer);
    textRenderer = null;
    textRendererRegistered = false;
    if (caption) disposeDefaultTextData(caption.data);
    caption = null;
  }

  return {
    set,
    update,
    pick,
    clear: hide,
    registerLabels,
    disposeLabels,
    ensureText,
  };
}
