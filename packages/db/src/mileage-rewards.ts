export type MileageRewardKind =
  | 'coupon'
  | 'tag'
  | 'scenario'
  | 'template'
  | 'early_access'
  | 'rank';

export type MileageRewardStatus = 'draft' | 'published' | 'stopped' | 'archived';
export type MileageRewardFailurePolicy = 'retry' | 'refund' | 'manual';
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
  requiredMiles: number;
  stockLimit: number | null;
  perFriendLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  benefitExpiresDays: number | null;
  commonActionVersionId: string | null;
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
  required_miles: number | null;
  stock_limit: number | null;
  per_friend_limit: number | null;
  starts_at: string | null;
  ends_at: string | null;
  benefit_expires_days: number | null;
  common_action_version_id: string | null;
  failure_policy: MileageRewardFailurePolicy | null;
  customer_message: string | null;
  published_at: string | null;
  exchanged_this_month: number;
  available_code_count: number | null;
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

function optionalDate(value: unknown, label: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new MileageRewardError('invalid_date', `${label}を確認してください`);
  }
  return value;
}

export function validateMileageRewardDraft(value: MileageRewardDraftInput): Required<
  Omit<MileageRewardDraftInput, 'description' | 'imageUrl' | 'stockLimit' | 'perFriendLimit'>
> & {
  description: string | null;
  imageUrl: string | null;
  stockLimit: number | null;
  perFriendLimit: number | null;
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
    stockLimit: positiveInteger(value.stockLimit, '在庫数', true),
    perFriendLimit: positiveInteger(value.perFriendLimit, '1人あたりの交換上限', true),
    startsAt,
    endsAt,
    benefitExpiresDays: positiveInteger(value.benefitExpiresDays, '交換後の有効日数', true),
    commonActionVersionId,
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
    requiredMiles: row.required_miles,
    stockLimit: row.stock_limit,
    perFriendLimit: row.per_friend_limit,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    benefitExpiresDays: row.benefit_expires_days,
    commonActionVersionId: row.common_action_version_id,
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
         v.required_miles, v.stock_limit, v.per_friend_limit, v.starts_at, v.ends_at,
         v.benefit_expires_days, v.common_action_version_id, v.failure_policy,
         v.customer_message, v.published_at,
         (SELECT COUNT(*) FROM mileage_redemptions mr
           WHERE mr.reward_id = r.id AND mr.status = 'succeeded'
             AND mr.delivered_at >= datetime('now', 'start of month')) AS exchanged_this_month,
         (SELECT COUNT(*) FROM mileage_reward_codes mc
           WHERE mc.reward_version_id = v.id AND mc.status = 'available') AS available_code_count
    FROM mileage_rewards r
    LEFT JOIN mileage_reward_versions v
      ON v.id = ${versionExpression}`;
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
       (SELECT r.name FROM mileage_rewards r
         JOIN mileage_redemptions mr ON mr.reward_id = r.id AND mr.status = 'succeeded'
       WHERE r.line_account_id = ?
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_name,
       (SELECT COUNT(*) FROM mileage_redemptions mr
         JOIN mileage_rewards r ON r.id = mr.reward_id
        WHERE r.line_account_id = ? AND mr.status = 'succeeded'
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_count`,
  ).bind(lineAccountId, lineAccountId, lineAccountId, lineAccountId).first<{
    published_count: number;
    redeemed_miles_this_month: number;
    most_redeemed_reward_name: string | null;
    most_redeemed_reward_count: number | null;
  }>();
  return {
    rewards,
    summary: {
      publishedCount: summary?.published_count ?? 0,
      redeemedMilesThisMonth: summary?.redeemed_miles_this_month ?? 0,
      neverRedeemedFriendCount: null,
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
  const rows = await db.prepare(
    `SELECT reward_id, reward_version_id, COUNT(*) AS count
       FROM mileage_redemptions
      WHERE line_account_id = ? AND beneficiary_key = ? AND status != 'refunded'
      GROUP BY reward_id, reward_version_id`,
  ).bind(input.lineAccountId, beneficiaryKey).all<{
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
          common_action_version_id, failure_policy, customer_message, created_by, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, rewardId, draft.requiredMiles, draft.stockLimit, draft.perFriendLimit,
      draft.startsAt, draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
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
    updatedBy?: string | null;
    draft: MileageRewardDraftInput;
  },
): Promise<MileageRewardSummary> {
  const draft = validateMileageRewardDraft(input.draft);
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_rewards
          SET name = ?, description = ?, image_url = ?, reward_kind = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
    ).bind(
      draft.name, draft.description, draft.imageUrl, draft.rewardKind, now,
      input.id, input.lineAccountId, input.expectedVersionId,
    ),
    db.prepare(
      `UPDATE mileage_reward_versions
          SET required_miles = ?, stock_limit = ?, per_friend_limit = ?, starts_at = ?,
              ends_at = ?, benefit_expires_days = ?, common_action_version_id = ?,
              failure_policy = ?, customer_message = ?, created_by = ?
        WHERE id = ? AND reward_id = ? AND status = 'draft'`,
    ).bind(
      draft.requiredMiles, draft.stockLimit, draft.perFriendLimit, draft.startsAt,
      draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
      draft.failurePolicy, draft.customerMessage, input.updatedBy ?? null,
      input.expectedVersionId, input.id,
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
  await db.batch([
    db.prepare(
      `INSERT INTO mileage_reward_versions
         (id, reward_id, version_number, status, required_miles, stock_limit,
          per_friend_limit, starts_at, ends_at, benefit_expires_days,
          common_action_version_id, failure_policy, customer_message, created_by, created_at)
       SELECT ?, reward_id, version_number + 1, 'draft', required_miles, stock_limit,
              per_friend_limit, starts_at, ends_at, benefit_expires_days,
              common_action_version_id, failure_policy, customer_message, ?, ?
         FROM mileage_reward_versions WHERE id = ? AND status = 'published'`,
    ).bind(versionId, input.createdBy ?? null, now, reward.currentPublishedVersionId),
    db.prepare(
      `UPDATE mileage_rewards SET current_draft_version_id = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
    ).bind(versionId, now, input.id, input.lineAccountId),
  ]);
  const created = await getMileageReward(db, input);
  if (!created) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return created;
}

export async function publishMileageReward(
  db: D1Database,
  input: { id: string; lineAccountId: string; publishedBy?: string | null },
): Promise<MileageRewardSummary> {
  const reward = await getMileageReward(db, input);
  const draft = reward?.currentVersion?.status === 'draft' ? reward.currentVersion : null;
  if (!reward || !draft || !reward.currentDraftVersionId) {
    throw new MileageRewardError('draft_missing', '公開する下書きがありません', 409);
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
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_reward_versions
          SET status = 'published', published_at = ?, created_by = COALESCE(?, created_by)
        WHERE id = ? AND reward_id = ? AND status = 'draft'`,
    ).bind(now, input.publishedBy ?? null, draft.id, reward.id),
    db.prepare(
      `UPDATE mileage_rewards
          SET status = 'published', current_published_version_id = current_draft_version_id,
              current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?`,
    ).bind(now, reward.id, input.lineAccountId, draft.id),
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
  const results = await db.batch(unique.map((code) => db.prepare(
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

  const reward = await getMileageReward(db, { id: input.rewardId, lineAccountId: input.lineAccountId });
  const version = reward?.currentVersion?.status === 'published' ? reward.currentVersion : null;
  if (!reward || reward.status !== 'published' || !version) {
    throw new MileageRewardError('reward_not_available', 'この使い道は現在交換できません', 409);
  }
  const now = new Date().toISOString();
  if ((version.startsAt && version.startsAt > now) || (version.endsAt && version.endsAt <= now)) {
    throw new MileageRewardError('reward_outside_period', 'この使い道は交換期間外です', 409);
  }
  const friend = await db.prepare(
    `SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(input.friendId, input.lineAccountId).first<{ id: string; user_id: string | null }>();
  if (!friend) throw new MileageRewardError('friend_not_found', '友だち情報を確認できませんでした', 404);
  const beneficiaryKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  const wallet = await db.prepare(
    `SELECT beneficiary_key, beneficiary_user_id, beneficiary_friend_id, available, version
       FROM mileage_wallets WHERE program_id = ? AND beneficiary_key = ?`,
  ).bind(reward.programId, beneficiaryKey).first<WalletRow>();
  if (!wallet || wallet.available < version.requiredMiles) {
    throw new MileageRewardError('insufficient_miles', '交換に必要なマイルが足りません', 409);
  }
  if (version.perFriendLimit) {
    const count = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_redemptions
        WHERE reward_id = ? AND beneficiary_key = ? AND status != 'refunded'`,
    ).bind(reward.id, beneficiaryKey).first<{ count: number }>();
    if ((count?.count ?? 0) >= version.perFriendLimit) {
      throw new MileageRewardError('friend_limit_reached', 'この使い道は交換上限に達しています', 409);
    }
  }
  const code = reward.rewardKind === 'coupon'
    ? await db.prepare(
      `SELECT id FROM mileage_reward_codes
        WHERE reward_version_id = ? AND status = 'available' ORDER BY created_at, id LIMIT 1`,
    ).bind(version.id).first<{ id: string }>()
    : null;
  if (reward.rewardKind === 'coupon' && !code) {
    throw new MileageRewardError('out_of_stock', '交換コードの在庫がありません', 409);
  }
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
    throw new MileageRewardError('mileage_lots_unavailable', '交換できるマイルの内訳を確認できませんでした', 409);
  }

  const redemptionId = crypto.randomUUID();
  const spendLedgerId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO mileage_redemptions
         (id, line_account_id, program_id, beneficiary_key, beneficiary_user_id,
          beneficiary_friend_id, reward_id, reward_version_id, spend_ledger_entry_id,
          reward_code_id, idempotency_key, request_fingerprint, status, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?
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
             WHERE person_limit.reward_id = ? AND person_limit.beneficiary_key = ?
               AND person_limit.status != 'refunded'
          ) < ?)`,
    ).bind(
      redemptionId, reward.lineAccountId, reward.programId, beneficiaryKey,
      friend.user_id, friend.id, reward.id, version.id,
      null, code?.id ?? null, input.idempotencyKey, input.requestFingerprint,
      now, now, reward.programId, beneficiaryKey, wallet.version, version.requiredMiles,
      reward.programId, input.idempotencyKey,
      code?.id ?? null, code?.id ?? null,
      version.stockLimit, version.id, version.stockLimit,
      version.perFriendLimit, reward.id, beneficiaryKey, version.perFriendLimit,
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
  if (!created) {
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
          WHERE reward_id = ? AND beneficiary_key = ? AND status != 'refunded'`,
      ).bind(reward.id, beneficiaryKey).first<{ count: number }>();
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
  return { kind: 'created', redemption: created };
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
  if (current.status === 'succeeded' || current.status === 'refunded') return current;
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

export async function refundMileageRewardRedemption(
  db: D1Database,
  input: { redemptionId: string; reason: string },
): Promise<MileageRewardRedemption> {
  const current = await getMileageRedemption(db, input.redemptionId);
  if (!current) throw new MileageRewardError('not_found', '交換履歴が見つかりません', 404);
  if (current.status === 'refunded') return current;
  if (current.status === 'succeeded') {
    throw new MileageRewardError('already_delivered', 'すでに特典を渡した交換は返金できません', 409);
  }
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
  const now = new Date().toISOString();
  const ledgerId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id,
          entry_type, amount, status, source, source_event_id, reason,
          idempotency_key, occurred_at, created_at, metadata)
       VALUES (?, ?, ?, ?, 'reversal', ?, 'available', 'mileage_reward_refund', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ledgerId, current.programId, current.beneficiaryUserId, current.beneficiaryFriendId,
      reward.required_miles, current.id, requiredText(input.reason, '戻す理由', 500),
      `mileage-redemption-refund:${current.id}`, now, now,
      JSON.stringify({ redemptionId: current.id, spendLedgerId: current.spendLedgerEntryId }),
    ),
    db.prepare(
      `UPDATE mileage_redemptions
          SET status = 'refunded', refunded_at = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND status NOT IN ('succeeded', 'refunded')`,
    ).bind(now, now, current.id),
    ...allocations.results.map((allocation) => db.prepare(
      `UPDATE mileage_grant_lots
          SET remaining_amount = remaining_amount + ?,
              status = 'available'
        WHERE ledger_entry_id = ? AND beneficiary_key = ?`,
    ).bind(allocation.amount, allocation.grant_lot_id, current.beneficiaryKey)),
    ...(current.rewardCodeId
      ? [db.prepare(
        `UPDATE mileage_reward_codes
            SET status = 'available', redemption_id = NULL, reserved_at = NULL
          WHERE id = ? AND redemption_id = ? AND status = 'reserved'`,
      ).bind(current.rewardCodeId, current.id)]
      : []),
  ]);
  return (await getMileageRedemption(db, current.id))!;
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
    rewardName: row.reward_name,
    rewardKind: row.reward_kind,
    customerMessage: row.customer_message,
    commonActionVersionId: row.common_action_version_id,
    actionConfig: row.action_config,
    failurePolicy: row.failure_policy,
  };
}
