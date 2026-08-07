// Minimal GLB material + embedded-image extract for offline bake.

/**
 * @param {ArrayBuffer} buffer
 */
export function extractGlbMaterials(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  let offset = 12;
  /** @type {object | null} */
  let json = null;
  /** @type {Uint8Array | null} */
  let bin = null;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkData = new Uint8Array(buffer, offset + 8, chunkLen);
    offset += 8 + chunkLen;
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunkData));
    } else if (chunkType === 0x004e4942) {
      bin = chunkData;
    }
  }
  if (!json) throw new Error('GLB missing JSON chunk');

  const images = (json.images ?? []).map((img, idx) => {
    if (img.uri && typeof img.uri === 'string' && img.uri.startsWith('data:')) {
      const comma = img.uri.indexOf(',');
      const meta = img.uri.slice(5, comma);
      const b64 = img.uri.slice(comma + 1);
      const mimeType = meta.split(';')[0] || 'image/png';
      if (!meta.includes(';base64')) throw new Error(`unsupported data uri image ${idx}`);
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return { mimeType, bytes };
    }
    if (img.bufferView == null) {
      return { mimeType: img.mimeType || 'image/png', bytes: new Uint8Array(0) };
    }
    const bv = json.bufferViews[img.bufferView];
    if (!bv || !bin) throw new Error(`image ${idx} missing bufferView data`);
    const start = (bv.byteOffset ?? 0);
    const bytes = bin.subarray(start, start + bv.byteLength);
    return { mimeType: img.mimeType || 'image/png', bytes: bytes.slice() };
  });

  const texImage = (texInfo) => {
    if (texInfo?.index == null) return null;
    const tex = json.textures?.[texInfo.index];
    if (!tex || tex.source == null) return null;
    return tex.source | 0;
  };

  const materials = (json.materials ?? []).map((mat) => {
    const pbr = mat.pbrMetallicRoughness ?? {};
    return {
      name: mat.name || '',
      baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1,
      roughnessFactor: pbr.roughnessFactor ?? 1,
      emissiveFactor: mat.emissiveFactor ?? [0, 0, 0],
      doubleSided: !!mat.doubleSided,
      alphaMode: mat.alphaMode ?? 'OPAQUE',
      alphaCutoff: mat.alphaCutoff ?? 0.5,
      baseColorImage: texImage(pbr.baseColorTexture),
      normalImage: texImage(mat.normalTexture),
      ormImage: texImage(pbr.metallicRoughnessTexture),
      emissiveImage: texImage(mat.emissiveTexture),
    };
  });

  return { materials, images };
}
