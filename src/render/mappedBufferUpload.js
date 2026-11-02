// Linux Vulkan rejects GPUBuffer creation with mappedAtCreation (a mesh buffer
// of 88596 bytes did) and that failure can drop the device. Lite maps, writes,
// and unmaps immediately. Never map at creation: create the buffer unmapped
// and flush the bytes with writeBuffer from unmap.

const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x8;
const patchedDevices = new WeakSet();
const patchedBuffers = new WeakSet();
const pending = new WeakMap();

/**
 * @param {object} [deviceProto]
 * @param {object} [bufferProto]
 * @param {{ warn?: (err: unknown) => void }} [options]
 * @returns {boolean}
 */
export function installMappedBufferUploadFallback(
  deviceProto = globalThis.GPUDevice?.prototype,
  bufferProto = globalThis.GPUBuffer?.prototype,
  options = {},
) {
  if (!deviceProto || typeof deviceProto.createBuffer !== 'function') return false;
  if (!bufferProto || typeof bufferProto.getMappedRange !== 'function' || typeof bufferProto.unmap !== 'function') {
    return false;
  }
  if (patchedDevices.has(deviceProto)) return false;
  const warn = options.warn;
  const origCreate = deviceProto.createBuffer;
  const origGetMappedRange = bufferProto.getMappedRange;
  const origUnmap = bufferProto.unmap;

  if (!patchedBuffers.has(bufferProto)) {
    bufferProto.getMappedRange = function getMappedRange(offset = 0, size) {
      const rec = pending.get(this);
      if (!rec) return origGetMappedRange.call(this, offset, size);
      const start = offset | 0;
      const byteLength = size == null ? this.size - start : size | 0;
      const ab = new ArrayBuffer(byteLength);
      rec.range = { offset: start, ab };
      return ab;
    };
    bufferProto.unmap = function unmap() {
      const rec = pending.get(this);
      if (!rec) return origUnmap.call(this);
      const range = rec.range;
      pending.delete(this);
      if (!range) return;
      const offset = range.offset;
      const bytes = new Uint8Array(range.ab);
      if ((offset % 4) === 0 && (bytes.byteLength % 4) === 0) {
        rec.device.queue.writeBuffer(this, offset, bytes);
        return;
      }
      const alignedOffset = offset & ~3;
      const alignedEnd = (offset + bytes.byteLength + 3) & ~3;
      const padded = new Uint8Array(alignedEnd - alignedOffset);
      padded.set(bytes, offset - alignedOffset);
      rec.device.queue.writeBuffer(this, alignedOffset, padded);
    };
    patchedBuffers.add(bufferProto);
  }

  deviceProto.createBuffer = function createBuffer(desc) {
    if (!desc?.mappedAtCreation) return origCreate.call(this, desc);
    const buffer = origCreate.call(this, {
      label: desc.label,
      size: desc.size,
      usage: (desc.usage | 0) | COPY_DST,
      mappedAtCreation: false,
    });
    pending.set(buffer, { device: this, range: null });
    warn?.();
    return buffer;
  };
  patchedDevices.add(deviceProto);
  return true;
}

installMappedBufferUploadFallback();
