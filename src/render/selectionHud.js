// Selection HUD - a camera-locked row of chips across the top of the screen
// (v1's 3D selection panel, reimagined for Lite/WebGPU). Each distinct selected
// unit or building type shows a small 3D model icon plus a native-text name
// with the count on the line above. Health chips sit on the top of each
// portrait, on the screen plane (the same facing as the field chips) so a
// wide row does not keystone with the icon. The icons are real scene meshes
// placed on a screen
// ray at a fixed depth, so the strip reads as a rigid HUD without living in
// the DOM.

import {
  addToScene,
  createDefaultTextData,
  createMeshFromData,
  createTextLayer,
  createTextRenderer,
  disposeDefaultTextData,
  disposeTextRenderer,
  registerTextRenderer,
  createShaderMaterial,
  loadTexture2D,
  setShaderTexture,
  setShaderUniform,
  setSubtreeVisible,
  updateDefaultTextData,
} from '../vendor/lite/liteVendor.js';
import { bakedSpriteUrl } from './bakedAssets.js';
import { assetUrl } from './assetRev.js';
import { loadBakedUnitMeshParts } from './unitModels.js';
import { loadIdleIconMeshes } from './vatUnits.js';
import { formatGameNumber } from '../sim/formatGameNumber.js';
import { localHudSkin, resolveUnitModelUrl } from '../app/dlcCatalog.js';
import {
  BUILDING_MODEL_URLS,
  getBuildingDisplayName,
} from '../sim/buildings.js';
import { getUnitDef, isTransport } from '../sim/unitTypes.js';
import { isManaCaster, manaReadyCount } from '../sim/mana.js';
import { unitMaxHp } from '../sim/namedUnit.js';
import {
  BUILDING_CHIP_COUNT,
  UNIT_CHIP_COUNT,
  chipBarFilled,
  chipBarState,
  underDotCount,
  underDotTint,
} from './healthBars.js';
import { ownerTint } from './ownerTints.js';
import { xrEye, xrHudOvalTopArcPoint } from './xrEye.js';

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
 * ICON_DEPTH, then centered on its slot - so chips read as evenly sized buttons
 * regardless of the source model's proportions. Paired with ICON_DEPTH so
 * on-screen size matches the original 1.55-at-28 look.
 */
const UNIT_ICON_WORLD = 1.55 * (0.8 / 28);
/** Preferred horizontal spacing between chips (CSS px); compressed to fit. */
const SLOT_PX = 112;
/**
 * Portrait size in CSS pixels. Sprites are already framed, so this stays put
 * when the camera zooms. The old mesh scale changed with field of view and
 * resampled the bitmap.
 */
const SPRITE_PX = 68;
/** Keep the whole row inside the viewport with this side inset (CSS px). */
const EDGE_MARGIN = 44;
/**
 * Icon center, CSS px below the top edge. Dropped enough that the health
 * row above the portrait stays under the clock.
 */
const TOP_MARGIN = 108;
/** Count sits in the icon (CSS px below the icon center). */
const COUNT_DY = 14;
/** Name just under the model (CSS px). */
const NAME_DY = 32;
/** Health chips never sit closer to the top edge than this (CSS px). */
const BAR_TOP_INSET = 40;
/** Clickable rect around the icon + labels (CSS px). Narrower than slot pitch. */
const HIT_W_PX = 56;
const HIT_UP_PX = 64;
const HIT_DOWN_PX = 48;
/** Hover: slight scale-up, lift toward the top, and a brighter wash. */
const HOVER_SCALE = 0.1;
const HOVER_LIFT_PX = 5;
const HOVER_LERP = 14;
const LABEL_FONT_SIZE = 18;
const LABEL_SCREEN_SCALE = 0.72;
/** A little brighter than `--pop-ink` (`#b8c0cc`). */
const LABEL_COLOR = [212 / 255, 219 / 255, 228 / 255, 1];
const LABEL_OPACITY = 0.92;
/** After radials (~225) so the strip paints last. */
const HUD_RENDER_ORDER = 420;
const AGORA_MODEL_URL = '/assets/models/agora.glb';

const BUILDING_ICON_URLS = {
  agora: AGORA_MODEL_URL,
  ...BUILDING_MODEL_URLS,
};

/**
 * Chip identity for input. `ids` / `members` are the units or buildings
 * already in this portrait. A single click keeps those; a double click
 * selects every matching unit or building on the map.
 * @param {{ kind?: string, typeId?: number, typeKey?: string, entityId?: number, ids?: number[], members?: { kind: string, index: number }[] }} group
 * @returns {{ kind: 'unit', typeId: number, entityId?: number, ids?: number[] } | { kind: 'building', typeKey: string, members?: { kind: string, index: number }[] } | null}
 */
export function selectionHudSlot(group) {
  if (!group) return null;
  if (group.kind === 'building' && group.typeKey != null) {
    const slot = { kind: 'building', typeKey: String(group.typeKey) };
    if (group.members) slot.members = group.members;
    return slot;
  }
  if (group.typeId != null) {
    const slot = { kind: 'unit', typeId: group.typeId | 0 };
    if (group.entityId != null) slot.entityId = group.entityId | 0;
    if (group.ids) slot.ids = group.ids;
    return slot;
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
 * Pooled health for one selection chip. `null` when the row has no HP
 * (an agora, or a building with no max). Mana and seats show only for a
 * single unit — a type pile has no one bank to copy.
 * @typedef {{
 *   ratio: number,
 *   hp: number,
 *   owner: number,
 *   building: boolean,
 *   manaReady: number,
 *   seatsFilled: number,
 * }} SelectionBar
 */

function emptyStat(building) {
  return {
    hpSum: 0,
    maxSum: 0,
    minHp: Infinity,
    owner: 0,
    manaReady: 0,
    seatsFilled: 0,
    n: 0,
    building: !!building,
  };
}

function noteHp(stat, hp, maxHp, owner) {
  const max = maxHp | 0;
  if (max <= 0) return;
  const cur = Math.max(0, hp | 0);
  if (stat.n === 0) stat.owner = owner | 0;
  stat.hpSum += cur;
  stat.maxSum += max;
  if (cur < stat.minHp) stat.minHp = cur;
  stat.n += 1;
}

/** @returns {SelectionBar | null} */
function finishBar(stat) {
  if (!stat || stat.n <= 0 || !(stat.maxSum > 0)) return null;
  const single = stat.n === 1;
  const drained = stat.minHp <= 1 && stat.hpSum <= stat.n;
  const hp = single || drained
    ? stat.minHp | 0
    : Math.max(2, Math.round(stat.hpSum / stat.n));
  return {
    ratio: stat.hpSum / stat.maxSum,
    hp,
    owner: stat.owner | 0,
    building: !!stat.building,
    manaReady: single ? stat.manaReady | 0 : 0,
    seatsFilled: single ? stat.seatsFilled | 0 : 0,
  };
}

function sealBar(group) {
  group.bar = finishBar(group._stat);
  delete group._stat;
  return group;
}

/**
 * One HUD row per distinct selected agora / placeable type.
 * @param {{ kind: 'agora' | 'building', index: number }[] | null | undefined} selected
 * @param {{ type?: string, hp?: number, maxHp?: number, owner?: number }[] | null | undefined} buildings
 * @param {unknown[] | null | undefined} agoras
 * @returns {{ kind: 'building', typeKey: string, name: string, count: number, members: { kind: string, index: number }[], bar: SelectionBar | null }[]}
 */
export function selectionGroupsFromBuildings(selected, buildings, agoras) {
  /** @type {Map<string, { kind: 'building', typeKey: string, name: string, count: number, members: { kind: string, index: number }[], _stat: ReturnType<typeof emptyStat> | null }>} */
  const byKey = new Map();
  const list = selected ?? [];
  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    if (!sel) continue;
    let typeKey = null;
    /** @type {{ hp?: number, maxHp?: number, owner?: number } | null} */
    let entity = null;
    if (sel.kind === 'agora') {
      entity = agoras?.[sel.index] ?? null;
      if (!entity) continue;
      typeKey = 'agora';
    } else if (sel.kind === 'building') {
      const b = buildings?.[sel.index];
      if (!b?.type) continue;
      entity = b;
      typeKey = b.type;
    }
    if (!typeKey) continue;
    let g = byKey.get(typeKey);
    if (!g) {
      g = {
        kind: 'building',
        typeKey,
        name: getBuildingDisplayName(typeKey),
        count: 0,
        members: [],
        _stat: typeKey === 'agora' ? null : emptyStat(true),
      };
      byKey.set(typeKey, g);
    }
    g.count += 1;
    g.members.push({
      kind: sel.kind === 'agora' ? 'agora' : 'building',
      index: sel.index | 0,
    });
    if (g._stat && entity) {
      noteHp(g._stat, entity.hp ?? entity.maxHp ?? 0, entity.maxHp ?? 0, entity.owner ?? 0);
    }
  }
  return [...byKey.values()].map(sealBar);
}

/**
 * Named adventure units each get their own chip; unnamed units still group by type.
 * @param {Iterable<number> | null | undefined} ids
 * @param {{ alive?: ArrayLike<number>, type?: ArrayLike<number> } | null | undefined} world
 * @param {(index: number, typeId: number) => string | null | undefined} [nameOf]
 * @param {(index: number) => number} [seatsOf] filled seats on a transport
 * @returns {{ kind: 'unit', typeId: number, name: string, count: number, entityId?: number, ids: number[], bar: SelectionBar | null }[]}
 */
export function selectionGroupsFromUnits(ids, world, nameOf, seatsOf) {
  /** @type {{ kind: 'unit', typeId: number, name: string, count: number, entityId?: number, ids: number[], _stat: ReturnType<typeof emptyStat> }[]} */
  const named = [];
  /** @type {Map<number, { kind: 'unit', typeId: number, name: string, count: number, ids: number[], _stat: ReturnType<typeof emptyStat> }>} */
  const byType = new Map();
  /** @type {{ kind: 'unit', typeId: number, name: string, count: number, ids: number[], _stat: ReturnType<typeof emptyStat> }[]} */
  const typeOrder = [];
  if (!ids || !world) return named;

  function noteUnit(stat, index, typeId) {
    const maxHp = unitMaxHp(world, index, getUnitDef(typeId).hp);
    const hp = world.hp ? (world.hp[index] | 0) : maxHp;
    const before = stat.n;
    noteHp(stat, hp, maxHp, world.owner?.[index] ?? 0);
    if (stat.n === before) return;
    if (isTransport(typeId)) stat.seatsFilled += seatsOf?.(index) | 0;
    else if (world.mana && isManaCaster(typeId)) {
      const ready = manaReadyCount(world.mana[index] | 0);
      if (ready > stat.manaReady) stat.manaReady = ready;
    }
  }

  for (const raw of ids) {
    const i = raw | 0;
    if (!world.alive?.[i]) continue;
    const typeId = world.type[i] | 0;
    const given = String(nameOf?.(i, typeId) || '').trim();
    if (given) {
      const g = {
        kind: 'unit',
        typeId,
        name: given,
        count: 1,
        entityId: i,
        ids: [i],
        _stat: emptyStat(false),
      };
      noteUnit(g._stat, i, typeId);
      named.push(g);
      continue;
    }
    let g = byType.get(typeId);
    if (!g) {
      g = {
        kind: 'unit',
        typeId,
        name: getUnitDef(typeId).name,
        count: 0,
        ids: [],
        _stat: emptyStat(false),
      };
      byType.set(typeId, g);
      typeOrder.push(g);
    }
    g.count += 1;
    g.ids.push(i);
    noteUnit(g._stat, i, typeId);
  }
  return named.concat(typeOrder).map(sealBar);
}

/**
 * Overlay icon. Baked meshes are clockwise on the outside and double-sided
 * in the world; culling the back face shows the hollow inside (wheat behind
 * the farm ground). Draw both sides and let the depth write keep the near one.
 */
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
    backFaceCulling: false,
    // Transparent pass, same as the build menu. Opaque chips draw before the fog
    // veil, and the veil then paints over them. Depth write keeps a sword or
    // wheat stalk in front of the body; the chip is nearer than the world.
    needAlphaBlending: true,
    depthWrite: true,
    depthCompare: 'greater-equal',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.worldPos = wp.xyz;
  out.worldN = (shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldN: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  var n = normalize(input.worldN);
  let toEye = scene.vEyePosition.xyz - input.worldPos;
  if (dot(n, toEye) < 0.0) { n = -n; }
  let lit = 0.42 + 0.58 * max(dot(n, vec3<f32>(0.35, 0.82, 0.42)), 0.0);
  return vec4<f32>(shaderUniforms.iconColor * lit, 1.0);
}`,
  });
  return { mat, color };
}

/** Static or VAT unit GLB for the chip icon. */
function unitIconModelUrl(typeId) {
  return resolveUnitModelUrl(typeId, localHudSkin(typeId));
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

const SPRITE_QUAD = (() => {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  // Local +X points screen-left, so U is swapped. V stays 0 along the bottom
  // edge; flipping it turned the help-menu portrait upside down in game.
  const uvs = new Float32Array([1, 0, 0, 0, 0, 1, 1, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
})();

function makeSpriteMaterial() {
  return createShaderMaterial({
    name: 'sel-sprite',
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'gain', type: 'f32', defaultValue: 1 },
    ],
    samplers: ['sprite'],
    backFaceCulling: false,
    // The fog veil is transparent and sorts behind anything nearer the camera.
    // An opaque chip draws first, so the veil covers it. Stay transparent, at
    // icon depth, and the portrait paints after the veil. Depth test still
    // keeps the world from covering the chip.
    needAlphaBlending: true,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    depthWrite: false,
    depthCompare: 'greater-equal',
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
  let c = textureSample(sprite, spriteSampler, input.uv);
  return vec4<f32>(c.rgb * shaderUniforms.gain, c.a);
}`,
  });
}

/**
 * Screen basis at icon depth. Local +X is screen-left (the UVs are swapped)
 * and +Z points at the camera. One basis for the whole row, taken from the
 * same rays that place the chips, so a stale camera matrix cannot leave them
 * sheared until the next orbit.
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} ray
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} rayRight
 * @param {{ ox: number, oy: number, oz: number, dx: number, dy: number, dz: number } | null | undefined} rayDown
 * @returns {{ x: number, y: number, z: number, w: number } | null}
 */
function spriteQuatFromRays(ray, rayRight, rayDown) {
  if (!ray || !rayRight || !rayDown) return null;
  const px = ray.ox + ray.dx * ICON_DEPTH;
  const py = ray.oy + ray.dy * ICON_DEPTH;
  const pz = ray.oz + ray.dz * ICON_DEPTH;
  let rx = rayRight.ox + rayRight.dx * ICON_DEPTH - px;
  let ry = rayRight.oy + rayRight.dy * ICON_DEPTH - py;
  let rz = rayRight.oz + rayRight.dz * ICON_DEPTH - pz;
  const rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-8) return null;
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  let dx = rayDown.ox + rayDown.dx * ICON_DEPTH - px;
  let dy = rayDown.oy + rayDown.dy * ICON_DEPTH - py;
  let dz = rayDown.oz + rayDown.dz * ICON_DEPTH - pz;
  const dlen = Math.hypot(dx, dy, dz);
  if (dlen < 1e-8) return null;
  dx /= dlen;
  dy /= dlen;
  dz /= dlen;
  const xx = -rx;
  const xy = -ry;
  const xz = -rz;
  const yx = -dx;
  const yy = -dy;
  const yz = -dz;
  const zx = xy * yz - xz * yy;
  const zy = xz * yx - xx * yz;
  const zz = xx * yy - xy * yx;
  const zlen = Math.hypot(zx, zy, zz);
  if (zlen < 1e-8) return null;
  return quatFromBasis(xx, xy, xz, yx, yy, yz, zx / zlen, zy / zlen, zz / zlen);
}

function sameQuat(a, b) {
  return !!a && !!b
    && Math.abs(a.x - b.x) < 1e-6
    && Math.abs(a.y - b.y) < 1e-6
    && Math.abs(a.z - b.z) < 1e-6
    && Math.abs(a.w - b.w) < 1e-6;
}

/** Fallback when the screen rays are not ready. */
function spriteQuatFromCamera(camera) {
  const w = camera?.worldMatrix;
  if (!w || w.length < 11) return null;
  return quatFromBasis(
    -w[0], -w[1], -w[2],
    w[4], w[5], w[6],
    -w[8], -w[9], -w[10],
  );
}

const BAR_QUAD = (() => {
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, normals, uvs, indices };
})();

/**
 * Screen plane at the near plane. Portraits face their own pixel ray, which
 * tilts at the top of the view and keystones a wide row. Field chips stay
 * square because they face the camera; this is that same plane.
 * @returns {{ quat: { x: number, y: number, z: number, w: number }, normal: number[] } | null}
 */
function screenFrameFromRays(ray, rayRight, rayDown) {
  if (!ray || !rayRight || !rayDown) return null;
  let xx = rayRight.ox - ray.ox;
  let xy = rayRight.oy - ray.oy;
  let xz = rayRight.oz - ray.oz;
  const xlen = Math.hypot(xx, xy, xz);
  if (xlen < 1e-8) return null;
  xx /= xlen;
  xy /= xlen;
  xz /= xlen;
  let yx = ray.ox - rayDown.ox;
  let yy = ray.oy - rayDown.oy;
  let yz = ray.oz - rayDown.oz;
  const along = yx * xx + yy * xy + yz * xz;
  yx -= xx * along;
  yy -= xy * along;
  yz -= xz * along;
  const ylen = Math.hypot(yx, yy, yz);
  if (ylen < 1e-8) return null;
  yx /= ylen;
  yy /= ylen;
  yz /= ylen;
  let zx = xy * yz - xz * yy;
  let zy = xz * yx - xx * yz;
  let zz = xx * yy - xy * yx;
  const zlen = Math.hypot(zx, zy, zz);
  if (zlen < 1e-8) return null;
  zx /= zlen;
  zy /= zlen;
  zz /= zlen;
  return {
    quat: quatFromBasis(xx, xy, xz, yx, yy, yz, zx, zy, zz),
    normal: [zx, zy, zz],
  };
}

/** World length of one CSS pixel on the screen plane through `center`. */
function pixelOnScreenPlane(center, normal, rayStep) {
  const denom = rayStep.dx * normal[0] + rayStep.dy * normal[1] + rayStep.dz * normal[2];
  if (Math.abs(denom) < 1e-8) return 0;
  const t = (
    (center[0] - rayStep.ox) * normal[0]
    + (center[1] - rayStep.oy) * normal[1]
    + (center[2] - rayStep.oz) * normal[2]
  ) / denom;
  if (!(t > 0)) return 0;
  const x = rayStep.ox + rayStep.dx * t - center[0];
  const y = rayStep.oy + rayStep.dy * t - center[1];
  const z = rayStep.oz + rayStep.dz * t - center[2];
  return Math.hypot(x, y, z);
}

function makeBarMaterial(index) {
  return createShaderMaterial({
    name: `sel-health-${index}`,
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world',
      'viewProjection',
      { name: 'quadPx', type: 'vec2<f32>', defaultValue: [96, 32] },
      { name: 'origin', type: 'f32', defaultValue: 0 },
      { name: 'pitch', type: 'f32', defaultValue: 13 },
      { name: 'rowY', type: 'f32', defaultValue: 6 },
      { name: 'chip', type: 'f32', defaultValue: 5 },
      { name: 'filled', type: 'f32', defaultValue: 7 },
      { name: 'chips', type: 'f32', defaultValue: 7 },
      { name: 'hpColor', type: 'vec3<f32>', defaultValue: [0.12, 0.92, 0.2] },
      { name: 'teamColor', type: 'vec3<f32>', defaultValue: [0.38, 0.64, 1] },
      { name: 'unders', type: 'f32', defaultValue: 0 },
      { name: 'underColor', type: 'vec3<f32>', defaultValue: [0.4, 0.58, 0.96] },
    ],
    backFaceCulling: false,
    needAlphaBlending: true,
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    depthWrite: false,
    depthCompare: 'greater-equal',
    vertexSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
};
@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let wp = shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.position = shaderSystem.viewProjection * wp;
  out.local = input.position.xy * shaderUniforms.quadPx;
  return out;
}`,
    fragmentSource: `struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
};
fn cover(d: f32) -> f32 {
  return 1.0 - smoothstep(0.0, 0.7, d);
}
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
}
@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let p = input.local;
  let n = i32(shaderUniforms.chips + 0.5);
  let half = shaderUniforms.chip;
  var col = vec3<f32>(0.0);
  var a = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    if (i >= n) { break; }
    if (f32(i) + 0.5 > shaderUniforms.filled) { continue; }
    let cx = shaderUniforms.origin + f32(i) * shaderUniforms.pitch;
    let d = sdBox(p - vec2<f32>(cx, shaderUniforms.rowY), vec2<f32>(half, half));
    let k = cover(d);
    let edge = smoothstep(half * 0.15, half, p.x - cx);
    let rgb = mix(shaderUniforms.hpColor * 0.62, min(shaderUniforms.hpColor + vec3<f32>(0.35), vec3<f32>(1.0)), edge);
    col = mix(col, rgb, k);
    a = max(a, k);
  }
  let x0 = shaderUniforms.origin - half;
  let x1 = shaderUniforms.origin + f32(n - 1) * shaderUniforms.pitch + half;
  let lineY = shaderUniforms.rowY - half - 1.4;
  let line = cover(sdBox(p - vec2<f32>((x0 + x1) * 0.5, lineY), vec2<f32>((x1 - x0) * 0.5, 0.55)));
  col = mix(col, shaderUniforms.teamColor, line);
  a = max(a, line);
  let triC = vec2<f32>(x0 + half * 0.15, lineY - half * 0.15);
  let tp = p - triC;
  let tri = cover(max(abs(tp.y) * 0.58 + tp.x * 0.34, -tp.x) - half * 0.95);
  col = mix(col, shaderUniforms.teamColor, tri * (1.0 - a));
  a = max(a, tri);
  let un = i32(shaderUniforms.unders + 0.5);
  let dotY = lineY - half * 1.35;
  for (var j = 0; j < 6; j = j + 1) {
    if (j >= un) { break; }
    let cx = shaderUniforms.origin + f32(j) * shaderUniforms.pitch;
    let d = length(p - vec2<f32>(cx, dotY)) - half * 0.42;
    let k = cover(d);
    col = mix(col, shaderUniforms.underColor, k);
    a = max(a, k);
  }
  return vec4<f32>(col, a);
}`,
  });
}

function barLayout(count, maxWidthPx) {
  const n = Math.max(1, count | 0);
  let chip = 4.5;
  let gap = 1;
  let row = n * chip + (n - 1) * gap;
  const cap = Math.max(22, maxWidthPx);
  if (row > cap) {
    const s = cap / row;
    chip *= s;
    gap *= s;
    row = cap;
  }
  const width = row + chip;
  const height = chip * 2.6;
  const half = chip * 0.46;
  return {
    chip,
    gap,
    width,
    height,
    origin: -((n - 1) * (chip + gap)) / 2,
    pitch: chip + gap,
    half,
    rowY: height * 0.5 - half - 1,
  };
}

/** Place a portrait. `quat` is omitted when the camera basis has not changed. */
function placeSprite(mesh, x, y, z, scale, quat) {
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
  if (quat) {
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
  }
  setSubtreeVisible(mesh, true);
  mesh.markLocalDirty?.();
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
  /** Health row drawn as a HUD mesh, same path as the portraits. */
  /** @type {{ mesh: object, mat: object }[]} */
  const barSlots = [];
  try {
    const { positions, normals, uvs, indices } = BAR_QUAD;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const mesh = createMeshFromData(engine, `sel-health-${i}`, positions, normals, indices, uvs);
      mesh.pickable = false;
      if ('receiveShadows' in mesh) mesh.receiveShadows = false;
      mesh.renderOrder = HUD_RENDER_ORDER + 1;
      mesh.boundMin = [-0.5, -0.5, -0.5];
      mesh.boundMax = [0.5, 0.5, 0.5];
      const mat = makeBarMaterial(i);
      mesh.material = mat;
      addToScene(scene, mesh);
      setSubtreeVisible(mesh, false);
      barSlots.push({ mesh, mat });
    }
  } catch (err) {
    console.warn('[selectionHud] health bars unavailable', err);
    barSlots.length = 0;
  }

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

  async function tryLoadSpriteIcon(key, url) {
    let tex = null;
    try {
      tex = await loadTexture2D(engine, assetUrl(bakedSpriteUrl(url)), {
        mipMaps: true,
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
        srgb: false,
      });
    } catch {
      return false;
    }
    const { positions, normals, uvs, indices } = SPRITE_QUAD;
    const mesh = createMeshFromData(engine, `sel-sprite-${key}`, positions, normals, indices, uvs);
    mesh.pickable = false;
    if ('receiveShadows' in mesh) mesh.receiveShadows = false;
    mesh.renderOrder = HUD_RENDER_ORDER;
    mesh.boundMin = [-0.5, -0.5, -0.5];
    mesh.boundMax = [0.5, 0.5, 0.5];
    const mat = makeSpriteMaterial();
    mesh.material = mat;
    setShaderTexture(mat, 'sprite', tex);
    addToScene(scene, mesh);
    setSubtreeVisible(mesh, false);
    icons.set(key, {
      sprite: true,
      layers: [{ mesh, baseColor: null }],
      visible: false,
      hoverT: 0,
      // The portrait is framed with margin, so the card is a bit larger than a raw mesh.
      normScale: UNIT_ICON_WORLD * 1.2,
      cx: 0,
      cy: 0,
      cz: 0,
    });
    return true;
  }

  async function loadIconInner(key, url) {
    if (await tryLoadSpriteIcon(key, url)) return;
    try {
      let parts = null;
      if (key.startsWith('u:')) parts = await loadIdleIconMeshes(engine, url);
      if (!parts?.length) parts = await loadBakedUnitMeshParts(engine, url);
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

  /** @type {{ name: { data: object, layer: object, text: string }, count: { data: object, layer: object, text: string } }[]} */
  const labels = [];
  let textRenderer = null;
  let textRendererRegistered = false;
  let labelsDisposed = false;
  if (screen.font) {
    try {
      /** @type {object[]} */
      const layers = [];
      for (let i = 0; i < MAX_SLOTS; i++) {
        const nameData = createDefaultTextData(screen.font, LABEL_FONT_SIZE, 'Unit', LABEL_COLOR);
        const nameLayer = createTextLayer(nameData, { order: i, opacity: 0, visible: false });
        const countData = createDefaultTextData(screen.font, LABEL_FONT_SIZE, '0', LABEL_COLOR);
        const countLayer = createTextLayer(countData, {
          order: MAX_SLOTS + i,
          opacity: 0,
          visible: false,
        });
        labels.push({
          name: { data: nameData, layer: nameLayer, text: 'Unit' },
          count: { data: countData, layer: countLayer, text: '0' },
        });
        layers.push(nameLayer, countLayer);
      }
      textRenderer = createTextRenderer(engine, {
        layers,
        clear: false,
      });
    } catch (err) {
      console.warn('[selectionHud] native labels unavailable', err);
      for (const l of labels) {
        disposeDefaultTextData(l.name.data);
        disposeDefaultTextData(l.count.data);
      }
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

  function showIcon(key, ax, ay, az, rx, ry, rz, fx, fy, fz, compress, hoverT, spriteWorld, orient) {
    const batch = icons.get(key);
    if (!batch) return;
    if (batch.sprite) {
      const mesh = batch.layers[0].mesh;
      const world = spriteWorld > 0 ? spriteWorld : batch.normScale;
      const wrote = orient && !sameQuat(batch.quat, orient);
      placeSprite(mesh, ax, ay, az, world, wrote ? orient : null);
      if (wrote) batch.quat = orient;
      const gain = 1 + hoverT * 0.22;
      if (batch.gain !== gain) {
        setShaderUniform(mesh.material, 'gain', gain);
        batch.gain = gain;
      }
      batch.visible = true;
      return;
    }
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

  function hideCaption(cap) {
    if (!cap || !cap.layer.visible) return;
    cap.layer.opacity = 0;
    cap.layer.visible = false;
    cap.layer._version++;
  }

  function hideLabel(label) {
    if (!label) return;
    hideCaption(label.name);
    hideCaption(label.count);
  }

  function hideBarSlot(slot) {
    if (!slot) return;
    const mesh = slot.mesh;
    setSubtreeVisible(mesh, false);
    if (mesh.position) mesh.position.y = -9999;
    mesh.markLocalDirty?.();
  }

  /**
   * @param {{ mesh: object, mat: object }} slot
   * @param {SelectionBar} bar
   * @param {number} canvasX
   * @param {number} canvasY
   * @param {number} maxWidthPx
   * @param {object} camera
   */
  function placeHudBar(slot, bar, canvasX, canvasY, maxWidthPx, camera) {
    if (!slot || !bar || !screen.rayFromCanvas) return;
    const ray = screen.rayFromCanvas(canvasX, canvasY);
    const rayR = screen.rayFromCanvas(canvasX + 1, canvasY);
    const rayD = screen.rayFromCanvas(canvasX, canvasY + 1);
    if (!ray || !rayR) return;
    const depth = ICON_DEPTH * 0.86;
    const count = bar.building ? BUILDING_CHIP_COUNT : UNIT_CHIP_COUNT;
    const layout = barLayout(count, maxWidthPx);
    const center = [
      ray.ox + ray.dx * depth,
      ray.oy + ray.dy * depth,
      ray.oz + ray.dz * depth,
    ];
    const frame = screenFrameFromRays(ray, rayR, rayD);
    let pixel = frame ? pixelOnScreenPlane(center, frame.normal, rayR) : 0;
    if (!(pixel > 1e-8)) {
      pixel = Math.hypot(
        rayR.ox + rayR.dx * depth - center[0],
        rayR.oy + rayR.dy * depth - center[1],
        rayR.oz + rayR.dz * depth - center[2],
      );
    }
    if (!(pixel > 1e-8)) return;
    if (frame) {
      const nudge = pixel * 4;
      center[0] += frame.normal[0] * nudge;
      center[1] += frame.normal[1] * nudge;
      center[2] += frame.normal[2] * nudge;
    }
    const mesh = slot.mesh;
    if (mesh.position) {
      mesh.position.x = center[0];
      mesh.position.y = center[1];
      mesh.position.z = center[2];
    }
    if (mesh.scaling) {
      mesh.scaling.x = pixel * layout.width;
      mesh.scaling.y = pixel * layout.height;
      mesh.scaling.z = 1;
    }
    const quat = frame?.quat ?? spriteQuatFromCamera(camera);
    const rq = mesh.rotationQuaternion;
    if (quat && rq) {
      if (typeof rq.set === 'function') rq.set(quat.x, quat.y, quat.z, quat.w);
      else {
        rq.x = quat.x;
        rq.y = quat.y;
        rq.z = quat.z;
        rq.w = quat.w;
      }
    }
    const { rgb } = chipBarState(bar.ratio, count);
    const filled = chipBarFilled(bar.ratio, count, bar.hp);
    const team = ownerTint(bar.owner);
    const flags = {
      building: !!bar.building,
      manaReady: bar.manaReady,
      seatsFilled: bar.seatsFilled,
    };
    const underN = underDotCount(flags);
    const under = underDotTint(flags);
    const mat = slot.mat;
    setShaderUniform(mat, 'quadPx', [layout.width, layout.height]);
    setShaderUniform(mat, 'origin', layout.origin);
    setShaderUniform(mat, 'pitch', layout.pitch);
    setShaderUniform(mat, 'rowY', layout.rowY);
    setShaderUniform(mat, 'chip', layout.half);
    setShaderUniform(mat, 'filled', filled);
    setShaderUniform(mat, 'chips', count);
    setShaderUniform(mat, 'hpColor', rgb);
    setShaderUniform(mat, 'teamColor', [team[0], team[1], team[2]]);
    setShaderUniform(mat, 'unders', underN);
    setShaderUniform(mat, 'underColor', under);
    setSubtreeVisible(mesh, true);
    mesh.markLocalDirty?.();
  }

  function hideAll() {
    for (const batch of icons.values()) hideIcon(batch);
    for (const label of labels) hideLabel(label);
    hitRects = [];
    for (const slot of barSlots) hideBarSlot(slot);
    if (screen.canvas && screen.canvas.style.cursor !== 'none') {
      screen.canvas.style.cursor = '';
    }
  }

  /**
   * @param {{ data: object, layer: object, text: string }} cap
   * @param {string} text
   * @param {number} px
   * @param {number} py
   * @param {number} scale
   * @param {number} opacity
   * @param {number} sx
   * @param {number} sy
   */
  function placeCaption(cap, text, px, py, scale, opacity, sx, sy) {
    if (!cap) return;
    if (text !== cap.text) {
      updateDefaultTextData(cap.data, text, LABEL_COLOR);
      cap.text = text;
    }
    const centerOffset = cap.data.width * scale * 0.5;
    cap.layer.positionPx.x = px * sx - centerOffset;
    cap.layer.positionPx.y = py * sy;
    cap.layer.rotationRad = 0;
    cap.layer.scale = scale;
    cap.layer.opacity = opacity;
    cap.layer.visible = true;
    cap.layer._version++;
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
    const toHud = screen.chromePoint || screen.hudPoint || ((x, y) => ({ x, y }));
    const layoutPoint = (px, py) => (
      xrEye() ? xrHudOvalTopArcPoint(px, py, vw, vh) : toHud(px, py)
    );
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
        const hitW = Math.min(HIT_W_PX, pitch * 0.7);
        const base = layoutPoint(px, iconPy);
        hitRects.push({
          slot,
          groupIndex: i,
          x: base.x - hitW * 0.5,
          y: base.y - HIT_UP_PX,
          w: hitW,
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
    if (canvas && canvas.style.cursor !== 'none') {
      canvas.style.cursor = hoverIdx >= 0 ? 'pointer' : '';
    }

    for (let i = 0; i < n; i++) {
      const g = groups[i];
      const px = startX + i * pitch;
      const iconKey = selectionHudIconKey(g);
      const batch = iconKey ? icons.get(iconKey) : null;
      const target = i === hoverIdx ? 1 : 0;
      const hoverT = batch
        ? (batch.hoverT += (target - batch.hoverT) * Math.min(1, dt * HOVER_LERP))
        : 0;
      const base = layoutPoint(px, iconPy);
      const hy = base.y - hoverT * HOVER_LIFT_PX;
      if (g.bar && barSlots[i]) {
        const iconCss = Math.min(SPRITE_PX, pitch * 0.85);
        const barPy = Math.max(BAR_TOP_INSET, iconPy - iconCss * 0.28);
        const barPoint = layoutPoint(px, barPy);
        placeHudBar(
          barSlots[i],
          g.bar,
          barPoint.x,
          barPoint.y - hoverT * HOVER_LIFT_PX,
          Math.min(pitch * 0.92, 132),
          camera,
        );
      } else if (barSlots[i]) {
        hideBarSlot(barSlots[i]);
      }

      const ray = screen.rayFromCanvas(base.x, hy);
      const rayR = screen.rayFromCanvas(base.x + 1, hy);
      const orient = spriteQuatFromRays(
        ray,
        rayR,
        screen.rayFromCanvas(base.x, hy + 1),
      ) ?? spriteQuatFromCamera(camera);
      if (ray && iconKey) {
        const wx = ray.ox + ray.dx * ICON_DEPTH;
        const wy = ray.oy + ray.dy * ICON_DEPTH;
        const wz = ray.oz + ray.dz * ICON_DEPTH;
        let spriteWorld = 0;
        if (rayR) {
          const dx = rayR.ox + rayR.dx * ICON_DEPTH - wx;
          const dy = rayR.oy + rayR.dy * ICON_DEPTH - wy;
          const dz = rayR.oz + rayR.dz * ICON_DEPTH - wz;
          const pixel = Math.hypot(dx, dy, dz);
          const css = Math.min(SPRITE_PX, pitch * 0.85);
          if (pixel > 1e-8) spriteWorld = pixel * css;
        }
        // Authored face is model +Z (glTF forward, including the node's own spin).
        // Point that at the camera.
        let thx = eye.x - wx;
        let thz = eye.z - wz;
        const hlen = Math.hypot(thx, thz) || 1;
        thx /= hlen;
        thz /= hlen;
        showIcon(iconKey, wx, wy, wz, thz, 0, -thx, thx, 0, thz, compress, hoverT, spriteWorld, orient);
        shownKeys.add(iconKey);
      }

      const label = labels[i];
      if (label) {
        const scale = LABEL_SCREEN_SCALE * pixelRatio * compress * (1 + hoverT * 0.06);
        const opacity = LABEL_OPACITY + hoverT * 0.12;
        placeCaption(label.name, g.name, base.x, hy + NAME_DY, scale, opacity, sx, sy);
        placeCaption(label.count, formatGameNumber(g.count | 0), base.x, hy + COUNT_DY, scale, opacity, sx, sy);
      }
    }
    for (let i = n; i < barSlots.length; i++) hideBarSlot(barSlots[i]);

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
    for (const slot of barSlots) hideBarSlot(slot);
    if (textRenderer) disposeTextRenderer(textRenderer);
    textRenderer = null;
    textRendererRegistered = false;
    for (const label of labels) {
      disposeDefaultTextData(label.name.data);
      disposeDefaultTextData(label.count.data);
    }
  }

  return { setGroups, update, pickSlot, clear: hideAll, registerLabels, disposeLabels };
}
