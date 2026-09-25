import { Hono } from 'hono';
import {
  decryptCredential,
  getLineAccountById,
  jstNow,
  setEcActionExecutionStatus,
  upsertEcEventReadModels,
} from '@line-crm/db';
import type { Message } from '@line-crm/line-sdk';
import { EC_EVENT_TYPES } from '@line-crm/shared';
import type { Env } from '../index.js';
import { dispatchOperatorEvent } from '../services/operator-notification-dispatch.js';

import { cancelPendingOrderFollowUps } from '../services/nen-engagement.js';
import { markEcEventFailed, processEcEvent } from '../services/ec-event-processing.js';

const ecIntegrations = new Hono<Env>();
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export { EC_EVENT_TYPES } from '@line-crm/shared';
const EVENT_TYPES = new Set<string>(EC_EVENT_TYPES);

type EcItem = {
  name: string;
  quantity: number;
  product_id?: string | number | null;
  product_url?: string | null;
  unit_amount?: number | null;
  line_amount?: number | null;
};
export type EcEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  customer_id?: string | number | null;
  point_balance?: number | null;
  purchase_count?: number | null;
  purchase_amount?: number | null;
  line_user_id?: string | null;
  /**
   * ECが計算した会員ランク・マイル（★V6 37-1）。EC側が対応してから届く。
   * 届いた値を正とし、LINE側で足し算しない。
   */
  membership?: {
    annual_miles_yen?: number | null;
    lifetime_miles_yen?: number | null;
    member_rank_key?: string | null;
    member_rank_name?: string | null;
    mile_rate_percent?: number | null;
    rank_valid_until?: string | null;
    mile_balance?: number | null;
    miles_used_this_month?: number | null;
    last_purchased_at?: string | null;
  } | null;
  order?: {
    number?: string;
    total?: number;
    currency?: string;
    date?: string;
    payment_method?: string;
    items?: EcItem[];
    delivery_date?: string | null;
    delivery_time?: string | null;
    detail_url?: string | null;
    payment_deadline?: string | null;
    /** 注文で使われたクーポンコード。誕生日クーポンの利用記録（used_at）へつなげる。 */
    coupon_code?: string | null;
  };
  order_history?: Array<{
    id?: string;
    number?: string;
    date?: string;
    total?: number;
    items?: EcItem[];
    detail_url?: string | null;
  }>;
  subscriptions?: Array<{
    id?: string;
    contract_number?: string;
    status?: string;
    status_code?: string;
    next_charge_date?: string | null;
    next_shipping_date?: string | null;
    cycle?: string | null;
    items?: EcItem[];
  }>;
  shipping?: {
    carrier?: string | null;
    tracking_number?: string | null;
    tracking_url?: string | null;
    shipped_at?: string | null;
  };
  refund?: {
    amount?: number | null;
    full_refund?: boolean | null;
  };
  subscription?: {
    id?: string;
    contract_number?: string;
    amount?: number;
    scheduled_shipping_date?: string | null;
    next_order_date?: string | null;
    change_deadline?: string | null;
    manage_url?: string | null;
    mypage_subscription_url?: string | null;
    payment_method_update_url?: string | null;
    status?: string;
    status_code?: string;
    next_charge_date?: string | null;
    next_shipping_date?: string | null;
    cycle?: string | null;
    items?: EcItem[];
    retry_status?: string | null;
  };
  profile?: {
    owner_name?: string | null;
    pets?: Array<{
      id?: string | number | null;
      name: string;
      animal_type?: 'dog' | 'cat' | 'other';
      gender?: 'male' | 'female' | 'unknown';
      birthday?: string | null;
    }>;
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

export function validateEvent(value: unknown): value is EcEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<EcEvent>;
  if (typeof event.event_id !== 'string' || event.event_id.length < 8 || event.event_id.length > 255) return false;
  if (typeof event.event_type !== 'string' || !EVENT_TYPES.has(event.event_type)) return false;
  if (event.line_user_id != null
      && (typeof event.line_user_id !== 'string' || !/^U[0-9a-f]{32}$/i.test(event.line_user_id))) return false;
  if (typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at))) return false;
  if (event.order?.items && (!Array.isArray(event.order.items) || event.order.items.length > 50)) return false;
  if (event.order_history && (!Array.isArray(event.order_history) || event.order_history.length > 50)) return false;
  if (event.subscriptions && (!Array.isArray(event.subscriptions) || event.subscriptions.length > 20)) return false;
  if (event.profile?.pets) {
    if (!Array.isArray(event.profile.pets) || event.profile.pets.length > 20) return false;
    for (const pet of event.profile.pets) {
      if (!pet || typeof pet !== 'object' || typeof pet.name !== 'string' || !pet.name.trim() || pet.name.length > 80) return false;
      if (pet.animal_type && !['dog', 'cat', 'other'].includes(pet.animal_type)) return false;
      if (pet.gender && !['male', 'female', 'unknown'].includes(pet.gender)) return false;
      if (pet.birthday != null && (typeof pet.birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pet.birthday)
        || !Number.isFinite(Date.parse(`${pet.birthday}T00:00:00Z`)))) return false;
    }
  }
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


function memberRank(_count: number, amount: number): string {
  if (amount >= 100000) return 'プラチナ会員';
  if (amount >= 50000) return 'ゴールド会員';
  if (amount >= 20000) return 'シルバー会員';
  return '会員';
}

export async function syncMemberSnapshot(db: D1Database, friendId: string, event: EcEvent, now: string): Promise<void> {
  const current = await db.prepare(`SELECT * FROM nen_ec_member_snapshots WHERE friend_id = ?`).bind(friendId).first<Record<string, unknown>>();
  let orders: Array<Record<string, unknown>> = current ? JSON.parse(String(current.orders_json || '[]')) : [];
  let subscription: Record<string, unknown> | null = current?.subscription_json ? JSON.parse(String(current.subscription_json)) : null;
  const hasPurchaseCount = Number.isFinite(event.purchase_count);
  const hasPurchaseAmount = Number.isFinite(event.purchase_amount);
  let count = hasPurchaseCount ? Math.max(0, Math.round(Number(event.purchase_count))) : Number(current?.purchase_count || 0);
  let amount = hasPurchaseAmount ? Math.max(0, Math.round(Number(event.purchase_amount))) : Number(current?.purchase_amount || 0);
  const pointBalance = Number.isFinite(event.point_balance)
    ? Math.max(0, Math.round(Number(event.point_balance)))
    : Number(current?.point_balance || 0);
  if (event.event_type === 'ec.customer.profile_updated' && Array.isArray(event.order_history)) {
    orders = event.order_history.map((order) => ({
      id: order.id || `eccube:order:${order.number || crypto.randomUUID()}`,
      number: order.number,
      date: order.date,
      total: order.total || 0,
      items: order.items || [],
      detailUrl: order.detail_url || null,
    })).slice(0, 50);
    subscription = { contracts: Array.isArray(event.subscriptions) ? event.subscriptions : [], updatedAt: event.occurred_at };
  }
  if (event.event_type === 'ec.order.confirmed' && event.order) {
    const order = { id: event.event_id, number: event.order.number, date: event.occurred_at, total: event.order.total || 0, paymentMethod: event.order.payment_method || null, items: event.order.items || [], detailUrl: event.order.detail_url || null };
    if (!orders.some((item) => item.id === event.event_id || (event.order?.number && item.number === event.order.number))) {
      orders = [order, ...orders].slice(0, 50);
      if (!hasPurchaseCount) count += 1;
      if (!hasPurchaseAmount) amount += Math.max(0, Math.round(event.order.total || 0));
    }
  }
  if (event.event_type.startsWith('ec.subscription.') && event.subscription) {
    const currentContracts = Array.isArray(subscription?.contracts) ? subscription.contracts as Array<Record<string, unknown>> : subscription ? [subscription] : [];
    const nextContract = { ...event.subscription, status: event.event_type === 'ec.subscription.cancelled' ? '解約済み' : event.event_type === 'ec.subscription.payment_failed' ? '決済確認が必要' : '契約中', updatedAt: event.occurred_at };
    const matchIndex = currentContracts.findIndex(contract => (event.subscription?.id && contract.id === event.subscription.id) || (event.subscription?.contract_number && contract.contract_number === event.subscription.contract_number));
    if (matchIndex >= 0) currentContracts[matchIndex] = { ...currentContracts[matchIndex], ...nextContract };
    else currentContracts.unshift(nextContract);
    subscription = { contracts: currentContracts.slice(0, 20), updatedAt: event.occurred_at };
  }
  await db.prepare(
    `INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, orders_json, subscription_json, purchase_count, purchase_amount, point_balance, member_rank, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id) DO UPDATE SET customer_id=COALESCE(excluded.customer_id, customer_id), orders_json=excluded.orders_json,
       subscription_json=excluded.subscription_json, purchase_count=excluded.purchase_count,
       purchase_amount=excluded.purchase_amount, point_balance=excluded.point_balance,
       member_rank=excluded.member_rank, synced_at=excluded.synced_at`,
  ).bind(friendId, event.customer_id == null ? null : String(event.customer_id), JSON.stringify(orders), subscription ? JSON.stringify(subscription) : null, count, amount, pointBalance, memberRank(count, amount), now).run();
  await applyMembership(db, friendId, event, { amount, pointBalance, orderDate: event.event_type === 'ec.order.confirmed' ? event.occurred_at : null });
}

const nonNegativeInt = (value: unknown): number | null =>
  Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : null;

/**
 * ECが計算した会員ランク・マイルを写す。
 *
 * `membership` が届いていればその値を正にする（通年・ライフタイム・ランク・残高）。
 * 届いていない（EC側が未対応・古い注文イベント）ときは、暫定として
 * ライフタイム＝これまでの足し算、残高＝ポイント残高だけを追いかけ、
 * ランクキーは触らない（設定としきい値から画面側で求める）。
 */
async function applyMembership(
  db: D1Database,
  friendId: string,
  event: EcEvent,
  fallback: { amount: number; pointBalance: number; orderDate: string | null },
): Promise<void> {
  const membership = event.membership;
  if (membership && typeof membership === 'object') {
    const rankKey = typeof membership.member_rank_key === 'string' && membership.member_rank_key.trim() ? membership.member_rank_key.trim().slice(0, 64) : null;
    const rankName = typeof membership.member_rank_name === 'string' && membership.member_rank_name.trim() ? membership.member_rank_name.trim().slice(0, 40) : null;
    const rate = Number.isFinite(membership.mile_rate_percent) ? Math.max(0, Math.min(10, Number(membership.mile_rate_percent))) : null;
    await db.prepare(
      `UPDATE nen_ec_member_snapshots
          SET annual_miles_yen = COALESCE(?, annual_miles_yen),
              lifetime_miles_yen = COALESCE(?, lifetime_miles_yen),
              member_rank_key = COALESCE(?, member_rank_key),
              member_rank = COALESCE(?, member_rank),
              mile_rate_percent = COALESCE(?, mile_rate_percent),
              rank_valid_until = COALESCE(?, rank_valid_until),
              mile_balance = COALESCE(?, mile_balance),
              miles_used_this_month = COALESCE(?, miles_used_this_month),
              last_purchased_at = COALESCE(?, last_purchased_at)
        WHERE friend_id = ?`,
    ).bind(
      nonNegativeInt(membership.annual_miles_yen),
      nonNegativeInt(membership.lifetime_miles_yen),
      rankKey,
      rankName,
      rate,
      typeof membership.rank_valid_until === 'string' ? membership.rank_valid_until.slice(0, 32) : null,
      nonNegativeInt(membership.mile_balance),
      nonNegativeInt(membership.miles_used_this_month),
      typeof membership.last_purchased_at === 'string' ? membership.last_purchased_at.slice(0, 32) : null,
      friendId,
    ).run();
    return;
  }
  await db.prepare(
    `UPDATE nen_ec_member_snapshots
        SET lifetime_miles_yen = MAX(lifetime_miles_yen, ?),
            mile_balance = ?,
            last_purchased_at = COALESCE(?, last_purchased_at)
      WHERE friend_id = ? AND member_rank_key IS NULL`,
  ).bind(fallback.amount, fallback.pointBalance, fallback.orderDate ? fallback.orderDate.slice(0, 32) : null, friendId).run();
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
    const subscriptionUrl = event.subscription?.mypage_subscription_url || event.subscription?.manage_url || '';
    const paymentMethodUrl = event.subscription?.payment_method_update_url || event.subscription?.manage_url || '';
    return messageText('定期便のお支払いをご確認ください', [
      '定期便のお支払いを確認できませんでした。',
      'お支払い方法をご確認ください。',
      event.subscription?.contract_number ? `契約番号：${event.subscription.contract_number}` : '',
      typeof event.subscription?.amount === 'number' ? `お支払い金額：${yen(event.subscription.amount)}` : '',
      event.subscription?.scheduled_shipping_date ? `発送予定日：${event.subscription.scheduled_shipping_date}` : '',
      subscriptionUrl ? `定期便の確認：\n${subscriptionUrl}` : '',
      paymentMethodUrl ? `クレジットカードの変更：\n${paymentMethodUrl}` : '',
    ], options);
  }
  return messageText('定期便の解約を受け付けました', [
    '定期便の解約を受け付けました。',
    event.subscription?.id ? `定期便番号：${event.subscription.id}` : '',
  ], options);
}

/**
 * `X-Line-Account-Id` が無いときの宛先の決め方（EC-CUBE 側はこのヘッダーを送らず、
 * 署名も `timestamp.body`（アカウントIDなし）で作る。/columns と同じ決まり）。
 *
 * 1. 出来事の `line_user_id` が、動いている LINE アカウントの友だちとして 1 件だけ見つかれば、そのアカウント
 * 2. 見つからなければ、動いているアカウントが 1 つだけならそのアカウント
 * 3. どちらでも決まらなければ null（→ 400）
 */
async function resolveAccountIdWithoutHeader(db: D1Database, lineUserId: string | null): Promise<string | null> {
  if (lineUserId) {
    const friends = await db.prepare(
      `SELECT f.line_account_id AS id FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
        WHERE f.line_user_id = ? AND a.is_active = 1 AND a.archived_at IS NULL LIMIT 2`,
    ).bind(lineUserId).all<{ id: string }>();
    const ids = [...new Set((friends.results ?? []).map((row) => String(row.id)))];
    if (ids.length === 1) return ids[0];
  }
  const activeAccounts = await db.prepare(
    `SELECT id
       FROM line_accounts
      WHERE is_active = 1 AND archived_at IS NULL
      ORDER BY id
      LIMIT 2`,
  ).all<{ id: string }>();
  const ids = (activeAccounts.results ?? []).map((row) => String(row.id));
  return ids.length === 1 ? ids[0] : null;
}

function lineUserIdFromRawBody(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { line_user_id?: unknown };
    return typeof parsed?.line_user_id === 'string' && /^U[0-9a-f]{32}$/i.test(parsed.line_user_id) ? parsed.line_user_id : null;
  } catch {
    return null;
  }
}

/** 全体の鍵。未設定・短いときは使えない（移行が済むまでのつなぎ）。 */
function usableGlobalSecret(value: string | undefined): string | null {
  return value && value.length >= 32 ? value : null;
}

/**
 * つなぎ先ごとの受信鍵。ec_connectors の暗号化された鍵を復号する。
 * 鍵の用意がない・復号できないときは null（全体の鍵へ倒す）。
 */
async function getConnectorSecret(
  db: D1Database,
  lineAccountId: string,
  encryptionKey: string | undefined,
): Promise<string | null> {
  try {
    const row = await db.prepare(
      `SELECT inbound_secret_encrypted FROM ec_connectors WHERE line_account_id = ? LIMIT 1`,
    ).bind(lineAccountId).first<{ inbound_secret_encrypted: string | null }>();
    const encrypted = row?.inbound_secret_encrypted;
    if (!encrypted) return null;
    const secret = await decryptCredential(encrypted, encryptionKey);
    return secret && secret.length >= 32 ? secret : null;
  } catch {
    return null;
  }
}

/** 候補の鍵を順に試し、1つでも合えば通す。移行期間の両受けが本体。 */
async function verifyWithAnySecret(
  secrets: Array<string | null>,
  signedPayload: string,
  signature: string,
): Promise<boolean> {
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = await hmacHex(secret, signedPayload);
    if (constantTimeHexEqual(signature.toLowerCase(), expected)) return true;
  }
  return false;
}

ecIntegrations.post('/api/integrations/eccube/events', async (c) => {
  const requestedLineAccountId = c.req.header('x-line-account-id')?.trim();
  // ヘッダー無し（EC-CUBE 標準）で署名の時刻も無い呼び出しは、宛先を探す前に断る。
  if (!requestedLineAccountId && !c.req.header('x-nen-timestamp')) {
    return c.json({ success: false, error: 'LINE account is required' }, 400);
  }
  // つなぎ先ごとの鍵へ移行中。使える鍵が1つもないときだけ 503 にする。
  const globalSecret = usableGlobalSecret(c.env.ECCUBE_WEBHOOK_SECRET);
  const headerConnectorSecret = requestedLineAccountId
    ? await getConnectorSecret(c.env.DB, requestedLineAccountId, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY)
    : null;
  if (!globalSecret && !headerConnectorSecret) {
    console.error('[ec-event] no usable webhook secret (global or connector)');
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
  // ヘッダー無し（EC-CUBE 標準）は署名を先に確かめ、本文の line_user_id から宛先を決める。
  // ヘッダー有りはつなぎ先の鍵を先に試し、だめなら全体の鍵（移行期間）。
  // ヘッダー無しは全体の鍵を先に試し、だめなら宛先を決めてつなぎ先の鍵を試す。
  const signedPayload = requestedLineAccountId
    ? `${timestamp}.${requestedLineAccountId}.${rawBody}`
    : `${timestamp}.${rawBody}`;
  let verified = requestedLineAccountId
    ? await verifyWithAnySecret([headerConnectorSecret, globalSecret], signedPayload, signature)
    : await verifyWithAnySecret([globalSecret], signedPayload, signature);
  if (!verified && !requestedLineAccountId) {
    const fallbackAccountId = await resolveAccountIdWithoutHeader(c.env.DB, lineUserIdFromRawBody(rawBody));
    if (fallbackAccountId) {
      const fallbackSecret = await getConnectorSecret(
        c.env.DB, fallbackAccountId, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      );
      verified = await verifyWithAnySecret([fallbackSecret], signedPayload, signature);
    }
  }
  if (!verified) {
    return c.json({ success: false, error: 'Invalid signature' }, 401);
  }
  const lineAccountId = requestedLineAccountId || await resolveAccountIdWithoutHeader(c.env.DB, lineUserIdFromRawBody(rawBody));
  if (!lineAccountId) return c.json({ success: false, error: 'LINE account is required' }, 400);

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account || account.is_active !== 1) {
    return c.json({ success: false, error: 'Integration account is not configured' }, 404);
  }

  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }
  if (!validateEvent(event)) return c.json({ success: false, error: 'Invalid event' }, 400);

  const now = jstNow();
  const id = crypto.randomUUID();
  const source = `eccube:${lineAccountId}`;
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO ec_events
      (id, source, external_event_id, event_type, line_account_id, customer_id,
       line_user_id, payload, status, received_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
  ).bind(
    id,
    source,
    event.event_id,
    event.event_type,
    lineAccountId,
    event.customer_id == null ? null : String(event.customer_id),
    event.line_user_id ?? null,
    rawBody,
    now,
    now,
  ).run();

  const row = inserted.meta.changes
    ? { id, status: 'received' }
    : await c.env.DB.prepare(
        `SELECT id, status FROM ec_events WHERE source = ? AND external_event_id = ?`,
      ).bind(source, event.event_id).first<{ id: string; status: string }>();
  if (!row) return c.json({ success: false, error: 'Event ledger failure' }, 500);
  try {
    await upsertEcEventReadModels(c.env.DB, {
      eventId: row.id,
      sourceKey: source,
      externalEventId: event.event_id,
      eventType: event.event_type,
      lineAccountId,
      customerId: event.customer_id == null ? null : String(event.customer_id),
      occurredAt: event.occurred_at,
      order: event.order,
      refund: event.refund,
    }, now);
  } catch (error) {
    await c.env.DB.prepare(
      `UPDATE ec_events SET status = 'failed', error_message = 'read_model_failed', updated_at = ? WHERE id = ?`,
    ).bind(now, row.id).run();
    await setEcActionExecutionStatus(c.env.DB, {
      eventId: row.id, lineAccountId, status: 'retryable_failed',
      errorCode: 'read_model_failed', errorMessageSafe: '注文情報を取り込めませんでした', now,
    }).catch(() => undefined);
    console.error(`[ec-event] read model failed event=${event.event_id}`, error);
    return c.json({ success: false, error: 'Event processing failed' }, 503);
  }

  /*
   * IDEA-21: 注文の取り消し・返金が届いたら、その注文を起点に待っている
   * 発送後の案内（到着確認・口コミ・次の商品）を「送らない」へ倒す。
   * ここで倒さないと、配信履歴に「これから送ります」と出たままになる。
   * 止め損ねても送信時の再検証（processNenDeliveries）が最後に弾くので、
   * この処理の失敗でイベント受付そのものは止めない。
   */
  if (event.event_type === 'ec.order.cancelled' || event.event_type === 'ec.order.refunded') {
    try {
      const cancelled = await cancelPendingOrderFollowUps(c.env.DB, {
        lineAccountId,
        orderNumber: event.order?.number ?? '',
        reason: event.event_type === 'ec.order.cancelled' ? 'order_cancelled' : 'order_refunded',
      });
      if (cancelled > 0) {
        console.log(JSON.stringify({
          event: 'nen_order_followups_stopped',
          lineAccountId,
          orderNumber: event.order?.number ?? null,
          stopped: cancelled,
        }));
      }
    } catch (followUpError) {
      console.error(`[ec-event] follow-up stop failed event=${event.event_id}`, followUpError);
    }
  }
  if (row.status === 'processed' || row.status === 'skipped') {
    return c.json({ success: true, duplicate: true, status: row.status });
  }

  // 受注は運用者へ知らせる。LINEの友だちが見つからなくても受注自体は起きて
  // いるので、この先の照合結果を待たずにここで出す。台帳の行IDを発生元に
  // 使うため、EC側の再送でも通知は1件しか作られない。
  if (event.event_type === 'ec.order.confirmed') {
    try {
      const orderNumber = event.order?.number?.trim();
      await dispatchOperatorEvent(c.env.DB, c.env, {
        lineAccountId,
        eventType: 'ec_order_received',
        sourceEventId: row.id,
        message: orderNumber ? `ECで注文${orderNumber}を受け付けました` : 'ECで新しい注文を受け付けました',
        executionMode: 'automatic',
      });
    } catch (notificationError) {
      // 受注の取り込みは通知の失敗で止めない。送り残しは回収口から拾う。
      console.error(`[ec-event] operator notification failed event=${event.event_id}`, notificationError);
    }
  }

  if (!event.line_user_id) {
    await c.env.DB.prepare(
      `UPDATE ec_events
          SET status = 'identity_pending', error_message = 'line_identity_unmatched', updated_at = ?
        WHERE id = ? AND status IN ('received', 'failed', 'identity_pending')`,
    ).bind(now, row.id).run();
    await setEcActionExecutionStatus(c.env.DB, {
      eventId: row.id, lineAccountId, status: 'skipped',
      errorCode: 'line_identity_unmatched', errorMessageSafe: 'LINEの友だちが見つかりません', now,
    });
    return c.json({ success: true, status: 'identity_pending' }, 202);
  }

  // 取り込み停止中は、受信の保存までは済ませたうえで動作を止める。
  // 通知・タグ・シナリオ開始などの副作用は一切起こさない。再開時は
  // 止めていた分を待ち行列へ戻す（コネクタ更新口が担う）。
  const connector = await c.env.DB.prepare(
    `SELECT status FROM ec_connectors WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<{ status: string }>();
  if (connector?.status === 'paused') {
    await c.env.DB.prepare(
      `UPDATE ec_events SET status = 'skipped', error_message = 'connector_paused', updated_at = ? WHERE id = ?`,
    ).bind(now, row.id).run();
    await setEcActionExecutionStatus(c.env.DB, {
      eventId: row.id, lineAccountId, status: 'skipped',
      errorCode: 'connector_paused', errorMessageSafe: '取り込みは停止中のため処理しませんでした', now,
    });
    return c.json({ success: true, status: 'paused' }, 202);
  }

  try {
    const outcome = await processEcEvent(c.env.DB, {
      account,
      lineAccountId,
      event,
      eventRowId: row.id,
      now,
      credentialKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    });
    if (outcome === 'duplicate') return c.json({ success: true, duplicate: true, status: 'processing' }, 202);
    if (outcome === 'processed') return c.json({ success: true, status: 'processed' });
    return c.json({ success: true, status: outcome }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
    await markEcEventFailed(c.env.DB, {
      eventRowId: row.id,
      externalEventId: event.event_id,
      lineAccountId,
      message,
      now: jstNow(),
    });
    return c.json({ success: false, error: 'Event processing failed' }, 503);
  }
});

export { ecIntegrations };
