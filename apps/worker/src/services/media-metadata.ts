/*
 * アップロード済みオブジェクトの先頭から画像の寸法を読む。
 * 申告値だけに頼ると、実体と違う内容でも版追加を通ってしまうため、
 * パースできる形式は実体から測る。読めない場合は null を返し、
 * 呼び出し側が「互換性の判定材料が不足」として明示的に拒否する。
 */

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24)
    | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8)
    | (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
  ) >>> 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)) >>> 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(bytes[offset + i] ?? 0);
  return text;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function gifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = readUint24LE(bytes, 24) + 1;
    const height = readUint24LE(bytes, 27) + 1;
    return width > 1 && height > 1 ? { width, height } : null;
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    // ロスあり: フレームヘッダの寸法は 14bit。
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = readUint32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return width > 1 && height > 1 ? { width, height } : null;
  }
  return null;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
    | ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  // セグメントをたどって SOF0-SOF15 (DHT/DAC/RST を除く) を探す。
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

/** 画像の実寸法。読み取れない形式・壊れた先頭なら null。 */
export function imageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } | null {
  switch (mimeType) {
    case 'image/png': return pngDimensions(bytes);
    case 'image/gif': return gifDimensions(bytes);
    case 'image/webp': return webpDimensions(bytes);
    case 'image/jpeg': return jpegDimensions(bytes);
    default: return null;
  }
}

/** 画像の先頭を読むのに十分な範囲。JPEG の EXIF 付きでも SOF が入るよう余裕を持たせる。 */
export const IMAGE_METADATA_PREFIX_BYTES = 256 * 1024;

/*
 * 投稿画像から位置情報・端末情報などの付帯メタデータを外す（#931 N-310）。
 * 公開配信する派生画像へ使う。原本は証跡として保存側が持つため、
 * ここでは外す側だけを扱う。
 *
 * どの形式も「チャンク／セグメントを選んで並べ直す」だけで、画像本体は
 * 無変更のままコピーする。再エンコードしないので画質は落ちない。
 * 並びが壊れている・想定外の形式のときは入力をそのまま返し、
 * メタデータ除去のために表示できない画像を作らない。
 */

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// JPEG: APP1(EXIF/XMP)・APP13(IPTC/Photoshop)・COM を外す。
// APP0(JFIF)・APP2(ICC) は表示に必要なので残す。
const JPEG_METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    // SOS(0xda) 以降は圧縮データ本体。外す対象はもう出てこない。
    if (marker === 0xda) {
      parts.push(bytes.slice(offset));
      offset = bytes.length;
      break;
    }
    // 長さを持たないマーカー（EOI・RST・TEM）はそのまま通す。
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = readUint16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (!JPEG_METADATA_MARKERS.has(marker)) {
      parts.push(bytes.slice(offset, offset + 2 + length));
    }
    offset += 2 + length;
  }
  parts.push(bytes.slice(offset));
  return concatBytes(parts);
}

// PNG: テキスト系・時刻・EXIF の付帯チャンクだけを外す。CRC込みでコピーするので
// 残したチャンクの整合性は変わらない。
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) return bytes;
  const parts: Uint8Array[] = [bytes.slice(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(bytes.slice(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  parts.push(bytes.slice(offset));
  return concatBytes(parts);
}

// WebP: RIFF の EXIF・XMP チャンクを外し、VP8X の対応フラグと RIFF 全体長を合わせ直す。
function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return bytes;
  }
  const parts: Uint8Array[] = [bytes.slice(0, 12)];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    // チャンクは偶数境界へパディングされる。
    const end = offset + 8 + length + (length % 2);
    if (end > bytes.length) break;
    if (type === 'EXIF' || type === 'XMP ') {
      offset = end;
      continue;
    }
    const chunk = bytes.slice(offset, end);
    if (type === 'VP8X' && length >= 10) {
      // フラグバイト（先頭1バイト）の EXIF(0x10)・XMP(0x08) を落とす。
      chunk[8] = (chunk[8] ?? 0) & ~0x18;
    }
    parts.push(chunk);
    offset = end;
  }
  parts.push(bytes.slice(offset));
  const out = concatBytes(parts);
  // RIFF ヘッダのサイズは「残り全部の長さ」。除去で短くなった分を合わせる。
  const riffSize = out.length - 8;
  out.set([riffSize & 0xff, (riffSize >> 8) & 0xff, (riffSize >> 16) & 0xff, (riffSize >> 24) & 0xff], 4);
  return out;
}

/**
 * 画像から付帯メタデータを外した複製を返す。
 * パース不能・想定外の形式は入力をそのまま返す（画像を壊さないことを優先）。
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  try {
    switch (mimeType) {
      case 'image/jpeg': return stripJpegMetadata(bytes);
      case 'image/png': return stripPngMetadata(bytes);
      case 'image/webp': return stripWebpMetadata(bytes);
      default: return bytes;
    }
  } catch {
    return bytes;
  }
}
