import { Hono, type Context } from 'hono';
import { getLineAccountById, jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  type CampaignRow,
  buildDefaultColumnIntro,
  buildNenDeliveryMessages,
  getNenBirthdayCouponSetting,
  getNenCampaign,
  queueColumnDelivery,
  saveNenBirthdayCouponSetting,
  saveNenCampaignAccountSetting,
} from '../services/nen-engagement.js';
import { syncNenPetTags } from '../services/nen-tag-sync.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

const nenCampaigns = new Hono<Env>();
const CAMPAIGN_KEYS = new Set([
  'arrival_check', 'review_request', 'cross_sell', 'column', 'birthday_coupon',
]);
const MAX_BODY_BYTES = 256 * 1024;
const ACCOUNT_ACCESS_ERROR = 'このLINEアカウントを操作する権限がありません';

async function requireAccount(c: Context<Env>): Promise<string | Response> {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  return accountId;
}

function isUrl(value: string): boolean {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

async function verifyEccubeSignature(secret: string, timestamp: string, signature: string, body: string): Promise<boolean> {
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const provided = signature.replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

nenCampaigns.get('/api/nen-campaigns/overview', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const [settings, jobs, columns, pets, coupons] = await Promise.all([
    Promise.all([...CAMPAIGN_KEYS].map((key) => getNenCampaign(c.env.DB, key, accountId))),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM nen_delivery_jobs WHERE line_account_id = ?`,
    ).bind(accountId).first<{ total: number; pending: number; sent: number; failed: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM nen_columns WHERE line_account_id = ?`).bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id WHERE f.line_account_id = ?`,
    ).bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM nen_coupon_issues c JOIN friends f ON f.id = c.friend_id WHERE f.line_account_id = ?`,
    ).bind(accountId).first<{ count: number }>(),
  ]);
  return c.json({ success: true, data: {
    activeCampaigns: settings.filter((setting) => setting?.is_enabled === 1).length,
    jobs: { total: jobs?.total ?? 0, pending: jobs?.pending ?? 0, sent: jobs?.sent ?? 0, failed: jobs?.failed ?? 0 },
    columns: columns?.count ?? 0,
    pets: pets?.count ?? 0,
    coupons: coupons?.count ?? 0,
  } });
});

nenCampaigns.get('/api/nen-campaigns/settings', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const keys = await c.env.DB.prepare(
    `SELECT campaign_key FROM nen_campaign_settings WHERE category != 'transactional' ORDER BY rowid`,
  ).all<{ campaign_key: string }>();
  const settings = (await Promise.all(
    keys.results.map((row) => getNenCampaign(c.env.DB, row.campaign_key, accountId)),
  )).filter((row): row is CampaignRow => Boolean(row));
  return c.json({ success: true, data: settings.map((row) => ({
    campaignKey: row.campaign_key,
    label: row.label,
    category: row.category,
    triggerEvent: row.trigger_event ?? null,
    delayDays: row.delay_days,
    deliveryTime: row.delivery_time,
    isEnabled: row.is_enabled === 1,
    title: row.title,
    bodyText: row.body_text,
    buttonLabel: row.button_label,
    buttonUrl: row.button_url,
    imageUrl: row.image_url,
    updatedAt: row.updated_at ?? '',
  })) });
});

nenCampaigns.put('/api/nen-campaigns/settings/:campaignKey', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const key = c.req.param('campaignKey');
  if (!CAMPAIGN_KEYS.has(key)) return c.json({ success: false, error: 'Invalid campaign' }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.isEnabled !== 'boolean' || typeof body.title !== 'string'
      || typeof body.bodyText !== 'string' || typeof body.deliveryTime !== 'string') {
    return c.json({ success: false, error: 'Invalid body' }, 400);
  }
  const delayDays = Number(body.delayDays);
  const buttonLabel = typeof body.buttonLabel === 'string' ? body.buttonLabel.trim() : '';
  const buttonUrl = typeof body.buttonUrl === 'string' ? body.buttonUrl.trim() : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';
  if (!body.title.trim() || body.title.trim().length > 120 || body.bodyText.length > 1500
      || !Number.isInteger(delayDays) || delayDays < 0 || delayDays > 365
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.deliveryTime)
      || buttonLabel.length > 20 || !isUrl(buttonUrl) || !isUrl(imageUrl)) {
    return c.json({ success: false, error: 'Invalid campaign values' }, 400);
  }
  const current = await getNenCampaign(c.env.DB, key, accountId);
  if (!current) return c.json({ success: false, error: 'Campaign not found' }, 404);
  await saveNenCampaignAccountSetting(c.env.DB, accountId, {
    ...current,
    is_enabled: body.isEnabled ? 1 : 0,
    title: body.title.trim(),
    body_text: body.bodyText.trim(),
    delay_days: delayDays,
    delivery_time: body.deliveryTime,
    button_label: buttonLabel || null,
    button_url: buttonUrl || null,
    image_url: imageUrl || null,
    updated_at: jstNow(),
  });
  return c.json({ success: true });
});

nenCampaigns.post('/api/nen-campaigns/test-send', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ campaignKey?: string; accountId?: string; friendId?: string }>().catch(() => null);
  if (!body?.campaignKey || !CAMPAIGN_KEYS.has(body.campaignKey) || !body.accountId || !body.friendId) {
    return c.json({ success: false, error: 'campaignKey, accountId and friendId are required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const [campaign, account, friend] = await Promise.all([
    getNenCampaign(c.env.DB, body.campaignKey, body.accountId),
    getLineAccountById(c.env.DB, body.accountId),
    c.env.DB.prepare(
      `SELECT id, line_user_id FROM friends WHERE id = ? AND line_account_id = ? AND is_following = 1`,
    ).bind(body.friendId, body.accountId).first<{ id: string; line_user_id: string }>(),
  ]);
  if (!campaign || !account || !friend) return c.json({ success: false, error: 'Test target not found' }, 404);
  const sample = {
    event: {
      event_id: `test-${crypto.randomUUID()}`, event_type: 'ec.order.shipped', occurred_at: new Date().toISOString(),
      line_user_id: friend.line_user_id,
      order: { number: 'NEN-TEST-001', items: [{ name: '鹿肉ミンチ', quantity: 2 }], total: 2860, detail_url: campaign.button_url },
      shipping: { carrier: 'ヤマト運輸', tracking_number: '1234-5678-9012', tracking_url: campaign.button_url },
    },
    article: { title: '愛犬・愛猫の健康を考えるNENコラム', excerpt: campaign.body_text, article_url: campaign.button_url, image_url: campaign.image_url },
    coupon: { code: 'NEN-BIRTHDAY-TEST', expires_at: '2026-09-30' },
  };
  const messages = buildNenDeliveryMessages(campaign, sample);
  const { pushViaHarnessProxy } = await import('../services/line-proxy-send.js');
  const { dispatchLineProxyLocally } = await import('../services/local-line-proxy.js');
  await pushViaHarnessProxy(
    c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin,
    account.channel_access_token,
    friend.line_user_id,
    messages,
    crypto.randomUUID(),
    (request) => dispatchLineProxyLocally(request, c.env),
  );
  return c.json({ success: true });
});

nenCampaigns.get('/api/nen-campaigns/jobs', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.campaign_key, s.label, f.display_name, j.scheduled_at, j.status,
            j.attempts, j.last_error, j.sent_at
       FROM nen_delivery_jobs j
       JOIN nen_campaign_settings s ON s.campaign_key = j.campaign_key
       JOIN friends f ON f.id = j.friend_id
      WHERE j.line_account_id = ?
      ORDER BY j.created_at DESC LIMIT 100`,
  ).bind(accountId).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results.map((row) => ({
    id: row.id, campaignKey: row.campaign_key, label: row.label, friendName: row.display_name,
    scheduledAt: row.scheduled_at, status: row.status, attempts: row.attempts,
    lastError: row.last_error, sentAt: row.sent_at,
  })) });
});

nenCampaigns.get('/api/nen-campaigns/columns', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const rows = await c.env.DB.prepare(
    `SELECT * FROM nen_columns WHERE line_account_id = ? ORDER BY published_at DESC, created_at DESC`,
  ).bind(accountId).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results.map((row) => ({
    id: row.id, externalId: row.external_id, slug: row.slug, title: row.title, category: row.category,
    excerpt: row.excerpt, introText: typeof row.intro_text === 'string' && row.intro_text.trim()
      ? row.intro_text
      : buildDefaultColumnIntro(String(row.title || ''), String(row.excerpt || '')),
    articleUrl: row.article_url, imageUrl: row.image_url,
    publishedAt: row.published_at, deliveryStatus: row.delivery_status, deliveryAt: row.delivery_at,
    lineAccountId: row.line_account_id, updatedAt: row.updated_at,
  })) });
});

nenCampaigns.post('/api/nen-campaigns/columns/:id/deliver', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string; scheduledAt?: string }>().catch(() => null);
  if (!body?.accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const when = body.scheduledAt && Number.isFinite(Date.parse(body.scheduledAt))
    ? new Date(body.scheduledAt).toISOString().slice(0, 19).replace('T', ' ')
    : new Date().toISOString().slice(0, 19).replace('T', ' ');
  const queued = await queueColumnDelivery(c.env.DB, c.req.param('id'), body.accountId, when);
  return c.json({ success: true, data: { queued } });
});

nenCampaigns.put('/api/nen-campaigns/columns/:id/message', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<{ introText?: string }>().catch(() => null);
  const introText = body?.introText?.trim() || '';
  if (!introText || introText.length > 1500) {
    return c.json({ success: false, error: 'introText is required and must be 1500 characters or fewer' }, 400);
  }
  const result = await c.env.DB.prepare(
    `UPDATE nen_columns SET intro_text = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
  ).bind(introText, jstNow(), c.req.param('id'), accountId).run();
  if (!result.meta.changes) return c.json({ success: false, error: 'Column not found' }, 404);
  return c.json({ success: true });
});

nenCampaigns.get('/api/nen-campaigns/pets', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const query = (c.req.query('search') || '').trim();
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.friend_id, p.customer_id, p.name, p.animal_type, p.gender, p.birthday,
            f.display_name, f.line_user_id
       FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id
      WHERE f.line_account_id = ?
        AND (? = '' OR p.name LIKE ? ESCAPE '\\' OR f.display_name LIKE ? ESCAPE '\\')
      ORDER BY p.updated_at DESC LIMIT 200`,
  ).bind(accountId, query, like, like).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results.map((row) => ({
    id: row.id, friendId: row.friend_id, customerId: row.customer_id, name: row.name,
    animalType: row.animal_type, gender: row.gender, birthday: row.birthday,
    ownerName: row.display_name, lineUserId: row.line_user_id,
  })) });
});

nenCampaigns.post('/api/nen-campaigns/pets', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.friendId !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ success: false, error: 'friendId and name are required' }, 400);
  }
  const animalType = ['dog', 'cat', 'other'].includes(String(body.animalType)) ? String(body.animalType) : 'dog';
  const gender = ['male', 'female', 'unknown'].includes(String(body.gender)) ? String(body.gender) : 'unknown';
  const birthday = typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday) ? body.birthday : null;
  const friend = await c.env.DB.prepare(`SELECT id, line_account_id FROM friends WHERE id = ?`)
    .bind(body.friendId).first<{ id: string; line_account_id: string | null }>();
  if (!friend || friend.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }
  const now = jstNow();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO nen_pet_profiles (id, friend_id, customer_id, name, animal_type, gender, birthday, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.friendId, typeof body.customerId === 'string' ? body.customerId : null, body.name.trim(), animalType, gender, birthday, now, now).run();
  await syncNenPetTags(c.env.DB, body.friendId);
  return c.json({ success: true, data: { id } }, 201);
});

nenCampaigns.put('/api/nen-campaigns/pets/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return c.json({ success: false, error: 'name is required' }, 400);
  const animalType = ['dog', 'cat', 'other'].includes(String(body.animalType)) ? String(body.animalType) : 'dog';
  const gender = ['male', 'female', 'unknown'].includes(String(body.gender)) ? String(body.gender) : 'unknown';
  const birthday = typeof body.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.birthday) ? body.birthday : null;
  const pet = await c.env.DB.prepare(`SELECT p.friend_id, f.line_account_id FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id WHERE p.id = ?`)
    .bind(c.req.param('id')).first<{ friend_id: string; line_account_id: string | null }>();
  if (!pet || pet.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Pet not found' }, 404);
  }
  await c.env.DB.prepare(
    `UPDATE nen_pet_profiles SET name = ?, animal_type = ?, gender = ?, birthday = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.name.trim(), animalType, gender, birthday, jstNow(), c.req.param('id')).run();
  await syncNenPetTags(c.env.DB, pet.friend_id);
  return c.json({ success: true });
});

nenCampaigns.delete('/api/nen-campaigns/pets/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const pet = await c.env.DB.prepare(`SELECT p.friend_id, f.line_account_id FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id WHERE p.id = ?`)
    .bind(c.req.param('id')).first<{ friend_id: string; line_account_id: string | null }>();
  if (!pet || pet.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Pet not found' }, 404);
  }
  await c.env.DB.prepare(`DELETE FROM nen_pet_profiles WHERE id = ?`).bind(c.req.param('id')).run();
  await syncNenPetTags(c.env.DB, pet.friend_id);
  return c.json({ success: true });
});

nenCampaigns.get('/api/nen-campaigns/birthday-coupon', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const row = await getNenBirthdayCouponSetting(c.env.DB, accountId);
  return c.json({ success: true, data: {
    isEnabled: row?.is_enabled === 1, codePrefix: row?.code_prefix ?? '',
    benefitLabel: row?.benefit_label ?? '', discountAmount: row?.discount_amount ?? 0,
    validityDays: row?.validity_days ?? 0, updatedAt: row?.updated_at ?? '',
  } });
});

nenCampaigns.put('/api/nen-campaigns/birthday-coupon', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const days = Number(body?.validityDays);
  const amount = Number(body?.discountAmount);
  if (!body || typeof body.isEnabled !== 'boolean' || typeof body.codePrefix !== 'string'
      || !/^[A-Z0-9-]{3,10}$/.test(body.codePrefix) || typeof body.benefitLabel !== 'string'
      || !body.benefitLabel.trim() || !Number.isInteger(amount) || amount < 1 || amount > 100000
      || !Number.isInteger(days) || days < 1 || days > 365) {
    return c.json({ success: false, error: 'Invalid coupon settings' }, 400);
  }
  await saveNenBirthdayCouponSetting(c.env.DB, accountId, {
    is_enabled: body.isEnabled ? 1 : 0,
    code_prefix: body.codePrefix,
    benefit_label: body.benefitLabel.trim(),
    discount_amount: amount,
    validity_days: days,
    updated_at: jstNow(),
  });
  return c.json({ success: true });
});

// EC-CUBEのコラム保存時に自動同期する公開エンドポイント。管理者認証ではなくHMACで検証する。
nenCampaigns.post('/api/integrations/eccube/columns', async (c) => {
  const secret = c.env.ECCUBE_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return c.json({ success: false, error: 'Integration is not configured' }, 503);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return c.json({ success: false, error: 'Payload too large' }, 413);
  const valid = await verifyEccubeSignature(
    secret, c.req.header('x-nen-timestamp') || '', c.req.header('x-nen-signature') || '', raw,
  );
  if (!valid) return c.json({ success: false, error: 'Invalid signature' }, 401);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body.slug !== 'string' || typeof body.title !== 'string' || typeof body.article_url !== 'string'
      || !body.slug || !body.title || !isUrl(body.article_url)
      || (body.image_url && (typeof body.image_url !== 'string' || !isUrl(body.image_url)))) {
    return c.json({ success: false, error: 'Invalid column' }, 400);
  }
  const lineAccountId = typeof body.line_account_id === 'string' ? body.line_account_id : null;
  if (lineAccountId && !await getLineAccountById(c.env.DB, lineAccountId)) {
    return c.json({ success: false, error: 'LINE account not found' }, 404);
  }
  const now = jstNow();
  const existing = await c.env.DB.prepare(
    `SELECT id, line_account_id FROM nen_columns WHERE slug = ?`,
  ).bind(body.slug).first<{ id: string; line_account_id: string | null }>();
  if (existing?.line_account_id && lineAccountId && existing.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Column belongs to another LINE account' }, 409);
  }
  const id = existing?.id || crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO nen_columns
      (id, external_id, slug, title, category, excerpt, intro_text, article_url, image_url, published_at, delivery_status, line_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET external_id = excluded.external_id, title = excluded.title,
       category = excluded.category, excerpt = excluded.excerpt, article_url = excluded.article_url,
       image_url = excluded.image_url, published_at = excluded.published_at,
       line_account_id = COALESCE(excluded.line_account_id, nen_columns.line_account_id), updated_at = excluded.updated_at`,
  ).bind(
    id, typeof body.external_id === 'string' ? body.external_id : body.slug, body.slug, body.title,
    typeof body.category === 'string' ? body.category : null,
    typeof body.excerpt === 'string' ? body.excerpt.slice(0, 500) : '',
    buildDefaultColumnIntro(body.title, typeof body.excerpt === 'string' ? body.excerpt.slice(0, 500) : ''), body.article_url,
    typeof body.image_url === 'string' ? body.image_url : null,
    typeof body.published_at === 'string' ? body.published_at : null, lineAccountId, now, now,
  ).run();
  return c.json({ success: true, data: { id } });
});

export { nenCampaigns };
