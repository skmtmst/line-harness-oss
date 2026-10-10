const text = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length));
const invalid = (): never => { throw new Error('INVALID_MEDIA'); };
interface Box { type: string; start: number; body: number; end: number }
function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const result: Box[] = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (start < end) {
    if (end - start < 8 || result.length >= 512) invalid();
    let size = view.getUint32(start), header = 8;
    if (size === 1) { if (end - start < 16) invalid(); size = Number(view.getBigUint64(start + 8)); header = 16; }
    if (size === 0) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || size > end - start) invalid();
    result.push({ type: text(bytes, start + 4, 4), start, body: start + header, end: start + size });
    start += size;
  }
  return result;
}
function duration(bytes: Uint8Array, box: Box): number {
  const version = bytes[box.body];
  if (version !== 0 && version !== 1) invalid();
  const offset = box.body + (version === 1 ? 20 : 12), countBytes = version === 1 ? 8 : 4;
  if (offset + 4 + countBytes > box.end) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), scale = view.getUint32(offset);
  const count = version === 1 ? Number(view.getBigUint64(offset + 4)) : view.getUint32(offset + 4);
  if (!scale || !Number.isSafeInteger(count) || count <= 0 || (version === 0 && count === 0xffffffff)) invalid();
  const ms = Math.round(count * 1000 / scale);
  if (!Number.isSafeInteger(ms) || ms < 1) invalid();
  return ms;
}
/** Range reads skip mdat, including files with moov at the end. Metadata is capped at 8MB. */
export async function readHqMp4Metadata(bucket: R2Bucket, key: string, etag: string, size: number, kind: 'audio' | 'video') {
  const read = async (offset: number, length: number) => {
    const obj = await bucket.get(key, { onlyIf: { etagMatches: etag }, range: { offset, length } });
    if (!obj || !('body' in obj)) return invalid();
    const data = new Uint8Array(await obj.arrayBuffer());
    if (data.length !== length) invalid();
    return data;
  };
  let position = 0, moov: Uint8Array | undefined, ftyp = false;
  for (let count = 0; position < size && count < 512; count++) {
    if (size - position < 8) invalid();
    const header = await read(position, Math.min(16, size - position)), view = new DataView(header.buffer);
    let length = view.getUint32(0), headerSize = 8;
    if (length === 1) { if (header.length < 16) invalid(); length = Number(view.getBigUint64(8)); headerSize = 16; }
    if (length === 0) length = size - position;
    if (!Number.isSafeInteger(length) || length < headerSize || length > size - position) invalid();
    const type = text(header, 4, 4);
    if (position === 0 && (type !== 'ftyp' || length < 16)) invalid();
    if (type === 'ftyp') ftyp = true;
    if (type === 'moov') {
      if (moov || length > 8 * 1024 * 1024) invalid();
      moov = await read(position + headerSize, length - headerSize);
    }
    position += length;
  }
  if (!ftyp || !moov || position !== size) invalid();
  const bytes = moov!, roots = boxes(bytes), tracks = roots.filter(b => b.type === 'trak');
  const durations: number[] = [], handlers: string[] = [];
  for (const track of tracks) {
    const mdia = boxes(bytes, track.body, track.end).find(b => b.type === 'mdia');
    if (!mdia) continue;
    const children = boxes(bytes, mdia.body, mdia.end), handler = children.find(b => b.type === 'hdlr'), mdhd = children.find(b => b.type === 'mdhd');
    if (!handler || handler.body + 12 > handler.end || !mdhd) invalid();
    const name = text(bytes, handler!.body + 8, 4); handlers.push(name);
    if (name === (kind === 'audio' ? 'soun' : 'vide')) durations.push(duration(bytes, mdhd!));
  }
  if (!durations.length || (kind === 'audio' && handlers.includes('vide'))) invalid();
  return { durationMs: Math.max(...durations) };
}
