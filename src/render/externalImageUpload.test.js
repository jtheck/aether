import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  downsampleStored,
  externalImageExtent,
  externalImageWritePlan,
  installExternalImageUploadFallback,
} from './externalImageUpload.js';

function queueProto(copy) {
  return { copyExternalImageToTexture: copy };
}

describe('externalImageExtent', () => {
  it('reads a dict or a sequence', () => {
    assert.deepEqual(externalImageExtent({ width: 4, height: 2 }), { width: 4, height: 2 });
    assert.deepEqual(externalImageExtent([8, 3]), { width: 8, height: 3 });
    assert.equal(externalImageExtent({ width: 0, height: 4 }), null);
    assert.equal(externalImageExtent(null), null);
  });
});

describe('externalImageWritePlan', () => {
  it('writes straight rgba at the copy size', () => {
    const texture = {};
    const pixels = new Uint8ClampedArray([10, 20, 30, 255, 1, 2, 3, 128]);
    const plan = externalImageWritePlan(pixels, { texture }, { width: 2, height: 1 });
    assert.equal(plan.destination.texture, texture);
    assert.equal(plan.dataLayout.bytesPerRow, 256);
    assert.equal(plan.dataLayout.rowsPerImage, 1);
    assert.deepEqual(Array.from(plan.data.subarray(0, 8)), [10, 20, 30, 255, 1, 2, 3, 128]);
    assert.equal(plan.data.byteLength, 256);
    assert.deepEqual(plan.size, { width: 2, height: 1, depthOrArrayLayers: 1 });
  });

  it('premultiplies when the destination asks for it', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 128, 10, 20, 30, 0]);
    const plan = externalImageWritePlan(pixels, { texture: {}, premultipliedAlpha: true }, [2, 1]);
    assert.deepEqual(Array.from(plan.data.subarray(0, 8)), [128, 0, 0, 128, 0, 0, 0, 0]);
    assert.deepEqual(Array.from(pixels), [255, 0, 0, 128, 10, 20, 30, 0]);
  });

  it('flips rows top to bottom', () => {
    const pixels = new Uint8ClampedArray([
      1, 0, 0, 255, 2, 0, 0, 255,
      3, 0, 0, 255, 4, 0, 0, 255,
    ]);
    const plan = externalImageWritePlan(pixels, { texture: {} }, [2, 2], true);
    assert.equal(plan.dataLayout.bytesPerRow, 256);
    assert.deepEqual(Array.from(plan.data.subarray(0, 8)), [3, 0, 0, 255, 4, 0, 0, 255]);
    assert.deepEqual(Array.from(plan.data.subarray(256, 264)), [1, 0, 0, 255, 2, 0, 0, 255]);
  });

  it('keeps mip and origin', () => {
    const origin = { x: 4, y: 8, z: 0 };
    const plan = externalImageWritePlan(
      new Uint8ClampedArray(4),
      { texture: {}, mipLevel: 2, origin },
      [1, 1],
    );
    assert.equal(plan.destination.mipLevel, 2);
    assert.equal(plan.destination.origin, origin);
  });

  it('refuses a short buffer', () => {
    assert.equal(externalImageWritePlan(new Uint8ClampedArray(4), { texture: {} }, [2, 2]), null);
  });
});

describe('downsampleStored', () => {
  it('averages srgb texels in linear light', () => {
    const src = new Uint8Array([
      0, 0, 0, 255, 255, 0, 0, 255,
      0, 0, 0, 255, 255, 0, 0, 255,
    ]);
    const mip = downsampleStored(src, 2, 2, true);
    assert.equal(mip.width, 1);
    assert.equal(mip.height, 1);
    assert.equal(mip.data[3], 255);
    assert.equal(mip.data[1], 0);
    assert.ok(mip.data[0] > 170 && mip.data[0] < 200);
  });

  it('box-filters a non-square unorm image', () => {
    const src = new Uint8Array([
      0, 0, 0, 0, 100, 0, 0, 200,
    ]);
    const mip = downsampleStored(src, 2, 1, false);
    assert.deepEqual(mip, {
      data: Uint8Array.of(50, 0, 0, 100),
      width: 1,
      height: 1,
    });
  });
});

describe('installExternalImageUploadFallback', () => {
  it('uploads on the CPU when the external copy cannot import the image', () => {
    let copies = 0;
    const proto = queueProto(() => {
      copies += 1;
      throw IMPORT_FAILED;
    });
    const pixels = new Uint8ClampedArray([9, 8, 7, 6, 1, 2, 3, 4]);
    const warnings = [];
    assert.equal(installExternalImageUploadFallback(proto, {
      readPixels: () => pixels,
      warn: (err) => warnings.push(err),
    }), true);
    assert.equal(installExternalImageUploadFallback(proto), false);
    const writes = [];
    const queue = Object.create(proto);
    queue.writeTexture = (...args) => writes.push(args);
    const texture = {};
    queue.copyExternalImageToTexture(
      { source: {}, flipY: true },
      { texture },
      [1, 2],
    );
    assert.equal(copies, 0);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].texture, texture);
    assert.equal(writes[0][2].bytesPerRow, 256);
    assert.equal(writes[0][2].rowsPerImage, 2);
    assert.deepEqual(Array.from(writes[0][1].subarray(0, 4)), [1, 2, 3, 4]);
    assert.deepEqual(Array.from(writes[0][1].subarray(256, 260)), [9, 8, 7, 6]);
    assert.equal(warnings.length, 1);
  });

  it('never calls the native copy', () => {
    let copies = 0;
    const proto = queueProto(() => {
      copies += 1;
    });
    installExternalImageUploadFallback(proto, {
      readPixels: () => new Uint8ClampedArray(4),
      warn: () => {},
    });
    const queue = Object.create(proto);
    const writes = [];
    queue.writeTexture = (...args) => writes.push(args);
    queue.copyExternalImageToTexture({ source: {} }, { texture: {} }, { width: 1, height: 1 });
    assert.equal(copies, 0);
    assert.equal(writes.length, 1);
  });

  it('throws when the image cannot be read', () => {
    const proto = queueProto(() => {
      throw new Error('native should not run');
    });
    installExternalImageUploadFallback(proto, {
      readPixels: () => null,
      warn: () => {
        throw new Error('should not warn');
      },
    });
    const queue = Object.create(proto);
    queue.writeTexture = () => {
      throw new Error('should not write');
    };
    assert.throws(
      () => queue.copyExternalImageToTexture({ source: {} }, { texture: {} }, [1, 1]),
      /external image/,
    );
  });
});
