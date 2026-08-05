// Agora build menu — tilted annulus above the agora (EDGE_PIN_HUD gates
// screen-edge placement; currently off). Option angles stay screen-stable;
// hover/click uses CPU disc/sphere hits.

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
/** Lift pad rings (and icons) along the menu normal, off the base ring. */
const PAD_LIFT = 1.35;
/** Extra lift of icons along the menu normal above their pad ring. */
const ICON_LIFT = 0.85;
const OPTION_SCALE = 0.26;
/** Pick sphere around each icon (covers the mini building, not just the pad). */
const ICON_PICK_R = 5.5;
/**
 * Lean from horizontal toward the camera (not a full billboard).
 * ~32° — readable without standing the ring on end.
 */
const MENU_TILT = 0.56;
/**
 * Screen-edge pin (project agora → clamp → place on ray). Off for now — menu
 * stays above the agora. Flip to true when revisiting the HUD placement.
 */
const EDGE_PIN_HUD = false;
/**
 * Preferred depth from the camera eye (edge-pin path). Scale is tied to depth
 * so on-screen size stays steady. When the agora is closer, we pull in.
 */
const HUD_PLACE_DIST = 70;
const HUD_PLACE_MIN = 24;
const HUD_PLACE_FRAC = 0.82;
const HUD_REF_DIST = 110;
const HUD_BASE_SCALE = 1;
const HUD_SCALE_MIN = 0.35;
/** Inset so the whole ring stays inside the viewport when edge-pinned. */
const HUD_EDGE_MARGIN_FRAC = 0.2;
const MAX_OPTIONS = 8;

/** Opaque so depth wins — transparent sort otherwise draws far pads under the main ring. */
const MENU_RING_COLOR = [0.38, 0.62, 1.0];
const MENU_RING_EMISSIVE = [0.22, 0.42, 0.82];
/** Main ring only — sits above the world, so let terrain/units read through a bit. */
const MENU_RING_ALPHA = 0.55;
/** Item pads: distinct teal vs main blue (stay opaque for clean hover). */
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

/**
 * Thin-instance matrix: X=right, Y=up, Z=forward (column-major), uniform scale.
 * @param {Float32Array} matrices
 * @param {number} slot
 */
function writeFacingMatrix(matrices, slot, x, y, z, rx, ry, rz, ux, uy, uz, fx, fy, fz, scale) {
  const o = slot * 16;
  const sc = scale;
  matrices[o] = rx * sc;
  matrices[o + 1] = ry * sc;
  matrices[o + 2] = rz * sc;
  matrices[o + 3] = 0;
  matrices[o + 4] = ux * sc;
  matrices[o + 5] = uy * sc;
  matrices[o + 6] = uz * sc;
  matrices[o + 7] = 0;
  matrices[o + 8] = fx * sc;
  matrices[o + 9] = fy * sc;
  matrices[o + 10] = fz * sc;
  matrices[o + 11] = 0;
  matrices[o + 12] = x;
  matrices[o + 13] = y;
  matrices[o + 14] = z;
  matrices[o + 15] = 1;
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

function makeRingMaterial(diffuse, emissive, alpha = 1) {
  const mat = createStandardMaterial();
  mat.diffuseColor = [...diffuse];
  mat.emissiveColor = [...emissive];
  mat.alpha = alpha;
  if ('disableLighting' in mat) mat.disableLighting = true;
  if ('unlit' in mat) mat.unlit = true;
  if (mat.specularColor) mat.specularColor = [0, 0, 0];
  return mat;
}

/**
 * Ray × plane. Plane through (px,py,pz) with unit normal (nx,ny,nz).
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 */
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

/**
 * Nearest positive ray–sphere hit distance, or null.
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number }} ray
 */
function rayHitSphereT(ray, cx, cy, cz, radius) {
  const lx = ray.ox - cx;
  const ly = ray.oy - cy;
  const lz = ray.oz - cz;
  const b = ray.dx * lx + ray.dy * ly + ray.dz * lz;
  const c = lx * lx + ly * ly + lz * lz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = -b - root;
  if (t0 >= 0) return t0;
  const t1 = -b + root;
  return t1 >= 0 ? t1 : null;
}

/**
 * Place annulus (local Y = face normal) with camera-facing basis.
 * Basis columns: X=right, Y=normal(toCam), Z=planeZ (−screenUp).
 */
function placeMeshOriented(mesh, x, y, z, scale, rx, ry, rz, nx, ny, nz, tx, ty, tz) {
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
  const q = quatFromBasis(rx, ry, rz, nx, ny, nz, tx, ty, tz);
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
 * @param {{
 *   worldToScreen?: (x: number, y: number, z: number) => { x: number, y: number } | null,
 *   rayFromCanvas?: (canvasX: number, canvasY: number) => { ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null,
 *   getViewport?: () => { width: number, height: number },
 * }} [screen]
 */
export async function createBuildingRadialMenu(engine, scene, groundYAt, screen = {}) {
  const ringMat = makeRingMaterial(MENU_RING_COLOR, MENU_RING_EMISSIVE, MENU_RING_ALPHA);

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
  /** @type {{ type: string, ang: number, x: number, y: number, z: number }[]} */
  let slots = [];
  let open = false;
  let anchorX = 0;
  let anchorZ = 0;
  let centerX = 0;
  let centerZ = 0;
  let centerY = 0;
  let hudScale = 1;
  let hoverIndex = -1;
  // Menu basis: right (screen X), normal (tilted up), planeZ (−planeUp), planeUp.
  let bx = 1;
  let by = 0;
  let bz = 0;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  let tx = 0;
  let ty = 0;
  let tz = -1;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  // Horizontal toward-camera (for upright icon facing).
  let hx = 0;
  let hz = 1;

  function cameraEye(camera) {
    const wm = camera?.worldMatrix;
    if (
      wm &&
      Number.isFinite(wm[12]) &&
      Number.isFinite(wm[13]) &&
      Number.isFinite(wm[14])
    ) {
      return { x: wm[12], y: wm[13], z: wm[14] };
    }
    const p = camera?.position;
    if (
      p &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      Number.isFinite(p.z)
    ) {
      return { x: p.x, y: p.y, z: p.z };
    }
    // ArcRotate: eye = target + (r·cosα·sinβ, r·cosβ, r·sinα·sinβ).
    const t = camera?.target;
    const tx = t?.x ?? 0;
    const ty = t?.y ?? 0;
    const tz = t?.z ?? 0;
    const a = camera?.alpha ?? -Math.PI / 2.1;
    const b = camera?.beta ?? Math.PI / 3.2;
    const r = camera?.radius ?? 110;
    let sb = Math.sin(b);
    if (Math.abs(sb) < 1e-4) sb = 1e-4;
    const cb = Math.cos(b);
    return {
      x: tx + r * Math.cos(a) * sb,
      y: ty + r * cb,
      z: tz + r * Math.sin(a) * sb,
    };
  }

  /**
   * Tilt the menu toward the camera (fixed lean, not a billboard).
   * Option angles stay screen-stable: ang=−π/2 is screen-top.
   * Annulus local axes: X=right, Y=normal, Z=−planeUp.
   * @param {object | null | undefined} camera
   */
  function updateBasis(camera) {
    const eye = cameraEye(camera);
    let thx = eye.x - centerX;
    let thz = eye.z - centerZ;
    let hlen = Math.hypot(thx, thz);
    if (hlen < 1e-4) {
      const a = camera?.alpha ?? 0;
      thx = Math.cos(a);
      thz = Math.sin(a);
      hlen = 1;
    } else {
      thx /= hlen;
      thz /= hlen;
    }
    hx = thx;
    hz = thz;

    const st = Math.sin(MENU_TILT);
    const ct = Math.cos(MENU_TILT);
    // Lean toward camera azimuth; stay mostly horizontal.
    nx = thx * st;
    ny = ct;
    nz = thz * st;

    // Screen-right = worldUp × towardCamHorizontal.
    bx = thz;
    by = 0;
    bz = -thx;

    // planeUp = normal × right → toward screen-top on the tilted disc.
    let pux = ny * bz - nz * by;
    let puy = nz * bx - nx * bz;
    let puz = nx * by - ny * bx;
    const pulen = Math.hypot(pux, puy, puz) || 1;
    pux /= pulen;
    puy /= pulen;
    puz /= pulen;
    ux = pux;
    uy = puy;
    uz = puz;

    tx = -ux;
    ty = -uy;
    tz = -uz;
  }

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

  /** World scale for a given camera depth (∝ depth → steady on-screen size). */
  function scaleForPlaceDist(placeDist) {
    if (!Number.isFinite(placeDist) || placeDist < 1e-3) return HUD_BASE_SCALE;
    return Math.max(HUD_SCALE_MIN, HUD_BASE_SCALE * (placeDist / HUD_REF_DIST));
  }

  /** Sit above the agora; scale from eye distance. */
  function syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye) {
    const distA =
      Math.hypot(eye.x - agoraX, eye.y - agoraY, eye.z - agoraZ) || HUD_REF_DIST;
    hudScale = scaleForPlaceDist(distA);
    centerX = agoraX;
    centerY = agoraY + Math.sin(MENU_TILT) * RIM_R * hudScale + 1.2;
    centerZ = agoraZ;
    updateBasis(camera);
  }

  /**
   * Pose the menu. With EDGE_PIN_HUD: project agora → clamp → place on ray.
   * Otherwise: stay above the agora.
   * @param {object | null | undefined} camera
   */
  function syncPose(camera) {
    const eye = cameraEye(camera);
    const gy = groundYAt(anchorX, anchorZ);
    const groundY = Number.isFinite(gy) ? gy : 0;
    const agoraX = anchorX;
    const agoraY = groundY + MENU_Y;
    const agoraZ = anchorZ;

    if (!EDGE_PIN_HUD) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const distA =
      Math.hypot(eye.x - agoraX, eye.y - agoraY, eye.z - agoraZ) || HUD_PLACE_DIST;
    const placeDist = Math.min(
      HUD_PLACE_DIST,
      Math.max(HUD_PLACE_MIN, distA * HUD_PLACE_FRAC),
    );
    hudScale = scaleForPlaceDist(placeDist);

    const worldToScreen = screen.worldToScreen;
    const rayFromCanvas = screen.rayFromCanvas;
    const getViewport = screen.getViewport;

    // Fallback: sit above the agora if screen helpers aren't wired.
    if (!worldToScreen || !rayFromCanvas || !getViewport) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const vp = getViewport();
    const vw = vp?.width ?? 0;
    const vh = vp?.height ?? 0;
    if (vw < 8 || vh < 8) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    const margin = Math.min(vw, vh) * HUD_EDGE_MARGIN_FRAC;
    const scr = worldToScreen(agoraX, agoraY, agoraZ);
    let sx = vw * 0.5;
    let sy = vh * 0.5;
    if (scr && Number.isFinite(scr.x) && Number.isFinite(scr.y)) {
      sx = scr.x;
      sy = scr.y;
    }

    const cx = Math.min(vw - margin, Math.max(margin, sx));
    const cy = Math.min(vh - margin, Math.max(margin, sy));
    const ray = rayFromCanvas(cx, cy);
    if (!ray) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    // Aim along the screen ray, then sit at placeDist from the eye.
    const aimX = ray.ox + ray.dx * Math.max(placeDist, 10);
    const aimY = ray.oy + ray.dy * Math.max(placeDist, 10);
    const aimZ = ray.oz + ray.dz * Math.max(placeDist, 10);
    let ax = aimX - eye.x;
    let ay = aimY - eye.y;
    let az = aimZ - eye.z;
    const alen = Math.hypot(ax, ay, az);
    if (alen < 1e-6) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }
    ax /= alen;
    ay /= alen;
    az /= alen;

    const px = eye.x + ax * placeDist;
    const py = eye.y + ay * placeDist;
    const pz = eye.z + az * placeDist;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
      syncPoseAgora(camera, agoraX, agoraY, agoraZ, eye);
      return;
    }

    centerX = px;
    centerY = py;
    centerZ = pz;
    updateBasis(camera);
  }

  function redrawSlot(i) {
    const s = slots[i];
    if (!s) return;
    const iconScale = OPTION_SCALE * hudScale;
    const lift = ICON_LIFT * hudScale;
    const iconX = s.x + nx * lift;
    const iconY = s.y + ny * lift;
    const iconZ = s.z + nz * lift;
    const batch = icons.get(s.type);
    if (!batch) return;
    // Upright icons, yawed toward camera (right-handed: X×Y=Z, −Z toward camera).
    for (const layer of batch.layers) {
      writeFacingMatrix(
        layer.matrices,
        0,
        iconX,
        iconY,
        iconZ,
        -bx,
        0,
        -bz,
        0,
        1,
        0,
        -hx,
        0,
        -hz,
        iconScale,
      );
      setThinInstanceCount(layer.mesh, 1);
      flushThinInstances(layer.mesh);
    }
    applyIconHover(s.type, i === hoverIndex);
    applyPadHover(i, i === hoverIndex);
  }

  function layout() {
    const s = hudScale;
    // Annulus mesh outerR=1 → world outer = MENU_RING_OUTER * s
    placeMeshOriented(
      menuRing,
      centerX,
      centerY,
      centerZ,
      MENU_RING_OUTER * s,
      bx,
      by,
      bz,
      nx,
      ny,
      nz,
      tx,
      ty,
      tz,
    );

    const rimR = RIM_R * s;
    const padLift = PAD_LIFT * s;
    const n = slots.length;
    for (let i = 0; i < pads.length; i++) {
      if (i >= n) {
        hideMesh(pads[i].mesh);
        applyPadHover(i, false);
        continue;
      }
      const slot = slots[i];
      const ca = Math.cos(slot.ang);
      const sa = Math.sin(slot.ang);
      // Polar on the tilted plane; ang=−π/2 → screen-top.
      slot.x = centerX + (ca * bx + sa * tx) * rimR + nx * padLift;
      slot.y = centerY + (ca * by + sa * ty) * rimR + ny * padLift;
      slot.z = centerZ + (ca * bz + sa * tz) * rimR + nz * padLift;
      placeMeshOriented(
        pads[i].mesh,
        slot.x,
        slot.y,
        slot.z,
        PAD_OUTER * s,
        bx,
        by,
        bz,
        nx,
        ny,
        nz,
        tx,
        ty,
        tz,
      );
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
    hoverIndex = -1;
    syncPose(camera);

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
    syncPose(camera);
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

  function padPlanePoint() {
    const lift = PAD_LIFT * hudScale;
    return {
      x: centerX + nx * lift,
      y: centerY + ny * lift,
      z: centerZ + nz * lift,
    };
  }

  /**
   * Option under the cursor: pad disc (ring + hole) and/or icon sphere.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   * @returns {string | null}
   */
  function pickOptionAtRay(ray) {
    if (!open || !ray || !slots.length) return null;
    const pp = padPlanePoint();
    const padHit = rayHitPlane(ray, pp.x, pp.y, pp.z, nx, ny, nz);
    const padR = PAD_OUTER * hudScale;
    const padR2 = padR * padR;
    const iconR = ICON_PICK_R * hudScale;
    const iconLift = ICON_LIFT * hudScale;

    let bestType = null;
    let bestT = Infinity;

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];

      // Pad disc on the tilted menu plane (full disc including hole).
      if (padHit) {
        const dx = padHit.x - s.x;
        const dy = padHit.y - s.y;
        const dz = padHit.z - s.z;
        if (dx * dx + dy * dy + dz * dz <= padR2 && padHit.t < bestT) {
          bestT = padHit.t;
          bestType = s.type;
        }
      }

      // Icon volume — models sit above the pad and are larger than PAD_OUTER.
      const ix = s.x + nx * iconLift;
      const iy = s.y + ny * iconLift;
      const iz = s.z + nz * iconLift;
      const iconT = rayHitSphereT(ray, ix, iy, iz, iconR);
      if (iconT != null && iconT < bestT) {
        bestT = iconT;
        bestType = s.type;
      }
    }
    return bestType;
  }

  /**
   * Sync gesture: over an option (pad or icon) or the main ring band.
   * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
   */
  function hitAtRay(ray) {
    if (!open || !ray) return false;
    if (pickOptionAtRay(ray)) return true;
    const hit = rayHitPlane(ray, centerX, centerY, centerZ, nx, ny, nz);
    if (!hit) return false;
    const d = Math.hypot(hit.x - centerX, hit.y - centerY, hit.z - centerZ);
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
