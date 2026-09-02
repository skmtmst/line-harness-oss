import { getFriendById, getLineAccountById, jstNow } from '@line-crm/db';
import type { Message } from '@line-crm/line-sdk';
import type { EcEvent } from '../routes/ec-integrations.js';
import { logOutgoingMessage } from './event-bus.js';
import { createEccubeCoupon } from './eccube-coupon.js';
import { pushViaHarnessProxy, type HarnessProxyDispatch } from './line-proxy-send.js';

const FOLLOW_UP_KEYS = ['arrival_check', 'review_request', 'cross_sell'] as const;
// 1 回の cron 実行で送る件数。cron は 5 分ごとなので、
// **ここが 1 時間に送れる件数の上限になる（30 × 12 = 360 件/時、8,640 件/日）。**
// 誕生日クーポンのように 1 日ぶんがまとめて積まれるものは、
// これを超えた分が翌日以降にずれ込む。増やすときは、この実行が
// 他の cron 処理（ウェビナーのリマインダなど）と同じ 1 回の中で動くことに注意する。
const MAX_JOBS_PER_TICK = 30;
// 送信に失敗した job を何回まで試すか。これを超えた job は拾われなくなり、
// status='failed' のまま残る（last_error に理由が入る）。
const MAX_DELIVERY_ATTEMPTS = 5;

export type CampaignRow = {
  campaign_key: string;
  label: string;
  category: string;
  trigger_event?: string | null;
  delay_days: number;
  delivery_time: string;
  is_enabled: number;
  title: string;
  body_text: string;
  button_label: string | null;
  button_url: string | null;
  image_url: string | null;
  updated_at?: string;
};

export type NenBirthdayCouponSettingRow = {
  is_enabled: number;
  code_prefix: string;
  benefit_label: string;
  discount_amount: number;
  validity_days: number;
  updated_at: string;
};

const campaignAccountSettingKey = (campaignKey: string) => `nen.campaign.${campaignKey}`;
const BIRTHDAY_COUPON_ACCOUNT_SETTING_KEY = 'nen.birthday_coupon';

async function readAccountSetting(db: D1Database, lineAccountId: string, key: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`,
  ).bind(lineAccountId, key).first<{ value: string }>();
  return row?.value ?? null;
}

async function writeAccountSetting(db: D1Database, lineAccountId: string, key: string, value: string): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), lineAccountId, key, value, now, now).run();
}

type DeliveryJob = {
  id: string;
  campaign_key: string;
  friend_id: string;
  line_account_id: string | null;
  source_key: string;
  payload: string;
  campaign_snapshot: string | null;
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

function campaignSnapshot(campaign: CampaignRow): string {
  return JSON.stringify(campaign);
}

export function readNenCampaignSnapshot(value: string | null, campaignKey: string): CampaignRow | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CampaignRow>;
    const delayDays = Number(parsed.delay_days);
    const enabled = Number(parsed.is_enabled);
    if (
      parsed.campaign_key !== campaignKey
      || typeof parsed.title !== 'string'
      || typeof parsed.body_text !== 'string'
      || typeof parsed.label !== 'string'
      || typeof parsed.category !== 'string'
      || !Number.isInteger(delayDays)
      || delayDays < 0
      || delayDays > 365
      || typeof parsed.delivery_time !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.delivery_time)
      || ![0, 1].includes(enabled)
    ) return null;
    return {
      campaign_key: parsed.campaign_key,
      label: parsed.label,
      category: parsed.category,
      trigger_event: typeof parsed.trigger_event === 'string' ? parsed.trigger_event : null,
      delay_days: delayDays,
      delivery_time: parsed.delivery_time,
      is_enabled: enabled,
      title: parsed.title,
      body_text: parsed.body_text,
      button_label: typeof parsed.button_label === 'string' ? parsed.button_label : null,
      button_url: typeof parsed.button_url === 'string' ? parsed.button_url : null,
      image_url: typeof parsed.image_url === 'string' ? parsed.image_url : null,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
    };
  } catch {
    return null;
  }
}

export function buildDefaultColumnIntro(title: string, excerpt: string): string {
  const summary = excerpt.trim();
  return [
    'こんにちは、然-NEN-です🌿',
    '',
    `今回のNENコラムでは「${title.trim()}」についてご紹介します。`,
    summary,
    '',
    '愛犬・愛猫との毎日に役立つ内容です。ぜひご覧ください。',
  ].filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n').slice(0, 1500);
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

export function buildNenDeliveryMessages(campaign: CampaignRow, payload: Record<string, unknown>): Message[] {
  const card = flexMessage(campaign, payload);
  if (campaign.campaign_key !== 'column') return [card];
  const article = payload.article as Record<string, unknown> | undefined;
  const title = String(article?.title || campaign.title);
  const excerpt = String(article?.excerpt || campaign.body_text);
  const intro = String(article?.intro_text || '').trim() || buildDefaultColumnIntro(title, excerpt);
  return [{ type: 'text', text: intro.slice(0, 5000) }, card];
}

export async function getNenCampaign(
  db: D1Database,
  campaignKey: string,
  lineAccountId?: string | null,
): Promise<CampaignRow | null> {
  const base = await db.prepare(
    `SELECT campaign_key, label, category, trigger_event, delay_days, delivery_time, is_enabled,
            title, body_text, button_label, button_url, image_url, updated_at
       FROM nen_campaign_settings WHERE campaign_key = ?`,
  ).bind(campaignKey).first<CampaignRow>();
  if (!base || !lineAccountId) return base;
  const raw = await readAccountSetting(db, lineAccountId, campaignAccountSettingKey(campaignKey));
  if (!raw) return base;
  // 壊れたアカウント別設定を共通値へ黙って戻すと、止めたはずの配信が再開する。
  // 設定が存在するのに読めない場合は null にして、送信側を停止させる。
  return readNenCampaignSnapshot(raw, campaignKey);
}

export async function saveNenCampaignAccountSetting(
  db: D1Database,
  lineAccountId: string,
  campaign: CampaignRow,
): Promise<void> {
  await writeAccountSetting(
    db,
    lineAccountId,
    campaignAccountSettingKey(campaign.campaign_key),
    JSON.stringify({ ...campaign, updated_at: jstNow() }),
  );
}

export async function getNenBirthdayCouponSetting(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<NenBirthdayCouponSettingRow | null> {
  const base = await db.prepare(
    `SELECT is_enabled, code_prefix, benefit_label, discount_amount, validity_days, updated_at
       FROM nen_birthday_coupon_settings WHERE id = 'default'`,
  ).first<NenBirthdayCouponSettingRow>();
  if (!base || !lineAccountId) return base;
  const raw = await readAccountSetting(db, lineAccountId, BIRTHDAY_COUPON_ACCOUNT_SETTING_KEY);
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<NenBirthdayCouponSettingRow>;
    if (
      ![0, 1].includes(Number(parsed.is_enabled))
      || typeof parsed.code_prefix !== 'string'
      || parsed.code_prefix.trim().length === 0
      || typeof parsed.benefit_label !== 'string'
      || !Number.isInteger(parsed.discount_amount)
      || Number(parsed.discount_amount) < 0
      || !Number.isInteger(parsed.validity_days)
      || Number(parsed.validity_days) < 1
      || Number(parsed.validity_days) > 3650
    ) return null;
    return {
      is_enabled: parsed.is_enabled!,
      code_prefix: parsed.code_prefix,
      benefit_label: parsed.benefit_label,
      discount_amount: parsed.discount_amount!,
      validity_days: parsed.validity_days!,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
    };
  } catch {
    // アカウント別設定が壊れているのに共通値で送ると、停止した配信が再開する。
    return null;
  }
}

export async function saveNenBirthdayCouponSetting(
  db: D1Database,
  lineAccountId: string,
  setting: NenBirthdayCouponSettingRow,
): Promise<void> {
  await writeAccountSetting(
    db,
    lineAccountId,
    BIRTHDAY_COUPON_ACCOUNT_SETTING_KEY,
    JSON.stringify({ ...setting, updated_at: jstNow() }),
  );
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
  if (event.event_type !== 'ec.order.shipped' || !lineAccountId) return 0;
  const campaigns = (await Promise.all(
    FOLLOW_UP_KEYS.map((key) => getNenCampaign(db, key, lineAccountId)),
  )).filter((campaign): campaign is CampaignRow => Boolean(campaign?.is_enabled === 1));
  const now = jstNow();
  let created = 0;
  for (const campaign of campaigns) {
    if (!FOLLOW_UP_KEYS.includes(campaign.campaign_key as typeof FOLLOW_UP_KEYS[number])) continue;
    const result = await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
         scheduled_at, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), campaign.campaign_key, friendId, lineAccountId,
      event.event_id, JSON.stringify({ event }), campaignSnapshot(campaign),
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
    `SELECT id, title, excerpt, article_url, image_url, intro_text
       FROM nen_columns WHERE id = ? AND line_account_id = ?`,
  ).bind(columnId, lineAccountId).first<Record<string, unknown>>();
  if (!column) throw new Error('Column not found');
  const campaign = await getNenCampaign(db, 'column', lineAccountId);
  if (!campaign || campaign.is_enabled !== 1) throw new Error('Column campaign is disabled');
  const friends = await db.prepare(
    `SELECT id FROM friends WHERE line_account_id = ? AND is_following = 1`,
  ).bind(lineAccountId).all<{ id: string }>();
  const now = jstNow();
  let queued = 0;
  for (const friend of friends.results) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
         scheduled_at, status, attempts, created_at, updated_at)
       VALUES (?, 'column', ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), friend.id, lineAccountId, `column:${columnId}`,
      JSON.stringify({ article: column }), campaignSnapshot(campaign), scheduledAt, now, now,
    ).run();
    queued += result.meta.changes ?? 0;
  }
  await db.prepare(
    `UPDATE nen_columns SET delivery_status = ?, delivery_at = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ?`,
  ).bind(queued ? 'queued' : 'scheduled', scheduledAt, now, columnId, lineAccountId).run();
  return queued;
}

export function birthdayDeliveryTarget(now: Date): {
  issueYear: number;
  monthDay: string;
  deliveryAt: Date;
} {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const targetBirthday = new Date(Date.UTC(
    jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 3,
  ));
  return {
    issueYear: targetBirthday.getUTCFullYear(),
    monthDay: `${String(targetBirthday.getUTCMonth() + 1).padStart(2, '0')}-${String(targetBirthday.getUTCDate()).padStart(2, '0')}`,
    deliveryAt: new Date(Date.UTC(
      jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 1, 0, 0,
    )),
  };
}

export async function enqueueBirthdayCoupons(
  db: D1Database,
  now = new Date(),
  ecommerce?: { baseUrl: string; secret: string },
): Promise<number> {
  const { issueYear, monthDay, deliveryAt } = birthdayDeliveryTarget(now);
  const pets = await db.prepare(
    `SELECT p.id, p.friend_id, p.name, f.line_account_id
       FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id
      WHERE p.birthday IS NOT NULL AND substr(p.birthday, 6, 5) = ? AND f.is_following = 1`,
  ).bind(monthDay).all<{ id: string; friend_id: string; name: string; line_account_id: string | null }>();
  const issuedAt = jstNow();
  const accountConfiguration = new Map<string, {
    setting: NenBirthdayCouponSettingRow;
    campaign: CampaignRow;
  } | null>();
  let queued = 0;
  for (const pet of pets.results) {
    if (!pet.line_account_id) continue;
    if (!accountConfiguration.has(pet.line_account_id)) {
      const [setting, campaign] = await Promise.all([
        getNenBirthdayCouponSetting(db, pet.line_account_id),
        getNenCampaign(db, 'birthday_coupon', pet.line_account_id),
      ]);
      accountConfiguration.set(
        pet.line_account_id,
        setting?.is_enabled === 1 && campaign?.is_enabled === 1 ? { setting, campaign } : null,
      );
    }
    const configuration = accountConfiguration.get(pet.line_account_id);
    if (!configuration) continue;
    const { setting, campaign } = configuration;
    const expires = new Date(deliveryAt.getTime() + setting.validity_days * 86_400_000);
    const existing = await db.prepare(
      `SELECT id FROM nen_coupon_issues WHERE pet_id = ? AND issue_year = ?`,
    ).bind(pet.id, issueYear).first<{ id: string }>();
    if (existing) continue;
    const issueId = crypto.randomUUID();
    const code = `${setting.code_prefix.replace(/-/g, '').slice(0, 8)}-${String(issueYear).slice(-2)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    if (ecommerce) {
      await createEccubeCoupon(ecommerce.baseUrl, ecommerce.secret, {
        code,
        name: `${pet.name} ${setting.benefit_label}`.slice(0, 50),
        discountAmount: setting.discount_amount,
        validFrom: deliveryAt.toISOString(),
        validTo: expires.toISOString(),
      });
    }
    const issue = await db.prepare(
      `INSERT OR IGNORE INTO nen_coupon_issues
        (id, pet_id, friend_id, issue_year, coupon_code, benefit_label, expires_at, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(issueId, pet.id, pet.friend_id, issueYear, code, setting.benefit_label, sqliteDate(expires), issuedAt).run();
    if (!issue.meta.changes) continue;
    await db.prepare(
      `INSERT OR IGNORE INTO nen_delivery_jobs
        (id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot,
         scheduled_at, status, attempts, created_at, updated_at)
       VALUES (?, 'birthday_coupon', ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(
      crypto.randomUUID(), pet.friend_id, pet.line_account_id, `birthday:${pet.id}:${issueYear}`,
      JSON.stringify({ pet: { id: pet.id, name: pet.name }, coupon: { code, expires_at: sqliteDate(expires), benefit_label: setting.benefit_label } }),
      campaignSnapshot(campaign), sqliteDate(deliveryAt), issuedAt, issuedAt,
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
    `SELECT id, campaign_key, friend_id, line_account_id, source_key, payload, campaign_snapshot
       FROM nen_delivery_jobs
      WHERE status IN ('pending', 'failed') AND datetime(scheduled_at) <= datetime('now')
        AND attempts < ?
      ORDER BY scheduled_at ASC LIMIT ?`,
  ).bind(MAX_DELIVERY_ATTEMPTS, MAX_JOBS_PER_TICK).all<DeliveryJob>();
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
      const [friend, currentCampaign, account] = await Promise.all([
        getFriendById(db, job.friend_id),
        getNenCampaign(db, job.campaign_key, job.line_account_id),
        job.line_account_id ? getLineAccountById(db, job.line_account_id) : Promise.resolve(null),
      ]);
      const campaign = readNenCampaignSnapshot(job.campaign_snapshot, job.campaign_key);
      const accountMismatch = Boolean(
        friend && job.line_account_id && friend.line_account_id !== job.line_account_id,
      );
      if (
        !friend || !friend.is_following || !job.line_account_id || !account?.channel_access_token || accountMismatch
        || !currentCampaign || currentCampaign.is_enabled !== 1 || !campaign
      ) {
        const reason = !friend || !friend.is_following
          ? 'friend_unavailable'
          : !job.line_account_id || !account?.channel_access_token
            ? 'line_account_unavailable'
            : accountMismatch
              ? 'line_account_mismatch'
              : !campaign
                ? 'campaign_snapshot_missing'
                : 'campaign_disabled';
        await db.prepare(
          `UPDATE nen_delivery_jobs SET status = 'skipped', last_error = ?, updated_at = ? WHERE id = ?`,
        ).bind(reason, jstNow(), job.id).run();
        skipped++;
        continue;
      }
      const accessToken = account.channel_access_token;
      const payload = JSON.parse(job.payload) as Record<string, unknown>;
      const messages = buildNenDeliveryMessages(campaign, payload);
      await pushViaHarnessProxy(
        options.proxyBaseUrl, accessToken, friend.line_user_id, messages, job.id, options.proxyDispatch,
      );
      for (const message of messages) {
        await logOutgoingMessage(db, {
          friendId: friend.id,
          messageType: message.type,
          content: message.type === 'text' ? message.text : JSON.stringify(message),
          deliveryType: 'push',
          source: `nen_${job.campaign_key}`,
          lineAccountId: account.id,
        });
      }
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
