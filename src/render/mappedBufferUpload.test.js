import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installMappedBufferUploadFallback } from './mappedBufferUpload.js';

const TOO_LARGE = new RangeError(
  "Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size (88596) is too large for the implementation when mappedAtCreation==true",
);
const COPY_DST = 0x8;
const VERTEX = 0x20;

function harness(rejectMapped) {
  const bufferProto = {
    getMappedRange() {
      throw new Error('native map');
    },
    unmap() {
      throw new Error('native unmap');
    },
  };
  const calls = [];
  const deviceProto = {
    createBuffer(desc) {
      calls.push({ ...desc });
      if (desc.mappedAtCreation && rejectMapped(desc)) throw TOO_LARGE;
      return Object.assign(Object.create(bufferProto), {
        size: desc.size,
        usage: desc.usage,
        mappedAtCreation: !!desc.mappedAtCreation,
      });
    },
  };
  const device = Object.create(deviceProto);
  const writes = [];
  device.queue = { writeBuffer: (...args) => writes.push(args) };
  const installed = installMappedBufferUploadFallback(deviceProto, bufferProto, { warn: () => {} });
  return { device, writes, calls, installed };
}

describe('installMappedBufferUploadFallback', () => {
  it('uploads a rejected mapped buffer through writeBuffer', () => {
    const { device, writes, calls, installed } = harness(() => true);
    assert.equal(installed, true);
    assert.equal(installMappedBufferUploadFallback(
      Object.getPrototypeOf(device),
      Object.getPrototypeOf(device.createBuffer({ size: 4, usage: VERTEX })),
    ), false);

    const buffer = device.createBuffer({
      label: 'positions',
      size: 88596,
      usage: VERTEX,
      mappedAtCreation: true,
    });
    assert.equal(buffer.mappedAtCreation, false);
    assert.equal(buffer.usage & COPY_DST, COPY_DST);
    assert.equal(buffer.usage & VERTEX, VERTEX);
    assert.equal(calls.at(-1).label, 'positions');

    const bytes = new Uint8Array(buffer.getMappedRange());
    bytes[0] = 7;
    bytes[4] = 9;
    buffer.unmap();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], buffer);
    assert.equal(writes[0][1], 0);
    assert.equal(writes[0][2][0], 7);
    assert.equal(writes[0][2][4], 9);
    assert.equal(writes[0][2].byteLength, 88596);
  });

  it('does not map at creation even when the native map would succeed', () => {
    const { device, writes, calls } = harness(() => false);
    const buffer = device.createBuffer({ size: 16, usage: VERTEX, mappedAtCreation: true });
    assert.equal(calls[0].mappedAtCreation, false);
    assert.equal(buffer.mappedAtCreation, false);
    new Uint8Array(buffer.getMappedRange())[0] = 3;
    buffer.unmap();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][2][0], 3);
  });

  it('does not upload when the caller unmaps without writing', () => {
    const { device, writes } = harness(() => true);
    const buffer = device.createBuffer({ size: 64, usage: VERTEX, mappedAtCreation: true });
    buffer.unmap();
    assert.equal(writes.length, 0);
  });

  it('still uses native unmap for buffers that were not mapped at creation', () => {
    const { device } = harness(() => true);
    const buffer = device.createBuffer({ size: 16, usage: VERTEX | COPY_DST });
    assert.throws(() => buffer.unmap(), /native unmap/);
  });

  it('falls back when the mapped create throws an unrecognized error', () => {
    const bufferProto = {
      getMappedRange() {
        throw new Error('native map');
      },
      unmap() {},
    };
    const deviceProto = {
      createBuffer(desc) {
        if (desc.mappedAtCreation) {
          const err = new Error('createBuffer failed');
          err.name = 'OperationError';
          throw err;
        }
        return Object.assign(Object.create(bufferProto), {
          size: desc.size,
          usage: desc.usage,
          mappedAtCreation: false,
        });
      },
    };
    const device = Object.create(deviceProto);
    const writes = [];
    device.queue = { writeBuffer: (...args) => writes.push(args) };
    installMappedBufferUploadFallback(deviceProto, bufferProto, { warn: () => {} });
    const buffer = device.createBuffer({ size: 88596, usage: VERTEX, mappedAtCreation: true });
    assert.equal(buffer.mappedAtCreation, false);
    assert.equal(buffer.usage & COPY_DST, COPY_DST);
    new Uint8Array(buffer.getMappedRange())[0] = 4;
    buffer.unmap();
    assert.equal(writes[0][2][0], 4);
  });

  it('rethrows when the unmapped create fails too', () => {
    const bufferProto = {
      getMappedRange() {},
      unmap() {},
    };
    const deviceProto = {
      createBuffer() {
        throw new Error('out of memory');
      },
    };
    installMappedBufferUploadFallback(deviceProto, bufferProto, { warn: () => {} });
    const device = Object.create(deviceProto);
    assert.throws(
      () => device.createBuffer({ size: 4, usage: VERTEX, mappedAtCreation: true }),
      /out of memory/,
    );
  });
});
