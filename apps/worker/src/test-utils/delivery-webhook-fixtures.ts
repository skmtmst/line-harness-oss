export interface DeliveryOrderCreatedOverrides {
  eventId?: string;
  externalOrderId?: string;
  orderNumber?: string;
}

/** 自社方式の配送webhookで使う、作り物の出前館注文。 */
export function orderCreatedPayload(
  nowSec: number,
  overrides: DeliveryOrderCreatedOverrides = {},
) {
  return {
    event_id: overrides.eventId ?? 'evt-1',
    event_type: 'order.created',
    store_id: 'store-shibuya',
    order: {
      external_order_id: overrides.externalOrderId ?? 'DM-9001',
      order_number: overrides.orderNumber ?? '#DM-9001',
      total_amount: 2480,
      pickup_method: '配達（出前館 配達員）',
      wanted_at: nowSec + 1500,
      received_at: nowSec - 30,
      items: [
        { name: '鶏の唐揚げ弁当', quantity: 2, amount: 1800 },
        { name: '味噌汁', note: '特製タレ増量（無料）', quantity: 1, amount: 680 },
      ],
    },
  };
}

/** Uber公式通知の必須IDを持つ未知event。 */
export function uberIgnoredNotification(eventId = 'uber-event-ignored') {
  return {
    event_id: eventId,
    event_type: 'orders.future_notification',
    meta: {
      resource_id: 'uber-order-ignored',
      user_id: 'uber-store-ignored',
      status: 'unknown',
    },
  };
}
