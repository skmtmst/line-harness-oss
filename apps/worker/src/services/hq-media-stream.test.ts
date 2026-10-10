import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyHqMediaStream, hashHqMedia, HQ_MEDIA_MAX_BYTES } from './hq-media-stream.js';
import { installHqStreamPrimitives } from '../test-utils/hq-media-stream.js';
let restore: () => void;
beforeEach(() => { restore = installHqStreamPrimitives(); }); afterEach(() => restore());
function fixture(actual: number, declared = actual) {
  const chunk = new Uint8Array(64 * 1024).fill(17), hash = createHash('sha256');
  for (let remaining = actual; remaining > 0; remaining -= chunk.length) hash.update(chunk.subarray(0, Math.min(remaining, chunk.length)));
  const contentHash = hash.digest('hex');
  let written = 0;
  const bucket = { get: vi.fn(async (_key: string, opts: any) => opts.onlyIf.etagMatches !== 'v1' ? null : ({size:declared,body:new ReadableStream<Uint8Array>({pull(c) {
    const sent = (this as any).sent ?? 0;
    if (sent === actual) { c.close(); return; }
    const data = chunk.subarray(0, Math.min(actual - sent, chunk.length)); (this as any).sent = sent + data.length; c.enqueue(data);
  }})})), put: vi.fn(async (_key: string, body: ReadableStream<Uint8Array>) => {
    await body.pipeTo(new WritableStream({write(data) { written += data.length; }})); return {size:written};
  }) } as unknown as Pick<R2Bucket,'get'|'put'>;
  return {bucket,contentHash,written:()=>written,source:{r2Key:'source',etag:'v1',sizeBytes:declared,contentHash}};
}
test('200MB is hashed/copied in 64KB chunks, without arrayBuffer or full-file allocation', async () => {
  const f = fixture(HQ_MEDIA_MAX_BYTES);
  expect(await hashHqMedia(f.bucket,'source','v1',HQ_MEDIA_MAX_BYTES)).toBe(f.contentHash);
  expect(await copyHqMediaStream(f.bucket,f.source,'target',{})).toMatchObject({size:HQ_MEDIA_MAX_BYTES});
  expect(f.written()).toBe(HQ_MEDIA_MAX_BYTES);
});
test.each(['oversize','truncated','hash','etag'])('rejects %s before copy publication', async mode => {
  const f = fixture(mode === 'oversize' ? 101 : mode === 'truncated' ? 99 : 100,100);
  if (mode === 'hash') f.source.contentHash = '0'.repeat(64);
  if (mode === 'etag') f.source.etag = 'changed';
  await expect(copyHqMediaStream(f.bucket,f.source,'target',{})).rejects.toThrow();
});
test('conditional PUT races cancel the unread source instead of waiting forever',async()=>{
  const f=fixture(100);
  Object.assign(f.bucket,{put:vi.fn(async()=>null)});
  expect(await copyHqMediaStream(f.bucket,f.source,'target',{})).toBeNull();
});
