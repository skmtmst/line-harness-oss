/**
 * QR シンボル(白黒の升目)を LINE Harness の中だけで組み立てる。
 *
 * 流入 ref や LIFF URL は計測の識別子で、第三者へ渡す理由がない。
 * 以前は受け取った data をまるごと外部の QR 生成サービスへ送っていたので、
 * 「ref を第三者へ漏らさない」という説明と実装が食い違っていた。
 * ここでは JIS X 0510 / ISO/IEC 18004 の手順をそのまま実装して、
 * 外部通信なしで升目を作る。
 *
 * 入力は常にバイトモードで載せる。流入 URL は英数字と記号が混ざるので、
 * 数字・英数字モードへ切り替えても縮まないことが多く、分岐を増やすほど
 * 壊れやすくなる。
 */

export type QrEccLevel = 'L' | 'M' | 'Q' | 'H';

/** 形式情報に載せる 2 ビット。誤り訂正の強さの順番とは別なので表で持つ。 */
const ECC_FORMAT_BITS: Record<QrEccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };
/** 下の 2 つの表の行番号。 */
const ECC_ORDINAL: Record<QrEccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

/** 型番ごとの「1 ブロックあたりの誤り訂正コード語数」。添字 0 は使わない。 */
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
  // 型番: 0(未使用), 1, 2, ... 40
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];

/** 型番ごとの誤り訂正ブロック数。添字 0 は使わない。 */
const NUM_ERROR_CORRECTION_BLOCKS: readonly (readonly number[])[] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * 呼び出し側の指定が原因で QR を作れないときの基底。
 *
 * これを継承した失敗は、指定を直せば通るので 400 で返す。
 */
export class QrInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrInputError';
  }
}

/** 入力が大きすぎて 40 型番でも載らないときに投げる。 */
export class QrCapacityError extends QrInputError {
  constructor(message: string) {
    super(message);
    this.name = 'QrCapacityError';
  }
}

export interface QrSymbol {
  /** 一辺の升目数(余白は含まない)。 */
  readonly size: number;
  /** 型番 1〜40。 */
  readonly version: number;
  /** 使った誤り訂正の強さ。 */
  readonly ecc: QrEccLevel;
  /** 使ったマスク 0〜7。減点法で選んだ結果。 */
  readonly mask: number;
  /** true が黒。添字は y * size + x。 */
  readonly modules: Uint8Array;
}

/** 型番から「機能部品を除いたモジュール数」を出す。8 で割った商がコード語数。 */
function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** 型番と強さから、実際にデータを載せられるコード語数を出す。 */
export function numDataCodewords(version: number, ecc: QrEccLevel): number {
  const row = ECC_ORDINAL[ecc];
  return (
    Math.floor(numRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[row][version] * NUM_ERROR_CORRECTION_BLOCKS[row][version]
  );
}

/** バイトモードの文字数を表すビット数。10 型番から 16 ビットになる。 */
function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** 型番と強さで載せられるバイト数。公表されている容量表と一致する。 */
export function byteCapacity(version: number, ecc: QrEccLevel): number {
  const bits = numDataCodewords(version, ecc) * 8 - 4 - charCountBits(version);
  return Math.floor(bits / 8);
}

/** GF(256) の掛け算。原始多項式は 0x11D。 */
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** 生成多項式(次数 = 誤り訂正コード語数)の係数。 */
function rsDivisor(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** データコード語から誤り訂正コード語を出す。 */
function rsRemainder(data: readonly number[], divisor: Uint8Array): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

/** ブロックごとに誤り訂正を付け、規格どおりの順番へ組み替える。 */
function addEccAndInterleave(data: readonly number[], version: number, ecc: QrEccLevel): number[] {
  const row = ECC_ORDINAL[ecc];
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[row][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[row][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const eccWords = rsRemainder(dat, divisor);
    // 短いブロックへ詰め物を1つ足して長さをそろえる。組み替えのときに読み飛ばす。
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccWords));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

/** 位置合わせパターンの中心座標。 */
function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

class SymbolBuilder {
  readonly size: number;
  readonly modules: Uint8Array;
  private readonly isFunction: Uint8Array;

  constructor(
    readonly version: number,
    readonly ecc: QrEccLevel,
  ) {
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y * this.size + x] = dark ? 1 : 0;
  }

  private get(x: number, y: number): boolean {
    return this.modules[y * this.size + x] === 1;
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    this.set(x, y, dark);
    this.isFunction[y * this.size + x] = 1;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const pos = alignmentPatternPositions(this.version);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        // 位置検出パターンと重なる3隅は置かない。
        const corner =
          (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0);
        if (!corner) this.drawAlignment(pos[i], pos[j]);
      }
    }

    this.drawFormatBits(0);
    this.drawVersionBits();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunction(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(mask: number): void {
    const data = (ECC_FORMAT_BITS[this.ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
    this.setFunction(8, 7, getBit(bits, 6));
    this.setFunction(8, 8, getBit(bits, 7));
    this.setFunction(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, getBit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  private drawVersionBits(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, bit);
      this.setFunction(b, a, bit);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (this.isFunction[y * this.size + x] === 0 && i < data.length * 8) {
            this.set(x, y, getBit(data[i >>> 3], 7 - (i & 7)));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y * this.size + x] === 1) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: throw new Error('unreachable mask');
        }
        if (invert) this.modules[y * this.size + x] ^= 1;
      }
    }
  }

  penaltyScore(): number {
    let result = 0;
    const size = this.size;

    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (this.get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, history);
          if (!runColor) result += this.finderPenaltyCountPatterns(history) * PENALTY_N3;
          runColor = this.get(x, y);
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, history) * PENALTY_N3;
    }

    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (this.get(x, y) === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLen, history);
          if (!runColor) result += this.finderPenaltyCountPatterns(history) * PENALTY_N3;
          runColor = this.get(x, y);
          runLen = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLen, history) * PENALTY_N3;
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.get(x, y);
        if (c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) {
          result += PENALTY_N2;
        }
      }
    }

    let dark = 0;
    for (let i = 0; i < this.modules.length; i++) dark += this.modules[i];
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }

  private finderPenaltyCountPatterns(history: readonly number[]): number {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  }

  private finderPenaltyTerminateAndCount(
    currentRunColor: boolean,
    currentRunLength: number,
    history: number[],
  ): number {
    let runLen = currentRunLength;
    if (currentRunColor) {
      this.finderPenaltyAddHistory(runLen, history);
      runLen = 0;
    }
    runLen += this.size;
    this.finderPenaltyAddHistory(runLen, history);
    return this.finderPenaltyCountPatterns(history);
  }

  private finderPenaltyAddHistory(currentRunLength: number, history: number[]): void {
    let runLen = currentRunLength;
    if (history[0] === 0) runLen += this.size;
    history.pop();
    history.unshift(runLen);
  }
}

/** バイト列をデータコード語へ詰める。終端・パディングまで規格どおり。 */
function buildDataCodewords(bytes: Uint8Array, version: number, ecc: QrEccLevel): number[] {
  const capacityBits = numDataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const appendBits = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  appendBits(0b0100, 4);
  appendBits(bytes.length, charCountBits(version));
  for (const b of bytes) appendBits(b, 8);

  appendBits(0, Math.min(4, capacityBits - bits.length));
  appendBits(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

export interface QrEncodeOptions {
  /** 誤り訂正の強さ。既定は M(管理画面の見本と同じ)。 */
  readonly ecc?: QrEccLevel;
  /** 検証用にマスクを固定する。未指定なら減点法で選ぶ。 */
  readonly mask?: number;
}

/**
 * 文字列を QR シンボルへ変換する。外部通信はしない。
 *
 * @throws {QrCapacityError} 40 型番でも載らない長さのとき。
 */
export function encodeQr(text: string, options: QrEncodeOptions = {}): QrSymbol {
  const ecc = options.ecc ?? 'M';
  const bytes = new TextEncoder().encode(text);

  let version = MIN_VERSION;
  for (; ; version++) {
    if (version > MAX_VERSION) {
      throw new QrCapacityError(
        `QRに載せられる上限(${byteCapacity(MAX_VERSION, ecc)}バイト)を超えています`,
      );
    }
    if (bytes.length <= byteCapacity(version, ecc)) break;
  }

  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, ecc), version, ecc);
  const builder = new SymbolBuilder(version, ecc);
  builder.drawFunctionPatterns();
  builder.drawCodewords(codewords);

  let chosen = options.mask;
  if (chosen === undefined) {
    let minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      builder.applyMask(mask);
      builder.drawFormatBits(mask);
      const penalty = builder.penaltyScore();
      if (penalty < minPenalty) {
        chosen = mask;
        minPenalty = penalty;
      }
      builder.applyMask(mask); // 2回かけると元へ戻る
    }
  }
  const mask = chosen as number;
  builder.applyMask(mask);
  builder.drawFormatBits(mask);

  return { size: builder.size, version, ecc, mask, modules: builder.modules };
}
