import { describe, expect, it, vi } from 'vitest';
import {
  createQrImage,
  isQrDataAllowed,
  normalizeQrFormat,
  normalizeQrSize,
  qrResponseHeaders,
  QrInputError,
  QR_FORMATS,
} from './qr-response.js';

describe('qrResponseHeaders', () => {
  it('displays QR images inline by default', () => {
    expect(qrResponseHeaders('image/png', false, '')).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  it('downloads a safely named PNG when requested', () => {
    expect(qrResponseHeaders(null, true, '../A店 referral')).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="---A--referral.png"',
    });
  });

  it('拡張子は実際に返す形式に合わせる', () => {
    // svg を .png で保存させると、開けないファイルが手元に残る。
    expect(qrResponseHeaders('image/svg+xml', true, 'qr', 'svg')).toMatchObject({
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': 'attachment; filename="qr.svg"',
    });
  });
});

describe('public QR input bounds', () => {
  it('accepts normal sizes and rejects oversized work', () => {
    expect(normalizeQrSize(undefined)).toBe('240x240');
    expect(normalizeQrSize('1024x1024')).toBe('1024x1024');
    expect(normalizeQrSize('2048x2048')).toBeNull();
    expect(normalizeQrSize('wide')).toBeNull();
  });

  it('limits encoded data to 2 KiB', () => {
    expect(isQrDataAllowed('a'.repeat(2048))).toBe(true);
    expect(isQrDataAllowed('あ'.repeat(683))).toBe(false);
  });
});

describe('normalizeQrFormat', () => {
  it('画面から来る3つを通す', () => {
    expect(normalizeQrFormat('png')).toBe('png');
    expect(normalizeQrFormat('svg')).toBe('svg');
    expect(normalizeQrFormat('jpg')).toBe('jpg');
  });

  it('大文字でも受ける', () => {
    expect(normalizeQrFormat('SVG')).toBe('svg');
  });

  it('知らない値と未指定は png に落とす', () => {
    // クエリをそのまま上流へ流さないための丸め。
    expect(normalizeQrFormat('eps')).toBe('png');
    expect(normalizeQrFormat('../../etc/passwd')).toBe('png');
    expect(normalizeQrFormat(undefined)).toBe('png');
  });
});

describe('createQrImage', () => {
  it('形式ごとの Content-Type と中身の印が合う', async () => {
    const link = 'https://worker.example.com/r/abc123';
    const png = await createQrImage(link, '240x240', 'png');
    expect(png.contentType).toBe('image/png');
    expect(Array.from(png.bytes.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);

    const svg = await createQrImage(link, '240x240', 'svg');
    expect(svg.contentType).toBe('image/svg+xml');
    expect(new TextDecoder().decode(svg.bytes)).toContain('width="240" height="240"');

    const jpg = await createQrImage(link, '240x240', 'jpg');
    expect(jpg.contentType).toBe('image/jpeg');
    expect(Array.from(jpg.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('第三者へ通信しない', async () => {
    // 流入 ref は計測の識別子で、外の生成サービスへ渡す理由がない。
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('外部へ通信してはいけない');
    });
    try {
      for (const format of QR_FORMATS) {
        await createQrImage('https://worker.example.com/r/secret-ref', '320x320', format);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('指定の大きさに収まらないときは QrInputError', async () => {
    await expect(createQrImage('x'.repeat(2048), '64x64', 'png')).rejects.toBeInstanceOf(QrInputError);
  });

  it('縦横が違う指定でも、その大きさの画像を返す', async () => {
    const svg = await createQrImage('https://worker.example.com/r/abc123', '300x200', 'svg');
    expect(new TextDecoder().decode(svg.bytes)).toContain('width="300" height="200"');
  });
});
