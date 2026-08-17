import { describe, expect, it } from 'vitest';
import { qrResponseHeaders, normalizeQrFormat } from './qr-response.js';

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
