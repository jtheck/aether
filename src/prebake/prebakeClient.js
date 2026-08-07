// Browser-side prebake: mesh packages, sockets, VAT dumps.
// Driven by prebake.mjs via Playwright (or open /prebake/prebake.html manually).

import { createEngine, createSceneContext, bakeVatMany, loadGltf, stopAnimation } from '../vendor/lite/liteVendor.js';
import { bakeGltfParts } from '../render/unitModels.js';
import { packBinary, bakedMeshStem } from '../render/bakedAssets.js';
import { allMeshBakeUrls, allVatBakeDefs } from './bakeUrls.js';
import { BUILDING_MODEL_URLS } from '../sim/buildings.js';
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

function findGroup(groups, name) {
  if (!groups?.length) return null;
  const lower = name.toLowerCase();
  return groups.find((g) => (g.name || '').toLowerCase() === lower)
    ?? groups.find((g) => (g.name || '').toLowerCase().includes(lower))
    ?? null;
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
  const { materials, images } = extractGlbMaterials(glbBuf);

  const imageFiles = images.map((img, idx) => {
    if (!img.bytes?.length) return null;
    const file = `img-${idx}.${mimeExt(img.mimeType)}`;
    filesOut[`meshes/${stem}/${file}`] = img.bytes.buffer.slice(
      img.bytes.byteOffset,
      img.bytes.byteOffset + img.bytes.byteLength,
    );
    return { file, mimeType: img.mimeType };
  });

  const entries = [];
  const partMetas = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const indices = p.indices instanceof Uint32Array ? p.indices : new Uint32Array(p.indices);
    const prefix = `p${i}`;
    entries.push({ key: `${prefix}_pos`, data: p.positions });
    entries.push({ key: `${prefix}_nrm`, data: p.normals });
    entries.push({ key: `${prefix}_idx`, data: indices });
    if (p.uvs) entries.push({ key: `${prefix}_uvs`, data: p.uvs });
  }
  const { buffer, spans } = packBinary(entries);
  for (let i = 0; i < parts.length; i++) {
    const prefix = `p${i}`;
    const src = sources[i];
    const matName = String(src?.material?.name || '').replace(/_clone$/i, '');
    let materialIndex = materials.findIndex((m) => m.name === matName);
    if (materialIndex < 0) materialIndex = Math.min(i, Math.max(0, materials.length - 1));
    partMetas.push({
      materialName: matName || `part${i}`,
      materialIndex,
      reverseWinding: true,
      positions: spans[`${prefix}_pos`],
      normals: spans[`${prefix}_nrm`],
      indices: spans[`${prefix}_idx`],
      uvs: spans[`${prefix}_uvs`] || null,
    });
  }
  return {
    stem,
    json: {
      sourceUrl: url,
      version: 2,
      sockets,
      materials,
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
 * @param {{ url: string, idleClip: string, walkClip: string }} def
 */
async function bakeVatPackage(engine, def) {
  const container = await loadGltf(engine, def.url);
  const root = container.entities[0];
  const skinned = collectSkinnedMeshes(root);
  if (skinned.length === 0) throw new Error(`no skinned mesh in ${def.url}`);
  const groups = container.animationGroups ?? [];
  for (const g of groups) stopAnimation(g);
  const idle = findGroup(groups, def.idleClip);
  const walk = findGroup(groups, def.walkClip) ?? findGroup(groups, 'walk');
  const bakeGroups = [];
  if (idle) bakeGroups.push(idle);
  if (walk && walk !== idle) bakeGroups.push(walk);
  if (bakeGroups.length === 0) throw new Error(`no clips in ${def.url}`);

  // Still run bakeVatMany so clip metadata / validation match runtime.
  const bakedList = bakeVatMany(
    engine,
    skinned.map((mesh) => ({ mesh })),
    bakeGroups,
  );
  const bakeClipName = bakeGroups[0].name;
  const idleName = idle?.name ?? bakeClipName;
  const walkName = walk?.name ?? idleName;
  let idleClip = { ...bakedList[0].clips[idleName] };
  let walkClip = { ...(bakedList[0].clips[walkName] ?? idleClip) };
  if (idleClip.frameCount <= 1 && walkClip.frameCount > 1) {
    idleClip = {
      fromRow: walkClip.fromRow,
      frameCount: walkClip.frameCount,
      fps: Math.max(8, Math.round(walkClip.fps * 0.25)),
    };
  }

  // Re-sample CPU bone matrices into dumps (mirror Lite vat-baker sampling).
  const DEFAULT_FRAME_RATE = 60;
  function clipFrameCount(group) {
    const fps = group.frameRate || DEFAULT_FRAME_RATE;
    return Math.max(1, Math.round(group.duration * fps) + 1);
  }
  function goToFrameCpu(group, frame) {
    const ctrl = group._ctrl;
    group.currentTime = frame / (group.frameRate || DEFAULT_FRAME_RATE);
    group.isPlaying = false;
    if (!ctrl) return;
    ctrl.time = group.currentTime;
    ctrl.playing = false;
    ctrl.speedRatio = group.speedRatio;
    ctrl.loop = group.loopAnimation;
    ctrl._setMask?.(group.mask ?? null);
    ctrl._tickCpu?.(0);
    group.currentTime = ctrl.time;
  }
  function bindingOf(group, mesh) {
    const skeleton = mesh.skeleton;
    if (!skeleton) return null;
    const bindings = group._gltfMixer?.[2];
    return bindings?.find(
      (binding) => binding.runtimeSkeleton === skeleton || binding.boneTexture === skeleton.boneTexture,
    ) ?? null;
  }

  let frameCount = 0;
  for (const group of bakeGroups) frameCount += clipFrameCount(group);
  frameCount = Math.max(1, frameCount);

  const primData = skinned.map((mesh) => {
    const boneCount = mesh.skeleton.boneCount;
    return {
      boneCount,
      data: new Float32Array(frameCount * boneCount * 16),
    };
  });

  let row = 0;
  for (let gi = 0; gi < bakeGroups.length; gi++) {
    const group = bakeGroups[gi];
    const frames = clipFrameCount(group);
    for (let frame = 0; frame < frames; frame++) {
      goToFrameCpu(group, frame);
      for (let mi = 0; mi < skinned.length; mi++) {
        const binding = bindingOf(group, skinned[mi]);
        if (!binding) throw new Error(`VAT binding missing for prim ${mi} clip ${group.name}`);
        const floatsPerFrame = primData[mi].boneCount * 16;
        primData[mi].data.set(binding.boneMatrices.subarray(0, floatsPerFrame), row * floatsPerFrame);
      }
      row++;
    }
    stopAnimation(group);
  }

  const prims = [];
  let byteOffset = 0;
  for (let i = 0; i < primData.length; i++) {
    byteOffset = align4(byteOffset);
    prims.push({
      boneCount: primData[i].boneCount,
      frameCount,
      clips: bakedList[i].clips,
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
      idleClip,
      walkClip,
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

  setStatus(`Done — ${Object.keys(files).length} files`);
  window.__PREBAKE_RESULT__ = { ok: true, files, buildingSpawns };
  return window.__PREBAKE_RESULT__;
}

window.runPrebake = runPrebake;
