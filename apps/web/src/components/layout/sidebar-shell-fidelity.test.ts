import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * V8 殻合わせ（絵 `V8-B/JKjsE`）。統括の脇の頭と下：
 * 頭は会社のロゴ（緑の四角に頭1字）＋会社名＋小さく musubo、
 * 下は「統括の設定」と版。v7 の札・v7 の下は変えない。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'sidebar.tsx'), 'utf8');

describe('V8 統括の脇の頭と下（殻合わせ）', () => {
  it('頭はロゴ＋会社名＋musubo（v7 の札は残す）', () => {
    expect(source).toContain('統括コンソール')
    expect(source).toContain('/api/tenants/me')
    expect(source).toContain('musubo')
    expect(source).toContain('bg-accent-deep')
  })

  it('下に「統括の設定」（v7 の統括には出さない）', () => {
    expect(source).toContain('統括の設定')
    expect(source).toContain('/hq/settings')
  })
});
