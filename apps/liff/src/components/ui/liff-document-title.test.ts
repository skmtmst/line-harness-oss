import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@line/liff', () => ({ default: { closeWindow: () => {} } }));
vi.mock('../../lib/api.js', () => ({ api: { liffConfig: () => Promise.resolve({ data: null }) } }));

import { liffDocumentTitle } from './LiffHeader.js';

/**
 * タブ（LINE の上）の題は「<画面名> | musubo」（リリース前点検 2026-10-07）。
 * 以前は全画面が「予約」だった。
 */
const PAGES = fileURLToPath(new URL('../../pages', import.meta.url));

describe('LIFF のタブの題', () => {
  it('画面名 | musubo、名前が無ければ musubo', () => {
    expect(liffDocumentTitle('イベント')).toBe('イベント | musubo');
    expect(liffDocumentTitle(' ')).toBe('musubo');
  });

  it('上の帯が題を付ける', () => {
    const header = readFileSync(fileURLToPath(new URL('./LiffHeader.tsx', import.meta.url)), 'utf8');
    expect(header).toMatch(/document\.title = liffDocumentTitle\(title\)/);
  });

  it('入口の画面はどれも上の帯か liffDocumentTitle で題を付ける', () => {
    const top = readdirSync(PAGES).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
    const missing = top.filter((f) => !/LiffHeader|liffDocumentTitle/.test(readFileSync(join(PAGES, f), 'utf8')));
    expect(missing).toEqual([]);
    const html = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf8');
    expect(html).toContain('<title>musubo</title>');
  });
});
