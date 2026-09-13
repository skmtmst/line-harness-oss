import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
  addTagToFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';
import { listLimit } from './list-pagination.js';
import { MAX_STRIPE_WEBHOOK_BODY_BYTES, readBodyWithinLimit, verifyStripeSignature } from '../services/stripe-signature.js';

const stripe = new Hono<Env>();

interface StripeWebhookBody {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      customer?: string;
      status?: string;
    };
  };
}

// ========== Stripeイベント一覧 ==========

stripe.get('/api/integrations/stripe/events', async (c) => {
  try {
    const friendId = c.req.query('friendId') ?? undefined;
    const eventType = c.req.query('eventType') ?? undefined;
    const limit = listLimit(c.req.query('limit'), 100);
    const items = await getStripeEvents(c.env.DB, { friendId, eventType, limit });
    return c.json({
      success: true,
      data: items.map((e) => ({
        id: e.id,
        stripeEventId: e.stripe_event_id,
        eventType: e.event_type,
        friendId: e.friend_id,
        amount: e.amount,
        currency: e.currency,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        processedAt: e.processed_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/integrations/stripe/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== Stripe Webhookレシーバー ==========

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    const stripeSecret = c.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!stripeSecret) {
      console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured');
      return c.json({ success: false, error: 'Stripe webhook is not configured' }, 503);
    }

    const declaredLength = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }

    const rawBody = await readBodyWithinLimit(c.req.raw);
    if (rawBody === null) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }

    const sigHeader = c.req.header('Stripe-Signature') ?? '';
    const valid = await verifyStripeSignature(stripeSecret, rawBody, sigHeader);
    if (!valid) {
      return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
    }
    const body = JSON.parse(rawBody) as StripeWebhookBody;

    // 冪等性チェック
    const existing = await getStripeEventByStripeId(c.env.DB, body.id);
    if (existing) {
      return c.json({ success: true, data: { message: 'Already processed' } });
    }

    const obj = body.data.object;
    const db = c.env.DB;

    // メタデータからfriendIdを取得（Stripeのメタデータにline_friend_idを設定している想定）
    const friendId = obj.metadata?.line_friend_id ?? null;

    // イベントを記録
    const event = await createStripeEvent(db, {
      stripeEventId: body.id,
      eventType: body.type,
      friendId: friendId ?? undefined,
      amount: obj.amount,
      currency: obj.currency,
      metadata: JSON.stringify(obj.metadata ?? {}),
    });

    // 決済成功時の自動処理
    if (body.type === 'payment_intent.succeeded' && friendId) {
      const friendAccount = await db.prepare(
        `SELECT line_account_id FROM friends WHERE id = ?`,
      ).bind(friendId).first<{ line_account_id: string | null }>();

      // 自動タグ付け（product_idベース）
      const productId = obj.metadata?.product_id;
      if (productId) {
        const tag = await db
          .prepare(`SELECT id FROM tags WHERE name = ?`)
          .bind(`purchased_${productId}`)
          .first<{ id: string }>();
        if (tag) {
          await addTagToFriend(db, friendId, tag.id);
        }
      }

      await awardActivityMileage(db, {
        eventType: 'purchase_completed',
        source: 'stripe',
        sourceEventId: body.id,
        friendId,
        subjectKey: productId || 'first_purchase',
        metadata: {
          stripeEventId: body.id,
          paymentIntentId: obj.id,
          productId: productId ?? null,
          amount: obj.amount ?? null,
          currency: obj.currency ?? null,
        },
        occurredAt: event.processed_at,
      });
      if (friendAccount?.line_account_id) {
        await applyActionScoreEvent(db, {
          lineAccountId: friendAccount.line_account_id,
          friendId,
          eventType: 'purchase_completed',
          source: 'stripe',
          sourceEventId: body.id,
          subjectKey: productId || obj.id,
          occurredAt: event.processed_at,
        }).catch((error) => {
          // Stripeイベントは記録済み。派生スコアの失敗で再送を誘発しない。
          console.error('stripe action score failed:', error);
        });
      }

      // イベントバスに発火（自動化ルール用）
      const { fireEvent } = await import('../services/event-bus.js');
      await fireEvent(db, 'cv_fire', {
        sourceEventId: body.id,
        sourceKind: 'stripe',
        occurredAt: event.processed_at,
        friendId,
        eventData: { type: 'purchase', amount: obj.amount, stripeEventId: body.id },
      }, undefined, friendAccount?.line_account_id);
    }

    // サブスクリプションイベント処理
    if (body.type === 'customer.subscription.deleted' && friendId) {
      const cancelledTag = await db
        .prepare(`SELECT id FROM tags WHERE name = 'subscription_cancelled'`)
        .first<{ id: string }>();
      if (cancelledTag) {
        await addTagToFriend(db, friendId, cancelledTag.id);
      }
    }

    return c.json({
      success: true,
      data: { id: event.id, stripeEventId: event.stripe_event_id, eventType: event.event_type, processedAt: event.processed_at },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { stripe };
