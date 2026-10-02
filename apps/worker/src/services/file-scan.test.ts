import { describe, expect, it } from 'vitest';
import { builtinFileScan } from './file-scan.js';

function png(extra = false): Uint8Array {
  const head = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ];
  const iend = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const tail = extra ? [0xde, 0xad, 0xbe, 0xef] : [];
  return Uint8Array.from([...head, ...iend, ...tail]);
}

function jpeg(extra = false): Uint8Array {
  const body = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9];
  return Uint8Array.from(extra ? [...body, 0x00, 0x01] : body);
}

function pdfWithJs(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<</JavaScript (alert)>>\n');
}

function mzDisguised(): Uint8Array {
  return Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
}

function oleWithMacro(): Uint8Array {
  const head = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const text = new TextEncoder().encode('vbaProject.bin');
  const out = new Uint8Array(head.length + text.length);
  out.set(head, 0);
  out.set(text, head.length);
  return out;
}

describe('builtinFileScan', () => {
  it('正常な画像は使えますになる', () => {
    const result = builtinFileScan(png(), {
      filename: 'photo.png', mimeType: 'image/png', sizeBytes: 100, width: 1, height: 1,
    });
    expect(result).toEqual({ verdict: 'clean' });
  });

  it('拡張子と中身が違えば使えませんになる', () => {
    const result = builtinFileScan(png(), {
      filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, width: 1, height: 1,
    });
    expect(result.verdict).toBe('rejected');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('signature_mismatch');
  });

  it('画像の後ろの余計なデータはしまう', () => {
    for (const [bytes, mime, name] of [
      [png(true), 'image/png', 'a.png'],
      [jpeg(true), 'image/jpeg', 'a.jpg'],
    ] as const) {
      const result = builtinFileScan(bytes, {
        filename: name, mimeType: mime, sizeBytes: bytes.length, width: 1, height: 1,
      });
      expect(result.verdict).toBe('quarantined');
      if (result.verdict !== 'clean') expect(result.reasonCode).toBe('trailing_data');
    }
  });

  it('PDF の JavaScript はしまう', () => {
    const bytes = pdfWithJs();
    const result = builtinFileScan(bytes, {
      filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length,
    });
    expect(result.verdict).toBe('quarantined');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('pdf_active_content');
  });

  it('実行ファイルの印はしまう', () => {
    const bytes = mzDisguised();
    const result = builtinFileScan(bytes, {
      filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, width: 1, height: 1,
    });
    expect(result.verdict).toBe('quarantined');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('executable_signature');
  });

  it('Office のマクロはしまう', () => {
    const bytes = oleWithMacro();
    const result = builtinFileScan(bytes, {
      filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length,
    });
    expect(result.verdict).toBe('quarantined');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('office_macro');
  });

  it('寸法が読めない画像は使えませんになる', () => {
    const bytes = png();
    const result = builtinFileScan(bytes, {
      filename: 'a.png', mimeType: 'image/png', sizeBytes: bytes.length,
    });
    expect(result.verdict).toBe('rejected');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('unreadable');
  });

  it('大きすぎるファイルは使えませんになる', () => {
    const bytes = png();
    const result = builtinFileScan(bytes, {
      filename: 'a.png', mimeType: 'image/png', sizeBytes: 11 * 1024 * 1024, width: 1, height: 1,
    });
    expect(result.verdict).toBe('rejected');
    if (result.verdict !== 'clean') expect(result.reasonCode).toBe('too_large');
  });
});
