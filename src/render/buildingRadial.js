// Agora build menu — flat annulus rings + icons. HUD-scales with camera.
// Option hover/click uses CPU disc hits (full pad including hole), not GPU mesh picks.

import {
  addToScene,
  createMeshFromData,
  createStandardMaterial,
  flushThinInstances,
  setThinInstances,
  markMaterialUboDirty,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { PLACEABLE_BUILDINGS } from '../sim/buildings.js';

/** Layout at HUD scale = 1 (ring outer radius in world units). */
const MENU_Y = 2.4;
const MENU_RING_OUTER = 16;
const MENU_RING_INNER = 13.2;
const MENU_RING_H = 0.35;
const RIM_R = (MENU_RING_OUTER + MENU_RING_INNER) * 0.5;
const PAD_OUTER = 2.6;
const PAD_INNER = 1.7;
const PAD_H = 0.22;
/** Lift pad rings (and icons) above the base menu ring. */
const PAD_LIFT = 1.35;
/** Extra lift of icons above their pad ring. */
const ICON_LIFT = 0.85;
const OPTION_SCALE = 0.26;
const HUD_SCALE_AT_NEAR = 0.28;
const HUD_SCALE_AT_FAR = 2.75;
const MAX_OPTIONS = 8;

/** Opaque so depth wins — transparent sort otherwise draws far pads under the main ring. */
const MENU_RING_COLOR = [0.38, 0.62, 1.0];
const MENU_RING_EMISSIVE = [0.22, 0.42, 0.82];
/** Item pads: distinct teal vs main blue. */
const PAD_COLOR = [0.25, 0.82, 0.72];
const PAD_EMISSIVE = [0.12, 0.55, 0.48];
const PAD_HOVER_COLOR = [1, 0.85, 0.25];
const PAD_HOVER_EMISSIVE = [0.95, 0.7, 0.15];

const MODEL_URLS = {
  barracks: '/assets/models/barracks.glb',
  farm: '/assets/models/farm.glb',
  church: '/assets/models/church.glb',
  tavern: '/assets/models/tavern.glb',
  perch: '/assets/models/perch.glb',
};

/**
 * Flat washer / annulus in XZ (Y up). Unit scale: outer radius = 1.
 * @param {object} engine
 * @param {string} name
 * @param {{ inner?: number, height?: number, segments?: number }} [opts]
 *   inner = innerRadius / outerRadius (0..1). height in units of outer radius.
 */
function createAnnulusMesh(engine, name, opts = {}) {
  const innerFrac = opts.inner ?? 0.75;
  const h = opts.height ?? 0.04;
  const segments = opts.segments ?? 48;
  const ro = 1;
  const ri = Math.max(0.05, Math.min(0.95, innerFrac));
  const y0 = -h * 0.5;
  const y1 = h * 0.5;

  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const normals = [];
  /** @type {number[]} */
  const indices = [];

  function pushVert(x, y, z, nx, ny, nz) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    return positions.length / 3 - 1;
  }

  // Top + bottom caps
  for (let cap = 0; cap < 2; cap++) {
    const y = cap === 0 ? y1 : y0;
    const ny = cap === 0 ? 1 : -1;
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ro, y, s * ro, 0, ny, 0);
      pushVert(c * ri, y, s * ri, 0, ny, 0);
    }
    for (let i = 0; i < segments; i++) {
      const i0 = base + i * 2;
      const i1 = base + ((i + 1) % segments) * 2;
      const o0 = i0;
      const o1 = i1;
      const n0 = i0 + 1;
      const n1 = i1 + 1;
      if (cap === 0) {
        indices.push(o0, o1, n1, o0, n1, n0);
      } else {
        indices.push(o0, n1, o1, o0, n0, n1);
      }
    }
  }

  // Outer wall
  {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ro, y0, s * ro, c, 0, s);
      pushVert(c * ro, y1, s * ro, c, 0, s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % segments) * 2;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // Inner wall
  {
    const base = positions.length / 3;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pushVert(c * ri, y0, s * ri, -c, 0, -s);
      pushVert(c * ri, y1, s * ri, -c, 0, -s);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      const b = base + ((i + 1) % segments) * 2;
      indices.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }

  return createMeshFromData(
    engine,
    name,
    new Float32Array(positions),
    new Float32Array(normals),
    new Uint32Array(indices),
  );
}

function setThinInstanceCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  if (count > ti._capacity) {
    throw new Error(`thin-instance count ${count} exceeds capacity ${ti._capacity}`);
  }
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
  mesh.visible = count > 0;
}

function writeMatrix(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sc = scale;
  matrices[o] = c * sc;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = sc;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * sc;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function makeRingMaterial(diffuse, emissive) {
  const mat = createStandardMaterial();
  mat.diffuseColor = [...diffuse];
  mat.emissiveColor = [...emissive];
  // Opaque: transparent back-to-front sort puts far pads under the main ring.
  mat.alpha = 1;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  return mat;
}

/** @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray */
function rayHitPlaneY(ray, y) {
  if (Math.abs(ray.dy) < 1e-8) return null;
  const t = (y - ray.oy) / ray.dy;
  if (t < 0) return null;
  return { x: ray.ox + ray.dx * t, z: ray.oz + ray.dz * t, t };
}

function placeMesh(mesh, x, y, z, scaleXZ, scaleY = scaleXZ) {
  if (mesh.position) {
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;
  }
  if (mesh.scaling) {
    mesh.scaling.x = scaleXZ;
    mesh.scaling.y = scaleY;
    mesh.scaling.z = scaleXZ;
  }
  mesh.visible = true;
  mesh.markLocalDirty?.();
}

function hideMesh(mesh) {
  mesh.visible = false;
  if (mesh.position) mesh.position.y = -9999;
  mesh.markLocalDirty?.();
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createBuildingRadialMenu(engine, scene, groundYAt) {
  const ringMat = makeRingMaterial(MENU_RING_COLOR, MENU_RING_EMISSIVE);

  // Menu ring: annulus authored at outerR=1 → scale XZ to MENU_RING_OUTER.
  const menuRing = createAnnulusMesh(engine, 'build-menu-ring', {
    inner: MENU_RING_INNER / MENU_RING_OUTER,
    height: MENU_RING_H / MENU_RING_OUTER,
    segments: 64,
  });
  menuRing.material = ringMat;
  menuRing.pickable = false;
  menuRing.renderOrder = 210;
  hideMesh(menuRing);
  addToScene(scene, menuRing);

  /** Pad rings under each option — own material so hover can recolor. */
  /** @type {{ mesh: object, mat: object }[]} */
  const pads = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const pad = createAnnulusMesh(engine, `build-menu-pad-${i}`, {
      inner: PAD_INNER / PAD_OUTER,
      height: PAD_H / PAD_OUTER,
      segments: 28,
    });
    const mat = makeRingMaterial(PAD_COLOR, PAD_EMISSIVE);
    pad.material = mat;
    pad.pickable = false;
    pad.renderOrder = 220;
    hideMesh(pad);
    addToScene(scene, pad);
    pads.push({ mesh: pad, mat });
  }

  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null }[] }>} */
  const icons = new Map();

  for (const def of PLACEABLE_BUILDINGS) {
    const url = MODEL_URLS[def.id];
    if (!url) continue;
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      /** @type {{ mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null }[]} */
      const layers = [];
      for (const mesh of parts) {
        mesh.position.x = 0;
        mesh.position.y = 0;
        mesh.position.z = 0;
        // Hover/click uses CPU pad discs — icons need not be GPU-pickable.
        mesh.pickable = false;
        const mat = mesh.material;
        let baseEmissive = null;
        let baseDiffuse = null;
        if (mat) {
          if (mat.emissiveColor) baseEmissive = [...mat.emissiveColor];
          else {
            mat.emissiveColor = [0, 0, 0];
            baseEmissive = [0, 0, 0];
          }
          if (mat.diffuseColor) baseDiffuse = [...mat.diffuseColor];
        }
        const matrices = new Float32Array(16);
        setThinInstances(mesh, matrices, 1);
        setThinInstanceCount(mesh, 0);
        addToScene(scene, mesh);
        layers.push({ mesh, matrices, baseEmissive, baseDiffuse });
      }
      icons.set(def.id, { layers });
    } catch (err) {
      console.warn(`[buildingRadial] icon ${def.id} failed`, err);
    }
  }

  const items = PLACEABLE_BUILDINGS.filter((b) => icons.has(b.id));
  /** @type {{ type: string, ang: number, x: number, y: number, z: number, yaw: number }[]} */
  let slots = [];
  let open = false;
  let anchorX = 0;
  let anchorZ = 0;
  let centerX = 0;
  let centerZ = 0;
  let centerY = 0;
  let hudScale = 1;
  let hoverIndex = -1;

  function hideAllIcons() {
    for (const batch of icons.values()) {
      for (const layer of batch.layers) {
        setThinInstanceCount(layer.mesh, 0);
        flushThinInstances(layer.mesh);
        if (layer.baseEmissive && layer.mesh.material?.emissiveColor) {
          layer.mesh.material.emissiveColor = [...layer.baseEmissive];
        }
        if (layer.baseDiffuse && layer.mesh.material?.diffuseColor) {
          layer.mesh.material.diffuseColor = [...layer.baseDiffuse];
        }
      }
    }
  }

  function applyPadHover(index, hovered) {
    const pad = pads[index];
    if (!pad) return;
    const mat = pad.mat;
    if (hovered) {
      mat.diffuseColor = [...PAD_HOVER_COLOR];
      mat.emissiveColor = [...PAD_HOVER_EMISSIVE];
    } else {
      mat.diffuseColor = [...PAD_COLOR];
      mat.emissiveColor = [...PAD_EMISSIVE];
    }
    markMaterialUboDirty(mat);
  }

  function applyIconHover(type, hovered) {
    const batch = icons.get(type);
    if (!batch) return;
    for (const layer of batch.layers) {
      const mat = layer.mesh.material;
      if (!mat) continue;
      if (hovered) {
        if (mat.emissiveColor && layer.baseEmissive) {
          mat.emissiveColor = [
            Math.min(1, layer.baseEmissive[0] + 0.65),
            Math.min(1, layer.baseEmissive[1] + 0.7),
            Math.min(1, layer.baseEmissive[2] + 0.35),
          ];
        }
        if (mat.diffuseColor && layer.baseDiffuse) {
          mat.diffuseColor = [
            Math.min(1, layer.baseDiffuse[0] * 0.55 + 0.55),
            Math.min(1, layer.baseDiffuse[1] * 0.55 + 0.7),
            Math.min(1, layer.baseDiffuse[2] * 0.55 + 0.35),
          ];
        }
      } else {
        if (mat.emissiveColor && layer.baseEmissive) {
          mat.emissiveColor = [...layer.baseEmissive];
        }
        if (mat.diffuseColor && layer.baseDiffuse) {
          mat.diffuseColor = [...layer.baseDiffuse];
        }
      }
      markMaterialUboDirty(mat);
    }
  }

  function scaleForCamera(camera) {
    const minR = camera?.lowerRadiusLimit ?? 40;
    const maxR = camera?.upperRadiusLimit ?? 400;
    const r = camera?.radius ?? (minR + maxR) * 0.5;
    const t = Math.min(1, Math.max(0, (r - minR) / Math.max(1e-6, maxR - minR)));
    return HUD_SCALE_AT_NEAR + t * (HUD_SCALE_AT_FAR - HUD_SCALE_AT_NEAR);
  }

  function redrawSlot(i) {
    const s = slots[i];
    if (!s) return;
    const iconScale = OPTION_SCALE * hudScale;
    const iconY = s.y + ICON_LIFT * hudScale;
    const batch = icons.get(s.type);
    if (!batch) return;
    for (const layer of batch.layers) {
      writeMatrix(layer.matrices, 0, s.x, iconY, s.z, s.yaw, iconScale);
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
    }
    applyIconHover(s.type, i === hoverIndex);
    applyPadHover(i, i === hoverIndex);
  }

  function layout() {
    const s = hudScale;
    // Annulus mesh outerR=1 → world outer = MENU_RING_OUTER * s
    placeMesh(menuRing, centerX, centerY, centerZ, MENU_RING_OUTER * s, MENU_RING_OUTER * s);

    const rimR = RIM_R * s;
    const padY = centerY + PAD_LIFT * s;
    const n = slots.length;
    for (let i = 0; i < pads.length; i++) {
      if (i >= n) {
        hideMesh(pads[i].mesh);
        applyPadHover(i, false);
        continue;
      }
      const slot = slots[i];
      slot.x = centerX + Math.cos(slot.ang) * rimR;
      slot.z = centerZ + Math.sin(slot.ang) * rimR;
      slot.y = padY;
      slot.yaw = slot.ang + Math.PI;
      placeMesh(pads[i].mesh, slot.x, slot.y, slot.z, PAD_OUTER * s, PAD_OUTER * s);
      redrawSlot(i);
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {object | null} [camera]
   */
  function showAt(x, z, camera = null) {
    anchorX = x;
    anchorZ = z;
    centerX = x;
    centerZ = z;
    centerY = groundYAt(x, z) + MENU_Y;
    hoverIndex = -1;
    hudScale = scaleForCamera(camera);

    const n = Math.min(MAX_OPTIONS, items.length);
    slots = [];
    hideAllIcons();

    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
      slots.push({
        type: items[i].id,
        ang,
        x: 0,
        y: centerY,
        z: 0,
        yaw: 0,
      });
    }
    open = true;
    layout();
  }

  /**
   * @param {object} camera
   */
  function update(camera) {
    if (!open) return;
    centerX = anchorX;
    centerZ = anchorZ;
    centerY = groundYAt(anchorX, anchorZ) + MENU_Y;
    const next = scaleForCamera(camera);
    if (Math.abs(next - hudScale) < 0.0005) {
      if (slots.length && Math.abs(slots[0].y - centerY) > 0.01) layout();
      return;
    }
    hudScale = next;
    layout();
  }

  function hide() {
    if (!open) return;
    hideMesh(menuRing);
    for (let i = 0; i < pads.length; i++) {
      hideMesh(pads[i].mesh);
      applyPadHover(i, false);
    }
    hideAllIcons();
    slots = [];
    hoverIndex = -1;
    open = false;
  }

  function isOpen() {
    return open;
  }

  function setHover(index) {
    if (!open) return;
    const next = index | 0;
    if (next === hoverIndex) return;
    const prev = hoverIndex;
    hoverIndex = next >= 0 && next < slots.length ? next : -1;
    if (prev >= 0) {
      applyIconHover(slots[prev].type, false);
      applyPadHover(prev, false);
    }
    if (hoverIndex >= 0) {
      applyIconHover(slots[hoverIndex].type, true);
      applyPadHover(hoverIndex, true);
    }
  }

  /** @param {string | null | undefined} type */
  function setHoverByType(type) {
    if (!type) {
      setHover(-1);
      return;
    }
    setHover(slots.findIndex((s) => s.type === type));
  }

  function clearHover() {
    setHover(-1);
  }

  function hoveredType() {
    if (!open || hoverIndex < 0) return null;
    return slots[hoverIndex]?.type ?? null;
  }

  function padPlaneY() {
    return centerY + PAD_LIFT * hudScale;
  }

  /**
   * Full option disc (ring + hole) under the cursor ray.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   * @returns {string | null}
   */
  function pickOptionAtRay(ray) {
    if (!open || !ray || !slots.length) return null;
    const hit = rayHitPlaneY(ray, padPlaneY());
    if (!hit) return null;
    const r = PAD_OUTER * hudScale;
    const r2 = r * r;
    let bestType = null;
    let bestD2 = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const dx = hit.x - s.x;
      const dz = hit.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2 && d2 < bestD2) {
        bestD2 = d2;
        bestType = s.type;
      }
    }
    return bestType;
  }

  /**
   * Sync gesture: over an option disc or the main ring band.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   */
  function hitAtRay(ray) {
    if (!open || !ray) return false;
    if (pickOptionAtRay(ray)) return true;
    const hit = rayHitPlaneY(ray, centerY);
    if (!hit) return false;
    const d = Math.hypot(hit.x - centerX, hit.z - centerZ);
    const outer = MENU_RING_OUTER * hudScale;
    const inner = MENU_RING_INNER * hudScale;
    return d >= inner && d <= outer;
  }

  return {
    showAt,
    update,
    hide,
    isOpen,
    setHover,
    setHoverByType,
    clearHover,
    hoveredType,
    pickOptionAtRay,
    hitAtRay,
    get center() {
      return open ? { x: centerX, y: centerY, z: centerZ } : null;
    },
    get scale() {
      return hudScale;
    },
  };
}
