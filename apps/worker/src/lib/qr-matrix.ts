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

/** (a * b) % 3 の表。a, b は 0〜2。マスク 5〜7 で使う。 */
const MOD3_PRODUCT = Uint8Array.from([0, 0, 0, 0, 1, 2, 0, 2, 1]);

const MIN_VERSION = 1;
const MAX_VERSION = 40;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * 直近 7 本の連続の長さ。
 *
 * 配列の pop/unshift で回すと、減点法だけで QR 1 枚あたり数ミリ秒かかる。
 * 公開口は 1 要求あたりの CPU 枠が厳しいので、7 個の数値として持つ。
 */
class RunHistory {
  private h0 = 0;
  private h1 = 0;
  private h2 = 0;
  private h3 = 0;
  private h4 = 0;
  private h5 = 0;
  private h6 = 0;

  reset(): void {
    this.h0 = 0;
    this.h1 = 0;
    this.h2 = 0;
    this.h3 = 0;
    this.h4 = 0;
    this.h5 = 0;
    this.h6 = 0;
  }

  add(runLength: number, size: number): void {
    // 最初の 1 本は、外側の白い余白と地続きとして数える。
    const length = this.h0 === 0 ? runLength + size : runLength;
    this.h6 = this.h5;
    this.h5 = this.h4;
    this.h4 = this.h3;
    this.h3 = this.h2;
    this.h2 = this.h1;
    this.h1 = this.h0;
    this.h0 = length;
  }

  /** 1:1:3:1:1 の位置検出もどきが何個あるか。 */
  countFinderPatterns(): number {
    const n = this.h1;
    const core = n > 0 && this.h2 === n && this.h3 === n * 3 && this.h4 === n && this.h5 === n;
    if (!core) return 0;
    return (this.h0 >= n * 4 && this.h6 >= n ? 1 : 0) + (this.h6 >= n * 4 && this.h0 >= n ? 1 : 0);
  }

  terminate(runColor: number, runLength: number, size: number): number {
    let length = runLength;
    if (runColor === 1) {
      this.add(length, size);
      length = 0;
    }
    this.add(length + size, size);
    return this.countFinderPatterns();
  }
}

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
  /** マスクの採点用の作業盤。本盤へ 8 回塗って戻すより 1 回書き写す方が速い。 */
  private readonly scratch: Uint8Array;
  /** 座標を 3 で割った余りと商。マスク条件の除算を無くすために先に作る。 */
  private readonly mod3: Uint8Array;
  private readonly div3: Int32Array;

  constructor(
    readonly version: number,
    readonly ecc: QrEccLevel,
  ) {
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
    this.scratch = new Uint8Array(this.size * this.size);
    this.mod3 = new Uint8Array(this.size);
    this.div3 = new Int32Array(this.size);
    for (let i = 0; i < this.size; i++) {
      this.mod3[i] = i % 3;
      this.div3[i] = (i / 3) | 0;
    }
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

  /** 形式情報が載る 31 個の位置と値を順に渡す。書き込み先で使い分ける。 */
  private formatCells(mask: number, write: (x: number, y: number, dark: boolean) => void): void {
    const data = (ECC_FORMAT_BITS[this.ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) write(8, i, getBit(bits, i));
    write(8, 7, getBit(bits, 6));
    write(8, 8, getBit(bits, 7));
    write(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) write(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) write(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) write(8, this.size - 15 + i, getBit(bits, i));
    write(8, this.size - 8, true);
  }

  drawFormatBits(mask: number): void {
    this.formatCells(mask, (x, y, dark) => this.setFunction(x, y, dark));
  }

  /**
   * マスク 1 通りぶんの減点を出す。
   *
   * 本盤へ塗って採点して塗り直すと、升目を 2 回なぞることになる。
   * 作業盤へ 1 回書き写すだけにして、8 通りで 8 回に収める。
   */
  /**
   * マスク 1 通りぶんの減点を出す。
   *
   * 4 つの規則を別々に回すと升目を 5 周することになる。公開口は 1 要求
   * あたりの CPU 枠が厳しいので、横方向の周回に「塗り・横の並び・2x2・
   * 黒の割合」をまとめ、縦の並びだけ 2 周目にする。
   */
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
    const { size, modules, isFunction, mod3, div3 } = this;
    if (mask < 0 || mask > 7) throw new Error('unreachable mask');
    for (let y = 0; y < size; y++) {
      const rowBase = y * size;
      for (let x = 0; x < size; x++) {
        const index = rowBase + x;
        if (isFunction[index] === 1) continue;
        // 剰余と商は表から引く。ここは升目数だけ回るので、除算が効く。
        const productMod3 = MOD3_PRODUCT[mod3[x] * 3 + mod3[y]];
        const sumMod3 = mod3[x] + mod3[y];
        let invert: boolean;
        switch (mask) {
          case 0: invert = ((x + y) & 1) === 0; break;
          case 1: invert = (y & 1) === 0; break;
          case 2: invert = mod3[x] === 0; break;
          case 3: invert = sumMod3 === 0 || sumMod3 === 3; break;
          case 4: invert = ((div3[x] + (y >> 1)) & 1) === 0; break;
          case 5: invert = (x & y & 1) + productMod3 === 0; break;
          case 6: invert = (((x & y & 1) + productMod3) & 1) === 0; break;
          default: invert = ((((x + y) & 1) + productMod3) & 1) === 0; break;
        }
        if (invert) modules[index] ^= 1;
      }
    }
  }

  scoreMask(mask: number, best: number): number {
    const { size, modules, isFunction, scratch, mod3, div3 } = this;
    // 形式情報は機能部品なのでマスクをかけないが、並びの数え方には効く。
    // 本盤へ先に置いてから塗る。最後に選んだマスクの分で上書きされる。
    this.drawFormatBits(mask);
    const history = new RunHistory();
    let result = 0;
    let dark = 0;

    for (let y = 0; y < size; y++) {
      const rowBase = y * size;
      const previousBase = rowBase - size;
      history.reset();
      let runColor = 0;
      let runLen = 0;
      for (let x = 0; x < size; x++) {
        const index = rowBase + x;
        let color: number;
        if (isFunction[index] === 1) {
          color = modules[index];
        } else {
          const productMod3 = MOD3_PRODUCT[mod3[x] * 3 + mod3[y]];
          const sumMod3 = mod3[x] + mod3[y];
          let invert: boolean;
          switch (mask) {
            case 0: invert = ((x + y) & 1) === 0; break;
            case 1: invert = (y & 1) === 0; break;
            case 2: invert = mod3[x] === 0; break;
            case 3: invert = sumMod3 === 0 || sumMod3 === 3; break;
            case 4: invert = ((div3[x] + (y >> 1)) & 1) === 0; break;
            case 5: invert = (x & y & 1) + productMod3 === 0; break;
            case 6: invert = (((x & y & 1) + productMod3) & 1) === 0; break;
            default: invert = ((((x + y) & 1) + productMod3) & 1) === 0; break;
          }
          color = invert ? modules[index] ^ 1 : modules[index];
        }
        scratch[index] = color;
        dark += color;

        // 同じ色が 2x2 で固まっている数。1 つ上の行はもう塗り終わっている。
        if (y > 0 && x > 0) {
          const upper = scratch[previousBase + x];
          if (color === upper && color === scratch[index - 1] && color === scratch[previousBase + x - 1]) {
            result += PENALTY_N2;
          }
        }

        if (color === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          history.add(runLen, size);
          if (runColor === 0) result += history.countFinderPatterns() * PENALTY_N3;
          runColor = color;
          runLen = 1;
        }
      }
      result += history.terminate(runColor, runLen, size) * PENALTY_N3;
      // 減点は足すだけなので、ここで最良を超えたらこのマスクは選ばれない。
      // 途中で止めても、選ぶマスクは変わらない。
      if (result > best) return result;
    }

    for (let x = 0; x < size; x++) {
      history.reset();
      let runColor = 0;
      let runLen = 0;
      for (let y = 0; y < size; y++) {
        const color = scratch[y * size + x];
        if (color === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          history.add(runLen, size);
          if (runColor === 0) result += history.countFinderPatterns() * PENALTY_N3;
          runColor = color;
          runLen = 1;
        }
      }
      result += history.terminate(runColor, runLen, size) * PENALTY_N3;
      if (result > best) return result;
    }

    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
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
      const penalty = builder.scoreMask(mask, minPenalty);
      if (penalty < minPenalty) {
        chosen = mask;
        minPenalty = penalty;
      }
    }
  }
  const mask = chosen as number;
  builder.applyMask(mask);
  builder.drawFormatBits(mask);

  return { size: builder.size, version, ecc, mask, modules: builder.modules };
}
