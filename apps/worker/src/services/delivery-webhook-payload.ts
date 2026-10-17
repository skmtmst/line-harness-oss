/**
 * デリバリー連携の通知（webhook）の本文を読み取る層だけを切り出したもの。
 *
 * - 受け取る形は3サービス共通。項目名の違いは各サービスの窓口設定側で寄せる。
 * - DBも fetch も Hono も触らない。渡された JSON と数値だけを見る。
 * - サービスから届いた自由文のエラー文や説明文は取り込まない。
 */

import { NEN_WEBHOOK_SKEW_SECONDS } from '../lib/hmac.js';
import { WEBHOOK_BODY_BYTES } from '../lib/webhook-body.js';

export const MAX_WEBHOOK_BODY_BYTES = WEBHOOK_BODY_BYTES.delivery;
/** 署名の時刻ずれの許容。他の受信口（EC連携・成果受信）と同じ5分。 */
export const WEBHOOK_SKEW_SECONDS = NEN_WEBHOOK_SKEW_SECONDS;
export { utf8Length } from '../lib/webhook-body.js';

/** 文字列の必須項目。長さ上限を超えた値は受け取らない（画面の崩れとDB肥大を防ぐ）。 */
function textField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return textField(value, max);
}

function countField(value: unknown, max: number): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const num = Number(value);
  if (num < 0 || num > max) return null;
  return num;
}

/** エポック秒。範囲外・形式違いは null にして、呼び出し側で既定値へ落とす。 */
function epochField(value: unknown, now: number): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const num = Number(value);
  // 過去30日〜未来7日の外は受け取らない（誤った単位・ミリ秒混入を弾く）。
  if (num < now - 30 * 86400 || num > now + 7 * 86400) return null;
  return num;
}

interface WebhookItem {
  name: string;
  note: string | null;
  quantity: number;
  amount: number;
}

export interface WebhookOrder {
  externalOrderId: string;
  orderNumber: string;
  totalAmount: number;
  pickupMethod: string | null;
  wantedAt: number | null;
  customerNote: string | null;
  receivedAt: number;
  items: WebhookItem[];
}

interface WebhookPayload {
  eventId: string;
  eventType: string;
  storeId: string;
  order: WebhookOrder | null;
  cancel: { externalOrderId: string; canceledBy: 'customer' | 'service' } | null;
}

/**
 * 3サービス共通の受信形式。
 * サービスごとの項目名の違いは各サービスの窓口設定側で共通名へ寄せる。
 * ここで受け取るのは検証済みの項目だけで、サービスから届いた自由文の
 * エラー文や説明文は取り込まない。
 */
export function parseWebhookPayload(
  raw: unknown,
  now: number,
): { ok: true; payload: WebhookPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid payload' };
  const body = raw as Record<string, unknown>;
  const eventId = textField(body.event_id, 128);
  const eventType = textField(body.event_type, 64);
  const storeId = textField(body.store_id, 128);
  if (!eventId || !eventType || !storeId) return { ok: false, error: 'Invalid payload' };

  let order: WebhookOrder | null = null;
  if (body.order && typeof body.order === 'object') {
    const source = body.order as Record<string, unknown>;
    const externalOrderId = textField(source.external_order_id, 128);
    const orderNumber = textField(source.order_number, 64);
    const totalAmount = countField(source.total_amount, 10_000_000);
    if (!externalOrderId || !orderNumber || totalAmount === null) {
      return { ok: false, error: 'Invalid order' };
    }
    const items: WebhookItem[] = [];
    if (Array.isArray(source.items)) {
      if (source.items.length > 100) return { ok: false, error: 'Invalid order' };
      for (const entry of source.items) {
        if (!entry || typeof entry !== 'object') return { ok: false, error: 'Invalid order' };
        const item = entry as Record<string, unknown>;
        const name = textField(item.name, 200);
        const quantity = countField(item.quantity, 999);
        const amount = countField(item.amount, 10_000_000);
        if (!name || quantity === null || quantity === 0 || amount === null) {
          return { ok: false, error: 'Invalid order' };
        }
        items.push({ name, note: optionalText(item.note, 200), quantity, amount });
      }
    }
    order = {
      externalOrderId,
      orderNumber,
      totalAmount,
      pickupMethod: optionalText(source.pickup_method, 100),
      wantedAt: epochField(source.wanted_at, now),
      customerNote: optionalText(source.customer_note, 500),
      receivedAt: epochField(source.received_at, now) ?? now,
      items,
    };
  }

  let cancel: WebhookPayload['cancel'] = null;
  if (body.cancel && typeof body.cancel === 'object') {
    const source = body.cancel as Record<string, unknown>;
    const externalOrderId = textField(source.external_order_id, 128);
    if (!externalOrderId) return { ok: false, error: 'Invalid cancel' };
    // 発生元は店舗以外の2つだけ。店舗のキャンセルは画面（D-3）から記録する。
    const canceledBy = source.canceled_by === 'customer' ? 'customer' : 'service';
    cancel = { externalOrderId, canceledBy };
  }

  return { ok: true, payload: { eventId, eventType, storeId, order, cancel } };
}
