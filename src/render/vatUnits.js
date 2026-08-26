// VAT (baked vertex animation) unit templates — one bake + thin instances.
// Villager GLB is multi-primitive (body / TeamColor shirt / pants / kicks); each
// primitive is its own skinned mesh and must be baked + instanced together.
//
// Important: do NOT detach/rescale meshes after bake. Bone matrices are authored
// against the load-time mesh world (invMeshWorld). Changing mesh.world after
// attachVat yields bind-pose/T-pose. Game scale + foot lift go in the instance matrix.

import {
  attachVat,
  bakeVatMany,
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

/** @type {Readonly<Record<number, { url: string, scale: number, idleClip: string, walkClip: string }>>} */
export const VAT_UNIT_DEFS = {
  [UNIT.VILLAGER]: {
    url: '/assets/models/villager.glb',
    // Raw glTF scale — no aftermarket resize (instance matrix only).
    scale: 1,
    idleClip: 'idle',
    walkClip: 'walk_cycle',
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
  if (!groups?.length) return null;
  const lower = name.toLowerCase();
  return groups.find((g) => (g.name || '').toLowerCase() === lower)
    ?? groups.find((g) => (g.name || '').toLowerCase().includes(lower))
    ?? null;
}

function materialName(mesh) {
  return mesh?.material?.name || '';
}

function isTeamColorPart(mesh) {
  return isTeamColorName(materialName(mesh));
}

/** @type {Map<string, { bakedList: object[], bakeClipName: string, idleName: string, walkName: string, idleClip: object, walkClip: object }>} */
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

async function tryLoadOfflineVatBake(engine, url) {
  if (!(await hasBakedVat(url))) return null;
  const [jsonRes, binRes] = await Promise.all([
    tryFetch(bakedVatJsonUrl(url)),
    tryFetch(bakedVatBinUrl(url)),
  ]);
  if (!jsonRes || !binRes) return null;
  const meta = await jsonRes.json();
  const bin = await binRes.arrayBuffer();
  const bakedList = vatBakedListFromDump(engine, meta, bin);
  return {
    bakedList,
    bakeClipName: meta.bakeClipName,
    idleName: meta.idleName,
    walkName: meta.walkName,
    idleClip: meta.idleClip,
    walkClip: meta.walkClip,
  };
}

/**
 * Load glTF, bake idle+walk for every skinned primitive, attach VAT.
 * Keeps the glTF hierarchy (required for correct skin space).
 * Caller must setThinInstances + handle.setInstances before registerScene,
 * and addToScene the returned `root` (so parent transforms stay valid).
 *
 * Bone-texture bake is cached per URL so VAT shards (past the instance-param
 * texture width) can share one bake and only reload/attach mesh copies.
 * Prefers /assets/baked/vat/* when present.
 *
 * @param {object} engine
 * @param {{ url: string, scale: number, idleClip: string, walkClip: string }} def
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
    const offline = await tryLoadOfflineVatBake(engine, def.url);
    if (offline) {
      cached = offline;
      vatBakeCache.set(def.url, cached);
    } else {
      const idle = findGroup(groups, def.idleClip);
      const walk = findGroup(groups, def.walkClip) ?? findGroup(groups, 'walk');
      const bakeGroups = [];
      if (idle) bakeGroups.push(idle);
      if (walk && walk !== idle) bakeGroups.push(walk);
      if (bakeGroups.length === 0) {
        throw new Error(`no idle/walk clips in ${def.url}`);
      }

      const bakedList = bakeVatMany(
        engine,
        skinned.map((mesh) => ({ mesh })),
        bakeGroups,
      );
      const bakeClipName = bakeGroups[0].name;
      const idleName = idle?.name ?? bakeClipName;
      const walkName = walk?.name ?? idleName;

      let idleClip = bakedList[0].clips[idleName];
      const walkClip = bakedList[0].clips[walkName] ?? idleClip;
      if (!idleClip) throw new Error(`VAT missing clip ${idleName} in ${def.url}`);
      // villager.glb "idle" is a single key at t=0 (bind/T-pose).
      if (idleClip.frameCount <= 1 && walkClip && walkClip.frameCount > 1) {
        idleClip = {
          fromRow: walkClip.fromRow,
          frameCount: walkClip.frameCount,
          fps: Math.max(8, Math.round(walkClip.fps * 0.25)),
        };
      }

      cached = { bakedList, bakeClipName, idleName, walkName, idleClip, walkClip };
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
      idleClip: cached.idleClip,
      walkClip: cached.walkClip,
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
    idleClip: cached.idleClip,
    walkClip: cached.walkClip,
    instanceScale: Math.abs(def.scale),
    footLift: 0.08,
  };
}

/** Fill per-instance VAT params: (fromRow, toRow, timeOffset, fps). */
export function fillVatInstanceParams(params, capacity, idleClip, walkClip, movingFlags) {
  for (let s = 0; s < capacity; s++) {
    const moving = movingFlags ? movingFlags[s] : 0;
    const clip = moving === 1 ? walkClip : idleClip;
    const o = s * 4;
    params[o] = clip.fromRow;
    params[o + 1] = clip.fromRow + clip.frameCount - 1;
    params[o + 2] = (s * 17 + 3) % Math.max(1, clip.frameCount);
    params[o + 3] = moving === 2 ? 0 : clip.fps;
  }
}

export function writeVatSlotParams(params, slot, clip, phase, fps = clip.fps) {
  const o = slot * 4;
  params[o] = clip.fromRow;
  params[o + 1] = clip.fromRow + clip.frameCount - 1;
  params[o + 2] = phase % Math.max(1, clip.frameCount);
  params[o + 3] = fps;
}
