import { describe, expect, it } from 'vitest';
import { encodeQr, type QrSymbol } from './qr-matrix.js';
import {
  layoutQr,
  QR_QUIET_ZONE,
  QrRenderError,
  renderQrJpeg,
  renderQrPng,
  renderQrSvg,
  storedZlibDeflate,
} from './qr-image.js';

const LINK = 'https://example.com/r/abc123';

/** 画像に出るはずの白黒を、升目から直に組み立てる。 */
function expectedPixels(symbol: QrSymbol, width: number, height: number): Uint8Array {
  const layout = layoutQr(symbol, width, height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = Math.floor((x - layout.offsetX) / layout.scale) - QR_QUIET_ZONE;
      const cy = Math.floor((y - layout.offsetY) / layout.scale) - QR_QUIET_ZONE;
      const inside =
        x >= layout.offsetX && y >= layout.offsetY && cx >= 0 && cy >= 0 && cx < symbol.size && cy < symbol.size;
      out[y * width + x] = inside && symbol.modules[cy * symbol.size + cx] === 1 ? 1 : 0;
    }
  }
  return out;
}

describe('大きさの割り当て', () => {
  it('余白 4 モジュールを入れて中央へ置く', () => {
    const symbol = encodeQr(LINK); // 型番3 = 29 モジュール
    const layout = layoutQr(symbol, 240, 240);
    expect(layout.cells).toBe(symbol.size + 8);
    expect(layout.scale).toBe(Math.floor(240 / (symbol.size + 8)));
    expect(layout.offsetX).toBe(Math.floor((240 - layout.cells * layout.scale) / 2));
    expect(layout.offsetY).toBe(layout.offsetX);
  });

  it('縦横が違っても短い辺に合わせる', () => {
    const symbol = encodeQr(LINK);
    const layout = layoutQr(symbol, 300, 200);
    expect(layout.scale).toBe(Math.floor(200 / layout.cells));
    expect(layout.offsetX).toBeGreaterThan(layout.offsetY);
  });

  it('1 モジュール 1 画素も取れない指定は断る', () => {
    // 縮めて描くと目には出るが読み取れない。印刷してから気づくので先に断る。
    const big = encodeQr('x'.repeat(2048));
    expect(() => layoutQr(big, 64, 64)).toThrow(QrRenderError);
    expect(() => layoutQr(big, 64, 64)).toThrow(/64x64/);
  });
});

/* ------------------------------------------------------------------ PNG */

function parsePngChunks(png: Uint8Array): { type: string; body: Uint8Array }[] {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; body: Uint8Array }[] = [];
  let p = 8;
  while (p < png.length) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    chunks.push({ type, body: png.subarray(p + 8, p + 8 + length) });
    p += 12 + length;
  }
  expect(p).toBe(png.length);
  return chunks;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

async function decodePng(png: Uint8Array): Promise<{ width: number; height: number; dark: Uint8Array }> {
  const chunks = parsePngChunks(png);
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0].body.buffer, chunks[0].body.byteOffset, chunks[0].body.byteLength);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  expect(chunks[0].body[8]).toBe(1); // 1 ビット
  expect(chunks[0].body[9]).toBe(0); // 灰色
  expect(chunks[0].body[12]).toBe(0); // 非インターレース

  const raw = await inflate(chunks[1].body);
  const rowBytes = Math.ceil(width / 8);
  expect(raw.length).toBe((rowBytes + 1) * height);
  const dark = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    expect(raw[base]).toBe(0); // フィルタなし
    for (let x = 0; x < width; x++) {
      const bit = (raw[base + 1 + (x >>> 3)] >>> (7 - (x & 7))) & 1;
      dark[y * width + x] = bit === 0 ? 1 : 0;
    }
  }
  return { width, height, dark };
}

describe('PNG', () => {
  it('升目と1画素も違わない絵になる', async () => {
    for (const [text, w, h] of [
      [LINK, 240, 240],
      ['https://liff.line.me/1657412345-AbCdEfGh?ref=xyz&pool=main', 600, 600],
      ['あいうえお漢字テストref=日本語', 300, 300],
      [LINK, 300, 200],
      ['x'.repeat(2048), 1024, 1024],
    ] as const) {
      const symbol = encodeQr(text);
      const decoded = await decodePng(await renderQrPng(symbol, w, h));
      expect([decoded.width, decoded.height]).toEqual([w, h]);
      expect(Array.from(decoded.dark)).toEqual(Array.from(expectedPixels(symbol, w, h)));
    }
  });

  it('外周は白で残る（余白がないと読み取れない）', async () => {
    const decoded = await decodePng(await renderQrPng(encodeQr(LINK), 240, 240));
    for (let i = 0; i < 240; i++) {
      expect(decoded.dark[i]).toBe(0);
      expect(decoded.dark[239 * 240 + i]).toBe(0);
      expect(decoded.dark[i * 240]).toBe(0);
      expect(decoded.dark[i * 240 + 239]).toBe(0);
    }
  });

  it('CompressionStream が無い環境でも同じ絵を返す', async () => {
    const holder = globalThis as { CompressionStream?: unknown };
    const saved = holder.CompressionStream;
    holder.CompressionStream = undefined;
    try {
      const symbol = encodeQr(LINK);
      const decoded = await decodePng(await renderQrPng(symbol, 240, 240));
      expect(Array.from(decoded.dark)).toEqual(Array.from(expectedPixels(symbol, 240, 240)));
    } finally {
      holder.CompressionStream = saved;
    }
  });

  it('圧縮なし deflate も zlib として読める', async () => {
    const raw = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251);
    expect(Array.from(await inflate(storedZlibDeflate(raw)))).toEqual(Array.from(raw));
  });

  it('最大サイズでも 2MiB に収まる', async () => {
    const png = await renderQrPng(encodeQr('x'.repeat(2048)), 1024, 1024);
    expect(png.byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});

/* ------------------------------------------------------------------ SVG */

/** 出力の path を読み直して升目へ戻す。 */
function decodeSvg(svg: string, width: number, height: number): Uint8Array {
  const dark = new Uint8Array(width * height);
  const path = /<path fill="#000000" d="([^"]*)"\/>/.exec(svg);
  expect(path).not.toBeNull();
  const runs = (path as RegExpExecArray)[1].matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\3z/g);
  for (const [, x, y, w, h] of runs) {
    for (let dy = 0; dy < Number(h); dy++) {
      for (let dx = 0; dx < Number(w); dx++) {
        dark[(Number(y) + dy) * width + Number(x) + dx] = 1;
      }
    }
  }
  return dark;
}

describe('SVG', () => {
  it('升目どおりの矩形だけを描く', () => {
    for (const [text, w, h] of [
      [LINK, 240, 240],
      ['あいうえお漢字テストref=日本語', 300, 300],
      [LINK, 300, 200],
    ] as const) {
      const symbol = encodeQr(text);
      const svg = renderQrSvg(symbol, w, h);
      expect(svg).toContain(`width="${w}" height="${h}"`);
      expect(Array.from(decodeSvg(svg, w, h))).toEqual(Array.from(expectedPixels(symbol, w, h)));
    }
  });

  it('外部を参照しない（QRの中身も画像も外へ出さない）', () => {
    const svg = renderQrSvg(encodeQr(LINK), 240, 240);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(svg).not.toMatch(/<image|xlink:href|<script|<foreignObject/);
  });
});

/* ----------------------------------------------------------------- JPEG */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14,
  21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53,
  60, 61, 54, 47, 55, 62, 63,
];

/**
 * 出している範囲だけを読む JPEG 復号器。
 *
 * ベースライン・白黒1成分・間引きなし・リスタートなし。汎用ではなく、
 * この符号器が本当に読める絵を書いたかを確かめるためのもの。
 */
function decodeGrayJpeg(jpeg: Uint8Array): { width: number; height: number; dark: Uint8Array } {
  let p = 0;
  const u16 = () => {
    const v = (jpeg[p] << 8) | jpeg[p + 1];
    p += 2;
    return v;
  };
  expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  p = 2;

  let quant: number[] = [];
  let width = 0;
  let height = 0;
  const huff = new Map<number, Map<string, number>>();
  let scanStart = -1;

  while (p < jpeg.length) {
    expect(jpeg[p]).toBe(0xff);
    const marker = jpeg[p + 1];
    p += 2;
    if (marker === 0xd9) break;
    const length = u16();
    const end = p + length - 2;
    if (marker === 0xdb) {
      expect(jpeg[p]).toBe(0x00);
      quant = Array.from(jpeg.subarray(p + 1, p + 65));
    } else if (marker === 0xc0) {
      expect(jpeg[p]).toBe(8);
      height = (jpeg[p + 1] << 8) | jpeg[p + 2];
      width = (jpeg[p + 3] << 8) | jpeg[p + 4];
      expect(jpeg[p + 5]).toBe(1); // 成分は輝度だけ
      expect(jpeg[p + 7]).toBe(0x11); // 間引きなし
    } else if (marker === 0xc4) {
      const id = jpeg[p];
      const bits = Array.from(jpeg.subarray(p + 1, p + 17));
      const values = Array.from(jpeg.subarray(p + 17, end));
      const table = new Map<string, number>();
      let code = 0;
      let k = 0;
      for (let len = 1; len <= 16; len++) {
        for (let i = 0; i < bits[len - 1]; i++) table.set(`${len}:${code++}`, values[k++]);
        code <<= 1;
      }
      expect(k).toBe(values.length);
      huff.set(id, table);
    } else if (marker === 0xda) {
      expect(jpeg[p]).toBe(1);
      expect(jpeg[p + 2]).toBe(0x00); // DC 表 0 / AC 表 0
      scanStart = end;
      break;
    }
    p = end;
  }
  expect(scanStart).toBeGreaterThan(0);
  expect(width * height).toBeGreaterThan(0);

  // 走査データを取り出す。0xFF00 の詰め物を戻す。
  const scan: number[] = [];
  for (let i = scanStart; i < jpeg.length - 1; i++) {
    if (jpeg[i] !== 0xff) {
      scan.push(jpeg[i]);
      continue;
    }
    // 印は EOI だけのはず。それ以外の 0xFF は詰め物付きでなければならない。
    if (jpeg[i + 1] === 0x00) {
      scan.push(0xff);
      i++;
      continue;
    }
    expect(jpeg[i + 1]).toBe(0xd9);
    break;
  }

  let bitPos = 0;
  const nextBit = () => {
    const byte = scan[bitPos >>> 3];
    const bit = (byte >>> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return bit;
  };
  const decodeHuff = (id: number) => {
    const table = huff.get(id) as Map<string, number>;
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | nextBit();
      const v = table.get(`${len}:${code}`);
      if (v !== undefined) return v;
    }
    throw new Error('JPEGの符号が表に無い');
  };
  const receive = (length: number) => {
    let v = 0;
    for (let i = 0; i < length; i++) v = (v << 1) | nextBit();
    return v;
  };
  const extend = (v: number, length: number) => (length === 0 ? 0 : v < 1 << (length - 1) ? v - (1 << length) + 1 : v);

  const cosine = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) {
      cosine[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }

  const dark = new Uint8Array(width * height);
  const coefficients = new Float64Array(64);
  let previousDc = 0;
  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      coefficients.fill(0);
      const dcLength = decodeHuff(0x00);
      previousDc += extend(receive(dcLength), dcLength);
      coefficients[0] = previousDc * quant[0];
      for (let k = 1; k < 64; ) {
        const rs = decodeHuff(0x10);
        const run = rs >> 4;
        const sizeBits = rs & 15;
        if (sizeBits === 0) {
          if (run !== 15) break; // EOB
          k += 16;
          continue;
        }
        k += run;
        coefficients[ZIGZAG[k]] = extend(receive(sizeBits), sizeBits) * quant[k];
        k++;
      }
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let sum = 0;
          for (let v = 0; v < 8; v++) {
            for (let u = 0; u < 8; u++) {
              sum += coefficients[v * 8 + u] * cosine[u * 8 + x] * cosine[v * 8 + y];
            }
          }
          const value = sum * 0.25 + 128;
          const px = blockX + x;
          const py = blockY + y;
          if (px < width && py < height) dark[py * width + px] = value < 128 ? 1 : 0;
        }
      }
    }
  }
  return { width, height, dark };
}

describe('JPEG', () => {
  it('印と大きさが規格どおりに並ぶ', () => {
    const jpeg = renderQrJpeg(encodeQr(LINK), 240, 240);
    expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]); // SOI
    expect([jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd9]); // EOI
    expect(String.fromCharCode(...jpeg.subarray(6, 10))).toBe('JFIF');
  });

  it('復号すると升目どおりの白黒に戻る', () => {
    for (const [text, w, h] of [
      [LINK, 240, 240],
      ['あいうえお漢字テストref=日本語', 300, 300],
      [LINK, 300, 200],
      ['https://line.me/R/ti/p/@nen', 64, 64],
    ] as const) {
      const symbol = encodeQr(text);
      const decoded = decodeGrayJpeg(renderQrJpeg(symbol, w, h));
      expect([decoded.width, decoded.height]).toEqual([w, h]);
      const want = expectedPixels(symbol, w, h);
      let diff = 0;
      for (let i = 0; i < want.length; i++) if (want[i] !== decoded.dark[i]) diff++;
      // 非可逆形式なので画素単位で完全一致は求めないが、白黒に戻せば同じになる。
      expect(diff).toBe(0);
    }
  });

  it('最大サイズでも 2MiB に収まる', () => {
    expect(renderQrJpeg(encodeQr('x'.repeat(2048)), 1024, 1024).byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});
