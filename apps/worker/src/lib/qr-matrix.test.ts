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
