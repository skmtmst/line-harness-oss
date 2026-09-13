import type { EventPayload } from './event-bus.js';

/**
 * EC受信イベントのV6連携用正規化(共通互換形式 v1)。
 *
 * EC-CUBE側の出来事をV6イベント基盤(fireEvent)が受け付けられる形へ寄せる。
 * V6側の自動化・分析・スコアは `sourceEventId` を冪等キーにするため、
 * ここで発生元の不変ID・台帳名・発生時刻をそろえて1回だけ渡す。
 * 再送・再試行の二重実行は下流の冪等キーで抑える(この層では落とさない)。
 *
 * 互換の約束(#1460との共通形式):
 * - `sourceEventId` はEC側の `event_id`(発生元の不変ID)。台帳の行IDではない。
 * - `sourceKind` は `'eccube'`(受信口・台帳の `eccube:` にそろえる)。
 * - `eventData` は標準フラット項目に加え、`order` の互換subset
 *   (`{ number, total, currency }`)を必ず含める。広告成果の対応表は
 *   `eventData.order.total`(なければ `eventData.total`)を読むため、
 *   フラット化でこの形を落としてはならない。
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
    amount?: number;
    status?: string;
    status_code?: string;
  } | null;
}

export interface EcV6Event {
  eventType: string;
  payload: EventPayload;
}

/** 互換subsetとして残す注文の最小形。広告成果の対応表が `total` を読む。 */
export interface EcV6OrderCompat {
  number?: string;
  total?: number | string;
  currency?: string;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function finiteAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
 * 金額の正規形。注文明細の合計を先にし、旧EC-CUBEのように定期便側だけが
 * 金額を持つ受信体では `subscription.amount` を拾う。推測はしない。
 */
export function normalizeEcOrderTotal(event: EcV6SourceEvent): number | undefined {
  return finiteAmount(event.order?.total) ?? finiteAmount(event.subscription?.amount);
}

/**
 * 状態の正規形。発生元が持つ符号をありのまま写す
 * (`status_code` 優先、なければ `status`)。注文系に状態項目はないため、
 * ない受信体では書かない(作らない)。
 */
export function normalizeEcStatus(event: EcV6SourceEvent): string | undefined {
  return nonEmptyText(event.subscription?.status_code)
    ?? nonEmptyText(event.subscription?.status);
}

/**
 * 下流へ渡す出来事データ。標準フラット項目と `order` 互換subsetの両方を
 * 持つ。生の受信体は入れない(明細50件・ペット情報まで自動化ログや
 * 送信Webhookへ流れ込むため)。未定義の項目は書かない。
 */
export function buildEcEventData(event: EcV6SourceEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (event.customer_id != null) data.customerId = String(event.customer_id);
  const order = event.order;
  if (order) {
    if (order.number) data.orderNumber = order.number;
    if (order.currency) data.currency = order.currency;
    if (Array.isArray(order.items)) data.itemCount = order.items.length;
    if (order.payment_method) data.paymentMethod = order.payment_method;
  }
  const orderTotal = normalizeEcOrderTotal(event);
  if (orderTotal !== undefined) data.orderTotal = orderTotal;
  const subscription = event.subscription;
  if (subscription) {
    if (subscription.id) data.subscriptionId = subscription.id;
    if (subscription.contract_number) data.contractNumber = subscription.contract_number;
    if (subscription.status) data.subscriptionStatus = subscription.status;
    if (subscription.status_code) data.subscriptionStatusCode = subscription.status_code;
  }
  const status = normalizeEcStatus(event);
  if (status !== undefined) data.status = status;
  const compat: EcV6OrderCompat = {};
  if (order) {
    if (order.number) compat.number = order.number;
    if (order.currency) compat.currency = order.currency;
  }
  // 同値: 注文側に金額がなく旧受信体が定期便側に持つ場合も互換側へ写す。
  // 旧consumerが読む `order.total` を欠落させない。
  const rawOrderTotal: unknown = order?.total;
  const compatTotal = finiteAmount(rawOrderTotal) !== undefined
    || nonEmptyText(rawOrderTotal) !== undefined
    ? (rawOrderTotal as number | string)
    : orderTotal;
  if (compatTotal !== undefined) compat.total = compatTotal;
  if (Object.keys(compat).length > 0) data.order = compat;
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

/**
 * 冪等キーの安定形。購読先ごとに1本で、再送・再試行で変わらない。
 * アカウントを含む(同じ出来事IDが別アカウントへ届く場合の混線を防ぐ)。
 */
export function ecDispatchIdempotencyKey(
  lineAccountId: string,
  externalEventId: string,
  subscriber: string,
): string {
  return `eccube:${lineAccountId}:${externalEventId}:${subscriber}`;
}

/**
 * 通知retry keyの名前空間。変えると既発行キーとの対応が切れるため固定。
 * 値はこの用途専用の乱数UUID(初回生成時に固定。以後不変)。
 */
const EC_RETRY_KEY_NAMESPACE = 'c41a9e2b-7f3d-4a1c-9e5b-2d8f6a0c4e71';

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function uuidV5(namespace: string, name: string): Promise<string> {
  const namespaceBytes = parseUuidBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const material = new Uint8Array(namespaceBytes.length + nameBytes.length);
  material.set(namespaceBytes);
  material.set(nameBytes, namespaceBytes.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', material));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 論理通知の固定retry key。同じ通知は何度送り直しても同じUUIDになり、
 * LINE側がキーで重複送信を抑える(X-Line-Retry-Key、受理済みは409)。
 * DBから作らないため、台帳の書込障害時も再送で同じキーになる。
 */
export async function ecNotificationRetryKey(
  lineAccountId: string,
  externalEventId: string,
): Promise<string> {
  return uuidV5(EC_RETRY_KEY_NAMESPACE, `${lineAccountId}:${externalEventId}:notification`);
}
