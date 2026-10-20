import { describe, expect, it } from 'vitest';
import { ecFlexMessage } from './ec-notification-message.js';

describe('EC LINE通知カード', () => {
  it('銀行振込の注文受付に必須の振込先情報を含める', () => {
    const message = ecFlexMessage({
      event_id: 'test-order-bank-1',
      event_type: 'ec.order.confirmed',
      occurred_at: '2026-08-20T12:00:00+09:00',
      line_user_id: 'U00000000000000000000000000000000',
      order: {
        number: 'NEN-001', total: 2430, payment_method: '銀行振込',
        items: [{ name: '鹿肉ミンチ', quantity: 1 }],
      },
    }, { title: 'ご注文ありがとうございます' });

    expect(message.type).toBe('flex');
    const json = JSON.stringify(message);
    expect(json).toContain('GMOあおぞらネット銀行（0310）');
    expect(json).toContain('法人第二営業部（102）');
    expect(json).toContain('普通 1664636');
    expect(json).toContain('シェッドプロダクツ（カ');
  });

  it('LINE Flex に無い項目（letterSpacing）を含めない。検証の Outbox 再送で 2 件が拒否された（2026-09-17）', () => {
    const message = ecFlexMessage({
      event_id: 'test-flex-fields-1', event_type: 'ec.order.confirmed',
      occurred_at: '2026-08-20T12:00:00+09:00',
      line_user_id: 'U00000000000000000000000000000000',
      order: { number: 'NEN-009', total: 2430, payment_method: 'クレジットカード' },
    }, { title: 'ご注文ありがとうございます', introText: 'いつもありがとうございます', test: true });
    const json = JSON.stringify(message);
    expect(json).not.toContain('letterSpacing');
    expect(json).toContain('"text":"NEN"');
  });

  it('銀行振込以外の注文には口座情報を付けない', () => {
    const message = ecFlexMessage({
      event_id: 'test-order-card-1', event_type: 'ec.order.confirmed',
      occurred_at: '2026-08-20T12:00:00+09:00',
      line_user_id: 'U00000000000000000000000000000000',
      order: { number: 'NEN-002', total: 2430, payment_method: 'クレジットカード' },
    });
    expect(JSON.stringify(message)).not.toContain('1664636');
  });

  it('銀行振込期限リマインドには振込先と期限を必ず表示する', () => {
    const message = ecFlexMessage({
      event_id: 'test-bank-reminder-1', event_type: 'ec.order.bank_transfer_reminder',
      occurred_at: '2026-08-20T12:00:00+09:00',
      line_user_id: 'U00000000000000000000000000000000',
      order: { number: 'NEN-003', payment_deadline: '2026-08-25' },
    });
    const json = JSON.stringify(message);
    expect(json).toContain('2026-08-25');
    expect(json).toContain('GMOあおぞらネット銀行（0310）');
    expect(json).toContain('普通 1664636');
  });
});
