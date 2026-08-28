// Browser-side prebake: mesh packages, sockets, VAT dumps.
// Driven by prebake.mjs via Playwright (or open /prebake/prebake.html manually).

import { createEngine, createSceneContext, loadGltf, stopAnimation } from '../vendor/lite/liteVendor.js';
import { bakeGltfParts, UNIT_MODEL_URLS } from '../render/unitModels.js';
import { packBinary, bakedMeshStem } from '../render/bakedAssets.js';
import {
  BAKE_MESH_VERSION,
  compactImages,
  mergeSlicedParts,
} from '../render/bakeMerge.js';
import { allMeshBakeUrls, allVatBakeDefs } from './bakeUrls.js';
import { collectVatBakeGroups } from '../render/vatUnits.js';
import {
  appendCarryLocomotion,
  CARRY_OVERLAY,
  sampleVatGroups,
} from '../render/vatBakeCpu.js';
import { BUILDING_MODEL_URLS } from '../sim/buildings.js';
import { serializeGeneratedTransportSeats, spawnSeatsFromSockets } from '../render/transportSeats.js';
import { extractGlbMaterials } from './glbMaterials.js';

function mimeExt(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  console.log('[prebake]', msg);
}

function align4(n) {
  return (n + 3) & ~3;
}

function collectSkinnedMeshes(node, out = []) {
  if (node?.skeleton) out.push(node);
  for (const child of node?.children ?? []) collectSkinnedMeshes(child, out);
  return out;
}

/**
 * @param {object} engine
 * @param {string} url
 * @param {Record<string, string | ArrayBuffer>} filesOut
 */
async function bakeMeshPackage(engine, url, filesOut) {
  const stem = bakedMeshStem(url);
  const [bakeResult, glbBuf] = await Promise.all([
    bakeGltfParts(engine, url),
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const { parts, sockets, sources } = bakeResult;
  const extracted = extractGlbMaterials(glbBuf);

  /** @type {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array, uvs: Float32Array | null, reverseWinding: boolean, materialIndex: number, materialName: string }[]} */
  const sliced = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const src = sources[i];
    const matName = String(src?.material?.name || '').replace(/_clone$/i, '');
    let materialIndex = extracted.materials.findIndex((m) => m.name === matName);
    if (materialIndex < 0) materialIndex = Math.min(i, Math.max(0, extracted.materials.length - 1));
    sliced.push({
      positions: p.positions,
      normals: p.normals,
      indices: p.indices instanceof Uint32Array ? p.indices : new Uint32Array(p.indices),
      uvs: p.uvs,
      reverseWinding: p.reverseWinding !== false,
      materialIndex,
      materialName: matName || `part${i}`,
    });
  }
  const merged = mergeSlicedParts(sliced, extracted.materials);
  const compacted = compactImages(merged.materials, extracted.images);

  const imageFiles = compacted.images.map((img, idx) => {
    if (!img.bytes?.length) return null;
    const file = `img-${idx}.${mimeExt(img.mimeType)}`;
    filesOut[`meshes/${stem}/${file}`] = img.bytes.buffer.slice(
      img.bytes.byteOffset,
      img.bytes.byteOffset + img.bytes.byteLength,
    );
    return { file, mimeType: img.mimeType };
  });

  const entries = [];
  for (let i = 0; i < merged.parts.length; i++) {
    const p = merged.parts[i];
    const prefix = `p${i}`;
    entries.push({ key: `${prefix}_pos`, data: p.positions });
    entries.push({ key: `${prefix}_nrm`, data: p.normals });
    entries.push({ key: `${prefix}_idx`, data: p.indices });
    if (p.uvs) entries.push({ key: `${prefix}_uvs`, data: p.uvs });
  }
  const { buffer, spans } = packBinary(entries);
  const partMetas = merged.parts.map((p, i) => {
    const prefix = `p${i}`;
    return {
      materialName: p.materialName,
      materialIndex: p.materialIndex,
      reverseWinding: p.reverseWinding,
      boundMin: p.boundMin,
      boundMax: p.boundMax,
      positions: spans[`${prefix}_pos`],
      normals: spans[`${prefix}_nrm`],
      indices: spans[`${prefix}_idx`],
      uvs: spans[`${prefix}_uvs`] || null,
    };
  });
  return {
    stem,
    json: {
      sourceUrl: url,
      version: BAKE_MESH_VERSION,
      sockets,
      materials: compacted.materials,
      images: imageFiles,
      parts: partMetas,
    },
    bin: buffer,
    sockets,
  };
}

/**
 * CPU-sample bone matrices the same way Lite's bakeVatMany does, without relying
 * on GPU texture readback (Lite textures are CopyDst|TextureBinding only).
 * @param {object} engine
 * @param {{ url: string, idleClip: string, walkClip: string, carryClip?: string, chopClip?: string }} def
 */
async function bakeVatPackage(engine, def) {
  const container = await loadGltf(engine, def.url);
  const root = container.entities[0];
  const skinned = collectSkinnedMeshes(root);
  if (skinned.length === 0) throw new Error(`no skinned mesh in ${def.url}`);
  const groups = container.animationGroups ?? [];
  for (const g of groups) stopAnimation(g);
  const { idle, walk, carry, chop, bakeGroups } = collectVatBakeGroups(groups, def);
  if (bakeGroups.length === 0) throw new Error(`no clips in ${def.url}`);

  const loco = [];
  if (idle) loco.push(idle);
  if (walk && walk !== idle) loco.push(walk);
  if (chop && chop !== idle && chop !== walk) loco.push(chop);
  const sampleGroups = loco.length ? loco : bakeGroups;
  const { prims: primData, clips } = sampleVatGroups(skinned, sampleGroups, stopAnimation);
  const bakeClipName = sampleGroups[0].name;
  const idleName = idle?.name ?? bakeClipName;
  const walkName = walk?.name ?? idleName;
  const carryName = carry?.name ?? null;
  const chopName = chop?.name ?? null;
  const idleClip = { ...clips[idleName] };
  const walkClip = { ...(clips[walkName] ?? idleClip) };
  const chopClip = chopName && clips[chopName] ? { ...clips[chopName] } : null;
  let carryClip = null;
  let carryIdleClip = null;
  let carryWalkClip = null;
  if (carry) {
    const stamped = appendCarryLocomotion(primData, clips, skinned, idle, walk, carry);
    if (stamped.idle) {
      carryIdleClip = { ...stamped.idle };
      carryClip = carryIdleClip;
    }
    if (stamped.walk) carryWalkClip = { ...stamped.walk };
  }

  const prims = [];
  let byteOffset = 0;
  for (let i = 0; i < primData.length; i++) {
    byteOffset = align4(byteOffset);
    prims.push({
      boneCount: primData[i].boneCount,
      frameCount: primData[i].frameCount,
      clips: { ...clips },
      byteOffset,
      floatCount: primData[i].data.length,
    });
    byteOffset += primData[i].data.byteLength;
  }
  const bin = new ArrayBuffer(byteOffset);
  for (let i = 0; i < primData.length; i++) {
    new Uint8Array(bin, prims[i].byteOffset, primData[i].data.byteLength).set(
      new Uint8Array(
        primData[i].data.buffer,
        primData[i].data.byteOffset,
        primData[i].data.byteLength,
      ),
    );
  }

  return {
    stem: bakedMeshStem(def.url),
    json: {
      sourceUrl: def.url,
      bakeClipName,
      idleName,
      walkName,
      carryName,
      chopName,
      idleClip,
      walkClip,
      chopClip,
      carryClip,
      carryIdleClip,
      carryWalkClip,
      carryOverlay: carryIdleClip || carryWalkClip ? CARRY_OVERLAY : undefined,
      prims,
    },
    bin,
  };
}

function spawnFromSockets(sockets) {
  const spawn = sockets.find((s) => /spawn/i.test(s.name));
  if (!spawn) return null;
  return { x: spawn.x, y: spawn.y, z: spawn.z };
}

/**
 * @returns {Promise<object>}
 */
export async function runPrebake() {
  setStatus('Creating WebGPU engine…');
  const canvas = document.getElementById('canvas');
  if (!canvas) throw new Error('missing #canvas');
  const engine = await createEngine(canvas, { antialias: false });
  createSceneContext(engine);

  const meshUrls = allMeshBakeUrls();
  const vatDefs = allVatBakeDefs();
  /** @type {Record<string, object>} */
  const files = {};
  /** @type {Record<string, { x: number, y: number, z: number }>} */
  const buildingSpawns = {};
  /** @type {Record<string, { name: string, x: number, y: number, z: number }[]>} */
  const allSockets = {};

  for (let i = 0; i < meshUrls.length; i++) {
    const url = meshUrls[i];
    setStatus(`Mesh ${i + 1}/${meshUrls.length}: ${url}`);
    try {
      const pkg = await bakeMeshPackage(engine, url, files);
      files[`meshes/${pkg.stem}.json`] = JSON.stringify(pkg.json, null, 2);
      files[`meshes/${pkg.stem}.bin`] = pkg.bin;
      allSockets[url] = pkg.sockets;
      for (const [id, modelUrl] of Object.entries(BUILDING_MODEL_URLS)) {
        if (modelUrl === url) {
          const spawn = spawnFromSockets(pkg.sockets);
          if (spawn) buildingSpawns[id] = spawn;
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(`FAIL mesh ${url}: ${err?.message || err}`);
      throw err;
    }
  }

  for (let i = 0; i < vatDefs.length; i++) {
    const def = vatDefs[i];
    setStatus(`VAT ${i + 1}/${vatDefs.length}: ${def.url}`);
    const pkg = await bakeVatPackage(engine, def);
    files[`vat/${pkg.stem}.json`] = JSON.stringify(pkg.json, null, 2);
    files[`vat/${pkg.stem}.bin`] = pkg.bin;
  }

  files['sockets.json'] = JSON.stringify({ byUrl: allSockets, buildingSpawns }, null, 2);
  files['manifest.json'] = JSON.stringify({
    meshes: Object.keys(files)
      .filter((k) => k.startsWith('meshes/') && k.endsWith('.json'))
      .map((k) => k.slice('meshes/'.length, -'.json'.length)),
    vat: Object.keys(files)
      .filter((k) => k.startsWith('vat/') && k.endsWith('.json'))
      .map((k) => k.slice('vat/'.length, -'.json'.length)),
  }, null, 2);

  const spawnSrc = `// AUTO-GENERATED by \`npm run prebake\` — do not edit by hand.
// Spawn empties (\`spawn_anchor*\`) extracted from building GLBs.

/** @type {Readonly<Record<string, { x: number, y: number, z: number }>>} */
export const GENERATED_BUILDING_SPAWN_LOCAL = Object.freeze({
${Object.entries(buildingSpawns).map(([id, s]) => (
    `  ${JSON.stringify(id)}: Object.freeze({ x: ${s.x}, y: ${s.y}, z: ${s.z} }),`
  )).join('\n')}
});
`;
  files['__generated__/buildingSpawnLocal.generated.js'] = spawnSrc;

  const transportSeats = {};
  for (const modelUrl of Object.values(UNIT_MODEL_URLS)) {
    const seats = spawnSeatsFromSockets(allSockets[modelUrl]);
    if (!seats.length) continue;
    transportSeats[bakedMeshStem(modelUrl)] = seats;
  }
  files['__generated__/render/transportSeats.generated.js'] =
    serializeGeneratedTransportSeats(transportSeats);

  setStatus(`Done — ${Object.keys(files).length} files`);
  window.__PREBAKE_RESULT__ = { ok: true, files, buildingSpawns };
  return window.__PREBAKE_RESULT__;
}

window.runPrebake = runPrebake;
