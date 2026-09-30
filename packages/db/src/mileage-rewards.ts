import { matchesCondition, type SegmentCondition } from './segment-conditions.js';

export type MileageRewardKind =
  | 'coupon'
  | 'tag'
  | 'scenario'
  | 'template'
  | 'early_access'
  | 'rank';

export type MileageRewardStatus = 'draft' | 'published' | 'stopped' | 'archived';
export type MileageRewardFailurePolicy = 'retry' | 'refund' | 'manual';
export interface MileageRewardTargetCondition {
  operator: 'AND' | 'OR';
  rules: Array<{ type: string; value: unknown }>;
  groups?: MileageRewardTargetCondition[];
}
export type MileageRedemptionStatus =
  | 'reserved'
  | 'delivering'
  | 'succeeded'
  | 'delivery_failed'
  | 'refunded';

export interface MileageRewardVersion {
  id: string;
  versionNumber: number;
  status: 'draft' | 'published';
  /** 保存ごとに増える更新番号。同時編集の検知に使う。 */
  revision: number;
  requiredMiles: number;
  stockLimit: number | null;
  perFriendLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  benefitExpiresDays: number | null;
  commonActionVersionId: string | null;
  targetConditions: MileageRewardTargetCondition | null;
  failurePolicy: MileageRewardFailurePolicy;
  customerMessage: string;
  publishedAt: string | null;
}

export interface MileageRewardSummary {
  id: string;
  lineAccountId: string;
  programId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  rewardKind: MileageRewardKind;
  status: MileageRewardStatus;
  sortOrder: number;
  currentDraftVersionId: string | null;
  currentPublishedVersionId: string | null;
  currentVersion: MileageRewardVersion | null;
  exchangedThisMonth: number;
  availableCodeCount: number | null;
  benefitName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MileageRewardAdminOverview {
  rewards: MileageRewardSummary[];
  summary: {
    publishedCount: number;
    redeemedMilesThisMonth: number;
    neverRedeemedFriendCount: number | null;
    mostRedeemedRewardName: string | null;
    mostRedeemedRewardCount: number | null;
  };
}

export interface MileageRewardDraftInput {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  rewardKind: MileageRewardKind;
  requiredMiles: number;
  stockLimit?: number | null;
  perFriendLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  benefitExpiresDays?: number | null;
  commonActionVersionId?: string | null;
  targetConditions?: MileageRewardTargetCondition | null;
  failurePolicy?: MileageRewardFailurePolicy;
  customerMessage?: string;
}

export interface MileageRewardRedemption {
  id: string;
  lineAccountId: string;
  programId: string;
  beneficiaryKey: string;
  beneficiaryUserId: string | null;
  beneficiaryFriendId: string | null;
  rewardId: string;
  rewardVersionId: string;
  spendLedgerEntryId: string | null;
  rewardCodeId: string | null;
  /** 交換が決まったときの名前・種類。未公開の名前変更が過去の交換へ混ざらない。 */
  rewardNameSnapshot: string | null;
  rewardKindSnapshot: MileageRewardKind | null;
  idempotencyKey: string;
  requestFingerprint: string;
  status: MileageRedemptionStatus;
  attemptCount: number;
  nextRetryAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MileageRewardError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'MileageRewardError';
  }
}

type RewardRow = {
  id: string;
  line_account_id: string;
  program_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  reward_kind: MileageRewardKind;
  status: MileageRewardStatus;
  sort_order: number;
  current_draft_version_id: string | null;
  current_published_version_id: string | null;
  created_at: string;
  updated_at: string;
  version_id: string | null;
  version_number: number | null;
  version_status: 'draft' | 'published' | null;
  revision: number | null;
  required_miles: number | null;
  stock_limit: number | null;
  per_friend_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  benefit_expires_days: number | null;
  common_action_version_id: string | null;
  target_conditions: string | null;
  failure_policy: MileageRewardFailurePolicy | null;
  customer_message: string | null;
  published_at: string | null;
  exchanged_this_month: number;
  available_code_count: number | null;
  benefit_name: string | null;
};

type RedemptionRow = {
  id: string;
  line_account_id: string;
  program_id: string;
  beneficiary_key: string;
  beneficiary_user_id: string | null;
  beneficiary_friend_id: string | null;
  reward_id: string;
  reward_version_id: string;
  spend_ledger_entry_id: string | null;
  reward_code_id: string | null;
  reward_name_snapshot: string | null;
  reward_kind_snapshot: MileageRewardKind | null;
  idempotency_key: string;
  request_fingerprint: string;
  status: MileageRedemptionStatus;
  attempt_count: number;
  next_retry_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  delivered_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

type WalletRow = {
  beneficiary_key: string;
  beneficiary_user_id: string | null;
  beneficiary_friend_id: string | null;
  available: number;
  version: number;
};

type LotRow = {
  ledger_entry_id: string;
  remaining_amount: number;
};

const REWARD_KINDS = new Set<MileageRewardKind>([
  'coupon', 'tag', 'scenario', 'template', 'early_access', 'rank',
]);
const FAILURE_POLICIES = new Set<MileageRewardFailurePolicy>(['retry', 'refund', 'manual']);
const TARGET_CONDITION_TYPES = new Set([
  'tag_exists', 'tag_not_exists', 'tag_all', 'tag_not_all',
  'metadata_equals', 'metadata_not_equals', 'ref_code', 'is_following',
  'scenario_subscribed', 'name', 'private_memo', 'status_message',
  'registered_at', 'support_mark', 'is_hidden', 'friend_field',
  'scenario_state', 'form_answered', 'last_reaction_at', 'reaction_state',
  'score_range',
]);

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MileageRewardError('required', `${label}を入力してください`);
  }
  const text = value.trim();
  if (text.length > max) throw new MileageRewardError('too_long', `${label}は${max}文字までです`);
  return text;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new MileageRewardError('invalid_text', `${label}を確認してください`);
  const text = value.trim();
  if (text.length > max) throw new MileageRewardError('too_long', `${label}は${max}文字までです`);
  return text || null;
}

function positiveInteger(value: unknown, label: string, optional = false): number | null {
  if (optional && (value == null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MileageRewardError('invalid_number', `${label}は1以上の整数で入力してください`);
  }
  return parsed;
}

/*
 * 在庫だけは 0 が意味を持つ（品切れ）。空欄は無制限、0 は品切れ、
 * 正の整数は上限。画面の案内と交換判定（0 なら常に在庫切れ）と揃える。
 */
function nonNegativeInteger(value: unknown, label: string): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MileageRewardError('invalid_number', `${label}は0以上の整数で入力してください`);
  }
  return parsed;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new MileageRewardError('invalid_date', `${label}を確認してください`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MileageRewardError('invalid_date', `${label}を確認してください`);
  }
  // R369: 時差付きのまま保存すると文字列比較で期間を誤判定する。
  // 保存時にUTCへ正規化し、比較は同じ基準の時刻値で行う。
  return parsed.toISOString();
}

function validateRewardTargetConditions(value: unknown): MileageRewardTargetCondition | null {
  if (value === null || value === undefined) return null;
  let count = 0;
  const visit = (candidate: unknown, depth: number): MileageRewardTargetCondition => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 3) {
      throw new MileageRewardError('target_conditions_invalid', '交換できる友だちの条件を確認してください');
    }
    const raw = candidate as Record<string, unknown>;
    if ((raw.operator !== 'AND' && raw.operator !== 'OR') || !Array.isArray(raw.rules)) {
      throw new MileageRewardError('target_conditions_invalid', '交換できる友だちの条件を確認してください');
    }
    const rules = raw.rules.map((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        throw new MileageRewardError('target_conditions_invalid', '交換できる友だちの条件を確認してください');
      }
      const typed = rule as Record<string, unknown>;
      if (typeof typed.type !== 'string' || !TARGET_CONDITION_TYPES.has(typed.type)) {
        throw new MileageRewardError('target_condition_type_invalid', '利用できない交換条件があります');
      }
      count += 1;
      if (count > 15) {
        throw new MileageRewardError('target_conditions_too_many', '交換条件は15件までです');
      }
      return { type: typed.type, value: typed.value };
    });
    const groups = raw.groups === undefined
      ? undefined
      : Array.isArray(raw.groups) ? raw.groups.map((group) => visit(group, depth + 1)) : null;
    if (groups === null) {
      throw new MileageRewardError('target_conditions_invalid', '交換できる友だちの条件を確認してください');
    }
    return { operator: raw.operator, rules, ...(groups ? { groups } : {}) };
  };
  const parsed = visit(value, 0);
  if (JSON.stringify(parsed).length > 16_384) {
    throw new MileageRewardError('target_conditions_too_large', '交換条件が長すぎます');
  }
  return parsed;
}

export function validateMileageRewardDraft(value: MileageRewardDraftInput): Required<
  Omit<MileageRewardDraftInput, 'description' | 'imageUrl' | 'stockLimit' | 'perFriendLimit' | 'targetConditions'>
> & {
  description: string | null;
  imageUrl: string | null;
  stockLimit: number | null;
  perFriendLimit: number | null;
  targetConditions: MileageRewardTargetCondition | null;
} {
  const rewardKind = value.rewardKind;
  if (!REWARD_KINDS.has(rewardKind)) {
    throw new MileageRewardError('invalid_kind', '使い道の種類を選んでください');
  }
  const failurePolicy = value.failurePolicy ?? 'retry';
  if (!FAILURE_POLICIES.has(failurePolicy)) {
    throw new MileageRewardError('invalid_failure_policy', '失敗したときの扱いを確認してください');
  }
  const startsAt = optionalDate(value.startsAt, '交換開始日時');
  const endsAt = optionalDate(value.endsAt, '交換終了日時');
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new MileageRewardError('invalid_period', '交換終了は交換開始より後にしてください');
  }
  const commonActionVersionId = optionalText(value.commonActionVersionId, '交換後の動き', 100);
  if (rewardKind !== 'coupon' && !commonActionVersionId) {
    throw new MileageRewardError('action_required', '交換後に渡すものを選んでください');
  }
  return {
    name: requiredText(value.name, '使い道の名前', 120),
    description: optionalText(value.description, '説明', 1000),
    imageUrl: optionalText(value.imageUrl, '画像URL', 2000),
    rewardKind,
    requiredMiles: positiveInteger(value.requiredMiles, '必要マイル')!,
    stockLimit: nonNegativeInteger(value.stockLimit, '在庫数'),
    perFriendLimit: positiveInteger(value.perFriendLimit, '1人あたりの交換上限', true),
    startsAt,
    endsAt,
    benefitExpiresDays: positiveInteger(value.benefitExpiresDays, '交換後の有効日数', true),
    commonActionVersionId,
    targetConditions: validateRewardTargetConditions(value.targetConditions),
    failurePolicy,
    customerMessage: optionalText(value.customerMessage, '交換後の案内', 1000) ?? '',
  };
}

function mapVersion(row: RewardRow): MileageRewardVersion | null {
  if (!row.version_id || row.version_number == null || !row.version_status || row.required_miles == null) return null;
  return {
    id: row.version_id,
    versionNumber: row.version_number,
    status: row.version_status,
    revision: row.revision ?? 1,
    requiredMiles: row.required_miles,
    stockLimit: row.stock_limit,
    perFriendLimit: row.per_friend_limit,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    benefitExpiresDays: row.benefit_expires_days,
    commonActionVersionId: row.common_action_version_id,
    targetConditions: row.target_conditions ? JSON.parse(row.target_conditions) as MileageRewardTargetCondition : null,
    failurePolicy: row.failure_policy ?? 'retry',
    customerMessage: row.customer_message ?? '',
    publishedAt: row.published_at,
  };
}

function mapReward(row: RewardRow): MileageRewardSummary {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    programId: row.program_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    rewardKind: row.reward_kind,
    status: row.status,
    sortOrder: row.sort_order,
    currentDraftVersionId: row.current_draft_version_id,
    currentPublishedVersionId: row.current_published_version_id,
    currentVersion: mapVersion(row),
    exchangedThisMonth: row.exchanged_this_month,
    availableCodeCount: row.reward_kind === 'coupon' ? row.available_code_count : null,
    benefitName: row.benefit_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rewardSelect(versionExpression: string): string {
  return `
  SELECT r.id, r.line_account_id, r.program_id, r.name, r.description, r.image_url,
         r.reward_kind, r.status, r.sort_order, r.current_draft_version_id,
         r.current_published_version_id, r.created_at, r.updated_at,
         v.id AS version_id, v.version_number, v.status AS version_status,
         v.revision,
         v.required_miles, v.stock_limit, v.per_friend_limit, v.starts_at, v.ends_at,
         v.benefit_expires_days, v.common_action_version_id, v.failure_policy,
         v.target_conditions, v.customer_message, v.published_at,
         (SELECT COUNT(*) FROM mileage_redemptions mr
           WHERE mr.reward_id = r.id AND mr.status = 'succeeded'
             AND mr.delivered_at >= datetime('now', 'start of month')) AS exchanged_this_month,
         (SELECT COUNT(*) FROM mileage_reward_codes mc
           WHERE mc.reward_version_id = v.id AND mc.status = 'available') AS available_code_count,
         ca.name AS benefit_name
    FROM mileage_rewards r
    LEFT JOIN mileage_reward_versions v
      ON v.id = ${versionExpression}
    LEFT JOIN common_action_versions cav ON cav.id = v.common_action_version_id
    LEFT JOIN common_actions ca ON ca.id = cav.common_action_id`;
}

export async function listMileageRewards(
  db: D1Database,
  input: { lineAccountId: string; customerVisible?: boolean },
): Promise<MileageRewardSummary[]> {
  const now = new Date().toISOString();
  const visibleClause = input.customerVisible
    ? `AND r.status = 'published' AND v.status = 'published'
       AND (v.starts_at IS NULL OR v.starts_at <= ?)
       AND (v.ends_at IS NULL OR v.ends_at > ?)`
    : '';
  const binds: unknown[] = [input.lineAccountId];
  if (input.customerVisible) binds.push(now, now);
  const result = await db.prepare(
    `${rewardSelect(input.customerVisible
      ? 'r.current_published_version_id'
      : 'COALESCE(r.current_draft_version_id, r.current_published_version_id)')}
      WHERE r.line_account_id = ? ${visibleClause}
      ORDER BY r.sort_order, r.updated_at DESC, r.id`,
  ).bind(...binds).all<RewardRow>();
  return result.results.map(mapReward);
}

export async function getMileageReward(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<MileageRewardSummary | null> {
  const row = await db.prepare(
    `${rewardSelect('COALESCE(r.current_draft_version_id, r.current_published_version_id)')}
      WHERE r.id = ? AND r.line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<RewardRow>();
  return row ? mapReward(row) : null;
}

export async function getMileageRewardAdminOverview(
  db: D1Database,
  lineAccountId: string,
): Promise<MileageRewardAdminOverview> {
  const rewards = await listMileageRewards(db, { lineAccountId });
  const summary = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM mileage_rewards
         WHERE line_account_id = ? AND status = 'published') AS published_count,
       COALESCE((SELECT SUM(v.required_miles)
         FROM mileage_redemptions mr
         JOIN mileage_reward_versions v ON v.id = mr.reward_version_id
        WHERE mr.line_account_id = ? AND mr.status = 'succeeded'
          AND mr.delivered_at >= datetime('now', 'start of month')), 0) AS redeemed_miles_this_month,
       (SELECT COUNT(*) FROM friends f
         WHERE f.line_account_id = ? AND f.is_following = 1
           AND NOT EXISTS (
             SELECT 1 FROM mileage_redemptions mr
              WHERE mr.line_account_id = ? AND mr.status != 'refunded'
                AND ((f.user_id IS NOT NULL AND mr.beneficiary_key = 'user:' || f.user_id)
                  OR (f.user_id IS NULL AND mr.beneficiary_key = 'friend:' || f.id))
           )) AS never_redeemed_friend_count,
       (SELECT r.name FROM mileage_rewards r
         JOIN mileage_redemptions mr ON mr.reward_id = r.id AND mr.status = 'succeeded'
       WHERE r.line_account_id = ?
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_name,
       (SELECT COUNT(*) FROM mileage_redemptions mr
         JOIN mileage_rewards r ON r.id = mr.reward_id
        WHERE r.line_account_id = ? AND mr.status = 'succeeded'
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_count`,
  ).bind(lineAccountId, lineAccountId, lineAccountId, lineAccountId, lineAccountId, lineAccountId).first<{
    published_count: number;
    redeemed_miles_this_month: number;
    never_redeemed_friend_count: number;
    most_redeemed_reward_name: string | null;
    most_redeemed_reward_count: number | null;
  }>();
  return {
    rewards,
    summary: {
      publishedCount: summary?.published_count ?? 0,
      redeemedMilesThisMonth: summary?.redeemed_miles_this_month ?? 0,
      neverRedeemedFriendCount: Number(summary?.never_redeemed_friend_count ?? 0),
      mostRedeemedRewardName: summary?.most_redeemed_reward_name ?? null,
      mostRedeemedRewardCount: summary?.most_redeemed_reward_count ?? null,
    },
  };
}

/**
 * 顧客向け一覧で「交換できる」と言い切る前に、実際の交換回数をまとめて確認する。
 * 0件と未取得を混ぜないため、友だちが存在しない場合は空のMapではなく例外にする。
 */
export async function getMileageRewardRedemptionCounts(
  db: D1Database,
  input: { lineAccountId: string; friendId: string },
): Promise<{
  beneficiaryKey: string;
  byRewardId: Map<string, number>;
  byVersionId: Map<string, number>;
}> {
  const friend = await db.prepare(
    `SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(input.friendId, input.lineAccountId).first<{ id: string; user_id: string | null }>();
  if (!friend) throw new MileageRewardError('friend_not_found', '友だち情報を確認できませんでした', 404);
  const beneficiaryKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  /*
   * R388: 交換済みの表示も上限と同じ本人キー集合で数える。統合後に
   * 「交換できる」と出して上限で止める食い違いを出さない。
   */
  const limitKeys = await collectBeneficiaryKeysForLimit(db, input.friendId, friend.user_id, beneficiaryKey);
  const limitPlaceholders = limitKeys.map(() => '?').join(', ');
  const rows = await db.prepare(
    `SELECT reward_id, reward_version_id, COUNT(*) AS count
       FROM mileage_redemptions
      WHERE line_account_id = ? AND beneficiary_key IN (${limitPlaceholders}) AND status != 'refunded'
      GROUP BY reward_id, reward_version_id`,
  ).bind(input.lineAccountId, ...limitKeys).all<{
    reward_id: string;
    reward_version_id: string;
    count: number;
  }>();
  const byRewardId = new Map<string, number>();
  const byVersionId = new Map<string, number>();
  for (const row of rows.results) {
    byRewardId.set(row.reward_id, (byRewardId.get(row.reward_id) ?? 0) + row.count);
    byVersionId.set(row.reward_version_id, row.count);
  }
  return { beneficiaryKey, byRewardId, byVersionId };
}

async function requirePublishedActionVersion(
  db: D1Database,
  lineAccountId: string,
  versionId: string | null,
): Promise<void> {
  if (!versionId) return;
  const row = await db.prepare(
    `SELECT cav.action_config
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ? AND cav.status = 'published' AND ca.line_account_id = ?`,
  ).bind(versionId, lineAccountId).first<{ action_config: string }>();
  if (!row) throw new MileageRewardError('action_not_published', '公開済みの交換後アクションを選んでください');
  let actions: unknown;
  try { actions = JSON.parse(row.action_config); } catch { actions = null; }
  if (!Array.isArray(actions) || actions.some((action) => {
    if (!action || typeof action !== 'object') return true;
    const type = (action as { type?: unknown }).type;
    return type === 'wait' || type === 'common_action';
  })) {
    throw new MileageRewardError(
      'action_not_immediate',
      '待ち時間または別の共通アクションを含む処理は、交換後の動きに使えません',
    );
  }
}

export async function createMileageRewardDraft(
  db: D1Database,
  input: { lineAccountId: string; programId?: string; createdBy?: string | null; draft: MileageRewardDraftInput },
): Promise<MileageRewardSummary> {
  const draft = validateMileageRewardDraft(input.draft);
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  const rewardId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO mileage_rewards
         (id, line_account_id, program_id, name, description, image_url, reward_kind,
          status, current_draft_version_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    ).bind(
      rewardId, input.lineAccountId, input.programId ?? 'default', draft.name,
      draft.description, draft.imageUrl, draft.rewardKind, versionId,
      input.createdBy ?? null, now, now,
    ),
    db.prepare(
      `INSERT INTO mileage_reward_versions
         (id, reward_id, version_number, status, required_miles, stock_limit,
          per_friend_limit, starts_at, ends_at, benefit_expires_days,
          common_action_version_id, target_conditions, failure_policy, customer_message, created_by, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, rewardId, draft.requiredMiles, draft.stockLimit, draft.perFriendLimit,
      draft.startsAt, draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
      draft.targetConditions ? JSON.stringify(draft.targetConditions) : null,
      draft.failurePolicy, draft.customerMessage, input.createdBy ?? null, now,
    ),
  ]);
  const created = await getMileageReward(db, { id: rewardId, lineAccountId: input.lineAccountId });
  if (!created) throw new MileageRewardError('create_failed', '使い道を作成できませんでした', 500);
  return created;
}

export async function updateMileageRewardDraft(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersionId: string;
    expectedRevision?: number | null;
    updatedBy?: string | null;
    draft: MileageRewardDraftInput;
  },
): Promise<MileageRewardSummary> {
  const draft = validateMileageRewardDraft(input.draft);
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  // R375: 書く前に所属と版IDを照合する。版のUPDATEだけ所属を見ない形にしない。
  // R374: 読み込んだ更新番号と一致する保存だけ通す。
  const current = await db.prepare(
    `SELECT r.current_draft_version_id AS draft_version_id, v.revision AS revision
       FROM mileage_rewards r
       LEFT JOIN mileage_reward_versions v ON v.id = r.current_draft_version_id
      WHERE r.id = ? AND r.line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<{ draft_version_id: string | null; revision: number | null }>();
  if (!current || current.draft_version_id !== input.expectedVersionId) {
    if (!current) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  if (input.expectedRevision != null && current.revision !== input.expectedRevision) {
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  const now = new Date().toISOString();
  // 両方のUPDATEに同じ所属・版・更新番号の条件を付け、片方だけ
  // 書き換わる部分更新を残さない。通るたびに更新番号を1つ増やす。
  const revisionGuard = input.expectedRevision != null ? ' AND v.revision = ?' : '';
  const revisionBinds: unknown[] = input.expectedRevision != null ? [input.expectedRevision] : [];
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_rewards
          SET name = ?, description = ?, image_url = ?, reward_kind = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?
          AND EXISTS (
            SELECT 1 FROM mileage_reward_versions v
             WHERE v.id = ? AND v.reward_id = mileage_rewards.id AND v.status = 'draft'
             ${revisionGuard}
          )`,
    ).bind(
      draft.name, draft.description, draft.imageUrl, draft.rewardKind, now,
      input.id, input.lineAccountId, input.expectedVersionId,
      input.expectedVersionId, ...revisionBinds,
    ),
    db.prepare(
      `UPDATE mileage_reward_versions
          SET required_miles = ?, stock_limit = ?, per_friend_limit = ?, starts_at = ?,
              ends_at = ?, benefit_expires_days = ?, common_action_version_id = ?,
              target_conditions = ?, failure_policy = ?, customer_message = ?, created_by = ?,
              revision = revision + 1
        WHERE id = ? AND reward_id = ? AND status = 'draft'
          ${input.expectedRevision != null ? ' AND revision = ?' : ''}
          AND EXISTS (
            SELECT 1 FROM mileage_rewards r
             WHERE r.id = mileage_reward_versions.reward_id AND r.line_account_id = ?
          )`,
    ).bind(
      draft.requiredMiles, draft.stockLimit, draft.perFriendLimit, draft.startsAt,
      draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
      draft.targetConditions ? JSON.stringify(draft.targetConditions) : null,
      draft.failurePolicy, draft.customerMessage, input.updatedBy ?? null,
      input.expectedVersionId, input.id, ...revisionBinds, input.lineAccountId,
    ),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  const updated = await getMileageReward(db, { id: input.id, lineAccountId: input.lineAccountId });
  if (!updated) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return updated;
}

export async function createMileageRewardDraftFromPublished(
  db: D1Database,
  input: { id: string; lineAccountId: string; createdBy?: string | null },
): Promise<MileageRewardSummary> {
  const reward = await getMileageReward(db, input);
  if (!reward?.currentPublishedVersionId) throw new MileageRewardError('not_found', '公開中の使い道が見つかりません', 404);
  if (reward.currentDraftVersionId) return reward;
  const published = await db.prepare(
    `SELECT * FROM mileage_reward_versions WHERE id = ? AND status = 'published'`,
  ).bind(reward.currentPublishedVersionId).first<Record<string, unknown>>();
  if (!published) throw new MileageRewardError('published_version_missing', '公開中の版を読み込めませんでした', 409);
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO mileage_reward_versions
           (id, reward_id, version_number, status, required_miles, stock_limit,
            per_friend_limit, starts_at, ends_at, benefit_expires_days,
            common_action_version_id, target_conditions, failure_policy, customer_message, created_by, created_at)
         SELECT ?, reward_id, version_number + 1, 'draft', required_miles, stock_limit,
                per_friend_limit, starts_at, ends_at, benefit_expires_days,
                common_action_version_id, target_conditions, failure_policy, customer_message, ?, ?
           FROM mileage_reward_versions WHERE id = ? AND status = 'published'`,
      ).bind(versionId, input.createdBy ?? null, now, reward.currentPublishedVersionId),
      db.prepare(
        `UPDATE mileage_rewards SET current_draft_version_id = ?, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
      ).bind(versionId, now, input.id, input.lineAccountId),
    ]);
  } catch (error) {
    // R377: 同時に作った片方は版番号の一意制約に当たる。共同編集の正常な
    // 競合なので、一般的なサーバーエラーにせず読み直しを案内する。
    if (error instanceof Error && /unique|UNIQUE/i.test(error.message)) {
      throw new MileageRewardError('draft_exists', 'ほかの担当者が下書きを作成済みです。読み直してください', 409);
    }
    throw error;
  }
  const created = await getMileageReward(db, input);
  if (!created) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  if (created.currentDraftVersionId !== versionId) {
    // 競合に勝った相手の下書きが付いた。作り直さず読み直しを案内する。
    throw new MileageRewardError('draft_exists', 'ほかの担当者が下書きを作成済みです。読み直してください', 409);
  }
  return created;
}

export async function publishMileageReward(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    publishedBy?: string | null;
    expectedVersionId?: string | null;
    expectedRevision?: number | null;
  },
): Promise<MileageRewardSummary> {
  const reward = await getMileageReward(db, input);
  const draft = reward?.currentVersion?.status === 'draft' ? reward.currentVersion : null;
  if (!reward || !draft || !reward.currentDraftVersionId) {
    throw new MileageRewardError('draft_missing', '公開する下書きがありません', 409);
  }
  // R376: 公開者が確認した版と更新番号を要求に含め、検証から確定まで
  // 同じ内容を保証する。途中で保存されたら公開を止めて確認し直す。
  if (input.expectedVersionId != null && input.expectedVersionId !== draft.id) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  if (input.expectedRevision != null && draft.revision !== input.expectedRevision) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  if (reward.rewardKind === 'coupon') {
    const inventory = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_reward_codes
        WHERE reward_version_id = ? AND status = 'available'`,
    ).bind(draft.id).first<{ count: number }>();
    if ((inventory?.count ?? 0) < 1) {
      throw new MileageRewardError('coupon_inventory_empty', '交換コードを1件以上登録してから公開してください');
    }
  }
  const now = new Date().toISOString();
  const revisionGuard = input.expectedRevision != null ? ' AND revision = ?' : '';
  const revisionBinds: unknown[] = input.expectedRevision != null ? [input.expectedRevision] : [];
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_reward_versions
          SET status = 'published', published_at = ?, created_by = COALESCE(?, created_by)
        WHERE id = ? AND reward_id = ? AND status = 'draft'${revisionGuard}`,
    ).bind(now, input.publishedBy ?? null, draft.id, reward.id, ...revisionBinds),
    db.prepare(
      `UPDATE mileage_rewards
          SET status = 'published', current_published_version_id = current_draft_version_id,
              current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?
          AND EXISTS (
            SELECT 1 FROM mileage_reward_versions v
             WHERE v.id = ? AND v.reward_id = mileage_rewards.id
             ${revisionGuard.replaceAll('revision', 'v.revision')}
          )`,
    ).bind(now, reward.id, input.lineAccountId, draft.id, draft.id, ...revisionBinds),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  const published = await getMileageReward(db, input);
  if (!published) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return published;
}

export async function setMileageRewardStatus(
  db: D1Database,
  input: { id: string; lineAccountId: string; status: 'published' | 'stopped' | 'archived' },
): Promise<MileageRewardSummary> {
  const result = await db.prepare(
    `UPDATE mileage_rewards SET status = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND current_published_version_id IS NOT NULL`,
  ).bind(input.status, new Date().toISOString(), input.id, input.lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return (await getMileageReward(db, input))!;
}

export async function reorderMileageRewards(
  db: D1Database,
  input: { lineAccountId: string; ids: string[] },
): Promise<void> {
  if (!input.ids.length || new Set(input.ids).size !== input.ids.length) {
    throw new MileageRewardError('invalid_order', '並び順を確認してください');
  }
  const existing = await db.prepare(
    `SELECT id FROM mileage_rewards WHERE line_account_id = ?`,
  ).bind(input.lineAccountId).all<{ id: string }>();
  if (existing.results.length !== input.ids.length
    || existing.results.some((row) => !input.ids.includes(row.id))) {
    throw new MileageRewardError('invalid_order', '別のLINE公式アカウントの使い道が含まれています');
  }
  const now = new Date().toISOString();
  await db.batch(input.ids.map((id, index) => db.prepare(
    `UPDATE mileage_rewards SET sort_order = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
  ).bind(index, now, id, input.lineAccountId)));
}

export async function importMileageRewardCodes(
  db: D1Database,
  input: {
    rewardId: string;
    lineAccountId: string;
    codes: Array<{ ciphertext: string; fingerprint: string }>;
  },
): Promise<{ inserted: number }> {
  const reward = await getMileageReward(db, { id: input.rewardId, lineAccountId: input.lineAccountId });
  const versionId = reward?.currentDraftVersionId;
  if (!reward || reward.rewardKind !== 'coupon' || !versionId) {
    throw new MileageRewardError('coupon_draft_missing', '交換コードを登録できる下書きがありません', 409);
  }
  const unique = [...new Map(input.codes.map((item) => [item.fingerprint, item])).values()];
  if (!unique.length || unique.length > 10_000) {
    throw new MileageRewardError('invalid_codes', '交換コードは1〜10,000件で登録してください');
  }
  // R372: 重複判定を版の外へ持ち、同じ店舗内の配布履歴まで照合する。
  // 配布済み（issued/reserved）はもちろん、未使用の旧版コードも再登録では
  // 増やさない。単発在庫が二重に確保され、別の人へ同じコードを配らない。
  const existing = new Set<string>();
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    const rows = await db.prepare(
      `SELECT c.code_fingerprint AS fingerprint
         FROM mileage_reward_codes c
         JOIN mileage_reward_versions v ON v.id = c.reward_version_id
         JOIN mileage_rewards r ON r.id = v.reward_id
        WHERE r.line_account_id = ? AND c.code_fingerprint IN (${chunk.map(() => '?').join(', ')})`,
    ).bind(input.lineAccountId, ...chunk.map((code) => code.fingerprint))
      .all<{ fingerprint: string }>();
    for (const row of rows.results) existing.add(row.fingerprint);
  }
  const fresh = unique.filter((code) => !existing.has(code.fingerprint));
  if (!fresh.length) return { inserted: 0 };
  const results = await db.batch(fresh.map((code) => db.prepare(
    `INSERT OR IGNORE INTO mileage_reward_codes
       (id, reward_version_id, code_ciphertext, code_fingerprint, status, created_at)
     VALUES (?, ?, ?, ?, 'available', ?)`,
  ).bind(crypto.randomUUID(), versionId, code.ciphertext, code.fingerprint, new Date().toISOString())));
  return { inserted: results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0) };
}

function mapRedemption(row: RedemptionRow): MileageRewardRedemption {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    programId: row.program_id,
    beneficiaryKey: row.beneficiary_key,
    beneficiaryUserId: row.beneficiary_user_id,
    beneficiaryFriendId: row.beneficiary_friend_id,
    rewardId: row.reward_id,
    rewardVersionId: row.reward_version_id,
    spendLedgerEntryId: row.spend_ledger_entry_id,
    rewardCodeId: row.reward_code_id,
    rewardNameSnapshot: row.reward_name_snapshot,
    rewardKindSnapshot: row.reward_kind_snapshot,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    deliveredAt: row.delivered_at,
    refundedAt: row.refunded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMileageRedemption(
  db: D1Database,
  id: string,
): Promise<MileageRewardRedemption | null> {
  const row = await db.prepare(`SELECT * FROM mileage_redemptions WHERE id = ?`)
    .bind(id).first<RedemptionRow>();
  return row ? mapRedemption(row) : null;
}

export type MileageRedemptionListStatus = MileageRedemptionStatus | 'all' | 'needs_attention';

export interface MileageRedemptionListItem extends MileageRewardRedemption {
  rewardName: string;
}

/**
 * 交換履歴の一覧。管理画面で「残高を減らしたのに特典が届かなかった交換」を
 * 見つけるための口。失敗理由・試行回数・最終日時は行がそのまま持つ。
 * アカウントの絞り込みは呼び出し側ではなくここで掛ける。
 */
export async function listMileageRedemptions(
  db: D1Database,
  input: {
    lineAccountId: string;
    status?: MileageRedemptionListStatus;
    limit: number;
    offset: number;
  },
): Promise<{
  items: MileageRedemptionListItem[];
  pagination: { total: number; limit: number; offset: number };
}> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit)));
  const offset = Math.max(0, Math.floor(input.offset));
  const status = input.status ?? 'needs_attention';
  // R364: 既定は「要対応」（届かなかった交換＋送ったか分からない交換）。
  // `delivering` のままの照合待ちを既定の一覧から消さない。
  // R362: 返却確定後に書き込みが中断した交換（台帳なしの refunded）も
  // 要対応に入れる。入れないと残高が戻らないまま誰にも見えない。
  // 旧処理の残り「台帳あり・コード未解放」（ロット未復旧）も入れる。
  // 返却済みの交換に結び付いたままの予約コードは解放漏れのため、
  // 取り残しの発見（findIncompleteMileageRefunds）と同じ基準。
  const statusClause = status === 'all'
    ? ''
    : status === 'needs_attention'
      ? `AND (r.status IN ('delivery_failed', 'delivering')
        OR (r.status = 'refunded' AND (
          NOT EXISTS (
            SELECT 1 FROM mileage_ledger l
             WHERE l.program_id = r.program_id
               AND l.idempotency_key = 'mileage-redemption-refund:' || r.id
          )
          OR EXISTS (
            SELECT 1 FROM mileage_reward_codes c
             WHERE c.redemption_id = r.id AND c.status = 'reserved'
          )
        )))`
      : 'AND r.status = ?';
  const binds: unknown[] = [input.lineAccountId];
  if (status !== 'all' && status !== 'needs_attention') binds.push(status);
  const totalRow = await db.prepare(
    `SELECT COUNT(*) AS count FROM mileage_redemptions r
      WHERE r.line_account_id = ? ${statusClause}`,
  ).bind(...binds).first<{ count: number }>();
  const rows = await db.prepare(
    `SELECT r.*, reward.name AS reward_name
       FROM mileage_redemptions r
       JOIN mileage_rewards reward ON reward.id = r.reward_id
      WHERE r.line_account_id = ? ${statusClause}
      ORDER BY r.updated_at DESC, r.id
      LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all<RedemptionRow & { reward_name: string }>();
  return {
    items: rows.results.map((row) => ({ ...mapRedemption(row), rewardName: row.reward_name })),
    pagination: { total: totalRow?.count ?? 0, limit, offset },
  };
}

/*
 * R388: 一人一回の上限を数える識別キーの集め方。現在のキーに加え、
 * - この友だち自身の友だちキー（統合前はこのキーで交換していた）
 * - 今同じ本人に結び付く友だちの友だちキー（統合相手の交換も一人分）
 * - これらの友だちが結び付いたことのある本人キー（解除・移行後も引き継ぐ）
 * をまとめる。export は試験から規則を確かめるため。
 */
export async function collectBeneficiaryKeysForLimit(
  db: D1Database,
  friendId: string,
  currentUserId: string | null,
  currentKey: string,
): Promise<string[]> {
  const keys = new Set<string>([currentKey, `friend:${friendId}`]);
  const coLinked = currentUserId
    ? (await db.prepare(`SELECT id FROM friends WHERE user_id = ?`)
      .bind(currentUserId).all<{ id: string }>()).results.map((row) => row.id)
    : [];
  const friendIds = [...new Set([friendId, ...coLinked])];
  for (const id of friendIds) keys.add(`friend:${id}`);
  const placeholders = friendIds.map(() => '?').join(', ');
  const history = await db.prepare(
    `SELECT DISTINCT user_id FROM friend_identity_links
      WHERE friend_id IN (${placeholders}) AND user_id IS NOT NULL`,
  ).bind(...friendIds).all<{ user_id: string }>();
  for (const row of history.results) keys.add(`user:${row.user_id}`);
  return [...keys];
}

export async function reserveMileageRewardRedemption(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    rewardId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  },
): Promise<{ kind: 'created' | 'existing'; redemption: MileageRewardRedemption }> {
  const existing = await db.prepare(
    `SELECT * FROM mileage_redemptions WHERE program_id = 'default' AND idempotency_key = ?`,
  ).bind(input.idempotencyKey).first<RedemptionRow>();
  if (existing) {
    if (existing.request_fingerprint !== input.requestFingerprint) {
      throw new MileageRewardError('idempotency_conflict', '同じ処理IDに別の交換内容が指定されました', 409);
    }
    return { kind: 'existing', redemption: mapRedemption(existing) };
  }

  // R371: 交換は公開版を直接読む。下書きの有無に左右されない。
  const publishedRow = await db.prepare(
    `${rewardSelect('r.current_published_version_id')}
      WHERE r.id = ? AND r.line_account_id = ? AND r.status = 'published'`,
  ).bind(input.rewardId, input.lineAccountId).first<RewardRow>();
  const reward = publishedRow ? mapReward(publishedRow) : null;
  const version = reward?.currentVersion?.status === 'published' ? reward.currentVersion : null;
  if (!reward || !version) {
    throw new MileageRewardError('reward_not_available', 'この使い道は現在交換できません', 409);
  }
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // R369: 保存値はUTCへ正規化済み。比較も時刻値で行い、表記ゆれに左右されない。
  const startsMs = version.startsAt ? new Date(version.startsAt).getTime() : Number.NaN;
  const endsMs = version.endsAt ? new Date(version.endsAt).getTime() : Number.NaN;
  if ((Number.isFinite(startsMs) && startsMs > nowMs) || (Number.isFinite(endsMs) && endsMs <= nowMs)) {
    throw new MileageRewardError('reward_outside_period', 'この使い道は交換期間外です', 409);
  }
  const friend = await db.prepare(
    `SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(input.friendId, input.lineAccountId).first<{ id: string; user_id: string | null }>();
  if (!friend) throw new MileageRewardError('friend_not_found', '友だち情報を確認できませんでした', 404);
  // R368: 保存した交換対象条件を消費前に評価する。条件に合わない友だちへ
  // 特典を渡さない。管理・LIFFの両経路はこの関数を通るため、ここで守る。
  if (version.targetConditions
    && ((version.targetConditions.rules?.length ?? 0) > 0
      || (version.targetConditions.groups?.length ?? 0) > 0)) {
    let eligible: boolean;
    try {
      eligible = await matchesCondition(db, friend.id, version.targetConditions as SegmentCondition);
    } catch {
      throw new MileageRewardError('target_conditions_invalid', '交換対象の条件を確認してください', 409);
    }
    if (!eligible) {
      throw new MileageRewardError('reward_not_eligible', 'この使い道の交換対象ではありません', 403);
    }
  }
  const beneficiaryKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  /*
   * R388: 確定文と事後確認も事前確認と同じキー集合で数える。確認だけ広げると
   * 同時実行の隙間で抜けるため、INSERT時の条件と対にしておく。
   * perFriendLimit が無い特典では現在のキーだけ（余計な読みを足さない）。
   */
  let limitKeys = [beneficiaryKey];
  if (version.perFriendLimit) {
    limitKeys = await collectBeneficiaryKeysForLimit(db, input.friendId, friend.user_id, beneficiaryKey);
  }
  const limitPlaceholders = limitKeys.map(() => '?').join(', ');
  const wallet = await db.prepare(
    `SELECT beneficiary_key, beneficiary_user_id, beneficiary_friend_id, available, version
       FROM mileage_wallets WHERE program_id = ? AND beneficiary_key = ?`,
  ).bind(reward.programId, beneficiaryKey).first<WalletRow>();
  if (!wallet || wallet.available < version.requiredMiles) {
    throw new MileageRewardError('insufficient_miles', '交換に必要なマイルが足りません', 409);
  }
  if (version.perFriendLimit) {
    /*
     * R388: 一人一回は現在の本人識別だけでなく、統合・解除・移行の前後で
     * 同じ友だちが名乗った識別キーすべてで数える。現在のキー・友だちキー・
     * 同じ本人に結び付く友だちのキー・結び付き履歴の本人キーをまとめる。
     * 規則:
     * - 異なる本人（結び付きの無い別キー）は別々に数える。
     * - 返却済み（refunded）は数えない。
     * - 誤統合の訂正で外れた後は別々に数えるが、統合期間中の本人キーでの
     *   交換は共有のまま残る（履歴は消さない）。
     */
    const count = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemptions
        WHERE reward_id = ? AND beneficiary_key IN (${limitPlaceholders}) AND status != 'refunded'`,
    ).bind(reward.id, ...limitKeys).first<{ count: number }>();
    if ((count?.count ?? 0) >= version.perFriendLimit) {
      throw new MileageRewardError('friend_limit_reached', 'この使い道は交換上限に達しています', 409);
    }
  }
  const triedCodeIds = new Set<string>();
  let code: { id: string } | null = null;
  const redemptionId = crypto.randomUUID();
  const spendLedgerId = crypto.randomUUID();
  if (version.stockLimit != null) {
    const count = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemptions
        WHERE reward_version_id = ? AND status != 'refunded'`,
    ).bind(version.id).first<{ count: number }>();
    if ((count?.count ?? 0) >= version.stockLimit) {
      throw new MileageRewardError('out_of_stock', 'この使い道は在庫切れです', 409);
    }
  }

  const lots = await db.prepare(
    `SELECT ledger_entry_id, remaining_amount FROM mileage_grant_lots
      WHERE program_id = ? AND beneficiary_key = ? AND status = 'available'
        AND remaining_amount > 0 AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, available_at, ledger_entry_id`,
  ).bind(reward.programId, beneficiaryKey, now).all<LotRow>();
  let remaining = version.requiredMiles;
  const allocations: Array<{ lotId: string; amount: number }> = [];
  for (const lot of lots.results) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, lot.remaining_amount);
    allocations.push({ lotId: lot.ledger_entry_id, amount });
    remaining -= amount;
  }
  if (remaining > 0) {
    // m22u R360: 残高はあるのに内訳が足りない主因は期限切れ。期限切れの
    // ロットが不足分を説明できるときは「足りません」として案内し、
    // 内訳エラー（確認できませんでした）にはしない。
    const expiredHeld = await db.prepare(
      `SELECT COALESCE(SUM(remaining_amount), 0) AS expired_remaining
         FROM mileage_grant_lots
        WHERE program_id = ? AND beneficiary_key = ? AND status = 'available'
          AND remaining_amount > 0 AND expires_at IS NOT NULL AND expires_at <= ?`,
    ).bind(reward.programId, beneficiaryKey, now).first<{ expired_remaining: number }>();
    if (Number(expiredHeld?.expired_remaining ?? 0) > 0) {
      throw new MileageRewardError(
        'insufficient_miles',
        '期限切れのマイルは使えないため、交換に必要なマイルが足りません',
        409,
      );
    }
    throw new MileageRewardError('mileage_lots_unavailable', '交換できるマイルの内訳を確認できませんでした', 409);
  }

  // R370: 特定コードの取得競合を在庫全体の枯渇と混ぜない。
  // 選んだコードを横取りされたら、別の利用可能コードを取り直す。
  // R388: 確定文の上限判定も事前確認と同じ本人キー集合で数える。
  for (let attempt = 0; attempt < 5; attempt++) {
    if (reward.rewardKind === 'coupon') {
      const tried = [...triedCodeIds];
      code = await db.prepare(
        `SELECT id FROM mileage_reward_codes
          WHERE reward_version_id = ? AND status = 'available'
          ${tried.length > 0 ? `AND id NOT IN (${tried.map(() => '?').join(', ')})` : ''}
          ORDER BY created_at, id LIMIT 1`,
      ).bind(version.id, ...tried).first<{ id: string }>();
      if (!code) {
        throw new MileageRewardError('out_of_stock', '交換コードの在庫がありません', 409);
      }
    } else {
      code = null;
    }
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO mileage_redemptions
           (id, line_account_id, program_id, beneficiary_key, beneficiary_user_id,
            beneficiary_friend_id, reward_id, reward_version_id, spend_ledger_entry_id,
            reward_code_id, reward_name_snapshot, reward_kind_snapshot,
            idempotency_key, request_fingerprint, status, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?
           FROM mileage_wallets w
          WHERE w.program_id = ? AND w.beneficiary_key = ?
            AND w.version = ? AND w.available >= ?
            AND NOT EXISTS (
              SELECT 1 FROM mileage_redemptions existing
               WHERE existing.program_id = ? AND existing.idempotency_key = ?
            )
            AND (? IS NULL OR EXISTS (
              SELECT 1 FROM mileage_reward_codes inventory
               WHERE inventory.id = ? AND inventory.status = 'available'
            ))
            AND (? IS NULL OR (
              SELECT COUNT(*) FROM mileage_redemptions stock
               WHERE stock.reward_version_id = ? AND stock.status != 'refunded'
            ) < ?)
            AND (? IS NULL OR (
              SELECT COUNT(*) FROM mileage_redemptions person_limit
               WHERE person_limit.reward_id = ?
                 AND person_limit.beneficiary_key IN (${limitPlaceholders})
                 AND person_limit.status != 'refunded'
            ) < ?)`,
      ).bind(
        redemptionId, reward.lineAccountId, reward.programId, beneficiaryKey,
        friend.user_id, friend.id, reward.id, version.id,
        // R373: 交換が決まったときの名前・種類をこの行に凍結する。
        null, code?.id ?? null, reward.name, reward.rewardKind,
        input.idempotencyKey, input.requestFingerprint,
        now, now, reward.programId, beneficiaryKey, wallet.version, version.requiredMiles,
        reward.programId, input.idempotencyKey,
        code?.id ?? null, code?.id ?? null,
        version.stockLimit, version.id, version.stockLimit,
        version.perFriendLimit, reward.id, ...limitKeys, version.perFriendLimit,
      ),
      db.prepare(
        `INSERT INTO mileage_ledger
           (id, program_id, beneficiary_user_id, beneficiary_friend_id,
            entry_type, amount, status, source, source_event_id, reason,
            idempotency_key, occurred_at, created_at, metadata)
         SELECT ?, program_id, beneficiary_user_id, beneficiary_friend_id,
                'spend', ?, 'available', 'mileage_reward', id, ?, ?, ?, ?, ?
           FROM mileage_redemptions WHERE id = ?`,
      ).bind(
        spendLedgerId, -version.requiredMiles, `「${reward.name}」と交換`,
        `mileage-redemption:${redemptionId}`, now, now,
        JSON.stringify({ rewardId: reward.id, rewardVersionId: version.id }), redemptionId,
      ),
      db.prepare(
        `UPDATE mileage_redemptions SET spend_ledger_entry_id = ?, updated_at = ?
          WHERE id = ? AND spend_ledger_entry_id IS NULL`,
      ).bind(spendLedgerId, now, redemptionId),
    ];
    for (const allocation of allocations) {
      const allocationId = crypto.randomUUID();
      statements.push(
        db.prepare(
          `UPDATE mileage_grant_lots
              SET remaining_amount = remaining_amount - ?,
                  status = CASE WHEN remaining_amount - ? = 0 THEN 'exhausted' ELSE status END
            WHERE ledger_entry_id = ? AND remaining_amount >= ?
              AND EXISTS (SELECT 1 FROM mileage_redemptions WHERE id = ?)`,
        ).bind(allocation.amount, allocation.amount, allocation.lotId, allocation.amount, redemptionId),
        db.prepare(
          `INSERT INTO mileage_spend_allocations
             (id, redemption_id, spend_ledger_id, grant_lot_id, amount, created_at)
           SELECT ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM mileage_redemptions WHERE id = ?)`,
        ).bind(
          allocationId, redemptionId, spendLedgerId, allocation.lotId,
          allocation.amount, now, redemptionId,
        ),
      );
    }
    if (code) {
      statements.push(db.prepare(
        `UPDATE mileage_reward_codes
            SET status = 'reserved', redemption_id = ?, reserved_at = ?
          WHERE id = ? AND status = 'available'
            AND EXISTS (SELECT 1 FROM mileage_redemptions WHERE id = ?)`,
      ).bind(redemptionId, now, code.id, redemptionId));
    }
    await db.batch(statements);
    const created = await getMileageRedemption(db, redemptionId);
    if (created) return { kind: 'created', redemption: created };
    const racedExisting = await db.prepare(
      `SELECT * FROM mileage_redemptions WHERE program_id = ? AND idempotency_key = ?`,
    ).bind(reward.programId, input.idempotencyKey).first<RedemptionRow>();
    if (racedExisting) {
      if (racedExisting.request_fingerprint !== input.requestFingerprint) {
        throw new MileageRewardError('idempotency_conflict', '同じ処理IDに別の交換内容が指定されました', 409);
      }
      return { kind: 'existing', redemption: mapRedemption(racedExisting) };
    }
    if (code) {
      triedCodeIds.add(code.id);
      const inventory = await db.prepare(
        `SELECT status FROM mileage_reward_codes WHERE id = ?`,
      ).bind(code.id).first<{ status: string }>();
      if (inventory?.status !== 'available') continue;
    }

    if (version.stockLimit != null) {
      const currentStock = await db.prepare(
        `SELECT COUNT(*) AS count FROM mileage_redemptions
          WHERE reward_version_id = ? AND status != 'refunded'`,
      ).bind(version.id).first<{ count: number }>();
      if ((currentStock?.count ?? 0) >= version.stockLimit) {
        throw new MileageRewardError('out_of_stock', 'この使い道は在庫切れです', 409);
      }
    }
    if (version.perFriendLimit != null) {
      const currentCount = await db.prepare(
        `SELECT COUNT(*) AS count FROM mileage_redemptions
          WHERE reward_id = ? AND beneficiary_key IN (${limitPlaceholders}) AND status != 'refunded'`,
      ).bind(reward.id, ...limitKeys).first<{ count: number }>();
      if ((currentCount?.count ?? 0) >= version.perFriendLimit) {
        throw new MileageRewardError('friend_limit_reached', 'この使い道は交換上限に達しています', 409);
      }
    }
    const currentWallet = await db.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = ? AND beneficiary_key = ?`,
    ).bind(reward.programId, beneficiaryKey).first<{ available: number }>();
    if (!currentWallet || currentWallet.available < version.requiredMiles) {
      throw new MileageRewardError('insufficient_miles', '交換に必要なマイルが足りません', 409);
    }
    throw new MileageRewardError('wallet_changed', 'マイル残高が変わりました。読み直してください', 409);
  }
  // ここへ来るのは、コード以外の理由で確定できなかったとき。
  // 失敗側の残高は変えず、理由を区別して返す。
  if (code) {
    const inventory = await db.prepare(
      `SELECT status FROM mileage_reward_codes WHERE id = ?`,
    ).bind(code.id).first<{ status: string }>();
    if (inventory?.status !== 'available') {
      throw new MileageRewardError('out_of_stock', '交換コードの在庫がありません', 409);
    }
  }
  if (version.stockLimit != null) {
    const currentStock = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemptions
        WHERE reward_version_id = ? AND status != 'refunded'`,
    ).bind(version.id).first<{ count: number }>();
    if ((currentStock?.count ?? 0) >= version.stockLimit) {
      throw new MileageRewardError('out_of_stock', 'この使い道は在庫切れです', 409);
    }
  }
  if (version.perFriendLimit != null) {
    const currentCount = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemptions
        WHERE reward_id = ? AND beneficiary_key IN (${limitPlaceholders}) AND status != 'refunded'`,
    ).bind(reward.id, ...limitKeys).first<{ count: number }>();
    if ((currentCount?.count ?? 0) >= version.perFriendLimit) {
      throw new MileageRewardError('friend_limit_reached', 'この使い道は交換上限に達しています', 409);
    }
  }
  const currentWallet = await db.prepare(
    `SELECT available FROM mileage_wallets WHERE program_id = ? AND beneficiary_key = ?`,
  ).bind(reward.programId, beneficiaryKey).first<{ available: number }>();
  if (!currentWallet || currentWallet.available < version.requiredMiles) {
    throw new MileageRewardError('insufficient_miles', '交換に必要なマイルが足りません', 409);
  }
  throw new MileageRewardError('wallet_changed', 'マイル残高が変わりました。読み直してください', 409);
}

export async function recordMileageRedemptionAttempt(
  db: D1Database,
  input: {
    redemptionId: string;
    status: 'succeeded' | 'failed';
    errorCode?: string | null;
    errorMessage?: string | null;
    retryAt?: string | null;
  },
): Promise<MileageRewardRedemption> {
  const current = await getMileageRedemption(db, input.redemptionId);
  if (!current) throw new MileageRewardError('not_found', '交換履歴が見つかりません', 404);
  if (current.status === 'succeeded') return current;
  if (current.status === 'refunded') {
    /*
     * R362: 返却確定後に台帳・ロットの書き込みが中断した行は、
     * ここでも欠けた分を足してから返す。失敗したら回復（再試行・cron）
     * に任せ、記録の呼び出し自体は壊さない。
     */
    try {
      await completeRefundWrites(db, current, '中断した返却の再開');
    } catch {
      /* 回復は再試行・cronに任せる */
    }
    return (await getMileageRedemption(db, current.id))!;
  }
  const now = new Date().toISOString();
  const attempt = current.attemptCount + 1;
  const status: MileageRedemptionStatus = input.status === 'succeeded' ? 'succeeded' : 'delivery_failed';
  await db.batch([
    db.prepare(
      `INSERT INTO mileage_redemption_attempts
         (id, redemption_id, attempt_number, status, error_code, error_message, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), current.id, attempt, input.status,
      input.errorCode ?? null, input.errorMessage ?? null, now, now,
    ),
    db.prepare(
      `UPDATE mileage_redemptions
          SET status = ?, attempt_count = ?, next_retry_at = ?, failure_code = ?,
              failure_message = ?, delivered_at = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ('succeeded', 'refunded')`,
    ).bind(
      status, attempt, input.retryAt ?? null, input.errorCode ?? null,
      input.errorMessage ?? null, input.status === 'succeeded' ? now : null,
      now, current.id,
    ),
    ...(input.status === 'succeeded' && current.rewardCodeId
      ? [db.prepare(
        `UPDATE mileage_reward_codes SET status = 'issued', issued_at = ?
          WHERE id = ? AND redemption_id = ? AND status = 'reserved'`,
      ).bind(now, current.rewardCodeId, current.id)]
      : []),
  ]);
  return (await getMileageRedemption(db, current.id))!;
}

/**
 * R362: 返却の勝者決め。自動返却と再試行が重なっても、残高・内訳の
 * 書き換えは1回だけにする。`batch` の中の条件付き更新だけでは、
 * 状態の更新が0件でもロット復元が走り、二重に戻る。
 *
 * 手順は次の順番に固定する。
 *
 * 1. 状態だけを条件付きで `refunded` へ進める（勝者決め）。
 *    取れなかった走者は残高も内訳も触らない。
 * 2. 勝者だけが台帳・ロット・コード解放を1つの batch で書く。
 * 3. すでに `refunded` の行への再呼び出しは、台帳が無ければ
 *    書き足して再開できる（中断後の再開）。ロットは戻さない。
 * 4. `succeeded` へ移った交換への遅い返却は 409 で止める。
 */
export async function refundMileageRewardRedemption(
  db: D1Database,
  input: { redemptionId: string; reason: string },
): Promise<MileageRewardRedemption> {
  const current = await getMileageRedemption(db, input.redemptionId);
  if (!current) throw new MileageRewardError('not_found', '交換履歴が見つかりません', 404);
  if (current.status === 'succeeded') {
    throw new MileageRewardError('already_delivered', 'すでに特典を渡した交換は返金できません', 409);
  }
  if (current.status === 'refunded') {
    await completeRefundWrites(db, current, input.reason);
    return (await getMileageRedemption(db, current.id))!;
  }
  const now = new Date().toISOString();
  const claimed = await db.prepare(
    `UPDATE mileage_redemptions
        SET status = 'refunded', refunded_at = ?, next_retry_at = NULL, updated_at = ?
      WHERE id = ? AND status NOT IN ('succeeded', 'refunded')`,
  ).bind(now, now, current.id).run();
  if ((claimed.meta?.changes ?? 0) !== 1) {
    const latest = await getMileageRedemption(db, current.id);
    if (latest?.status === 'succeeded') {
      throw new MileageRewardError('already_delivered', 'すでに特典を渡した交換は返金できません', 409);
    }
    if (latest?.status === 'refunded') {
      await completeRefundWrites(db, latest, input.reason);
      return (await getMileageRedemption(db, current.id))!;
    }
    throw new MileageRewardError('refund_source_missing', '戻すマイルの記録を確認できませんでした', 409);
  }
  await completeRefundWrites(db, current, input.reason);
  return (await getMileageRedemption(db, current.id))!;
}

/**
 * 返却の書き込みが欠けていないか確かめる合図。
 * 返却台帳の冪等キーは交換ごとに1つ。台帳が無ければ書き込みは
 * 未実行（中断は確定前）。台帳があれば残高は戻っている
 * （残高は台帳 INSERT の trigger で連動する）。
 */
function refundReversalIdempotencyKey(redemptionId: string): string {
  return `mileage-redemption-refund:${redemptionId}`;
}

/**
 * 勝者だけが呼ぶ、台帳・ロット・コード解放の書き込み。
 *
 * R362: 台帳 INSERT とロット復元・コード解放を1つの batch で書く。
 * batch は原子（一部だけ残らない）なので、中断後に残るのは
 * 「台帳なし」（未実行）だけになる。INSERT は厳しい書き込み
 * （OR IGNORE なし）にする。同時に走った相手の batch は一意制約で
 * 全体が巻き戻り、残高・内訳の二重書き込みにならない。
 * 負けた走者は台帳を確かめ直し、あれば完了として扱う。
 */
async function completeRefundWrites(
  db: D1Database,
  current: MileageRewardRedemption,
  reason: string,
): Promise<void> {
  const { reward, allocations } = await loadRefundSources(db, current);
  const now = new Date().toISOString();
  const existing = await selectRefundReversal(db, current);
  if (!existing) {
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO mileage_ledger
             (id, program_id, beneficiary_user_id, beneficiary_friend_id,
              entry_type, amount, status, source, source_event_id, reason,
              idempotency_key, occurred_at, created_at, metadata)
           VALUES (?, ?, ?, ?, 'reversal', ?, 'available', 'mileage_reward_refund', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), current.programId,
          current.beneficiaryUserId, current.beneficiaryFriendId,
          reward.required_miles, current.id, requiredText(reason, '戻す理由', 500),
          refundReversalIdempotencyKey(current.id), now, now,
          JSON.stringify({ redemptionId: current.id, spendLedgerId: current.spendLedgerEntryId }),
        ),
        ...allocations.map((allocation) => db.prepare(
          // m22u R359: 返却は有効なロットだけへ戻す。成果の取消で無効化した
          // ロット(void)へは戻さない（取り消した付与が交換で復活しないように）。
          `UPDATE mileage_grant_lots
              SET remaining_amount = remaining_amount + ?,
                  status = 'available'
            WHERE ledger_entry_id = ? AND beneficiary_key = ?
              AND status IN ('available', 'exhausted')`,
        ).bind(allocation.amount, allocation.grant_lot_id, current.beneficiaryKey)),
        ...(current.rewardCodeId
          ? [db.prepare(
            `UPDATE mileage_reward_codes
                SET status = 'available', redemption_id = NULL, reserved_at = NULL
              WHERE id = ? AND redemption_id = ? AND status = 'reserved'`,
          ).bind(current.rewardCodeId, current.id)]
          : []),
      ]);
      return;
    } catch (error) {
      // 同時再開の負け（一意制約）か、本当の書き込み失敗かを見分ける。
      // 台帳があれば相手が書き終えた（batch 原子なのでロット・コードも済み）。
      if (await selectRefundReversal(db, current)) {
        await verifyRefundWrites(db, current, allocations);
        return;
      }
      throw error;
    }
  }
  // 台帳がある再開時は、ロットを戻さない（二重に戻さない）。
  // ただし旧処理で残った「台帳あり・コード未解放」だけは直す。
  await verifyRefundWrites(db, current, allocations);
}

async function loadRefundSources(
  db: D1Database,
  current: MileageRewardRedemption,
): Promise<{
  reward: { required_miles: number };
  allocations: Array<{ grant_lot_id: string; amount: number }>;
}> {
  const reward = await db.prepare(
    `SELECT v.required_miles FROM mileage_reward_versions v WHERE v.id = ?`,
  ).bind(current.rewardVersionId).first<{ required_miles: number }>();
  if (!reward || !current.spendLedgerEntryId) {
    throw new MileageRewardError('refund_source_missing', '戻すマイルの記録を確認できませんでした', 409);
  }
  const allocations = await db.prepare(
    `SELECT grant_lot_id, amount
       FROM mileage_spend_allocations
      WHERE redemption_id = ? AND spend_ledger_id = ?`,
  ).bind(current.id, current.spendLedgerEntryId).all<{ grant_lot_id: string; amount: number }>();
  const allocatedTotal = allocations.results.reduce((sum, item) => sum + item.amount, 0);
  if (allocatedTotal !== reward.required_miles) {
    throw new MileageRewardError('refund_source_missing', '戻すマイルの内訳を確認できませんでした', 409);
  }
  return { reward, allocations: allocations.results };
}

async function selectRefundReversal(
  db: D1Database,
  current: MileageRewardRedemption,
): Promise<{ id: string } | null> {
  return db.prepare(
    `SELECT id FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`,
  ).bind(current.programId, refundReversalIdempotencyKey(current.id))
    .first<{ id: string }>();
}

/**
 * R362: 旧処理で残り得る「台帳あり・コード未解放」の照合。
 * batch は原子なので、コードが未解放ならロット復元も未実行。
 * ロットの復元は読んだ残数への条件付き更新（CAS）で行う。同時修復で
 * 誰かが直した分は残数が変わっているため触らず、合計は1回分になる。
 * コード解放も予約中のときだけ通る。照合自体は何度呼んでも壊さない。
 * R362: updated_at の一致だけの柵では、同じ時刻の同時修復が両方通って
 * 内訳を二重に戻していた（時刻が同じだと柵が開いたままになる）。
 */
async function verifyRefundWrites(
  db: D1Database,
  current: MileageRewardRedemption,
  allocations: Array<{ grant_lot_id: string; amount: number }>,
): Promise<void> {
  if (!current.rewardCodeId) return;
  const code = await db.prepare(
    `SELECT status FROM mileage_reward_codes WHERE id = ? AND redemption_id = ?`,
  ).bind(current.rewardCodeId, current.id).first<{ status: string }>();
  if (!code || code.status !== 'reserved') return;
  const placeholders = allocations.map(() => '?').join(',');
  const currentLots = allocations.length > 0
    ? await db.prepare(
      `SELECT ledger_entry_id, remaining_amount FROM mileage_grant_lots
        WHERE ledger_entry_id IN (${placeholders}) AND beneficiary_key = ?
          AND status IN ('available', 'exhausted')`,
    ).bind(...allocations.map((allocation) => allocation.grant_lot_id), current.beneficiaryKey)
      .all<{ ledger_entry_id: string; remaining_amount: number }>()
    : { results: [] as Array<{ ledger_entry_id: string; remaining_amount: number }> };
  const remainingByLot = new Map(
    currentLots.results.map((row) => [row.ledger_entry_id, row.remaining_amount]),
  );
  await db.batch([
    ...allocations.map((allocation) => db.prepare(
      `UPDATE mileage_grant_lots
          SET remaining_amount = remaining_amount + ?,
              status = 'available'
        WHERE ledger_entry_id = ? AND beneficiary_key = ?
          AND remaining_amount = ?
          AND status IN ('available', 'exhausted')`,
    ).bind(
      allocation.amount,
      allocation.grant_lot_id,
      current.beneficiaryKey,
      remainingByLot.get(allocation.grant_lot_id) ?? -1,
    )),
    db.prepare(
      `UPDATE mileage_reward_codes
          SET status = 'available', redemption_id = NULL, reserved_at = NULL
        WHERE id = ? AND redemption_id = ? AND status = 'reserved'`,
    ).bind(current.rewardCodeId, current.id),
  ]);
}

/**
 * R362: 返却の書き込みが最後まで終わっているか。
 * 台帳が無ければ残高も内訳も未復旧。台帳があってもコードが
 * 未解放なら旧処理の残り（ロット未復旧）。どちらも無ければ完了。
 */
export async function isMileageRefundComplete(
  db: D1Database,
  redemptionId: string,
): Promise<boolean> {
  const current = await getMileageRedemption(db, redemptionId);
  if (!current || current.status !== 'refunded') return false;
  if (!await selectRefundReversal(db, current)) return false;
  if (!current.rewardCodeId) return true;
  const code = await db.prepare(
    `SELECT status FROM mileage_reward_codes WHERE id = ? AND redemption_id = ?`,
  ).bind(current.rewardCodeId, current.id).first<{ status: string }>();
  return !code || code.status !== 'reserved';
}

/**
 * R362: 返却確定後に書き込みが中断した交換（台帳なしの refunded）。
 * 再試行は409、cronも要対応一覧も拾わない取り残し。回復処理と
 * 要対応一覧がこの口で見つけて再開する。
 * 旧処理の残り「台帳あり・コード未解放」（ロット未復旧）も拾う。
 * 返却済みの交換に結び付いたままの予約コードは、解放漏れ以外に
 * あり得ないため、完了判定（isMileageRefundComplete）と同じ基準。
 */
export async function findIncompleteMileageRefunds(
  db: D1Database,
  input: { lineAccountId?: string; limit?: number } = {},
): Promise<MileageRewardRedemption[]> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const binds: unknown[] = [];
  const accountClause = input.lineAccountId
    ? 'AND r.line_account_id = ?'
    : '';
  if (input.lineAccountId) binds.push(input.lineAccountId);
  const rows = await db.prepare(
    `SELECT r.* FROM mileage_redemptions r
      WHERE r.status = 'refunded'
        AND (
          NOT EXISTS (
            SELECT 1 FROM mileage_ledger l
             WHERE l.program_id = r.program_id
               AND l.idempotency_key = 'mileage-redemption-refund:' || r.id
          )
          OR EXISTS (
            SELECT 1 FROM mileage_reward_codes c
             WHERE c.redemption_id = r.id AND c.status = 'reserved'
          )
        )
        ${accountClause}
      ORDER BY r.updated_at, r.created_at LIMIT ?`,
  ).bind(...binds, limit).all<RedemptionRow>();
  return rows.results.map(mapRedemption);
}

/**
 * R362: 中断した返却を残高・台帳・状態が一致するまで再開する。
 * 冪等なので何度でも呼べる。同時に走っても台帳・ロット復元は各1回。
 * 成功へ移っていた行は返却せず済みとして数える（二重返却なし）。
 */
export async function recoverIncompleteMileageRefunds(
  db: D1Database,
  input: { lineAccountId?: string; limit?: number; reason?: string } = {},
): Promise<{ recovered: number; failed: number }> {
  const targets = await findIncompleteMileageRefunds(db, input);
  let recovered = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      await refundMileageRewardRedemption(db, {
        redemptionId: target.id,
        reason: input.reason ?? '中断した返却の再開',
      });
      recovered += 1;
    } catch (error) {
      // 直前に成功へ移っていたら、返却の必要はない（遅い返却は書かない）。
      if (error instanceof MileageRewardError && error.code === 'already_delivered') {
        recovered += 1;
        continue;
      }
      failed += 1;
    }
  }
  return { recovered, failed };
}

export type MileageRedemptionStepStatus = 'started' | 'sent';

export interface MileageRedemptionStepDelivery {
  redemptionId: string;
  stepKey: string;
  idempotencyKey: string;
  status: MileageRedemptionStepStatus;
  attemptCount: number;
  owner: string | null;
  leaseExpiresAt: string | null;
  generation: number;
  fenceToken: string | null;
  needsReconcile: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 確定書き込みの失敗印。外部送信は終わっているかもしれないので、
 * deliver 側はこれを delivery_failed に落とさず、回収に任せる。
 */
export class MileageRedemptionConfirmError extends Error {
  constructor(message = '特典の送信後の確定に失敗しました') {
    super(message);
    this.name = 'MileageRedemptionConfirmError';
  }
}

/**
 * 手順の貸出予約。返すのは次の4つのどれか。
 *
 * - 'send' … 自分が貸出を持った。送ってよいのはこの走者だけ。
 * - 'sent' … 送信済み。送らない(やり直しが再送しないための outbox の口)。
 * - 'reconcile' … 照合待ち。「送るかもしれない」の証言が残っているが、
 *   送ったか確かめられない。**送り直さないし、勝手に確定もしない。**
 *   受信先が冪等でなくても二重に届かないのはこのため。
 * - 'busy' … 別の走者が貸出を持っている。送らずに待つ。
 *
 * 証言は送る前に残す。送ったあとの確定書き込みが何度失敗しても、
 * 証言は残るので回収は送り直さない。期限切れの引き継ぎでは世代を進め、
 * 期限切れの旧持ち主が貸出を取り直しても 'reconcile' しか返らない
 * (旧持ち主の再送は禁止)。古い走者の遅い確定は owner と fence が
 * 合わずに拒否される(取り違え防止の fence)。
 */
export type RedemptionStepClaim = 'send' | 'sent' | 'reconcile' | 'busy' | 'expired';

/**
 * R344: LINE 再試行キーの有効期限（24時間。公式仕様による）。
 * 最初の送信からこの時間を過ぎた手順は、同じキーで送り直さない。
 * 期限を過ぎると LINE 側の重複防止が切れ、同じキーが新規受付されるため。
 * リマインダ側の `LINE_RETRY_KEY_VALIDITY_MS` と同じ考え方。
 */
export const MILEAGE_REWARD_RETRY_KEY_VALIDITY_MS = 24 * 60 * 60 * 1000;

/**
 * R361: 渡し終えた手順があるか。部分成功の交換は全額返却しない。
 * `sent` の行が1つでもあれば、一部の特典は相手に渡っている。
 */
export async function hasSentRedemptionSteps(
  db: D1Database,
  redemptionId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM mileage_redemption_step_deliveries
      WHERE redemption_id = ? AND status = 'sent' LIMIT 1`,
  ).bind(redemptionId).first<{ ok: number }>();
  return row != null;
}



export interface RedemptionStepLease {
  redemptionId: string;
  stepKey: string;
  idempotencyKey: string;
  owner: string;
  fenceToken: string;
  leaseExpiresAt: string;
  now: string;
  /**
   * R344: 再試行キーの期限切れ境界（ISO時刻）。この時刻より前に
   * 作られた手順（＝最初の送信から24時間超）は、同じキーで送り直さない。
   * 省略時は期限を見ない。
   */
  retryKeyExpiresAt?: string | null;
}

interface RedemptionStepRow {
  status: MileageRedemptionStepStatus;
  owner: string | null;
  leaseExpiresAt: string | null;
  idempotencyKey: string;
  needsReconcile: number;
  createdAt: string;
}

async function selectRedemptionStep(
  db: D1Database,
  redemptionId: string,
  stepKey: string,
): Promise<RedemptionStepRow | null> {
  return db.prepare(
    `SELECT status, owner,
            lease_expires_at AS leaseExpiresAt,
            idempotency_key AS idempotencyKey,
            needs_reconcile AS needsReconcile,
            created_at AS createdAt
       FROM mileage_redemption_step_deliveries
      WHERE redemption_id = ? AND step_key = ?`,
  ).bind(redemptionId, stepKey).first<RedemptionStepRow>();
}

export async function claimRedemptionStep(
  db: D1Database,
  input: RedemptionStepLease,
): Promise<RedemptionStepClaim> {
  let existing = await selectRedemptionStep(db, input.redemptionId, input.stepKey);
  if (!existing) {
    try {
      /*
       * 証言つきの確保。「送るかもしれない」を送る前に残す。
       * この書き込みに失敗したら送らない。送ったあとの確定が
       * 何度失敗しても証言は残るので、回収は送り直さない。
       */
      await db.prepare(
        `INSERT INTO mileage_redemption_step_deliveries
           (redemption_id, step_key, idempotency_key, status,
            owner, lease_expires_at, generation, fence_token, needs_reconcile,
            created_at, updated_at)
         VALUES (?, ?, ?, 'started', ?, ?, 1, ?, 1, ?, ?)`,
      ).bind(
        input.redemptionId, input.stepKey, input.idempotencyKey,
        input.owner, input.leaseExpiresAt, input.fenceToken,
        input.now, input.now,
      ).run();
      return 'send';
    } catch {
      // 同時確保の負け：相手の行を既存として扱う。行が無ければ投げ直す。
      existing = await selectRedemptionStep(db, input.redemptionId, input.stepKey);
      if (!existing) throw new MileageRedemptionConfirmError();
    }
  }
  if (existing.status === 'sent') return 'sent';
  /*
   * R344: 最初の送信から24時間を過ぎた手順は、同じキーで送り直さない。
   * 期限を過ぎると LINE 側の重複防止が切れ、同じキーが新規受付されて
   * 二重に届く。照合待ちとして残し、人が確かめる。
   */
  if (input.retryKeyExpiresAt != null && existing.createdAt <= input.retryKeyExpiresAt) {
    return 'expired';
  }
  // 証言がある行は、誰も送り直さないし勝手に確定もしない。照合待ち。
  if (existing.needsReconcile === 1) return 'reconcile';
  const leaseLive = existing.leaseExpiresAt !== null && existing.leaseExpiresAt > input.now;
  // 別の走者が貸出を持っている間は、送らずに待つ。
  if (leaseLive && existing.owner !== null && existing.owner !== input.owner) return 'busy';
  if (existing.owner === input.owner && leaseLive) {
    // 同じ走者の取り直し：貸出を延ばし、証言と fence を新しくする。
    const refreshed = await db.prepare(
      `UPDATE mileage_redemption_step_deliveries
          SET lease_expires_at = ?, fence_token = ?, needs_reconcile = 1,
              attempt_count = attempt_count + 1, updated_at = ?
        WHERE redemption_id = ? AND step_key = ?
          AND status = 'started' AND needs_reconcile = 0 AND owner = ?`,
    ).bind(
      input.leaseExpiresAt, input.fenceToken, input.now,
      input.redemptionId, input.stepKey, input.owner,
    ).run();
    return (refreshed.meta?.changes ?? 0) === 1 ? 'send' : 'busy';
  }
  // 期限切れの引き継ぎ：世代を進め、証言つきで取り直す。
  // 古い走者の遅い確定は通らない。
  const taken = await db.prepare(
    `UPDATE mileage_redemption_step_deliveries
        SET owner = ?, lease_expires_at = ?, generation = generation + 1,
            fence_token = ?, needs_reconcile = 1,
            attempt_count = attempt_count + 1, updated_at = ?
      WHERE redemption_id = ? AND step_key = ?
        AND status = 'started' AND needs_reconcile = 0
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
  ).bind(
    input.owner, input.leaseExpiresAt, input.fenceToken, input.now,
    input.redemptionId, input.stepKey, input.now,
  ).run();
  return (taken.meta?.changes ?? 0) === 1 ? 'send' : 'busy';
}

/**
 * R364: 照合待ちの手順の回復引き継ぎ。送ったか確かめられない行を、
 * 送り直しても安全な手順だけ、期限内にもう一度だけ実行する。
 *
 * 返すのは次の4つのどれか。
 *
 * - 'send' … 貸出を取り直した。同じ冪等キーで実行してよい。
 * - 'sent' … その間に確定していた。送らない。
 * - 'reconcile' … 照合待ちのまま。送らない（期限切れ・Webhookなど）。
 * - 'busy' … 別の走者の貸出が生きている。送らずに待つ。
 *
 * 送り直し自体の安全は呼び出し側が手順の種類で判断する
 * （Webhookは外部で二重に届くので回復しない）。
 * 期限切れはここでも見る（`claimRedemptionStep` と同じ境界）。
 */
export async function claimRedemptionStepForRecovery(
  db: D1Database,
  input: RedemptionStepLease,
): Promise<RedemptionStepClaim> {
  const existing = await selectRedemptionStep(db, input.redemptionId, input.stepKey);
  if (!existing) throw new MileageRedemptionConfirmError();
  if (existing.status === 'sent') return 'sent';
  if (existing.needsReconcile !== 1) return 'busy';
  if (input.retryKeyExpiresAt != null && existing.createdAt <= input.retryKeyExpiresAt) {
    return 'expired';
  }
  const leaseLive = existing.leaseExpiresAt !== null && existing.leaseExpiresAt > input.now;
  if (leaseLive) return 'busy';
  const taken = await db.prepare(
    `UPDATE mileage_redemption_step_deliveries
        SET owner = ?, lease_expires_at = ?, generation = generation + 1,
            fence_token = ?, attempt_count = attempt_count + 1, updated_at = ?
      WHERE redemption_id = ? AND step_key = ?
        AND status = 'started' AND needs_reconcile = 1
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
  ).bind(
    input.owner, input.leaseExpiresAt, input.fenceToken, input.now,
    input.redemptionId, input.stepKey, input.now,
  ).run();
  return (taken.meta?.changes ?? 0) === 1 ? 'send' : 'busy';
}

/**
 * 外部送信が終わった手順を sent にする。証言つきの自分の貸出だけ通す。
 * 証言を消した行(送らなかったことが決まった行)・古い走者の遅い確定・
 * 確保していない行の確定は投げる。呼び出し側は確定失敗として扱い、
 * 失敗には落とさない(証言が残るので回収は送り直さない)。
 */
export async function markRedemptionStepSent(
  db: D1Database,
  input: { redemptionId: string; stepKey: string; owner: string; fenceToken: string; now: string },
): Promise<void> {
  const result = await db.prepare(
    `UPDATE mileage_redemption_step_deliveries
        SET status = 'sent', needs_reconcile = 0, updated_at = ?
      WHERE redemption_id = ? AND step_key = ?
        AND status = 'started' AND needs_reconcile = 1
        AND owner = ? AND fence_token = ?`,
  ).bind(input.now, input.redemptionId, input.stepKey, input.owner, input.fenceToken).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new MileageRedemptionConfirmError();
  }
}

/**
 * 送らなかった手順の証言を消す。実行器が送る前に失敗したときだけ使う。
 * 消せたら回収は送り直してよい(送っていないことが決まった)。
 * 消せなければ照合待ちのまま残し、送り直さない。
 *
 * **貸出も一緒に返す。** 証言を消すだけで持ち主と期限を残すと、行は
 * 「送っていないのに、まだ誰かが送信中」に見える。次の走者は貸出が
 * 生きている間 `'busy'` しか受け取れず、失敗した直後のやり直しが
 * 貸出の残り時間ぶん空振りする(#641 司令塔独立審査で実測: 失敗から
 * 5分間、管理画面のやり直しが1回も送らない)。送らないことが決まった
 * 行に貸出を握らせない。
 */
export async function clearRedemptionStepIntent(
  db: D1Database,
  input: { redemptionId: string; stepKey: string; owner: string; fenceToken: string; now: string },
): Promise<void> {
  const result = await db.prepare(
    `UPDATE mileage_redemption_step_deliveries
        SET needs_reconcile = 0, owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE redemption_id = ? AND step_key = ?
        AND status = 'started' AND needs_reconcile = 1
        AND owner = ? AND fence_token = ?`,
  ).bind(input.now, input.redemptionId, input.stepKey, input.owner, input.fenceToken).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new MileageRedemptionConfirmError();
  }
}

export async function getReservedMileageRewardCode(
  db: D1Database,
  redemptionId: string,
): Promise<{ id: string; ciphertext: string } | null> {
  return db.prepare(
    `SELECT c.id, c.code_ciphertext AS ciphertext
       FROM mileage_reward_codes c
       JOIN mileage_redemptions r ON r.id = c.redemption_id
      WHERE r.id = ? AND c.status IN ('reserved', 'issued')`,
  ).bind(redemptionId).first<{ id: string; ciphertext: string }>();
}

export async function getMileageRewardDeliveryPlan(
  db: D1Database,
  redemptionId: string,
): Promise<{
  redemption: MileageRewardRedemption;
  rewardName: string;
  rewardKind: MileageRewardKind;
  customerMessage: string;
  commonActionVersionId: string | null;
  actionConfig: string | null;
  failurePolicy: MileageRewardFailurePolicy;
}> {
  const row = await db.prepare(
    `SELECT r.*, reward.name AS reward_name, reward.reward_kind,
            v.customer_message, v.common_action_version_id, v.failure_policy,
            cav.action_config
       FROM mileage_redemptions r
       JOIN mileage_rewards reward ON reward.id = r.reward_id
       JOIN mileage_reward_versions v ON v.id = r.reward_version_id
       LEFT JOIN common_action_versions cav ON cav.id = v.common_action_version_id
      WHERE r.id = ?`,
  ).bind(redemptionId).first<RedemptionRow & {
    reward_name: string;
    reward_kind: MileageRewardKind;
    customer_message: string;
    common_action_version_id: string | null;
    failure_policy: MileageRewardFailurePolicy;
    action_config: string | null;
  }>();
  if (!row) throw new MileageRewardError('not_found', '交換履歴が見つかりません', 404);
  return {
    redemption: mapRedemption(row),
    // R373: 交換が決まったときの名前・種類を優先する。未公開の名前変更や
    // 種類変更が、処理中・成功済みの交換へ混ざらない。凍結前の古い行は親行を読む。
    rewardName: row.reward_name_snapshot ?? row.reward_name,
    rewardKind: row.reward_kind_snapshot ?? row.reward_kind,
    customerMessage: row.customer_message,
    commonActionVersionId: row.common_action_version_id,
    actionConfig: row.action_config,
    failurePolicy: row.failure_policy,
  };
}
