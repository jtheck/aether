// Drag-select marquee — clip-space overlay in the game pass (not DOM).
// Static 10 quads (4 hatch rims + edges + plus). Hatch frays inward; the deep
// center is not drawn. Tight AABB on the camera so a giant volume does not
// disturb fog / tree dim.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  setShaderUniform,
  setSubtreeVisible,
} from '../vendor/lite/liteVendor.js';

const RENDER_ORDER = 500;
const INK = [70 / 255, 230 / 255, 110 / 255, 1];
const FILL_INK = [70 / 255, 230 / 255, 110 / 255, 0.12];
const STROKE_PX = 1;
const MARK_ARM_PX = 8;
const MARK_THICK_PX = 1;
const MARK_GAP_PX = 8;
const RIM_PX = 48;
const CUT_PX = MARK_ARM_PX + MARK_GAP_PX;
const QUADS = 10;
const VERTS = QUADS * 4;

/** Canvas-local axis-aligned box → NDC (Y up). */
export function canvasRectToNdc(minX, minY, maxX, maxY, width, height) {
  const w = Math.max(width, 1e-6);
  const h = Math.max(height, 1e-6);
  return {
    left: (minX / w) * 2 - 1,
    right: (maxX / w) * 2 - 1,
    top: 1 - (minY / h) * 2,
    bottom: 1 - (maxY / h) * 2,
  };
}

/** UV corner (0 or 1) nearest the live pointer. v=0 is the canvas top. */
export function activeCornerUv(minX, minY, maxX, maxY, ax, ay) {
  return {
    u: Math.abs(ax - maxX) <= Math.abs(ax - minX) ? 1 : 0,
    v: Math.abs(ay - maxY) <= Math.abs(ay - minY) ? 1 : 0,
  };
}

function makeMaterial() {
  return createShaderMaterial({
    name: 'selection-box',
    attributes: ['position', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'ndcMin', type: 'vec2<f32>', defaultValue: [0, 0] },
      { name: 'ndcMax', type: 'vec2<f32>', defaultValue: [0, 0] },
      { name: 'liveUv', type: 'vec2<f32>', defaultValue: [1, 1] },
      { name: 'sizePx', type: 'vec2<f32>', defaultValue: [1, 1] },
      { name: 'ink', type: 'vec4<f32>', defaultValue: INK },
      { name: 'fillInk', type: 'vec4<f32>', defaultValue: FILL_INK },
    ],
    needAlphaBlending: true,
    blendMode: 'alpha',
    depthWrite: false,
    depthCompare: 'always',
    backFaceCulling: false,
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) qid: f32,
  @location(1) uv: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let qid = u32(input.uv.x + 0.5);
  out.qid = input.uv.x;
  let lx = input.position.x;
  let ly = input.position.y;
  let size = shaderUniforms.sizePx;
  let e = vec2<f32>(${STROKE_PX}.0, ${STROKE_PX}.0) / size;
  let cut = vec2<f32>(${CUT_PX}.0, ${CUT_PX}.0) / size;
  let ru = min(${RIM_PX}.0 / size.x, 0.5);
  let rv = min(${RIM_PX}.0 / size.y, 0.5);
  let cu = shaderUniforms.liveUv.x;
  let cv = shaderUniforms.liveUv.y;
  var u0 = 0.0;
  var v0 = 0.0;
  var u1 = 1.0;
  var v1 = 1.0;
  if (qid == 0u) {
    u0 = 0.0; u1 = ru; v0 = 0.0; v1 = 1.0;
  } else if (qid == 1u) {
    u0 = 1.0 - ru; u1 = 1.0; v0 = 0.0; v1 = 1.0;
  } else if (qid == 2u) {
    u0 = ru; u1 = 1.0 - ru; v0 = 0.0; v1 = rv;
  } else if (qid == 3u) {
    u0 = ru; u1 = 1.0 - ru; v0 = 1.0 - rv; v1 = 1.0;
  } else if (qid == 4u) {
    u0 = -e.x * 0.5; u1 = e.x * 0.5; v0 = -e.y * 0.5; v1 = 1.0 + e.y * 0.5;
    if (cu < 0.5) {
      if (cv < 0.5) { v0 = min(cut.y, v1); } else { v1 = max(1.0 - cut.y, v0); }
    }
  } else if (qid == 5u) {
    u0 = 1.0 - e.x * 0.5; u1 = 1.0 + e.x * 0.5; v0 = -e.y * 0.5; v1 = 1.0 + e.y * 0.5;
    if (cu > 0.5) {
      if (cv < 0.5) { v0 = min(cut.y, v1); } else { v1 = max(1.0 - cut.y, v0); }
    }
  } else if (qid == 6u) {
    u0 = -e.x * 0.5; u1 = 1.0 + e.x * 0.5; v0 = -e.y * 0.5; v1 = e.y * 0.5;
    if (cv < 0.5) {
      if (cu < 0.5) { u0 = min(cut.x, u1); } else { u1 = max(1.0 - cut.x, u0); }
    }
  } else if (qid == 7u) {
    u0 = -e.x * 0.5; u1 = 1.0 + e.x * 0.5; v0 = 1.0 - e.y * 0.5; v1 = 1.0 + e.y * 0.5;
    if (cv > 0.5) {
      if (cu < 0.5) { u0 = min(cut.x, u1); } else { u1 = max(1.0 - cut.x, u0); }
    }
  } else if (qid == 8u) {
    let armU = ${MARK_ARM_PX}.0 / size.x;
    let thV = ${MARK_THICK_PX}.0 / size.y;
    u0 = cu - armU;
    u1 = cu + armU - 1.0 / size.x;
    v0 = cv - thV * 0.5; v1 = cv + thV * 0.5;
  } else {
    let thU = ${MARK_THICK_PX}.0 / size.x;
    let armV = ${MARK_ARM_PX}.0 / size.y;
    u0 = cu - thU * 0.5; u1 = cu + thU * 0.5;
    v0 = cv - armV;
    v1 = cv + armV - 1.0 / size.y;
  }
  let u = mix(u0, u1, lx);
  let v = mix(v0, v1, ly);
  out.uv = vec2<f32>(u, v);
  out.position = vec4<f32>(
    mix(shaderUniforms.ndcMin.x, shaderUniforms.ndcMax.x, u),
    mix(shaderUniforms.ndcMin.y, shaderUniforms.ndcMax.y, v),
    0.999,
    1.0,
  );
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) qid: f32,
  @location(1) uv: vec2<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.qid < 3.5) {
    let px = vec2<u32>(input.position.xy);
    let onA = ((px.x + px.y) & 7u) == 0u;
    let onB = ((px.x - px.y) & 7u) == 0u;
    if (!onA && !onB) {
      discard;
    }
    let du = min(input.uv.x, 1.0 - input.uv.x);
    let dv = min(input.uv.y, 1.0 - input.uv.y);
    let edgePx = min(du * shaderUniforms.sizePx.x, dv * shaderUniforms.sizePx.y);
    var keep = false;
    if (onA) {
      let idA = (px.x + px.y) >> 3u;
      let deep = (idA & 3u) == 0u;
      let reach = select(4.0 + f32((idA * 17u) & 11u), 14.0 + f32((idA * 13u) & 31u), deep);
      keep = edgePx <= reach;
    }
    if (onB && !keep) {
      let idB = (px.x - px.y) >> 3u;
      let deep = (idB & 3u) == 0u;
      let reach = select(4.0 + f32((idB * 29u) & 11u), 14.0 + f32((idB * 19u) & 31u), deep);
      keep = edgePx <= reach;
    }
    if (!keep) {
      discard;
    }
    return shaderUniforms.fillInk;
  }
  return shaderUniforms.ink;
}`,
  });
}

function makeMesh(engine) {
  const positions = new Float32Array(VERTS * 3);
  const normals = new Float32Array(VERTS * 3);
  const uvs = new Float32Array(VERTS * 2);
  const indices = new Uint32Array(QUADS * 6);
  for (let q = 0; q < QUADS; q++) {
    const v = q * 4;
    const po = v * 3;
    const uo = v * 2;
    positions[po] = 0;
    positions[po + 1] = 0;
    positions[po + 3] = 1;
    positions[po + 4] = 0;
    positions[po + 6] = 1;
    positions[po + 7] = 1;
    positions[po + 9] = 0;
    positions[po + 10] = 1;
    for (let k = 0; k < 4; k++) {
      normals[(v + k) * 3 + 2] = 1;
      uvs[uo + k * 2] = q;
    }
    const t = q * 6;
    indices[t] = v;
    indices[t + 1] = v + 1;
    indices[t + 2] = v + 2;
    indices[t + 3] = v;
    indices[t + 4] = v + 2;
    indices[t + 5] = v + 3;
  }
  const mesh = createMeshFromData(engine, 'selection-box', positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = RENDER_ORDER;
  mesh.boundMin = [-2, -2, -2];
  mesh.boundMax = [2, 2, 2];
  return mesh;
}

function poseOnCamera(mesh, camera, last) {
  const wm = camera?.worldMatrix;
  let x;
  let y;
  let z;
  if (wm && Number.isFinite(wm[12])) {
    x = wm[12];
    y = wm[13];
    z = wm[14];
  } else {
    const p = camera?.position;
    if (!p || !mesh.position) return;
    x = p.x;
    y = p.y;
    z = p.z;
  }
  if (x === last.x && y === last.y && z === last.z) return;
  last.x = x;
  last.y = y;
  last.z = z;
  mesh.position.x = x;
  mesh.position.y = y;
  mesh.position.z = z;
  mesh.markLocalDirty?.();
}

/**
 * @param {object} engine
 * @param {object} scene
 */
export function createSelectionBoxOverlay(engine, scene) {
  const mesh = makeMesh(engine);
  const mat = makeMaterial();
  mesh.material = mat;
  addToScene(scene, mesh);
  setSubtreeVisible(mesh, false);

  const camPose = { x: NaN, y: NaN, z: NaN };
  let lastMinX = NaN;
  let lastMinY = NaN;
  let lastMaxX = NaN;
  let lastMaxY = NaN;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastAx = NaN;
  let lastAy = NaN;

  function hide() {
    lastMinX = NaN;
    camPose.x = NaN;
    if (!mesh.visible) return;
    setSubtreeVisible(mesh, false);
  }

  /**
   * Axis-aligned box in canvas CSS pixels (Y down). `ax`/`ay` is the live corner.
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @param {number} width
   * @param {number} height
   * @param {number} ax
   * @param {number} ay
   * @param {object} [camera]
   */
  function showCanvasRect(minX, minY, maxX, maxY, width, height, ax, ay, camera) {
    const w = Math.abs(maxX - minX);
    const h = Math.abs(maxY - minY);
    if (!(width > 0) || !(height > 0) || (w < 0.5 && h < 0.5)) {
      hide();
      return;
    }
    const liveX = Number.isFinite(ax) ? ax : maxX;
    const liveY = Number.isFinite(ay) ? ay : maxY;
    const sameBox =
      mesh.visible &&
      minX === lastMinX &&
      minY === lastMinY &&
      maxX === lastMaxX &&
      maxY === lastMaxY &&
      width === lastWidth &&
      height === lastHeight &&
      liveX === lastAx &&
      liveY === lastAy;
    if (sameBox) {
      poseOnCamera(mesh, camera, camPose);
      return;
    }
    lastMinX = minX;
    lastMinY = minY;
    lastMaxX = maxX;
    lastMaxY = maxY;
    lastWidth = width;
    lastHeight = height;
    lastAx = liveX;
    lastAy = liveY;

    const ndc = canvasRectToNdc(minX, minY, maxX, maxY, width, height);
    const live = activeCornerUv(minX, minY, maxX, maxY, liveX, liveY);
    setShaderUniform(mat, 'ndcMin', [ndc.left, ndc.top]);
    setShaderUniform(mat, 'ndcMax', [ndc.right, ndc.bottom]);
    setShaderUniform(mat, 'liveUv', [live.u, live.v]);
    setShaderUniform(mat, 'sizePx', [w, h]);
    poseOnCamera(mesh, camera, camPose);
    if (!mesh.visible) setSubtreeVisible(mesh, true);
  }

  return { hide, showCanvasRect };
}
