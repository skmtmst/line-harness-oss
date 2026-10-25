/** 200MBの動画をメモリへ載せず、2回の読込を同じ ETag へ固定する。 */
export const HQ_MEDIA_MAX_BYTES = 200 * 1024 * 1024;
export interface HqMediaStreamSource {
  r2Key: string;
  etag: string;
  sizeBytes: number;
  contentHash: string;
}
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');

export async function hashHqMedia(bucket: Pick<R2Bucket, 'get'>, key: string, etag: string, size: number): Promise<string> {
  const object = await bucket.get(key, { onlyIf: { etagMatches: etag } });
  if (!object || !('body' in object) || object.size !== size || size < 1 || size > HQ_MEDIA_MAX_BYTES) throw new Error('SOURCE_MEDIA_UNAVAILABLE');
  const digest = new crypto.DigestStream('SHA-256');
  void digest.digest.catch(() => undefined);
  let actual = 0;
  await object.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    actual += chunk.byteLength;
    if (actual > size) throw new Error('MEDIA_SIZE_LIMIT');
    controller.enqueue(chunk);
  } })).pipeTo(digest);
  if (actual !== size) throw new Error('MEDIA_SIZE_LIMIT');
  return hex(await digest.digest);
}

/** 再試行ごとに条件付きで読み、ハッシュや長さが違えば公開しない。 */
export async function copyHqMediaStream(bucket: Pick<R2Bucket, 'get' | 'put'>, source: HqMediaStreamSource, key: string, options: R2PutOptions) {
  if (source.sizeBytes < 1 || source.sizeBytes > HQ_MEDIA_MAX_BYTES || !/^[a-f0-9]{64}$/.test(source.contentHash)) throw new Error('MEDIA_SIZE_LIMIT');
  const object = await bucket.get(source.r2Key, { onlyIf: { etagMatches: source.etag } });
  if (!object || !('body' in object) || object.size !== source.sizeBytes) throw new Error('SOURCE_MEDIA_UNAVAILABLE');
  const digest = new crypto.DigestStream('SHA-256'), writer = digest.getWriter();
  // stream の中断で digest も拒否されるため、直ちに例外処理を付ける。
  void digest.digest.catch(() => undefined);
  let actual = 0;
  const fixed = new FixedLengthStream(source.sizeBytes);
  const piping = object.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      actual += chunk.byteLength;
      if (actual > source.sizeBytes) throw new Error('MEDIA_SIZE_LIMIT');
      await writer.write(chunk);
      controller.enqueue(chunk);
    },
    async flush() {
      await writer.close();
      if (actual !== source.sizeBytes || hex(await digest.digest) !== source.contentHash) throw new Error('MEDIA_COPY_INVALID');
    },
  })).pipeTo(fixed.writable);
  void piping.catch(() => undefined);
  try {
    const result = await bucket.put(key, fixed.readable, options);
    if (!result) {
      // 条件付き PUT が競合すると stream を読み切らず戻る場合がある。
      await fixed.readable.cancel().catch(() => undefined);
      await piping.catch(() => undefined);
      await writer.abort().catch(() => undefined);
      return null;
    }
    await piping;
    return result;
  } catch (error) {
    await fixed.readable.cancel().catch(() => undefined);
    await piping.catch(() => undefined);
    await writer.abort().catch(() => undefined);
    throw error;
  }
}
