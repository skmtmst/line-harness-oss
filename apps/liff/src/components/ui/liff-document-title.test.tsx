// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@line/liff', () => ({ default: { closeWindow: () => {} } }));
vi.mock('../../lib/api.js', () => ({ api: { liffConfig: () => Promise.resolve({ data: null }) } }));

import { cleanup, render } from '@testing-library/react';
import LiffHeader, { liffDocumentTitle } from './liff-header.js';

/**
 * タブ（LINE の上）の題は「<画面名> | musubo」（リリース前点検 2026-10-07）。
 * 以前は全画面が「予約」だった。
 */
const PAGES = join(import.meta.dirname, '../../pages');

afterEach(cleanup);

describe('LIFF のタブの題', () => {
  it('画面名 | musubo、名前が無ければ musubo', () => {
    expect(liffDocumentTitle('イベント')).toBe('イベント | musubo');
    expect(liffDocumentTitle(' ')).toBe('musubo');
  });

  it('上の帯が題を付ける', () => {
    const view = render(<LiffHeader title="イベント" />);
    expect(document.title).toBe('イベント | musubo');
    view.rerender(<LiffHeader title="予約" />);
    expect(document.title).toBe('予約 | musubo');
    view.rerender(<LiffHeader title=" " />);
    expect(document.title).toBe('musubo');
  });

  it('入口の画面はどれも上の帯か liffDocumentTitle で題を付ける', () => {
    const top = readdirSync(PAGES).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));
    const missing = top.filter((f) => !/LiffHeader|liffDocumentTitle/.test(readFileSync(join(PAGES, f), 'utf8')));
    expect(missing).toEqual([]);
  });
});
