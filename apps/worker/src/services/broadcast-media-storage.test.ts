import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeBroadcastMedia } from './broadcast-media-storage.js';

// Workers の FixedLengthStream の代わり。書いた合計が申告と違えば流れを壊す。
class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  readonly expectedLength: number;
  constructor(expectedLength: number) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > expectedLength) throw new Error('FixedLengthStream: too long');
        controller.enqueue(chunk);
      },
      flush() {
        if (seen !== expectedLength) throw new Error('FixedLengthStream: too short');
      },
    });
    this.expectedLength = expectedLength;
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

/** 本物の R2 と同じく、長さの分からない流れ（tee の枝など）は受け付けない入れ物。 */
function strictBucket() {
  const put = vi.fn(async (_key: string, body: ReadableStream) => {
    if (!(body instanceof ReadableStream) || !(fixedReadables.has(body))) {
      throw new TypeError('Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)');
    }
    const reader = body.getReader();
    let total = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; total += r.value.byteLength; }
    return { size: total };
  });
  return { put } as unknown as R2Bucket & { put: typeof put };
}

/** 流れを最後まで読み切るだけの入れ物（長さの有無は問わない）。大きさの偽りの判定が保存側に要ることを確かめる。 */
function lenientBucket() {
  const put = vi.fn(async (_key: string, body: ReadableStream) => {
    const reader = body.getReader();
    for (;;) { const r = await reader.read(); if (r.done) break; }
    return {};
  });
  return { put } as unknown as R2Bucket;
}

const fixedReadables = new WeakSet<ReadableStream>();
class TrackedFixedLengthStream extends TestFixedLengthStream {
  constructor(n: number) { super(n); fixedReadables.add(this.readable); }
}

describe('配信素材の保存（R2）', () => {
  beforeEach(() => { vi.stubGlobal('FixedLengthStream', TrackedFixedLengthStream); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('受け口で tee() した長さの無い枝でも、申告の大きさを付けて保存できる', async () => {
    const bytes = new Uint8Array(32).fill(7);
    const [, branch] = streamOf(bytes).tee();
    const bucket = strictBucket();
    const stored = await storeBroadcastMedia({
      bucket, body: branch, contentLength: 32, mimeType: 'video/mp4', publicBaseUrl: 'https://w.example',
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(stored.key).toMatch(/^broadcast-media\/.+\.mp4$/);
    expect(stored.size).toBe(32);
  });

  it('申告より中身が大きい（大きさの偽り）なら保存は失敗する', async () => {
    const [, branch] = streamOf(new Uint8Array(64)).tee();
    await expect(storeBroadcastMedia({
      bucket: lenientBucket(), body: branch, contentLength: 32, mimeType: 'image/png', publicBaseUrl: 'https://w.example',
    })).rejects.toThrow();
  });

  it('途中で切れて申告より短いなら保存は失敗する', async () => {
    const [, branch] = streamOf(new Uint8Array(10)).tee();
    await expect(storeBroadcastMedia({
      bucket: lenientBucket(), body: branch, contentLength: 32, mimeType: 'image/jpeg', publicBaseUrl: 'https://w.example',
    })).rejects.toThrow();
  });
});
