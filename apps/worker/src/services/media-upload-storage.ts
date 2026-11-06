/** 署名するのは一時キーだけとし、公開キーへの書込は Worker に限る。 */
export function mediaUploadKey(sessionId: string): string {
  return `private/media-uploads/${sessionId}`;
}

export function isFinalMediaKey(key: string): boolean {
  return /^media\/[^/]+\/final\//.test(key);
}

export function finalMediaKey(accountId: string, extension: string): string {
  return `media/${accountId}/final/${crypto.randomUUID()}.${extension}`;
}

/** 有効な PUT URL が再利用されても同じバイトを読むよう、条件付き GET で固定する。 */
export async function copyMediaUpload(
  bucket: R2Bucket, sourceKey: string, finalKey: string, etag: string,
  size: number, mimeType: string,
): Promise<boolean> {
  const source = await bucket.get(sourceKey, { onlyIf: { etagMatches: etag } });
  if (!source || !('body' in source)) return false;
  const fixed = new FixedLengthStream(size);
  const abort = new AbortController();
  const pipe = source.body.pipeTo(fixed.writable, { signal: abort.signal });
  void pipe.catch(() => undefined);
  try {
    await bucket.put(finalKey, fixed.readable, { httpMetadata: { contentType: mimeType } });
    await pipe;
    return true;
  } catch (error) {
    abort.abort();
    await pipe.catch(() => undefined);
    await bucket.delete(finalKey).catch(() => undefined);
    throw error;
  }
}

/** 条件不一致の結果は metadata だけなので、読めるオブジェクトとして返さない。 */
export async function getPinnedMediaObject(bucket: R2Bucket, key: string, etag?: string): Promise<R2ObjectBody | null> {
  if (!etag) return bucket.get(key);
  const object = await bucket.get(key, { onlyIf: { etagMatches: etag } });
  return object && 'body' in object ? object : null;
}
