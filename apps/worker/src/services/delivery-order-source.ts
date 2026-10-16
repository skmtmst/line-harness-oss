/**
 * 注文がどこから来たか。'external' は外部サービス（Uber Eats・出前館・ロケットナウ）経由、
 * 'line_direct' は LINE から直接受けた自社注文。
 * 手数料の考え方（サービスの取り分か、自社の配送実費か）が違うので `service` とは別に持つ。
 * 移行 683 の `rt_delivery_orders.order_source` の CHECK と同じ並びを保つ。
 */
export const DELIVERY_ORDER_SOURCES = ['external', 'line_direct'] as const;
export type DeliveryOrderSource = (typeof DELIVERY_ORDER_SOURCES)[number];

export function isDeliveryOrderSource(value: unknown): value is DeliveryOrderSource {
  return typeof value === 'string' && (DELIVERY_ORDER_SOURCES as readonly string[]).includes(value);
}
