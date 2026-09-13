import { describe, expect, it } from 'vitest';
import { EC_EVENT_TYPES } from '@line-crm/shared';
import {
  buildEcEventData,
  buildEcV6Event,
  ecDispatchIdempotencyKey,
  ecNotificationRetryKey,
  EC_V6_SOURCE_KIND,
  normalizeEcOccurredAt,
  normalizeEcOrderTotal,
  normalizeEcStatus,
  type EcV6SourceEvent,
} from './ec-event-publish.js';

function sourceEvent(eventType: string): EcV6SourceEvent {
  return {
    event_id: 'event-12345678',
    event_type: eventType,
    occurred_at: '2026-08-28T01:00:00+09:00',
    customer_id: 'customer-1',
    order: {
      number: 'NEN-1001',
      total: 2860,
      currency: 'JPY',
      payment_method: 'credit_card',
      items: [{ name: '鹿肉ミンチ', quantity: 2 }],
    },
    subscription: {
      id: 'sub-1',
      contract_number: 'NEN-SUB-57',
      status: '契約中',
      status_code: 'active',
    },
  };
}

describe('normalizeEcOccurredAt', () => {
  it('converts JST to a timezone-aware ISO string', () => {
    expect(normalizeEcOccurredAt('2026-08-28T01:00:00+09:00')).toBe('2026-08-27T16:00:00.000Z');
  });

  it('passes through an unreadable value without guessing', () => {
    expect(normalizeEcOccurredAt('not-a-date')).toBe('not-a-date');
  });
});

describe('buildEcV6Event', () => {
  it.each(EC_EVENT_TYPES)('carries %s with the same source event id', (eventType) => {
    const built = buildEcV6Event(sourceEvent(eventType), 'friend-1');
    expect(built.eventType).toBe(eventType);
    expect(built.payload.sourceEventId).toBe('event-12345678');
    expect(built.payload.sourceKind).toBe(EC_V6_SOURCE_KIND);
    expect(built.payload.occurredAt).toBe('2026-08-27T16:00:00.000Z');
    expect(built.payload.friendId).toBe('friend-1');
  });

  it('keeps event data flat and JSON-safe', () => {
    const built = buildEcV6Event(sourceEvent('ec.order.confirmed'), 'friend-1');
    expect(built.payload.eventData).toEqual({
      customerId: 'customer-1',
      orderNumber: 'NEN-1001',
      orderTotal: 2860,
      currency: 'JPY',
      itemCount: 1,
      paymentMethod: 'credit_card',
      subscriptionId: 'sub-1',
      contractNumber: 'NEN-SUB-57',
      subscriptionStatus: '契約中',
      subscriptionStatusCode: 'active',
      status: 'active',
      order: { number: 'NEN-1001', total: 2860, currency: 'JPY' },
    });
    expect(() => JSON.parse(JSON.stringify(built.payload.eventData))).not.toThrow();
  });

  it('keeps the order subset readable for the ad-conversion mapping (#1460 compatible)', () => {
    const built = buildEcV6Event(sourceEvent('ec.order.confirmed'), 'friend-1');
    const eventData = (built.payload.eventData ?? {}) as Record<string, unknown>;
    // #1460 adConversionForEvent と同じ読み方: order.total、なければeventData直下。
    const order = (eventData.order as Record<string, unknown> | undefined) ?? eventData;
    expect(order.total).toBe(2860);
  });

  it('omits missing blocks instead of writing undefined', () => {
    const built = buildEcV6Event(
      { event_id: 'event-87654321', event_type: 'ec.customer.profile_updated', occurred_at: '2026-08-28T01:00:00+09:00' },
      'friend-9',
    );
    expect(built.payload.eventData).toEqual({});
    expect(Object.values(built.payload.eventData ?? {}).every((value) => value !== undefined)).toBe(true);
  });
});

describe('buildEcEventData', () => {
  it('stringifies a numeric customer id', () => {
    expect(buildEcEventData({ ...sourceEvent('ec.order.confirmed'), customer_id: 42 }).customerId).toBe('42');
  });

  it('prefers the order total and falls back to a legacy subscription amount', () => {
    const base = sourceEvent('ec.order.confirmed');
    expect(normalizeEcOrderTotal(base)).toBe(2860);
    expect(normalizeEcOrderTotal({ ...base, order: null })).toBeUndefined();
    // 旧EC-CUBEのように定期便側だけが金額を持つ受信体も拾う。
    expect(normalizeEcOrderTotal({
      ...base,
      order: { number: 'NEN-1001' },
      subscription: { contract_number: 'NEN-SUB-57', amount: 3680 },
    })).toBe(3680);
    expect(normalizeEcOrderTotal({ ...base, order: null, subscription: null })).toBeUndefined();
  });

  it('copies the source status code without inventing one', () => {
    const base = sourceEvent('ec.order.confirmed');
    expect(normalizeEcStatus(base)).toBe('active');
    expect(normalizeEcStatus({
      ...base, subscription: { contract_number: 'NEN-SUB-57', status: '契約中' },
    })).toBe('契約中');
    expect(normalizeEcStatus({ ...base, subscription: null })).toBeUndefined();
    expect(buildEcEventData({ ...base, subscription: null })).not.toHaveProperty('status');
  });

  it('does not guess a currency the source did not send', () => {
    const base = sourceEvent('ec.order.confirmed');
    expect(buildEcEventData({ ...base, order: { number: 'NEN-1001', total: 100 } }))
      .not.toHaveProperty('currency');
  });

  it('mirrors a legacy subscription amount into the compatible order total', () => {
    const data = buildEcEventData({
      event_id: 'event-legacy-1',
      event_type: 'ec.subscription.payment_failed',
      occurred_at: '2026-08-28T01:00:00+09:00',
      subscription: { contract_number: 'NEN-SUB-57', amount: 3680 },
    });
    expect(data.orderTotal).toBe(3680);
    expect((data.order as Record<string, unknown>).total).toBe(3680);
  });
});

describe('ecNotificationRetryKey', () => {
  const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('returns a stable UUID per logical notification', async () => {
    const first = await ecNotificationRetryKey('account-a', 'event-12345678');
    const second = await ecNotificationRetryKey('account-a', 'event-12345678');
    expect(first).toMatch(UUID_V5);
    expect(second).toBe(first);
  });

  it('separates accounts and events', async () => {
    const base = await ecNotificationRetryKey('account-a', 'event-12345678');
    expect(await ecNotificationRetryKey('account-b', 'event-12345678')).not.toBe(base);
    expect(await ecNotificationRetryKey('account-a', 'event-87654321')).not.toBe(base);
  });
});

describe('ecDispatchIdempotencyKey', () => {
  it('stays stable per account, event, and subscriber', () => {
    expect(ecDispatchIdempotencyKey('account-a', 'event-12345678', 'notification'))
      .toBe('eccube:account-a:event-12345678:notification');
    expect(ecDispatchIdempotencyKey('account-a', 'event-12345678', 'v6'))
      .toBe('eccube:account-a:event-12345678:v6');
    expect(ecDispatchIdempotencyKey('account-b', 'event-12345678', 'notification'))
      .not.toBe(ecDispatchIdempotencyKey('account-a', 'event-12345678', 'notification'));
  });
});
