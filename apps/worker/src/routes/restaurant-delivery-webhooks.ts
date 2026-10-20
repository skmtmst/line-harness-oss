import { logger } from '@line-crm/shared/server';
import { isDeclaredWebhookBodyTooLarge, isWebhookBodyTooLarge } from '../lib/webhook-body.js';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { dbFor } from '../services/db-router.js';
import type { StoreContext } from './restaurant-google.js';
import { deliveryWebhookIpAllowlist, isDeliveryWebhookIpAllowed, webhookSourceIp } from '../services/delivery-webhook-ip.js';
import { deliveryWebhookSigningSecret, verifyDeliveryWebhook } from '../services/delivery-webhook-auth.js';
import { MAX_WEBHOOK_BODY_BYTES, parseWebhookPayload, type WebhookOrder } from '../services/delivery-webhook-payload.js';
import { canTransitionOrder, isDeliveryService, judgeUrgency, nowSec } from '../services/restaurant-delivery.js';
import type { DeliveryOrderStatus } from '../services/restaurant-delivery.js';
import type { DeliveryService } from '../services/delivery-service-types.js';
import { cookingCountFor } from './restaurant-delivery-common.js';

export function registerDeliveryWebhooks(restaurantDelivery: Hono<Env>): void {
  // ---------- 受信（各サービスの公式窓口からの通知） ----------

  /** 署名検証を通った通知の宛先店舗。担当者の認証は通らないため、ここで店舗を確定する。 */
  async function webhookStore(c: Context<Env>, storeId: string): Promise<StoreContext | null> {
    const row = await dbFor(c.env, storeId)
      .prepare(
        `SELECT id, name, organization_id, line_account_id
         FROM rt_stores WHERE id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(storeId)
      .first<{ id: string; name: string; organization_id: string; line_account_id: string | null }>();
    if (!row || !row.line_account_id) return null;
    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      lineAccountId: row.line_account_id,
    };
  }

  /** 新しい注文をD1へ取り込む。重複は UNIQUE (service, external_order_id) で1件に収める。 */
  async function ingestOrder(
    c: Context<Env>,
    store: StoreContext,
    service: DeliveryService,
    order: WebhookOrder,
    now: number,
  ): Promise<'created' | 'duplicate'> {
    const db = dbFor(c.env, store.id);
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const cookingCount = await cookingCountFor(c, store);
    const urgency = judgeUrgency({
      status: 'new',
      receivedAt: order.receivedAt,
      wantedAt: order.wantedAt,
      itemCount,
      cookingCount,
      now,
    });
    const id = crypto.randomUUID();
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO rt_delivery_orders
         (id, account_id, store_id, service, external_order_id, order_number, status,
          total_amount, currency, item_count, pickup_method, wanted_at, customer_note,
          urgency, urgency_reason, urgency_computed_at, received_at,
          version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, 'JPY', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        store.lineAccountId,
        store.id,
        service,
        order.externalOrderId,
        order.orderNumber,
        order.totalAmount,
        itemCount,
        order.pickupMethod,
        order.wantedAt,
        order.customerNote,
        urgency.urgency,
        urgency.reason,
        now,
        order.receivedAt,
        now,
        now,
      )
      .run();
    if ((inserted.meta?.changes ?? 0) === 0) return 'duplicate';

    for (const [index, item] of order.items.entries()) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO rt_delivery_order_items
           (id, order_id, position, name, note, quantity, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, index, item.name, item.note, item.quantity, item.amount, now)
        .run();
    }
    return 'created';
  }

  /**
   * お客様・サービス側からのキャンセル。店舗へ送り返す操作ではないため送信台帳は使わない。
   * 理由は自社の符号へ寄せる（サービスから届いた自由文は保存しない）。
   */
  async function ingestCancel(
    c: Context<Env>,
    store: StoreContext,
    service: DeliveryService,
    cancel: { externalOrderId: string; canceledBy: 'customer' | 'service' },
    now: number,
  ): Promise<'canceled' | 'ignored'> {
    const db = dbFor(c.env, store.id);
    const row = await db
      .prepare(
        `SELECT id, status, version FROM rt_delivery_orders
        WHERE store_id = ? AND service = ? AND external_order_id = ? LIMIT 1`,
      )
      .bind(store.id, service, cancel.externalOrderId)
      .first<{ id: string; status: DeliveryOrderStatus; version: number }>();
    if (!row) return 'ignored';
    if (!canTransitionOrder(row.status, 'canceled')) return 'ignored';
    const reasonCode = cancel.canceledBy === 'customer' ? 'customer_request' : 'service_canceled';
    const updated = await db
      .prepare(
        `UPDATE rt_delivery_orders
          SET status = 'canceled', canceled_at = ?, cancel_reason_code = ?, canceled_by = ?,
              version = version + 1, updated_at = ?
        WHERE id = ? AND store_id = ? AND status = ? AND version = ?`,
      )
      .bind(now, reasonCode, cancel.canceledBy, now, row.id, store.id, row.status, row.version)
      .run();
    return (updated.meta?.changes ?? 0) > 0 ? 'canceled' : 'ignored';
  }

  /**
   * 各サービスからの通知の受け口。
   *
   * 担当者の認証は通らない。守りは4つで、
   * 1) 送信元IPの許可リスト（設定されているときだけ。出前館QA#7）、
   * 2) サービスごとの合言葉によるHMAC-SHA256の署名検証、
   * 3) 5分の時刻ずれ制限、
   * 4) 受信台帳 `rt_delivery_events` の UNIQUE (service, external_event_id) による重複排除。
   * 署名が合わない通知は本文を保存しない。
   */
  restaurantDelivery.post('/api/restaurant-test/delivery/webhooks/:service', async (c) => {
    const service = c.req.param('service');
    if (!isDeliveryService(service)) {
      return c.json({ success: false, error: 'Unknown service' }, 404);
    }
    // 送信元IPの確認は本文を読む前に行う。許可外からの通知は本文も台帳も残さない。
    const allowlist = deliveryWebhookIpAllowlist(c.env, service);
    if (allowlist !== null) {
      const sourceIp = webhookSourceIp({
        cfConnectingIp: c.req.header('cf-connecting-ip'),
        forwardedFor: c.req.header('x-forwarded-for'),
        realIp: c.req.header('x-real-ip'),
      });
      if (!isDeliveryWebhookIpAllowed(sourceIp, allowlist)) {
        // 符号と道筋だけを記録する。相手のIPやサービス名は記録に残さない。
        logger.error("routes_restaurant_delivery_webhook_ip_not_allowed");
        return c.json({ success: false, error: 'Forbidden' }, 403);
      }
    }
    // 署名の鍵はサービスごとに違う（Uber は公式仕様で client_secret。delivery-webhook-auth.ts）。
    const secret = deliveryWebhookSigningSecret(c.env, service);
    if (!secret) {
      // 合言葉が未設定・短すぎる場合は検証できない。受け取らずに設定不足として返す。
      logger.error("routes_restaurant_delivery_failed");
      return c.json({ success: false, error: 'Integration is not configured' }, 503);
    }

    if (isDeclaredWebhookBodyTooLarge(c.req.header('content-length'), MAX_WEBHOOK_BODY_BYTES)) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }
    const rawBody = await c.req.text();
    if (isWebhookBodyTooLarge(rawBody, MAX_WEBHOOK_BODY_BYTES)) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }

    const now = nowSec();
    // 確かめ方の違いは service 層に閉じてある。合わない通知はここで止めて本文を保存しない。
    const verified = await verifyDeliveryWebhook({
      service,
      secret,
      rawBody,
      header: (name) => c.req.header(name),
      nowSeconds: now,
    });
    if (!verified.ok) {
      return c.json({ success: false, error: verified.error }, 401);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return c.json({ success: false, error: 'Invalid JSON' }, 400);
    }
    const parsed = parseWebhookPayload(parsedJson, now);
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
    const payload = parsed.payload;

    const store = await webhookStore(c, payload.storeId);
    if (!store) return c.json({ success: false, error: 'Store is not configured' }, 404);

    const db = dbFor(c.env, store.id);
    const externalOrderId = payload.order?.externalOrderId ?? payload.cancel?.externalOrderId ?? null;
    // 先に受信台帳へ入れる。同じ通知が二度届いても処理は1回だけになる。
    const ledger = await db
      .prepare(
        `INSERT OR IGNORE INTO rt_delivery_events
         (id, account_id, service, external_event_id, event_type, external_order_id,
          status, payload_json, attempts, received_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?, 1, ?, 1)`,
      )
      .bind(
        crypto.randomUUID(),
        store.lineAccountId,
        service,
        payload.eventId,
        payload.eventType,
        externalOrderId,
        rawBody,
        now,
      )
      .run();
    if ((ledger.meta?.changes ?? 0) === 0) {
      // すでに受け取った通知。再送でも同じ200を返して相手の再試行を止める。
      return c.json({ success: true, duplicate: true });
    }

    const closeEvent = async (
      status: 'processed' | 'ignored' | 'failed' | 'retryable_failed',
      errorCode: string | null,
    ) => {
      await db
        .prepare(
          `UPDATE rt_delivery_events
            SET status = ?, error_code = ?, processed_at = ?, version = version + 1
          WHERE service = ? AND external_event_id = ?`,
        )
        .bind(status, errorCode, nowSec(), service, payload.eventId)
        .run();
    };

    try {
      if (payload.eventType === 'order.created') {
        if (!payload.order) {
          await closeEvent('failed', 'order_missing');
          return c.json({ success: false, error: 'Invalid order' }, 400);
        }
        const outcome = await ingestOrder(c, store, service, payload.order, now);
        await closeEvent('processed', null);
        return c.json({ success: true, result: outcome });
      }
      if (payload.eventType === 'order.canceled') {
        if (!payload.cancel) {
          await closeEvent('failed', 'cancel_missing');
          return c.json({ success: false, error: 'Invalid cancel' }, 400);
        }
        const outcome = await ingestCancel(c, store, service, payload.cancel, now);
        await closeEvent(outcome === 'canceled' ? 'processed' : 'ignored', null);
        return c.json({ success: true, result: outcome });
      }
      // 対応していない種類は記録だけ残して受け取る（相手の再送を止めるため200）。
      await closeEvent('ignored', null);
      return c.json({ success: true, result: 'ignored' });
    } catch (error) {
      // 例外の本文は残さない。種類だけを符号にして台帳へ入れ、相手には再試行を促す。
      logger.error("routes_restaurant_delivery_failed");
      await closeEvent('retryable_failed', 'processing_failed');
      return c.json({ success: false, error: 'Processing failed' }, 503);
    }
  });
}
