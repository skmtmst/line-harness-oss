import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivacyNote, { MUSUBO_PRIVACY_URL, privacyPolicyUrl } from './PrivacyNote.js';

/** 送る画面のプライバシーポリシーの一行（2026-10-07 オーナー決定）。 */
describe('プライバシーポリシーの一行', () => {
  it('基本は musubo のポリシー、お店の https の URL があればそちらを優先', () => {
    expect(privacyPolicyUrl()).toBe('https://musubo.jp/privacy/');
    expect(privacyPolicyUrl('https://shop.example/privacy')).toBe('https://shop.example/privacy');
    expect(privacyPolicyUrl('javascript:alert(1)')).toBe(MUSUBO_PRIVACY_URL);
    const html = renderToStaticMarkup(<PrivacyNote />);
    expect(html).toContain(`href="${MUSUBO_PRIVACY_URL}"`);
    expect(html).toContain('min-h-11');
  });

  it('予約・イベントの申し込み・フォーム・席の予約の送る画面に置いてある', () => {
    for (const f of ['../Confirm.tsx', '../../pages/EventConfirm.tsx', '../../pages/Form.tsx', '../../pages/seat/SeatConfirm.tsx']) {
      expect(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'), f).toContain('<PrivacyNote');
    }
  });
});
