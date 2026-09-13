import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const app = readFileSync(join(root, 'App.tsx'), 'utf8');
const page = readFileSync(join(import.meta.dirname, 'EventWaitlistOffer.tsx'), 'utf8');
const api = readFileSync(join(root, 'lib/api.ts'), 'utf8');

describe('キャンセル待ちの繰上げ承諾導線', () => {
  it('LINE案内のquery tokenを承諾画面へ渡し、公開LIFF APIへ送る', () => {
    expect(app).toContain("search.get('eventWaitlistToken')");
    expect(app).toContain('<EventWaitlistOffer token={waitlistToken} />');
    expect(page).toContain('api.acceptEventWaitlistOffer(token)');
    expect(api).toContain('/api/liff/events/waitlist/${encodeURIComponent(token)}/accept');
  });

  it('成功・期限切れ・利用不能を別の案内として表示する', () => {
    expect(page).toContain("status === 410");
    expect(page).toContain("status === 404 || status === 409");
    expect(page).toContain('予約が確定しました');
    expect(page).toContain('回答期限を過ぎています');
  });
});
