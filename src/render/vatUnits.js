// VAT (baked vertex animation) unit templates — one bake + thin instances.
// Villager GLB is multi-primitive (body / TeamColor shirt / pants / kicks); each
// primitive is its own skinned mesh and must be baked + instanced together.
//
// Important: do NOT detach/rescale meshes after bake. Bone matrices are authored
// against the load-time mesh world (invMeshWorld). Changing mesh.world after
// attachVat yields bind-pose/T-pose. Game scale + foot lift go in the instance matrix.

import {
  attachVat,
  createMeshFromData,
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
  bindingOf,
  CARRY_IDLE_CLIP,
  CARRY_OVERLAY,
  CARRY_WALK_CLIP,
  goToFrameCpu,
  rigidPropMeshMatrix,
  sampleVatGroups,
  skinPositions,
  transformNormalsByMat4,
  transformPointsByMat4,
} from './vatBakeCpu.js';

/** Per-instance VAT clip id (low 7 bits). High bit = frozen (fps=0). */
export const VAT_CLIP = {
  IDLE: 0,
  WALK: 1,
  CARRY: 3,
  CARRY_WALK: 4,
  CHOP: 5,
  ATTACK: 6,
};
export const VAT_FROZEN = 0x80;

/** @typedef {{ name: string, x: number, y: number, z: number, scale?: number }} VatExtraSocket */
/** @typedef {{ url: string, scale: number, idleClip: string, walkClip: string, carryClip?: string, chopClip?: string, attackClip?: string, extraSockets?: readonly VatExtraSocket[] }} VatUnitDef */

/**
 * Stand-in until a brigand GLB has a hand-parented `torch_anchor` empty.
 * Idle `Arm.R` tip (Lite X-mirror). Yields to authored sockets on the mesh.
 */
export const BRIGAND_TORCH_SOCKET = Object.freeze({
  name: 'torch_anchor',
  x: 0.5118,
  y: 1.1828,
  z: -0.0934,
  scale: 0.18,
});

const VILLAGER_VAT = {
  url: '/assets/models/villager.glb',
  // Raw glTF scale — no aftermarket resize (instance matrix only).
  scale: 1,
  idleClip: 'idle',
  walkClip: 'walk_cycle',
  carryClip: 'carry',
  chopClip: 'chop',
};

/** @type {Readonly<Record<number, VatUnitDef>>} */
export const VAT_UNIT_DEFS = {
  [UNIT.VILLAGER]: VILLAGER_VAT,
  // Same villager bake + a hand torch. brigand.glb is three cubes, no clips.
  [UNIT.BRIGAND]: { ...VILLAGER_VAT, extraSockets: [BRIGAND_TORCH_SOCKET] },
  [UNIT.WARRIOR]: {
    url: '/assets/models/warrior.glb',
    scale: 1,
    idleClip: 'Idle',
    walkClip: 'Run',
    attackClip: 'Attack_Swing',
  },
};

export function isVatUnitType(typeId) {
  return typeId in VAT_UNIT_DEFS;
}

function pickClipName(names, preds) {
  for (const pred of preds) {
    const hit = names.find(pred);
    if (hit) return hit;
  }
  return null;
}

/**
 * Map authored glTF animation names onto VAT roles.
 * Exact names win (`idle`, `walk_cycle`, `Run`, `Attack`); otherwise a
 * name that contains the role. Unclassified clips still leave the bind pose:
 * the first one plays as idle and walk.
 * @param {string[]} names
 * @returns {{ idleClip: string, walkClip: string, carryClip?: string, chopClip?: string, attackClip?: string } | null}
 */
export function vatRolesFromClipNames(names) {
  const list = [];
  const seen = new Set();
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  if (list.length === 0) return null;

  const idle = pickClipName(list, [
    (n) => /^idle$/i.test(n),
    (n) => /idle/i.test(n),
  ]);
  const walk = pickClipName(list, [
    (n) => /^walk_cycle$/i.test(n),
    (n) => /^walk$/i.test(n),
    (n) => /^run$/i.test(n),
    (n) => /walk/i.test(n) && !/carry/i.test(n),
    (n) => /run/i.test(n) && !/carry/i.test(n),
    (n) => /walk/i.test(n),
  ]);
  const carry = pickClipName(list, [
    (n) => /^carry$/i.test(n),
    (n) => /carry/i.test(n) && !/walk/i.test(n),
  ]);
  const chop = pickClipName(list, [
    (n) => /^chop$/i.test(n),
    (n) => /chop/i.test(n),
  ]);
  const attack = pickClipName(list, [
    (n) => /^attack$/i.test(n),
    (n) => /attack/i.test(n),
    (n) => /swing/i.test(n),
  ]);

  if (!idle && !walk && !carry && !chop && !attack) {
    return { idleClip: list[0], walkClip: list[0] };
  }
  const idleClip = idle ?? walk ?? attack ?? carry ?? chop ?? list[0];
  const walkClip = walk ?? idleClip;
  return {
    idleClip,
    walkClip,
    ...(carry ? { carryClip: carry } : {}),
    ...(chop ? { chopClip: chop } : {}),
    ...(attack ? { attackClip: attack } : {}),
  };
}

/** @param {ArrayBuffer | ArrayBufferView} buffer */
export function parseGlbJson(buffer) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546C67) return null;
  const chunkLen = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4E4F534A || 20 + chunkLen > bytes.byteLength) return null;
  const text = new TextDecoder().decode(bytes.subarray(20, 20 + chunkLen)).replace(/\0+$/g, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * VAT def for a skinned GLB that already has clips. Null for rigid meshes.
 * @param {string} url
 * @param {object | null | undefined} json
 * @returns {VatUnitDef | null}
 */
export function vatDefFromGlbJson(url, json) {
  const skinned = (json?.skins?.length ?? 0) > 0
    && (json?.nodes ?? []).some((node) => node?.skin != null);
  if (!skinned) return null;
  const roles = vatRolesFromClipNames((json?.animations ?? []).map((anim) => anim?.name));
  if (!roles) return null;
  return { url, scale: 1, ...roles };
}

/** @type {Map<string, Promise<VatUnitDef | null>>} */
const vatSniffCache = new Map();

/**
 * Read a GLB header and return a VAT def when the file is skinned and has clips.
 * Cached per URL. Failures stay on the static mesh path.
 * @param {string} url
 * @returns {Promise<VatUnitDef | null>}
 */
export function sniffVatDef(url) {
  let pending = vatSniffCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) return null;
      return vatDefFromGlbJson(url, parseGlbJson(await res.arrayBuffer()));
    }).catch((err) => {
      console.warn('[vat] clip sniff failed', url, err);
      return null;
    });
    vatSniffCache.set(url, pending);
  }
  return pending;
}

/**
 * VAT bake entries for unit GLBs that have clips but are not already registered.
 * @param {string[]} urls
 * @param {string[]} knownUrls
 */
export async function extraVatBakeDefs(urls, knownUrls) {
  const known = new Set(knownUrls);
  /** @type {VatUnitDef[]} */
  const out = [];
  for (const url of urls) {
    if (!url || known.has(url)) continue;
    known.add(url);
    const def = await sniffVatDef(url);
    if (def) out.push(def);
  }
  return out;
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

/** Width of Lite's VAT instance-param texture for `instanceCount` slots. */
export function vatInstanceTexelWidth(instanceCount) {
  return Math.max(2, (instanceCount | 0) * 2);
}

/**
 * Allocate Lite's instance-param texture at `reserved` slots on first upload.
 * Later `setInstances` with fewer slots only writeTexture — they must not grow,
 * because grow `destroy()`s the old GPUTexture while PBR still holds a cached
 * bind group (WebGPU: "Destroyed texture 64x1 RGBA32Float used in a submit").
 *
 * @param {{ setInstances: (params: Float32Array) => void }} handle
 * @param {number} reservedInstances
 */
export function primeVatInstanceCapacity(handle, reservedInstances) {
  const reserved = Math.max(1, reservedInstances | 0);
  const orig = handle.setInstances.bind(handle);
  const primed = new Float32Array(reserved * 4);
  orig(primed);
  handle.setInstances = (params) => {
    const n = params.length >> 2;
    if (n <= reserved) {
      orig(params);
      return;
    }
    primed.set(params.subarray(0, reserved * 4));
    orig(primed);
  };
}

function attachVatReserved(engine, mesh, baked, clip) {
  const handle = attachVat(engine, mesh, baked, clip);
  primeVatInstanceCapacity(handle, maxVatInstancesPerBatch(engine));
  return handle;
}

function collectSkinnedMeshes(node, out = []) {
  if (node?.skeleton) out.push(node);
  for (const child of node?.children ?? []) collectSkinnedMeshes(child, out);
  return out;
}

/** Hide rigid meshes that are not parented to a joint. Bone-parented weapons stay. */
function hideUnskinnedProps(root, skinned) {
  const keep = new Set(skinned);
  const visit = (node) => {
    if (node?.material && !keep.has(node) && !node.skeleton) {
      if ('visible' in node) node.visible = false;
    }
    for (const child of node?.children ?? []) visit(child);
  };
  visit(root);
}

function findGroup(groups, name) {
  if (!groups?.length || !name) return null;
  const lower = name.toLowerCase();
  return groups.find((g) => (g.name || '').toLowerCase() === lower)
    ?? groups.find((g) => (g.name || '').toLowerCase().includes(lower))
    ?? null;
}

/**
 * Resolve idle / walk / carry / chop / attack animation groups for a VAT bake.
 * @param {object[]} groups
 * @param {VatUnitDef} def
 */
export function collectVatBakeGroups(groups, def) {
  const idle = findGroup(groups, def.idleClip);
  const walk = findGroup(groups, def.walkClip) ?? findGroup(groups, 'walk');
  const carry = def.carryClip ? findGroup(groups, def.carryClip) : null;
  const chop = def.chopClip ? findGroup(groups, def.chopClip) : null;
  const attack = def.attackClip ? findGroup(groups, def.attackClip) : null;
  const bakeGroups = [];
  const seen = new Set();
  for (const g of [idle, walk, carry, chop, attack]) {
    if (!g || seen.has(g)) continue;
    seen.add(g);
    bakeGroups.push(g);
  }
  return { idle, walk, carry, chop, attack, bakeGroups };
}

/** Full-body clips to sample (carry is an arm overlay, not a loco row). */
export function vatSampleGroups(resolved) {
  const { idle, walk, chop, attack, bakeGroups } = resolved;
  const loco = [];
  if (idle) loco.push(idle);
  if (walk && walk !== idle) loco.push(walk);
  if (chop && chop !== idle && chop !== walk) loco.push(chop);
  if (attack && attack !== idle && attack !== walk && attack !== chop) loco.push(attack);
  return loco.length ? loco : bakeGroups;
}

/** Floor for pottering — short legs, keep the farm walk from sliding. */
export const VAT_WALK_RATE_MIN = 0.51;
/** Full-speed orders play faster than the walk clip so they read as a run. */
export const VAT_WALK_RATE_MAX = 2.04;
/** Below this speed ratio, keep a walk; above it, ease toward a run. */
const VAT_WALK_RUN_START = 0.45;

/** Map step/nominal (0–1) onto stroll…run playback. */
export function vatWalkGait(walkRate) {
  if (!(walkRate > 0)) return 0;
  const r = walkRate > 1 ? 1 : walkRate;
  const stroll = r < VAT_WALK_RATE_MIN ? VAT_WALK_RATE_MIN : r;
  const t = r <= VAT_WALK_RUN_START ? 0 : (r - VAT_WALK_RUN_START) / (1 - VAT_WALK_RUN_START);
  return stroll + (VAT_WALK_RATE_MAX - stroll) * t * t;
}

/** Walk / carry-walk playback vs clip fps. Stroll stays a walk; full speed runs. */
export function vatWalkFps(clipFps, walkRate = 1) {
  if (!(clipFps > 0)) return 0;
  return clipFps * vatWalkGait(walkRate);
}

export function vatWant(moving, carrying, animate, chopping = false, attacking = false) {
  let clip = VAT_CLIP.IDLE;
  if (carrying && moving) clip = VAT_CLIP.CARRY_WALK;
  else if (carrying) clip = VAT_CLIP.CARRY;
  else if (chopping) clip = VAT_CLIP.CHOP;
  else if (attacking) clip = VAT_CLIP.ATTACK;
  else if (moving) clip = VAT_CLIP.WALK;
  return animate ? clip : (clip | VAT_FROZEN);
}

/**
 * @param {{ idleClip: object, walkClip: object, carryClip?: object | null, carryWalkClip?: object | null, chopClip?: object | null, attackClip?: object | null }} clips
 * @param {number} state
 */
export function clipForVatState(clips, state) {
  const id = state === 2 ? VAT_CLIP.IDLE : (state & ~VAT_FROZEN);
  if (id === VAT_CLIP.WALK) return clips.walkClip;
  if (id === VAT_CLIP.CARRY_WALK) {
    return clips.carryWalkClip ?? clips.walkClip ?? clips.idleClip;
  }
  if (id === VAT_CLIP.CARRY) return clips.carryClip ?? clips.idleClip;
  if (id === VAT_CLIP.CHOP) return clips.chopClip ?? clips.idleClip;
  if (id === VAT_CLIP.ATTACK) return clips.attackClip ?? clips.idleClip;
  return clips.idleClip;
}

function clipNameSet(meta) {
  const names = new Set();
  for (const n of [meta?.idleName, meta?.walkName, meta?.carryName, meta?.chopName, meta?.attackName]) {
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
  if (def.chopClip) need.push(def.chopClip);
  if (def.attackClip) need.push(def.attackClip);
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

/** @type {Map<string, { bakedList: object[], bakeClipName: string, idleName: string, walkName: string, carryName: string | null, chopName: string | null, idleClip: object, walkClip: object, carryClip: object | null, carryWalkClip: object | null, chopClip: object | null }>} */
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
  const resolved = collectVatBakeGroups(groups, def);
  const { idle, walk, carry, chop, attack } = resolved;
  const sampleGroups = vatSampleGroups(resolved);
  if (sampleGroups.length === 0) {
    throw new Error(`no idle/walk clips in ${def.url}`);
  }
  const { prims, clips } = sampleVatGroups(skinned, sampleGroups, stopAnimation);
  const bakeClipName = sampleGroups[0].name;
  const idleName = idle?.name ?? bakeClipName;
  const walkName = walk?.name ?? idleName;
  const carryName = carry?.name ?? null;
  const chopName = chop?.name ?? null;
  const attackName = attack?.name ?? null;
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
    chopName,
    attackName,
    idleClip,
    walkClip,
    carryClip,
    carryWalkClip,
    chopClip: chopName ? (clips[chopName] ?? null) : null,
    attackClip: attackName ? (clips[attackName] ?? null) : null,
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
    chopName: meta.chopName ?? null,
    chopClip: meta.chopClip ?? null,
    attackName: meta.attackName ?? null,
    attackClip: meta.attackClip ?? null,
  };
}

/** @type {Map<string, Promise<object | null>>} */
const glbJsonCache = new Map();

function loadGlbJson(url) {
  let pending = glbJsonCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (res) => {
      if (!res.ok) return null;
      return parseGlbJson(await res.arrayBuffer());
    }).catch(() => null);
    glbJsonCache.set(url, pending);
  }
  return pending;
}

function collectRigidMeshes(node, out = []) {
  if (node?.material && !node.skeleton && !/anchor/i.test(node.name || '')) out.push(node);
  for (const child of node?.children ?? []) collectRigidMeshes(child, out);
  return out;
}

function jointIndexForName(binding, nodes, name) {
  const joints = binding?.jointNodes;
  if (!joints || !name) return -1;
  for (let bi = 0; bi < joints.length; bi++) {
    if (nodes[joints[bi]]?.name === name) return bi;
  }
  return -1;
}

function bindingForMesh(groups, mesh) {
  for (const group of groups ?? []) {
    const binding = bindingOf(group, mesh);
    if (binding?.jointNodes) return binding;
  }
  return null;
}

/**
 * glTF load parent pointers stay null until addToScene. Walk `.children`
 * and link them so joint lookup and world matrices see the bone chain.
 * @returns {Map<object, object>}
 */
function linkChildParents(root) {
  /** @type {Map<object, object>} */
  const parents = new Map();
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      if (!child) continue;
      parents.set(child, node);
      if (child.parent !== node) child.parent = node;
      visit(child);
    }
  };
  visit(root);
  return parents;
}

function findPropJoint(mesh, parents, skinned, groups, nodes) {
  let node = parents.get(mesh);
  while (node) {
    for (let si = 0; si < skinned.length; si++) {
      const binding = bindingForMesh(groups, skinned[si]);
      const jointIndex = jointIndexForName(binding, nodes, node.name);
      if (jointIndex >= 0) {
        return { bakeIndex: si, jointIndex, bone: node, binding };
      }
    }
    node = parents.get(node);
  }
  return null;
}

function writeFloatBuffer(engine, gpuBuffer, data) {
  if (!gpuBuffer || !(data?.byteLength > 0) || gpuBuffer.size < data.byteLength) return false;
  engine._device.queue.writeBuffer(gpuBuffer, 0, data);
  return true;
}

function rigidSkeleton(engine, vertexCount, jointIndex) {
  const device = engine._device;
  const joints = new Uint32Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    joints[i * 4] = jointIndex;
    weights[i * 4] = 1;
  }
  const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
  const mapBuffer = (label, data) => {
    const buffer = device.createBuffer({
      label,
      size: Math.max(4, data.byteLength),
      usage,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    buffer.unmap();
    return buffer;
  };
  const jointsBuffer = mapBuffer('rigid-joints', joints);
  const weightsBuffer = mapBuffer('rigid-weights', weights);
  const boneMatrices = new Float32Array(16);
  boneMatrices[0] = boneMatrices[5] = boneMatrices[10] = boneMatrices[15] = 1;
  const boneTexture = device.createTexture({
    label: 'rigid-bone',
    size: [4, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: boneTexture },
    boneMatrices,
    { bytesPerRow: 64 },
    { width: 4, height: 1 },
  );
  return {
    boneTexture,
    boneCount: 1,
    joints,
    weights,
    jointsBuffer,
    weightsBuffer,
    joints1: null,
    weights1: null,
    joints1Buffer: null,
    weights1Buffer: null,
    _skinBuffers: { jointsBuffer, weightsBuffer, joints1Buffer: null, weights1Buffer: null },
  };
}

function matchMeshFrame(dst, src, parents) {
  const oldParent = parents.get(dst);
  if (oldParent?.children) {
    const index = oldParent.children.indexOf(dst);
    if (index >= 0) oldParent.children.splice(index, 1);
  }
  dst.parent = src.parent;
  if (src.parent?.children && !src.parent.children.includes(dst)) src.parent.children.push(dst);
  if (src.position && dst.position?.set) dst.position.set(src.position.x, src.position.y, src.position.z);
  if (src.rotationQuaternion && dst.rotationQuaternion?.set) {
    dst.rotationQuaternion.set(
      src.rotationQuaternion.x,
      src.rotationQuaternion.y,
      src.rotationQuaternion.z,
      src.rotationQuaternion.w,
    );
  }
  if (src.scaling && dst.scaling?.set) dst.scaling.set(src.scaling.x, src.scaling.y, src.scaling.z);
}

/**
 * A mesh parented to a joint (Blender bone-parent, no armature weights) is
 * rewritten into that joint and drawn with the body's VAT texture.
 * @returns {Promise<object[]>}
 */
async function prepareBoneParentedProps(engine, root, skinned, groups, url) {
  const parents = linkChildParents(root);
  const rigid = collectRigidMeshes(root);
  if (rigid.length === 0 || !groups?.length) return [];
  const json = await loadGlbJson(url);
  const nodes = json?.nodes;
  if (!nodes) return [];
  const props = [];
  for (const mesh of rigid) {
    try {
      const hit = findPropJoint(mesh, parents, skinned, groups, nodes);
      const positions = mesh._cpuPositions;
      if (!hit || !positions?.length) continue;
      const boneWorld = hit.bone.worldMatrix;
      const propWorld = mesh.worldMatrix;
      const into = boneWorld && propWorld
        ? rigidPropMeshMatrix(hit.binding.inverseBindMatrices, hit.jointIndex * 16, boneWorld, propWorld)
        : null;
      const nextPos = into && transformPointsByMat4(into, positions);
      if (!nextPos || !writeFloatBuffer(engine, mesh._gpu?.positionBuffer, nextPos)) continue;
      mesh._cpuPositions = nextPos;
      const normals = mesh._cpuNormals;
      if (normals?.length === positions.length) {
        const nextN = transformNormalsByMat4(into, normals);
        if (nextN && writeFloatBuffer(engine, mesh._gpu?.normalBuffer, nextN)) mesh._cpuNormals = nextN;
      }
      mesh.skeleton = rigidSkeleton(engine, (positions.length / 3) | 0, hit.jointIndex);
      mesh._vatBakeIndex = hit.bakeIndex;
      matchMeshFrame(mesh, skinned[hit.bakeIndex], parents);
      props.push(mesh);
    } catch (err) {
      console.warn('[vat] prop bind failed', mesh?.name, err);
    }
  }
  return props;
}

function posedBoneMatrices(group, mesh, skinned) {
  const donor = mesh._vatBakeIndex != null ? skinned[mesh._vatBakeIndex] : mesh;
  return bindingOf(group, donor)?.boneMatrices ?? donor?.skeleton?.boneMatrices ?? null;
}

function boundsFromPositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { min, max };
}

function listedVatDefForUrl(url) {
  for (const def of Object.values(VAT_UNIT_DEFS)) {
    if (def.url === url) return def;
  }
  return null;
}

/** Same LH / CW normals the static mesh bake uses, so the icon lights from the outside. */
function smoothNormalsLH(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = acy * abz - acz * aby;
    const ny = acz * abx - acx * abz;
    const nz = acx * aby - acy * abx;
    for (const o of [ia, ib, ic]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

function iconMaterialStub(mesh, gltf) {
  const name = String(mesh.material?.name || '').replace(/_clone$/i, '');
  const live = mesh.material?.baseColorFactor ?? mesh.material?._baseColorFactor;
  const desc = gltf?.materials?.find((m) => m.name === name);
  const factor = (live?.length >= 3 ? live : null)
    ?? desc?.pbrMetallicRoughness?.baseColorFactor
    ?? [0.72, 0.75, 0.8, 1];
  return { name, baseColorFactor: factor.slice(0, 4) };
}

function meshFromPosedPart(engine, url, index, source, positions, gltf) {
  const indices = source._cpuIndices instanceof Uint32Array
    ? source._cpuIndices
    : new Uint32Array(source._cpuIndices);
  const normals = smoothNormalsLH(positions, indices);
  const uvs = source._cpuUvs ? new Float32Array(source._cpuUvs) : undefined;
  const mesh = createMeshFromData(engine, `${url}#idle${index}`, positions, normals, indices, uvs);
  mesh.material = iconMaterialStub(source, gltf);
  mesh.pickable = false;
  const box = boundsFromPositions(positions);
  mesh.boundMin = box.min;
  mesh.boundMax = box.max;
  mesh.position?.set?.(0, 0, 0);
  mesh.scaling?.set?.(1, 1, 1);
  mesh.rotationQuaternion?.set?.(0, 0, 0, 1);
  return mesh;
}

/**
 * One still from the idle clip, baked like the static icon meshes.
 * Null when the GLB has no idle clip — caller keeps the bind-pose bake.
 * @returns {Promise<object[] | null>}
 */
export async function loadIdleIconMeshes(engine, url) {
  const def = listedVatDefForUrl(url) ?? await sniffVatDef(url);
  if (!def?.idleClip) return null;
  const [container, gltf] = await Promise.all([
    loadGltf(engine, url),
    loadGlbJson(url),
  ]);
  const root = container.entities?.[0];
  if (!root) return null;
  const skinned = collectSkinnedMeshes(root);
  if (!skinned.length) return null;
  const groups = container.animationGroups ?? [];
  for (const group of groups) stopAnimation(group);
  const props = await prepareBoneParentedProps(engine, root, skinned, groups, url);
  const idle = collectVatBakeGroups(groups, def).idle;
  if (!idle) return null;
  goToFrameCpu(idle, 0);

  const posedMeshes = [];
  for (const mesh of [...skinned, ...props]) {
    const bind = mesh._cpuPositions;
    const mats = posedBoneMatrices(idle, mesh, skinned);
    const skel = mesh.skeleton;
    const world = mesh.worldMatrix;
    if (!bind?.length || !mats || !skel?.joints || !skel?.weights || !mesh._cpuIndices || !(world?.length >= 16)) {
      continue;
    }
    const localPos = skinPositions(
      mats, skel.joints, skel.weights, bind, undefined, skel.joints1, skel.weights1,
    );
    const posed = transformPointsByMat4(world, localPos);
    posedMeshes.push(meshFromPosedPart(engine, url, posedMeshes.length, mesh, posed, gltf));
  }
  return posedMeshes.length ? posedMeshes : null;
}

function donorMaterial(skinned) {
  return skinned.find((m) => /material\.001/i.test(materialName(m)))?.material
    ?? skinned.find((m) => /kicks/i.test(materialName(m)))?.material
    ?? skinned.find((m) => !isTeamColorPart(m))?.material
    ?? null;
}

function pushVatParts(engine, list, cached, donorMat, parts) {
  for (let i = 0; i < list.length; i++) {
    const mesh = list[i];
    const bakeIndex = mesh._vatBakeIndex ?? i;
    const handle = attachVatReserved(engine, mesh, cached.bakedList[bakeIndex], cached.bakeClipName);
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
 * @param {VatUnitDef} def
 */
export async function loadVatUnitTemplate(engine, def) {
  const container = await loadGltf(engine, def.url);
  const root = container.entities[0];
  if (!root) throw new Error(`no root in ${def.url}`);

  const skinned = collectSkinnedMeshes(root);
  if (skinned.length === 0) throw new Error(`no skinned mesh in ${def.url}`);

  const groups = container.animationGroups ?? [];
  for (const g of groups) stopAnimation(g);
  const props = await prepareBoneParentedProps(engine, root, skinned, groups, def.url);
  const meshes = props.length ? [...skinned, ...props] : skinned;
  hideUnskinnedProps(root, meshes);

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
        chopName: live.chopName,
        chopClip: live.chopClip,
        attackName: live.attackName,
        attackClip: live.attackClip,
      };
      vatBakeCache.set(def.url, cached);
    }

    const donorMat = donorMaterial(skinned);
    /** @type {{ mesh: object, handle: object, isTeamColor: boolean }[]} */
    const parts = [];
    pushVatParts(engine, meshes, cached, donorMat, parts);

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
      chopClip: cached.chopClip ?? null,
      attackClip: cached.attackClip ?? null,
      instanceScale: Math.abs(def.scale),
      footLift: 0.08,
    };
  }

  // Shard: fresh glTF meshes + shared bone-texture bake (no re-bake).
  if (cached.bakedList.length !== skinned.length) {
    throw new Error(`VAT bake/mesh count mismatch for ${def.url}`);
  }

  const donorMat = donorMaterial(skinned);
  /** @type {{ mesh: object, handle: object, isTeamColor: boolean }[]} */
  const parts = [];
  pushVatParts(engine, meshes, cached, donorMat, parts);

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
    chopClip: cached.chopClip ?? null,
    attackClip: cached.attackClip ?? null,
    instanceScale: Math.abs(def.scale),
    footLift: 0.08,
  };
}

/** Fill per-instance VAT params: (fromRow, toRow, timeOffset, fps). */
export function fillVatInstanceParams(params, capacity, idleClip, walkClip, movingFlags, carryClip = null, carryWalkClip = null, chopClip = null, attackClip = null) {
  const clips = { idleClip, walkClip, carryClip, carryWalkClip, chopClip, attackClip };
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
