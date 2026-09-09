/**
 * QR の升目を PNG / SVG / JPEG の画像へ起こす。
 *
 * 外部の画像生成サービスへは何も送らない。以前は data をそのまま
 * api.qrserver.com へ渡していたので、流入 ref や LIFF URL が第三者へ
 * 渡っていた。ここは Worker の中だけで完結する。
 *
 * 依存を増やさないために、PNG は 1 ビット灰色、JPEG は白黒 1 成分の
 * ベースライン形式を自前で組み立てる。QR は白黒 2 色しかないので、
 * この 2 つで足りる。
 */

import { QrInputError, type QrSymbol } from './qr-matrix.js';

/** 画像に起こせないときに投げる。利用者には 400 で返す。 */
export class QrRenderError extends QrInputError {
  constructor(message: string) {
    super(message);
    this.name = 'QrRenderError';
  }
}

/** 静粛領域(白い余白)。規格どおり 4 モジュール。読み取り率に効く。 */
export const QR_QUIET_ZONE = 4;

interface Layout {
  readonly width: number;
  readonly height: number;
  /** 1 モジュールあたりの画素数。 */
  readonly scale: number;
  /** 余白込みの升目数。 */
  readonly cells: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * 指定の画素数に升目を収める。
 *
 * 1 モジュール 1 画素も取れない大きさは、拡大縮小でごまかさず断る。
 * 端数を丸めた QR は目には出るが読み取れず、印刷してから気づく。
 */
export function layoutQr(symbol: QrSymbol, width: number, height: number): Layout {
  const cells = symbol.size + QR_QUIET_ZONE * 2;
  const scale = Math.floor(Math.min(width, height) / cells);
  if (scale < 1) {
    throw new QrRenderError(
      `指定の大きさ(${width}x${height})では、この長さのQRを読み取れる形で描けません。${cells}px以上を指定してください`,
    );
  }
  const drawn = cells * scale;
  return {
    width,
    height,
    scale,
    cells,
    offsetX: Math.floor((width - drawn) / 2),
    offsetY: Math.floor((height - drawn) / 2),
  };
}

/** 画素が黒かどうか。余白と中央寄せのぶんを差し引いて升目を引く。 */
function isDarkPixel(symbol: QrSymbol, layout: Layout, px: number, py: number): boolean {
  const cx = Math.floor((px - layout.offsetX) / layout.scale) - QR_QUIET_ZONE;
  const cy = Math.floor((py - layout.offsetY) / layout.scale) - QR_QUIET_ZONE;
  if (px < layout.offsetX || py < layout.offsetY) return false;
  if (cx < 0 || cy < 0 || cx >= symbol.size || cy >= symbol.size) return false;
  return symbol.modules[cy * symbol.size + cx] === 1;
}

/* ------------------------------------------------------------------ SVG */

/** 印刷用。拡大しても粗くならないので入稿に向く。 */
export function renderQrSvg(symbol: QrSymbol, width: number, height: number): string {
  const layout = layoutQr(symbol, width, height);
  const parts: string[] = [];
  for (let y = 0; y < symbol.size; y++) {
    let runStart = -1;
    for (let x = 0; x <= symbol.size; x++) {
      const dark = x < symbol.size && symbol.modules[y * symbol.size + x] === 1;
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        const px = layout.offsetX + (runStart + QR_QUIET_ZONE) * layout.scale;
        const py = layout.offsetY + (y + QR_QUIET_ZONE) * layout.scale;
        parts.push(`M${px} ${py}h${(x - runStart) * layout.scale}v${layout.scale}h-${(x - runStart) * layout.scale}z`);
        runStart = -1;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${parts.join('')}"/>` +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * 圧縮なしの deflate(zlib 形式)。
 *
 * CompressionStream が無い環境でも PNG を返せるようにするための控え。
 * 圧縮しないぶん大きくなるが、1024px でも 150KB ほどで収まる。
 */
export function storedZlibDeflate(raw: Uint8Array): Uint8Array {
  const blockMax = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / blockMax));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  out[p++] = 0x78; // CMF: deflate, 32KiB window
  out[p++] = 0x01; // FLG: 圧縮率の指定なし
  for (let i = 0; i < blocks; i++) {
    const start = i * blockMax;
    const len = Math.min(blockMax, raw.length - start);
    out[p++] = i === blocks - 1 ? 1 : 0;
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), p);
    p += len;
  }
  const sum = adler32(raw);
  out[p++] = (sum >>> 24) & 0xff;
  out[p++] = (sum >>> 16) & 0xff;
  out[p++] = (sum >>> 8) & 0xff;
  out[p++] = sum & 0xff;
  return out.subarray(0, p);
}

async function zlibDeflate(raw: Uint8Array): Promise<Uint8Array> {
  const Compression = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (typeof Compression !== 'function') return storedZlibDeflate(raw);
  const stream = new Compression('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(raw);
  void writer.close();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
    size += (value as Uint8Array).length;
  }
  const out = new Uint8Array(size);
  let p = 0;
  for (const chunk of chunks) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** 画面表示と保存の既定。白黒しか無いので 1 ビット灰色で足りる。 */
export async function renderQrPng(symbol: QrSymbol, width: number, height: number): Promise<Uint8Array> {
  const layout = layoutQr(symbol, width, height);
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    raw[base] = 0; // フィルタ種別: なし
    // 1 が白。まず全部白にしてから、黒い画素のビットを落とす。
    raw.fill(0xff, base + 1, base + 1 + rowBytes);
    for (let x = 0; x < width; x++) {
      if (isDarkPixel(symbol, layout, x, y)) {
        raw[base + 1 + (x >>> 3)] &= ~(0x80 >>> (x & 7));
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 1; // ビット深度
  ihdr[9] = 0; // 色種別: 灰色
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = await zlibDeflate(raw);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of chunks) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

/* ----------------------------------------------------------------- JPEG */

/** ジグザグ順(自然順の添字を並べたもの)。 */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14,
  21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53,
  60, 61, 54, 47, 55, 62, 63,
];

/** 標準の輝度量子化表(自然順)。 */
const STD_LUMINANCE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22,
  29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103,
  121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
  0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83,
  0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

/** 印刷したときに角が甘くならないよう、量子化は細かめ(品質 90)にする。 */
const JPEG_QUALITY = 90;

const COSINE = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return table;
})();

function buildQuantTable(quality: number): Int32Array {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const table = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    table[i] = Math.min(255, Math.max(1, Math.floor((STD_LUMINANCE_QUANT[i] * scale + 50) / 100)));
  }
  return table;
}

interface HuffCode {
  readonly code: number;
  readonly length: number;
}

function buildHuffTable(bits: readonly number[], values: readonly number[]): Map<number, HuffCode> {
  const table = new Map<number, HuffCode>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < bits[length - 1]; i++) table.set(values[k++], { code: code++, length });
    code <<= 1;
  }
  return table;
}

class JpegWriter {
  private readonly bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  word(value: number): void {
    this.byte(value >>> 8);
    this.byte(value);
  }

  marker(value: number): void {
    this.byte(0xff);
    this.byte(value);
  }

  bits(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) {
      this.bitBuffer = ((this.bitBuffer << 1) | ((value >>> i) & 1)) & 0xff;
      this.bitCount++;
      if (this.bitCount === 8) {
        this.byte(this.bitBuffer);
        // 走査データの中の 0xFF は印と区別できないので 0x00 を挟む。
        if (this.bitBuffer === 0xff) this.byte(0x00);
        this.bitBuffer = 0;
        this.bitCount = 0;
      }
    }
  }

  code(entry: HuffCode | undefined): void {
    if (!entry) throw new QrRenderError('JPEGの符号表に無い値が出ました');
    this.bits(entry.code, entry.length);
  }

  flushBits(): void {
    while (this.bitCount > 0) this.bits(1, 1);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function bitLength(value: number): number {
  let length = 0;
  let v = value;
  while (v > 0) {
    length++;
    v >>>= 1;
  }
  return length;
}

/**
 * 白黒 1 成分のベースライン JPEG。
 *
 * PNG を受け付けない入稿先のための形式。色は使わないので彩度成分は持たず、
 * 輝度だけを書く。
 */
export function renderQrJpeg(symbol: QrSymbol, width: number, height: number): Uint8Array {
  const layout = layoutQr(symbol, width, height);
  const quant = buildQuantTable(JPEG_QUALITY);
  const dcTable = buildHuffTable(DC_BITS, DC_VALUES);
  const acTable = buildHuffTable(AC_BITS, AC_VALUES);
  const writer = new JpegWriter();

  writer.marker(0xd8); // SOI

  writer.marker(0xe0); // APP0 (JFIF)
  writer.word(16);
  for (const ch of 'JFIF') writer.byte(ch.charCodeAt(0));
  writer.byte(0);
  writer.byte(1);
  writer.byte(1);
  writer.byte(0); // 単位なし
  writer.word(1);
  writer.word(1);
  writer.byte(0);
  writer.byte(0);

  writer.marker(0xdb); // DQT
  writer.word(67);
  writer.byte(0x00); // 8 ビット精度・表 0
  for (let i = 0; i < 64; i++) writer.byte(quant[ZIGZAG[i]]);

  writer.marker(0xc0); // SOF0
  writer.word(11);
  writer.byte(8);
  writer.word(height);
  writer.word(width);
  writer.byte(1); // 成分数
  writer.byte(1); // 成分 ID
  writer.byte(0x11); // 間引きなし
  writer.byte(0); // 量子化表 0

  writer.marker(0xc4); // DHT (DC)
  writer.word(2 + 1 + 16 + DC_VALUES.length);
  writer.byte(0x00);
  for (const b of DC_BITS) writer.byte(b);
  for (const v of DC_VALUES) writer.byte(v);

  writer.marker(0xc4); // DHT (AC)
  writer.word(2 + 1 + 16 + AC_VALUES.length);
  writer.byte(0x10);
  for (const b of AC_BITS) writer.byte(b);
  for (const v of AC_VALUES) writer.byte(v);

  writer.marker(0xda); // SOS
  writer.word(8);
  writer.byte(1);
  writer.byte(1);
  writer.byte(0x00);
  writer.byte(0);
  writer.byte(63);
  writer.byte(0);

  const block = new Float64Array(64);
  const rows = new Float64Array(64);
  const coefficients = new Int32Array(64);
  let previousDc = 0;

  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      for (let y = 0; y < 8; y++) {
        // 端の 8 の倍数に足りない部分は、直前の行・列を伸ばして埋める。
        const py = Math.min(blockY + y, height - 1);
        for (let x = 0; x < 8; x++) {
          const px = Math.min(blockX + x, width - 1);
          block[y * 8 + x] = (isDarkPixel(symbol, layout, px, py) ? 0 : 255) - 128;
        }
      }

      for (let y = 0; y < 8; y++) {
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * COSINE[u * 8 + x];
          rows[y * 8 + u] = sum;
        }
      }
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          let sum = 0;
          for (let y = 0; y < 8; y++) sum += rows[y * 8 + u] * COSINE[v * 8 + y];
          const natural = v * 8 + u;
          coefficients[natural] = Math.round((sum * 0.25) / quant[natural]);
        }
      }

      const dc = coefficients[0];
      const diff = dc - previousDc;
      previousDc = dc;
      if (diff === 0) {
        writer.code(dcTable.get(0));
      } else {
        const category = bitLength(Math.abs(diff));
        writer.code(dcTable.get(category));
        writer.bits(diff < 0 ? diff + (1 << category) - 1 : diff, category);
      }

      let last = 63;
      while (last > 0 && coefficients[ZIGZAG[last]] === 0) last--;
      let run = 0;
      for (let k = 1; k <= last; k++) {
        const value = coefficients[ZIGZAG[k]];
        if (value === 0) {
          run++;
          continue;
        }
        while (run >= 16) {
          writer.code(acTable.get(0xf0));
          run -= 16;
        }
        const category = bitLength(Math.abs(value));
        writer.code(acTable.get((run << 4) | category));
        writer.bits(value < 0 ? value + (1 << category) - 1 : value, category);
        run = 0;
      }
      if (last < 63) writer.code(acTable.get(0x00));
    }
  }

  writer.flushBits();
  writer.marker(0xd9); // EOI
  return writer.toBytes();
}
