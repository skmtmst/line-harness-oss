import { tracedFetch } from '@line-crm/shared/server';
import type { Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { dbFor } from '../../services/db-router.js';
import { deliverySendEnabled, nowSec, uberOAuthClient } from '../../services/restaurant-delivery.js';
import { UberEatsError } from '../../services/uber-eats.js';
import { getUberApplicationToken } from './application-token.js';
import { getUberOrder } from './order-api.js';
import { parseUberNotification, parseUberOrder, type UberNotification } from './order-payload.js';
import {
  UBER_STORE_ELIGIBILITY, UBER_STORE_JOINS, acquireWebhookLock, claimWebhookAttempt,
  existingUberOrder, finishWebhookEvent, hasUberCancellation, ingestUberCancellation, ingestUberOrder,
  openWebhookEvent, releaseWebhookLock, webhookEvent,
  type UberWebhookEvent, type UberWebhookLease, type UberWebhookStore,
} from './webhook-ingestion.js';

const RETRY_DELAYS_SECONDS = [60, 300, 1800] as const;
const ORDER_STATUS = { CREATED: 'new', ACCEPTED: 'cooking', DENIED: 'rejected', FINISHED: 'handed_over', CANCELED: 'canceled' } as const;

function permanentError(error: unknown): string | null {
  if (!(error instanceof UberEatsError)) return null;
  if (error.kind === 'auth_expired' || error.kind === 'no_permission' || error.kind === 'not_found' || error.kind === 'invalid_request') {
    return `permanent_${error.kind}`;
  }
  if (error.status !== null && error.status >= 300 && error.status < 400) return 'permanent_redirect';
  return null;
}

async function resolveStore(db: D1Database, uberStoreId: string): Promise<UberWebhookStore | null> {
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM rt_delivery_uber_connections
    WHERE uber_store_id = ? AND status = 'connected' AND provisioned_at IS NOT NULL`)
    .bind(uberStoreId).first<{ count: number }>();
  if (count?.count !== 1) return null;
  return db.prepare(`SELECT u.store_id AS id, u.account_id AS accountId, u.uber_store_id AS uberStoreId,
    u.version AS connectionVersion ${UBER_STORE_JOINS} WHERE u.uber_store_id = ? AND ${UBER_STORE_ELIGIBILITY}`)
    .bind(uberStoreId).first<UberWebhookStore>();
}

function matchesEvent(event: UberWebhookEvent, store: UberWebhookStore, notice: UberNotification): boolean {
  if (event.account_id !== store.accountId || event.external_order_id !== notice.orderId || event.event_type !== notice.eventType) return false;
  try {
    const previous = parseUberNotification(JSON.parse(event.payload_json));
    return previous.ok && previous.notification.uberStoreId === notice.uberStoreId
      && previous.notification.eventId === notice.eventId && previous.notification.orderId === notice.orderId;
  } catch { return false; }
}

async function coolingDown(db: D1Database, key: string, now: number): Promise<boolean> {
  return (await db.prepare(`SELECT 1 FROM rt_resource_locks WHERE resource_key = ?
    AND julianday(expires_at) > julianday(?)`).bind(key, new Date(now * 1000).toISOString()).first()) !== null;
}

async function retainRetryDelay(db: D1Database, key: string, lease: UberWebhookLease, attempts: number, now: number): Promise<void> {
  const seconds = RETRY_DELAYS_SECONDS[attempts - 1];
  if (!seconds) return;
  await db.prepare(`INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at, created_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?)
    ON CONFLICT(resource_key) DO UPDATE SET expires_at = MAX(rt_resource_locks.expires_at, excluded.expires_at)`)
    .bind(key, lease.owner, new Date((now + seconds) * 1000).toISOString(), new Date(now * 1000).toISOString(),
      lease.eventKey, lease.owner).run();
}

/** 呼び出し元が本文サイズとHMACを検査した後だけ使う、Uber標準通知の受け口。 */
export async function handleUberWebhook(c: Context<Env>, raw: unknown, rawBody: string, nowSeconds: number): Promise<Response> {
  const parsed = parseUberNotification(raw);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  const notice = parsed.notification;
  if (notice.kind === 'ignored') return c.body(null, 200);
  const db = dbFor(c.env);
  const store = await resolveStore(db, notice.uberStoreId);
  if (!store) return c.json({ success: false, error: 'Store is not configured' }, 404);
  const lease: UberWebhookLease = {
    eventKey: `uber-webhook-event:${notice.eventId}`,
    orderKey: `uber-webhook-order:${notice.orderId}`,
    owner: crypto.randomUUID(),
  };
  const retryKey = `uber-webhook-retry:${notice.eventId}`;
  let event: UberWebhookEvent | null = null;
  let hasOrderLock = false;
  if (!await acquireWebhookLock(db, lease.eventKey, lease.owner, nowSeconds)) {
    return c.json({ success: false, error: 'Processing is busy' }, 503);
  }
  try {
    hasOrderLock = await acquireWebhookLock(db, lease.orderKey, lease.owner, nowSeconds);
    if (!hasOrderLock) return c.json({ success: false, error: 'Processing is busy' }, 503);
    event = await webhookEvent(db, notice.eventId);
    if (event && !matchesEvent(event, store, notice)) return c.json({ success: false, error: 'Event identity conflict' }, 409);
    const existing = await existingUberOrder(db, notice.orderId);
    if (existing && (existing.store_id !== store.id || existing.account_id !== store.accountId)) {
      return c.json({ success: false, error: 'Order identity conflict' }, 409);
    }
    if (event && (event.status === 'processed' || event.status === 'ignored')) return c.body(null, 200);
    if (!event) {
      await openWebhookEvent({ db, store, notification: notice, rawBody, lease, now: nowSeconds });
      event = await webhookEvent(db, notice.eventId);
      if (!event || !matchesEvent(event, store, notice)) return c.json({ success: false, error: 'Connection changed' }, 503);
    }
    if (notice.kind === 'cancel' || await hasUberCancellation(db, store, notice.orderId)) {
      const finished = await ingestUberCancellation({ db, store, lease, event, orderId: notice.orderId, now: nowSec() });
      return finished ? c.body(null, 200) : c.json({ success: false, error: 'Processing interrupted' }, 503);
    }
    if (existing) {
      const finished = await finishWebhookEvent({ db, store, lease, event, status: 'processed', now: nowSec() });
      return finished ? c.body(null, 200) : c.json({ success: false, error: 'Processing interrupted' }, 503);
    }
    if (event.status === 'failed') return c.json({ success: false, error: 'Processing requires review' }, 400);
    const client = uberOAuthClient(c.env);
    if (!deliverySendEnabled(c.env) || !client) return c.json({ success: false, error: 'Integration is not configured' }, 503);
    if (event.attempts >= 4) return c.json({ success: false, error: 'Processing requires review' }, 503);
    if (await coolingDown(db, retryKey, nowSeconds)) return c.json({ success: false, error: 'Processing is waiting to retry' }, 503);
    const token = await getUberApplicationToken({ db, client, encryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      fetcher: (url, init) => tracedFetch(url, init) });
    if (!await claimWebhookAttempt({ db, store, lease, event, now: nowSec() })) {
      return c.json({ success: false, error: 'Processing interrupted' }, 503);
    }
    const details = await getUberOrder({ hosts: client.hosts, accessToken: token.accessToken,
      fetch: (url, init) => tracedFetch(url, init) }, notice.orderId);
    const order = parseUberOrder(details, { orderId: notice.orderId, uberStoreId: notice.uberStoreId }, nowSec());
    if (!order.ok || order.state === 'UNKNOWN') {
      await finishWebhookEvent({ db, store, lease, event, status: 'failed', code: 'invalid_order_details', now: nowSec() });
      return c.json({ success: false, error: 'Invalid order details' }, 400);
    }
    const finished = await ingestUberOrder({ db, store, lease, event, order: order.order, status: ORDER_STATUS[order.state], now: nowSec() });
    return finished ? c.body(null, 200) : c.json({ success: false, error: 'Processing interrupted' }, 503);
  } catch (error) {
    // Providerの本文・顧客情報・秘密値は出さず、再送可能な状態だけ残す。
    if (event) {
      try {
        const code = permanentError(error);
        await finishWebhookEvent({ db, store, lease, event, status: code ? 'failed' : 'retryable_failed', code: code ?? 'processing_failed', now: nowSec() });
        if (!code) await retainRetryDelay(db, retryKey, lease, event.attempts, nowSec());
      } catch { /* 保存不能でも200にせず、残ったreceivedを次の通知で回収する。 */ }
    }
    return c.json({ success: false, error: 'Processing failed' }, permanentError(error) ? 400 : 503);
  } finally {
    // 解放失敗は期限で回復する。別の実行主体へ移った鍵は削除しない。
    try {
      if (hasOrderLock) await releaseWebhookLock(db, lease.orderKey, lease.owner);
      await releaseWebhookLock(db, lease.eventKey, lease.owner);
    } catch { /* 既存リースを維持する。 */ }
  }
}
