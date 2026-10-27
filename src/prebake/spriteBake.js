// Orthographic portraits of roster GLBs, written to assets/baked/sprites/.
// Lite's screenshot readback forces opaque alpha, so each model is shot on
// black and on white and the coverage is recovered from the difference.
// Skinned meshes hold their idle frame; buildings stay in the authored pose.

import { bakedMeshStem } from '../render/bakedAssets.js';
import {
  bindingOf,
  goToFrameCpu,
  skinNormals,
  rigidPropMeshMatrix,
  skinPositions,
  transformNormalsByMat4,
  transformPointsByMat4,
} from '../render/vatBakeCpu.js';
import { spriteBakeEntries } from './spriteRoster.js';

const CELL = 256;
const RENDER = 512;

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function forEachMesh(node, fn) {
  if (node?.material) fn(node);
  const kids = node?.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) forEachMesh(kids[i], fn);
}

function collectSkinned(node, out) {
  if (node?.skeleton) out.push(node);
  const kids = node?.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) collectSkinned(kids[i], out);
}

function smoothNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
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

function collectRigid(node, out) {
  if (node?.material && !node.skeleton && !/anchor/i.test(node.name || '')) out.push(node);
  const kids = node?.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) collectRigid(kids[i], out);
}

function linkParents(roots) {
  const parents = new Map();
  const visit = (node) => {
    const kids = node?.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (!child) continue;
      parents.set(child, node);
      if (child.parent !== node) child.parent = node;
      visit(child);
    }
  };
  for (const root of roots) visit(root);
  return parents;
}

async function glbNodes(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const len = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  return json.nodes ?? null;
}

function jointIndexForName(binding, nodes, name) {
  const joints = binding?.jointNodes;
  if (!joints || !name) return -1;
  for (let i = 0; i < joints.length; i++) {
    if (nodes[joints[i]]?.name === name) return i;
  }
  return -1;
}

function bindingFor(groups, mesh) {
  for (const group of groups ?? []) {
    const binding = bindingOf(group, mesh);
    if (binding?.jointNodes) return binding;
  }
  return null;
}

function findPropJoint(mesh, parents, skinned, groups, nodes) {
  let node = parents.get(mesh);
  while (node) {
    for (let si = 0; si < skinned.length; si++) {
      const binding = bindingFor(groups, skinned[si]);
      const jointIndex = jointIndexForName(binding, nodes, node.name);
      if (jointIndex >= 0) return { bakeIndex: si, jointIndex, bone: node, binding };
    }
    node = parents.get(node);
  }
  return null;
}

/**
 * Replace skinned meshes with a static idle pose so the portrait is not the bind pose.
 * Bone-parented weapons are baked into that same pose.
 * @returns {Promise<object[]>}
 */
async function poseSkinnedIdle(lite, engine, scene, roots, groups, url) {
  const skinned = [];
  for (const root of roots) collectSkinned(root, skinned);
  if (!skinned.length) return [];
  const idle = idleGroup(groups);
  if (!idle) return [];
  for (const group of groups ?? []) {
    group.isPlaying = false;
    group._stopped = true;
  }
  // Prop matrices must be the bind pose. rigidPropMeshMatrix expects the
  // joint world from before the idle clip; the posed bone matrix applies it.
  const nodes = await glbNodes(url);
  const parents = linkParents(roots);
  const propSnaps = [];
  if (nodes) {
    const rigid = [];
    for (const root of roots) collectRigid(root, rigid);
    for (const prop of rigid) {
      const hit = findPropJoint(prop, parents, skinned, groups, nodes);
      const boneWorld = hit?.bone?.worldMatrix;
      const propWorld = prop.worldMatrix;
      if (!hit || !prop._cpuPositions?.length || !(boneWorld?.length >= 16) || !(propWorld?.length >= 16)) {
        continue;
      }
      propSnaps.push({
        prop,
        hit,
        boneWorld: new Float32Array(boneWorld),
        propWorld: new Float32Array(propWorld),
      });
    }
  }
  goToFrameCpu(idle, 0);
  const posed = [];
  const hide = [];
  const addPosed = (name, positions, normals, indices, uvs, material) => {
    const posedMesh = lite.createMeshFromData(
      engine,
      name,
      positions,
      normals ?? smoothNormals(positions, indices),
      indices,
      uvs,
    );
    posedMesh.material = material;
    if (posedMesh.material) {
      posedMesh.material.backFaceCulling = false;
      posedMesh.material.doubleSided = true;
    }
    const box = boundsFromPositions(positions);
    posedMesh.boundMin = box.min;
    posedMesh.boundMax = box.max;
    posedMesh.position?.set?.(0, 0, 0);
    lite.addToScene(scene, posedMesh);
    posed.push(posedMesh);
  };
  const worlds = [];
  for (let i = 0; i < skinned.length; i++) {
    const mesh = skinned[i];
    const bind = mesh._cpuPositions;
    const skel = mesh.skeleton;
    const world = mesh.worldMatrix;
    const mats = bindingOf(idle, mesh)?.boneMatrices ?? skel?.boneMatrices ?? null;
    if (!bind?.length || !mats || !skel?.joints || !skel?.weights || !mesh._cpuIndices || !(world?.length >= 16)) {
      continue;
    }
    const localPos = skinPositions(
      mats, skel.joints, skel.weights, bind, undefined, skel.joints1, skel.weights1,
    );
    const positions = transformPointsByMat4(world, localPos);
    const indices = mesh._cpuIndices instanceof Uint32Array
      ? mesh._cpuIndices
      : new Uint32Array(mesh._cpuIndices);
    let normals = null;
    if (mesh._cpuNormals?.length === bind.length) {
      const localN = skinNormals(
        mats, skel.joints, skel.weights, mesh._cpuNormals, undefined, skel.joints1, skel.weights1,
      );
      normals = transformNormalsByMat4(world, localN);
    }
    const uvs = mesh._cpuUvs ? new Float32Array(mesh._cpuUvs) : undefined;
    worlds[i] = new Float32Array(world);
    addPosed(`${mesh.name || 'skin'}#pose`, positions, normals, indices, uvs, mesh.material);
    hide.push(mesh);
  }

  for (const snap of propSnaps) {
    const { prop, hit } = snap;
    const positions = prop._cpuPositions;
    const skinnedWorld = worlds[hit.bakeIndex];
    const boneMatrices = hit.binding.boneMatrices;
    const jointOff = hit.jointIndex * 16;
    if (!positions?.length || !skinnedWorld || !boneMatrices || jointOff + 16 > boneMatrices.length) continue;
    const into = rigidPropMeshMatrix(
      hit.binding.inverseBindMatrices,
      jointOff,
      snap.boneWorld,
      snap.propWorld,
    );
    if (!into) continue;
    const meshSpace = transformPointsByMat4(into, positions);
    const localPosed = transformPointsByMat4(boneMatrices.subarray(jointOff, jointOff + 16), meshSpace);
    const worldPos = transformPointsByMat4(skinnedWorld, localPosed);
    const indices = prop._cpuIndices instanceof Uint32Array
      ? prop._cpuIndices
      : new Uint32Array(prop._cpuIndices ?? []);
    if (!indices.length) continue;
    const uvs = prop._cpuUvs ? new Float32Array(prop._cpuUvs) : undefined;
    addPosed(`${prop.name || 'prop'}#pose`, worldPos, null, indices, uvs, prop.material);
    hide.push(prop);
  }
  for (const mesh of hide) lite.setSubtreeVisible(mesh, false);
  return posed;
}

function projectedHalf(camera, min, max, zoom) {
  const w = camera.worldMatrix;
  const rx = w[0];
  const ry = w[1];
  const rz = w[2];
  const ux = w[4];
  const uy = w[5];
  const uz = w[6];
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;
  let reach = 0;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        reach = Math.max(
          reach,
          Math.abs(dx * rx + dy * ry + dz * rz),
          Math.abs(dx * ux + dy * uy + dz * uz),
        );
      }
    }
  }
  const pad = Math.max(1.08, 1.16 / zoom);
  return Math.max(reach, 1e-3) * pad;
}

/** Half turn so the portrait camera sees the front, not the back. */
function facePortrait(root) {
  const rq = root?.rotationQuaternion;
  if (!rq) return;
  if (typeof rq.set === 'function') rq.set(0, 1, 0, 0);
  else {
    rq.x = 0;
    rq.y = 1;
    rq.z = 0;
    rq.w = 0;
  }
}

function idleGroup(groups) {
  if (!groups?.length) return null;
  for (let i = 0; i < groups.length; i++) {
    if (/idle/i.test(groups[i]?.name || '')) return groups[i];
  }
  return null;
}

/** World AABB from each mesh's local box × world matrix. */
function hierarchyBounds(roots) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const stack = roots.slice();
  while (stack.length) {
    const node = stack.pop();
    const kids = node?.children;
    if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    if (node?.visible === false) continue;
    const b0 = node?.boundMin;
    const b1 = node?.boundMax;
    const m = node?.worldMatrix;
    if (!b0 || !b1 || !m || m.length < 16) continue;
    for (let xi = 0; xi < 2; xi++) {
      for (let yi = 0; yi < 2; yi++) {
        for (let zi = 0; zi < 2; zi++) {
          const x = xi ? b1[0] : b0[0];
          const y = yi ? b1[1] : b0[1];
          const z = zi ? b1[2] : b0[2];
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (wx < min[0]) min[0] = wx;
          if (wy < min[1]) min[1] = wy;
          if (wz < min[2]) min[2] = wz;
          if (wx > max[0]) max[0] = wx;
          if (wy > max[1]) max[1] = wy;
          if (wz > max[2]) max[2] = wz;
        }
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min, max };
}

function foregroundCount(shot, clearByte) {
  const d = shot.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    const dr = Math.abs(d[i] - clearByte);
    const dg = Math.abs(d[i + 1] - clearByte);
    const db = Math.abs(d[i + 2] - clearByte);
    if (dr + dg + db > 24) n++;
  }
  return n;
}

function matte(black, white) {
  const w = black.width;
  const h = black.height;
  if (white.width !== w || white.height !== h) {
    throw new Error(`sprite capture size ${w}x${h} vs ${white.width}x${white.height}`);
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const b = black.data;
  const s = white.data;
  for (let i = 0; i < out.length; i += 4) {
    const diff = (
      Math.abs(s[i] - b[i])
      + Math.abs(s[i + 1] - b[i + 1])
      + Math.abs(s[i + 2] - b[i + 2])
    ) / (3 * 255);
    let a = 1 - diff;
    if (a < 0.04) a = 0;
    else if (a > 0.98) a = 1;
    const inv = a > 0.001 ? 1 / a : 0;
    out[i] = Math.min(255, Math.round(b[i] * inv));
    out[i + 1] = Math.min(255, Math.round(b[i + 1] * inv));
    out[i + 2] = Math.min(255, Math.round(b[i + 2] * inv));
    out[i + 3] = Math.round(a * 255);
  }
  return { data: out, width: w, height: h };
}

function downsample(shot, dst) {
  const src = new OffscreenCanvas(shot.width, shot.height);
  src.getContext('2d').putImageData(new ImageData(shot.data, shot.width, shot.height), 0, 0);
  const out = new OffscreenCanvas(dst, dst);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, dst, dst);
  return ctx.getImageData(0, 0, dst, dst);
}

/** Push opaque neighbor colors into transparent texels so filtering stays clean. */
function bleedEdgeColors(img) {
  const w = img.width;
  const h = img.height;
  const d = img.data;
  const rgb = new Uint8Array(d.length);
  rgb.set(d);
  for (let pass = 0; pass < 8; pass++) {
    const src = new Uint8Array(rgb);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] > 2) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = (ny * w + nx) * 4;
            if (src[ni + 3] > 2) {
              r += src[ni];
              g += src[ni + 1];
              b += src[ni + 2];
              n++;
            }
          }
        }
        if (n > 0) {
          rgb[i] = r / n;
          rgb[i + 1] = g / n;
          rgb[i + 2] = b / n;
          rgb[i + 3] = 0;
        }
      }
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 2) {
      d[i] = rgb[i];
      d[i + 1] = rgb[i + 1];
      d[i + 2] = rgb[i + 2];
    }
  }
}

async function pngBytes(imageData) {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

/**
 * @param {(msg: string) => void} setStatus
 * @param {string[] | null} [onlyUrls] bake these roster URLs and merge them
 *   into the existing sprite index. Null bakes the full roster.
 * @returns {Promise<Record<string, string | ArrayBuffer>>}
 */
export async function bakeSprites(setStatus, onlyUrls = null) {
  const canvas = document.getElementById('spriteCanvas');
  if (!canvas) throw new Error('missing #spriteCanvas');
  canvas.width = RENDER;
  canvas.height = RENDER;
  canvas.style.width = `${RENDER}px`;
  canvas.style.height = `${RENDER}px`;

  const lite = await import('./.capture/liteCapture.js');
  // The PBR shader already encodes gamma. An sRGB target would encode
  // again and lift every color toward white.
  const engine = await lite.createEngine(canvas, {
    msaaSamples: 4,
    srgb: false,
    maxDevicePixelRatio: 1,
  });
  engine.maxDevicePixelRatio = 1;
  lite.resizeEngine(engine);

  const scene = lite.createSceneContext(engine);
  scene.clearColor = { r: 0, g: 0, b: 0, a: 1 };
  if (scene.imageProcessing) {
    scene.imageProcessing.toneMappingEnabled = false;
    scene.imageProcessing.exposure = 1.1;
    scene.imageProcessing.contrast = 1.3;
  }

  const camera = lite.createArcRotateCamera(-Math.PI * 0.75, Math.PI / 3, 40, { x: 0, y: 0, z: 0 });
  camera.nearPlane = 0.05;
  camera.farPlane = 400;
  scene.camera = camera;
  const ortho = lite.enableOrthographicCamera(camera, { halfHeight: 1 });

  // Fill stays low so the key light keeps the albedo instead of greying it.
  const hemi = lite.createHemisphericLight([0, 1, 0], 0.5);
  hemi.groundColor = [0.22, 0.2, 0.18];
  const dir = lite.createDirectionalLight(norm3(-0.5, -1.5, 0.8), 2);
  lite.addToScene(scene, hemi);
  lite.addToScene(scene, dir);
  lite.addToScene(scene, camera);
  await lite.registerScene(scene);
  await lite.startEngine(engine);

  /** @type {Record<string, string | ArrayBuffer>} */
  const files = {};
  /** @type {Record<string, string>} */
  const byUrl = {};
  const want = onlyUrls?.length ? new Set(onlyUrls) : null;

  async function shot(clearByte) {
    scene.clearColor = { r: clearByte, g: clearByte, b: clearByte, a: 1 };
    let last = null;
    for (let i = 0; i < 40; i++) {
      last = await lite.captureScreenshot(engine);
      if (foregroundCount(last, Math.round(clearByte * 255)) > 40) return last;
    }
    return last;
  }

  try {
    const entries = spriteBakeEntries().filter((entry) => !want || want.has(entry.url));
    if (want && entries.length !== want.size) {
      const have = new Set(entries.map((entry) => entry.url));
      const missing = [...want].filter((url) => !have.has(url));
      throw new Error(`sprite bake list missing ${missing.join(', ')}`);
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const stem = bakedMeshStem(entry.url);
      setStatus(`Sprite ${i + 1}/${entries.length}: ${stem}`);
      const container = await lite.loadGltf(engine, entry.url);
      const roots = container.entities ?? [];
      lite.addToScene(scene, container);
      scene.camera = camera;
      camera.alpha = entry.alpha;
      camera.beta = entry.beta;
      // Lite's glTF root mirrors X, so this camera sits behind the mesh.
      // A half turn brings the front around to the lit three-quarter view.
      for (const root of roots) facePortrait(root);
      for (const root of roots) {
        forEachMesh(root, (mesh) => {
          const mat = mesh.material;
          if (!mat) return;
          mat.backFaceCulling = false;
          mat.doubleSided = true;
          // Default metallic 1 with no environment reads as grey chalk.
          if ('metallicFactor' in mat) mat.metallicFactor = 0;
          if ('roughnessFactor' in mat) mat.roughnessFactor = 0.72;
        });
      }
      const posed = await poseSkinnedIdle(
        lite, engine, scene, roots, container.animationGroups, entry.url,
      );
      await lite.captureScreenshot(engine);

      const bounds = hierarchyBounds([...roots, ...posed]);
      if (!bounds) throw new Error(`no bounds for ${entry.url}`);
      const cx = (bounds.min[0] + bounds.max[0]) * 0.5;
      const cy = (bounds.min[1] + bounds.max[1]) * 0.5;
      const cz = (bounds.min[2] + bounds.max[2]) * 0.5;
      const extent = Math.max(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      );
      if (!(extent > 0)) throw new Error(`empty bounds for ${entry.url}`);
      for (const root of [...roots, ...posed]) {
        if (root.parent || !root.position) continue;
        root.position.x -= cx;
        root.position.y -= cy;
        root.position.z -= cz;
      }
      ortho.halfHeight = projectedHalf(camera, bounds.min, bounds.max, entry.zoom);

      const black = await shot(0);
      if (!black || foregroundCount(black, 0) <= 40) {
        throw new Error(`sprite render empty: ${entry.url}`);
      }
      scene.clearColor = { r: 1, g: 1, b: 1, a: 1 };
      await lite.captureScreenshot(engine);
      const white = await lite.captureScreenshot(engine);
      const matted = matte(black, white);
      const image = downsample(matted, CELL);
      bleedEdgeColors(image);
      files[`sprites/${stem}.png`] = await pngBytes(image);
      byUrl[entry.url] = `${stem}.png`;

      lite.removeFromScene(scene, container);
      if (scene.meshes?.length) {
        for (const mesh of scene.meshes.slice()) lite.removeFromScene(scene, mesh);
      }
    }
  } finally {
    lite.stopEngine(engine);
    lite.disposeEngine(engine);
  }

  let indexByUrl = byUrl;
  if (want) {
    try {
      const res = await fetch('/assets/baked/sprites/index.json');
      if (res.ok) {
        const existing = await res.json();
        indexByUrl = { ...(existing.byUrl ?? {}), ...byUrl };
      }
    } catch {
      // First bake: the new portraits are the whole index.
    }
  }
  files['sprites/index.json'] = JSON.stringify({ cellPx: CELL, byUrl: indexByUrl }, null, 2);
  return files;
}
