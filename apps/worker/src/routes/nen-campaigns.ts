import { Hono, type Context } from 'hono';
import { getLineAccountById, jstNow, recordConversionSourceEvent } from '@line-crm/db';
import {
  checkNenCampaignBodyLength,
  countNenCampaignBodyLength,
  NEN_CAMPAIGN_BODY_MAX_LENGTH,
  NEN_PET_NAME_MAX_LENGTH,
} from '@line-crm/shared';
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
  parseNenCampaignAfterActions,
} from '../services/nen-engagement.js';
import { syncNenPetTags } from '../services/nen-tag-sync.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  buildNenColumnStorageFields,
  isNenColumnSlugConflict,
  normalizeHttpsUrl,
  readBoundedJsonObject,
  validateNenColumnCreateBody,
} from '../services/nen-column-contract.js';
import {
  duplicateNenColumn,
  NenColumnOperationError,
  previewNenColumnAudience,
  recordNenColumnReadEvent,
  sendPendingNenDeliveriesNow,
} from '../services/nen-column-operations.js';
import {
  getNenColumnMetrics,
  getNenDeliveryDetail,
  getNenFlowMetrics,
  getNenPetMetrics,
  listNenDeliveries,
  nenDeliveryRange,
  NenCampaignMetricsError,
  nenMetricsRange,
  normalizeDeliveryStatus,
  retryNenDelivery,
} from '../services/nen-campaign-metrics.js';
import { auditLog } from '../lib/audit-log.js';
import { normalizeNenPetBirthday } from '../lib/nen-pet-birthday.js';
import { listLimit, listOffset } from './list-pagination.js';

const nenCampaigns = new Hono<Env>();
const CAMPAIGN_KEYS = new Set([
  'arrival_check', 'review_request', 'cross_sell', 'column', 'birthday_coupon',
]);
const MAX_BODY_BYTES = 256 * 1024;
const ACCOUNT_ACCESS_ERROR = 'このLINEアカウントを操作する権限がありません';

async function getTestRecipient(c: Context<Env>, accountId: string, friendId: string) {
  return c.env.DB.prepare(
    `SELECT f.id, f.line_user_id
       FROM friends f
       JOIN account_settings s ON s.line_account_id = f.line_account_id
        AND s.key = 'test_recipients' AND json_valid(s.value) AND json_type(s.value) = 'array'
      WHERE f.id = ? AND f.line_account_id = ? AND f.is_following = 1
        AND EXISTS (SELECT 1 FROM json_each(s.value) WHERE value = f.id)`,
  ).bind(friendId, accountId).first<{ id: string; line_user_id: string }>();
}

async function requireAccount(c: Context<Env>): Promise<string | Response> {
  const accountId = c.req.query('lineAccountId');
  if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  return accountId;
}

function metricsError(c: Context<Env>, error: unknown): Response {
  if (error instanceof NenCampaignMetricsError) {
    return c.json({
      success: false,
      code: error.code,
      error: error.message,
      ...(error.field ? { field: error.field } : {}),
    }, error.status);
  }
  console.error(JSON.stringify({
    event: 'nen_campaign_metrics_failed',
    path: c.req.path,
    reason: error instanceof Error ? error.message : String(error),
  }));
  return c.json({ success: false, error: 'NEN配信の情報を取得できませんでした' }, 500);
}

function columnOperationError(c: Context<Env>, error: unknown): Response {
  if (error instanceof NenColumnOperationError) {
    return c.json({ success: false, code: error.code, error: error.message }, error.status);
  }
  console.error('NEN column operation failed:', error);
  return c.json({ success: false, error: 'NENコラムを操作できませんでした' }, 500);
}

function cursorOffset(value: string | undefined): number {
  if (!value) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new NenCampaignMetricsError('cursor_invalid', '続きの位置が正しくありません', 400, 'cursor');
  }
  return Number(value);
}

function isUrl(value: string): boolean {
  return !value || normalizeHttpsUrl(value, { allowCredentials: true }) !== null;
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
              SUM(CASE WHEN status = 'pending' AND datetime(scheduled_at) > datetime('now') THEN 1 ELSE 0 END) AS pending,
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
  // jobs.pending は「これから送る未来ぶん」の件数。pending-now 口の数え方と
  // 同じ決めごとにする(点検 #512 の中2)。一覧の窓付き集計とは別物。
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
    dedupWindowDays: row.dedup_window_days ?? 30,
    excludeFormRespondents: row.exclude_form_respondents === 1,
    afterActions: row.after_actions ?? [],
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
  const afterActions = body.afterActions === undefined ? [] : parseNenCampaignAfterActions(body.afterActions);
  if (body.afterActions !== undefined
      && (!Array.isArray(body.afterActions) || afterActions.length !== body.afterActions.length)) {
    return c.json({ success: false, error: 'Invalid campaign actions' }, 400);
  }
  // 本文の上限は画面と同じ採用上限（NEN_CAMPAIGN_BODY_MAX_LENGTH）。数え方も
  // 画面の残数表示と同じ関数で測り、超過時は字数を添えて理由を返す。
  const bodyCheck = checkNenCampaignBodyLength(body.bodyText);
  if (!bodyCheck.fits) {
    return c.json({
      success: false,
      error: `本文は${NEN_CAMPAIGN_BODY_MAX_LENGTH.toLocaleString('ja-JP')}字以内で入力してください（現在${bodyCheck.length.toLocaleString('ja-JP')}字）`,
    }, 400);
  }
  if (!body.title.trim() || body.title.trim().length > 120
      || !Number.isInteger(delayDays) || delayDays < 0 || delayDays > 365
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.deliveryTime)
      || buttonLabel.length > 20 || !isUrl(buttonUrl) || !isUrl(imageUrl)) {
    return c.json({ success: false, error: 'Invalid campaign values' }, 400);
  }
  const current = await getNenCampaign(c.env.DB, key, accountId);
  if (!current) return c.json({ success: false, error: 'Campaign not found' }, 404);
  const dedupWindowDays = body.dedupWindowDays === undefined
    ? (current.dedup_window_days ?? 30)
    : Number(body.dedupWindowDays);
  const excludeFormRespondents = body.excludeFormRespondents === undefined
    ? current.exclude_form_respondents === 1
    : body.excludeFormRespondents;
  if (!Number.isInteger(dedupWindowDays) || dedupWindowDays < 0 || dedupWindowDays > 365
      || typeof excludeFormRespondents !== 'boolean') {
    return c.json({ success: false, error: 'Invalid delivery safeguards' }, 400);
  }
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
    dedup_window_days: dedupWindowDays,
    exclude_form_respondents: excludeFormRespondents ? 1 : 0,
    after_actions: afterActions,
    updated_at: jstNow(),
  });
  return c.json({ success: true });
});

// 一覧の停止・再開（isEnabledだけの切り替え）専用の口。上のPUTと同じ口を
// 使うと、本文・題名などを送り直すことになり、保存済み本文が上限を超えて
// いる場合に停止すらできなくなる（#659差し戻し2点目）。停止は本文の長さに
// 関わらず必ず実行できる必要があるため、is_enabled以外は今の値のまま
// 変えず、本文の長さ検査も行わない。
nenCampaigns.put('/api/nen-campaigns/settings/:campaignKey/enabled', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const key = c.req.param('campaignKey');
  if (!CAMPAIGN_KEYS.has(key)) return c.json({ success: false, error: 'Invalid campaign' }, 400);
  const body = await c.req.json<{ isEnabled?: unknown }>().catch(() => null);
  if (!body || typeof body.isEnabled !== 'boolean') {
    return c.json({ success: false, error: 'isEnabled is required' }, 400);
  }
  const current = await getNenCampaign(c.env.DB, key, accountId);
  if (!current) return c.json({ success: false, error: 'Campaign not found' }, 404);
  await saveNenCampaignAccountSetting(c.env.DB, accountId, {
    ...current,
    is_enabled: body.isEnabled ? 1 : 0,
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
    getTestRecipient(c, body.accountId, body.friendId),
  ]);
  // テスト送信先は「設定 › アカウント › テスト送信先」に登録され、かつ友だち追加中の人だけ。
  // 画面が理由を言えるよう、送信先の問題は code で分ける。
  if (!friend) return c.json({ success: false, code: 'test_recipient_unavailable', error: 'テスト送信先が登録されていないか、友だち追加されていません' }, 404);
  if (!campaign || !account) return c.json({ success: false, error: 'Test target not found' }, 404);
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

nenCampaigns.get('/api/nen-campaigns/metrics/flows', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    // ★V6 37-6: 「今月」「先月」の数値カードは from/to で月の範囲を渡す（deliveries 口と同じ決めごと）。
    const data = await getNenFlowMetrics(c.env.DB, accountId, nenDeliveryRange({
      from: c.req.query('from'), to: c.req.query('to'), days: c.req.query('days'),
    }));
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.get('/api/nen-campaigns/metrics/columns', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    const data = await getNenColumnMetrics(c.env.DB, accountId, nenDeliveryRange({
      from: c.req.query('from'), to: c.req.query('to'), days: c.req.query('days'),
    }));
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.get('/api/nen-campaigns/metrics/pets', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    const data = await getNenPetMetrics(c.env.DB, accountId, nenMetricsRange(c.req.query('days')));
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.get('/api/nen-campaigns/deliveries', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    const data = await listNenDeliveries(c.env.DB, {
      lineAccountId: accountId,
      range: nenDeliveryRange({
        from: c.req.query('from'),
        to: c.req.query('to'),
        days: c.req.query('days'),
      }),
      status: normalizeDeliveryStatus(c.req.query('status')),
      q: c.req.query('q'),
      cursor: cursorOffset(c.req.query('cursor')),
      limit: listLimit(c.req.query('limit'), 50, 100),
    });
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.get('/api/nen-campaigns/deliveries/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    const data = await getNenDeliveryDetail(c.env.DB, c.req.param('id'), accountId);
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.post('/api/nen-campaigns/deliveries/:id/retry', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const accountId = typeof body?.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
  if (!accountId) return c.json({ success: false, error: 'LINEアカウントを選択してください' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  try {
    const data = await retryNenDelivery(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: accountId,
      expectedVersion: Number(body?.expectedVersion),
      reason: typeof body?.reason === 'string' ? body.reason : '',
      staffId: c.get('staff').id,
    });
    auditLog(c, 'nen.delivery.retry', { kind: 'nen_delivery', id: data.id });
    return c.json({ success: true, data });
  } catch (error) {
    return metricsError(c, error);
  }
});

nenCampaigns.get('/api/nen-campaigns/columns', async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  // 件数制限なしの全件取得は件数が増えると重い(点検 #512 の中6)。上限200・page送り付き。
  const limit = listLimit(c.req.query('limit'), 200);
  const offset = listOffset(c.req.query('offset'));
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM nen_columns WHERE line_account_id = ?`,
  ).bind(accountId).first<{ total: number }>();
  const total = Number(totalRow?.total ?? 0);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM nen_columns WHERE line_account_id = ? ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?`,
  ).bind(accountId, limit, offset).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results.map((row) => ({
    id: row.id, externalId: row.external_id, slug: row.slug, title: row.title, category: row.category,
    excerpt: row.excerpt, introText: typeof row.intro_text === 'string' && row.intro_text.trim()
      ? row.intro_text
      : buildDefaultColumnIntro(String(row.title || ''), String(row.excerpt || '')),
    articleUrl: row.article_url, imageUrl: row.image_url,
    publishedAt: row.published_at, deliveryStatus: row.delivery_status, deliveryAt: row.delivery_at,
    lineAccountId: row.line_account_id, updatedAt: row.updated_at,
    targetMode: row.target_mode === 'tag' ? 'tag' : 'all', targetTagId: row.target_tag_id ?? null,
    completionEventName: row.completion_event_name ?? null, completionTagId: row.completion_tag_id ?? null,
    sourceColumnId: row.source_column_id ?? null,
  })),
  pagination: { total, limit, offset },
  });
});

nenCampaigns.get('/api/nen-campaigns/columns-preview', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  try {
    const targetMode = c.req.query('targetMode') === 'tag' ? 'tag' : 'all';
    const data = await previewNenColumnAudience(c.env.DB, {
      lineAccountId: accountId, targetMode, targetTagId: c.req.query('targetTagId')?.trim() || null,
    });
    return c.json({ success: true, data });
  } catch (error) {
    return columnOperationError(c, error);
  }
});

nenCampaigns.post('/api/nen-campaigns/columns', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;

  const parsed = await readBoundedJsonObject(c.req.raw);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, parsed.status);
  const validated = validateNenColumnCreateBody(parsed.value);
  if (!validated.ok) return c.json({ success: false, error: validated.error }, 400);

  const input = validated.value;
  for (const tagId of new Set([input.targetTagId, input.completionTagId].filter((value): value is string => Boolean(value)))) {
    const tag = await c.env.DB.prepare(
      `SELECT id FROM tags WHERE id = ? AND line_account_id = ?`,
    ).bind(tagId, accountId).first<{ id: string }>();
    if (!tag) return c.json({ success: false, error: 'target_invalid' }, 400);
  }
  if (input.sourceColumnId) {
    const source = await c.env.DB.prepare(
      `SELECT id FROM nen_columns WHERE id = ? AND line_account_id = ?`,
    ).bind(input.sourceColumnId, accountId).first<{ id: string }>();
    if (!source) return c.json({ success: false, error: 'target_invalid' }, 400);
  }
  const existing = await c.env.DB.prepare(
    `SELECT id FROM nen_columns WHERE slug = ?`,
  ).bind(input.slug).first<{ id: string }>();
  if (existing) return c.json({ success: false, error: 'column_already_exists' }, 409);

  const id = crypto.randomUUID();
  const now = jstNow();
  const fields = buildNenColumnStorageFields(input);
  try {
    await c.env.DB.prepare(
      `INSERT INTO nen_columns
        (id, external_id, slug, title, category, excerpt, intro_text, article_url, image_url,
         published_at, delivery_status, line_account_id, target_mode, target_tag_id,
         completion_event_name, completion_tag_id, source_column_id, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.slug, fields.title, fields.category, fields.excerpt, fields.introText,
      fields.articleUrl, fields.imageUrl, fields.publishedAt, accountId, input.targetMode,
      input.targetTagId, input.completionEventName, input.completionTagId, input.sourceColumnId, now, now,
    ).run();
  } catch (error) {
    if (isNenColumnSlugConflict(error)) {
      return c.json({ success: false, error: 'column_already_exists' }, 409);
    }
    console.error(JSON.stringify({
      message: 'failed to create NEN column draft',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ success: false, error: 'column_create_failed' }, 500);
  }
  const queued = input.scheduledAt ? await queueColumnDelivery(
    c.env.DB, id, accountId, input.scheduledAt.slice(0, 19).replace('T', ' '),
  ) : 0;
  return c.json({ success: true, data: { id, queued } }, 201);
});

nenCampaigns.post('/api/nen-campaigns/columns/:id/duplicate', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch(() => null);
  if (!body?.accountId || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  try {
    const data = await duplicateNenColumn(c.env.DB, { id: c.req.param('id'), lineAccountId: body.accountId });
    auditLog(c, 'nen.column.duplicate', { kind: 'nen_column', id: data.id });
    return c.json({ success: true, data }, 201);
  } catch (error) {
    return columnOperationError(c, error);
  }
});

nenCampaigns.post('/api/nen-campaigns/columns/:id/test-send', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string; friendId?: string }>().catch(() => null);
  if (!body?.accountId || !body.friendId) {
    return c.json({ success: false, error: 'accountId and friendId are required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  const [campaign, account, friend, column] = await Promise.all([
    getNenCampaign(c.env.DB, 'column', body.accountId),
    getLineAccountById(c.env.DB, body.accountId),
    getTestRecipient(c, body.accountId, body.friendId),
    c.env.DB.prepare(
      `SELECT title, excerpt, article_url, image_url, intro_text FROM nen_columns
        WHERE id = ? AND line_account_id = ?`,
    ).bind(c.req.param('id'), body.accountId).first<Record<string, unknown>>(),
  ]);
  if (!friend) return c.json({ success: false, code: 'test_recipient_unavailable', error: 'テスト送信先が登録されていないか、友だち追加されていません' }, 404);
  if (!campaign || !account || !column) {
    return c.json({ success: false, error: 'Test target not found' }, 404);
  }
  const { pushViaHarnessProxy } = await import('../services/line-proxy-send.js');
  const { dispatchLineProxyLocally } = await import('../services/local-line-proxy.js');
  await pushViaHarnessProxy(
    c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin,
    account.channel_access_token,
    friend.line_user_id,
    buildNenDeliveryMessages(campaign, { article: column }),
    crypto.randomUUID(),
    (request) => dispatchLineProxyLocally(request, c.env),
  );
  return c.json({ success: true });
});

nenCampaigns.post(
  '/api/nen-campaigns/columns/:id/read-events',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body.lineAccountId !== 'string' || typeof body.friendId !== 'string'
      || (body.eventKind !== 'opened' && body.eventKind !== 'completed') || typeof body.idempotencyKey !== 'string') {
      return c.json({ success: false, error: 'Invalid body' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
    }
    try {
      const data = await recordNenColumnReadEvent(c.env.DB, {
        lineAccountId: body.lineAccountId, columnId: c.req.param('id'), friendId: body.friendId,
        eventKind: body.eventKind, idempotencyKey: body.idempotencyKey,
        occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
      });
      return c.json({ success: true, data });
    } catch (error) {
      return columnOperationError(c, error);
    }
  },
);

nenCampaigns.post('/api/nen-campaigns/deliveries/pending-now', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string; expectedCount?: number }>().catch(() => null);
  if (!body?.accountId || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: ACCOUNT_ACCESS_ERROR }, 403);
  }
  try {
    const data = await sendPendingNenDeliveriesNow(c.env.DB, {
      lineAccountId: body.accountId, expectedCount: Number(body.expectedCount),
    });
    auditLog(c, 'nen.delivery.pending_now', { kind: 'line_account', id: body.accountId });
    return c.json({ success: true, data });
  } catch (error) {
    return columnOperationError(c, error);
  }
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

// 誕生日の形（YYYY-MM-DD か MM-DD）の判定は lib/nen-pet-birthday.ts の1本。

function petWriteBody(body: Record<string, unknown> | null):
  { error: string } | {
    name: string; animalType: string; gender: string; birthday: string | null;
    breed: string | null; weightKg: number | null;
  } {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
  // ペットの名前はNEN配信の本文へ差し込まれる（{{pet_name}}）。無制限だと
  // 差し込み展開後の本文が際限なく膨らみ、保存時の上限判定の前提（#659）が
  // 崩れるため、ここで有限の上限を持たせる。
  if (countNenCampaignBodyLength(body.name.trim()) > NEN_PET_NAME_MAX_LENGTH) {
    return { error: `ペットのお名前は${NEN_PET_NAME_MAX_LENGTH}字以内で入力してください` };
  }
  const birthday = normalizeNenPetBirthday(body.birthday);
  if (birthday === 'invalid') return { error: '誕生日は YYYY-MM-DD か MM-DD で入力してください' };
  const weightKg = body.weightKg === null || body.weightKg === undefined || body.weightKg === ''
    ? null : Number(body.weightKg);
  if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 200)) {
    return { error: '体重は 0.1〜200kg で入力してください' };
  }
  return {
    name: body.name.trim(),
    animalType: ['dog', 'cat', 'other'].includes(String(body.animalType)) ? String(body.animalType) : 'dog',
    gender: ['male', 'female', 'unknown'].includes(String(body.gender)) ? String(body.gender) : 'unknown',
    birthday,
    breed: typeof body.breed === 'string' && body.breed.trim() ? body.breed.trim().slice(0, 80) : null,
    weightKg,
  };
}

/**
 * PUTの部分更新用。送られた項目だけ検証して返し、欠落項目は呼び出し側で現値を保つ。
 * 検証はDBを読む前に済ませるため、ここは入力だけを見る（無効入力でDBを叩かない）。
 */
function petPatchBody(body: Record<string, unknown> | null):
  { error: string } | {
    name?: string; animalType?: string; gender?: string; birthday?: string | null;
    breed?: string | null; weightKg?: number | null;
  } {
  const patch: {
    name?: string; animalType?: string; gender?: string; birthday?: string | null;
    breed?: string | null; weightKg?: number | null;
  } = {};
  if (!body) return patch;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name is required' };
    if (countNenCampaignBodyLength(body.name.trim()) > NEN_PET_NAME_MAX_LENGTH) {
      return { error: `ペットのお名前は${NEN_PET_NAME_MAX_LENGTH}字以内で入力してください` };
    }
    patch.name = body.name.trim();
  }
  if (body.animalType !== undefined) {
    patch.animalType = ['dog', 'cat', 'other'].includes(String(body.animalType)) ? String(body.animalType) : 'dog';
  }
  if (body.gender !== undefined) {
    patch.gender = ['male', 'female', 'unknown'].includes(String(body.gender)) ? String(body.gender) : 'unknown';
  }
  if (body.birthday !== undefined) {
    const birthday = normalizeNenPetBirthday(body.birthday);
    if (birthday === 'invalid') return { error: '誕生日は YYYY-MM-DD か MM-DD で入力してください' };
    patch.birthday = birthday;
  }
  if (body.breed !== undefined) {
    patch.breed = typeof body.breed === 'string' && body.breed.trim() ? body.breed.trim().slice(0, 80) : null;
  }
  if (body.weightKg !== undefined) {
    const weightKg = body.weightKg === null || body.weightKg === '' ? null : Number(body.weightKg);
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 200)) {
      return { error: '体重は 0.1〜200kg で入力してください' };
    }
    patch.weightKg = weightKg;
  }
  return patch;
}

nenCampaigns.post('/api/nen-campaigns/pets', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.friendId !== 'string') {
    return c.json({ success: false, error: 'friendId and name are required' }, 400);
  }
  const input = petWriteBody(body);
  if ('error' in input) return c.json({ success: false, error: input.error }, 400);
  const friend = await c.env.DB.prepare(`SELECT id, line_account_id FROM friends WHERE id = ?`)
    .bind(body.friendId).first<{ id: string; line_account_id: string | null }>();
  if (!friend || friend.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }
  const now = jstNow();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO nen_pet_profiles (id, friend_id, customer_id, name, animal_type, gender, birthday, breed, weight_kg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.friendId, typeof body.customerId === 'string' ? body.customerId : null,
    input.name, input.animalType, input.gender, input.birthday, input.breed, input.weightKg, now, now).run();
  await syncNenPetTags(c.env.DB, body.friendId);
  return c.json({ success: true, data: { id } }, 201);
});

nenCampaigns.put('/api/nen-campaigns/pets/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  // 入力検証はDBを読む前に済ませる。無効な入力ではDBへ一切行かない。
  const patch = petPatchBody(body ?? {});
  if ('error' in patch) return c.json({ success: false, error: patch.error }, 400);
  const pet = await c.env.DB.prepare(
    `SELECT p.friend_id, p.name, p.animal_type, p.gender, p.birthday, p.breed, p.weight_kg, f.line_account_id
     FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id WHERE p.id = ?`,
  ).bind(c.req.param('id')).first<{
    friend_id: string; name: string; animal_type: string; gender: string;
    birthday: string | null; breed: string | null; weight_kg: number | null;
    line_account_id: string | null;
  }>();
  if (!pet || pet.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Pet not found' }, 404);
  }
  // 送られてこなかった項目は現値を保つ部分更新（LIFF PUT と同じ意味づけ）。
  // 既定値で上書きすると、名前だけ直す更新で他項目まで消えてしまう。
  const input = {
    name: patch.name ?? pet.name,
    animalType: patch.animalType ?? pet.animal_type,
    gender: patch.gender ?? pet.gender,
    birthday: patch.birthday === undefined ? pet.birthday : patch.birthday,
    breed: patch.breed === undefined ? pet.breed : patch.breed,
    weightKg: patch.weightKg === undefined ? pet.weight_kg : patch.weightKg,
  };
  await c.env.DB.prepare(
    `UPDATE nen_pet_profiles SET name = ?, animal_type = ?, gender = ?, birthday = ?, breed = ?, weight_kg = ?, updated_at = ? WHERE id = ?`,
  ).bind(input.name, input.animalType, input.gender, input.birthday, input.breed, input.weightKg, jstNow(), c.req.param('id')).run();
  // 誕生日を明示して変えたときだけ、古い日付へ予約済みの誕生日クーポン配信を
  // 取消し、次の日次走査で新しい誕生日から組み直させる。発行済みの今年分は残る。
  if (patch.birthday !== undefined && (pet.birthday ?? null) !== patch.birthday) {
    await c.env.DB.prepare(
      `UPDATE nen_delivery_jobs SET status = 'cancelled', updated_at = ?
       WHERE campaign_key = 'birthday_coupon' AND status = 'pending' AND source_key LIKE ?`,
    ).bind(jstNow(), `birthday:${c.req.param('id')}:%`).run();
  }
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
    validityDays: row?.validity_days ?? 0,
    // 419: キー無しの既存設定は従来動作（平年に届かない）= 'skip'。
    // まだ保存したことが無いアカウントは要件の既定 'feb28' を見せる。
    leapYearPolicy: row ? (row.leap_year_policy ?? 'skip') : 'feb28',
    updatedAt: row?.updated_at ?? '',
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
  // 419: 2月29日生まれの扱い。送られてきたら検証し、省略なら既存値を守る
  // （旧クライアントからの保存で 'skip' 扱いの設定を無断で変えない）。
  let leapYearPolicy: 'feb28' | 'mar1' | 'skip' | undefined;
  if (body.leapYearPolicy !== undefined) {
    if (!['feb28', 'mar1', 'skip'].includes(body.leapYearPolicy as string)) {
      return c.json({ success: false, error: 'Invalid leapYearPolicy' }, 400);
    }
    leapYearPolicy = body.leapYearPolicy as 'feb28' | 'mar1' | 'skip';
  } else {
    const existing = await getNenBirthdayCouponSetting(c.env.DB, accountId);
    leapYearPolicy = existing ? (existing.leap_year_policy ?? 'skip') : 'feb28';
  }
  await saveNenBirthdayCouponSetting(c.env.DB, accountId, {
    is_enabled: body.isEnabled ? 1 : 0,
    code_prefix: body.codePrefix,
    benefit_label: body.benefitLabel.trim(),
    discount_amount: amount,
    validity_days: days,
    leap_year_policy: leapYearPolicy,
    updated_at: jstNow(),
  });
  return c.json({ success: true });
});

// EC-CUBEのコラム保存時に自動同期する公開エンドポイント。管理者認証ではなくHMACで検証する。
/**
 * EC-CUBE が `line_account_id` を送らないときの宛先（`/events` の resolveAccountIdWithoutHeader と同じ2番目の決まり）。
 * 動いている LINE アカウントが 1 つだけならそのアカウント。決まらなければ null（未割り当てのまま保存し、
 * 管理画面の「ECのコラムを取り込む」で割り当てる）。
 */
async function resolveSoleActiveAccountId(db: D1Database): Promise<string | null> {
  const rows = await db.prepare(
    `SELECT id FROM line_accounts WHERE is_active = 1 AND archived_at IS NULL ORDER BY id LIMIT 2`,
  ).all<{ id: string }>();
  const ids = (rows.results ?? []).map((row) => String(row.id));
  return ids.length === 1 ? ids[0] : null;
}

/**
 * 未割り当て（line_account_id IS NULL）の EC コラムを、選択中の LINE アカウントへ割り当てる。
 * ★V6 37-6-A「ECのコラムを取り込む」。EC で保存されたコラムは Webhook で自動的に届くが、
 * 宛先が決められなかった分（アカウントが複数ある・古いコラム）がここに残る。
 */
nenCampaigns.post('/api/nen-campaigns/columns/import', requireRole('owner', 'admin'), async (c) => {
  const accountId = await requireAccount(c);
  if (typeof accountId !== 'string') return accountId;
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
  const result = await c.env.DB.prepare(
    `UPDATE nen_columns SET line_account_id = ?, updated_at = ? WHERE line_account_id IS NULL`,
  ).bind(accountId, jstNow()).run();
  const imported = result.meta.changes ?? 0;
  if (imported > 0) auditLog(c, 'nen.column.import', { kind: 'line_account', id: accountId }, { lineAccountId: accountId });
  return c.json({ success: true, data: { imported } });
});

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
  // 120: 管理画面経路（validateNenColumnCreateBody）と同じ値に揃えた。送信元の
  // EC-Cube側フォームも独立に120字で制約している（JournalController.php の
  // titleフィールド、Assert\Length(max:120)）が、それはLHが保証されたもの
  // ではない。#711 の司令塔裁定で、経路ごとに違う上限を持たないことを優先し、
  // 管理画面と同じ120を採った。
  if (body.title.length > 120) {
    console.error(JSON.stringify({
      event: 'nen_eccube_column_title_rejected',
      slug: body.slug,
      titleLength: body.title.length,
      maxLength: 120,
    }));
    return c.json({ success: false, error: 'title_invalid' }, 400);
  }
  const requestedLineAccountId = typeof body.line_account_id === 'string' ? body.line_account_id : null;
  if (requestedLineAccountId && !await getLineAccountById(c.env.DB, requestedLineAccountId)) {
    return c.json({ success: false, error: 'LINE account not found' }, 404);
  }
  // EC-CUBE 標準（LineColumnSyncService）は line_account_id を送らない。アカウントが 1 つなら
  // そこへ入れる。NULL のままだと管理画面の一覧（WHERE line_account_id = ?）に出ず、
  // 「自動で取り込まれない」ように見える。
  const lineAccountId = requestedLineAccountId ?? await resolveSoleActiveAccountId(c.env.DB);
  const now = jstNow();
  const existing = await c.env.DB.prepare(
    `SELECT id, line_account_id FROM nen_columns WHERE slug = ?`,
  ).bind(body.slug).first<{ id: string; line_account_id: string | null }>();
  if (existing?.line_account_id && lineAccountId && existing.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Column belongs to another LINE account' }, 409);
  }
  const id = existing?.id || crypto.randomUUID();
  const fields = buildNenColumnStorageFields({
    title: body.title,
    category: typeof body.category === 'string' ? body.category : null,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt.slice(0, 500) : '',
    articleUrl: body.article_url,
    imageUrl: typeof body.image_url === 'string' ? body.image_url : null,
    publishedAt: typeof body.published_at === 'string' ? body.published_at : null,
  });
  // intro_textはON CONFLICTのSET句に含めない（意図的）。EC-Cubeはintro_textを
  // 送らないので、再同期のたびに既定文で上書きすると、LHの画面で人が直した
  // 紹介文が消える。既定文のまま古くなるより、人が直した内容が消えるほうが
  // 害が大きいという判断（未確認・推測）。#711 の司令塔裁定を参照。
  // https://github.com/kentavndng/line-harness-board/issues/711
  await c.env.DB.prepare(
    `INSERT INTO nen_columns
      (id, external_id, slug, title, category, excerpt, intro_text, article_url, image_url, published_at, delivery_status, line_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET external_id = excluded.external_id, title = excluded.title,
       category = excluded.category, excerpt = excluded.excerpt, article_url = excluded.article_url,
       image_url = excluded.image_url, published_at = excluded.published_at,
       line_account_id = COALESCE(excluded.line_account_id, nen_columns.line_account_id), updated_at = excluded.updated_at`,
  ).bind(
    id, typeof body.external_id === 'string' ? body.external_id : body.slug, body.slug, fields.title,
    fields.category, fields.excerpt, fields.introText, fields.articleUrl, fields.imageUrl,
    fields.publishedAt, lineAccountId, now, now,
  ).run();
  return c.json({ success: true, data: { id } });
});

/**
 * EC-CUBE が注文確定時に呼ぶ「誕生日クーポンが使われた」の記録口。
 * 管理認証ではなく `/columns` と同じ HMAC で検証する。
 *
 * EC側のクーポン利用台帳とこちらの発行台帳は別物なので、ここが唯一の
 * `used_at` 書き込み口になる。同じコードの再送で利用日時を上書きしない
 * （冪等）。利用=注文なので成果計測にもつなげるが、計測の失敗で
 * 記録自体は止めない。
 */
nenCampaigns.post('/api/integrations/eccube/coupon-usages', async (c) => {
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
  const code = typeof body.code === 'string' ? body.code.trim().slice(0, 64) : '';
  const usedAt = body.used_at === undefined || body.used_at === null || body.used_at === ''
    ? null
    : typeof body.used_at === 'string' && Number.isFinite(Date.parse(body.used_at))
      // issued_at と同じく日本時間の壁時計で残す（台帳の日付列をそろえる）。
      ? new Date(Date.parse(body.used_at) + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
      : 'invalid';
  const orderNumber = typeof body.order_number === 'string' && body.order_number.trim()
    ? body.order_number.trim().slice(0, 64) : null;
  const eventId = typeof body.event_id === 'string' && body.event_id.trim()
    ? body.event_id.trim().slice(0, 255) : null;
  if (!code || usedAt === 'invalid') {
    return c.json({ success: false, error: 'Invalid coupon usage' }, 400);
  }
  const when = usedAt ?? jstNow();
  // 二重報告で最初の利用日時を上書きしない（used_at IS NULL の行だけ更新）。
  const updated = await c.env.DB.prepare(
    `UPDATE nen_coupon_issues SET used_at = ? WHERE coupon_code = ? AND used_at IS NULL`,
  ).bind(when, code).run();
  if (!updated.meta.changes) {
    const known = await c.env.DB.prepare(
      `SELECT id FROM nen_coupon_issues WHERE coupon_code = ?`,
    ).bind(code).first<{ id: string }>();
    // こちらが発行していないコードは拾わない。再送は成功として返して送り止める。
    if (!known) return c.json({ success: false, error: 'Coupon not found' }, 404);
    return c.json({ success: true, data: { couponCode: code, alreadyUsed: true } });
  }
  const issue = await c.env.DB.prepare(
    `SELECT ci.friend_id, f.line_account_id
       FROM nen_coupon_issues ci JOIN friends f ON f.id = ci.friend_id
      WHERE ci.coupon_code = ?`,
  ).bind(code).first<{ friend_id: string; line_account_id: string | null }>();
  if (issue) {
    try {
      await recordConversionSourceEvent(c.env.DB, {
        sourceType: 'ec_order_confirmed',
        lineAccountId: issue.line_account_id,
        friendId: issue.friend_id,
        sourceEventId: eventId ?? `nen_coupon_use:${code}`,
        metadata: { couponCode: code, orderNumber },
      });
    } catch (conversionError) {
      console.error(JSON.stringify({
        event: 'nen_coupon_usage_conversion_failed',
        coupon_code: code,
        reason: conversionError instanceof Error ? conversionError.message : String(conversionError),
      }));
    }
  }
  return c.json({ success: true, data: { couponCode: code, usedAt: when } });
});

export { nenCampaigns };
