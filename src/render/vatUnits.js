// VAT (baked vertex animation) unit templates — one bake + thin instances.
// Villager GLB is multi-primitive (body / TeamColor shirt / pants / kicks); each
// primitive is its own skinned mesh and must be baked + instanced together.
//
// Important: do NOT detach/rescale meshes after bake. Bone matrices are authored
// against the load-time mesh world (invMeshWorld). Changing mesh.world after
// attachVat yields bind-pose/T-pose. Game scale + foot lift go in the instance matrix.

import {
  attachVat,
  debugPbrExtIds,
  loadGltf,
  stopAnimation,
} from '../vendor/lite/liteVendor.js';
import { UNIT } from '../sim/unitTypes.js';
import {
  bakedVatBinUrl,
  bakedVatJsonUrl,
  hasBakedVat,
  tryFetch,
} from './bakedAssets.js';
import { isTeamColorName, prepareTeamColorMaterial } from './teamColor.js';
import {
  appendCarryLocomotion,
  CARRY_IDLE_CLIP,
  CARRY_OVERLAY,
  CARRY_WALK_CLIP,
  sampleVatGroups,
} from './vatBakeCpu.js';

/** Per-instance VAT clip id (low 7 bits). High bit = frozen (fps=0). */
export const VAT_CLIP = {
  IDLE: 0,
  WALK: 1,
  CARRY: 3,
  CARRY_WALK: 4,
};
export const VAT_FROZEN = 0x80;

/** @type {Readonly<Record<number, { url: string, scale: number, idleClip: string, walkClip: string, carryClip?: string }>>} */
export const VAT_UNIT_DEFS = {
  [UNIT.VILLAGER]: {
    url: '/assets/models/villager.glb',
    // Raw glTF scale — no aftermarket resize (instance matrix only).
    scale: 1,
    idleClip: 'idle',
    walkClip: 'walk_cycle',
    carryClip: 'carry',
  },
};

export function isVatUnitType(typeId) {
  return typeId in VAT_UNIT_DEFS;
}

/**
 * Lite packs VAT instance params in a 1×(N*2) rgba32float texture
 * (`instanceIndex * 2` texels). Cap is therefore maxTextureDimension2D / 2.
 */
export function maxVatInstancesPerBatch(engine) {
  const dim = engine?._device?.limits?.maxTextureDimension2D
    ?? engine?.device?.limits?.maxTextureDimension2D
    ?? 8192;
  return Math.max(1, Math.floor(Number(dim) / 2));
}

function collectSkinnedMeshes(node, out = []) {
  if (node?.skeleton) out.push(node);
  for (const child of node?.children ?? []) collectSkinnedMeshes(child, out);
  return out;
}

function findGroup(groups, name) {
  if (!groups?.length || !name) return null;
  const lower = name.toLowerCase();
  return groups.find((g) => (g.name || '').toLowerCase() === lower)
    ?? groups.find((g) => (g.name || '').toLowerCase().includes(lower))
    ?? null;
}

/**
 * Resolve idle / walk / carry animation groups for a VAT bake.
 * @param {object[]} groups
 * @param {{ idleClip: string, walkClip: string, carryClip?: string }} def
 */
export function collectVatBakeGroups(groups, def) {
  const idle = findGroup(groups, def.idleClip);
  const walk = findGroup(groups, def.walkClip) ?? findGroup(groups, 'walk');
  const carry = def.carryClip ? findGroup(groups, def.carryClip) : null;
  const bakeGroups = [];
  const seen = new Set();
  for (const g of [idle, walk, carry]) {
    if (!g || seen.has(g)) continue;
    seen.add(g);
    bakeGroups.push(g);
  }
  return { idle, walk, carry, bakeGroups };
}

export function vatWant(moving, carrying, animate) {
  let clip = VAT_CLIP.IDLE;
  if (carrying && moving) clip = VAT_CLIP.CARRY_WALK;
  else if (carrying) clip = VAT_CLIP.CARRY;
  else if (moving) clip = VAT_CLIP.WALK;
  return animate ? clip : (clip | VAT_FROZEN);
}

/**
 * @param {{ idleClip: object, walkClip: object, carryClip?: object | null, carryWalkClip?: object | null }} clips
 * @param {number} state
 */
export function clipForVatState(clips, state) {
  const id = state === 2 ? VAT_CLIP.IDLE : (state & ~VAT_FROZEN);
  if (id === VAT_CLIP.WALK) return clips.walkClip;
  if (id === VAT_CLIP.CARRY_WALK) {
    return clips.carryWalkClip ?? clips.walkClip ?? clips.idleClip;
  }
  if (id === VAT_CLIP.CARRY) return clips.carryClip ?? clips.idleClip;
  return clips.idleClip;
}

function clipNameSet(meta) {
  const names = new Set();
  for (const n of [meta?.idleName, meta?.walkName, meta?.carryName]) {
    if (n) names.add(String(n).toLowerCase());
  }
  const clips = meta?.prims?.[0]?.clips;
  if (clips) {
    for (const k of Object.keys(clips)) names.add(k.toLowerCase());
  }
  return names;
}

function offlineCoversDef(meta, def) {
  const names = clipNameSet(meta);
  const need = [def.idleClip, def.walkClip].filter(Boolean);
  if (def.carryClip) {
    if (meta.carryOverlay !== CARRY_OVERLAY) return false;
    need.push(CARRY_IDLE_CLIP, CARRY_WALK_CLIP);
  }
  return need.every((n) => {
    const lower = n.toLowerCase();
    return [...names].some((x) => x === lower || x.includes(lower));
  });
}

function materialName(mesh) {
  return mesh?.material?.name || '';
}

function isTeamColorPart(mesh) {
  return isTeamColorName(materialName(mesh));
}

/** @type {Map<string, { bakedList: object[], bakeClipName: string, idleName: string, walkName: string, carryName: string | null, idleClip: object, walkClip: object, carryClip: object | null, carryWalkClip: object | null }>} */
const vatBakeCache = new Map();

/**
 * Rebuild Lite VAT bake handles from an offline float dump (skip bakeVatMany).
 * @param {object} engine
 * @param {object} meta
 * @param {ArrayBuffer} bin
 */
function vatBakedListFromDump(engine, meta, bin) {
  const device = engine._device;
  const bakedList = [];
  for (const prim of meta.prims ?? []) {
    const data = new Float32Array(bin, prim.byteOffset, prim.floatCount);
    const texWidth = prim.boneCount * 4;
    const texture = device.createTexture({
      size: [texWidth, prim.frameCount],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      data.buffer,
      { offset: data.byteOffset, bytesPerRow: texWidth * 16, rowsPerImage: prim.frameCount },
      { width: texWidth, height: prim.frameCount },
    );
    const resource = { texture, _refCount: 0 };
    bakedList.push({
      texture,
      boneCount: prim.boneCount,
      frameCount: prim.frameCount,
      clips: { ...prim.clips },
      _textureResource: resource,
    });
  }
  return bakedList;
}

function uploadCpuVat(engine, prims, clips) {
  const device = engine._device;
  const bakedList = [];
  for (const prim of prims) {
    const texWidth = prim.boneCount * 4;
    const texture = device.createTexture({
      size: [texWidth, prim.frameCount],
      format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture },
      prim.data.buffer,
      { offset: prim.data.byteOffset, bytesPerRow: texWidth * 16, rowsPerImage: prim.frameCount },
      { width: texWidth, height: prim.frameCount },
    );
    bakedList.push({
      texture,
      boneCount: prim.boneCount,
      frameCount: prim.frameCount,
      clips: { ...clips },
      _textureResource: { texture, _refCount: 0 },
    });
  }
  return bakedList;
}

function bakeLiveVat(_root, skinned, groups, def) {
  const { idle, walk, carry, bakeGroups } = collectVatBakeGroups(groups, def);
  const loco = [];
  if (idle) loco.push(idle);
  if (walk && walk !== idle) loco.push(walk);
  const sampleGroups = loco.length ? loco : bakeGroups;
  if (sampleGroups.length === 0) {
    throw new Error(`no idle/walk clips in ${def.url}`);
  }
  const { prims, clips } = sampleVatGroups(skinned, sampleGroups, stopAnimation);
  const bakeClipName = sampleGroups[0].name;
  const idleName = idle?.name ?? bakeClipName;
  const walkName = walk?.name ?? idleName;
  const carryName = carry?.name ?? null;
  const idleClip = clips[idleName];
  const walkClip = clips[walkName] ?? idleClip;
  if (!idleClip) throw new Error(`VAT missing clip ${idleName} in ${def.url}`);

  let carryClip = null;
  let carryWalkClip = null;
  if (carry) {
    const stamped = appendCarryLocomotion(prims, clips, skinned, idle, walk, carry);
    if (stamped.idle) carryClip = stamped.idle;
    if (stamped.walk) carryWalkClip = stamped.walk;
  }

  return {
    prims,
    clips,
    bakeClipName,
    idleName,
    walkName,
    carryName,
    idleClip,
    walkClip,
    carryClip,
    carryWalkClip,
  };
}

async function tryLoadOfflineVatBake(engine, def) {
  if (!(await hasBakedVat(def.url))) return null;
  const [jsonRes, binRes] = await Promise.all([
    tryFetch(bakedVatJsonUrl(def.url)),
    tryFetch(bakedVatBinUrl(def.url)),
  ]);
  if (!jsonRes || !binRes) return null;
  const meta = await jsonRes.json();
  if (!offlineCoversDef(meta, def)) return null;
  const bin = await binRes.arrayBuffer();
  const bakedList = vatBakedListFromDump(engine, meta, bin);
  return {
    bakedList,
    bakeClipName: meta.bakeClipName,
    idleName: meta.idleName,
    walkName: meta.walkName,
    carryName: meta.carryName ?? null,
    idleClip: meta.idleClip,
    walkClip: meta.walkClip,
    carryClip: meta.carryIdleClip ?? meta.carryClip ?? null,
    carryWalkClip: meta.carryWalkClip ?? null,
  };
}

/**
 * Load glTF, bake idle/walk/carry for every skinned primitive, attach VAT.
 * Keeps the glTF hierarchy (required for correct skin space).
 * Caller must setThinInstances + handle.setInstances before registerScene,
 * and addToScene the returned `root` (so parent transforms stay valid).
 *
 * Bone-texture bake is cached per URL so VAT shards (past the instance-param
 * texture width) can share one bake and only reload/attach mesh copies.
 * Prefers /assets/baked/vat/* when present.
 *
 * @param {object} engine
 * @param {{ url: string, scale: number, idleClip: string, walkClip: string, carryClip?: string }} def
 */
export async function loadVatUnitTemplate(engine, def) {
  const container = await loadGltf(engine, def.url);
  const root = container.entities[0];
  if (!root) throw new Error(`no root in ${def.url}`);

  const skinned = collectSkinnedMeshes(root);
  if (skinned.length === 0) throw new Error(`no skinned mesh in ${def.url}`);

  const groups = container.animationGroups ?? [];
  for (const g of groups) stopAnimation(g);

  let cached = vatBakeCache.get(def.url);
  if (!cached) {
    const offline = await tryLoadOfflineVatBake(engine, def);
    if (offline) {
      cached = offline;
      vatBakeCache.set(def.url, cached);
    } else {
      const live = bakeLiveVat(root, skinned, groups, def);
      cached = {
        bakedList: uploadCpuVat(engine, live.prims, live.clips),
        bakeClipName: live.bakeClipName,
        idleName: live.idleName,
        walkName: live.walkName,
        carryName: live.carryName,
        idleClip: live.idleClip,
        walkClip: live.walkClip,
        carryClip: live.carryClip,
        carryWalkClip: live.carryWalkClip,
      };
      vatBakeCache.set(def.url, cached);
    }

    // Attach all prims (first shard path continues below).
    const donorMat = skinned.find((m) => /material\.001/i.test(materialName(m)))?.material
      ?? skinned.find((m) => /kicks/i.test(materialName(m)))?.material
      ?? skinned.find((m) => !isTeamColorPart(m))?.material
      ?? null;

    /** @type {{ mesh: object, handle: object, isTeamColor: boolean }[]} */
    const parts = [];
    for (let i = 0; i < skinned.length; i++) {
      const mesh = skinned[i];
      const handle = attachVat(engine, mesh, cached.bakedList[i], cached.bakeClipName);
      const team = isTeamColorPart(mesh);
      if (mesh.material) {
        mesh.material.doubleSided = true;
        mesh.material._renderFeatures = undefined;
      }
      if (team) prepareTeamColorMaterial(engine, mesh, donorMat);
      mesh.pickable = false;
      if ('visible' in mesh) mesh.visible = true;
      parts.push({ mesh, handle, isTeamColor: team });
    }

    const extIds = typeof debugPbrExtIds === 'function' ? debugPbrExtIds() : [];
    if (!extIds.includes('vat')) {
      console.warn('[vat] PBR ext registry missing "vat":', extIds);
    }

    return {
      root,
      container,
      mesh: parts[0].mesh,
      handle: parts[0].handle,
      parts,
      idleName: cached.idleName,
      walkName: cached.walkName,
      carryName: cached.carryName ?? null,
      idleClip: cached.idleClip,
      walkClip: cached.walkClip,
      carryClip: cached.carryClip ?? null,
      carryWalkClip: cached.carryWalkClip ?? null,
      instanceScale: Math.abs(def.scale),
      footLift: 0.08,
    };
  }

  // Shard: fresh glTF meshes + shared bone-texture bake (no re-bake).
  if (cached.bakedList.length !== skinned.length) {
    throw new Error(`VAT bake/mesh count mismatch for ${def.url}`);
  }

  const donorMat = skinned.find((m) => /material\.001/i.test(materialName(m)))?.material
    ?? skinned.find((m) => /kicks/i.test(materialName(m)))?.material
    ?? skinned.find((m) => !isTeamColorPart(m))?.material
    ?? null;

  /** @type {{ mesh: object, handle: object, isTeamColor: boolean }[]} */
  const parts = [];
  for (let i = 0; i < skinned.length; i++) {
    const mesh = skinned[i];
    const handle = attachVat(engine, mesh, cached.bakedList[i], cached.bakeClipName);
    const team = isTeamColorPart(mesh);
    if (mesh.material) {
      mesh.material.doubleSided = true;
      mesh.material._renderFeatures = undefined;
    }
    if (team) prepareTeamColorMaterial(engine, mesh, donorMat);
    mesh.pickable = false;
    if ('visible' in mesh) mesh.visible = true;
    parts.push({ mesh, handle, isTeamColor: team });
  }

  return {
    root,
    container,
    mesh: parts[0].mesh,
    handle: parts[0].handle,
    parts,
    idleName: cached.idleName,
    walkName: cached.walkName,
    carryName: cached.carryName ?? null,
    idleClip: cached.idleClip,
    walkClip: cached.walkClip,
    carryClip: cached.carryClip ?? null,
    carryWalkClip: cached.carryWalkClip ?? null,
    instanceScale: Math.abs(def.scale),
    footLift: 0.08,
  };
}

/** Fill per-instance VAT params: (fromRow, toRow, timeOffset, fps). */
export function fillVatInstanceParams(params, capacity, idleClip, walkClip, movingFlags, carryClip = null, carryWalkClip = null) {
  const clips = { idleClip, walkClip, carryClip, carryWalkClip };
  for (let s = 0; s < capacity; s++) {
    const state = movingFlags ? movingFlags[s] : 0;
    const clip = clipForVatState(clips, state);
    const frozen = state === 2 || (state & VAT_FROZEN) !== 0;
    const o = s * 4;
    params[o] = clip.fromRow;
    params[o + 1] = clip.fromRow + clip.frameCount - 1;
    params[o + 2] = (s * 17 + 3) % Math.max(1, clip.frameCount);
    params[o + 3] = frozen ? 0 : clip.fps;
  }
}

export function writeVatSlotParams(params, slot, clip, phase, fps = clip.fps) {
  const o = slot * 4;
  params[o] = clip.fromRow;
  params[o + 1] = clip.fromRow + clip.frameCount - 1;
  params[o + 2] = phase % Math.max(1, clip.frameCount);
  params[o + 3] = fps;
}
