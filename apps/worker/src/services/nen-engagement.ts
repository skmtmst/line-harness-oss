import { getFriendById, getLineAccountById, jstNow } from '@line-crm/db';
import type { Message } from '@line-crm/line-sdk';
import type { EcEvent } from '../routes/ec-integrations.js';
import { logOutgoingMessage } from './event-bus.js';
import { pushViaHarnessProxy, type HarnessProxyDispatch } from './line-proxy-send.js';

const FOLLOW_UP_KEYS = ['arrival_check', 'review_request', 'cross_sell'] as const;
const MAX_JOBS_PER_TICK = 30;

type CampaignRow = {
  campaign_key: string;
  label: string;
  category: string;
  delay_days: number;
  delivery_time: string;
  is_enabled: number;
  title: string;
  body_text: string;
  button_label: string | null;
  button_url: string | null;
  image_url: string | null;
};

type DeliveryJob = {
  id: string;
  campaign_key: string;
  friend_id: string;
  line_account_id: string | null;
  source_key: string;
  payload: string;
};

export type NenDeliveryOptions = {
  proxyBaseUrl: string;
  defaultAccessToken: string;
  proxyDispatch?: HarnessProxyDispatch;
};

function sqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function scheduledAfter(occurredAt: string, days: number, deliveryTime: string): string {
  const base = new Date(occurredAt);
  const jst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const [hour, minute] = deliveryTime.split(':').map(Number);
  jst.setUTCDate(jst.getUTCDate() + days);
  jst.setUTCHours(Number.isFinite(hour) ? hour : 10, Number.isFinite(minute) ? minute : 0, 0, 0);
  return sqliteDate(new Date(jst.getTime() - 9 * 60 * 60 * 1000));
}

function orderSummary(event: EcEvent): string {
  const lines = (event.order?.items ?? []).slice(0, 4).map((item) => `${item.name} × ${item.quantity}`);
  if ((event.order?.items?.length ?? 0) > 4) lines.push(`ほか${(event.order?.items?.length ?? 0) - 4}点`);
  return lines.join('\n');
}

function renderCampaignCopy(value: string, payload: Record<string, unknown>): string {
  const pet = payload.pet as Record<string, unknown> | undefined;
  const coupon = payload.coupon as Record<string, unknown> | undefined;
  return value
    .replaceAll('{{pet_name}}', String(pet?.name || '大切なご家族'))
    .replaceAll('{{coupon_code}}', String(coupon?.code || ''))
    .replaceAll('{{coupon_expiry}}', String(coupon?.expires_at || '').slice(0, 10));
}

function flexMessage(campaign: CampaignRow, payload: Record<string, unknown>): Message {
  const article = payload.article as Record<string, unknown> | undefined;
  const coupon = payload.coupon as Record<string, unknown> | undefined;
  const event = payload.event as EcEvent | undefined;
  const heroUrl = String(article?.image_url || campaign.image_url || '');
  const destination = String(article?.article_url
    || (event?.event_type === 'ec.order.shipped' ? event.shipping?.tracking_url : event?.order?.detail_url)
    || campaign.button_url || '');
  const title = renderCampaignCopy(String(article?.title || campaign.title), payload);
  const body = renderCampaignCopy(String(article?.excerpt || campaign.body_text), payload);
  const details: Array<{ type: 'text'; text: string; size: 'sm'; color: string; wrap: true }> = [];
  if (event?.order?.number) details.push({ type: 'text', text: `注文番号：${event.order.number}`, size: 'sm', color: '#64748B', wrap: true });
  const items = event ? orderSummary(event) : '';
  if (items) details.push({ type: 'text', text: items, size: 'sm', color: '#64748B', wrap: true });
  if (typeof event?.order?.total === 'number') {
    details.push({ type: 'text', text: `合計：¥${Math.round(event.order.total).toLocaleString('ja-JP')}`, size: 'sm', color: '#64748B', wrap: true });
  }
  if (event?.order?.delivery_date) {
    details.push({
      type: 'text',
      text: `お届け予定：${event.order.delivery_date}${event.order.delivery_time ? ` ${event.order.delivery_time}` : ''}`,
      size: 'sm', color: '#64748B', wrap: true,
    });
  }
  if (event?.shipping?.carrier) details.push({ type: 'text', text: `配送会社：${event.shipping.carrier}`, size: 'sm', color: '#64748B', wrap: true });
  if (event?.shipping?.tracking_number) details.push({ type: 'text', text: `送り状番号：${event.shipping.tracking_number}`, size: 'sm', color: '#64748B', wrap: true });
  if (coupon?.code) details.push({ type: 'text', text: `クーポンコード：${String(coupon.code)}`, size: 'sm', color: '#0F766E', wrap: true });
  if (coupon?.expires_at) details.push({ type: 'text', text: `有効期限：${String(coupon.expires_at).slice(0, 10)}`, size: 'sm', color: '#64748B', wrap: true });

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    ...(heroUrl ? {
      hero: {
        type: 'image', url: heroUrl, size: 'full', aspectRatio: '3:2', aspectMode: 'cover',
        ...(destination ? { action: { type: 'uri', uri: destination } } : {}),
      },
    } : {}),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', color: '#123F2B', wrap: true },
        { type: 'text', text: body, size: 'sm', color: '#475569', wrap: true },
        ...details,
      ],
    },
    ...(destination && campaign.button_label ? {
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#0F766E',
          action: { type: 'uri', label: campaign.button_label.slice(0, 20), uri: destination },
        }],
      },
    } : {}),
  };
  return { type: 'flex', altText: title.slice(0, 400), contents: bubble } as Message;
}

export async function getNenCampaign(
  db: D1Database,
  campaignKey: string,
): Promise<CampaignRow | null> {
  return db.prepare(
    `SELECT campaign_key, label, category, delay_days, delivery_time, is_enabled,
            title, body_text, button_label, button_url, image_url
       FROM nen_campaign_settings WHERE campaign_key = ?`,
  ).bind(campaignKey).first<CampaignRow>();
}

export async function buildNenImmediateMessage(
  db: D1Database,
  event: EcEvent,
): Promise<{ enabled: boolean; message: Message | null }> {
  const key = event.event_type === 'ec.order.confirmed'
    ? 'order_confirmed'
    : event.event_type === 'ec.order.shipped' ? 'shipping_confirmed' : null;
  if (!key) return { enabled: true, message: null };
  const campaign = await getNenCampaign(db, key);
  if (!campaign) return { enabled: true, message: null };
  return {
    enabled: campaign.is_enabled === 1,
    message: campaign.is_enabled === 1 ? flexMessage(campaign, { event }) : null,
  };
}

export async function enqueuePostShippingFollowUps(
  db: D1Database,
  event: EcEvent,
  friendId: string,
  lineAccountId: string | null,
): Promise<number> {
  if (event.event_type !== 'ec.order.shipped') return 0;
  const campaigns = await db.prepare(
    `SELECT campaign_key, delay_days, delivery_time FROM nen_campaign_settings
      WHERE campaign_key IN ('arrival_check', 'review_request', 'cross_sell') AND is_enabled = 1`,
  ).all<{ campaign_key: string; delay_days: number; delivery_time: string }>();
  const now = jstNow();
  let created = 0;
  for (const campaign of campaigns.results) {
    if (!FOLLOW_UP_KEYS.includes(campaign.campaign_key as typeof FOLLOW_UP_KEYS[number])) continue;
    const result = await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at,
         status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), campaign.campaign_key, friendId, lineAccountId,
      event.event_id, JSON.stringify({ event }),
      scheduledAfter(event.shipping?.shipped_at || event.occurred_at, campaign.delay_days, campaign.delivery_time),
      now, now,
    ).run();
    created += result.meta.changes ?? 0;
  }
  return created;
}

export async function queueColumnDelivery(
  db: D1Database,
  columnId: string,
  lineAccountId: string,
  scheduledAt: string,
): Promise<number> {
  const column = await db.prepare(
    `SELECT id, title, excerpt, article_url, image_url FROM nen_columns WHERE id = ?`,
  ).bind(columnId).first<Record<string, unknown>>();
  if (!column) throw new Error('Column not found');
  const friends = await db.prepare(
    `SELECT id FROM friends WHERE line_account_id = ? AND is_following = 1`,
  ).bind(lineAccountId).all<{ id: string }>();
  const now = jstNow();
  let queued = 0;
  for (const friend of friends.results) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at,
         status, attempts, created_at, updated_at)
       VALUES (?, 'column', ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), friend.id, lineAccountId, `column:${columnId}`,
      JSON.stringify({ article: column }), scheduledAt, now, now,
    ).run();
    queued += result.meta.changes ?? 0;
  }
  await db.prepare(
    `UPDATE nen_columns SET delivery_status = ?, delivery_at = ?, line_account_id = ?, updated_at = ? WHERE id = ?`,
  ).bind(queued ? 'queued' : 'scheduled', scheduledAt, lineAccountId, now, columnId).run();
  return queued;
}

async function createEccubeCoupon(
  baseUrl: string,
  secret: string,
  coupon: { code: string; name: string; discountAmount: number; validFrom: string; validTo: string },
): Promise<void> {
  const body = JSON.stringify(coupon);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/line-harness/coupons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nen-Timestamp': timestamp, 'X-Nen-Signature': `sha256=${signature}` },
    body,
  });
  if (!response.ok && response.status !== 409) throw new Error(`EC-CUBE coupon API returned ${response.status}`);
}

export async function enqueueBirthdayCoupons(
  db: D1Database,
  now = new Date(),
  ecommerce?: { baseUrl: string; secret: string },
): Promise<number> {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  if (jst.getUTCDate() !== 1) return 0;
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const setting = await db.prepare(
    `SELECT is_enabled, code_prefix, benefit_label, discount_amount, validity_days
       FROM nen_birthday_coupon_settings WHERE id = 'default'`,
  ).first<{ is_enabled: number; code_prefix: string; benefit_label: string; discount_amount: number; validity_days: number }>();
  const campaign = await getNenCampaign(db, 'birthday_coupon');
  if (!setting || setting.is_enabled !== 1 || !campaign || campaign.is_enabled !== 1) return 0;
  const pets = await db.prepare(
    `SELECT p.id, p.friend_id, p.name, f.line_account_id
       FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id
      WHERE p.birthday IS NOT NULL AND substr(p.birthday, 6, 2) = ? AND f.is_following = 1`,
  ).bind(month).all<{ id: string; friend_id: string; name: string; line_account_id: string | null }>();
  const issuedAt = jstNow();
  const expires = new Date(now.getTime() + setting.validity_days * 86_400_000);
  let queued = 0;
  for (const pet of pets.results) {
    const existing = await db.prepare(
      `SELECT id FROM nen_coupon_issues WHERE pet_id = ? AND issue_year = ?`,
    ).bind(pet.id, year).first<{ id: string }>();
    if (existing) continue;
    const issueId = crypto.randomUUID();
    const code = `${setting.code_prefix.replace(/-/g, '').slice(0, 8)}-${String(year).slice(-2)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    if (ecommerce) {
      await createEccubeCoupon(ecommerce.baseUrl, ecommerce.secret, {
        code,
        name: `${pet.name} ${setting.benefit_label}`.slice(0, 50),
        discountAmount: setting.discount_amount,
        validFrom: now.toISOString(),
        validTo: expires.toISOString(),
      });
    }
    const issue = await db.prepare(
      `INSERT OR IGNORE INTO nen_coupon_issues
        (id, pet_id, friend_id, issue_year, coupon_code, benefit_label, expires_at, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(issueId, pet.id, pet.friend_id, year, code, setting.benefit_label, sqliteDate(expires), issuedAt).run();
    if (!issue.meta.changes) continue;
    await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, scheduled_at,
         status, attempts, created_at, updated_at)
       VALUES (?, 'birthday_coupon', ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), pet.friend_id, pet.line_account_id, `birthday:${pet.id}:${year}`,
      JSON.stringify({ pet: { id: pet.id, name: pet.name }, coupon: { code, expires_at: sqliteDate(expires), benefit_label: setting.benefit_label } }),
      sqliteDate(now), issuedAt, issuedAt,
    ).run();
    queued++;
  }
  return queued;
}

export async function syncNenPetProfiles(
  db: D1Database,
  event: EcEvent,
  friendId: string,
): Promise<number> {
  const pets = event.profile?.pets ?? [];
  const now = jstNow();
  let synced = 0;
  for (const pet of pets.slice(0, 20)) {
    const name = pet.name?.trim();
    if (!name) continue;
    const externalId = pet.id == null ? null : `eccube:${pet.id}`;
    if (externalId) {
      await db.prepare(
        `INSERT INTO nen_pet_profiles
          (id, external_id, friend_id, customer_id, name, animal_type, gender, birthday, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(external_id) DO UPDATE SET friend_id = excluded.friend_id,
           customer_id = excluded.customer_id, name = excluded.name, animal_type = excluded.animal_type,
           gender = excluded.gender, birthday = excluded.birthday, updated_at = excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), externalId, friendId,
        event.customer_id == null ? null : String(event.customer_id), name,
        pet.animal_type || 'dog', pet.gender || 'unknown', pet.birthday || null, now, now,
      ).run();
    } else {
      await db.prepare(
        `INSERT INTO nen_pet_profiles
          (id, external_id, friend_id, customer_id, name, animal_type, gender, birthday, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), friendId, event.customer_id == null ? null : String(event.customer_id),
        name, pet.animal_type || 'dog', pet.gender || 'unknown', pet.birthday || null, now, now,
      ).run();
    }
    synced++;
  }
  return synced;
}

export async function processNenDeliveries(
  db: D1Database,
  options: NenDeliveryOptions,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const jobs = await db.prepare(
    `SELECT id, campaign_key, friend_id, line_account_id, source_key, payload
       FROM nen_delivery_jobs
      WHERE status IN ('pending', 'failed') AND datetime(scheduled_at) <= datetime('now')
        AND attempts < 5
      ORDER BY scheduled_at ASC LIMIT ?`,
  ).bind(MAX_JOBS_PER_TICK).all<DeliveryJob>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const job of jobs.results) {
    const claim = await db.prepare(
      `UPDATE nen_delivery_jobs SET status = 'processing', attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'failed')`,
    ).bind(jstNow(), job.id).run();
    if (!claim.meta.changes) continue;
    try {
      const [friend, campaign] = await Promise.all([
        getFriendById(db, job.friend_id),
        getNenCampaign(db, job.campaign_key),
      ]);
      if (!friend || !friend.is_following || !campaign || campaign.is_enabled !== 1) {
        await db.prepare(
          `UPDATE nen_delivery_jobs SET status = 'skipped', last_error = ?, updated_at = ? WHERE id = ?`,
        ).bind(!friend || !friend.is_following ? 'friend_unavailable' : 'campaign_disabled', jstNow(), job.id).run();
        skipped++;
        continue;
      }
      const account = job.line_account_id ? await getLineAccountById(db, job.line_account_id) : null;
      const accessToken = account?.channel_access_token || options.defaultAccessToken;
      const payload = JSON.parse(job.payload) as Record<string, unknown>;
      const message = flexMessage(campaign, payload);
      await pushViaHarnessProxy(
        options.proxyBaseUrl, accessToken, friend.line_user_id, [message], job.id, options.proxyDispatch,
      );
      await logOutgoingMessage(db, {
        friendId: friend.id,
        messageType: message.type,
        content: JSON.stringify(message),
        deliveryType: 'push',
        source: `nen_${job.campaign_key}`,
        lineAccountId: account?.id ?? job.line_account_id,
      });
      await db.prepare(
        `UPDATE nen_delivery_jobs SET status = 'sent', sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
      ).bind(jstNow(), jstNow(), job.id).run();
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
      await db.prepare(
        `UPDATE nen_delivery_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
      ).bind(message, jstNow(), job.id).run();
      console.error(JSON.stringify({ event: 'nen_delivery_failed', jobId: job.id, error: message }));
      failed++;
    }
  }
  return { sent, failed, skipped };
}

export { flexMessage as buildNenFlexMessage };
