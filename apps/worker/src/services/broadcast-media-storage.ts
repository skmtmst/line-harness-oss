export interface StoredBroadcastMedia {
  key: string;
  url: string;
  mimeType: string;
  size: number;
}

/**
 * 配信素材の保存をR2から分離する薄い層。
 * 保存期限や別ストレージへの移行は、この実装だけを差し替えれば追加できる。
 */
export async function storeBroadcastMedia(input: {
  bucket: R2Bucket;
  body: ReadableStream;
  contentLength: number;
  mimeType: string;
  originalFilename?: string;
  publicBaseUrl: string;
}): Promise<StoredBroadcastMedia> {
  const extensionByType: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
  };
  const extension = extensionByType[input.mimeType];
  if (!extension) throw new Error('Unsupported broadcast media type');

  const id = crypto.randomUUID();
  const key = `broadcast-media/${id}.${extension}`;
  await input.bucket.put(key, input.body, {
    httpMetadata: { contentType: input.mimeType },
    customMetadata: { originalFilename: input.originalFilename ?? key },
  });
  return {
    key,
    url: `${input.publicBaseUrl}/images/${key}`,
    mimeType: input.mimeType,
    size: input.contentLength,
  };
}
