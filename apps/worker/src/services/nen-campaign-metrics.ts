import { jstNow } from '@line-crm/db';

import { getNenCampaign } from './nen-engagement.js';

const MAX_DELIVERY_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

export class NenCampaignMetricsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'NenCampaignMetricsError';
  }
}

export type NenMetricsRange = {
  days: number;
  from: string;
  to: string;
  fromSql: string;
  toSql: string;
};

function sqliteTimestamp(date: Date): string {
  return date.toISOString();
}

export function nenMetricsRange(daysValue: unknown, now = new Date()): NenMetricsRange {
  const days = daysValue === undefined || daysValue === null || daysValue === ''
    ? 30
    : Number(daysValue);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    throw new NenCampaignMetricsError('days_invalid', '期間は1〜365日で指定してください', 400, 'days');
  }
  const to = new Date(now);
  const from = new Date(to.getTime() - days * DAY_MS);
  return {
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    fromSql: sqliteTimestamp(from),
    toSql: sqliteTimestamp(to),
  };
}

export function nenDeliveryRange(
  input: { from?: unknown; to?: unknown; days?: unknown },
  now = new Date(),
): NenMetricsRange {
  if (input.from === undefined && input.to === undefined) return nenMetricsRange(input.days, now);
  if (typeof input.from !== 'string' || typeof input.to !== 'string') {
    throw new NenCampaignMetricsError('range_required', '開始日時と終了日時を両方指定してください', 400, 'from');
  }
  const from = new Date(input.from);
  const to = new Date(input.to);
  const duration = to.getTime() - from.getTime();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())
    || duration <= 0 || duration > 365 * DAY_MS) {
    throw new NenCampaignMetricsError('range_invalid', '開始より後の終了日時を365日以内で指定してください', 400, 'from');
  }
  return {
    days: Math.max(1, Math.ceil(duration / DAY_MS)),
    from: from.toISOString(),
    to: to.toISOString(),
    fromSql: sqliteTimestamp(from),
    toSql: sqliteTimestamp(to),
  };
}

const unavailable = (reason: string) => ({
  value: null,
  state: 'unavailable' as const,
  reason,
});

type FlowAggregateRow = {
  campaign_key: string;
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
};

type ConversionAggregateRow = { campaign_key: string; total: number; amount: number };

export async function getNenFlowMetrics(
  db: D1Database,
  lineAccountId: string,
  range: NenMetricsRange,
) {
  const keys = await db.prepare(
    `SELECT campaign_key FROM nen_campaign_settings ORDER BY rowid`,
  ).all<{ campaign_key: string }>();
  const campaigns = (await Promise.all(
    (keys.results ?? []).map((row) => getNenCampaign(db, row.campaign_key, lineAccountId)),
  )).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const aggregates = await db.prepare(
    `SELECT campaign_key,
            COUNT(*) AS planned,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
       FROM nen_delivery_jobs
      WHERE line_account_id = ?
        AND datetime(scheduled_at) >= datetime(?) AND datetime(scheduled_at) < datetime(?)
      GROUP BY campaign_key`,
  ).bind(lineAccountId, range.fromSql, range.toSql).all<FlowAggregateRow>();
  const conversions = await db.prepare(
    `SELECT j.campaign_key, COUNT(DISTINCT ce.id) AS total,
            COALESCE(SUM(ce.value_snapshot), 0) AS amount
       FROM nen_delivery_jobs j
       JOIN conversion_events ce ON ce.friend_id = j.friend_id
        AND datetime(ce.created_at) >= datetime(j.sent_at)
        AND datetime(ce.created_at) < datetime(j.sent_at, '+7 days')
       JOIN conversion_points cp ON cp.id = ce.conversion_point_id AND cp.line_account_id = ?
      WHERE j.line_account_id = ? AND j.status = 'sent' AND j.sent_at IS NOT NULL
        AND datetime(j.sent_at) >= datetime(?) AND datetime(j.sent_at) < datetime(?)
      GROUP BY j.campaign_key`,
  ).bind(lineAccountId, lineAccountId, range.fromSql, range.toSql).all<ConversionAggregateRow>();
  const byKey = new Map((aggregates.results ?? []).map((row) => [row.campaign_key, row]));
  const conversionsByKey = new Map((conversions.results ?? []).map((row) => [row.campaign_key, {
    count: Number(row.total ?? 0), amount: Number(row.amount ?? 0),
  }]));
  const flows = campaigns.map((campaign) => {
    const aggregate = byKey.get(campaign.campaign_key);
    return {
      campaignKey: campaign.campaign_key,
      label: campaign.label,
      category: campaign.category,
      isEnabled: campaign.is_enabled === 1,
      planned: Number(aggregate?.planned ?? 0),
      sent: Number(aggregate?.sent ?? 0),
      failed: Number(aggregate?.failed ?? 0),
      skipped: Number(aggregate?.skipped ?? 0),
      openRate: unavailable('LINEはNEN配信の個人開封を提供していません'),
      associatedConversions: conversionsByKey.get(campaign.campaign_key)?.count ?? 0,
      associatedConversionAmount: conversionsByKey.get(campaign.campaign_key)?.amount ?? 0,
      attribution: '送信後7日以内の関連成果であり、配信が原因とは断定しません',
    };
  });
  return {
    range: { days: range.days, from: range.from, to: range.to },
    summary: {
      active: flows.filter((flow) => flow.isEnabled).length,
      paused: flows.filter((flow) => !flow.isEnabled).length,
      planned: flows.reduce((sum, flow) => sum + flow.planned, 0),
      sent: flows.reduce((sum, flow) => sum + flow.sent, 0),
      associatedConversions: flows.reduce((sum, flow) => sum + flow.associatedConversions, 0),
      associatedConversionAmount: flows.reduce((sum, flow) => sum + flow.associatedConversionAmount, 0),
    },
    flows,
  };
}

type ColumnMetricRow = {
  id: string;
  title: string;
  category: string | null;
  delivery_status: string;
  published_at: string | null;
  delivery_at: string | null;
  article_url: string;
  targeted: number;
  sent: number;
  pending: number;
  failed: number;
  first_scheduled_at: string | null;
  last_sent_at: string | null;
  tracking_links: number;
  opened: number;
  read_opened: number;
  read_completed: number;
};

export async function getNenColumnMetrics(
  db: D1Database,
  lineAccountId: string,
  range: NenMetricsRange,
) {
  const rows = await db.prepare(
    `SELECT c.id, c.title, c.category, c.delivery_status, c.published_at, c.delivery_at,
            c.article_url,
            COUNT(DISTINCT j.id) AS targeted,
            COUNT(DISTINCT CASE WHEN j.status = 'sent' THEN j.id END) AS sent,
            COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS pending,
            COUNT(DISTINCT CASE WHEN j.status = 'failed' THEN j.id END) AS failed,
            MIN(j.scheduled_at) AS first_scheduled_at,
            MAX(j.sent_at) AS last_sent_at,
            COUNT(DISTINCT tl.id) AS tracking_links,
            COUNT(DISTINCT CASE WHEN lc.friend_id = j.friend_id THEN lc.friend_id END) AS opened,
            (SELECT COUNT(DISTINCT re.friend_id) FROM nen_column_read_events re
              WHERE re.line_account_id = c.line_account_id AND re.column_id = c.id
                AND re.event_kind = 'opened' AND datetime(re.occurred_at) >= datetime(?)
                AND datetime(re.occurred_at) < datetime(?)) AS read_opened,
            (SELECT COUNT(DISTINCT re.friend_id) FROM nen_column_read_events re
              WHERE re.line_account_id = c.line_account_id AND re.column_id = c.id
                AND re.event_kind = 'completed' AND datetime(re.occurred_at) >= datetime(?)
                AND datetime(re.occurred_at) < datetime(?)) AS read_completed
       FROM nen_columns c
       LEFT JOIN nen_delivery_jobs j ON j.line_account_id = c.line_account_id
        AND j.source_key = 'column:' || c.id
        AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)
       LEFT JOIN tracked_links tl ON tl.line_account_id = c.line_account_id
        AND tl.original_url = c.article_url AND tl.is_active = 1
       LEFT JOIN link_clicks lc ON lc.tracked_link_id = tl.id
        AND datetime(lc.clicked_at) >= datetime(?) AND datetime(lc.clicked_at) < datetime(?)
      WHERE c.line_account_id = ?
      GROUP BY c.id
      ORDER BY COALESCE(c.published_at, c.created_at) DESC, c.id DESC`,
  ).bind(
    range.fromSql, range.toSql, range.fromSql, range.toSql,
    range.fromSql, range.toSql, range.fromSql, range.toSql, lineAccountId,
  ).all<ColumnMetricRow>();
  const conversions = await db.prepare(
    `SELECT substr(j.source_key, 8) AS column_id, COUNT(DISTINCT ce.id) AS total,
            COALESCE(SUM(ce.value_snapshot), 0) AS amount
       FROM nen_delivery_jobs j
       JOIN conversion_events ce ON ce.friend_id = j.friend_id
        AND datetime(ce.created_at) >= datetime(j.sent_at)
        AND datetime(ce.created_at) < datetime(j.sent_at, '+7 days')
       JOIN conversion_points cp ON cp.id = ce.conversion_point_id AND cp.line_account_id = ?
      WHERE j.line_account_id = ? AND j.campaign_key = 'column' AND j.status = 'sent'
        AND j.source_key LIKE 'column:%'
        AND datetime(j.sent_at) >= datetime(?) AND datetime(j.sent_at) < datetime(?)
      GROUP BY substr(j.source_key, 8)`,
  ).bind(lineAccountId, lineAccountId, range.fromSql, range.toSql)
    .all<{ column_id: string; total: number; amount: number }>();
  const conversionByColumn = new Map(
    (conversions.results ?? []).map((row) => [row.column_id, {
      count: Number(row.total ?? 0), amount: Number(row.amount ?? 0),
    }]),
  );
  const columns = (rows.results ?? []).map((row) => {
    const targeted = Number(row.targeted ?? 0);
    const sent = Number(row.sent ?? 0);
    const opened = Number(row.opened ?? 0);
    const trackingAvailable = Number(row.tracking_links ?? 0) > 0;
    const readOpened = Number(row.read_opened ?? 0);
    const readCompleted = Number(row.read_completed ?? 0);
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      deliveryStatus: row.delivery_status,
      publishedAt: row.published_at,
      deliveryAt: row.delivery_at,
      period: { from: row.first_scheduled_at, to: row.last_sent_at ?? row.delivery_at },
      targeted,
      sent,
      pending: Number(row.pending ?? 0),
      failed: Number(row.failed ?? 0),
      articleOpened: trackingAvailable
        ? { value: opened, rate: sent > 0 ? opened / sent : 0, state: 'available' as const, reason: null }
        : { value: null, rate: null, state: 'unavailable' as const, reason: 'この記事URLの計測台帳がありません' },
      unread: trackingAvailable ? Math.max(sent - opened, 0) : null,
      completionRate: {
        value: readCompleted,
        rate: readOpened > 0 ? readCompleted / readOpened : 0,
        state: 'available' as const,
        reason: null,
      },
      associatedConversions: conversionByColumn.get(row.id)?.count ?? 0,
      associatedConversionAmount: conversionByColumn.get(row.id)?.amount ?? 0,
      attribution: '送信後7日以内の関連成果',
    };
  });
  return {
    range: { days: range.days, from: range.from, to: range.to },
    summary: {
      total: columns.length,
      sent: columns.filter((column) => column.deliveryStatus === 'sent').length,
      drafts: columns.filter((column) => column.deliveryStatus === 'draft').length,
      scheduled: columns.filter((column) => ['scheduled', 'queued'].includes(column.deliveryStatus)).length,
      unread: columns.some((column) => column.unread !== null)
        ? columns.reduce((sum, column) => sum + (column.unread ?? 0), 0)
        : null,
      associatedConversions: columns.reduce((sum, column) => sum + column.associatedConversions, 0),
      associatedConversionAmount: columns.reduce((sum, column) => sum + column.associatedConversionAmount, 0),
    },
    columns,
  };
}

type PetMetricRow = {
  id: string;
  name: string;
  animal_type: string;
  breed: string | null;
  birthday: string | null;
  friend_id: string;
  owner_name: string;
  delivery_count: number;
  last_delivery_at: string | null;
  coupon_issued: number;
  coupon_used: number;
};

export async function getNenPetMetrics(
  db: D1Database,
  lineAccountId: string,
  range: NenMetricsRange,
) {
  const [friendCounts, petCounts, couponCounts, breeds, rows, birthdayEngagement] = await Promise.all([
    db.prepare(
      `SELECT COUNT(DISTINCT f.id) AS total,
              COUNT(DISTINCT CASE WHEN p.id IS NULL THEN f.id END) AS unregistered
         FROM friends f
         LEFT JOIN nen_pet_profiles p ON p.friend_id = f.id
        WHERE f.line_account_id = ? AND f.is_following = 1`,
    ).bind(lineAccountId).first<{ total: number; unregistered: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN birthday IS NOT NULL AND birthday != '' THEN 1 ELSE 0 END) AS birthday_registered,
              SUM(CASE WHEN birthday IS NULL OR birthday = '' THEN 1 ELSE 0 END) AS birthday_missing,
              COUNT(DISTINCT CASE
                WHEN strftime('%m', p.birthday) = strftime('%m', 'now', '+9 hours') THEN p.id
              END) AS birthday_this_month
         FROM nen_pet_profiles p
         JOIN friends f ON f.id = p.friend_id
        WHERE f.line_account_id = ?`,
    ).bind(lineAccountId).first<{
      total: number; birthday_registered: number; birthday_missing: number; birthday_this_month: number;
    }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT ci.id) AS issued,
              COUNT(DISTINCT CASE WHEN ci.used_at IS NOT NULL THEN ci.id END) AS used
         FROM nen_coupon_issues ci
         JOIN friends f ON f.id = ci.friend_id AND f.line_account_id = ?`,
    ).bind(lineAccountId).first<{ issued: number; used: number }>(),
    db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(p.breed), ''), '未登録') AS breed, COUNT(*) AS total
         FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id
        WHERE f.line_account_id = ? GROUP BY COALESCE(NULLIF(TRIM(p.breed), ''), '未登録')
        ORDER BY total DESC, breed`,
    ).bind(lineAccountId).all<{ breed: string; total: number }>(),
    db.prepare(
      `SELECT p.id, p.name, p.animal_type, p.breed, p.birthday, p.friend_id,
              f.display_name AS owner_name,
              COUNT(DISTINCT j.id) AS delivery_count,
              MAX(j.sent_at) AS last_delivery_at,
              COUNT(DISTINCT ci.id) AS coupon_issued,
              COUNT(DISTINCT CASE WHEN ci.used_at IS NOT NULL THEN ci.id END) AS coupon_used
         FROM nen_pet_profiles p
         JOIN friends f ON f.id = p.friend_id AND f.line_account_id = ?
         LEFT JOIN nen_delivery_jobs j ON j.friend_id = p.friend_id AND j.line_account_id = ?
          AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)
         LEFT JOIN nen_coupon_issues ci ON ci.pet_id = p.id
        GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC LIMIT 200`,
    ).bind(lineAccountId, lineAccountId, range.fromSql, range.toSql).all<PetMetricRow>(),
    db.prepare(
      `SELECT COUNT(DISTINCT j.id) AS targeted,
              COUNT(DISTINCT CASE WHEN j.status = 'sent' THEN j.id END) AS reached,
              COUNT(DISTINCT lc.friend_id) AS clicked
         FROM nen_delivery_jobs j
         LEFT JOIN tracked_links tl ON tl.line_account_id = j.line_account_id
          AND tl.original_url = json_extract(j.campaign_snapshot, '$.button_url')
         LEFT JOIN link_clicks lc ON lc.tracked_link_id = tl.id AND lc.friend_id = j.friend_id
        WHERE j.line_account_id = ? AND j.campaign_key = 'birthday_coupon'
          AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)`,
    ).bind(lineAccountId, range.fromSql, range.toSql).first<{ targeted: number; reached: number; clicked: number }>(),
  ]);
  const pets = (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    animalType: row.animal_type,
    breed: row.breed,
    birthday: row.birthday,
    friendId: row.friend_id,
    ownerName: row.owner_name,
    ownerDeliveryHistory: {
      count: Number(row.delivery_count ?? 0),
      lastSentAt: row.last_delivery_at,
    },
    coupons: { issued: Number(row.coupon_issued ?? 0), used: Number(row.coupon_used ?? 0) },
  }));
  const coupons = {
    issued: Number(couponCounts?.issued ?? 0),
    used: Number(couponCounts?.used ?? 0),
  };
  return {
    range: { days: range.days, from: range.from, to: range.to },
    summary: {
      pets: Number(petCounts?.total ?? 0),
      birthdayRegistered: Number(petCounts?.birthday_registered ?? 0),
      birthdayMissing: Number(petCounts?.birthday_missing ?? 0),
      birthdayThisMonth: Number(petCounts?.birthday_this_month ?? 0),
      friends: Number(friendCounts?.total ?? 0),
      friendsWithoutPet: Number(friendCounts?.unregistered ?? 0),
      birthdayOpenRate: unavailable('LINEは誕生日配信の個人開封を提供していません'),
      birthdayReachRate: Number(birthdayEngagement?.targeted ?? 0) > 0
        ? Number(birthdayEngagement?.reached ?? 0) / Number(birthdayEngagement?.targeted ?? 0) : 0,
      birthdayClickRate: Number(birthdayEngagement?.reached ?? 0) > 0
        ? Number(birthdayEngagement?.clicked ?? 0) / Number(birthdayEngagement?.reached ?? 0) : 0,
      coupons: {
        ...coupons,
        usageRate: coupons.issued > 0 ? coupons.used / coupons.issued : 0,
      },
    },
    breeds: (breeds.results ?? []).map((row) => ({ name: row.breed, count: Number(row.total ?? 0) })),
    pets,
  };
}

const DELIVERY_STATUSES = new Set(['pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled']);

export function normalizeDeliveryStatus(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !DELIVERY_STATUSES.has(value)) {
    throw new NenCampaignMetricsError('status_invalid', '配信状態が正しくありません', 400, 'status');
  }
  return value;
}

function safeFailureReason(status: string, error: string | null, attempts: number): string | null {
  if (status !== 'failed' && status !== 'skipped') return null;
  const known: Record<string, string> = {
    friend_unavailable: '友だちが配信対象ではありません',
    line_account_unavailable: 'LINE公式アカウントの送信設定を確認できません',
    line_account_mismatch: '友だちと配信元のLINE公式アカウントが一致しません',
    campaign_snapshot_missing: '予約時の配信内容を確認できません',
    campaign_disabled: '配信の決めごとが停止中です',
  };
  if (error && known[error]) return known[error];
  return attempts >= MAX_DELIVERY_ATTEMPTS
    ? '最大回数まで送信に失敗しました'
    : '送信処理でエラーが起きました';
}

type DeliveryListRow = {
  id: string;
  campaign_key: string;
  label: string;
  friend_id: string;
  friend_name: string;
  account_name: string;
  scheduled_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  updated_at: string;
  version: number;
};

export async function listNenDeliveries(
  db: D1Database,
  input: {
    lineAccountId: string;
    range: NenMetricsRange;
    status?: string;
    cursor: number;
    limit: number;
  },
) {
  const statusSql = input.status ? ' AND j.status = ?' : '';
  const statusBinds = input.status ? [input.status] : [];
  const baseBinds = [input.lineAccountId, input.range.fromSql, input.range.toSql, ...statusBinds];
  const summaryRows = await db.prepare(
    `SELECT j.status, COUNT(*) AS total FROM nen_delivery_jobs j
      WHERE j.line_account_id = ?
        AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)
      GROUP BY j.status`,
  ).bind(input.lineAccountId, input.range.fromSql, input.range.toSql)
    .all<{ status: string; total: number }>();
  const unmetRows = await db.prepare(
    `SELECT CASE
              WHEN lower(COALESCE(last_error, '')) LIKE '%block%' THEN 'blocked'
              WHEN lower(COALESCE(last_error, '')) LIKE '%unfollow%'
                OR lower(COALESCE(last_error, '')) LIKE '%unsubscribe%' THEN 'unfollowed'
              ELSE 'other'
            END AS reason, COUNT(*) AS total
       FROM nen_delivery_jobs
      WHERE line_account_id = ? AND status IN ('failed', 'skipped')
        AND datetime(scheduled_at) >= datetime(?) AND datetime(scheduled_at) < datetime(?)
      GROUP BY reason`,
  ).bind(input.lineAccountId, input.range.fromSql, input.range.toSql)
    .all<{ reason: 'blocked' | 'unfollowed' | 'other'; total: number }>();
  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS total FROM nen_delivery_jobs j
      WHERE j.line_account_id = ?
        AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)${statusSql}`,
  ).bind(...baseBinds).first<{ total: number }>();
  const rows = await db.prepare(
    `SELECT j.id, j.campaign_key, s.label, j.friend_id, f.display_name AS friend_name,
            la.name AS account_name, j.scheduled_at, j.status, j.attempts, j.last_error,
            j.sent_at, j.updated_at, j.version
       FROM nen_delivery_jobs j
       JOIN nen_campaign_settings s ON s.campaign_key = j.campaign_key
       JOIN friends f ON f.id = j.friend_id AND f.line_account_id = ?
       JOIN line_accounts la ON la.id = j.line_account_id
      WHERE j.line_account_id = ?
        AND datetime(j.scheduled_at) >= datetime(?) AND datetime(j.scheduled_at) < datetime(?)${statusSql}
      ORDER BY j.scheduled_at DESC, j.id DESC LIMIT ? OFFSET ?`,
  ).bind(
    input.lineAccountId, input.lineAccountId, input.range.fromSql, input.range.toSql,
    ...statusBinds, input.limit, input.cursor,
  ).all<DeliveryListRow>();
  const summary = { pending: 0, processing: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const row of summaryRows.results ?? []) {
    if (row.status in summary) summary[row.status as keyof typeof summary] = Number(row.total ?? 0);
  }
  const total = Number(totalRow?.total ?? 0);
  return {
    range: { days: input.range.days, from: input.range.from, to: input.range.to },
    summary: {
      ...summary,
      retryRequired: await countRetryRequired(db, input.lineAccountId, input.range),
      unmetReasons: Object.fromEntries((unmetRows.results ?? []).map((row) => [row.reason, Number(row.total ?? 0)])),
    },
    deliveries: (rows.results ?? []).map((row) => ({
      id: row.id,
      campaignKey: row.campaign_key,
      label: row.label,
      friendId: row.friend_id,
      friendName: row.friend_name,
      lineAccountName: row.account_name,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      status: row.status,
      attempts: Number(row.attempts ?? 0),
      unmetReason: safeFailureReason(row.status, row.last_error, Number(row.attempts ?? 0)),
      reaction: unavailable('この配信記録に対応する個人の反応は取得できません'),
      version: Number(row.version),
      updatedAt: row.updated_at,
    })),
    pagination: {
      total,
      limit: input.limit,
      cursor: String(input.cursor),
      nextCursor: input.cursor + input.limit < total ? String(input.cursor + input.limit) : null,
    },
  };
}

async function countRetryRequired(
  db: D1Database,
  lineAccountId: string,
  range: NenMetricsRange,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total FROM nen_delivery_jobs
      WHERE line_account_id = ? AND status = 'failed' AND attempts >= ?
        AND datetime(scheduled_at) >= datetime(?) AND datetime(scheduled_at) < datetime(?)`,
  ).bind(lineAccountId, MAX_DELIVERY_ATTEMPTS, range.fromSql, range.toSql)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

function parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function getNenDeliveryDetail(
  db: D1Database,
  id: string,
  lineAccountId: string,
) {
  const row = await db.prepare(
    `SELECT j.id, j.campaign_key, s.label, j.friend_id, f.display_name AS friend_name,
            la.name AS account_name, j.scheduled_at, j.status, j.attempts, j.last_error,
            j.sent_at, j.updated_at, j.version, j.campaign_snapshot
       FROM nen_delivery_jobs j
       JOIN nen_campaign_settings s ON s.campaign_key = j.campaign_key
       JOIN friends f ON f.id = j.friend_id AND f.line_account_id = ?
       JOIN line_accounts la ON la.id = j.line_account_id
      WHERE j.id = ? AND j.line_account_id = ?`,
  ).bind(lineAccountId, id, lineAccountId).first<DeliveryListRow & { campaign_snapshot: string | null }>();
  if (!row) throw new NenCampaignMetricsError('not_found', '配信記録が見つかりません', 404);
  const snapshot = parseSnapshot(row.campaign_snapshot);
  const text = (key: string) => typeof snapshot?.[key] === 'string' ? snapshot[key] as string : null;
  return {
    id: row.id,
    campaignKey: row.campaign_key,
    label: row.label,
    friendId: row.friend_id,
    friendName: row.friend_name,
    lineAccountName: row.account_name,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    unmetReason: safeFailureReason(row.status, row.last_error, Number(row.attempts ?? 0)),
    trigger: triggerLabel(row.campaign_key),
    content: snapshot ? {
      title: text('title'),
      bodyText: text('body_text'),
      buttonLabel: text('button_label'),
      buttonUrl: text('button_url'),
      imageUrl: text('image_url'),
      state: 'available' as const,
      reason: null,
    } : {
      title: null,
      bodyText: null,
      buttonLabel: null,
      buttonUrl: null,
      imageUrl: null,
      state: 'unavailable' as const,
      reason: '予約時の配信内容が保存されていません',
    },
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
}

function triggerLabel(campaignKey: string): string {
  const labels: Record<string, string> = {
    order_confirmed: '注文が確定',
    shipping_confirmed: '発送を登録',
    arrival_check: '発送後の到着確認',
    review_request: '発送後の口コミ依頼',
    cross_sell: '発送後のご案内',
    column: 'コラムの予約',
    birthday_coupon: 'ペットの誕生日',
  };
  return labels[campaignKey] ?? '配信の決めごと';
}

export async function retryNenDelivery(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    reason: string;
    staffId: string;
  },
) {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new NenCampaignMetricsError('version_invalid', '現在の版を指定してください', 400, 'expectedVersion');
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new NenCampaignMetricsError('reason_invalid', '再送理由を1〜500文字で入力してください', 400, 'reason');
  }
  const current = await db.prepare(
    `SELECT id, status, attempts, version, retry_generation
       FROM nen_delivery_jobs WHERE id = ? AND line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<{
    id: string; status: string; attempts: number; version: number; retry_generation: number;
  }>();
  if (!current) throw new NenCampaignMetricsError('not_found', '配信記録が見つかりません', 404);
  if (current.status !== 'failed' || Number(current.attempts) < MAX_DELIVERY_ATTEMPTS) {
    throw new NenCampaignMetricsError(
      'retry_unavailable',
      '最大回数まで失敗した配信だけ、手動で再送できます',
      409,
    );
  }
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE nen_delivery_jobs
        SET status = 'pending', attempts = 0, scheduled_at = ?, last_error = NULL,
            retry_generation = retry_generation + 1, version = version + 1,
            last_retry_reason = ?, last_retry_requested_by = ?, last_retry_requested_at = ?,
            updated_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'failed' AND attempts >= ? AND version = ?`,
  ).bind(
    now, reason, input.staffId, now, now, input.id, input.lineAccountId,
    MAX_DELIVERY_ATTEMPTS, input.expectedVersion,
  ).run();
  if (Number(result.meta.changes ?? 0) === 0) {
    throw new NenCampaignMetricsError(
      'version_conflict',
      'ほかの担当者が先に再送しました。読み直してください',
      409,
    );
  }
  return {
    id: input.id,
    status: 'pending' as const,
    attempts: 0,
    retryGeneration: Number(current.retry_generation ?? 0) + 1,
    version: input.expectedVersion + 1,
    scheduledAt: now,
  };
}
