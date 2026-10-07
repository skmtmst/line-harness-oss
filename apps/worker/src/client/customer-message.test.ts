import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { customerMessage } from './customer-message.js';

describe('お客さまに見せる失敗の文', () => {
  it('サーバーの日本語の案内はそのまま出す', () => {
    expect(customerMessage(new Error('この時間は埋まりました'), '予約に失敗しました')).toBe('この時間は埋まりました');
  });

  it('英語の内部の文・番号は日本語の案内に置き換える', () => {
    for (const raw of ['Failed to fetch', 'API error: 500', 'TypeError: x is undefined', 'HTTP 502', 'Load failed']) {
      expect(customerMessage(new Error(raw), '予約に失敗しました')).toBe('予約に失敗しました');
    }
    expect(customerMessage(undefined, '送信に失敗しました')).toBe('送信に失敗しました');
  });

  it('お客さまの画面は err.message をそのまま出さない', () => {
    for (const f of ['booking.ts', 'form.ts', 'main.ts']) {
      const src = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8');
      expect(src, f).not.toMatch(/err instanceof Error \? err\.message/);
    }
  });
});

describe('共用の配り先（api.musubo.jp）に特定の会社・旧製品の名前を出さない', () => {
  it('タブの題は特定の店の名前ではなく、ボタンに旧製品名を出さない', () => {
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
    expect(html).not.toContain('然-NEN-');
    expect(html).toContain('<title>musubo</title>');
    expect(html).toContain('rel="icon"');
    expect(html).not.toContain('user-scalable=no');
    const form = readFileSync(fileURLToPath(new URL('./form.ts', import.meta.url)), 'utf8');
    expect(form).not.toMatch(/X Harness を受け取る/);
  });
});
