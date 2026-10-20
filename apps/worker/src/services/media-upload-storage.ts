/** Only the temporary key is ever signed; published keys are written by the Worker. */
export function mediaUploadKey(sessionId: string): string {
  return `private/media-uploads/${sessionId}`;
}

export function isFinalMediaKey(key: string): boolean {
  return /^media\/[^/]+\/final\//.test(key);
}

export function finalMediaKey(accountId: string, extension: string): string {
  return `media/${accountId}/final/${crypto.randomUUID()}.${extension}`;
}

/** A conditional GET pins the bytes even if the still-valid PUT URL is reused. */
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

/** Conditional misses have metadata only; never expose them as a readable object. */
export async function getPinnedMediaObject(bucket: R2Bucket, key: string, etag?: string): Promise<R2ObjectBody | null> {
  if (!etag) return bucket.get(key);
  const object = await bucket.get(key, { onlyIf: { etagMatches: etag } });
  return object && 'body' in object ? object : null;
}
