// CPU VAT sampling + carry-arm overlay onto idle/walk.
// Lite instance VAT plays one full-body clip. Blender carry is a 0-duration
// arm hold that keys the whole skeleton; Lite's tick is a no-op when
// duration is 0, and skin-space matrix stamps detach arms from a walking
// torso. Overlay replaces arm/shoulder *locals* then recomputes worlds.

export const CARRY_IDLE_CLIP = 'carry_idle';
export const CARRY_WALK_CLIP = 'carry_walk';
/** Offline VAT dumps without this were stamped in skin space (Frankenstein). */
export const CARRY_OVERLAY = 'local';

const DEFAULT_FRAME_RATE = 60;
const PATH_TRANSLATION = 0;
const PATH_ROTATION = 1;
const PATH_SCALE = 2;
const INTERP_STEP = 1;
const INTERP_CUBICSPLINE = 2;
const TRS_STRIDE = 12;
const T_OFF = 0;
const R_OFF = 3;
const S_OFF = 7;
const RH_TO_LH = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function isCarryOverlayBoneName(name) {
  const n = String(name || '');
  if (/armature/i.test(n)) return false;
  return /(^|[._:])(arm|shoulder|hand|clavicle|wrist|upperarm|forearm)([._:]|$)/i.test(n);
}

export function clipFrameCount(group) {
  const fps = group.frameRate || DEFAULT_FRAME_RATE;
  return Math.max(1, Math.round((group.duration || 0) * fps) + 1);
}

export function goToFrameCpu(group, frame) {
  const ctrl = group._ctrl;
  group.currentTime = frame / (group.frameRate || DEFAULT_FRAME_RATE);
  group.isPlaying = false;
  if (!ctrl) return;
  ctrl.time = group.currentTime;
  ctrl.playing = false;
  ctrl.speedRatio = group.speedRatio;
  ctrl.loop = group.loopAnimation;
  ctrl._setMask?.(group.mask ?? null);
  const clip = group._gltfMixer?.[0];
  if (clip && !(clip.duration > 0)) {
    evaluateClipPose(group, 0);
    group.currentTime = 0;
    return;
  }
  ctrl._tickCpu?.(0);
  group.currentTime = ctrl.time;
}

export function bindingOf(group, mesh) {
  const skeleton = mesh.skeleton;
  if (!skeleton) return null;
  const bindings = group._gltfMixer?.[2];
  return bindings?.find(
    (binding) => binding.runtimeSkeleton === skeleton || binding.boneTexture === skeleton.boneTexture,
  ) ?? null;
}

/**
 * Sample bake groups into a contiguous CPU VAT (same row layout as Lite).
 * @param {object[]} skinned
 * @param {object[]} bakeGroups
 * @param {(g: object) => void} [stopAnimation]
 */
export function sampleVatGroups(skinned, bakeGroups, stopAnimation) {
  let frameCount = 0;
  for (const group of bakeGroups) frameCount += clipFrameCount(group);
  frameCount = Math.max(1, frameCount);

  const clips = {};
  const prims = skinned.map((mesh) => {
    const boneCount = mesh.skeleton.boneCount;
    return {
      boneCount,
      frameCount,
      data: new Float32Array(frameCount * boneCount * 16),
    };
  });

  let row = 0;
  for (const group of bakeGroups) {
    const frames = clipFrameCount(group);
    const fps = group.frameRate || DEFAULT_FRAME_RATE;
    clips[group.name] = { fromRow: row, frameCount: frames, fps };
    for (let frame = 0; frame < frames; frame++) {
      goToFrameCpu(group, frame);
      for (let mi = 0; mi < skinned.length; mi++) {
        const binding = bindingOf(group, skinned[mi]);
        if (!binding) throw new Error(`VAT binding missing for prim ${mi} clip ${group.name}`);
        const fpf = prims[mi].boneCount * 16;
        prims[mi].data.set(binding.boneMatrices.subarray(0, fpf), row * fpf);
      }
      row++;
    }
    stopAnimation?.(group);
  }
  return { prims, clips, frameCount };
}

/** Node indices whose locals come from the carry clip. */
export function overlayNodeIndices(carryGroup) {
  const idx = new Set();
  for (const ta of carryGroup?.targetedAnimations ?? []) {
    if (ta.nodeIndex >= 0 && isCarryOverlayBoneName(ta.targetName)) idx.add(ta.nodeIndex);
  }
  return idx;
}

/**
 * Build carry_idle / carry_walk: locomotion worlds + carry arm locals.
 * @returns {{ idle: object | null, walk: object | null }}
 */
export function appendCarryLocomotion(prims, clips, skinned, idleGroup, walkGroup, carryGroup) {
  const overlay = overlayNodeIndices(carryGroup);
  if (!carryGroup || overlay.size === 0) {
    if (carryGroup) console.warn('[vat] carry overlay: no arm/shoulder targets on', carryGroup.name);
    return { idle: null, walk: null };
  }
  return {
    idle: idleGroup
      ? appendOverlayClip(prims, clips, skinned, idleGroup, carryGroup, overlay, CARRY_IDLE_CLIP)
      : null,
    walk: walkGroup
      ? appendOverlayClip(prims, clips, skinned, walkGroup, carryGroup, overlay, CARRY_WALK_CLIP)
      : null,
  };
}

function appendOverlayClip(prims, clips, skinned, baseGroup, carryGroup, overlay, outName) {
  const mixer = baseGroup._gltfMixer;
  const carryMixer = carryGroup._gltfMixer;
  if (!mixer || !carryMixer || !prims.length) return null;
  const nodes = mixer[1];
  const skeletons = mixer[2];
  const carryClip = carryMixer[0];
  const ctrl = baseGroup._ctrl;
  if (!nodes || !skeletons || !carryClip || !ctrl?._debugWorldMat) return null;

  const frames = clipFrameCount(baseGroup);
  const fps = baseGroup.frameRate || DEFAULT_FRAME_RATE;
  const fromRow = prims[0].frameCount;
  const overlayList = [...overlay].sort((a, b) => a - b);
  const topo = computeTopoOrder(nodes);
  const trs = new Float32Array(nodes.length * TRS_STRIDE);
  const worldMat = new Float32Array(nodes.length * 16);
  const localMat = new Float32Array(16);
  const tmp = new Float32Array(16);

  for (const prim of prims) {
    const fpf = prim.boneCount * 16;
    const next = new Float32Array((prim.frameCount + frames) * fpf);
    next.set(prim.data);
    prim.data = next;
    prim.frameCount += frames;
  }

  const carryFps = carryGroup.frameRate || DEFAULT_FRAME_RATE;
  const carryFrames = clipFrameCount(carryGroup);
  const carryDur = carryClip.duration || 0;

  for (let f = 0; f < frames; f++) {
    goToFrameCpu(baseGroup, f);
    worldMat.set(ctrl._debugWorldMat);
    fillRestTrs(nodes, trs);
    const carryT = carryDur > 0 ? (f % carryFrames) / carryFps : 0;
    applyChannels(carryClip, carryT, trs, overlay);
    recomputeOverlayWorlds(nodes, worldMat, trs, overlayList, topo, localMat);
    writeSkinRows(prims, skinned, baseGroup, worldMat, fromRow + f, tmp);
  }

  const clip = { fromRow, frameCount: frames, fps };
  clips[outName] = clip;
  return clip;
}

function evaluateClipPose(group, time) {
  const mixer = group._gltfMixer;
  if (!mixer) return;
  const clip = mixer[0];
  const nodes = mixer[1];
  const skeletons = mixer[2];
  if (!clip || !nodes || !skeletons) return;
  const trs = new Float32Array(nodes.length * TRS_STRIDE);
  const localMat = new Float32Array(nodes.length * 16);
  const worldMat = new Float32Array(nodes.length * 16);
  fillRestTrs(nodes, trs);
  applyChannels(clip, time, trs, null);
  composeWorlds(nodes, trs, localMat, worldMat, computeTopoOrder(nodes));
  const tmp = new Float32Array(16);
  writeSkeletonMats(skeletons, worldMat, tmp);
  if (group._ctrl?._debugWorldMat && group._ctrl._debugWorldMat.length === worldMat.length) {
    group._ctrl._debugWorldMat.set(worldMat);
  }
}

export function fillRestTrs(nodes, trs) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const off = i * TRS_STRIDE;
    trs[off + T_OFF] = n.tx;
    trs[off + T_OFF + 1] = n.ty;
    trs[off + T_OFF + 2] = n.tz;
    trs[off + R_OFF] = n.rx;
    trs[off + R_OFF + 1] = n.ry;
    trs[off + R_OFF + 2] = n.rz;
    trs[off + R_OFF + 3] = n.rw;
    trs[off + S_OFF] = n.sx;
    trs[off + S_OFF + 1] = n.sy;
    trs[off + S_OFF + 2] = n.sz;
  }
}

export function applyChannels(clip, t, trs, nodeFilter) {
  const channels = clip.channels;
  const samplers = clip.samplers;
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.nodeIdx < 0) continue;
    if (nodeFilter && !nodeFilter.has(ch.nodeIdx)) continue;
    const base = ch.nodeIdx * TRS_STRIDE;
    const sampler = samplers[ch.samplerIdx];
    if (ch.path === PATH_TRANSLATION) evaluateSampler(sampler, t, 3, false, trs, base + T_OFF);
    else if (ch.path === PATH_ROTATION) evaluateSampler(sampler, t, 4, true, trs, base + R_OFF);
    else if (ch.path === PATH_SCALE) evaluateSampler(sampler, t, 3, false, trs, base + S_OFF);
  }
}

export function evaluateSampler(sampler, t, stride, isQuat, dst, dstOffset) {
  const { input, output, interpolation } = sampler;
  const keyCount = input.length;
  if (keyCount === 0) return;
  if (keyCount === 1 || t <= input[0]) {
    const srcOff = interpolation === INTERP_CUBICSPLINE ? stride : 0;
    for (let c = 0; c < stride; c++) dst[dstOffset + c] = output[srcOff + c];
    return;
  }
  let lo = 0;
  let hi = input.length - 1;
  if (t >= input[hi]) lo = hi > 0 ? hi - 1 : 0;
  else {
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (input[mid] <= t) lo = mid;
      else hi = mid;
    }
  }
  const idx = lo;
  const t0 = input[idx];
  const t1 = input[idx + 1];
  if (interpolation === INTERP_STEP) {
    const srcOff = (t >= t1 ? idx + 1 : idx) * stride;
    for (let c = 0; c < stride; c++) dst[dstOffset + c] = output[srcOff + c];
    return;
  }
  const dt = t1 - t0;
  const f = t >= t1 ? 1 : dt > 0 ? (t - t0) / dt : 0;
  const s0 = idx * stride;
  const s1 = (idx + 1) * stride;
  if (isQuat) {
    quatSlerp(dst, dstOffset, output[s0], output[s0 + 1], output[s0 + 2], output[s0 + 3],
      output[s1], output[s1 + 1], output[s1 + 2], output[s1 + 3], f);
  } else {
    for (let c = 0; c < stride; c++) {
      dst[dstOffset + c] = output[s0 + c] + f * (output[s1 + c] - output[s0 + c]);
    }
  }
}

export function computeTopoOrder(nodes) {
  const n = nodes.length;
  const order = new Int32Array(n);
  const visited = new Uint8Array(n);
  let cursor = 0;
  const visit = (idx) => {
    if (visited[idx]) return;
    visited[idx] = 1;
    const p = nodes[idx].parentIdx;
    if (p >= 0) visit(p);
    order[cursor++] = idx;
  };
  for (let i = 0; i < n; i++) visit(i);
  return order;
}

export function recomputeOverlayWorlds(nodes, worldMat, trs, overlayList, topo, localMat) {
  const overlay = overlayList instanceof Set ? overlayList : new Set(overlayList);
  for (let i = 0; i < topo.length; i++) {
    const idx = topo[i];
    if (!overlay.has(idx)) continue;
    const off = idx * TRS_STRIDE;
    mat4ComposeInto(
      localMat, 0,
      trs[off + T_OFF], trs[off + T_OFF + 1], trs[off + T_OFF + 2],
      trs[off + R_OFF], trs[off + R_OFF + 1], trs[off + R_OFF + 2], trs[off + R_OFF + 3],
      trs[off + S_OFF], trs[off + S_OFF + 1], trs[off + S_OFF + 2],
    );
    const parentIdx = nodes[idx].parentIdx;
    if (parentIdx >= 0) {
      mat4MultiplyInto(worldMat, idx * 16, worldMat, parentIdx * 16, localMat, 0);
    } else {
      mat4MultiplyInto(worldMat, idx * 16, RH_TO_LH, 0, localMat, 0);
    }
  }
}

function composeWorlds(nodes, trs, localMat, worldMat, topo) {
  for (let i = 0; i < topo.length; i++) {
    const nodeIdx = topo[i];
    const node = nodes[nodeIdx];
    const off = nodeIdx * TRS_STRIDE;
    if (node._matrix) {
      localMat.set(node._matrix, nodeIdx * 16);
    } else {
      mat4ComposeInto(
        localMat, nodeIdx * 16,
        trs[off + T_OFF], trs[off + T_OFF + 1], trs[off + T_OFF + 2],
        trs[off + R_OFF], trs[off + R_OFF + 1], trs[off + R_OFF + 2], trs[off + R_OFF + 3],
        trs[off + S_OFF], trs[off + S_OFF + 1], trs[off + S_OFF + 2],
      );
    }
    const parentIdx = node.parentIdx;
    if (parentIdx >= 0) {
      mat4MultiplyInto(worldMat, nodeIdx * 16, worldMat, parentIdx * 16, localMat, nodeIdx * 16);
    } else {
      mat4MultiplyInto(worldMat, nodeIdx * 16, RH_TO_LH, 0, localMat, nodeIdx * 16);
    }
  }
}

function writeSkinRows(prims, skinned, group, worldMat, row, tmp) {
  for (let mi = 0; mi < skinned.length; mi++) {
    const skel = bindingOf(group, skinned[mi]);
    if (!skel) continue;
    const fpf = prims[mi].boneCount * 16;
    writeOneSkin(skel, worldMat, prims[mi].data, row * fpf, tmp);
  }
}

function writeSkeletonMats(skeletons, worldMat, tmp) {
  for (let si = 0; si < skeletons.length; si++) {
    const skel = skeletons[si];
    writeOneSkin(skel, worldMat, skel.boneMatrices, 0, tmp);
  }
}

function writeOneSkin(skel, worldMat, dst, dstOff, tmp) {
  for (let bi = 0; bi < skel.boneCount; bi++) {
    const jointIdx = skel.jointNodes[bi];
    mat4MultiplyInto(tmp, 0, skel.invMeshWorld, 0, worldMat, jointIdx * 16);
    mat4MultiplyInto(dst, dstOff + bi * 16, tmp, 0, skel.inverseBindMatrices, bi * 16);
  }
}

function quatSlerp(out, o, ax, ay, az, aw, bx, by, bz, bw, t) {
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    out[o] = ax + t * (bx - ax);
    out[o + 1] = ay + t * (by - ay);
    out[o + 2] = az + t * (bz - az);
    out[o + 3] = aw + t * (bw - aw);
    const len = Math.hypot(out[o], out[o + 1], out[o + 2], out[o + 3]) || 1;
    out[o] /= len; out[o + 1] /= len; out[o + 2] /= len; out[o + 3] /= len;
    return;
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  out[o] = wa * ax + wb * bx;
  out[o + 1] = wa * ay + wb * by;
  out[o + 2] = wa * az + wb * bz;
  out[o + 3] = wa * aw + wb * bw;
}

function mat4ComposeInto(dst, off, tx, ty, tz, qx, qy, qz, qw, sx, sy, sz) {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  dst[off] = (1 - 2 * (yy + zz)) * sx;
  dst[off + 1] = 2 * (xy + wz) * sx;
  dst[off + 2] = 2 * (xz - wy) * sx;
  dst[off + 3] = 0;
  dst[off + 4] = 2 * (xy - wz) * sy;
  dst[off + 5] = (1 - 2 * (xx + zz)) * sy;
  dst[off + 6] = 2 * (yz + wx) * sy;
  dst[off + 7] = 0;
  dst[off + 8] = 2 * (xz + wy) * sz;
  dst[off + 9] = 2 * (yz - wx) * sz;
  dst[off + 10] = (1 - 2 * (xx + yy)) * sz;
  dst[off + 11] = 0;
  dst[off + 12] = tx;
  dst[off + 13] = ty;
  dst[off + 14] = tz;
  dst[off + 15] = 1;
}

/** Invert a column-major mat4. Returns false when the matrix is singular. */
export function mat4InvertTo(dst, d, src, s = 0) {
  const a00 = src[s], a01 = src[s + 1], a02 = src[s + 2], a03 = src[s + 3];
  const a10 = src[s + 4], a11 = src[s + 5], a12 = src[s + 6], a13 = src[s + 7];
  const a20 = src[s + 8], a21 = src[s + 9], a22 = src[s + 10], a23 = src[s + 11];
  const a30 = src[s + 12], a31 = src[s + 13], a32 = src[s + 14], a33 = src[s + 15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-10) return false;
  det = 1 / det;
  dst[d] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  dst[d + 1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  dst[d + 2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  dst[d + 3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  dst[d + 4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  dst[d + 5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  dst[d + 6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  dst[d + 7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  dst[d + 8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  dst[d + 9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  dst[d + 10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  dst[d + 11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  dst[d + 12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  dst[d + 13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  dst[d + 14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  dst[d + 15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/**
 * Matrix that takes a bone-parented prop's local vertices into the skinned
 * mesh's space, weighted entirely to `inverseBind` at `bindOffset`.
 * @returns {Float32Array | null}
 */
export function rigidPropMeshMatrix(inverseBind, bindOffset, boneWorld, propWorld) {
  const invBone = new Float32Array(16);
  const invIbm = new Float32Array(16);
  if (!mat4InvertTo(invBone, 0, boneWorld, 0)) return null;
  if (!mat4InvertTo(invIbm, 0, inverseBind, bindOffset)) return null;
  const local = new Float32Array(16);
  const into = new Float32Array(16);
  mat4MultiplyInto(local, 0, invBone, 0, propWorld, 0);
  mat4MultiplyInto(into, 0, invIbm, 0, local, 0);
  return into;
}

function accumulateSkin(boneMatrices, joints, weights, x, y, z, v, acc, normals) {
  if (!joints || !weights) return;
  const base = v * 4;
  for (let k = 0; k < 4; k++) {
    const w = weights[base + k];
    if (!(w > 0)) continue;
    const m = (joints[base + k] | 0) * 16;
    if (m < 0 || m + 15 >= boneMatrices.length) continue;
    if (normals) {
      acc[0] += w * (boneMatrices[m] * x + boneMatrices[m + 4] * y + boneMatrices[m + 8] * z);
      acc[1] += w * (boneMatrices[m + 1] * x + boneMatrices[m + 5] * y + boneMatrices[m + 9] * z);
      acc[2] += w * (boneMatrices[m + 2] * x + boneMatrices[m + 6] * y + boneMatrices[m + 10] * z);
    } else {
      acc[0] += w * (boneMatrices[m] * x + boneMatrices[m + 4] * y + boneMatrices[m + 8] * z + boneMatrices[m + 12]);
      acc[1] += w * (boneMatrices[m + 1] * x + boneMatrices[m + 5] * y + boneMatrices[m + 9] * z + boneMatrices[m + 13]);
      acc[2] += w * (boneMatrices[m + 2] * x + boneMatrices[m + 6] * y + boneMatrices[m + 10] * z + boneMatrices[m + 14]);
    }
    acc[3] += w;
  }
}

/**
 * One skinning pass. `dst` is mesh-local: bone matrices already include inverse bind.
 * Missing weights copy the bind vertex through.
 */
export function skinPositions(boneMatrices, joints, weights, src, dst = new Float32Array(src.length), joints1 = null, weights1 = null) {
  const acc = [0, 0, 0, 0];
  const vertCount = src.length / 3;
  for (let v = 0; v < vertCount; v++) {
    const x = src[v * 3];
    const y = src[v * 3 + 1];
    const z = src[v * 3 + 2];
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    accumulateSkin(boneMatrices, joints, weights, x, y, z, v, acc, false);
    accumulateSkin(boneMatrices, joints1, weights1, x, y, z, v, acc, false);
    const o = v * 3;
    if (!(acc[3] > 0)) {
      dst[o] = x;
      dst[o + 1] = y;
      dst[o + 2] = z;
    } else {
      dst[o] = acc[0];
      dst[o + 1] = acc[1];
      dst[o + 2] = acc[2];
    }
  }
  return dst;
}

/** Weighted upper 3×3 of the skin matrices, then renormalize. */
export function skinNormals(boneMatrices, joints, weights, src, dst = new Float32Array(src.length), joints1 = null, weights1 = null) {
  const acc = [0, 0, 0, 0];
  const vertCount = src.length / 3;
  for (let v = 0; v < vertCount; v++) {
    const x = src[v * 3];
    const y = src[v * 3 + 1];
    const z = src[v * 3 + 2];
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    accumulateSkin(boneMatrices, joints, weights, x, y, z, v, acc, true);
    accumulateSkin(boneMatrices, joints1, weights1, x, y, z, v, acc, true);
    const o = v * 3;
    const len = Math.hypot(acc[0], acc[1], acc[2]);
    if (!(acc[3] > 0) || !(len > 0)) {
      dst[o] = x;
      dst[o + 1] = y;
      dst[o + 2] = z;
    } else {
      dst[o] = acc[0] / len;
      dst[o + 1] = acc[1] / len;
      dst[o + 2] = acc[2] / len;
    }
  }
  return dst;
}

export function transformPointsByMat4(m, src, dst = new Float32Array(src.length)) {
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    dst[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    dst[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    dst[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return dst;
}

/** Inverse-transpose of the mat4's upper 3×3, column-major 3×3, or null. */
function mat3InvTranspose(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  // inverse, then transpose → columns of the inverse become rows, stored column-major
  // inv row0 = (A, -(b*i-c*h), (b*f-c*e)) * inv
  const i00 = A * inv;
  const i01 = (c * h - b * i) * inv;
  const i02 = (b * f - c * e) * inv;
  const i10 = B * inv;
  const i11 = (a * i - c * g) * inv;
  const i12 = (c * d - a * f) * inv;
  const i20 = C * inv;
  const i21 = (b * g - a * h) * inv;
  const i22 = (a * e - b * d) * inv;
  return new Float32Array([
    i00, i10, i20,
    i01, i11, i21,
    i02, i12, i22,
  ]);
}

export function transformNormalsByMat4(m, src, dst = new Float32Array(src.length)) {
  const n = mat3InvTranspose(m);
  if (!n) return null;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    const nx = n[0] * x + n[3] * y + n[6] * z;
    const ny = n[1] * x + n[4] * y + n[7] * z;
    const nz = n[2] * x + n[5] * y + n[8] * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    dst[i] = nx / len;
    dst[i + 1] = ny / len;
    dst[i + 2] = nz / len;
  }
  return dst;
}

function mat4MultiplyInto(dst, d, a, i, b, j) {
  const a0 = a[i], a1 = a[i + 1], a2 = a[i + 2], a3 = a[i + 3];
  const a4 = a[i + 4], a5 = a[i + 5], a6 = a[i + 6], a7 = a[i + 7];
  const a8 = a[i + 8], a9 = a[i + 9], a10 = a[i + 10], a11 = a[i + 11];
  const a12 = a[i + 12], a13 = a[i + 13], a14 = a[i + 14], a15 = a[i + 15];
  let b0 = b[j], b1 = b[j + 1], b2 = b[j + 2], b3 = b[j + 3];
  dst[d] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
  dst[d + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
  dst[d + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
  dst[d + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  b0 = b[j + 4]; b1 = b[j + 5]; b2 = b[j + 6]; b3 = b[j + 7];
  dst[d + 4] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
  dst[d + 5] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
  dst[d + 6] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
  dst[d + 7] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  b0 = b[j + 8]; b1 = b[j + 9]; b2 = b[j + 10]; b3 = b[j + 11];
  dst[d + 8] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
  dst[d + 9] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
  dst[d + 10] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
  dst[d + 11] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  b0 = b[j + 12]; b1 = b[j + 13]; b2 = b[j + 14]; b3 = b[j + 15];
  dst[d + 12] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
  dst[d + 13] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
  dst[d + 14] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
  dst[d + 15] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
}
