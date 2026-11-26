// Camera-locked command panel. In the scene, in front of the camera, the way
// the selection strip and speech plaques sit: not pinned to a building.
// Agora: a category column plus one column of buildings. A building menu
// uses one column up to five entries, then two, then three. Pause, Cancel, and
// Rally are a row under that list. Rally is only on buildings that train units.
// The open building's icon hangs off the screen-left top corner, outside the buttons.
// The ring menus in buildingRadial.js and buildingActionRadial.js are stashed.

import {
  addToScene,
  createMeshFromData,
  createShaderMaterial,
  flushThinInstances,
  setShaderUniform,
  setSubtreeVisible,
  setThinInstances,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { loadIdleIconMeshes } from './vatUnits.js';
import {
  BUILDING_MENU_UNITS,
  BUILDING_MODEL_URLS,
  PLACEABLE_BUILDINGS,
  UPGRADE_MODEL_URLS,
  buildingCanRally,
  capActionMenu,
  getBuildingCost,
  getBuildingMenu,
  getBuildingRequires,
} from '../sim/buildings.js';
import { formatResourceCost } from '../sim/resources.js';
import { menuGateState } from '../sim/menuGate.js';
import { localHudSkin, resolveUnitModelUrl } from '../app/dlcCatalog.js';
import {
  applyMenuOverlay,
  createMenuPlateMaterial,
  createRadialIconMaterial,
  syncRadialIconShade,
} from './radialIconMaterial.js';
import { loadRadialSpriteIcon } from './radialSpriteIcon.js';
import { menuOverlayAnchor } from './radialPose.js';
import {
  hideRadialPrice,
  hideRadialPricesWithPrefix,
  radialPriceElement,
  setRadialPrice,
} from './radialPriceHud.js';
import { createMenuDomPlate } from './screenDomHud.js';
import { PRISON_TALLY_WGSL } from './controlGroupHud.js';

const PANEL_DEPTH = 14;
/**
 * Lean from horizontal toward the camera. World up stays up.
 * Steeper than the old 32° so the panel is not laid back, and it never
 * follows look pitch (that faced the headset and flipped).
 */
const MENU_TILT = 0.9;
const ROW_H = 74;
const CLOSE_W = 96;
const ROW_W = 214;
const CAT_W = 132;
const GAP = 8;
const ICON_PX = 64;
const PAD_IN = 8;
/** Dip of the corner badge into the top row. */
const HEADER_OVERLAP = 12;
/** Past the screen-left edge. Layout x is mirrored, so that edge is high x. */
const HEADER_HANG = 16;
/** Queue hash marks, in the same screen pixels as the button. */
const TALLY_PX = 58;
const EXTRA_TALLY_PX = 46;
const TALLY_TINT = [1, 0.95, 0.55];
const EXTRA_TINT = [0.78, 0.86, 0.72];
const PROGRESS_TINT = [1, 0.92, 0.35];
const PROGRESS_PX = 4;
const MAX_CELLS = 12;
const MAX_OPTIONS = 8;
const PLACE_CANCEL_RADIUS = 9;
const RALLY_ICON_URL = '/assets/models/flag.glb';

const CATEGORIES = [
  { id: 'basic', name: 'Basic' },
  { id: 'advanced', name: 'Advanced' },
  { id: 'elemental', name: 'Elemental' },
];

const WASH = {
  ok: [0.86, 0.96, 1],
  unafford: [0.95, 0.62, 0.58],
  locked: [0.42, 0.44, 0.46],
  owned: [0.58, 0.56, 0.5],
};

const PLATE = {
  board: [0.05, 0.07, 0.09],
  rest: [0.16, 0.22, 0.26],
  hover: [0.42, 0.68, 0.74],
  on: [0.22, 0.62, 0.68],
  dull: [0.11, 0.12, 0.13],
  pause: [0.2, 0.5, 0.48],
  cancel: [0.62, 0.32, 0.28],
};

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

function normalize(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function rayHitPlane(ray, px, py, pz, nx, ny, nz) {
  const denom = ray.dx * nx + ray.dy * ny + ray.dz * nz;
  if (Math.abs(denom) < 1e-8) return null;
  const t = ((px - ray.ox) * nx + (py - ray.oy) * ny + (pz - ray.oz) * nz) / denom;
  if (t < 0) return null;
  return {
    x: ray.ox + ray.dx * t,
    y: ray.oy + ray.dy * t,
    z: ray.oz + ray.dz * t,
    t,
  };
}

function columnsFor(n) {
  if (n <= 5) return 1;
  if (n <= 10) return 2;
  return 3;
}

function headerIconKey(typeId) {
  return `header:${typeId}`;
}

/** Screen-left is the high layout x. The badge sits mostly above that corner. */
function headerHang(left, top, blockW) {
  return {
    cx: left + blockW - ICON_PX * 0.5 + HEADER_HANG,
    cy: top - ICON_PX * 0.5 + HEADER_OVERLAP,
  };
}

function createPlateMesh(engine, name) {
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0.5, 0, 0.5,
    -0.5, 0, 0.5,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(engine, name, positions, normals, indices);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = 210;
  mesh.material = createMenuPlateMaterial(PLATE.rest, [1, 1, 1], 0.9);
  return mesh;
}

function paintPlate(mesh, rgb, alpha) {
  const mat = mesh.material;
  if (!mat) return;
  mat.diffuseColor = rgb;
  mat.emissiveColor = [1, 1, 1];
  mat.alpha = alpha;
  syncRadialIconShade(mat);
}

function posePanelMesh(mesh, visual, sx, sy, sz, quat, anchor) {
  applyMenuOverlay(mesh, visual.x, visual.y, visual.z, anchor);
  if (mesh.scaling) {
    mesh.scaling.x = sx;
    mesh.scaling.y = sy;
    mesh.scaling.z = sz;
  }
  const rq = mesh.rotationQuaternion;
  if (rq) {
    if (typeof rq.set === 'function') rq.set(quat.x, quat.y, quat.z, quat.w);
    else {
      rq.x = quat.x;
      rq.y = quat.y;
      rq.z = quat.z;
      rq.w = quat.w;
    }
  }
  mesh.markLocalDirty?.();
  setSubtreeVisible(mesh, true);
}

function hideMesh(mesh) {
  if (!mesh) return;
  setSubtreeVisible(mesh, false);
}

function makeQueueTallyMesh(engine, name) {
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0.5, 0, 0.5,
    -0.5, 0, 0.5,
  ]);
  const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.pickable = false;
  if ('receiveShadows' in mesh) mesh.receiveShadows = false;
  mesh.renderOrder = 236;
  mesh.boundMin = [-1, -1, -1];
  mesh.boundMax = [1, 1, 1];
  return mesh;
}

function makeQueueTallyMaterial(name, rgb) {
  const mat = createShaderMaterial({
    name,
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'tint', type: 'vec3<f32>', defaultValue: rgb },
      { name: 'count', type: 'f32', defaultValue: 0 },
      { name: 'alpha', type: 'f32', defaultValue: 0 },
      { name: 'originFix', type: 'vec3<f32>', defaultValue: [0, 0, 0] },
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
  let wp0 = shaderSystem.world * vec4<f32>(input.position, 1.0);
  let wp = vec4<f32>(wp0.xyz + shaderUniforms.originFix, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.uv = input.uv;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
${PRISON_TALLY_WGSL}
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let d = tallyDist(input.uv, shaderUniforms.count);
  let mark = 1.0 - smoothstep(0.016, 0.036, d);
  let alpha = mark * shaderUniforms.alpha;
  if (alpha < 0.02) { discard; }
  return vec4<f32>(shaderUniforms.tint, alpha);
}`,
  });
  mat._menuOverlay = true;
  mat._originFix = [0, 0, 0];
  return mat;
}

/**
 * @param {'build' | 'action'} kind
 */
function createSceneCommandMenu(engine, scene, groundYAt, screen, kind) {
  const pricePrefix = kind === 'build' ? 'build-' : 'action-';
  const boardMesh = createPlateMesh(engine, `${kind}-menu-board`);
  boardMesh.renderOrder = 200;
  addToScene(scene, boardMesh);
  hideMesh(boardMesh);

  /** @type {object[]} */
  const plates = [];
  /** @type {{ mesh: object, hide: () => void, sync: (el: HTMLElement | null) => { cssW: number, cssH: number, pad: number } | null }[]} */
  const domPlates = [];
  for (let i = 0; i < MAX_CELLS; i++) {
    const mesh = createPlateMesh(engine, `${kind}-menu-cell-${i}`);
    addToScene(scene, mesh);
    hideMesh(mesh);
    plates.push(mesh);
    domPlates.push(createMenuDomPlate(engine, scene, `${kind}-menu-text-${i}`));
  }

  /** @type {{ mesh: object, mat: object }[]} */
  const queueTallies = [];
  /** @type {{ mesh: object, mat: object }[]} */
  const extraTallies = [];
  if (kind === 'action') {
    for (let i = 0; i < MAX_CELLS; i++) {
      const queueMat = makeQueueTallyMaterial(`${kind}-tally-${i}`, TALLY_TINT);
      const queueMesh = makeQueueTallyMesh(engine, `${kind}-tally-${i}`);
      queueMesh.material = queueMat;
      addToScene(scene, queueMesh);
      hideMesh(queueMesh);
      queueTallies.push({ mesh: queueMesh, mat: queueMat });
      const extraMat = makeQueueTallyMaterial(`${kind}-extra-${i}`, EXTRA_TINT);
      const extraMesh = makeQueueTallyMesh(engine, `${kind}-extra-${i}`);
      extraMesh.material = extraMat;
      addToScene(scene, extraMesh);
      hideMesh(extraMesh);
      extraTallies.push({ mesh: extraMesh, mat: extraMat });
    }
  }

  /** @type {object[]} */
  const progressBars = [];
  if (kind === 'action') {
    for (let i = 0; i < MAX_CELLS; i++) {
      const mesh = createPlateMesh(engine, `${kind}-progress-${i}`);
      mesh.renderOrder = 228;
      addToScene(scene, mesh);
      hideMesh(mesh);
      progressBars.push(mesh);
    }
  }

  /** @type {Map<string, any>} */
  const icons = new Map();
  /** @type {Map<string, Promise<void>>} */
  const iconInflight = new Map();

  function writeInstance(mesh, cx, cy, cz) {
    let matrices = mesh._menuInstance;
    if (!matrices) {
      matrices = new Float32Array(16);
      mesh._menuInstance = matrices;
      setThinInstances(mesh, matrices, 1);
    }
    matrices.set([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -cx, -cy, -cz, 1,
    ]);
    const ti = mesh.thinInstances;
    if (ti) {
      ti.count = 1;
      ti._version = (ti._version ?? 0) + 1;
      ti._dirtyMin = 0;
      ti._dirtyMax = 1;
    }
    flushThinInstances(mesh);
  }

  function hideIcon(batch) {
    if (!batch) return;
    for (const layer of batch.layers) {
      const ti = layer.mesh.thinInstances;
      if (ti) {
        ti.count = 0;
        ti._version = (ti._version ?? 0) + 1;
      }
      flushThinInstances(layer.mesh);
      if (layer.visible) {
        setSubtreeVisible(layer.mesh, false);
        layer.visible = false;
      }
    }
  }

  async function loadIcon(key, url) {
    if (!key || !url || icons.has(key)) return;
    let pending = iconInflight.get(key);
    if (pending) return pending;
    pending = (async () => {
      try {
        const sprite = await loadRadialSpriteIcon(engine, scene, `${kind}-sprite-${key}`, url);
        if (sprite) {
          icons.set(key, sprite);
          return;
        }
        let parts = null;
        if (key.startsWith('unit:')) parts = await loadIdleIconMeshes(engine, url);
        if (!parts?.length) parts = await loadBakedUnitMeshParts(engine, url);
        const layers = [];
        for (const mesh of parts) {
          mesh.position.x = 0;
          mesh.position.y = 0;
          mesh.position.z = 0;
          mesh.pickable = false;
          mesh.renderOrder = 226;
          mesh.material = createRadialIconMaterial(mesh.material);
          const mat = mesh.material;
          if (mat) {
            if (!mat.emissiveColor) mat.emissiveColor = [0.82, 0.82, 0.82];
            if (!mat.diffuseColor) mat.diffuseColor = [0.8, 0.8, 0.8];
          }
          addToScene(scene, mesh);
          setSubtreeVisible(mesh, false);
          layers.push({
            mesh,
            baseEmissive: mat?.emissiveColor ? [...mat.emissiveColor] : [0.82, 0.82, 0.82],
            baseDiffuse: mat?.diffuseColor ? [...mat.diffuseColor] : [0.8, 0.8, 0.8],
            visible: false,
          });
        }
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const layer of layers) {
          const box = layer.mesh;
          if (!box.boundMin || !box.boundMax) continue;
          for (let a = 0; a < 3; a++) {
            if (box.boundMin[a] < min[a]) min[a] = box.boundMin[a];
            if (box.boundMax[a] > max[a]) max[a] = box.boundMax[a];
          }
        }
        icons.set(key, {
          layers,
          sprite: false,
          cx: Number.isFinite(min[0]) ? (min[0] + max[0]) * 0.5 : 0,
          cy: Number.isFinite(min[1]) ? (min[1] + max[1]) * 0.5 : 0,
          cz: Number.isFinite(min[2]) ? (min[2] + max[2]) * 0.5 : 0,
          hx: Number.isFinite(min[0]) ? (max[0] - min[0]) * 0.5 : 0,
          hy: Number.isFinite(min[1]) ? max[1] - min[1] : 0,
          hz: Number.isFinite(min[2]) ? (max[2] - min[2]) * 0.5 : 0,
        });
      } catch (err) {
        console.warn(`[sceneMenu] icon ${key} failed`, err);
      }
    })();
    iconInflight.set(key, pending);
    try {
      await pending;
    } finally {
      iconInflight.delete(key);
    }
  }

  let open = false;
  let anchorX = 0;
  let anchorZ = 0;
  /** @type {'basic' | 'advanced' | 'elemental'} */
  let activeCategory = 'basic';
  let categoryLocked = false;
  /** @type {string | null} */
  let placingPreviewType = null;
  let hoverIndex = -1;
  /** @type {string | null} */
  let hoverCat = null;
  /** @type {'pause' | 'cancel' | 'rally' | 'close' | null} */
  let hoverUtil = null;
  /** @type {Record<string, number> | null} */
  let menuBank = null;
  /** @type {Set<string>} */
  let ownedTypes = new Set();
  /** @type {Set<string>} */
  const researchedUpgrades = new Set();
  /** @type {Map<string, { progress: number, count: number, extra: number }>} */
  const tracks = new Map();
  let utilityAvailable = { pause: false, cancel: false };
  let prodPaused = false;
  /** @type {string | null} */
  let armed = null;
  /** @type {string | null} */
  let activeBuildingType = null;
  /** @type {any} */
  let activeMenu = null;
  let activeMenuKey = '';
  /** @type {any[]} */
  let itemSlots = [];
  /** @type {any[]} */
  let cells = [];
  /** @type {any | null} */
  let board = null;
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;
  let hubSx = 0;
  let hubSy = 0;
  /** @type {Set<string>} */
  const shownIcons = new Set();

  function menuKeyOf(menu) {
    const u = (menu?.units ?? []).map((i) => i.id).join(',');
    const g = (menu?.upgrades ?? []).map((i) => i.id).join(',');
    const b = (menu?.buildings ?? []).map((i) => i.id).join(',');
    return `${u}|${g}|${b}`;
  }

  function itemsForCategory(catId) {
    return PLACEABLE_BUILDINGS.filter((b) => b.category === catId);
  }

  function gateForBuilding(typeId) {
    return menuGateState({
      cost: getBuildingCost(typeId),
      requires: getBuildingRequires(typeId),
      bank: menuBank,
      ownedTypes,
    });
  }

  function gateForAction(slot) {
    if (!slot || (slot.kind === 'upgrade' && researchedUpgrades.has(slot.id))) return 'owned';
    return menuGateState({
      cost: slot.cost,
      requires: slot.requires,
      tech: slot.tech,
      researched: researchedUpgrades,
      bank: menuBank,
      ownedTypes,
    });
  }

  function trackOf(slot) {
    if (!slot?.kind || slot.kind === 'category') return null;
    return tracks.get(`${slot.kind}:${slot.id}`) ?? null;
  }

  function anyTracksActive() {
    for (const t of tracks.values()) {
      if ((t.count | 0) > 0 || (t.extra | 0) > 0 || t.progress > 0) return true;
    }
    return false;
  }

  function syncCancelAvailability() {
    const on = anyTracksActive();
    utilityAvailable.cancel = on;
    utilityAvailable.pause = on;
  }

  function rebuildItems() {
    hoverIndex = -1;
    hoverCat = null;
    hoverUtil = null;
    itemSlots = [];
    if (kind === 'build') {
      for (const item of itemsForCategory(activeCategory)) {
        itemSlots.push({
          kind: 'building',
          id: item.id,
          name: item.name,
          cost: getBuildingCost(item.id),
          costText: formatResourceCost(getBuildingCost(item.id)),
          gate: gateForBuilding(item.id),
          iconKey: item.id,
        });
      }
      return;
    }
    const shown = capActionMenu(activeMenu, MAX_OPTIONS);
    const push = (list, category) => {
      for (const item of list ?? []) {
        const iconKey = `${category}:${item.id}`;
        itemSlots.push({
          kind: category,
          id: item.id,
          name: item.name,
          cost: item.auto ? {} : (item.cost ?? {}),
          costText: item.auto ? '' : formatResourceCost(item.cost),
          requires: item.requires,
          tech: item.tech || null,
          auto: !!item.auto,
          gate: 'ok',
          iconKey,
        });
      }
    };
    push(shown.units, 'unit');
    push(shown.upgrades, 'upgrade');
    push(shown.buildings, 'building');
    for (const slot of itemSlots) {
      slot.gate = slot.auto ? 'ok' : gateForAction(slot);
      if (slot.kind === 'upgrade' && researchedUpgrades.has(slot.id)) slot.gate = 'owned';
    }
  }

  function hideAllIcons() {
    for (const batch of icons.values()) hideIcon(batch);
    shownIcons.clear();
  }

  function hideChrome() {
    hideMesh(boardMesh);
    for (const mesh of plates) hideMesh(mesh);
    for (const plate of domPlates) plate.hide();
    hideAllIcons();
    for (const tally of queueTallies) hideMesh(tally.mesh);
    for (const tally of extraTallies) hideMesh(tally.mesh);
    for (const mesh of progressBars) hideMesh(mesh);
    hideRadialPricesWithPrefix(pricePrefix);
    cells = [];
    board = null;
  }

  function project(px, py) {
    // Uniform scale into the headset, same rectangle as the monitor.
    // The oval chrome point is radial: every pixel on one angle lands on
    // the rim, which collapses this panel.
    const scaleIn = screen.menuScale?.();
    const scale = scaleIn > 0 ? scaleIn : 1;
    const place = screen.menuPoint || ((x, y) => ({ x, y }));
    const p = place(px, py);
    const ray = screen.rayFromCanvas?.(p.x, p.y);
    const rayR = screen.rayFromCanvas?.(p.x + 1, p.y);
    const rayD = screen.rayFromCanvas?.(p.x, p.y + 1);
    if (!ray || !rayR || !rayD) return null;
    const x = ray.ox + ray.dx * PANEL_DEPTH;
    const y = ray.oy + ray.dy * PANEL_DEPTH;
    const z = ray.oz + ray.dz * PANEL_DEPTH;
    const rx = rayR.ox + rayR.dx * PANEL_DEPTH - x;
    const ry = rayR.oy + rayR.dy * PANEL_DEPTH - y;
    const rz = rayR.oz + rayR.dz * PANEL_DEPTH - z;
    const dx = rayD.ox + rayD.dx * PANEL_DEPTH - x;
    const dy = rayD.oy + rayD.dy * PANEL_DEPTH - y;
    const dz = rayD.oz + rayD.dz * PANEL_DEPTH - z;
    const right = normalize(rx, ry, rz);
    const down = normalize(dx, dy, dz);
    const normal = normalize(-ray.dx, -ray.dy, -ray.dz);
    const wpp = (Math.hypot(rx, ry, rz) || 0.001) * scale;
    return {
      x, y, z, wpp, sx: px, sy: py,
      right, down,
      up: { x: -down.x, y: -down.y, z: -down.z },
      normal,
      ray,
    };
  }

  let headingX = 0;
  let headingZ = 1;
  /** One leaned card for the whole menu. Up stays world-up so orbiting cannot roll it. */
  let card = null;

  function cameraEye() {
    const cam = screen._camera;
    const wm = cam?.worldMatrix;
    if (wm && Number.isFinite(wm[12]) && Number.isFinite(wm[13]) && Number.isFinite(wm[14])) {
      return { x: wm[12], y: wm[13], z: wm[14] };
    }
    const p = cam?.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      return { x: p.x, y: p.y, z: p.z };
    }
    return null;
  }

  function leanedFrame(frame, eye) {
    let thx = eye.x - frame.x;
    let thz = eye.z - frame.z;
    let hlen = Math.hypot(thx, thz);
    if (hlen < 0.05) {
      thx = headingX;
      thz = headingZ;
      hlen = Math.hypot(thx, thz) || 1;
    } else {
      headingX = thx / hlen;
      headingZ = thz / hlen;
    }
    thx /= hlen;
    thz /= hlen;
    const st = Math.sin(MENU_TILT);
    const ct = Math.cos(MENU_TILT);
    const normal = { x: thx * st, y: ct, z: thz * st };
    const right = { x: thz, y: 0, z: -thx };
    const up = normalize(
      normal.y * right.z - normal.z * right.y,
      normal.z * right.x - normal.x * right.z,
      normal.x * right.y - normal.y * right.x,
    );
    return {
      ...frame,
      right,
      up,
      down: { x: -up.x, y: -up.y, z: -up.z },
      normal,
    };
  }

  function panelQuat(frame) {
    const r = frame.right;
    const n = frame.normal;
    const d = frame.down;
    return quatFromBasis(r.x, r.y, r.z, n.x, n.y, n.z, d.x, d.y, d.z);
  }

  function onCard(cssX, cssY) {
    const dx = (cssX - card.sx) * card.wpp;
    const dy = (cssY - card.sy) * card.wpp;
    return {
      x: card.x + card.right.x * dx + card.down.x * dy,
      y: card.y + card.right.y * dx + card.down.y * dy,
      z: card.z + card.right.z * dx + card.down.z * dy,
      sx: cssX,
      sy: cssY,
      wpp: card.wpp,
      right: card.right,
      down: card.down,
      up: card.up,
      normal: card.normal,
    };
  }

  function shift(frame, alongRight, alongUp) {
    return {
      x: frame.x + frame.right.x * alongRight + frame.up.x * alongUp,
      y: frame.y + frame.right.y * alongRight + frame.up.y * alongUp,
      z: frame.z + frame.right.z * alongRight + frame.up.z * alongUp,
    };
  }

  function standingFace(frame) {
    const eye = cameraEye();
    let tx = eye ? eye.x - frame.x : -frame.right.z;
    let ty = eye ? eye.y - frame.y : 0;
    let tz = eye ? eye.z - frame.z : frame.right.x;
    let hlen = Math.hypot(tx, tz);
    if (hlen < 0.05) {
      tx = headingX;
      tz = headingZ;
      hlen = Math.hypot(tx, tz) || 1;
      if (Math.abs(ty) < 1e-4) ty = 1;
    }
    const hx = tx / hlen;
    const hz = tz / hlen;
    const rx = hz;
    const rz = -hx;
    const zlen = Math.hypot(tx, ty, tz) || 1;
    const zx = tx / zlen;
    const zy = ty / zlen;
    const zz = tz / zlen;
    const ux = zy * rz;
    const uy = zz * rx - zx * rz;
    const uz = -zy * rx;
    const ulen = Math.hypot(ux, uy, uz) || 1;
    return quatFromBasis(rx, 0, rz, ux / ulen, uy / ulen, uz / ulen, zx, zy, zz);
  }

  function poseIcon(key, frame, hovered, gate) {
    const batch = icons.get(key);
    if (!batch || !frame) return;
    shownIcons.add(key);
    const wash = WASH[gate] ?? WASH.ok;
    const world = ICON_PX * frame.wpp;
    const anchor = menuOverlayAnchor(screen._camera);
    // Face the camera and stay upright on screen. The plate keeps its lean.
    // Sprite quads store screen-left on local +X, so their X scale is flipped.
    const face = standingFace(frame);
    if (batch.sprite) {
      const layer = batch.layers[0];
      writeInstance(layer.mesh, 0, 0, 0);
      posePanelMesh(layer.mesh, frame, -world, world, world, face, anchor);
      layer.visible = true;
      const mat = layer.mesh.material;
      if (mat) {
        mat.emissiveColor = hovered ? [0.08, 0.08, 0.08] : wash;
        mat.diffuseColor = [1, 1, 1];
        mat.alpha = 0.999;
        syncRadialIconShade(mat);
      }
      return;
    }
    const span = Math.max((batch.hx ?? 0) * 2, batch.hy ?? 0, (batch.hz ?? 0) * 2, 1e-3);
    const scale = world / span;
    for (const layer of batch.layers) {
      writeInstance(layer.mesh, batch.cx || 0, batch.cy || 0, batch.cz || 0);
      posePanelMesh(layer.mesh, frame, scale, scale, scale, face, anchor);
      layer.visible = true;
      const mat = layer.mesh.material;
      if (!mat) continue;
      mat.emissiveColor = hovered ? [0.06, 0.075, 0.09] : wash;
      mat.diffuseColor = layer.baseDiffuse ? [...layer.baseDiffuse] : [0.8, 0.8, 0.8];
      mat.alpha = 0.999;
      syncRadialIconShade(mat);
    }
  }

  function cellLabel(slot) {
    if (slot.kind === 'pause') return prodPaused ? 'Resume' : 'Pause';
    if (slot.kind === 'cancel') return armed === 'cancel' ? 'Cancel?' : 'Cancel';
    return slot.name || '';
  }

  function poseTally(entry, count, cssX, cssY, px, face, anchor) {
    if (!entry || count < 1 || !card) {
      if (entry) hideMesh(entry.mesh);
      return;
    }
    const spot = project(cssX, cssY);
    if (!spot) {
      hideMesh(entry.mesh);
      return;
    }
    const frame = onCard(spot.sx, spot.sy);
    const world = px * frame.wpp;
    setShaderUniform(entry.mat, 'count', count);
    setShaderUniform(entry.mat, 'alpha', 1);
    posePanelMesh(entry.mesh, frame, world, 1, world, face, anchor);
  }

  function poseProgress(mesh, spec, progress, face, anchor) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    if (!mesh || p <= 0.001 || !card) {
      if (mesh) hideMesh(mesh);
      return;
    }
    const inset = 6;
    const span = Math.max(0, spec.w - inset * 2);
    const barW = Math.max(span * p, 2);
    const spot = project(
      spec.x + inset + barW * 0.5,
      spec.y + spec.h - PROGRESS_PX * 0.5 - 3,
    );
    if (!spot) {
      hideMesh(mesh);
      return;
    }
    const frame = onCard(spot.sx, spot.sy);
    posePanelMesh(mesh, frame, barW * frame.wpp, 1, PROGRESS_PX * frame.wpp, face, anchor);
    paintPlate(mesh, PROGRESS_TINT, 0.95);
  }

  function layout() {
    if (!open || placingPreviewType) {
      hideChrome();
      return;
    }
    shownIcons.clear();
    cells = [];
    const vp = screen.getViewport?.();
    const vw = vp?.width ?? 0;
    const vh = vp?.height ?? 0;
    if (vw < 8 || vh < 8 || !screen.rayFromCanvas) return;

    /** @type {any[]} */
    const specs = [];
    /** @type {{ key: string, cx: number, cy: number } | null} */
    let headerIcon = null;
    if (kind === 'build') {
      const n = itemSlots.length;
      const rows = Math.max(n, CATEGORIES.length);
      const blockW = CAT_W + GAP + ROW_W;
      const blockH = rows * ROW_H + Math.max(0, rows - 1) * GAP;
      const left = vw * 0.5 - blockW * 0.5;
      const top = vh * 0.56 - blockH * 0.5;
      const catBlock = CATEGORIES.length * ROW_H + (CATEGORIES.length - 1) * GAP;
      const catTop = top + (blockH - catBlock) * 0.5;
      hubSx = left + CAT_W + GAP * 0.5;
      hubSy = top + blockH * 0.5;
      headerIcon = { key: headerIconKey('agora'), ...headerHang(left, top, blockW) };
      for (let i = 0; i < CATEGORIES.length; i++) {
        const cat = CATEGORIES[i];
        specs.push({
          kind: 'category',
          id: cat.id,
          name: cat.name,
          x: left,
          y: catTop + i * (ROW_H + GAP),
          w: CAT_W,
          h: ROW_H,
          pickable: true,
          ring: 'inner',
          gate: 'ok',
          selected: cat.id === activeCategory,
          hovered: hoverCat === cat.id,
        });
      }
      const closeY = catTop + CATEGORIES.length * (ROW_H + GAP);
      specs.push({
        kind: 'close',
        name: 'Close',
        x: left,
        y: closeY,
        w: CLOSE_W,
        h: ROW_H,
        pickable: true,
        ring: 'inner',
        gate: 'ok',
        hovered: hoverUtil === 'close',
      });
      for (let i = 0; i < n; i++) {
        const slot = itemSlots[i];
        specs.push({
          ...slot,
          slotIndex: i,
          x: left + CAT_W + GAP,
          y: top + i * (ROW_H + GAP),
          w: ROW_W,
          h: ROW_H,
          pickable: true,
          ring: 'outer',
          hovered: hoverIndex === i,
        });
      }
      const closeBottom = closeY + ROW_H;
      const extraH = Math.max(0, closeBottom - (top + blockH));
      board = { x: left - 10, y: top - 10, w: blockW + 20, h: blockH + 20 + extraH };
    } else {
      const n = itemSlots.length;
      const cols = Math.max(1, columnsFor(n));
      const rows = Math.max(1, Math.ceil(n / cols));
      const gridW = Math.max(ROW_W, cols * ROW_W + (cols - 1) * GAP);
      const gridH = n > 0 ? rows * ROW_H + (rows - 1) * GAP : 0;
      const blockW = gridW;
      const blockH = (n > 0 ? gridH + GAP : 0) + ROW_H;
      const left = vw * 0.5 - blockW * 0.5;
      const top = vh * 0.56 - blockH * 0.5;
      hubSx = left - 48;
      hubSy = top + blockH * 0.5;
      if (activeBuildingType) {
        headerIcon = { key: headerIconKey(activeBuildingType), ...headerHang(left, top, blockW) };
      }
      for (let i = 0; i < n; i++) {
        const slot = itemSlots[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        specs.push({
          ...slot,
          slotIndex: i,
          x: left + col * (ROW_W + GAP),
          y: top + row * (ROW_H + GAP),
          w: ROW_W,
          h: ROW_H,
          pickable: !slot.auto,
          ring: 'outer',
          hovered: hoverIndex === i,
        });
      }
      const utilY = top + (n > 0 ? gridH + GAP : 0);
      const pauseOn = !!utilityAvailable.pause;
      const cancelOn = !!utilityAvailable.cancel;
      const rallyOn = buildingCanRally(activeBuildingType);
      const utils = [
        {
          kind: 'pause',
          name: prodPaused ? 'Resume' : 'Pause',
          pickable: pauseOn,
          dull: !pauseOn,
          hovered: hoverUtil === 'pause',
          selected: prodPaused,
        },
        {
          kind: 'cancel',
          name: armed === 'cancel' ? 'Cancel?' : 'Cancel',
          pickable: cancelOn,
          dull: !cancelOn,
          hovered: hoverUtil === 'cancel',
          selected: armed === 'cancel',
        },
      ];
      if (rallyOn) {
        utils.push({
          kind: 'rally',
          name: 'Rally',
          iconKey: 'rally:flag',
          pickable: true,
          dull: false,
          hovered: hoverUtil === 'rally',
          selected: false,
        });
      }
      const utilW = (blockW - GAP * (utils.length - 1)) / utils.length;
      for (let u = 0; u < utils.length; u++) {
        specs.push({
          ...utils[u],
          x: left + u * (utilW + GAP),
          y: utilY,
          w: utilW,
          h: ROW_H,
          ring: 'outer',
          gate: 'ok',
        });
      }
      const gridBottom = n > 0 ? gridH : 0;
      board = n > 0
        ? { x: left - 10, y: top - 10, w: blockW + 20, h: gridBottom + 20 }
        : null;
    }

    const anchor = menuOverlayAnchor(screen._camera);
    const viewed = project(vw * 0.5, vh * 0.5);
    const eye = cameraEye();
    card = viewed && eye ? leanedFrame(viewed, eye) : null;
    if (!card) return;
    const face = panelQuat(card);
    if (board) {
      const bw = board.w * card.wpp;
      const bh = board.h * card.wpp;
      const boardSpot = project(board.x + board.w * 0.5, board.y + board.h * 0.5);
      const center = onCard(
        boardSpot?.sx ?? board.x + board.w * 0.5,
        boardSpot?.sy ?? board.y + board.h * 0.5,
      );
      posePanelMesh(boardMesh, center, bw, 1, bh, face, anchor);
      paintPlate(boardMesh, PLATE.board, 0.78);
      centerX = center.x;
      centerY = center.y;
      centerZ = center.z;
      board.frame = center;
      board.hw = bw * 0.5;
      board.hh = bh * 0.5;
    } else {
      hideMesh(boardMesh);
    }

    cells = [];
    for (let i = 0; i < specs.length && i < MAX_CELLS; i++) {
      const spec = specs[i];
      const spot = project(spec.x + spec.w * 0.5, spec.y + spec.h * 0.5);
      if (!spot) {
        hideMesh(plates[i]);
        domPlates[i].hide();
        hideRadialPrice(`${pricePrefix}${i}`);
        if (queueTallies[i]) hideMesh(queueTallies[i].mesh);
        if (extraTallies[i]) hideMesh(extraTallies[i].mesh);
        if (progressBars[i]) hideMesh(progressBars[i]);
        continue;
      }
      const frame = onCard(spot.sx, spot.sy);
      const worldW = spec.w * card.wpp;
      const worldH = spec.h * card.wpp;
      const mesh = plates[i];
      posePanelMesh(mesh, frame, worldW, 1, worldH, face, anchor);
      let rgb = PLATE.rest;
      if (spec.dull) rgb = PLATE.dull;
      else if (spec.hovered) rgb = PLATE.hover;
      else if (spec.selected && spec.kind === 'category') rgb = PLATE.on;
      else if (spec.selected && spec.kind === 'pause') rgb = PLATE.pause;
      else if (spec.selected && spec.kind === 'cancel') rgb = PLATE.cancel;
      else if (spec.gate === 'locked' || spec.gate === 'owned') rgb = PLATE.dull;
      paintPlate(mesh, rgb, spec.dull ? 0.45 : 0.92);

      const queued = trackOf(spec);
      poseProgress(
        progressBars[i],
        spec,
        spec.gate === 'owned' ? 0 : queued?.progress,
        face,
        anchor,
      );
      const iconCx = spec.iconKey
        ? spec.x + PAD_IN + ICON_PX * 0.5
        : spec.x + PAD_IN + TALLY_PX * 0.5;
      const underIcon = spec.y + spec.h * 0.5 + (spec.iconKey ? ICON_PX * 0.42 : spec.h * 0.28);
      poseTally(
        queueTallies[i],
        queued?.count | 0,
        iconCx,
        underIcon,
        TALLY_PX,
        face,
        anchor,
      );
      poseTally(
        extraTallies[i],
        queued?.extra | 0,
        iconCx + TALLY_PX * 0.55,
        underIcon,
        EXTRA_TALLY_PX,
        face,
        anchor,
      );

      if (spec.iconKey) {
        const iconSpot = project(spec.x + PAD_IN + ICON_PX * 0.5, spec.y + spec.h * 0.5);
        if (iconSpot) {
          poseIcon(spec.iconKey, onCard(iconSpot.sx, iconSpot.sy), !!spec.hovered && spec.pickable, spec.gate);
        }
      }

      const textLeft = spec.iconKey ? spec.x + PAD_IN + ICON_PX + 8 : spec.x + 8;
      const textPx = (textLeft + spec.x + spec.w - 8) * 0.5;
      const textPy = spec.y + (spec.iconKey ? 14 : spec.h * 0.5 - 12);
      const textSpot = project(textPx, textPy);
      const costSpot = project(textLeft, textPy);
      const costRightSpot = project(spec.x + spec.w - 8, textPy);
      const textFrame = textSpot ? onCard(textSpot.sx, textSpot.sy) : null;
      const gate = spec.gate || 'ok';
      const wash = WASH[gate] ?? WASH.ok;
      const name = cellLabel(spec);
      if (textFrame && screen.worldToScreen) {
        const origin = screen.worldToScreen(textFrame.x, textFrame.y, textFrame.z);
        const costFrame = costSpot ? onCard(costSpot.sx, costSpot.sy) : null;
        const costOrigin = costFrame
          ? screen.worldToScreen(costFrame.x, costFrame.y, costFrame.z)
          : null;
        const costRightFrame = costRightSpot ? onCard(costRightSpot.sx, costRightSpot.sy) : null;
        const costRight = costRightFrame
          ? screen.worldToScreen(costRightFrame.x, costRightFrame.y, costRightFrame.z)
          : null;
        if (origin) {
          setRadialPrice(`${pricePrefix}${i}`, {
            cost: spec.costText ? spec.cost : null,
            name,
            nameWash: wash,
            x: origin.x,
            y: origin.y,
            costX: costOrigin?.x,
            costRightX: costRight?.x,
            canvas: screen.canvas,
            opacity: spec.dull ? 0.45 : spec.hovered ? 1 : 0.92,
            wash,
            okWash: WASH.ok,
            gate: gate === 'owned' ? 'ok' : gate,
            bank: menuBank,
          });
          const fitted = domPlates[i].sync(radialPriceElement(`${pricePrefix}${i}`));
          if (fitted && textFrame.wpp > 1e-6) {
            const w = fitted.cssW * textFrame.wpp;
            const h = fitted.cssH * textFrame.wpp;
            const fx = Number.isFinite(fitted.anchorX) ? fitted.anchorX : 0.5;
            const dropped = shift(
              textFrame,
              (0.5 - fx) * w,
              -(h * 0.5 - fitted.pad * textFrame.wpp),
            );
            posePanelMesh(domPlates[i].mesh, dropped, w, 1, h, panelQuat(textFrame), anchor);
          }
        }
      }

      const ang = Math.atan2(frame.sy - hubSy, -(frame.sx - hubSx));
      cells.push({
        ...spec,
        sx: spec.x,
        sy: spec.y,
        sw: spec.w,
        sh: spec.h,
        x: frame.x,
        y: frame.y,
        z: frame.z,
        rx: frame.right.x,
        ry: frame.right.y,
        rz: frame.right.z,
        ux: frame.up.x,
        uy: frame.up.y,
        uz: frame.up.z,
        nx: frame.normal.x,
        ny: frame.normal.y,
        nz: frame.normal.z,
        hw: worldW * 0.5,
        hh: worldH * 0.5,
        ang,
      });
    }

    if (headerIcon) {
      const iconSpot = project(headerIcon.cx, headerIcon.cy);
      if (iconSpot) {
        poseIcon(headerIcon.key, onCard(iconSpot.sx, iconSpot.sy), false, 'ok');
      }
    }

    const drawn = Math.min(specs.length, MAX_CELLS);
    for (let i = drawn; i < MAX_CELLS; i++) {
      hideMesh(plates[i]);
      domPlates[i].hide();
      hideRadialPrice(`${pricePrefix}${i}`);
      if (queueTallies[i]) hideMesh(queueTallies[i].mesh);
      if (extraTallies[i]) hideMesh(extraTallies[i].mesh);
      if (progressBars[i]) hideMesh(progressBars[i]);
    }
    for (const [key, batch] of icons) {
      if (!shownIcons.has(key)) hideIcon(batch);
    }
  }

  function hitRect(ray, cell) {
    if (!ray || !cell) return null;
    const hit = rayHitPlane(ray, cell.x, cell.y, cell.z, cell.nx, cell.ny, cell.nz);
    if (!hit) return null;
    const dx = hit.x - cell.x;
    const dy = hit.y - cell.y;
    const dz = hit.z - cell.z;
    const alongR = dx * cell.rx + dy * cell.ry + dz * cell.rz;
    const alongU = dx * cell.ux + dy * cell.uy + dz * cell.uz;
    if (Math.abs(alongR) <= cell.hw && Math.abs(alongU) <= cell.hh) return hit.t;
    return null;
  }

  function ensureBuildIcons() {
    const want = activeCategory;
    const items = itemsForCategory(want);
    return Promise.all([
      ...items.map((item) => loadIcon(item.id, BUILDING_MODEL_URLS[item.id])),
      loadIcon(headerIconKey('agora'), BUILDING_MODEL_URLS.agora),
    ]).then(() => {
      if (open && activeCategory === want && !placingPreviewType) layout();
    });
  }

  function ensureActionIcons(menu) {
    const want = activeMenuKey;
    /** @type {Promise<void>[]} */
    const jobs = [];
    for (const item of menu?.units ?? []) {
      const typeId = item.unitType ?? BUILDING_MENU_UNITS[item.id];
      const url = typeId != null ? resolveUnitModelUrl(typeId, localHudSkin(typeId)) : null;
      jobs.push(loadIcon(`unit:${item.id}`, url));
    }
    for (const item of menu?.upgrades ?? []) {
      jobs.push(loadIcon(`upgrade:${item.id}`, UPGRADE_MODEL_URLS[item.id]));
    }
    for (const item of menu?.buildings ?? []) {
      jobs.push(loadIcon(`building:${item.id}`, BUILDING_MODEL_URLS[item.id]));
    }
    if (buildingCanRally(activeBuildingType)) {
      jobs.push(loadIcon('rally:flag', RALLY_ICON_URL));
    }
    if (activeBuildingType) {
      jobs.push(loadIcon(headerIconKey(activeBuildingType), BUILDING_MODEL_URLS[activeBuildingType]));
    }
    return Promise.all(jobs).then(() => {
      if (open && activeMenuKey === want) layout();
    });
  }

  function showAt(x, z, buildingTypeOrCamera = null, camera = null, menuOverride = null) {
    anchorX = x;
    anchorZ = z;
    if (kind === 'build') {
      screen._camera = buildingTypeOrCamera;
      placingPreviewType = null;
      categoryLocked = false;
      hoverCat = null;
      rebuildItems();
      open = true;
      layout();
      void ensureBuildIcons();
      return;
    }
    const buildingType = buildingTypeOrCamera;
    const menu = menuOverride ?? getBuildingMenu(buildingType) ?? { units: [], upgrades: [], buildings: [] };
    screen._camera = camera;
    activeBuildingType = buildingType;
    activeMenu = menu;
    activeMenuKey = menuKeyOf(menu);
    hoverUtil = null;
    armed = null;
    prodPaused = false;
    tracks.clear();
    utilityAvailable = { pause: false, cancel: false };
    rebuildItems();
    open = true;
    layout();
    void ensureActionIcons(menu);
  }

  function update(camera) {
    if (!open) return;
    screen._camera = camera;
    layout();
  }

  function hide() {
    if (!open && !cells.length) {
      hideChrome();
      return;
    }
    open = false;
    hideChrome();
    itemSlots = [];
    hoverIndex = -1;
    hoverCat = null;
    hoverUtil = null;
    placingPreviewType = null;
    categoryLocked = false;
    activeBuildingType = null;
    activeMenu = null;
    activeMenuKey = '';
    armed = null;
  }

  function setCompact(typeId) {
    const next = typeof typeId === 'string' && typeId ? typeId : null;
    if (placingPreviewType === next) return;
    placingPreviewType = next;
    hoverIndex = -1;
    hoverCat = null;
    if (open) layout();
  }

  function setCategory(catId, opts = {}) {
    if (!CATEGORIES.some((c) => c.id === catId)) return;
    if (opts.lock) categoryLocked = true;
    if (catId === activeCategory && itemSlots.length) return;
    activeCategory = catId;
    rebuildItems();
    if (open) layout();
    void ensureBuildIcons();
  }

  function setHover(index) {
    const next = index | 0;
    const clamped = next >= 0 && next < itemSlots.length ? next : -1;
    if (clamped === hoverIndex && hoverCat == null && hoverUtil == null) return;
    hoverIndex = clamped;
    hoverCat = null;
    hoverUtil = null;
    if (open) layout();
  }

  function setHoverFromPick(pick) {
    if (!pick) {
      clearHover();
      return;
    }
    if (pick.kind === 'close') {
      hoverIndex = -1;
      hoverCat = null;
      hoverUtil = 'close';
      if (open) layout();
      return;
    }
    if (pick.kind === 'category') {
      hoverIndex = -1;
      hoverUtil = null;
      hoverCat = pick.id ?? null;
      if (open) layout();
      return;
    }
    if (pick.kind === 'rally') {
      hoverIndex = -1;
      hoverCat = null;
      hoverUtil = 'rally';
      if (open) layout();
      return;
    }
    if (pick.kind === 'pause' || pick.kind === 'cancel') {
      if (!utilityAvailable[pick.kind]) {
        clearHover();
        return;
      }
      hoverIndex = -1;
      hoverCat = null;
      hoverUtil = pick.kind;
      if (open) layout();
      return;
    }
    hoverCat = null;
    hoverUtil = null;
    hoverIndex = itemSlots.findIndex((s) => s.kind === pick.kind && s.id === pick.id);
    if (kind === 'build') {
      hoverIndex = itemSlots.findIndex((s) => s.id === pick.id);
    }
    if (open) layout();
  }

  function clearHover() {
    if (hoverIndex < 0 && !hoverCat && !hoverUtil) return;
    hoverIndex = -1;
    hoverCat = null;
    hoverUtil = null;
    if (open) layout();
  }

  function pickOptionAtRay(ray) {
    if (!open || !ray || placingPreviewType) return null;
    let best = null;
    let bestT = Infinity;
    for (const cell of cells) {
      if (!cell.pickable) continue;
      const t = hitRect(ray, cell);
      if (t == null || t >= bestT) continue;
      bestT = t;
      if (cell.kind === 'category') best = { kind: 'category', id: cell.id };
      else if (cell.kind === 'close') best = { kind: 'close' };
      else if (cell.kind === 'pause' || cell.kind === 'cancel' || cell.kind === 'rally') {
        best = { kind: cell.kind };
      }
      else best = { kind: cell.kind, id: cell.id };
    }
    return best;
  }

  function hitAtRay(ray) {
    if (!open || !ray || placingPreviewType) return false;
    if (pickOptionAtRay(ray)) return true;
    if (board?.frame && hitRect(ray, {
      x: board.frame.x,
      y: board.frame.y,
      z: board.frame.z,
      nx: board.frame.normal.x,
      ny: board.frame.normal.y,
      nz: board.frame.normal.z,
      rx: board.frame.right.x,
      ry: board.frame.right.y,
      rz: board.frame.right.z,
      ux: board.frame.up.x,
      uy: board.frame.up.y,
      uz: board.frame.up.z,
      hw: board.hw,
      hh: board.hh,
    }) != null) return true;
    return false;
  }

  function hitHubHoleAtRay(ray) {
    if (kind !== 'build' || !open || !ray || !placingPreviewType) return false;
    const gy = groundYAt?.(anchorX, anchorZ);
    const y = Number.isFinite(gy) ? gy : 0;
    const hit = rayHitPlane(ray, anchorX, y, anchorZ, 0, 1, 0);
    if (!hit) return false;
    const dx = hit.x - anchorX;
    const dz = hit.z - anchorZ;
    return dx * dx + dz * dz < PLACE_CANCEL_RADIUS * PLACE_CANCEL_RADIUS;
  }

  function stickTargets() {
    if (!open || placingPreviewType || !cells.length) return null;
    const inner = [];
    const outer = [];
    for (const cell of cells) {
      if (!cell.pickable) continue;
      const slice = {
        kind: cell.kind,
        ang: cell.ang,
        x: cell.sx,
        y: cell.sy,
        w: cell.sw,
        h: cell.sh,
      };
      if (cell.id != null) slice.id = cell.id;
      if (cell.ring === 'inner') inner.push(slice);
      else outer.push(slice);
    }
    return { inner, outer };
  }

  function setMenuGate(snapshot) {
    menuBank = snapshot?.bank ?? null;
    ownedTypes = snapshot?.ownedTypes instanceof Set
      ? snapshot.ownedTypes
      : new Set(snapshot?.ownedTypes ?? []);
    if (kind === 'build') {
      for (const slot of itemSlots) slot.gate = gateForBuilding(slot.id);
    } else {
      for (const slot of itemSlots) {
        slot.gate = slot.auto ? 'ok' : gateForAction(slot);
        if (slot.kind === 'upgrade' && researchedUpgrades.has(slot.id)) slot.gate = 'owned';
      }
    }
    if (open) layout();
  }

  return {
    showAt,
    update,
    hide,
    isOpen() { return open; },
    stickTargets,
    setCompact,
    setPlacingValid() {},
    setCategory,
    unlockCategory() { categoryLocked = false; },
    setHover,
    setHoverByType(type) {
      if (!type) setHover(-1);
      else setHover(itemSlots.findIndex((s) => s.id === type));
    },
    setHoverFromPick,
    clearHover,
    hoveredType() {
      if (!open || hoverIndex < 0) return null;
      return itemSlots[hoverIndex]?.id ?? null;
    },
    pickOptionAtRay,
    hitAtRay,
    hitHubHoleAtRay,
    registerLabels() {},
    disposeLabels() { hide(); },
    setMenuGate,
    setUtilityAvailability(avail) {
      if (avail?.cancel != null) utilityAvailable.cancel = Boolean(avail.cancel);
      if (avail?.pause != null) utilityAvailable.pause = Boolean(avail.pause);
      if (avail?.cancel == null && avail?.pause == null) syncCancelAvailability();
      if (open) layout();
    },
    setPaused(on) {
      prodPaused = Boolean(on);
      if (open) layout();
    },
    setResearchedUpgrades(ids) {
      researchedUpgrades.clear();
      if (ids) {
        if (Array.isArray(ids) || ids instanceof Set) {
          for (const id of ids) if (id) researchedUpgrades.add(String(id));
        } else {
          for (const [id, on] of Object.entries(ids)) if (on) researchedUpgrades.add(id);
        }
      }
      for (const slot of itemSlots) {
        if (slot.kind === 'upgrade' && researchedUpgrades.has(slot.id)) slot.gate = 'owned';
      }
      if (open) layout();
    },
    setTrackDisplay(next) {
      tracks.clear();
      const entries = next instanceof Map ? next.entries() : Object.entries(next ?? {});
      for (const [key, val] of entries) {
        if (!val) continue;
        tracks.set(key, {
          progress: Math.max(0, Math.min(1, Number(val.progress) || 0)),
          count: Math.max(0, val.count | 0),
          extra: Math.max(0, val.extra | 0),
        });
      }
      syncCancelAvailability();
      if (open) layout();
    },
    setArmed(id) {
      armed = id ?? null;
      if (open) layout();
    },
    clearTracks() {
      tracks.clear();
      syncCancelAvailability();
      if (armed === 'cancel') armed = null;
      if (open) layout();
    },
    getTracks() {
      /** @type {Record<string, { progress: number, count: number, extra: number }>} */
      const out = {};
      for (const [k, v] of tracks) out[k] = { ...v };
      return out;
    },
    getArmed() { return armed; },
    get category() { return activeCategory; },
    get categoryLocked() { return categoryLocked; },
    get buildingType() { return activeBuildingType; },
    get center() {
      return open ? { x: centerX, y: centerY, z: centerZ } : null;
    },
    get scale() { return 1; },
  };
}

export function createSceneBuildMenu(engine, scene, groundYAt, screen) {
  return createSceneCommandMenu(engine, scene, groundYAt, screen, 'build');
}

export function createSceneActionMenu(engine, scene, groundYAt, screen) {
  return createSceneCommandMenu(engine, scene, groundYAt, screen, 'action');
}
