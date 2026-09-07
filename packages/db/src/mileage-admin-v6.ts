import { getActionScoreBands } from './action-score-rules';

const CONDITION_TYPES = new Set([
  'tag_exists', 'tag_not_exists', 'tag_all', 'tag_not_all',
  'metadata_equals', 'metadata_not_equals', 'ref_code', 'is_following',
  'scenario_subscribed', 'name', 'private_memo', 'status_message',
  'registered_at', 'support_mark', 'is_hidden', 'friend_field',
  'scenario_state', 'form_answered', 'last_reaction_at', 'reaction_state',
  'score_range',
]);

export class MileageV6Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'MileageV6Error';
  }
}

export interface MileageTargetCondition {
  operator: 'AND' | 'OR';
  rules: Array<{ type: string; value: unknown }>;
  groups?: MileageTargetCondition[];
}

export interface MileageEarningRuleDraft {
  name: string;
  eventType: string;
  source: string | null;
  amount: number;
  initialStatus: 'available' | 'pending';
  validFrom: string | null;
  validUntil: string | null;
  expiresAfterDays: number | null;
  cancellationEventTypes: string[];
  targetConditions: MileageTargetCondition | null;
  sortOrder: number;
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new MileageV6Error('date_invalid', `${field}の日時を確認してください`, 422, field);
  }
  return new Date(value).toISOString();
}

function validateTargetCondition(value: unknown): MileageTargetCondition | null {
  if (value === null || value === undefined) return null;
  let count = 0;
  const visit = (candidate: unknown, depth: number): MileageTargetCondition => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 3) {
      throw new MileageV6Error('target_conditions_invalid', '対象条件を確認してください', 422, 'targetConditions');
    }
    const raw = candidate as Record<string, unknown>;
    if (raw.operator !== 'AND' && raw.operator !== 'OR') {
      throw new MileageV6Error('target_conditions_invalid', '対象条件の結び方を確認してください', 422, 'targetConditions');
    }
    if (!Array.isArray(raw.rules)) {
      throw new MileageV6Error('target_conditions_invalid', '対象条件の一覧を確認してください', 422, 'targetConditions');
    }
    const rules = raw.rules.map((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new MileageV6Error('target_conditions_invalid', '対象条件を確認してください', 422, 'targetConditions');
      }
      const typed = rule as Record<string, unknown>;
      if (typeof typed.type !== 'string' || !CONDITION_TYPES.has(typed.type)) {
        throw new MileageV6Error('target_condition_type_invalid', '利用できない対象条件があります', 422, 'targetConditions');
      }
      count += 1;
      if (count > 15) {
        throw new MileageV6Error('target_conditions_too_many', '対象条件は15件までです', 422, 'targetConditions');
      }
      return { type: typed.type, value: typed.value };
    });
    const groups = raw.groups === undefined
      ? undefined
      : Array.isArray(raw.groups) ? raw.groups.map((group) => visit(group, depth + 1)) : null;
    if (groups === null) {
      throw new MileageV6Error('target_conditions_invalid', '対象条件のグループを確認してください', 422, 'targetConditions');
    }
    return { operator: raw.operator, rules, ...(groups ? { groups } : {}) };
  };
  const parsed = visit(value, 0);
  if (JSON.stringify(parsed).length > 16_384) {
    throw new MileageV6Error('target_conditions_too_large', '対象条件が長すぎます', 422, 'targetConditions');
  }
  return parsed;
}

export function validateMileageEarningRuleDraft(value: unknown): MileageEarningRuleDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MileageV6Error('draft_required', '下書きの内容が必要です', 422, 'draft');
  }
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const eventType = typeof raw.eventType === 'string' ? raw.eventType.trim() : '';
  const source = raw.source === null || raw.source === undefined || raw.source === ''
    ? null
    : typeof raw.source === 'string' ? raw.source.trim() : '';
  const amount = Number(raw.amount);
  const initialStatus = raw.initialStatus === 'pending' ? 'pending' : raw.initialStatus === 'available' ? 'available' : null;
  if (!name || name.length > 120) throw new MileageV6Error('name_invalid', 'ルール名を確認してください', 422, 'name');
  if (!eventType || eventType.length > 100) throw new MileageV6Error('event_type_invalid', 'きっかけを確認してください', 422, 'eventType');
  if (source === '' || (source && source.length > 100)) throw new MileageV6Error('source_invalid', '出どころを確認してください', 422, 'source');
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw new MileageV6Error('amount_invalid', '付与マイルは1〜1,000,000の整数で指定してください', 422, 'amount');
  }
  if (!initialStatus) throw new MileageV6Error('initial_status_invalid', '付与状態を確認してください', 422, 'initialStatus');
  const validFrom = optionalDate(raw.validFrom, 'validFrom');
  const validUntil = optionalDate(raw.validUntil, 'validUntil');
  if (validFrom && validUntil && validFrom >= validUntil) {
    throw new MileageV6Error('valid_period_invalid', '終了日時は開始日時より後にしてください', 422, 'validUntil');
  }
  const expiresAfterDays = raw.expiresAfterDays === null || raw.expiresAfterDays === undefined
    ? null
    : Number(raw.expiresAfterDays);
  if (expiresAfterDays !== null && (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1 || expiresAfterDays > 3650)) {
    throw new MileageV6Error('expiration_invalid', '失効期間は1〜3650日で指定してください', 422, 'expiresAfterDays');
  }
  const cancellationEventTypes = Array.isArray(raw.cancellationEventTypes)
    ? [...new Set(raw.cancellationEventTypes.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
    : [];
  if (cancellationEventTypes.length > 10 || cancellationEventTypes.some((item) => item.length > 100)) {
    throw new MileageV6Error('cancellation_events_invalid', '取消イベントは10件までです', 422, 'cancellationEventTypes');
  }
  const sortOrder = raw.sortOrder === undefined ? 0 : Number(raw.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
    throw new MileageV6Error('sort_order_invalid', '並び順を確認してください', 422, 'sortOrder');
  }
  return {
    name,
    eventType,
    source,
    amount,
    initialStatus,
    validFrom,
    validUntil,
    expiresAfterDays,
    cancellationEventTypes,
    targetConditions: validateTargetCondition(raw.targetConditions),
    sortOrder,
  };
}

type DraftRow = {
  rule_id: string;
  line_account_id: string;
  version: number;
  draft_json: string;
  updated_at: string;
};

function mapDraft(row: DraftRow) {
  return {
    ruleId: row.rule_id,
    lineAccountId: row.line_account_id,
    version: Number(row.version),
    draft: JSON.parse(row.draft_json) as MileageEarningRuleDraft,
    updatedAt: row.updated_at,
  };
}

export async function saveMileageEarningRuleDraft(
  db: D1Database,
  input: {
    ruleId: string;
    lineAccountId: string;
    expectedVersion: number | null;
    draft: unknown;
    updatedByStaffId?: string | null;
  },
) {
  const draft = validateMileageEarningRuleDraft(input.draft);
  const rule = await db.prepare(`SELECT id FROM mileage_rules WHERE id = ?`).bind(input.ruleId)
    .first<{ id: string }>();
  if (!rule) throw new MileageV6Error('rule_not_found', '付与ルールが見つかりません', 404);
  const current = await db.prepare(
    `SELECT rule_id, line_account_id, version, draft_json, updated_at
       FROM mileage_earning_rule_drafts WHERE rule_id = ?`,
  ).bind(input.ruleId).first<DraftRow>();
  if (current && current.line_account_id !== input.lineAccountId) {
    throw new MileageV6Error('rule_not_found', '付与ルールが見つかりません', 404);
  }
  const now = new Date().toISOString();
  if (!current) {
    if (input.expectedVersion !== null && input.expectedVersion !== 0) {
      throw new MileageV6Error('version_conflict', '下書きを読み直してください', 409);
    }
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO mileage_earning_rule_drafts
         (rule_id, line_account_id, version, draft_json, updated_by_staff_id, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).bind(
      input.ruleId, input.lineAccountId, JSON.stringify(draft), input.updatedByStaffId ?? null, now, now,
    ).run();
    if ((inserted.meta?.changes ?? 0) !== 1) {
      throw new MileageV6Error('version_conflict', '下書きを読み直してください', 409);
    }
  } else {
    if (input.expectedVersion !== current.version) {
      throw new MileageV6Error('version_conflict', '下書きを読み直してください', 409);
    }
    const updated = await db.prepare(
      `UPDATE mileage_earning_rule_drafts
          SET version = version + 1, draft_json = ?, updated_by_staff_id = ?, updated_at = ?
        WHERE rule_id = ? AND line_account_id = ? AND version = ?`,
    ).bind(
      JSON.stringify(draft), input.updatedByStaffId ?? null, now,
      input.ruleId, input.lineAccountId, current.version,
    ).run();
    if ((updated.meta?.changes ?? 0) !== 1) {
      throw new MileageV6Error('version_conflict', '下書きを読み直してください', 409);
    }
  }
  const saved = await db.prepare(
    `SELECT rule_id, line_account_id, version, draft_json, updated_at
       FROM mileage_earning_rule_drafts WHERE rule_id = ? AND line_account_id = ?`,
  ).bind(input.ruleId, input.lineAccountId).first<DraftRow>();
  if (!saved) throw new MileageV6Error('save_failed', '下書きを保存できませんでした', 500);
  return mapDraft(saved);
}

export async function getMileageEarningRulesV6(
  db: D1Database,
  input: { lineAccountId: string; limit: number; offset: number },
) {
  const [rows, counts] = await Promise.all([
    db.prepare(
      `SELECT r.id, r.name, r.event_type, r.source, r.amount, r.initial_status,
              r.is_active, r.valid_from, r.valid_until, r.created_at, r.updated_at,
              d.version, d.draft_json, d.updated_at AS draft_updated_at,
              (SELECT COUNT(*) FROM engagement_events ee
                JOIN friends ef ON ef.id = ee.actor_friend_id
               WHERE ef.line_account_id = ? AND ee.event_type = r.event_type
                 AND (r.source IS NULL OR r.source = ee.source)
                 AND ee.occurred_at >= datetime('now', '-30 days')) AS eligible_30d,
              (SELECT COUNT(*) FROM mileage_ledger ml
                JOIN friends lf ON lf.id = ml.beneficiary_friend_id
               WHERE lf.line_account_id = ? AND ml.mileage_rule_id = r.id
                 AND ml.entry_type = 'grant' AND ml.occurred_at >= datetime('now', '-30 days')) AS granted_30d
         FROM mileage_earning_rule_drafts d
         JOIN mileage_rules r ON r.id = d.rule_id
        WHERE d.line_account_id = ?
        ORDER BY COALESCE(json_extract(d.draft_json, '$.sortOrder'), 0), r.created_at, r.id
        LIMIT ? OFFSET ?`,
    ).bind(input.lineAccountId, input.lineAccountId, input.lineAccountId, input.limit, input.offset).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM mileage_earning_rule_drafts WHERE line_account_id = ?) AS total,
         (SELECT COUNT(*) FROM mileage_rules r
           WHERE NOT EXISTS (SELECT 1 FROM mileage_earning_rule_drafts d WHERE d.rule_id = r.id)) AS unassigned_legacy_count`,
    ).bind(input.lineAccountId).first<{ total: number; unassigned_legacy_count: number }>(),
  ]);
  return {
    items: rows.results.map((row) => {
      const eligible = Number(row.eligible_30d ?? 0);
      const granted = Number(row.granted_30d ?? 0);
      return {
        id: String(row.id),
        published: {
          name: String(row.name), eventType: String(row.event_type), source: row.source ?? null,
          amount: Number(row.amount), initialStatus: row.initial_status,
          validFrom: row.valid_from ?? null, validUntil: row.valid_until ?? null,
          status: Number(row.is_active) ? 'published' : 'stopped', updatedAt: row.updated_at,
        },
        draft: JSON.parse(String(row.draft_json)) as MileageEarningRuleDraft,
        draftVersion: Number(row.version),
        draftUpdatedAt: row.draft_updated_at,
        metrics30d: { eligible, granted, excluded: Math.max(0, eligible - granted) },
      };
    }),
    pagination: { total: Number(counts?.total ?? 0), limit: input.limit, offset: input.offset },
    unassignedLegacyCount: Number(counts?.unassigned_legacy_count ?? 0),
    measuredAt: new Date().toISOString(),
  };
}

export async function getMileageFriendsV6(
  db: D1Database,
  input: { lineAccountId: string; visibleAccountIds: string[]; search: string; limit: number; offset: number },
) {
  const rankRows = await db.prepare(
    `SELECT r.id, r.name, v.required_miles
       FROM mileage_rewards r
       JOIN mileage_reward_versions v ON v.id = r.current_published_version_id
      WHERE r.line_account_id = ? AND r.reward_kind = 'rank'
        AND r.status = 'published' AND v.status = 'published'
      ORDER BY v.required_miles, r.sort_order, r.id`,
  ).bind(input.lineAccountId).all<{ id: string; name: string; required_miles: number }>();
  const ranks = rankRows.results.map((row) => ({
    id: row.id, name: row.name, threshold: Number(row.required_miles),
  }));
  const visible = [...new Set([input.lineAccountId, ...input.visibleAccountIds])];
  const placeholders = visible.map(() => '?').join(',');
  const ctes = `WITH selected AS (
    SELECT f.id AS friend_id, f.user_id, f.display_name, f.picture_url, f.line_account_id,
           la.name AS line_account_name,
           CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END AS beneficiary_key
      FROM friends f JOIN line_accounts la ON la.id = f.line_account_id
     WHERE f.line_account_id = ?
  ), ledger AS (
    SELECT s.beneficiary_key,
           SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END) AS available,
           SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END) AS pending,
           SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0 THEN ml.amount ELSE 0 END) AS lifetime_earned,
           ABS(SUM(CASE WHEN ml.entry_type = 'spend' AND ml.amount < 0 THEN ml.amount ELSE 0 END)) AS spent,
           SUM(CASE WHEN ml.occurred_at >= datetime('now', 'start of month') THEN ml.amount ELSE 0 END) AS month_change,
           MAX(ml.occurred_at) AS last_changed_at
      FROM selected s
      LEFT JOIN mileage_ledger ml ON ml.program_id = 'default' AND (
        (s.user_id IS NOT NULL AND ml.beneficiary_user_id = s.user_id)
        OR (s.user_id IS NULL AND ml.beneficiary_friend_id = s.friend_id)
      )
      LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
     WHERE ml.id IS NULL OR bf.line_account_id IN (${placeholders})
        OR (ml.beneficiary_friend_id IS NULL AND ml.beneficiary_user_id = s.user_id)
     GROUP BY s.beneficiary_key
  ), expiring AS (
    SELECT s.beneficiary_key, SUM(l.remaining_amount) AS amount, COUNT(*) AS lot_count
      FROM selected s JOIN mileage_grant_lots l ON l.program_id = 'default' AND l.beneficiary_key = s.beneficiary_key
     WHERE l.status = 'available' AND l.remaining_amount > 0 AND l.expires_at IS NOT NULL
       AND datetime(l.expires_at) > datetime('now') AND datetime(l.expires_at) <= datetime('now', '+30 days')
     GROUP BY s.beneficiary_key
  )`;
  const binds = [input.lineAccountId, ...visible];
  const rows = await db.prepare(
    `${ctes}
     SELECT s.*, COALESCE(l.available, 0) AS available, COALESCE(l.pending, 0) AS pending,
            COALESCE(l.lifetime_earned, 0) AS lifetime_earned, COALESCE(l.spent, 0) AS spent,
            COALESCE(l.month_change, 0) AS month_change, l.last_changed_at,
            e.amount AS expiring_amount, e.lot_count, COUNT(*) OVER() AS filtered_count
       FROM selected s LEFT JOIN ledger l ON l.beneficiary_key = s.beneficiary_key
       LEFT JOIN expiring e ON e.beneficiary_key = s.beneficiary_key
      WHERE (? = '' OR s.display_name LIKE '%' || ? || '%')
      ORDER BY available DESC, s.display_name, s.friend_id LIMIT ? OFFSET ?`,
  ).bind(...binds, input.search, input.search, input.limit, input.offset).all<Record<string, unknown>>();
  const summary = await db.prepare(
    `${ctes}
     SELECT COUNT(*) AS total_members,
            SUM(CASE WHEN COALESCE(l.available, 0) > 0 OR COALESCE(l.pending, 0) > 0 THEN 1 ELSE 0 END) AS with_balance_count,
            COALESCE(SUM(COALESCE(l.available, 0)), 0) AS available,
            COALESCE(SUM(COALESCE(l.pending, 0)), 0) AS pending,
            SUM(e.amount) AS expiring_amount, SUM(COALESCE(e.lot_count, 0)) AS expiring_lot_count
       FROM selected s LEFT JOIN ledger l ON l.beneficiary_key = s.beneficiary_key
       LEFT JOIN expiring e ON e.beneficiary_key = s.beneficiary_key`,
  ).bind(...binds).first<Record<string, unknown>>();
  const rankPopulation = await db.prepare(
    `${ctes}
     SELECT s.friend_id, COALESCE(l.available, 0) AS available,
            COALESCE(l.month_change, 0) AS month_change
       FROM selected s LEFT JOIN ledger l ON l.beneficiary_key = s.beneficiary_key`,
  ).bind(...binds).all<{ friend_id: string; available: number; month_change: number }>();
  const rankFor = (available: number) => [...ranks].reverse().find((rank) => available >= rank.threshold) ?? null;
  const rankCounts = ranks.map((rank) => ({
    rewardId: rank.id,
    rankName: rank.name,
    requiredMiles: rank.threshold,
    friendCount: rankPopulation.results.filter((friend) => rankFor(Number(friend.available))?.id === rank.id).length,
  }));
  return {
    summary: {
      totalMembers: Number(summary?.total_members ?? 0),
      withBalanceCount: Number(summary?.with_balance_count ?? 0),
      available: Number(summary?.available ?? 0),
      pending: Number(summary?.pending ?? 0),
      monthChange: rankPopulation.results.reduce((sum, row) => sum + Number(row.month_change ?? 0), 0),
      rankCounts,
      expiringMiles30d: Number(summary?.expiring_lot_count ?? 0) > 0
        ? Number(summary?.expiring_amount ?? 0) : null,
    },
    items: rows.results.map((row) => {
      const available = Number(row.available ?? 0);
      const rank = rankFor(available);
      const nextRank = ranks.find((candidate) => candidate.threshold > available) ?? null;
      return ({
      friendId: row.friend_id,
      displayName: row.display_name || '名前未設定',
      pictureUrl: row.picture_url ?? null,
      rank: rank?.name ?? null,
      rankReason: ranks.length === 0 ? '公開中のランクがありません' : rank ? `${rank.threshold.toLocaleString('ja-JP')}マイル以上` : '最初のランクに届いていません',
      rankThreshold: rank?.threshold ?? null,
      nextRank: nextRank?.name ?? null,
      nextRankThreshold: nextRank?.threshold ?? null,
      milesToNextRank: nextRank ? Math.max(0, nextRank.threshold - available) : null,
      monthChange: Number(row.month_change ?? 0),
      available: Number(row.available ?? 0),
      pending: Number(row.pending ?? 0),
      expiringMiles30d: Number(row.lot_count ?? 0) > 0 ? Number(row.expiring_amount ?? 0) : null,
      lifetimeEarned: Number(row.lifetime_earned ?? 0),
      spent: Number(row.spent ?? 0),
      lastChangedAt: row.last_changed_at ?? null,
      walletScope: row.user_id ? 'verified_user' : 'friend',
      lineAccount: { id: row.line_account_id, name: row.line_account_name },
    })}),
    pagination: {
      total: Number(rows.results[0]?.filtered_count ?? 0), limit: input.limit, offset: input.offset,
    },
    measuredAt: new Date().toISOString(),
  };
}

export async function getMileageHistoryPeriodSummary(
  db: D1Database,
  input: { lineAccountId: string; from?: string; to?: string },
) {
  const where = [
    `(f.line_account_id = ? OR (ml.beneficiary_friend_id IS NULL AND EXISTS (
      SELECT 1 FROM friends uf WHERE uf.user_id = ml.beneficiary_user_id AND uf.line_account_id = ?
    )))`,
  ];
  const binds: unknown[] = [input.lineAccountId, input.lineAccountId];
  if (input.from) { where.push("date(ml.occurred_at, '+9 hours') >= date(?)"); binds.push(input.from); }
  if (input.to) { where.push("date(ml.occurred_at, '+9 hours') <= date(?)"); binds.push(input.to); }
  const rows = await db.prepare(
    `SELECT ml.entry_type, COUNT(*) AS count, COALESCE(SUM(ml.amount), 0) AS amount,
            SUM(CASE WHEN ml.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN ml.entry_type = 'adjustment' OR ml.source IN ('manual','admin_adjustment') THEN 1 ELSE 0 END) AS manual_count
       FROM mileage_ledger ml LEFT JOIN friends f ON f.id = ml.beneficiary_friend_id
      WHERE ${where.join(' AND ')} GROUP BY ml.entry_type ORDER BY ml.entry_type`,
  ).bind(...binds).all<{ entry_type: string; count: number; amount: number; pending_count: number; manual_count: number }>();
  return {
    from: input.from ?? null,
    to: input.to ?? null,
    byType: rows.results.map((row) => ({
      entryType: row.entry_type, count: Number(row.count), amount: Number(row.amount),
    })),
    totalAmount: rows.results.reduce((sum, row) => sum + Number(row.amount), 0),
    manualCount: rows.results.reduce((sum, row) => sum + Number(row.manual_count), 0),
    pendingCount: rows.results.reduce((sum, row) => sum + Number(row.pending_count), 0),
    measuredAt: new Date().toISOString(),
  };
}

export async function getMileageRewardReachMetrics(db: D1Database, lineAccountId: string) {
  const rows = await db.prepare(
    `SELECT r.id, r.name, r.reward_kind, v.required_miles,
            COUNT(DISTINCT CASE WHEN w.available >= v.required_miles THEN w.beneficiary_key END) AS reachable_count,
            COUNT(DISTINCT CASE WHEN mr.status = 'succeeded' THEN mr.beneficiary_key END) AS redeemed_friend_count
       FROM mileage_rewards r
       JOIN mileage_reward_versions v ON v.id = COALESCE(r.current_published_version_id, r.current_draft_version_id)
       LEFT JOIN mileage_wallets w ON w.program_id = r.program_id AND EXISTS (
         SELECT 1 FROM friends f WHERE f.line_account_id = ? AND (
           (w.beneficiary_user_id IS NOT NULL AND f.user_id = w.beneficiary_user_id)
           OR (w.beneficiary_friend_id IS NOT NULL AND f.id = w.beneficiary_friend_id)
         )
       )
       LEFT JOIN mileage_redemptions mr ON mr.reward_id = r.id
      WHERE r.line_account_id = ?
      GROUP BY r.id, r.name, r.reward_kind, v.required_miles ORDER BY r.sort_order, r.id`,
  ).bind(lineAccountId, lineAccountId).all<{
    id: string; name: string; reward_kind: string; required_miles: number;
    reachable_count: number; redeemed_friend_count: number;
  }>();
  return rows.results.map((row) => {
    const reachable = Number(row.reachable_count ?? 0);
    const redeemed = Number(row.redeemed_friend_count ?? 0);
    return {
      rewardId: row.id,
      rewardName: row.name,
      rewardKind: row.reward_kind,
      requiredMiles: Number(row.required_miles),
      reachableFriendCount: reachable,
      redeemedFriendCount: redeemed,
      exchangeRate: reachable > 0 ? redeemed / reachable : null,
    };
  });
}

export async function getActionScoreBandOverview(db: D1Database, lineAccountId: string) {
  const bands = await getActionScoreBands(db, lineAccountId);
  const rows = await db.prepare(
    `SELECT CASE WHEN f.score >= ? THEN 'high' WHEN f.score >= ? THEN 'normal' ELSE 'low' END AS band,
            COUNT(*) AS friend_count,
            COALESCE(SUM(recent.change_30d), 0) AS change_30d
       FROM friends f
       LEFT JOIN (
         SELECT friend_id, SUM(score_change) AS change_30d FROM friend_scores
          WHERE created_at >= datetime('now', '-30 days') GROUP BY friend_id
       ) recent ON recent.friend_id = f.id
      WHERE f.line_account_id = ? GROUP BY band`,
  ).bind(bands.highMin, bands.normalMin, lineAccountId).all<{
    band: 'low' | 'normal' | 'high'; friend_count: number; change_30d: number;
  }>();
  const reasons = await db.prepare(
    `WITH reason_counts AS (
       SELECT CASE WHEN f.score >= ? THEN 'high' WHEN f.score >= ? THEN 'normal' ELSE 'low' END AS band,
              COALESCE(fs.reason, '理由未登録') AS reason, COUNT(*) AS count
         FROM friend_scores fs JOIN friends f ON f.id = fs.friend_id
        WHERE f.line_account_id = ? AND fs.created_at >= datetime('now', '-30 days')
        GROUP BY band, reason
     ), ranked AS (
       SELECT band, reason, count,
              ROW_NUMBER() OVER (PARTITION BY band ORDER BY count DESC, reason) AS position
         FROM reason_counts
     )
     SELECT band, reason, count FROM ranked WHERE position <= 3 ORDER BY band, position`,
  ).bind(bands.highMin, bands.normalMin, lineAccountId).all<{
    band: 'low' | 'normal' | 'high'; reason: string; count: number;
  }>();
  const order = ['low', 'normal', 'high'] as const;
  return {
    ...bands,
    bandSummaries: order.map((band) => {
      const row = rows.results.find((item) => item.band === band);
      return {
        band,
        friendCount: Number(row?.friend_count ?? 0),
        change30d: Number(row?.change_30d ?? 0),
        topReasons: reasons.results.filter((item) => item.band === band)
          .map((item) => ({ reason: item.reason, count: Number(item.count) })),
      };
    }),
    measuredAt: new Date().toISOString(),
  };
}

export type MileageAdjustmentNotificationStatus = 'pending' | 'sent' | 'failed';

export interface MileageAdjustmentNotification {
  id: string;
  lineAccountId: string;
  friendId: string;
  ledgerEntryId: string;
  status: MileageAdjustmentNotificationStatus;
  attemptCount: number;
  lineRequestId: string | null;
  errorCode: string | null;
  sentAt: string | null;
}

type NotificationRow = {
  id: string; line_account_id: string; friend_id: string; ledger_entry_id: string;
  status: MileageAdjustmentNotificationStatus; attempt_count: number;
  line_request_id: string | null; error_code: string | null; sent_at: string | null;
};

function mapNotification(row: NotificationRow): MileageAdjustmentNotification {
  return {
    id: row.id, lineAccountId: row.line_account_id, friendId: row.friend_id,
    ledgerEntryId: row.ledger_entry_id, status: row.status, attemptCount: Number(row.attempt_count),
    lineRequestId: row.line_request_id, errorCode: row.error_code, sentAt: row.sent_at,
  };
}

export async function reserveMileageAdjustmentNotification(
  db: D1Database,
  input: { lineAccountId: string; friendId: string; ledgerEntryId: string; idempotencyKey: string; message: string },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO mileage_adjustment_notifications
       (id, line_account_id, friend_id, ledger_entry_id, idempotency_key, message_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    id, input.lineAccountId, input.friendId, input.ledgerEntryId, input.idempotencyKey,
    input.message, now, now,
  ).run();
  const row = await db.prepare(
    `SELECT id, line_account_id, friend_id, ledger_entry_id, status, attempt_count,
            line_request_id, error_code, sent_at
       FROM mileage_adjustment_notifications WHERE ledger_entry_id = ?`,
  ).bind(input.ledgerEntryId).first<NotificationRow>();
  if (!row) throw new MileageV6Error('notification_reserve_failed', '通知の送信記録を作れませんでした', 500);
  return mapNotification(row);
}

export async function markMileageAdjustmentNotification(
  db: D1Database,
  input: { id: string; status: 'sent' | 'failed'; lineRequestId?: string | null; errorCode?: string | null },
) {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE mileage_adjustment_notifications
        SET status = ?, attempt_count = attempt_count + 1, line_request_id = ?, error_code = ?,
            first_failed_at = CASE WHEN ? = 'failed' THEN COALESCE(first_failed_at, ?) ELSE first_failed_at END,
            sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, updated_at = ?
      WHERE id = ?`,
  ).bind(
    input.status, input.lineRequestId ?? null, input.errorCode ?? null,
    input.status, now, input.status, now, now, input.id,
  ).run();
  const row = await db.prepare(
    `SELECT id, line_account_id, friend_id, ledger_entry_id, status, attempt_count,
            line_request_id, error_code, sent_at
       FROM mileage_adjustment_notifications WHERE id = ?`,
  ).bind(input.id).first<NotificationRow>();
  if (!row) throw new MileageV6Error('notification_not_found', '通知の送信記録が見つかりません', 404);
  return mapNotification(row);
}
