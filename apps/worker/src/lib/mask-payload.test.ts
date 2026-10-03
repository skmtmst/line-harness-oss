import { describe, expect, it } from 'vitest';
import { maskInteractionPayload } from './mask-payload.js';

/*
 * F-18: やり取りの本文を伏せて返す。伏せ方は `mask-payload.ts` の頭に書いた。
 * ここでは「伏せるものは伏せ、伏せないものは残す」と「元を変えない」を見る。
 */
describe('maskInteractionPayload', () => {
  it('名前・電話・メール・住所・トークンを伏せる', () => {
    const raw = JSON.stringify({
      name: '田中明',
      phone: '090-1234-5678',
      email: 'tanaka@example.com',
      address: '東京都港区1-2-3',
      accessToken: 'secret-abc',
      event: 'order_created',
      count: 3,
    });
    const masked = maskInteractionPayload(raw);
    expect(masked.available).toBe(true);
    expect(masked.body).toEqual({
      name: '***',
      phone: '***',
      email: '***',
      address: '***',
      accessToken: '***',
      event: 'order_created',
      count: 3,
    });
    // 元の文字列は変えない。
    expect(raw).toContain('田中明');
  });

  it('入れ子と配列の中も伏せる', () => {
    const masked = maskInteractionPayload(JSON.stringify({
      customer: { 氏名: '佐藤', 電話番号: '08011112222' },
      items: [{ email: 'a@b.co' }, { note: 'ふつうのメモ' }],
    }));
    expect(masked.body).toEqual({
      customer: { 氏名: '***', 電話番号: '***' },
      items: [{ email: '***' }, { note: 'ふつうのメモ' }],
    });
  });

  it('鍵によらず値の形でも伏せる', () => {
    const masked = maskInteractionPayload(JSON.stringify({
      contact: 'yamada@example.jp',
      memo: '折り返し 03-1234-5678 まで',
    }));
    const body = masked.body as Record<string, string>;
    expect(body.contact).toBe('***');
    // 文の中に混ざった番号までは追わない（誤って消す側に倒さない）。
    expect(body.memo).toBe('折り返し 03-1234-5678 まで');
  });

  it('空・JSONでない本文は伏せようがなく null', () => {
    expect(maskInteractionPayload(null)).toEqual({ body: null, available: false });
    expect(maskInteractionPayload('')).toEqual({ body: null, available: false });
    expect(maskInteractionPayload('not json')).toEqual({ body: null, available: false });
    expect(maskInteractionPayload('"ただの文字"')).toEqual({ body: null, available: false });
  });
});
