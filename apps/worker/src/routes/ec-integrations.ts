import { Hono } from 'hono';
import { getFriendByLineUserId, getLineAccountById, getLineAccounts, jstNow } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import type { Env } from '../index.js';
import { fireEvent, logOutgoingMessage } from '../services/event-bus.js';

const ecIntegrations = new Hono<Env>();
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export const EC_EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.shipped',
  'ec.subscription.upcoming',
  'ec.subscription.payment_failed',
  'ec.subscription.cancelled',
] as const;
const EVENT_TYPES = new Set<string>(EC_EVENT_TYPES);

type EcItem = { name: string; quantity: number };
export type EcEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  customer_id?: string | number | null;
  line_user_id: string;
  order?: {
    number?: string;
    total?: number;
    payment_method?: string;
    items?: EcItem[];
    delivery_date?: string | null;
    delivery_time?: string | null;
    detail_url?: string | null;
  };
  shipping?: {
    carrier?: string | null;
    tracking_number?: string | null;
    tracking_url?: string | null;
    shipped_at?: string | null;
  };
  subscription?: {
    id?: string;
    next_order_date?: string | null;
    change_deadline?: string | null;
    manage_url?: string | null;
  };
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validateEvent(value: unknown): value is EcEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<EcEvent>;
  if (typeof event.event_id !== 'string' || event.event_id.length < 8 || event.event_id.length > 255) return false;
  if (typeof event.event_type !== 'string' || !EVENT_TYPES.has(event.event_type)) return false;
  if (typeof event.line_user_id !== 'string' || !/^U[0-9a-f]{32}$/i.test(event.line_user_id)) return false;
  if (typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at))) return false;
  if (event.order?.items && (!Array.isArray(event.order.items) || event.order.items.length > 50)) return false;
  return true;
}

function yen(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `¥${Math.round(value).toLocaleString('ja-JP')}`
    : '—';
}

function itemSummary(items: EcItem[] | undefined): string {
  if (!items?.length) return '商品情報なし';
  const visible = items.slice(0, 4).map((item) => `${item.name.slice(0, 80)} × ${item.quantity}`);
  if (items.length > visible.length) visible.push(`ほか${items.length - visible.length}点`);
  return visible.join('\n');
}

export type EcMessageOptions = {
  title?: string | null;
  introText?: string | null;
  outroText?: string | null;
  test?: boolean;
};

function messageText(title: string, fixedLines: string[], options?: EcMessageOptions): Message {
  const sections = [
    `${options?.test ? '【テスト送信】\n' : ''}${options?.title || title}`,
    options?.introText?.trim() || '',
    fixedLines.filter(Boolean).join('\n'),
    options?.outroText?.trim() || '',
  ].filter(Boolean);
  return { type: 'text', text: sections.join('\n\n').trim() };
}

export function ecTextMessage(event: EcEvent, options?: EcMessageOptions): Message {
  const orderNumber = event.order?.number || '—';
  if (event.event_type === 'ec.order.confirmed') {
    return messageText('ご注文ありがとうございます', [
        `注文番号：${orderNumber}`,
        itemSummary(event.order?.items),
        `合計：${yen(event.order?.total)}`,
        event.order?.delivery_date ? `お届け予定：${event.order.delivery_date}${event.order.delivery_time ? ` ${event.order.delivery_time}` : ''}` : '',
        event.order?.detail_url || '',
    ], options);
  }
  if (event.event_type === 'ec.order.shipped') {
    return messageText('商品を発送しました', [
        `注文番号：${orderNumber}`,
        itemSummary(event.order?.items),
        event.shipping?.carrier ? `配送会社：${event.shipping.carrier}` : '',
        event.shipping?.tracking_number ? `送り状番号：${event.shipping.tracking_number}` : '',
        event.shipping?.tracking_url || event.order?.detail_url || '',
    ], options);
  }
  if (event.event_type === 'ec.subscription.upcoming') {
    return messageText('次回の定期便をお知らせします', [
        event.subscription?.next_order_date ? `次回確定日：${event.subscription.next_order_date}` : '',
        event.subscription?.change_deadline ? `変更期限：${event.subscription.change_deadline}` : '',
        itemSummary(event.order?.items),
        `予定金額：${yen(event.order?.total)}`,
        event.subscription?.manage_url || '',
    ], options);
  }
  if (event.event_type === 'ec.subscription.payment_failed') {
    return messageText('定期便のお支払いをご確認ください', [
      '定期便のお支払いを確認できませんでした。',
      'お支払い方法をご確認ください。',
      event.subscription?.manage_url || '',
    ], options);
  }
  return messageText('定期便の解約を受け付けました', [
    '定期便の解約を受け付けました。',
    event.subscription?.id ? `定期便番号：${event.subscription.id}` : '',
  ], options);
}

ecIntegrations.post('/api/integrations/eccube/events', async (c) => {
  const secret = c.env.ECCUBE_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    console.error('[ec-event] ECCUBE_WEBHOOK_SECRET is missing or too short');
    return c.json({ success: false, error: 'Integration is not configured' }, 503);
  }

  const declaredLength = Number(c.req.header('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }

  const rawBody = await c.req.text();
  if (utf8Length(rawBody) > MAX_BODY_BYTES) return c.json({ success: false, error: 'Payload too large' }, 413);

  const timestamp = c.req.header('x-nen-timestamp') || '';
  const signature = (c.req.header('x-nen-signature') || '').replace(/^sha256=/i, '');
  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return c.json({ success: false, error: 'Expired request' }, 401);
  }
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!constantTimeHexEqual(signature.toLowerCase(), expected)) {
    return c.json({ success: false, error: 'Invalid signature' }, 401);
  }

  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }
  if (!validateEvent(event)) return c.json({ success: false, error: 'Invalid event' }, 400);

  const now = jstNow();
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO ec_events
      (id, source, external_event_id, event_type, customer_id, line_user_id, payload, status, received_at, updated_at)
     VALUES (?, 'eccube', ?, ?, ?, ?, ?, 'received', ?, ?)`,
  ).bind(
    id,
    event.event_id,
    event.event_type,
    event.customer_id == null ? null : String(event.customer_id),
    event.line_user_id,
    rawBody,
    now,
    now,
  ).run();

  const row = inserted.meta.changes
    ? { id, status: 'received' }
    : await c.env.DB.prepare(
        `SELECT id, status FROM ec_events WHERE source = 'eccube' AND external_event_id = ?`,
      ).bind(event.event_id).first<{ id: string; status: string }>();
  if (!row) return c.json({ success: false, error: 'Event ledger failure' }, 500);
  if (row.status === 'processed' || row.status === 'skipped') {
    return c.json({ success: true, duplicate: true, status: row.status });
  }

  const claim = await c.env.DB.prepare(
    `UPDATE ec_events SET status = 'processing', error_message = NULL, updated_at = ?
     WHERE id = ? AND status IN ('received', 'failed')`,
  ).bind(now, row.id).run();
  if (!claim.meta.changes) return c.json({ success: true, duplicate: true, status: 'processing' }, 202);

  try {
    const friend = await getFriendByLineUserId(c.env.DB, event.line_user_id);
    if (!friend || !friend.is_following) {
      await c.env.DB.prepare(
        `UPDATE ec_events SET status = 'skipped', error_message = ?, processed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(friend ? 'friend_not_following' : 'friend_not_found', now, now, row.id).run();
      return c.json({ success: true, status: 'skipped' }, 202);
    }

    const account = friend.line_account_id
      ? await getLineAccountById(c.env.DB, friend.line_account_id)
      : (await getLineAccounts(c.env.DB)).find((candidate) => candidate.is_active === 1) ?? null;
    const accessToken = account?.channel_access_token || c.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) throw new Error('LINE access token is not configured');

    const setting = await c.env.DB.prepare(
      `SELECT is_enabled, title_override, intro_text, outro_text
         FROM ec_notification_settings WHERE event_type = ?`,
    ).bind(event.event_type).first<{
      is_enabled: number; title_override: string | null; intro_text: string | null; outro_text: string | null;
    }>();

    // Transactional delivery can be paused independently while automation
    // events continue to fire for segmentation and step campaigns.
    if (setting?.is_enabled === 0) {
      await c.env.DB.prepare(
        `UPDATE ec_events SET friend_id = ?, status = 'skipped', error_message = 'notification_disabled', processed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(friend.id, now, now, row.id).run();
      await fireEvent(c.env.DB, event.event_type, {
        friendId: friend.id,
        eventData: event,
      }, accessToken, account?.id ?? friend.line_account_id ?? undefined);
      return c.json({ success: true, status: 'skipped' }, 202);
    }

    const message = ecTextMessage(event, {
      title: setting?.title_override,
      introText: setting?.intro_text,
      outroText: setting?.outro_text,
    });
    const lineClient = new LineClient(accessToken);
    await lineClient.pushMessage(event.line_user_id, [message]);
    await logOutgoingMessage(c.env.DB, {
      friendId: friend.id,
      messageType: message.type,
      content: message.type === 'text' ? message.text : JSON.stringify(message),
      deliveryType: 'push',
      source: 'ec_transactional',
      lineAccountId: account?.id ?? friend.line_account_id,
    });

    await c.env.DB.prepare(
      `UPDATE ec_events SET friend_id = ?, status = 'processed', processed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(friend.id, now, now, row.id).run();

    await fireEvent(c.env.DB, event.event_type, {
      friendId: friend.id,
      eventData: event,
    }, accessToken, account?.id ?? friend.line_account_id ?? undefined);

    return c.json({ success: true, status: 'processed' });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
    await c.env.DB.prepare(
      `UPDATE ec_events SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
    ).bind(message, jstNow(), row.id).run();
    console.error(`[ec-event] processing failed event=${event.event_id}`, error);
    return c.json({ success: false, error: 'Event processing failed' }, 503);
  }
});

export { ecIntegrations };
