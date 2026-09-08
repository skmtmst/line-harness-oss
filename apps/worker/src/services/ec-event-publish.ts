import type { EventPayload } from './event-bus.js';

/**
 * EC受信イベントのV6連携用正規化。
 *
 * EC-CUBE側の出来事(EcEvent)をV6イベント基盤(fireEvent)が受け付けられる形へ
 * 寄せる。V6側の自動化・分析・スコアは `sourceEventId` を冪等キーにするため、
 * ここで発生元の不変ID・台帳名・発生時刻をそろえて1回だけ渡す。
 * 再送・再試行の二重実行は下流の冪等キーで抑える(この層では落とさない)。
 */

/** V6側に渡す発生元の台帳名。受信口・台帳の `eccube:` にそろえる。 */
export const EC_V6_SOURCE_KIND = 'eccube';

/** 正規化に要るEC受信イベントの最小形。`EcEvent` はこの形を満たす。 */
export interface EcV6SourceEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  customer_id?: string | number | null;
  order?: {
    number?: string;
    total?: number;
    currency?: string;
    payment_method?: string;
    items?: Array<unknown>;
  } | null;
  subscription?: {
    id?: string;
    contract_number?: string;
    status?: string;
    status_code?: string;
  } | null;
}

export interface EcV6Event {
  eventType: string;
  payload: EventPayload;
}

/**
 * 発生時刻をタイムゾーン付きISOへ寄せる。分析台帳はタイムゾーンなしを
 * 受け付けないため、ここで正規化する。読めない値は推測せずそのまま返す
 * (受信口の検証を通った値は到達時点で読めるはず)。
 */
export function normalizeEcOccurredAt(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

/**
 * 下流へ渡す出来事データをフラットなスカラーだけにする。生の受信体は
 * 入れない(明細50件・ペット情報まで自動化ログや送信Webhookへ流れ込むため)。
 */
export function buildEcEventData(event: EcV6SourceEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (event.customer_id != null) data.customerId = String(event.customer_id);
  const order = event.order;
  if (order) {
    if (order.number) data.orderNumber = order.number;
    if (typeof order.total === 'number' && Number.isFinite(order.total)) data.orderTotal = order.total;
    if (order.currency) data.currency = order.currency;
    if (Array.isArray(order.items)) data.itemCount = order.items.length;
    if (order.payment_method) data.paymentMethod = order.payment_method;
  }
  const subscription = event.subscription;
  if (subscription) {
    if (subscription.id) data.subscriptionId = subscription.id;
    if (subscription.contract_number) data.contractNumber = subscription.contract_number;
    if (subscription.status) data.subscriptionStatus = subscription.status;
    if (subscription.status_code) data.subscriptionStatusCode = subscription.status_code;
  }
  return data;
}

/**
 * EC受信1件をV6イベント1件へ写す。出来事種別は変えない(V6側の購読可否は
 * 各購読先の対応表に従う)。自動化・分析・スコアは同じ `sourceEventId` を見る。
 */
export function buildEcV6Event(event: EcV6SourceEvent, friendId: string): EcV6Event {
  return {
    eventType: event.event_type,
    payload: {
      sourceEventId: event.event_id,
      sourceKind: EC_V6_SOURCE_KIND,
      occurredAt: normalizeEcOccurredAt(event.occurred_at),
      friendId,
      eventData: buildEcEventData(event),
    },
  };
}
