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
  // R2 は長さの分からない流れを受け付けない。受け口で tee() した枝は長さを
  // 持たないので、申告の大きさを付けて渡す。実際の大きさが申告と違えば
  // FixedLengthStream が流れを壊し、保存は失敗する（大きさの偽りも通さない）。
  const fixedLength = new FixedLengthStream(input.contentLength);
  const pipePromise = input.body.pipeTo(fixedLength.writable);
  try {
    await input.bucket.put(key, fixedLength.readable, {
      httpMetadata: { contentType: input.mimeType },
      customMetadata: { originalFilename: input.originalFilename ?? key },
    });
    await pipePromise;
  } catch (err) {
    await pipePromise.catch(() => undefined);
    throw err;
  }
  return {
    key,
    url: `${input.publicBaseUrl}/images/${key}`,
    mimeType: input.mimeType,
    size: input.contentLength,
  };
}
