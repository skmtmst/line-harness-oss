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

/**
 * 画素の並びから升目の番号を引く表。余白と枠の外は -1。
 *
 * 画素ごとに割り算をすると、1024px で 100 万回になる。公開口は 1 要求
 * あたりの CPU 枠が厳しいので、軸ごとに 1 回だけ作って引く。
 */
function axisModuleIndex(length: number, offset: number, scale: number, size: number): Int32Array {
  const table = new Int32Array(length).fill(-1);
  for (let cell = 0; cell < size; cell++) {
    const start = offset + (cell + QR_QUIET_ZONE) * scale;
    const end = Math.min(length, start + scale);
    for (let p = Math.max(0, start); p < end; p++) table[p] = cell;
  }
  return table;
}

/**
 * 黒い画素を 1 とした 1 ビット地図。行の上位ビットが左端。
 *
 * PNG も JPEG もここから作る。同じ升目行に当たる画素行は中身が同じなので、
 * 1 本作って複写する。1024px で 100 万回の判定が 17 万回で済む。
 */
interface DarkBitmap {
  readonly rowBytes: number;
  readonly bytes: Uint8Array;
}

function packDarkBitmap(symbol: QrSymbol, layout: Layout, width: number, height: number): DarkBitmap {
  const columnModule = axisModuleIndex(width, layout.offsetX, layout.scale, symbol.size);
  const rowModule = axisModuleIndex(height, layout.offsetY, layout.scale, symbol.size);
  const rowBytes = (width + 7) >>> 3;
  const tailBits = width & 7;
  const bytes = new Uint8Array(rowBytes * height);
  let previousCell = -2;
  let previousBase = 0;
  for (let y = 0; y < height; y++) {
    const base = y * rowBytes;
    const cell = rowModule[y];
    if (cell === previousCell) {
      bytes.copyWithin(base, previousBase, previousBase + rowBytes);
      continue;
    }
    if (cell >= 0) {
      const modulesBase = cell * symbol.size;
      // 8 画素ぶんを 1 つの数にまとめてから置く。1 ビットずつ書き戻すと、
      // 1024px で 100 万回の読み書きになる。
      for (let byteIndex = 0; byteIndex < rowBytes; byteIndex++) {
        const first = byteIndex << 3;
        const limit = Math.min(8, width - first);
        let packed = 0;
        for (let bit = 0; bit < limit; bit++) {
          const column = columnModule[first + bit];
          if (column >= 0 && symbol.modules[modulesBase + column] === 1) packed |= 0x80 >>> bit;
        }
        bytes[base + byteIndex] = packed;
      }
    }
    // 幅が 8 の倍数でないときの余りビットは、右端の画素を伸ばして埋める。
    // PNG では読み飛ばされ、JPEG では端のブロックの埋めとして使う。
    if (tailBits > 0) {
      const last = base + rowBytes - 1;
      if ((bytes[last] & (0x80 >>> (tailBits - 1))) !== 0) bytes[last] |= (0xff >>> tailBits) & 0xff;
    }
    previousCell = cell;
    previousBase = base;
  }
  return { rowBytes, bytes };
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
  const bitmap = packDarkBitmap(symbol, layout, width, height);
  const rowBytes = bitmap.rowBytes;
  const raw = new Uint8Array((rowBytes + 1) * height);
  // PNG の 1 ビット灰色は 1 が白なので、地図を反転して並べる。
  // 行頭のフィルタ種別は 0（なし）。
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    const source = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) raw[base + 1 + i] = ~bitmap.bytes[source + i];
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

/**
 * 量子化の細かさ。
 *
 * 粗くするほど升目の角がにじむ。型番 1〜38 × 64〜1024px の 31 通りで、
 * 出した JPEG を復号して白黒に戻す試験をしたところ、75 と 60 と 45 は
 * 1 画素も狂わず、30 で狂い始めた。狂い始めるところから離しつつ、
 * 90 より 3 割小さく出せる 75 を使う。
 */
const JPEG_QUALITY = 75;

const COSINE = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      table[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return table;
})();

/**
 * 8 画素の白黒 1 行を 1 次元変換した結果の表。
 *
 * 入力は白黒しかないので、1 行の並びは 256 通りしかない。毎回かけ算を
 * するより引く方が速い。ブロック変換の前半がまるごと表引きになる。
 */
const ROW_TRANSFORM = (() => {
  const table = new Float64Array(256 * 8);
  for (let pattern = 0; pattern < 256; pattern++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        sum += (((pattern >>> (7 - x)) & 1) === 1 ? -128 : 127) * COSINE[u * 8 + x];
      }
      table[pattern * 8 + u] = sum;
    }
  }
  return table;
})();

/**
 * ブロック変換の作業領域。
 *
 * 1 枚の変換の中で使い回して確保を減らす。モジュールの外に置くと、
 * 別の要求と踏み合う形になるので、1 枚ごとに作る。
 */
interface BlockScratch {
  readonly partial: Float64Array;
  readonly coefficients: Int32Array;
  /**
   * 交流成分の書き出しの下書き。0 でない係数 1 個につき「符号」と「値」で
   * 4 個使う。上限は 63 個なので 252 個。これに 16 個並びの印（最大 3 回で
   * 6 個）と終端の 2 個を足す。
   */
  readonly ac: Int32Array;
}

function createBlockScratch(): BlockScratch {
  return {
    partial: new Float64Array(64),
    coefficients: new Int32Array(64),
    ac: new Int32Array(63 * 4 + 8),
  };
}

function buildQuantTable(quality: number): Int32Array {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const table = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    table[i] = Math.min(255, Math.max(1, Math.floor((STD_LUMINANCE_QUANT[i] * scale + 50) / 100)));
  }
  return table;
}

/**
 * 量子化の割り算をかけ算に置き換えるための逆数。
 *
 * 1 ブロックに 64 回の割り算が入ると、絵柄の種類ぶんで数千回になる。
 * 割り切れない端数の出方は変わるが、量子化はもともと丸めなので、
 * 復号して白黒に戻した結果は変わらない（テストで固定している）。
 */
function buildQuantReciprocal(quant: Int32Array): Float64Array {
  const table = new Float64Array(64);
  for (let i = 0; i < 64; i++) table[i] = 0.25 / quant[i];
  return table;
}

interface HuffCode {
  readonly code: number;
  readonly length: number;
}

/**
 * 符号表を「印の値で引ける配列」にしたもの。
 *
 * ブロックごとに何十回も引くので、Map だと引くだけで見過ごせない時間になる。
 * lengths が 0 の位置は表に無い印。
 */
interface JpegCodeTable {
  readonly codes: Int32Array;
  readonly lengths: Int32Array;
}

function toCodeTable(table: Map<number, HuffCode>): JpegCodeTable {
  const codes = new Int32Array(256);
  const lengths = new Int32Array(256);
  for (const [symbol, entry] of table) {
    codes[symbol] = entry.code;
    lengths[symbol] = entry.length;
  }
  return { codes, lengths };
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
  /**
   * 出したバイト。配列の push で貯めると、1024px の JPEG で 50 万回になる。
   * 足りなくなったら倍にして伸ばす。
   */
  private buffer: Uint8Array;
  private length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Uint8Array(Math.max(1024, initialCapacity));
  }

  byte(value: number): void {
    if (this.length === this.buffer.length) {
      const grown = new Uint8Array(this.buffer.length * 2);
      grown.set(this.buffer);
      this.buffer = grown;
    }
    this.buffer[this.length++] = value & 0xff;
  }

  word(value: number): void {
    this.byte(value >>> 8);
    this.byte(value);
  }

  marker(value: number): void {
    this.byte(0xff);
    this.byte(value);
  }

  /**
   * ビットを詰める。1 ビットずつ回すと符号化の大半がここで消えるので、
   * 32 ビットに貯めてから 1 バイトずつ出す。長さは 16 以下なので溢れない。
   */
  bits(value: number, length: number): void {
    if (length === 0) return;
    this.bitBuffer = (this.bitBuffer << length) | (value & ((1 << length) - 1));
    this.bitCount += length;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      const out = (this.bitBuffer >>> this.bitCount) & 0xff;
      this.byte(out);
      // 走査データの中の 0xFF は印と区別できないので 0x00 を挟む。
      if (out === 0xff) this.byte(0x00);
    }
  }

  code(entry: HuffCode | undefined): void {
    if (!entry) throw new QrRenderError('JPEGの符号表に無い値が出ました');
    this.bits(entry.code, entry.length);
  }

  flushBits(): void {
    if (this.bitCount > 0) this.bits((1 << (8 - this.bitCount)) - 1, 8 - this.bitCount);
  }

  toBytes(): Uint8Array {
    return this.buffer.subarray(0, this.length);
  }
}

/** 値を表すのに要るビット数。0 は 0。 */
function bitLength(value: number): number {
  return 32 - Math.clz32(value);
}

/** 絵柄 1 つぶんの変換結果。DC は差分で書くので値のまま持つ。 */
interface BlockCode {
  /** 量子化した直流成分。 */
  readonly dc: number;
  /** 交流成分の書き出し。[値, ビット数] の並び。 */
  readonly ac: Int32Array;
}

/** 8x8 の白黒（1 行 8 ビット）を、量子化した係数と交流の書き出しへ変える。 */
function encodeJpegBlock(
  rows: Int32Array,
  reciprocal: Float64Array,
  ac: JpegCodeTable,
  scratch: BlockScratch,
): BlockCode {
  const partial = scratch.partial;
  for (let y = 0; y < 8; y++) {
    const source = rows[y] * 8;
    const target = y * 8;
    for (let u = 0; u < 8; u++) partial[target + u] = ROW_TRANSFORM[source + u];
  }

  const coefficients = scratch.coefficients;
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += partial[y * 8 + u] * COSINE[v * 8 + y];
      const natural = v * 8 + u;
      coefficients[natural] = Math.round(sum * reciprocal[natural]);
    }
  }

  let last = 63;
  while (last > 0 && coefficients[ZIGZAG[last]] === 0) last--;
  const draft = scratch.ac;
  let used = 0;
  const push = (symbol: number) => {
    const length = ac.lengths[symbol];
    if (length === 0) throw new QrRenderError('JPEGの符号表に無い値が出ました');
    draft[used++] = ac.codes[symbol];
    draft[used++] = length;
  };
  let run = 0;
  for (let k = 1; k <= last; k++) {
    const value = coefficients[ZIGZAG[k]];
    if (value === 0) {
      run++;
      continue;
    }
    while (run >= 16) {
      push(0xf0);
      run -= 16;
    }
    const category = bitLength(value < 0 ? -value : value);
    const symbol = (run << 4) | category;
    const length = ac.lengths[symbol];
    if (length === 0) throw new QrRenderError('JPEGの符号表に無い値が出ました');
    const bits = value < 0 ? value + (1 << category) - 1 : value;
    // 符号と値は続けて出るので、24 ビットに収まるならまとめて 1 回で書く。
    // 書き出しの回数が JPEG 全体の CPU の山なので、ここが効く。
    if (length + category <= 24) {
      draft[used++] = (ac.codes[symbol] << category) | bits;
      draft[used++] = length + category;
    } else {
      draft[used++] = ac.codes[symbol];
      draft[used++] = length;
      draft[used++] = bits;
      draft[used++] = category;
    }
    run = 0;
  }
  if (last < 63) push(0x00);
  return { dc: coefficients[0], ac: draft.slice(0, used) };
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
  const reciprocal = buildQuantReciprocal(quant);
  const dcTable = buildHuffTable(DC_BITS, DC_VALUES);
  const acTable = buildHuffTable(AC_BITS, AC_VALUES);
  const acCodeTable = toCodeTable(acTable);
  // 最大構成でも伸ばし直しが 1 回で済む程度に見積もる。
  const writer = new JpegWriter(width * height + 1024);

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

  // 白黒の 8x8 は 64 ビットで表せる。同じ絵柄のブロックが何度も出るので
  // （1024px の最大構成で 16384 個中 1061 種類）、変換した結果を絵柄ごとに
  // 覚えて使い回す。ここを回さないと 1 要求の CPU 枠に収まらない。
  // 直流成分の符号は毎ブロック引くので、表引きを配列にしておく。
  const dcCodes = new Int32Array(DC_VALUES.length);
  const dcLengths = new Int32Array(DC_VALUES.length);
  for (const value of DC_VALUES) {
    const entry = dcTable.get(value);
    if (!entry) throw new QrRenderError('JPEGの符号表に無い値が出ました');
    dcCodes[value] = entry.code;
    dcLengths[value] = entry.length;
  }

  const cache = new Map<number, Map<number, BlockCode>>();
  const scratch = createBlockScratch();
  const bitmap = packDarkBitmap(symbol, layout, width, height);
  const rowBytes = bitmap.rowBytes;
  const rows = new Int32Array(8);
  let previousDc = 0;

  const rowOffsets = new Int32Array(8);
  for (let blockY = 0; blockY < height; blockY += 8) {
    // 帯の中の 8 行の行頭は、この帯の中で変わらない。ブロックごとに
    // 出し直すと 1024px で 13 万回になるので、帯ごとに 1 回だけ出す。
    // 高さが 8 の倍数でないときは、下端の行を伸ばして埋める。
    for (let y = 0; y < 8; y++) rowOffsets[y] = Math.min(blockY + y, height - 1) * rowBytes;
    for (let blockX = 0; blockX < width; blockX += 8) {
      const column = blockX >>> 3;
      const bytes = bitmap.bytes;
      const b0 = bytes[rowOffsets[0] + column];
      const b1 = bytes[rowOffsets[1] + column];
      const b2 = bytes[rowOffsets[2] + column];
      const b3 = bytes[rowOffsets[3] + column];
      const b4 = bytes[rowOffsets[4] + column];
      const b5 = bytes[rowOffsets[5] + column];
      const b6 = bytes[rowOffsets[6] + column];
      const b7 = bytes[rowOffsets[7] + column];
      const low = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
      const high = b4 | (b5 << 8) | (b6 << 16) | (b7 << 24);

      let byLow = cache.get(high);
      if (byLow === undefined) {
        byLow = new Map<number, BlockCode>();
        cache.set(high, byLow);
      }
      let code = byLow.get(low);
      if (code === undefined) {
        rows[0] = b0;
        rows[1] = b1;
        rows[2] = b2;
        rows[3] = b3;
        rows[4] = b4;
        rows[5] = b5;
        rows[6] = b6;
        rows[7] = b7;
        code = encodeJpegBlock(rows, reciprocal, acCodeTable, scratch);
        byLow.set(low, code);
      }

      const diff = code.dc - previousDc;
      previousDc = code.dc;
      const category = bitLength(diff < 0 ? -diff : diff);
      const dcLength = dcLengths[category];
      if (category === 0) {
        writer.bits(dcCodes[0], dcLength);
      } else if (dcLength + category <= 24) {
        const bits = diff < 0 ? diff + (1 << category) - 1 : diff;
        writer.bits((dcCodes[category] << category) | bits, dcLength + category);
      } else {
        writer.bits(dcCodes[category], dcLength);
        writer.bits(diff < 0 ? diff + (1 << category) - 1 : diff, category);
      }
      const acBits = code.ac;
      for (let i = 0; i < acBits.length; i += 2) writer.bits(acBits[i], acBits[i + 1]);
    }
  }

  writer.flushBits();
  writer.marker(0xd9); // EOI
  return writer.toBytes();
}
