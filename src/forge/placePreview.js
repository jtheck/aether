// Forge placement preview — the same building props and unit meshes as a match,
// stood on the authored tiles instead of colored boxes.

import {
  addToScene,
  flushThinInstances,
  setThinInstances,
  setThinInstanceColors,
} from '../vendor/lite/liteVendor.js';
import { createBuildingProps } from '../render/buildings.js';
import { MODEL_BASE_SCALE } from '../render/modelScale.js';
import { NAMED_UNIT_SCALE, isNamedUnit } from '../sim/namedUnit.js';
import { UNIT_MODEL_URLS, loadBakedUnitMeshParts } from '../render/unitModels.js';
import { VAT_UNIT_DEFS } from '../render/vatUnits.js';
import { ownerTint } from '../render/ownerTints.js';
import { isTeamColorMaterial, prepareTeamColorMaterial, sceneTeamRgb } from '../render/teamColor.js';

const FOOT_CLEARANCE = 0.06;

function previewUrl(type) {
  return UNIT_MODEL_URLS[type] || VAT_UNIT_DEFS[type]?.url || null;
}

function setCount(mesh, count) {
  const ti = mesh.thinInstances;
  if (!ti) return;
  ti.count = count;
  ti._version++;
  ti._dirtyMin = 0;
  ti._dirtyMax = count;
  mesh.visible = count > 0;
}

function writePose(matrices, slot, x, y, z, yaw, scale) {
  const o = slot * 16;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  matrices[o] = c * scale;
  matrices[o + 1] = 0;
  matrices[o + 2] = -s * scale;
  matrices[o + 3] = 0;
  matrices[o + 4] = 0;
  matrices[o + 5] = scale;
  matrices[o + 6] = 0;
  matrices[o + 7] = 0;
  matrices[o + 8] = s * scale;
  matrices[o + 9] = 0;
  matrices[o + 10] = c * scale;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
}

function growCap(needed, prev) {
  let cap = Math.max(4, prev | 0);
  while (cap < needed) cap *= 2;
  return cap;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 * @param {() => void} [onReady] After meshes and poses are written.
 */
export function createPlacePreview(engine, scene, groundYAt, onReady) {
  let disposed = false;
  let gen = 0;
  /** @type {Promise<object | null> | null} */
  let buildingPromise = null;
  /** @type {object | null} */
  let buildingProps = null;
  /** @type {Map<number, { layers: { mesh: object, team: boolean, matrices: Float32Array, colors: Float32Array, capacity: number }[] }>} */
  const unitBatches = new Map();
  /** @type {Map<number, Promise<{ mesh: object, team: boolean }[] | null>>} */
  const unitLoads = new Map();

  function ensureBuildings() {
    if (!buildingPromise) {
      buildingPromise = createBuildingProps(engine, scene, groundYAt).then((props) => {
        if (disposed) {
          props.clear?.();
          return null;
        }
        buildingProps = props;
        return props;
      }).catch((err) => {
        console.warn('[forge] building models failed', err);
        return null;
      });
    }
    return buildingPromise;
  }

  function ensureUnit(type) {
    const key = type | 0;
    let pending = unitLoads.get(key);
    if (pending) return pending;
    const url = previewUrl(key);
    if (!url) {
      pending = Promise.resolve(null);
      unitLoads.set(key, pending);
      return pending;
    }
    pending = loadBakedUnitMeshParts(engine, url).then((meshes) => {
      if (disposed) return null;
      const layers = meshes.map((mesh) => {
        mesh.pickable = false;
        const team = isTeamColorMaterial(mesh.material);
        if (team) prepareTeamColorMaterial(engine, mesh);
        addToScene(scene, mesh);
        return {
          mesh,
          team,
          matrices: new Float32Array(0),
          colors: new Float32Array(0),
          capacity: 0,
        };
      });
      unitBatches.set(key, { layers });
      return layers;
    }).catch((err) => {
      console.warn('[forge] unit model failed', url, err);
      return null;
    });
    unitLoads.set(key, pending);
    return pending;
  }

  function writeUnits(type, list) {
    const batch = unitBatches.get(type | 0);
    if (!batch?.layers.length) return;
    const needed = list.length;
    const cap = needed === 0 ? batch.layers[0].capacity : growCap(needed, batch.layers[0].capacity);
    for (const layer of batch.layers) {
      if (cap > layer.capacity) {
        layer.matrices = new Float32Array(cap * 16);
        layer.colors = new Float32Array(cap * 4);
        layer.colors.fill(1);
        setThinInstances(layer.mesh, layer.matrices, cap);
        setThinInstanceColors(layer.mesh, layer.colors);
        layer.capacity = cap;
      }
      for (let i = 0; i < needed; i++) {
        const u = list[i];
        const y = groundYAt(u.x, u.z) + FOOT_CLEARANCE;
        const scale = MODEL_BASE_SCALE * (isNamedUnit(u.name) ? NAMED_UNIT_SCALE : 1);
        writePose(layer.matrices, i, u.x, y, u.z, u.yaw || 0, scale);
        const tint = layer.team ? sceneTeamRgb(ownerTint(u.owner)) : [1, 1, 1];
        const o = i * 4;
        layer.colors[o] = tint[0];
        layer.colors[o + 1] = tint[1];
        layer.colors[o + 2] = tint[2];
        layer.colors[o + 3] = 1;
      }
      setThinInstanceColors(layer.mesh, layer.colors);
      setCount(layer.mesh, needed);
      flushThinInstances(layer.mesh);
    }
  }

  /**
   * @param {{ units: { owner: number, type: number, x: number, z: number }[], buildings: object[] }} payload
   */
  function sync(payload) {
    const token = ++gen;
    const units = payload.units ?? [];
    const buildings = payload.buildings ?? [];
    const byType = new Map();
    for (const u of units) {
      const type = u.type | 0;
      if (!previewUrl(type)) continue;
      let list = byType.get(type);
      if (!list) {
        list = [];
        byType.set(type, list);
      }
      list.push(u);
    }
    for (const type of unitBatches.keys()) {
      if (!byType.has(type)) writeUnits(type, []);
    }
    const jobs = [ensureBuildings()];
    for (const type of byType.keys()) jobs.push(ensureUnit(type));
    return Promise.all(jobs).then(() => {
      if (disposed || token !== gen) return;
      buildingProps?.place(buildings);
      for (const [type, list] of byType) writeUnits(type, list);
      onReady?.();
    });
  }

  function update(deltaMs) {
    buildingProps?.update?.(deltaMs);
  }

  return { sync, update };
}
