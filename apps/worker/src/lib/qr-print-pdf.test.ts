import { describe, expect, it } from 'vitest';
import { encodeQr } from './qr-matrix.js';
import { buildQrPrintPdf, QrPdfError, utf16beHex } from './qr-print-pdf.js';

function latin1(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => String.fromCharCode(byte)).join('');
}

describe('qr-print-pdf 印刷用PDF', () => {
  it('A4・1枚・相互参照が壊れていない', () => {
    const qr = encodeQr('https://example.com/r/summer');
    const pdf = buildQrPrintPdf({
      accountName: '然-NEN- 公式',
      url: 'https://example.com/r/summer',
      issuedAt: '2026-09-27 15:00',
      qr,
    });
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text).toContain('/Count 1');
    expect(text).toContain('(https://example.com/r/summer)');

    // 相互参照の番地が各オブジェクトの先頭を指している。
    const xrefAt = text.indexOf('xref\n');
    const trailerAt = text.indexOf('trailer\n');
    const entries = text.slice(xrefAt, trailerAt).trim().split('\n').slice(2);
    // 空き番地1行 + オブジェクト6件。
    expect(entries).toHaveLength(7);
    expect(entries[0].startsWith('0000000000')).toBe(true);
    entries.slice(1).forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.startsWith(`${index + 1} 0 obj`, offset)).toBe(true);
    });
  });

  it('QR の黒い升目の数だけ四角を描く', () => {
    const qr = encodeQr('https://example.com/r/summer');
    const pdf = buildQrPrintPdf({
      accountName: 'test', url: 'https://example.com/r/summer', issuedAt: '2026-09-27', qr,
    });
    const text = latin1(pdf);
    const darkModules = qr.modules.reduce((sum, value) => sum + (value === 1 ? 1 : 0), 0);
    const rects = text.match(/ re f/g)?.length ?? 0;
    expect(rects).toBe(darkModules);
  });

  it('店名は文書情報に残る(本文のフォント資産が無いため)', () => {
    const qr = encodeQr('https://example.com/r/summer');
    const pdf = buildQrPrintPdf({
      accountName: '然-NEN- 公式',
      url: 'https://example.com/r/summer',
      issuedAt: '2026-09-27',
      qr,
    });
    const text = latin1(pdf);
    expect(text).toContain(`<${utf16beHex('然-NEN- 公式 友だち追加QRコード')}>`);
  });

  it('URL に書けない文字があれば断る', () => {
    const qr = encodeQr('https://example.com/r/summer');
    expect(() => buildQrPrintPdf({
      accountName: 'test', url: 'https://example.com/友だち', issuedAt: '2026-09-27', qr,
    })).toThrow(QrPdfError);
  });
});
