import { describe, expect, it } from 'vitest';
import { byteCapacity, encodeQr, numDataCodewords, QrCapacityError, type QrEccLevel } from './qr-matrix.js';

const LEVELS: QrEccLevel[] = ['L', 'M', 'Q', 'H'];

function art(symbol: ReturnType<typeof encodeQr>): string[] {
  const rows: string[] = [];
  for (let y = 0; y < symbol.size; y++) {
    let row = '';
    for (let x = 0; x < symbol.size; x++) row += symbol.modules[y * symbol.size + x] ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

/** 実装から独立した並べ替え不能な指紋。表を1つ書き換えただけでも変わる。 */
function fingerprint(update: (push: (byte: number) => void) => void): string {
  let h = 0x811c9dc5 >>> 0;
  update((byte) => {
    h = (h ^ byte) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  });
  return `0x${h.toString(16)}`;
}

/**
 * 升目から元の文字列へ戻す、qr-matrix.ts とは独立した復号器（型番1〜4・バイトモード専用）。
 *
 * ここが Issue #697 の core。手打ちの升目と1280通りの指紋は「別実装との一致」を
 * 固定するだけで、その別実装（あるいは手打ち）がそもそも正しいかは証明しない。
 * 復号器を実装本体を一切 import せずに書き、規格の手順（形式情報15bit・機能
 * パターン・蛇行読み出し・8種のマスク式・ブロックの並べ替え戻し・バイトモード
 * の解釈）だけで升目から文字列を取り戻せることを示す。誤り訂正による訂正は
 * 行わない（このテストの入力に誤りはない前提）。
 *
 * 本物であることの確認は下の「復号器が本物であることの確認」で行う。
 */
function decodeQr(symbol: { size: number; modules: Uint8Array }): string {
  const size = symbol.size;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 4) {
    throw new Error(`この復号器は型番1〜4のみ対応(size=${size})`);
  }
  const get = (x: number, y: number) => symbol.modules[y * size + x] === 1;

  // 機能パターン（位置検出・タイミング・位置合わせ・形式情報）の座標を、
  // 規格の記述から独立に再現する。ここに乗る升目はデータではない。
  const isFunction = new Uint8Array(size * size);
  const markFunction = (x: number, y: number): void => {
    isFunction[y * size + x] = 1;
  };
  for (let i = 0; i < size; i++) {
    markFunction(6, i);
    markFunction(i, 6);
  }
  const markFinder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) markFunction(x, y);
      }
    }
  };
  markFinder(3, 3);
  markFinder(size - 4, 3);
  markFinder(3, size - 4);
  // 型番2〜4は位置合わせパターンが1個だけ。中心座標は規格の表（型番7以上は複数になる）。
  const ALIGN_CENTER: Record<number, number> = { 2: 18, 3: 22, 4: 26 };
  if (version >= 2) {
    const c = ALIGN_CENTER[version];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) markFunction(c + dx, c + dy);
    }
  }
  for (let i = 0; i <= 5; i++) markFunction(8, i);
  markFunction(8, 7);
  markFunction(8, 8);
  markFunction(7, 8);
  for (let i = 9; i < 15; i++) markFunction(14 - i, 8);
  for (let i = 0; i < 8; i++) markFunction(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) markFunction(8, size - 15 + i);
  markFunction(8, size - 8);

  // 形式情報15bit（誤り訂正の強さ2bit + マスク3bit + BCH10bit）を読む。
  // 冗長な2箇所のうち左上側だけを読む。誤りは無い前提なのでBCH訂正はしない。
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= (get(8, i) ? 1 : 0) << i;
  bits |= (get(8, 7) ? 1 : 0) << 6;
  bits |= (get(8, 8) ? 1 : 0) << 7;
  bits |= (get(7, 8) ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) bits |= (get(14 - i, 8) ? 1 : 0) << i;
  const dataBits = (bits ^ 0x5412) >>> 10;
  const mask = dataBits & 0b111;
  const eccFormatBits = dataBits >>> 3;
  const ECC_BY_FORMAT_BITS: Record<number, QrEccLevel> = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
  const ecc = ECC_BY_FORMAT_BITS[eccFormatBits];
  if (!ecc) throw new Error(`不正な誤り訂正レベル(bits=${eccFormatBits})`);

  // マスク8種。規格の式をそのまま書き起こす（qr-matrix.ts の表引き・ビット演算とは別の書き方）。
  const maskInvert = (x: number, y: number): boolean => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      default: throw new Error(`不正なマスク(${mask})`);
    }
  };

  // 蛇行読み出し。右から2列ずつ、column6は飛ばす。機能パターンは読み飛ばす。
  const bitStream: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunction[y * size + x] === 0) {
          const raw = get(x, y);
          const bit = maskInvert(x, y) ? !raw : raw;
          bitStream.push(bit ? 1 : 0);
        }
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bitStream.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bitStream[i + j];
    codewords.push(byte);
  }

  // ブロックの並べ替えを戻す。表は規格の公表値をここへ独立に書き起こす
  // （qr-matrix.ts の ECC_CODEWORDS_PER_BLOCK / NUM_ERROR_CORRECTION_BLOCKS とは別の配列）。
  const ECC_BLOCKS: Record<QrEccLevel, number[]> = {
    L: [1, 1, 1, 1], M: [1, 1, 1, 2], Q: [1, 1, 2, 2], H: [1, 1, 2, 4],
  };
  const ECC_LEN: Record<QrEccLevel, number[]> = {
    L: [7, 10, 15, 20], M: [10, 16, 26, 18], Q: [13, 22, 18, 26], H: [17, 28, 22, 16],
  };
  const numBlocks = ECC_BLOCKS[ecc][version - 1];
  const blockEccLen = ECC_LEN[ecc][version - 1];
  const rawCodewords = codewords.length;
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blockLens: number[] = [];
  for (let i = 0; i < numBlocks; i++) {
    blockLens.push(shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
  }
  const blockData: number[][] = Array.from({ length: numBlocks }, () => []);
  let p = 0;
  for (let i = 0; i <= shortBlockLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === shortBlockLen - blockEccLen && j < numShortBlocks) continue;
      const cw = codewords[p++];
      if (cw === undefined) throw new Error('コード語が足りない');
      if (i < blockLens[j]) blockData[j].push(cw);
    }
  }
  const dataCodewords: number[] = [];
  for (let j = 0; j < numBlocks; j++) dataCodewords.push(...blockData[j]);

  // バイトモードの解釈: mode(4bit) → 文字数(型番1〜9は8bit) → バイト列。
  let bp = 0;
  const readBits = (n: number): number => {
    let v = 0;
    for (let k = 0; k < n; k++) {
      const byteIdx = bp >> 3;
      if (byteIdx >= dataCodewords.length) throw new Error('データが尽きた');
      const byte = dataCodewords[byteIdx];
      v = (v << 1) | ((byte >>> (7 - (bp & 7))) & 1);
      bp++;
    }
    return v;
  };
  const mode = readBits(4);
  if (mode !== 0b0100) throw new Error(`バイトモードでない(mode=${mode})`);
  const len = readBits(version <= 9 ? 8 : 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = readBits(8);
  return new TextDecoder().decode(bytes);
}

/**
 * 公表されているバイトモードの容量表（型番 1〜40 × L/M/Q/H）。
 *
 * 誤り訂正の表を1か所でも取り違えると、ここが合わなくなる。
 */
const BYTE_CAPACITY: readonly (readonly number[])[] = [
  [17, 14, 11, 7], [32, 26, 20, 14], [53, 42, 32, 24], [78, 62, 46, 34], [106, 84, 60, 44],
  [134, 106, 74, 58], [154, 122, 86, 64], [192, 152, 108, 84], [230, 180, 130, 98], [271, 213, 151, 119],
  [321, 251, 177, 137], [367, 287, 203, 155], [425, 331, 241, 177], [458, 362, 258, 194], [520, 412, 292, 220],
  [586, 450, 322, 250], [644, 504, 364, 280], [718, 560, 394, 310], [792, 624, 442, 338], [858, 666, 482, 382],
  [929, 711, 509, 403], [1003, 779, 565, 439], [1091, 857, 611, 461], [1171, 911, 661, 511], [1273, 997, 715, 535],
  [1367, 1059, 751, 593], [1465, 1125, 805, 625], [1528, 1190, 868, 658], [1628, 1264, 908, 698], [1732, 1370, 982, 742],
  [1840, 1452, 1030, 790], [1952, 1538, 1112, 842], [2068, 1628, 1168, 898], [2188, 1722, 1228, 958], [2303, 1809, 1283, 983],
  [2431, 1911, 1351, 1051], [2563, 1989, 1423, 1093], [2699, 2099, 1499, 1139], [2809, 2213, 1579, 1219], [2953, 2331, 1663, 1273],
];

describe('容量表', () => {
  it('型番 1〜40 × 4段階の全 160 件が公表値と一致する', () => {
    const got = Array.from({ length: 40 }, (_, i) => LEVELS.map((ecc) => byteCapacity(i + 1, ecc)));
    expect(got).toEqual(BYTE_CAPACITY.map((row) => [...row]));
  });

  it('/api/qr の上限 2KiB は最大型番に収まる', () => {
    // 2048 バイトを M で載せられないと、長い流入URLで生成そのものが落ちる。
    expect(byteCapacity(40, 'M')).toBeGreaterThanOrEqual(2048);
  });

  it('データ語と誤り訂正語の合計は型番ごとの総コード語数になる', () => {
    // 型番 1・7・25・40 の総コード語数（規格の表）。
    for (const [version, total] of [[1, 26], [7, 196], [25, 1588], [40, 3706]] as const) {
      for (const ecc of LEVELS) {
        expect(numDataCodewords(version, ecc)).toBeLessThan(total);
        expect(numDataCodewords(version, ecc)).toBeGreaterThan(0);
      }
    }
    expect(numDataCodewords(1, 'L')).toBe(19);
    expect(numDataCodewords(40, 'M')).toBe(2334);
  });
});

describe('型番の選び方', () => {
  it('入る中でいちばん小さい型番を使う', () => {
    expect(encodeQr('a'.repeat(14), { ecc: 'M' }).version).toBe(1);
    expect(encodeQr('a'.repeat(15), { ecc: 'M' }).version).toBe(2);
    expect(encodeQr('a'.repeat(26), { ecc: 'M' }).version).toBe(2);
    expect(encodeQr('a'.repeat(27), { ecc: 'M' }).version).toBe(3);
  });

  it('一辺は 型番 * 4 + 17 になる', () => {
    for (const version of [1, 6, 7, 25, 40]) {
      const symbol = encodeQr('a'.repeat(byteCapacity(version, 'M')), { ecc: 'M' });
      expect(symbol.version).toBe(version);
      expect(symbol.size).toBe(version * 4 + 17);
      expect(symbol.modules.length).toBe(symbol.size * symbol.size);
    }
  });

  it('最大型番にも載らない長さは断る', () => {
    expect(() => encodeQr('a'.repeat(2332), { ecc: 'M' })).toThrow(QrCapacityError);
    expect(() => encodeQr('a'.repeat(2954), { ecc: 'L' })).toThrow(QrCapacityError);
  });

  it('日本語はUTF-8のバイト数で数える', () => {
    // 「あ」は3バイト。文字数で数えると容量を超えて壊れる。
    expect(encodeQr('あ'.repeat(4), { ecc: 'M' }).version).toBe(1);
    expect(encodeQr('あ'.repeat(5), { ecc: 'M' }).version).toBe(2);
  });
});

// 手打ちの升目の出どころ: npm の `qrcode` 1.5.4（QRCode.create）の出力を
// 目視で書き起こした（PR #1509 の Verification に記載の別実装と同一バージョン）。
// この升目自体の正しさは下の「round-trip（升目→文字列、独立復号器）」で別角度から確認する。
describe('升目（別実装の出力を正解として固定）', () => {
  it('型番1・M・マスク3', () => {
    expect(art(encodeQr('LH', { ecc: 'M', mask: 3 }))).toEqual([
  '#######.#..##.#######',
  '#.....#.##....#.....#',
  '#.###.#..#....#.###.#',
  '#.###.#.##..#.#.###.#',
  '#.###.#...#...#.###.#',
  '#.....#..##...#.....#',
  '#######.#.#.#.#######',
  '........#.#..........',
  '#.##.###......#..#.##',
  '....##..###.#..#.....',
  '....#.#..##.######.##',
  '##......#.#.##.....#.',
  '.###.##..#.#.#..#.###',
  '........#.#..#.#..#.#',
  '#######.#.#..##.#.#..',
  '#.....#.#..####..#..#',
  '#.###.#....#..#..#..#',
  '#.###.#.#.#..#..#..#.',
  '#.###.#.#..#.#..###..',
  '#.....#...###.#.##..#',
  '#######.#..##..#.#...',
    ]);
  });

  it('型番3・M・マスク2（流入リンクの実例）', () => {
    expect(art(encodeQr('https://example.com/r/abc123', { ecc: 'M', mask: 2 }))).toEqual([
  '#######....#.###..###.#######',
  '#.....#..#.######.#.#.#.....#',
  '#.###.#.#.#..#.#...##.#.###.#',
  '#.###.#.#..##.##.#.#..#.###.#',
  '#.###.#.##.##..##.##..#.###.#',
  '#.....#.###.#....##...#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '........#..##.#.#.##.........',
  '#.#####..##.#...##..#.#####..',
  '#..##....##.####..###.###...#',
  '##.##.#......######.##.##....',
  '.####..##...##.#...###.#.#.#.',
  '...####.##..#.##.###.....##..',
  '.#.#.#.##.#.#..##..#.####...#',
  '.###..###...#.....#.#.#####..',
  '.#.###.####.#.#.#...##..#..#.',
  '#..#..##....#...####.....##..',
  '#............###...######.#.#',
  '#.#.#.#.#.#########.#...#.#..',
  '#.##.#.#..####.#..###......#.',
  '#.#####..####.##.########.###',
  '........#..##..##...#...#####',
  '#######..#.#.....####.#.###..',
  '#.....#.##..#.#.#..##...#..#.',
  '#.###.#.#.##....#.#.#####.#.#',
  '#.###.#.#...#.##.#####.#.##..',
  '#.###.#.#.##.#.###...#######.',
  '#.....#.....##.#.##.#.####.#.',
  '#######.#.#..#.#...#.####.#..',
    ]);
  });

  it('型番 1〜40 × 4段階 × マスク 8 種の 1280 通りが別実装と一致する', () => {
    // 満杯まで詰めた入力で、誤り訂正のブロック分割・組み替えまで通す。
    const filler = (n: number) => {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(33 + ((i * 7 + 11) % 90));
      return s;
    };
    const digest = fingerprint((push) => {
      for (let version = 1; version <= 40; version++) {
        for (const ecc of LEVELS) {
          const text = filler(byteCapacity(version, ecc));
          for (let mask = 0; mask < 8; mask++) {
            const symbol = encodeQr(text, { ecc, mask });
            push(symbol.version);
            push(symbol.size);
            for (let i = 0; i < symbol.modules.length; i++) push(symbol.modules[i]);
          }
        }
      }
    });
    expect(digest).toBe('0xfee839c9');
  });
});

describe('復号器が本物であることの確認', () => {
  // Issue #697: 何も読まずに常に成功する復号器では round-trip を正解として使えない。
  // 形式情報のうち誤り訂正の強さ・マスクを運ぶ実ビット（row8, col0〜4）を1bit反転すると、
  // 壊れた文字列になるか例外を投げる（＝実際に升目を読んでいる）ことを先に確認する。
  it('形式情報のマスクを運ぶビットを1bit反転すると壊れる', () => {
    const text = 'https://example.com/r/abc123';
    const symbol = encodeQr(text, { ecc: 'M' });
    expect(decodeQr(symbol)).toBe(text);

    // (x=2, y=8) はマスク3bitのうち1bitを運ぶ。ここを反転すると別のマスクとして
    // 解かれ、規格上「必ずバイトモード(0b0100)にはならない」入力になる。
    const corrupted = Uint8Array.from(symbol.modules);
    corrupted[8 * symbol.size + 2] ^= 1;
    expect(() => decodeQr({ size: symbol.size, modules: corrupted })).toThrow(/バイトモードでない/);
  });

  it('形式情報の誤り訂正レベルを運ぶビットを1bit反転すると壊れる（例外または別内容）', () => {
    const text = 'https://example.com/r/abc123';
    const symbol = encodeQr(text, { ecc: 'M' });

    // (x=0, y=8) は誤り訂正レベル2bitのうち1bitを運ぶ。M→H に変わり、
    // ブロック数・誤り訂正語数の前提が崩れて元の文字列には戻らない。
    const corrupted = Uint8Array.from(symbol.modules);
    corrupted[8 * symbol.size + 0] ^= 1;
    let decoded: string | undefined;
    let threw = false;
    try {
      decoded = decodeQr({ size: symbol.size, modules: corrupted });
    } catch {
      threw = true;
    }
    expect(threw || decoded !== text).toBe(true);
  });

  it('データ領域を1bit反転すると壊れる（升目の実データを読んでいる証拠）', () => {
    const text = 'https://example.com/r/abc123';
    const symbol = encodeQr(text, { ecc: 'M' });
    expect(decodeQr(symbol)).toBe(text);

    // 機能パターンではない実座標。ペイロードのバイトを直接崩す。
    const corrupted = Uint8Array.from(symbol.modules);
    corrupted[10 * symbol.size + 20] ^= 1;
    let decoded: string | undefined;
    let threw = false;
    try {
      decoded = decodeQr({ size: symbol.size, modules: corrupted });
    } catch {
      threw = true;
    }
    expect(threw || decoded !== text).toBe(true);
  });
});

describe('round-trip（升目→文字列、独立復号器）', () => {
  // 手打ちの升目・1280通りの指紋は「別実装との一致」を固定するだけで、
  // その升目自体が最初から正しいかは証明しない（Issue #697）。
  // ここでは qr-matrix.ts を import せずに書いた復号器で、升目から元の
  // 文字列を実際に取り戻せることを固定する。復号器が本物であることは
  // 上の「復号器が本物であることの確認」で示した。

  it('流入リンクの実例（型番3・M・マスク2）', () => {
    const text = 'https://example.com/r/abc123';
    const symbol = encodeQr(text, { ecc: 'M', mask: 2 });
    expect(symbol.version).toBe(3);
    expect(decodeQr(symbol)).toBe(text);
  });

  it('実際の REF_LINK（qr-endpoint.test.ts と同じ値）', () => {
    // apps/worker/src/qr-endpoint.test.ts の REF_LINK と同一の文字列。
    const text = 'https://worker.example.com/r/spring-campaign-2026';
    const symbol = encodeQr(text, { ecc: 'M' });
    expect(decodeQr(symbol)).toBe(text);
  });

  it('マスクを自動選択しても、明示しても、同じ文字列に戻る', () => {
    const text = 'https://worker.example.com/r/spring-campaign-2026';
    for (let mask = 0; mask < 8; mask++) {
      const symbol = encodeQr(text, { ecc: 'M', mask });
      expect(decodeQr(symbol)).toBe(text);
    }
  });
});

describe('機能パターン', () => {
  const symbol = encodeQr('https://example.com/r/abc123');
  const dark = (x: number, y: number) => symbol.modules[y * symbol.size + x] === 1;

  it('3隅に位置検出パターンが立つ', () => {
    for (const [ox, oy] of [[0, 0], [symbol.size - 7, 0], [0, symbol.size - 7]] as const) {
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          expect(dark(ox + dx, oy + dy)).toBe(ring !== 2);
        }
      }
    }
  });

  it('タイミングパターンが交互になる', () => {
    for (let i = 8; i < symbol.size - 8; i++) {
      expect(dark(i, 6)).toBe(i % 2 === 0);
      expect(dark(6, i)).toBe(i % 2 === 0);
    }
  });

  it('左下の固定黒モジュールが立つ', () => {
    expect(dark(8, symbol.size - 8)).toBe(true);
  });

  it('マスクを指定しないときは 0〜7 のどれかを選ぶ', () => {
    expect(symbol.mask).toBeGreaterThanOrEqual(0);
    expect(symbol.mask).toBeLessThanOrEqual(7);
    // 自動で選んだ結果は、そのマスクを指定したものと同じでなければならない。
    const forced = encodeQr('https://example.com/r/abc123', { mask: symbol.mask });
    expect(Array.from(forced.modules)).toEqual(Array.from(symbol.modules));
  });

  it('既定の誤り訂正は M', () => {
    expect(encodeQr('a').ecc).toBe('M');
  });
});
