import { vi } from 'vitest';

/** R2の代わり。実際のバイト・メタデータ・条件付き読み取りを保持する。 */
export function attachmentBucket() {
  const objects = new Map<string, { bytes: Uint8Array; meta: R2PutOptions; etag: string }>();
  const objectOf = (key: string, range?: R2Range) => {
    const stored = objects.get(key);
    if (!stored) return null;
    const offset = range && 'offset' in range ? range.offset ?? 0 : 0;
    const length = range && 'length' in range ? range.length : undefined;
    const bytes = stored.bytes.slice(offset, length === undefined ? undefined : offset + length);
    return { key, size: stored.bytes.length, etag: stored.etag, httpMetadata: stored.meta.httpMetadata,
      customMetadata: stored.meta.customMetadata, body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer, text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
  };
  const bucket = {
    put: vi.fn(async (key: string, body: string | Uint8Array | ReadableStream, meta: R2PutOptions = {}) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const etag = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
      objects.set(key, { bytes, meta, etag });
      return objectOf(key);
    }),
    head: vi.fn(async (key: string) => objectOf(key)),
    get: vi.fn(async (key: string, opts?: R2GetOptions) => {
      const stored = objects.get(key);
      if (opts?.onlyIf && !(opts.onlyIf instanceof Headers) && opts.onlyIf.etagMatches && stored?.etag !== opts.onlyIf.etagMatches) return null;
      return objectOf(key, opts?.range instanceof Headers ? undefined : opts?.range);
    }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
  };
  return { bucket: bucket as unknown as R2Bucket, objects, mock: bucket };
}

export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
export const MP4_BYTES = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]);
export const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), ch => ch.charCodeAt(0));

/** 展開しない、保存方式のZIP。中央ディレクトリを含む実際のファイル構造。 */
export function zipBytes(names: string[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const text = Buffer.from(name);
    const data = Buffer.from('<document/>');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(text.length, 26);
    local.push(header, text, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(text.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, text);
    offset += header.length + text.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}
