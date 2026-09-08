import { describe, expect, it } from 'vitest';
import { EC_EVENT_TYPES } from '@line-crm/shared';
import {
  buildEcEventData,
  buildEcV6Event,
  EC_V6_SOURCE_KIND,
  normalizeEcOccurredAt,
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
    });
    expect(() => JSON.parse(JSON.stringify(built.payload.eventData))).not.toThrow();
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
});
