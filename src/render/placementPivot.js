// Yaw pivot marker during building placement (footprint geometric center).

import {
  addToScene,
  createMeshFromData,
  createStandardMaterial,
} from '../vendor/lite/liteVendor.js';
import * as fx from '../sim/fixed.js';
import { buildingFootprintCenterWorld } from '../sim/buildings.js';
import { softDetachMesh } from './meshLifecycle.js';

const CROSS_ARM = 0.44;
const CROSS_W = 0.08;
const GROUND_LIFT = 0.1;
const PIN_H = 0.52;
const PIN_R = 0.055;
/** Above placement grid ink, under the ghost mesh (120). */
const PIVOT_RENDER_ORDER = 118;

function flatUpNormals(vertexCount) {
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) normals[i * 3 + 1] = 1;
  return normals;
}

function pushQuad(pos, idx, x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, base) {
  pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return base + 4;
}

/**
 * @param {object} engine
 * @param {object} scene
 * @param {(x: number, z: number) => number} groundYAt
 */
export function createPlacementPivotOverlay(engine, scene, groundYAt) {
  /** @type {object | null} */
  let mesh = null;
  let lastSig = '';

  function hide() {
    if (mesh) softDetachMesh(scene, mesh);
    mesh = null;
    lastSig = '';
  }

  function rebuild(px, pz, valid) {
    hide();
    const y0 = groundYAt(px, pz) + GROUND_LIFT;
    const y1 = y0 + PIN_H;
    const pos = [];
    const idx = [];
    let base = 0;
    const h = CROSS_ARM;
    const w = CROSS_W;

    base = pushQuad(pos, idx, px - h, y0, pz - w, px + h, y0, pz - w, px + h, y0, pz + w, px - h, y0, pz + w, base);
    base = pushQuad(pos, idx, px - w, y0, pz - h, px + w, y0, pz - h, px + w, y0, pz + h, px - w, y0, pz + h, base);

    base = pushQuad(pos, idx, px - PIN_R, y0, pz - PIN_R, px + PIN_R, y0, pz - PIN_R, px + PIN_R, y1, pz - PIN_R, px - PIN_R, y1, pz - PIN_R, base);
    base = pushQuad(pos, idx, px + PIN_R, y0, pz - PIN_R, px + PIN_R, y0, pz + PIN_R, px + PIN_R, y1, pz + PIN_R, px + PIN_R, y1, pz - PIN_R, base);
    base = pushQuad(pos, idx, px - PIN_R, y0, pz + PIN_R, px + PIN_R, y0, pz + PIN_R, px + PIN_R, y1, pz + PIN_R, px - PIN_R, y1, pz + PIN_R, base);
    base = pushQuad(pos, idx, px - PIN_R, y0, pz - PIN_R, px - PIN_R, y0, pz + PIN_R, px - PIN_R, y1, pz + PIN_R, px - PIN_R, y1, pz - PIN_R, base);

    const verts = pos.length / 3;
    mesh = createMeshFromData(engine, 'placement-yaw-pivot', new Float32Array(pos), flatUpNormals(verts), new Uint32Array(idx));
    const mat = createStandardMaterial();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.9;
    if (valid) {
      mat.diffuseColor = [0.42, 0.98, 0.78];
      mat.emissiveColor = [0.1, 0.38, 0.28];
    } else {
      mat.diffuseColor = [1, 0.42, 0.38];
      mat.emissiveColor = [0.45, 0.06, 0.05];
    }
    mesh.material = mat;
    mesh.renderOrder = PIVOT_RENDER_ORDER;
    mesh.pickable = false;
    addToScene(scene, mesh);
  }

  return {
    /**
     * @param {{ type: string, x: number, z: number, valid?: boolean } | null} pos Ghost snap (world).
     */
    setFocus(pos) {
      if (!pos?.type) {
        hide();
        return;
      }
      const center = buildingFootprintCenterWorld(pos.type, fx.fromFloat(pos.x), fx.fromFloat(pos.z));
      const valid = pos.valid !== false;
      const sig = `${pos.type}:${center.x.toFixed(4)}:${center.z.toFixed(4)}:${valid ? 1 : 0}`;
      if (sig === lastSig) return;
      lastSig = sig;
      rebuild(center.x, center.z, valid);
    },
    dispose() {
      hide();
    },
  };
}
