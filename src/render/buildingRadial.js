// In-engine agora build radial — hollow ring + rim building icons.
// Icons sit on the ring (selection-collar height). World size tracks camera distance.

import {
  addToScene,
  createTube,
  createStandardMaterial,
  flushThinInstances,
  setThinInstances,
  markMaterialUboDirty,
} from '../vendor/lite/liteVendor.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { PLACEABLE_BUILDINGS } from '../sim/buildings.js';

/**
 * Layout at HUD ref distance (scale = 1).
 * Ring matches selection-collar height; wide rim so icons aren't piled on each other.
 */
const COLLAR_Y_LIFT = 1.35;
const RING_R = 18;
const RING_TUBE = 0.55;
/** Icons sit on the ring path (same radius as the tube centerline). */
const RIM_R = 18;
const OPTION_SCALE = 0.26;
/**
 * HUD scale tracks camera.radius across the full zoom range (not a narrow
 * distance band that plateaus for most of the scroll).
 */
const HUD_SCALE_AT_NEAR = 0.28;
const HUD_SCALE_AT_FAR = 2.75;
const MAX_OPTIONS = 8;

const MODEL_URLS = {
  barracks: '/assets/models/barracks.glb',
  farm: '/assets/models/farm.glb',
  church: '/assets/models/church.glb',
  tavern: '/assets/models/tavern.glb',
  perch: '/assets/models/perch.glb',
};

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

function circlePath(radius, segments = 64) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
  }
  return pts;
}

/** Ignore a single junk low vertex — use lower-quartile of per-part mins. */
function robustFootY(parts) {
  const mins = parts.map((m) => m.boundMin?.[1] ?? 0);
  mins.sort((a, b) => a - b);
  const idx = Math.min(mins.length - 1, Math.floor((mins.length - 1) * 0.25));
  return mins[idx];
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export async function createBuildingRadialMenu(engine, scene, groundYAt) {
  const ring = createTube(engine, {
    path: circlePath(RING_R, 72),
    radius: RING_TUBE,
    tessellation: 10,
  });
  const ringMat = createStandardMaterial();
  ringMat.diffuseColor = [0.22, 0.28, 0.38];
  ringMat.emissiveColor = [0.18, 0.28, 0.45];
  ringMat.alpha = 0.88;
  ring.material = ringMat;
  ring.pickable = false;
  const ringMatrices = new Float32Array(16);
  setThinInstances(ring, ringMatrices, 1);
  setThinInstanceCount(ring, 0);
  addToScene(scene, ring);

  /** @type {Map<string, { layers: { mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null }[], footY: number }>} */
  const icons = new Map();
  /** @type {Map<object, string>} */
  const pickMeshes = new Map();

  for (const def of PLACEABLE_BUILDINGS) {
    const url = MODEL_URLS[def.id];
    if (!url) continue;
    try {
      const parts = await loadBakedUnitMeshParts(engine, url);
      const footY = robustFootY(parts);
      /** @type {{ mesh: object, matrices: Float32Array, baseEmissive: number[] | null, baseDiffuse: number[] | null }[]} */
      const layers = [];
      for (const mesh of parts) {
        // Bake sole into instance Y — don't rely on mesh.position with thin instances.
        mesh.position.x = 0;
        mesh.position.y = 0;
        mesh.position.z = 0;
        mesh.pickable = true;
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
        pickMeshes.set(mesh, def.id);
      }
      icons.set(def.id, { layers, footY });
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
  /** Ring centerline Y (selection-collar height). */
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
      }
    }
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

  /** Top of the tube ring — icons' soles rest here. */
  function ringTopY() {
    return centerY + RING_TUBE * hudScale;
  }

  function redrawSlot(i) {
    const s = slots[i];
    if (!s) return;
    const iconScale = OPTION_SCALE * hudScale;
    const batch = icons.get(s.type);
    if (!batch) return;
    // Sole on ring top: worldY + footY * scale = ringTop (footY is mesh-local min).
    const iconY = ringTopY() - batch.footY * iconScale;
    for (const layer of batch.layers) {
      writeMatrix(layer.matrices, 0, s.x, iconY, s.z, s.yaw, iconScale);
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
    }
    applyIconHover(s.type, i === hoverIndex);
  }

  function layout() {
    const rimR = RIM_R * hudScale;
    writeMatrix(ringMatrices, 0, centerX, centerY, centerZ, 0, hudScale);
    setThinInstanceCount(ring, 1);
    flushThinInstances(ring);

    const top = ringTopY();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      s.x = centerX + Math.cos(s.ang) * rimR;
      s.z = centerZ + Math.sin(s.ang) * rimR;
      s.y = top;
      s.yaw = s.ang + Math.PI;
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
    // Same lift as the selection collar — menu sits on that base.
    centerY = groundYAt(x, z) + COLLAR_Y_LIFT;
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
   * Per-frame: keep menu readable across the full zoom range.
   * @param {object} camera
   */
  function update(camera) {
    if (!open) return;
    centerX = anchorX;
    centerZ = anchorZ;
    centerY = groundYAt(anchorX, anchorZ) + COLLAR_Y_LIFT;
    const next = scaleForCamera(camera);
    if (Math.abs(next - hudScale) < 0.0005) {
      const top = ringTopY();
      if (slots.length && Math.abs(slots[0].y - top) > 0.01) layout();
      return;
    }
    hudScale = next;
    layout();
  }

  function hide() {
    if (!open) return;
    setThinInstanceCount(ring, 0);
    flushThinInstances(ring);
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
    // Color only — never rescale / lift the model.
    if (prev >= 0) applyIconHover(slots[prev].type, false);
    if (hoverIndex >= 0) applyIconHover(slots[hoverIndex].type, true);
  }

  /** @param {string | null | undefined} type */
  function setHoverByType(type) {
    if (!type) {
      setHover(-1);
      return;
    }
    const idx = slots.findIndex((s) => s.type === type);
    setHover(idx);
  }

  function clearHover() {
    setHover(-1);
  }

  function hoveredType() {
    if (!open || hoverIndex < 0) return null;
    return slots[hoverIndex]?.type ?? null;
  }

  function hitRingBand(wx, wz) {
    if (!open) return false;
    const dx = wx - centerX;
    const dz = wz - centerZ;
    const d = Math.hypot(dx, dz);
    const rim = RIM_R * hudScale;
    const tube = RING_TUBE * hudScale * 4;
    return d >= rim - tube && d <= rim + tube;
  }

  function typeAtSlot(index) {
    if (index < 0 || index >= slots.length) return null;
    return slots[index].type;
  }

  function isPickMesh(mesh) {
    return open && pickMeshes.has(mesh);
  }

  /**
   * @param {object} mesh
   * @returns {string | null}
   */
  function resolvePick(mesh) {
    if (!open) return null;
    const type = pickMeshes.get(mesh);
    if (!type) return null;
    return slots.some((s) => s.type === type) ? type : null;
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
    hitRingBand,
    typeAtSlot,
    isPickMesh,
    resolvePick,
    get center() {
      return open ? { x: centerX, y: centerY, z: centerZ } : null;
    },
    get scale() {
      return hudScale;
    },
  };
}
