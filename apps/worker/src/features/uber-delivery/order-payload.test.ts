import { describe, expect, it } from 'vitest';
import { parseUberNotification, parseUberOrder } from './order-payload.js';

const NOW = 1_798_000_000;

function officialOrderFixture() {
  return {
    id: '153dd7f1-339d-4619-940c-418943c14636',
    display_id: 'C14636',
    current_state: 'CREATED',
    store: { id: '89dd9741-66b5-4bb4-b216-a813f3b21b4f', name: '然-NEN' },
    cart: {
      special_instructions: '玄関で受け渡し',
      items: [{
        id: 'meal',
        instance_id: 'meal-instance-1',
        title: '日替わり弁当',
        quantity: 2,
        special_instructions: '卵アレルギーです',
        price: {
          unit_price: { amount: 1200, currency_code: 'JPY', formatted_amount: '￥1,200' },
          total_price: { amount: 2400, currency_code: 'JPY', formatted_amount: '￥2,400' },
        },
        selected_modifier_groups: [{
          id: 'rice',
          title: 'ご飯',
          selected_items: [{
            id: 'large',
            title: '大盛り',
            quantity: 1,
            price: { unit_price: { amount: 200, currency_code: 'JPY' } },
            selected_modifier_groups: [{
              id: 'seasoning',
              title: 'ふりかけ',
              selected_items: [{ id: 'sesame', title: 'ごま', quantity: 1 }],
              removed_items: [],
            }],
          }],
          removed_items: [{ id: 'normal', title: '普通盛り', quantity: 1 }],
        }],
        special_requests: [{
          allergy: {
            allergens_to_exclude: [
              { type: 'EGGS' },
              { type: 'OTHER', freeform_text: '山芋' },
            ],
            allergy_instructions: '同じ油も避けてください',
          },
        }],
      }],
    },
    payment: {
      charges: {
        total: { amount: 2600, currency_code: 'JPY', formatted_amount: '￥2,600' },
      },
    },
    placed_at: '2026-10-22T10:15:30+09:00',
    estimated_ready_for_pickup_at: '2026-10-22T10:40:30+09:00',
    type: 'DELIVERY_BY_UBER',
  };
}

type OrderFixture = ReturnType<typeof officialOrderFixture>;

const expected = {
  orderId: '153dd7f1-339d-4619-940c-418943c14636',
  uberStoreId: '89dd9741-66b5-4bb4-b216-a813f3b21b4f',
};

describe('Uber通知', () => {
  it.each([
    ['orders.notification', 'order'],
    ['orders.cancel', 'cancel'],
    ['orders.failure', 'cancel'],
    ['orders.release', 'ignored'],
  ] as const)('%sをID付きの安全な通知へ変換する', (eventType, kind) => {
    const result = parseUberNotification({
      event_id: 'event-1',
      event_type: eventType,
      meta: { resource_id: 'order-1', user_id: 'store-1', status: 'pos' },
      resource_href: 'https://attacker.example/do-not-follow',
    });
    expect(result).toEqual({
      ok: true,
      notification: {
        eventId: 'event-1',
        eventType,
        orderId: 'order-1',
        uberStoreId: 'store-1',
        kind,
      },
    });
  });

  it('未知eventでもIDが欠けていればignoredにせず拒否する', () => {
    expect(parseUberNotification({
      event_id: 'event-1',
      event_type: 'new.future.event',
      meta: { resource_id: 'order-1' },
    })).toEqual({ ok: false, error: 'Invalid Uber notification' });
  });
});

describe('Uber注文詳細', () => {
  it('公式v2形式のJPY注文を、modifier込み単価・注記・offset付き時刻を保って変換する', () => {
    const result = parseUberOrder(officialOrderFixture(), expected, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canceled).toBe(false);
    expect(result.order).toMatchObject({
      externalOrderId: expected.orderId,
      orderNumber: 'C14636',
      totalAmount: 2600,
      pickupMethod: 'DELIVERY_BY_UBER',
      receivedAt: Date.parse('2026-10-22T10:15:30+09:00') / 1000,
      wantedAt: Date.parse('2026-10-22T10:40:30+09:00') / 1000,
      customerNote: '玄関で受け渡し',
    });
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]).toMatchObject({
      name: '日替わり弁当',
      quantity: 2,
      amount: 1200,
    });
    const note = result.order.items[0]?.note ?? '';
    expect(note).toContain('卵アレルギーです');
    expect(note).toContain('選択: ご飯 > 大盛り ×1');
    expect(note).toContain('選択: ご飯 > 大盛り > ふりかけ > ごま ×1');
    expect(note).toContain('除外: ご飯 > 普通盛り ×1');
    expect(note).toContain('アレルギー: EGGS, OTHER (山芋), 同じ油も避けてください');
  });

  it('同じ瞬間の異なるtimezone offsetを同じepoch秒にする', () => {
    const first = officialOrderFixture();
    const second = officialOrderFixture();
    first.placed_at = '2026-10-22T10:15:30+09:00';
    second.placed_at = '2026-10-22T01:15:30Z';
    const firstResult = parseUberOrder(first, expected, NOW);
    const secondResult = parseUberOrder(second, expected, NOW);
    expect(firstResult.ok && firstResult.order.receivedAt).toBe(secondResult.ok && secondResult.order.receivedAt);
  });

  it.each([
    ['注文ID', (order: OrderFixture) => { order.id = 'other-order'; }],
    ['店舗ID', (order: OrderFixture) => { order.store.id = 'other-store'; }],
  ])('%sの不一致を別注文として取り込まない', (_label, mutate) => {
    const order = officialOrderFixture();
    mutate(order);
    expect(parseUberOrder(order, expected, NOW)).toEqual({
      ok: false,
      error: 'Uber order identity mismatch',
    });
  });

  it.each([
    ['店舗受取総額の通貨', (order: OrderFixture) => { order.payment.charges.total.currency_code = 'USD'; }],
    ['商品単価の通貨', (order: OrderFixture) => { order.cart.items[0].price.unit_price.currency_code = 'USD'; }],
    ['店舗受取総額の欠損', (order: OrderFixture) => {
      delete (order.payment.charges.total as { amount?: number }).amount;
    }],
    ['商品単価の小数', (order: OrderFixture) => { order.cart.items[0].price.unit_price.amount = 12.5; }],
    ['数量0', (order: OrderFixture) => { order.cart.items[0].quantity = 0; }],
  ])('%sを0や換算値で補わず拒否する', (_label, mutate) => {
    const order = officialOrderFixture();
    mutate(order);
    expect(parseUberOrder(order, expected, NOW).ok).toBe(false);
  });

  it('instance_idが重複する商品行を拒否する', () => {
    const order = officialOrderFixture();
    order.cart.items.push(structuredClone(order.cart.items[0]));
    expect(parseUberOrder(order, expected, NOW)).toEqual({
      ok: false,
      error: 'Invalid Uber order item',
    });
  });

  it('安全に収まらない商品注記や注文注記を途中で切らず拒否する', () => {
    const itemNote = officialOrderFixture();
    itemNote.cart.items[0].special_instructions = 'a'.repeat(201);
    expect(parseUberOrder(itemNote, expected, NOW)).toEqual({
      ok: false,
      error: 'Invalid Uber order item note',
    });

    const customerNote = officialOrderFixture();
    customerNote.cart.special_instructions = 'b'.repeat(501);
    expect(parseUberOrder(customerNote, expected, NOW)).toEqual({
      ok: false,
      error: 'Invalid Uber order details',
    });
  });

  it('ISO8601でない時刻を受信時刻へ黙って置き換えない', () => {
    const order = officialOrderFixture();
    order.placed_at = '2026/10/22 10:15:30';
    expect(parseUberOrder(order, expected, NOW)).toEqual({
      ok: false,
      error: 'Invalid Uber order details',
    });
  });

  it('公式のCANCELEDだけをキャンセルとして扱い、DENIEDを推測で広げない', () => {
    const canceled = officialOrderFixture();
    canceled.current_state = 'CANCELED';
    const denied = officialOrderFixture();
    denied.current_state = 'DENIED';
    const canceledResult = parseUberOrder(canceled, expected, NOW);
    const deniedResult = parseUberOrder(denied, expected, NOW);
    expect(canceledResult.ok && canceledResult.canceled).toBe(true);
    expect(deniedResult.ok && deniedResult.canceled).toBe(false);
  });
});
