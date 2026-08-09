import { describe, expect, it } from 'vitest';
import { ecTextMessage, type EcEvent } from './ec-integrations.js';

function event(eventType: string): EcEvent {
  return {
    event_id: 'event-12345678',
    event_type: eventType,
    occurred_at: '2026-08-09T12:00:00+09:00',
    line_user_id: 'U00000000000000000000000000000000',
    order: {
      number: 'NEN-1001',
      total: 2860,
      items: [{ name: '鹿肉ミンチ', quantity: 2 }],
      detail_url: 'https://stg.nen-petfood.com/mypage',
    },
    shipping: { carrier: 'ヤマト運輸', tracking_number: '1234' },
    subscription: { next_order_date: '2026年9月1日', manage_url: 'https://stg.nen-petfood.com/mypage' },
  };
}

describe('ecTextMessage', () => {
  it.each([
    ['ec.order.confirmed', '注文番号：NEN-1001'],
    ['ec.order.shipped', '送り状番号：1234'],
    ['ec.subscription.upcoming', '次回確定日：2026年9月1日'],
    ['ec.subscription.payment_failed', 'お支払い方法をご確認ください'],
    ['ec.subscription.cancelled', 'ご利用ありがとうございました'],
  ])('builds the %s notification', (eventType, expected) => {
    const message = ecTextMessage(event(eventType));
    expect(message.type).toBe('text');
    if (message.type === 'text') expect(message.text).toContain(expected);
  });

  it('applies an admin title and an explicit test label', () => {
    const message = ecTextMessage(event('ec.order.confirmed'), { title: '然からのお知らせ', test: true });
    expect(message.type).toBe('text');
    if (message.type === 'text') expect(message.text).toMatch(/^【テスト送信】\n然からのお知らせ/);
  });
});
