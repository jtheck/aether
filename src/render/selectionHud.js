// Selection HUD — a camera-locked row of chips across the top of the screen
// (v1's 3D selection panel, reimagined for Lite/WebGPU). Each distinct selected
// unit or building type shows a small 3D model icon plus a native-text
// "Name ×N" label. The icons are real scene meshes placed on a screen ray at a
// fixed depth, so the strip reads as a rigid HUD without living in the DOM.

import {
  addToScene,
  createDefaultTextData,
  createTextLayer,
  createTextRenderer,
  disposeDefaultTextData,
  disposeTextRenderer,
  registerTextRenderer,
  createShaderMaterial,
  setShaderUniform,
  setSubtreeVisible,
  updateDefaultTextData,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts, UNIT_MODEL_URLS } from './unitModels.js';
import { VAT_UNIT_DEFS } from './vatUnits.js';
import {
  BUILDING_MODEL_URLS,
  getBuildingDisplayName,
} from '../sim/buildings.js';

/** Distinct types the strip can show at once (typical selections use few). */
const MAX_SLOTS = 14;
/**
 * Depth from the camera eye the icons sit at (world units). The scene's
 * reverse-Z compare overrides per-material "always", so chips have to sit
 * nearer than terrain / trees / buildings or they lose the depth test. Keep
 * this shallow so a downward glance still clears the ground.
 */
const ICON_DEPTH = 0.8;
/**
 * Every icon is normalized so its largest dimension maps to this world size at
 * ICON_DEPTH, then centered on its slot — so chips read as evenly sized buttons
 * regardless of the source model's proportions. Paired with ICON_DEPTH so
 * on-screen size matches the original 1.55-at-28 look.
 */
const UNIT_ICON_WORLD = 1.55 * (0.8 / 28);
/** Preferred horizontal spacing between chips (CSS px); compressed to fit. */
const SLOT_PX = 112;
/** Keep the whole row inside the viewport with this side inset (CSS px). */
const EDGE_MARGIN = 44;
/** Icon center sits this far below the top edge (CSS px). */
const TOP_MARGIN = 72;
/** Label baseline below the icon center (CSS px). */
const LABEL_DY = 34;
/** Clickable rect half-height above/below the icon center (CSS px). */
const HIT_UP_PX = 48;
const HIT_DOWN_PX = 46;
/** Hover: slight scale-up, lift toward the top, and a brighter wash. */
const HOVER_SCALE = 0.1;
const HOVER_LIFT_PX = 5;
const HOVER_LERP = 14;
const LABEL_FONT_SIZE = 26;
const LABEL_SCREEN_SCALE = 0.84;
const LABEL_COLOR = [0.92, 0.96, 1, 1];
/** After radials (~225) so the strip paints last. */
const HUD_RENDER_ORDER = 420;
const AGORA_MODEL_URL = '/assets/models/agora.glb';

const BUILDING_ICON_URLS = {
  agora: AGORA_MODEL_URL,
  ...BUILDING_MODEL_URLS,
};

/**
 * Chip identity for input (click → select-all of that type).
 * @param {{ kind?: string, typeId?: number, typeKey?: string }} group
 * @returns {{ kind: 'unit', typeId: number } | { kind: 'building', typeKey: string } | null}
 */
export function selectionHudSlot(group) {
  if (!group) return null;
  if (group.kind === 'building' && group.typeKey != null) {
    return { kind: 'building', typeKey: String(group.typeKey) };
  }
  if (group.typeId != null) {
    return { kind: 'unit', typeId: group.typeId | 0 };
  }
  return null;
}

/** Icon batch key for a group row. */
export function selectionHudIconKey(group) {
  if (group?.kind === 'building') return `b:${group.typeKey}`;
  if (group?.typeId != null) return `u:${group.typeId}`;
  return null;
}

/**
 * One HUD row per distinct selected agora / placeable type.
 * @param {{ kind: 'agora' | 'building', index: number }[] | null | undefined} selected
 * @param {{ type?: string }[] | null | undefined} buildings
 * @param {unknown[] | null | undefined} agoras
 * @returns {{ kind: 'building', typeKey: string, name: string, count: number }[]}
 */
export function selectionGroupsFromBuildings(selected, buildings, agoras) {
  /** @type {Map<string, { kind: 'building', typeKey: string, name: string, count: number }>} */
  const byKey = new Map();
  const list = selected ?? [];
  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    if (!sel) continue;
    let typeKey = null;
    if (sel.kind === 'agora') {
      if (!agoras?.[sel.index]) continue;
      typeKey = 'agora';
    } else if (sel.kind === 'building') {
      const b = buildings?.[sel.index];
      if (!b?.type) continue;
      typeKey = b.type;
    }
    if (!typeKey) continue;
    const prev = byKey.get(typeKey);
    if (prev) prev.count += 1;
    else {
      byKey.set(typeKey, {
        kind: 'building',
        typeKey,
        name: getBuildingDisplayName(typeKey),
        count: 1,
      });
    }
  }
  return [...byKey.values()];
}

/** Overlay icon: skip depth so terrain / units / buildings cannot cover the strip. */
function makeIconMaterial(source) {
  const src =
    source?.baseColorFactor ?? source?._baseColorFactor ?? source?.diffuseColor;
  const base =
    src?.length >= 3
      ? [
          Math.max(0.12, Math.min(1, src[0])),
          Math.max(0.12, Math.min(1, src[1])),
          Math.max(0.12, Math.min(1, src[2])),
        ]
      : [0.72, 0.75, 0.8];
  const color = [
    Math.min(1, base[0] * 0.78 + 0.22),
    Math.min(1, base[1] * 0.78 + 0.24),
    Math.min(1, base[2] * 0.78 + 0.28),
  ];
  const mat = createShaderMaterial({
    name: `${source?.name ?? 'icon'}-selhud`,
    attributes: ['position', 'normal'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'iconColor', type: 'vec3<f32>', defaultValue: color },
    ],
    backFaceCulling: true,
    depthWrite: false,
    depthCompare: 'always',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.worldN = normalize((shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz);
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let n = normalize(input.worldN);
  let lit = 0.42 + 0.58 * max(dot(n, vec3<f32>(0.35, 0.82, 0.42)), 0.0);
  return vec4<f32>(shaderUniforms.iconColor * lit, 1.0);
}`,
  });
  return { mat, color };
}

/** Static or VAT unit GLB for the chip icon. */
function unitIconModelUrl(typeId) {
  return UNIT_MODEL_URLS[typeId] ?? VAT_UNIT_DEFS[typeId]?.url ?? null;
}

/**
 * Quaternion from orthonormal basis columns (X, Y, Z).
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
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

/** Place a HUD icon with a regular world transform (not thin instances). */
function placeIconMesh(mesh, x, y, z, rx, ry, rz, fx, fy, fz, scale) {
  if (mesh.position) {
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;
  }
  if (mesh.scaling) {
    mesh.scaling.x = scale;
    mesh.scaling.y = scale;
    mesh.scaling.z = scale;
  }
  const q = quatFromBasis(rx, ry, rz, 0, 1, 0, fx, fy, fz);
  const rq = mesh.rotationQuaternion;
  if (rq) {
    if (typeof rq.set === 'function') rq.set(q.x, q.y, q.z, q.w);
    else {
      rq.x = q.x;
      rq.y = q.y;
      rq.z = q.z;
      rq.w = q.w;
    }
  }
  setSubtreeVisible(mesh, true);
  mesh.markLocalDirty?.();
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
  const t = camera?.target;
  const tx = t?.x ?? 0;
  const ty = t?.y ?? 0;
  const tz = t?.z ?? 0;
  const a = camera?.alpha ?? -Math.PI / 2.1;
  const b = camera?.beta ?? Math.PI / 3.2;
  const r = camera?.radius ?? 110;
  let sb = Math.sin(b);
  if (Math.abs(sb) < 1e-4) sb = 1e-4;
  return {
    x: tx + r * Math.cos(a) * sb,
    y: ty + r * Math.cos(b),
    z: tz + r * Math.sin(a) * sb,
  };
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {{
 *   rayFromCanvas?: (x: number, y: number) => { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null,
 *   getViewport?: () => { width: number, height: number, pixelWidth?: number, pixelHeight?: number },
 *   getPointerCanvas?: () => { x: number, y: number } | null,
 *   canvas?: HTMLCanvasElement,
 *   font?: object | null,
 * }} [screen]
 */
export async function createSelectionHud(engine, scene, screen = {}) {
  /**
   * @type {Map<string, {
   *   layers: { mesh: object, baseColor: number[] }[],
   *   visible: boolean,
   *   hoverT: number,
   *   normScale: number,
   *   cx: number, cy: number, cz: number,
   * }>}
   */
  const icons = new Map();
  /** @type {Map<string, Promise<void>>} */
  const iconInflight = new Map();

  function urlForIconKey(key) {
    if (key.startsWith('u:')) return unitIconModelUrl(Number(key.slice(2)));
    if (key.startsWith('b:')) return BUILDING_ICON_URLS[key.slice(2)] ?? null;
    return null;
  }

  async function loadIcon(key, url) {
    if (!url || icons.has(key)) return;
    let pending = iconInflight.get(key);
    if (pending) return pending;
    pending = loadIconInner(key, url);
    iconInflight.set(key, pending);
    try {
      await pending;
    } finally {
      iconInflight.delete(key);
    }
  }

  async function loadIconInner(key, url) {
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      const layers = [];
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const mesh of parts) {
        if (mesh.boundMin && mesh.boundMax) {
          for (let a = 0; a < 3; a++) {
            if (mesh.boundMin[a] < min[a]) min[a] = mesh.boundMin[a];
            if (mesh.boundMax[a] > max[a]) max[a] = mesh.boundMax[a];
          }
        }
        mesh.position.x = 0;
        mesh.position.y = 0;
        mesh.position.z = 0;
        mesh.pickable = false;
        if ('receiveShadows' in mesh) mesh.receiveShadows = false;
        const { mat, color } = makeIconMaterial(mesh.material);
        mesh.material = mat;
        mesh.renderOrder = HUD_RENDER_ORDER;
        addToScene(scene, mesh);
        setSubtreeVisible(mesh, false);
        layers.push({ mesh, baseColor: color });
      }
      const spanX = Number.isFinite(max[0] - min[0]) ? max[0] - min[0] : 1;
      const spanY = Number.isFinite(max[1] - min[1]) ? max[1] - min[1] : 1;
      const spanZ = Number.isFinite(max[2] - min[2]) ? max[2] - min[2] : 1;
      const extent = Math.max(spanX, spanY, spanZ, 1e-3);
      icons.set(key, {
        layers,
        visible: false,
        hoverT: 0,
        normScale: UNIT_ICON_WORLD / extent,
        cx: Number.isFinite(min[0]) ? (min[0] + max[0]) * 0.5 : 0,
        cy: Number.isFinite(min[1]) ? (min[1] + max[1]) * 0.5 : 0,
        cz: Number.isFinite(min[2]) ? (min[2] + max[2]) * 0.5 : 0,
      });
    } catch (err) {
      console.warn(`[selectionHud] icon ${key} failed`, err);
    }
  }

  /** @type {{ data: object, layer: object, text: string }[]} */
  const labels = [];
  let textRenderer = null;
  let textRendererRegistered = false;
  let labelsDisposed = false;
  if (screen.font) {
    try {
      for (let i = 0; i < MAX_SLOTS; i++) {
        const data = createDefaultTextData(screen.font, LABEL_FONT_SIZE, 'Unit', LABEL_COLOR);
        const layer = createTextLayer(data, { order: i, opacity: 0, visible: false });
        labels.push({ data, layer, text: 'Unit' });
      }
      textRenderer = createTextRenderer(engine, {
        layers: labels.map((l) => l.layer),
        clear: false,
      });
    } catch (err) {
      console.warn('[selectionHud] native labels unavailable', err);
      for (const l of labels) disposeDefaultTextData(l.data);
      labels.length = 0;
      textRenderer = null;
    }
  }

  /** @type {{ kind?: string, typeId?: number, typeKey?: string, name: string, count: number }[]} */
  let groups = [];
  /** Clickable chip rects in canvas CSS px, refreshed each frame. */
  /** @type {{ slot: { kind: string, typeId?: number, typeKey?: string }, x: number, y: number, w: number, h: number }[]} */
  let hitRects = [];
  let lastHoverMs = 0;

  function applyIconHover(batch, hoverT) {
    const lift = 1 + hoverT * 0.16;
    const add = hoverT * 0.05;
    for (const layer of batch.layers) {
      const base = layer.baseColor;
      const mat = layer.mesh.material;
      if (!base || !mat) continue;
      setShaderUniform(mat, 'iconColor', [
        Math.min(1, base[0] * lift + add),
        Math.min(1, base[1] * lift + add),
        Math.min(1, base[2] * lift + add),
      ]);
    }
  }

  function showIcon(key, ax, ay, az, rx, ry, rz, fx, fy, fz, compress, hoverT) {
    const batch = icons.get(key);
    if (!batch) return;
    const s = batch.normScale * compress * (1 + hoverT * HOVER_SCALE);
    // Anchor the model's bounding-box center on the slot (up = world +Y).
    const ox = ax - s * (rx * batch.cx + fx * batch.cz);
    const oy = ay - s * (ry * batch.cx + batch.cy + fy * batch.cz);
    const oz = az - s * (rz * batch.cx + fz * batch.cz);
    for (const layer of batch.layers) {
      placeIconMesh(layer.mesh, ox, oy, oz, rx, ry, rz, fx, fy, fz, s);
    }
    applyIconHover(batch, hoverT);
    batch.visible = true;
  }

  function hideIcon(batch) {
    if (batch.hoverT) {
      applyIconHover(batch, 0);
      batch.hoverT = 0;
    }
    if (!batch.visible) return;
    for (const layer of batch.layers) {
      setSubtreeVisible(layer.mesh, false);
      if (layer.mesh.position) layer.mesh.position.y = -9999;
      layer.mesh.markLocalDirty?.();
    }
    batch.visible = false;
  }

  function hideLabel(label) {
    if (!label || !label.layer.visible) return;
    label.layer.opacity = 0;
    label.layer.visible = false;
    label.layer._version++;
  }

  function hideAll() {
    for (const batch of icons.values()) hideIcon(batch);
    for (const label of labels) hideLabel(label);
    hitRects = [];
    if (screen.canvas) screen.canvas.style.cursor = '';
  }

  /**
   * Chip under a canvas-local point (CSS px), or null.
   * @returns {{ kind: 'unit', typeId: number } | { kind: 'building', typeKey: string } | null}
   */
  function pickSlot(px, py) {
    for (let i = 0; i < hitRects.length; i++) {
      const r = hitRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        return r.slot;
      }
    }
    return null;
  }

  /** @param {{ kind?: string, typeId?: number, typeKey?: string, name: string, count: number }[]} next */
  function setGroups(next) {
    groups = Array.isArray(next) ? next : [];
    for (const g of groups) {
      const key = selectionHudIconKey(g);
      if (key) void loadIcon(key, urlForIconKey(key));
    }
  }

  function update(camera) {
    const vp = screen.getViewport?.();
    const n = Math.min(groups.length, MAX_SLOTS);
    if (!vp || n === 0) {
      hideAll();
      return;
    }
    const vw = vp.width;
    const vh = vp.height;
    if (vw < 8 || vh < 8 || !screen.rayFromCanvas) {
      hideAll();
      return;
    }
    const sx = (vp.pixelWidth ?? vw) / vw;
    const sy = (vp.pixelHeight ?? vh) / vh;
    const pixelRatio = (sx + sy) * 0.5;
    const eye = cameraEye(camera);

    // Compress the row (and icons) when many types are selected so nothing
    // spills past the viewport edges.
    const usable = Math.max(1, vw - EDGE_MARGIN * 2);
    const pitch = n > 1 ? Math.min(SLOT_PX, usable / (n - 1)) : SLOT_PX;
    const compress = Math.min(1, pitch / SLOT_PX);
    const rowW = (n - 1) * pitch;
    const startX = vw * 0.5 - rowW * 0.5;
    const iconPy = TOP_MARGIN;

    /** @type {Set<string>} */
    const shownKeys = new Set();
    hitRects = [];

    for (let i = 0; i < n; i++) {
      const g = groups[i];
      const px = startX + i * pitch;
      const slot = selectionHudSlot(g);
      if (slot) {
        hitRects.push({
          slot,
          groupIndex: i,
          x: px - pitch * 0.5,
          y: iconPy - HIT_UP_PX,
          w: pitch,
          h: HIT_UP_PX + HIT_DOWN_PX,
        });
      }
    }

    const now = performance.now();
    const dt = lastHoverMs ? Math.min(0.05, (now - lastHoverMs) * 0.001) : 0.016;
    lastHoverMs = now;
    const ptr = screen.getPointerCanvas?.();
    let hoverIdx = -1;
    if (ptr) {
      for (let i = 0; i < hitRects.length; i++) {
        const r = hitRects[i];
        if (ptr.x >= r.x && ptr.x <= r.x + r.w && ptr.y >= r.y && ptr.y <= r.y + r.h) {
          hoverIdx = r.groupIndex;
          break;
        }
      }
    }
    const canvas = screen.canvas;
    if (canvas) canvas.style.cursor = hoverIdx >= 0 ? 'pointer' : '';

    for (let i = 0; i < n; i++) {
      const g = groups[i];
      const px = startX + i * pitch;
      const iconKey = selectionHudIconKey(g);
      const batch = iconKey ? icons.get(iconKey) : null;
      const target = i === hoverIdx ? 1 : 0;
      const hoverT = batch
        ? (batch.hoverT += (target - batch.hoverT) * Math.min(1, dt * HOVER_LERP))
        : 0;
      const py = iconPy - hoverT * HOVER_LIFT_PX;

      const ray = screen.rayFromCanvas(px, py);
      if (ray && iconKey) {
        const wx = ray.ox + ray.dx * ICON_DEPTH;
        const wy = ray.oy + ray.dy * ICON_DEPTH;
        const wz = ray.oz + ray.dz * ICON_DEPTH;
        // Upright icon yawed to face the camera (matches radial icon authoring).
        let thx = eye.x - wx;
        let thz = eye.z - wz;
        const hlen = Math.hypot(thx, thz) || 1;
        thx /= hlen;
        thz /= hlen;
        // right = (-screenRight); forward = -towardCameraHorizontal.
        showIcon(iconKey, wx, wy, wz, -thz, 0, thx, -thx, 0, -thz, compress, hoverT);
        shownKeys.add(iconKey);
      }

      const label = labels[i];
      if (label) {
        const text = g.count > 1 ? `${g.name} ×${g.count}` : g.name;
        if (text !== label.text) {
          updateDefaultTextData(label.data, text, LABEL_COLOR);
          label.text = text;
        }
        const scale = LABEL_SCREEN_SCALE * pixelRatio * compress * (1 + hoverT * 0.06);
        const centerOffset = label.data.width * scale * 0.5;
        label.layer.positionPx.x = px * sx - centerOffset;
        label.layer.positionPx.y = (py + LABEL_DY) * sy;
        label.layer.rotationRad = 0;
        label.layer.scale = scale;
        label.layer.opacity = 0.92 + hoverT * 0.08;
        label.layer.visible = true;
        label.layer._version++;
      }
    }

    for (const [key, batch] of icons) {
      if (!shownKeys.has(key)) hideIcon(batch);
    }
    for (let i = n; i < labels.length; i++) hideLabel(labels[i]);
  }

  function registerLabels() {
    if (!textRenderer || textRendererRegistered || labelsDisposed) return;
    registerTextRenderer(textRenderer);
    textRendererRegistered = true;
  }

  function disposeLabels() {
    if (labelsDisposed) return;
    labelsDisposed = true;
    if (textRenderer) disposeTextRenderer(textRenderer);
    textRenderer = null;
    textRendererRegistered = false;
    for (const label of labels) disposeDefaultTextData(label.data);
  }

  return { setGroups, update, pickSlot, clear: hideAll, registerLabels, disposeLabels };
}
