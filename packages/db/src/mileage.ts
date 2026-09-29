import { accountFeatureOffExclusionSql, isAccountFeatureEnabled } from './account-settings.js';
import { matchesCondition, parseCondition, type SegmentCondition } from './segment-conditions.js';
import { dbTableExists, jstNow } from './utils.js';

export const DEFAULT_MILEAGE_PROGRAM_ID = 'default';

/**
 * Bootstrap files contain schema objects but not seed rows, so lazily ensure the
 * built-in program before any default-wallet operation. The migration also
 * seeds it; INSERT OR IGNORE keeps both deployment paths safe.
 */
export async function ensureDefaultMileageProgram(db: D1Database): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_programs
         (id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      DEFAULT_MILEAGE_PROGRAM_ID,
      DEFAULT_MILEAGE_PROGRAM_ID,
      'Harnessマイル',
      now,
      now,
    )
    .run();
}

async function ensureBuiltInProgram(db: D1Database, programId: string): Promise<void> {
  if (programId === DEFAULT_MILEAGE_PROGRAM_ID) {
    await ensureDefaultMileageProgram(db);
  }
}

export type MileageEntryType =
  | 'grant'
  | 'reversal'
  | 'spend'
  | 'expiration'
  | 'adjustment';
export type MileageEntryStatus = 'pending' | 'available' | 'void';

export interface EngagementEvent {
  id: string;
  program_id: string;
  idempotency_key: string;
  event_type: string;
  source: string;
  source_event_id: string | null;
  actor_user_id: string | null;
  actor_friend_id: string | null;
  subject_user_id: string | null;
  subject_friend_id: string | null;
  identity_provider: string | null;
  identity_subject: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface MileageLedgerEntry {
  id: string;
  program_id: string;
  beneficiary_user_id: string | null;
  beneficiary_friend_id: string | null;
  engagement_event_id: string | null;
  mileage_rule_id: string | null;
  entry_type: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  source_event_id: string | null;
  idempotency_key: string;
  reverses_entry_id: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RecordEngagementEventInput {
  programId?: string;
  idempotencyKey: string;
  eventType: string;
  source: string;
  sourceEventId?: string | null;
  actorUserId?: string | null;
  actorFriendId?: string | null;
  subjectUserId?: string | null;
  subjectFriendId?: string | null;
  identityProvider?: string | null;
  identitySubject?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/**
 * Persist one normalized user action exactly once.
 *
 * Every channel (LIFF, webinar, Instagram, X, etc.) can call this same entry
 * point. `idempotencyKey` must be stable for the upstream action so webhook or
 * API retries never duplicate either the event or its eventual mileage grant.
 */
export async function recordEngagementEvent(
  db: D1Database,
  input: RecordEngagementEventInput,
): Promise<EngagementEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);

  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, source_event_id,
          actor_user_id, actor_friend_id, subject_user_id, subject_friend_id,
          identity_provider, identity_subject, metadata, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      programId,
      input.idempotencyKey,
      input.eventType,
      input.source,
      input.sourceEventId ?? null,
      input.actorUserId ?? null,
      input.actorFriendId ?? null,
      input.subjectUserId ?? null,
      input.subjectFriendId ?? null,
      input.identityProvider ?? null,
      input.identitySubject ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.occurredAt ?? now,
      now,
    )
    .run();

  const event = await db
    .prepare(
      `SELECT * FROM engagement_events
        WHERE program_id = ? AND idempotency_key = ?`,
    )
    .bind(programId, input.idempotencyKey)
    .first<EngagementEvent>();
  if (!event) throw new Error('Failed to record engagement event');
  return event;
}

export interface EnqueueMileageEventInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/** Record an action and enqueue its mileage projection without blocking it. */
export async function enqueueMileageEvent(
  db: D1Database,
  input: EnqueueMileageEventInput,
): Promise<EngagementEvent> {
  const friend = await db
    .prepare(`SELECT id, user_id, line_account_id FROM friends WHERE id = ?`)
    .bind(input.friendId)
    .first<{ id: string; user_id: string | null; line_account_id: string | null }>();
  if (!friend) throw new Error(`Mileage friend not found: ${input.friendId}`);

  // N-231 案1: 受付時点で適用版の集合を固定する。後で公開されてもこの行は旧版のまま。
  const versionMap = friend.line_account_id
    ? await getAccountRuleVersionMap(db, friend.line_account_id)
    : {};
  const snapshot = JSON.stringify(versionMap);
  const now = jstNow();
  const event = await recordEngagementEvent(db, {
    idempotencyKey: `${input.source}:${input.eventType}:${input.sourceEventId}`,
    eventType: input.eventType,
    source: input.source,
    sourceEventId: input.sourceEventId,
    actorUserId: friend.user_id,
    actorFriendId: friend.id,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.subjectKey ? { subjectKey: input.subjectKey } : {}),
    },
    occurredAt: input.occurredAt ?? now,
  });

  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_event_queue
         (engagement_event_id, status, attempts, available_at,
          applied_published_snapshot, created_at, updated_at)
       VALUES (?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .bind(event.id, now, snapshot, now, now)
    .run();
  return event;
}

export interface PostMileageEntryInput {
  programId?: string;
  beneficiaryUserId?: string | null;
  beneficiaryFriendId?: string | null;
  engagementEventId?: string | null;
  mileageRuleId?: string | null;
  entryType: MileageEntryType;
  status?: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  sourceEventId?: string | null;
  idempotencyKey: string;
  reversesEntryId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/** Add one immutable ledger entry exactly once. Existing entries are returned. */
export async function postMileageEntry(
  db: D1Database,
  input: PostMileageEntryInput,
): Promise<MileageLedgerEntry> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error('Mileage amount must be a non-zero integer');
  }
  if (!input.beneficiaryUserId && !input.beneficiaryFriendId) {
    throw new Error('Mileage beneficiary is required');
  }

  const id = crypto.randomUUID();
  const now = jstNow();
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id,
          engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
          source_event_id, idempotency_key, reverses_entry_id, metadata,
          occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      programId,
      input.beneficiaryUserId ?? null,
      input.beneficiaryFriendId ?? null,
      input.engagementEventId ?? null,
      input.mileageRuleId ?? null,
      input.entryType,
      input.status ?? 'available',
      input.amount,
      input.reason,
      input.source,
      input.sourceEventId ?? null,
      input.idempotencyKey,
      input.reversesEntryId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.occurredAt ?? now,
      now,
    )
    .run();

  const entry = await db
    .prepare(
      `SELECT * FROM mileage_ledger
        WHERE program_id = ? AND idempotency_key = ?`,
    )
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (!entry) throw new Error('Failed to post mileage entry');
  return entry;
}

export type MileageAdjustmentErrorCode =
  | 'friend_not_found'
  | 'insufficient_balance'
  | 'idempotency_conflict';

export class MileageAdjustmentError extends Error {
  constructor(public readonly code: MileageAdjustmentErrorCode) {
    super(code);
    this.name = 'MileageAdjustmentError';
  }
}

export interface PostMileageAdjustmentInput {
  programId?: string;
  friendId: string;
  amount: number;
  reason: string;
  reasonCategory: string;
  sourceReferenceId?: string | null;
  idempotencyKey: string;
  executedByStaffId: string;
  executedByStaffName: string;
  lineAccountId: string;
  /** Positive adjustments create an expiring grant lot through the existing ledger trigger. */
  expiresAt?: string | null;
  /** Included in the idempotency fingerprint so a retry cannot add or remove delivery. */
  notifyFriend?: boolean;
  occurredAt?: string;
}

export interface MileageAdjustmentResult {
  entry: MileageLedgerEntry;
  balanceBefore: number;
  balanceAfter: number;
  replayed: boolean;
}

type MileageAdjustmentMetadata = {
  adjustmentFingerprint?: string;
  balanceBefore?: number;
  balanceAfter?: number;
};

function parseAdjustmentMetadata(value: string | null): MileageAdjustmentMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as MileageAdjustmentMetadata;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function adjustmentResult(
  entry: MileageLedgerEntry,
  fingerprint: string,
  replayed: boolean,
): MileageAdjustmentResult {
  const metadata = parseAdjustmentMetadata(entry.metadata);
  if (
    metadata.adjustmentFingerprint !== fingerprint ||
    !Number.isFinite(metadata.balanceBefore) ||
    !Number.isFinite(metadata.balanceAfter)
  ) {
    throw new MileageAdjustmentError('idempotency_conflict');
  }
  return {
    entry,
    balanceBefore: Number(metadata.balanceBefore),
    balanceAfter: Number(metadata.balanceAfter),
    replayed,
  };
}

function buildAdjustmentFingerprint(input: PostMileageAdjustmentInput): string {
  const fingerprintInput: Record<string, unknown> = {
    friendId: input.friendId,
    amount: input.amount,
    reason: input.reason,
    reasonCategory: input.reasonCategory,
    sourceReferenceId: input.sourceReferenceId ?? null,
    lineAccountId: input.lineAccountId,
  };
  // Keep the original six-field shape when neither V6 option is used, so
  // idempotent retries of adjustments created before this migration still work.
  if (input.expiresAt) fingerprintInput.expiresAt = input.expiresAt;
  if (input.notifyFriend) fingerprintInput.notifyFriend = true;
  return JSON.stringify(fingerprintInput);
}

/**
 * R378: 確定済みの調整を Idempotency-Key で探す。
 *
 * 承認境界の引き下げや元の有効期限の経過は「新しい調整への判定」なので、
 * すでに台帳へ入った同じ要求の再送には適用しない。呼び出し側は
 * 期限・境界の検査より先にここを試し、見つかったら当時の結果を返す。
 * 同じキーで別の内容が来た場合は idempotency_conflict を投げる。
 */
export async function findCommittedMileageAdjustment(
  db: D1Database,
  input: PostMileageAdjustmentInput,
): Promise<MileageAdjustmentResult | null> {
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  const existing = await db
    .prepare(`SELECT * FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`)
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (!existing) return null;
  return adjustmentResult(existing, buildAdjustmentFingerprint(input), true);
}

/**
 * Append one manual adjustment without ever mutating the existing ledger.
 *
 * The balance check and INSERT share one SQLite statement. Two deductions that
 * race cannot both observe the same old balance: D1 serializes the write and
 * the second statement re-evaluates the wallet before inserting. The stable
 * `(program_id, idempotency_key)` constraint makes retries return the original
 * before/after values instead of applying the delta again.
 */
export async function postMileageAdjustment(
  db: D1Database,
  input: PostMileageAdjustmentInput,
): Promise<MileageAdjustmentResult> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error('Mileage adjustment amount must be a non-zero integer');
  }
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);

  const fingerprint = buildAdjustmentFingerprint(input);
  const existing = await db
    .prepare(`SELECT * FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`)
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (existing) return adjustmentResult(existing, fingerprint, true);

  const id = crypto.randomUUID();
  const now = input.occurredAt ?? jstNow();
  const baseMetadata = JSON.stringify({
    adjustmentFingerprint: fingerprint,
    reasonCategory: input.reasonCategory,
    sourceReferenceId: input.sourceReferenceId ?? null,
    lineAccountId: input.lineAccountId,
    executedByStaffId: input.executedByStaffId,
    executedByStaffName: input.executedByStaffName,
    expiresAt: input.expiresAt ?? null,
    // R380: 通知記録の作成自体が落ちたとき、あとから「通知だけ」を再送
    // できるよう、依頼されたかどうかを台帳へ残す。
    notifyFriend: input.notifyFriend === true,
  });

  const write = await db
    .prepare(
      `WITH identity AS (
         SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?
       ), wallet AS (
         SELECT COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available
           FROM mileage_ledger ml
           LEFT JOIN identity ON 1 = 1
          WHERE ml.program_id = ?
            AND ${FRIEND_WALLET_SCOPE_SQL}
       )
       INSERT OR IGNORE INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id,
          engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
          source_event_id, idempotency_key, reverses_entry_id, metadata,
          occurred_at, created_at)
       SELECT ?, ?, identity.user_id, identity.id,
              NULL, NULL, 'adjustment', 'available', ?, ?, 'admin_adjustment',
              NULL, ?, NULL,
              json_set(?, '$.balanceBefore', wallet.available,
                          '$.balanceAfter', wallet.available + ?),
              ?, ?
         FROM identity CROSS JOIN wallet
        WHERE ? > 0 OR wallet.available + ? >= 0`,
    )
    .bind(
      input.friendId,
      input.lineAccountId,
      programId,
      input.friendId,
      id,
      programId,
      input.amount,
      input.reason,
      input.idempotencyKey,
      baseMetadata,
      input.amount,
      now,
      now,
      input.amount,
      input.amount,
    )
    .run();

  const inserted = await db
    .prepare(`SELECT * FROM mileage_ledger WHERE program_id = ? AND idempotency_key = ?`)
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (inserted) return adjustmentResult(inserted, fingerprint, (write.meta?.changes ?? 0) === 0);

  const friend = await db
    .prepare(`SELECT id FROM friends WHERE id = ? AND line_account_id = ?`)
    .bind(input.friendId, input.lineAccountId)
    .first<{ id: string }>();
  if (!friend) throw new MileageAdjustmentError('friend_not_found');
  throw new MileageAdjustmentError('insufficient_balance');
}

export interface MileageSummary {
  programId: string;
  programName: string;
  available: number;
  pending: number;
  lifetimeEarned: number;
  spent: number;
}

const FRIEND_WALLET_SCOPE_SQL = `(
  ml.beneficiary_friend_id = ?
  OR (
    identity.user_id IS NOT NULL
    AND (
      ml.beneficiary_user_id = identity.user_id
      OR ml.beneficiary_friend_id IN (
        SELECT linked.id FROM friends linked WHERE linked.user_id = identity.user_id
      )
    )
  )
)`;

/**
 * Resolve a wallet through friends.user_id when available. This makes balances
 * follow the same person across multiple LINE accounts without rewriting old
 * ledger rows; an unlinked friend still has a safe friend-scoped wallet.
 */
/**
 * m22u R360：交換の内訳選びと同じ「使える」基準。
 * 期限切れロットの残数は、台帳に残っていても使えない。残高からも外す。
 * 比較は交換予約と同じ now で行い、基準のずれを作らない。
 */
function expiredLotHoldbackSql(): string {
  return `COALESCE((
           SELECT SUM(l.remaining_amount) FROM mileage_grant_lots l
            WHERE l.program_id = mp.id
              AND l.status = 'available'
              AND l.remaining_amount > 0
              AND l.expires_at IS NOT NULL AND l.expires_at <= ?
              AND (l.beneficiary_key = 'friend:' || ?
                   OR l.beneficiary_key = 'user:' || (SELECT user_id FROM friends WHERE id = ?))
         ), 0)`;
}

export async function getMileageSummaryForFriend(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
  now = new Date().toISOString(),
): Promise<MileageSummary> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT mp.name AS program_name,
              COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0)
                - ${expiredLotHoldbackSql()} AS available,
              COALESCE(SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0
                                THEN ml.amount ELSE 0 END), 0) AS lifetime_earned,
              COALESCE(-SUM(CASE WHEN ml.entry_type = 'spend' AND ml.amount < 0
                                 THEN ml.amount ELSE 0 END), 0) AS spent
         FROM mileage_programs mp
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN mileage_ledger ml
           ON ml.program_id = mp.id
          AND ${FRIEND_WALLET_SCOPE_SQL}
        WHERE mp.id = ?
        GROUP BY mp.id, mp.name`,
    )
    .bind(friendId, now, friendId, friendId, friendId, programId)
    .first<{
      program_name: string;
      available: number;
      pending: number;
      lifetime_earned: number;
      spent: number;
    }>();

  if (!row) throw new Error(`Mileage program not found: ${programId}`);
  return {
    programId,
    programName: row.program_name,
    available: Number(row.available),
    pending: Number(row.pending),
    lifetimeEarned: Number(row.lifetime_earned),
    spent: Number(row.spent),
  };
}

export interface MileageHistoryItem {
  id: string;
  entryType: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string | null;
  source: string;
  sourceEventId: string | null;
  sourceReferenceId: string | null;
  ruleName: string | null;
  mode: 'automatic' | 'manual';
  executedByStaffName: string | null;
  occurredAt: string;
  /** この記録が属する LINE アカウント（不明なら null）。 */
  lineAccountId: string | null;
  /*
   * true の行は、見ている担当者の権限外アカウントの記録。
   * 残高は名寄せした本人で共通だが、調整の理由・実行者・元イベントは
   * アカウントの閲覧権限で区切るため、この行では伏せてある（R387）。
   */
  restricted: boolean;
  /** R380: 手動調整につけた友だち通知の状態。通知なし・権限外の行は null。 */
  notificationStatus: string | null;
  notificationErrorCode: string | null;
}

export async function getMileageHistoryForFriend(
  db: D1Database,
  friendId: string,
  options: { programId?: string; limit?: number; visibleAccountIds?: string[] } = {},
): Promise<MileageHistoryItem[]> {
  const programId = options.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const visible = options.visibleAccountIds ? new Set(options.visibleAccountIds) : null;
  const result = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT ml.id, ml.entry_type, ml.status, ml.amount, ml.reason,
              ml.source, ml.source_event_id, mr.name AS rule_name,
              json_extract(ml.metadata, '$.sourceReferenceId') AS source_reference_id,
              json_extract(ml.metadata, '$.executedByStaffName') AS executed_by_staff_name,
              json_extract(ml.metadata, '$.lineAccountId') AS metadata_account_id,
              bf.line_account_id AS entry_account_id,
              man.status AS notification_status,
              man.error_code AS notification_error_code,
              ml.occurred_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN mileage_rules mr ON mr.id = ml.mileage_rule_id
         LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
         LEFT JOIN mileage_adjustment_notifications man ON man.ledger_entry_id = ml.id
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}
        ORDER BY ml.occurred_at DESC, ml.created_at DESC, ml.id DESC
        LIMIT ?`,
    )
    .bind(friendId, programId, friendId, limit)
    .all<{
      id: string;
      entry_type: MileageEntryType;
      status: MileageEntryStatus;
      amount: number;
      reason: string;
      source: string;
      source_event_id: string | null;
      source_reference_id: string | null;
      rule_name: string | null;
      executed_by_staff_name: string | null;
      metadata_account_id: string | null;
      entry_account_id: string | null;
      notification_status: string | null;
      notification_error_code: string | null;
      occurred_at: string;
    }>();

  return result.results.map((row) => {
    const lineAccountId = row.metadata_account_id ?? row.entry_account_id;
    /*
     * 所属アカウントが分からない行も伏せる。分からない以上「見てよい」
     * とは証明できないため、権限の外側と同じ扱いにする（安全側）。
     */
    const restricted = visible !== null && (lineAccountId === null || !visible.has(lineAccountId));
    return {
      id: row.id,
      entryType: row.entry_type,
      status: row.status,
      amount: row.amount,
      reason: restricted ? null : row.reason,
      source: row.source,
      sourceEventId: restricted ? null : row.source_event_id,
      sourceReferenceId: restricted ? null : row.source_reference_id,
      ruleName: restricted ? null : row.rule_name,
      mode: row.entry_type === 'adjustment' || row.source === 'manual' || row.source === 'admin_adjustment'
        ? 'manual'
        : 'automatic',
      executedByStaffName: restricted ? null : row.executed_by_staff_name,
      occurredAt: row.occurred_at,
      lineAccountId,
      restricted,
      // R380: 通知の失敗は履歴の行から再送できるように、状態だけを返す。
      // 権限外アカウントの行では通知の有無も伏せる。
      notificationStatus: restricted ? null : row.notification_status,
      notificationErrorCode: restricted ? null : row.notification_error_code,
    };
  });
}

export interface MileageSelfInsights {
  /** Number of LINE Official Accounts currently linked to this person. */
  accountCount: number;
  /** Non-void mileage grants, useful as a simple engagement counter. */
  rewardedActions: number;
  /** Available miles earned because an introduced friend took a quality action. */
  referralMiles: number;
  /** Distinct introduced people who produced at least one quality reward. */
  qualityReferralCount: number;
  lastEarnedAt: string | null;
}

export interface MileageConnectedAccount {
  accountId: string;
  accountName: string;
  friendId: string;
}

export interface MileageEarningOpportunity {
  id: string;
  type: 'webinar' | 'friend_add';
  title: string;
  description: string;
  rewardMiles: number;
  nextRewardMiles: number;
  progressPercent: number;
  ctaLabel: string;
  url: string;
  targetAccountId?: string;
  completed?: boolean;
  mileageStatus?: 'credited' | 'pending' | 'waiting';
  creditedMiles?: number;
}

/**
 * Personal mileage-page counters for one verified friend.
 *
 * The wallet scope deliberately matches getMileageSummaryForFriend: once a
 * friend is linked to a canonical users.id, activity from every connected LINE
 * Official Account is shown as one wallet. Unlinked friends remain isolated to
 * their own friend row.
 */
export async function getMileageSelfInsights(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageSelfInsights> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       ), friend_scope AS (
         SELECT f.id, f.line_account_id
           FROM friends f
           LEFT JOIN identity ON 1 = 1
          WHERE f.id = ?
             OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
       )
       SELECT (SELECT COUNT(DISTINCT line_account_id) FROM friend_scope) AS account_count,
              COUNT(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void' THEN 1
                ELSE NULL END) AS rewarded_actions,
              COALESCE(SUM(CASE
                WHEN ml.status = 'available'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN ml.amount ELSE 0 END), 0) AS referral_miles,
              COUNT(DISTINCT CASE
                WHEN ml.entry_type = 'grant'
                 AND ml.status != 'void'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN COALESCE(json_extract(ml.metadata, '$.referredUserId'),
                              json_extract(ml.metadata, '$.referredFriendId'))
                ELSE NULL END) AS quality_referral_count,
              MAX(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void'
                THEN ml.occurred_at ELSE NULL END) AS last_earned_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}`,
    )
    .bind(friendId, friendId, programId, friendId)
    .first<{
      account_count: number;
      rewarded_actions: number;
      referral_miles: number;
      quality_referral_count: number;
      last_earned_at: string | null;
    }>();

  return {
    accountCount: Number(row?.account_count ?? 0),
    rewardedActions: Number(row?.rewarded_actions ?? 0),
    referralMiles: Number(row?.referral_miles ?? 0),
    qualityReferralCount: Number(row?.quality_referral_count ?? 0),
    lastEarnedAt: row?.last_earned_at ?? null,
  };
}

/**
 * List only connected accounts the authenticated operator may see. The caller
 * provides its resolved account scope so a verified cross-account wallet does
 * not reveal a hidden account name or friend id.
 */
export async function getMileageConnectedAccountsForFriend(
  db: D1Database,
  friendId: string,
  allowedAccountIds: string[],
): Promise<MileageConnectedAccount[]> {
  if (allowedAccountIds.length === 0) return [];
  const placeholders = allowedAccountIds.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT f.line_account_id AS account_id,
              COALESCE(la.name, '名前未設定') AS account_name,
              f.id AS friend_id
         FROM friends f
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
        WHERE f.line_account_id IN (${placeholders})
          AND (f.id = ? OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id))
        ORDER BY COALESCE(la.display_order, 0) ASC, account_name ASC, f.id ASC`,
    )
    .bind(friendId, ...allowedAccountIds, friendId)
    .all<{ account_id: string; account_name: string; friend_id: string }>();
  return rows.results.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    friendId: row.friend_id,
  }));
}

/**
 * Build actionable, person-specific ways to earn more mileage.
 *
 * The first opportunity provider is the auto-webinar system. It compares the
 * person's best viewing position (across linked friend rows) with the active
 * mileage rules, then only returns webinars that still have an attainable
 * reward. The returned LIFF URL always uses the webinar's own LINE account.
 */
export async function getMileageEarningOpportunitiesForFriend(
  db: D1Database,
  friendId: string,
  options: { limit?: number; now?: string } = {},
): Promise<MileageEarningOpportunity[]> {
  const limit = Math.min(10, Math.max(1, options.limit ?? 10));
  const now = options.now ?? jstNow();
  const eventTypes = [
    'webinar_watch_5m',
    'webinar_watch_15m',
    'webinar_completed',
    'webinar_cta_clicked',
  ] as const;

  const [rulesResult, webinarsResult, accountsResult, multiplier] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, source, amount, conditions
           FROM mileage_rules
          WHERE program_id = ?
            AND event_type IN ('friend_registered', ?, ?, ?, ?)
            AND is_active = 1
            AND (line_account_id IS NULL
                 OR line_account_id = (SELECT line_account_id FROM friends WHERE id = ?))
            AND (conditions IS NULL
                 OR COALESCE(json_extract(conditions, '$.beneficiary'), 'actor') = 'actor')
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(
        DEFAULT_MILEAGE_PROGRAM_ID,
        ...eventTypes,
        friendId,
        now,
        now,
      )
      .all<{ event_type: string; source: string | null; amount: number; conditions: string | null }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id, line_account_id FROM friends WHERE id = ?
         ), friend_scope AS (
           SELECT f.id
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.id = ?
               OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
         )
         SELECT w.id, w.title, w.slug, w.duration_seconds, w.updated_at,
                la.liff_id,
                COALESCE(MAX(v.last_position_seconds), 0) AS max_position_seconds,
                MAX(CASE WHEN v.cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicked,
                MAX(CASE WHEN wc.id IS NOT NULL OR w.cta_json IS NOT NULL THEN 1 ELSE 0 END) AS has_cta
           FROM webinars w
           JOIN identity ON w.account_id = identity.line_account_id
           JOIN line_accounts la ON la.id = w.account_id
           LEFT JOIN webinar_viewers v
             ON v.webinar_id = w.id
            AND v.friend_id IN (SELECT id FROM friend_scope)
           LEFT JOIN webinar_ctas wc ON wc.webinar_id = w.id
          WHERE w.status = 'active'
            AND w.duration_seconds > 0
            AND la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          GROUP BY w.id, w.title, w.slug, w.duration_seconds, w.updated_at, la.liff_id
          ORDER BY w.updated_at DESC, w.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        title: string;
        slug: string;
        duration_seconds: number;
        updated_at: string;
        liff_id: string;
        max_position_seconds: number;
        cta_clicked: number;
        has_cta: number;
      }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id FROM friends WHERE id = ?
         ), scoped_friends AS (
           SELECT f.id, f.line_account_id, f.is_following
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.line_account_id IS NOT NULL
              AND (f.id = ?
                   OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id))
         )
         SELECT la.id, la.name, la.liff_id, la.display_order,
                EXISTS(
                  SELECT 1 FROM scoped_friends sf
                   WHERE sf.line_account_id = la.id AND sf.is_following = 1
                ) AS is_registered,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'available'
                   WHERE sf.line_account_id = la.id
                ), 0) AS credited_miles,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'pending'
                   WHERE sf.line_account_id = la.id
                ), 0) AS pending_miles
           FROM line_accounts la
          WHERE la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          ORDER BY la.display_order ASC, la.created_at ASC, la.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        name: string;
        liff_id: string;
        display_order: number;
        is_registered: number;
        credited_miles: number;
        pending_miles: number;
      }>(),
    resolveMileageMultiplier(db, friendId, now),
  ]);

  const amounts = new Map<string, number>();
  for (const rule of rulesResult.results) {
    const sourceMatches = rule.event_type === 'friend_registered'
      ? rule.source === null || rule.source === 'line_relationship'
      : rule.source === null || rule.source === 'webinar';
    if (!sourceMatches) continue;
    let conditions: MileageRuleConditions = {};
    if (rule.conditions) {
      try { conditions = JSON.parse(rule.conditions) as MileageRuleConditions; } catch { conditions = {}; }
    }
    const adjustedAmount = conditions.ignoreMultiplier
      ? Number(rule.amount)
      : Math.max(1, Math.round((Number(rule.amount) * multiplier.bps) / 10000));
    amounts.set(rule.event_type, (amounts.get(rule.event_type) ?? 0) + adjustedAmount);
  }
  const opportunities: Array<MileageEarningOpportunity & { secondsToNext: number }> = [];

  const friendAddReward = amounts.get('friend_registered') ?? 0;
  if (friendAddReward > 0) {
    for (const account of accountsResult.results) {
      const completed = Boolean(account.is_registered);
      const creditedMiles = Number(account.credited_miles ?? 0);
      const pendingMiles = Number(account.pending_miles ?? 0);
      const mileageStatus = !completed
        ? undefined
        : creditedMiles > 0
          ? 'credited'
          : pendingMiles > 0
            ? 'pending'
            : 'waiting';
      const description = !completed
        ? `友だち追加で +${friendAddReward} mile。追加後は4アカウント分のマイルを合算できます`
        : mileageStatus === 'credited'
          ? `友だち登録済み・+${creditedMiles} mile 加算済み`
          : mileageStatus === 'pending'
            ? `友だち登録済み・+${pendingMiles} mile 確定待ち`
            : '友だち登録済み・マイルは定期集計で反映されます';
      opportunities.push({
        id: `friend-add:${account.id}`,
        type: 'friend_add',
        title: completed ? account.name : `${account.name}を友だち追加`,
        description,
        rewardMiles: friendAddReward,
        nextRewardMiles: completed ? 0 : friendAddReward,
        progressPercent: completed ? 100 : 0,
        ctaLabel: completed ? '登録済み' : '友だち追加する',
        url: `https://liff.line.me/${account.liff_id}/?page=affiliate&liffId=${encodeURIComponent(account.liff_id)}`,
        targetAccountId: account.id,
        completed,
        mileageStatus,
        creditedMiles,
        secondsToNext: 0,
      });
    }
  }

  for (const webinar of webinarsResult.results) {
    const duration = Number(webinar.duration_seconds);
    const position = Math.max(0, Math.min(duration, Number(webinar.max_position_seconds)));
    const milestones = [
      ...(duration >= 300 && (amounts.get('webinar_watch_5m') ?? 0) > 0
        ? [{ seconds: 300, amount: amounts.get('webinar_watch_5m')!, label: '5分視聴' }]
        : []),
      ...(duration >= 900 && (amounts.get('webinar_watch_15m') ?? 0) > 0
        ? [{ seconds: 900, amount: amounts.get('webinar_watch_15m')!, label: '15分視聴' }]
        : []),
      ...((amounts.get('webinar_completed') ?? 0) > 0
        ? [{
            seconds: Math.max(1, Math.floor(duration * 0.9)),
            amount: amounts.get('webinar_completed')!,
            label: '90%視聴完了',
          }]
        : []),
    ]
      .filter((milestone) => position < milestone.seconds)
      .sort((a, b) => a.seconds - b.seconds);

    const ctaReward = webinar.has_cta && !webinar.cta_clicked
      ? (amounts.get('webinar_cta_clicked') ?? 0)
      : 0;
    const rewardMiles = milestones.reduce((sum, milestone) => sum + milestone.amount, 0) + ctaReward;
    if (rewardMiles <= 0) continue;

    const next = milestones[0];
    const secondsToNext = next ? Math.max(0, next.seconds - position) : duration;
    const minutesToNext = Math.max(1, Math.ceil(secondsToNext / 60));
    const description = next
      ? position > 0
        ? `続きからあと約${minutesToNext}分で「${next.label}」+${next.amount} mile`
        : `まず${next.label}で +${next.amount} mile`
      : `配信内の案内を確認すると +${ctaReward} mile`;

    opportunities.push({
      id: `webinar:${webinar.id}`,
      type: 'webinar',
      title: webinar.title,
      description,
      rewardMiles,
      nextRewardMiles: next?.amount ?? ctaReward,
      progressPercent: Math.min(100, Math.max(0, Math.round((position / duration) * 100))),
      ctaLabel: position > 0 ? '続きから参加する' : '今すぐ参加する',
      url: `https://liff.line.me/${webinar.liff_id}/?page=webinar&slug=${encodeURIComponent(webinar.slug)}`,
      secondsToNext,
    });
  }

  return opportunities
    .sort((a, b) => a.secondsToNext - b.secondsToNext || b.rewardMiles - a.rewardMiles)
    .slice(0, limit)
    .map(({ secondsToNext: _secondsToNext, ...opportunity }) => opportunity);
}

export interface MileageRuleRow {
  id: string;
  program_id: string;
  name: string;
  event_type: string;
  source: string | null;
  amount: number;
  initial_status: 'pending' | 'available';
  conditions: string | null;
  /**
   * R52: 公開版が持つ対象条件(JSON文字列)。live の `mileage_rules` に列はなく、
   * 公開版から組み立てた行だけが持つ(実行時のみ)。live 読みの行は
   * undefined で、従来どおり条件なしとして付与する。
   */
  target_conditions?: string | null;
  /**
   * m22o: 公開版が持つ期限・取消・通知。target_conditions と同じく
   * 公開版から組み立てた行だけが持つ(実行時のみ)。live 読みの行は
   * undefined で、従来どおり期限なし・取消なし・通知なしとして扱う。
   * 公開版(v1以降)の設定だけを使い、下書きは見ない。
   */
  expires_after_days?: number | null;
  cancellation_event_types?: string[] | null;
  notification?: { enabled: boolean; messageTemplate: string } | null;
  /** 334(#521): 帰属アカウント。NULL は変更不可の既存全店ルール。 */
  line_account_id?: string | null;
  is_active: number;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface MileageRuleConditions {
  /** Maximum rewarded actions for the same identity on one calendar day. */
  dailyCapActions?: number;
  /** Reward an identity only once for the supplied subjectKey (for example, a form). */
  uniquePerSubject?: boolean;
  /** Reward the supplied subjectKey once per identity and calendar day. */
  uniquePerSubjectPerDay?: boolean;
  /** Fixed bonuses such as registration/tenure are not multiplied by a tier. */
  ignoreMultiplier?: boolean;
  /** Send the grant to the person who introduced the actor through an ASP link. */
  beneficiary?: 'actor' | 'referrer';
  /** Reward a referrer only once for each referred person. */
  uniquePerReferredFriend?: boolean;
  /** Reward a referrer once per referred person and subject (for example, webinar). */
  uniquePerReferredFriendPerSubject?: boolean;
}

export async function getMileageRules(
  db: D1Database,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageRuleRow[]> {
  await ensureBuiltInProgram(db, programId);
  const result = await db
    .prepare(
      `SELECT * FROM mileage_rules
        WHERE program_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .bind(programId)
    .all<MileageRuleRow>();
  return result.results;
}

export async function getMileageRuleById(
  db: D1Database,
  id: string,
): Promise<MileageRuleRow | null> {
  return db.prepare(`SELECT * FROM mileage_rules WHERE id = ?`).bind(id).first<MileageRuleRow>();
}

export async function createMileageRule(
  db: D1Database,
  input: {
    name: string;
    eventType: string;
    source?: string | null;
    amount: number;
    initialStatus?: 'pending' | 'available';
    conditions?: MileageRuleConditions | null;
    /** 期間限定のキャンペーン。列も突き合わせも前からあったが、書き込む口が無かった。 */
    validFrom?: string | null;
    validUntil?: string | null;
    /** 334(#521): 帰属アカウント。新規ルールでは必須。 */
    lineAccountId: string;
    /**
     * DRAFT-01: false なら最初のINSERTから停止(is_active=0)。未指定は従来どおり稼働。
     * 「作る→別APIで止める」にすると途中失敗で稼働中のルールが残るため、
     * 停止を指定した作成は1文で止まったまま入れる。
     */
    isActive?: boolean;
  },
): Promise<MileageRuleRow> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  if (!input.lineAccountId.trim()) {
    throw new Error('Mileage rule line account is required');
  }
  await ensureDefaultMileageProgram(db);
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO mileage_rules
         (id, program_id, name, event_type, source, amount, initial_status,
          conditions, line_account_id, is_active, valid_from, valid_until, created_at, updated_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.eventType,
      input.source ?? null,
      input.amount,
      input.initialStatus ?? 'available',
      input.conditions ? JSON.stringify(input.conditions) : null,
      input.lineAccountId,
      input.isActive === false ? 0 : 1,
      input.validFrom ?? null,
      input.validUntil ?? null,
      now,
      now,
    )
    .run();
  const created = await getMileageRuleById(db, id);
  if (!created) throw new Error('Failed to create mileage rule');
  return created;
}

/**
 * N-231 公開版(案1)。受付時点で固定する適用版の集合 {rule_id: version_number}。
 * 0 は未公開(旧口で作ったまま)で、処理時は live を読む。単一IDへ潰さない。
 */
export async function getAccountRuleVersionMap(
  db: D1Database,
  lineAccountId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .prepare(
      `SELECT id, COALESCE(published_version_number, 0) AS version_number
         FROM mileage_rules
        WHERE line_account_id = ?`,
    )
    .bind(lineAccountId)
    .all<{ id: string; version_number: number }>();
  const map: Record<string, number> = {};
  for (const row of rows.results) {
    map[row.id] = Number(row.version_number ?? 0);
  }
  return map;
}

/**
 * queue 行の snapshot を読む。壊れていたら NULL 扱い(=旧来どおり live 読み)にする。
 * 受付の安全は落とさず、処理だけが旧来動作へ退がる。
 */
export function parsePublishedSnapshot(value: string | null | undefined): Record<string, number> | null {
  if (value === null || value === undefined || value === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const map: Record<string, number> = {};
  for (const [key, version] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== 'string' || key === '') return null;
    if (!Number.isInteger(version) || (version as number) < 0) return null;
    map[key] = version as number;
  }
  return map;
}

export async function getPublishedVersionContent(
  db: D1Database,
  ruleId: string,
  versionNumber: number,
): Promise<PublishedEarningRuleContent | null> {
  const row = await db
    .prepare(
      `SELECT content_json FROM mileage_earning_rule_published_versions
        WHERE rule_id = ? AND version_number = ?`,
    )
    .bind(ruleId, versionNumber)
    .first<{ content_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.content_json) as PublishedEarningRuleContent;
  } catch {
    return null;
  }
}

/**
 * 公開版の中身。is_active は含めない。停止・再開は live の稼働で見る。
 * R52: 下書きの対象条件(target_conditions)もここへ載せる。載せないと
 * 公開版だけ条件が消え、対象外の友だちへ付与される。
 * m22o: 期限・取消・通知も同じく公開版へ載せる。載せないと画面の設定が
 * 実際の付与に効かない。content_json は形を持たないので、列を足さずに載る。
 */
export interface PublishedEarningRuleContent {
  name: string;
  event_type: string;
  source: string | null;
  amount: number;
  initial_status: 'pending' | 'available';
  conditions: string | null;
  target_conditions: SegmentCondition | null;
  valid_from: string | null;
  valid_until: string | null;
  /** m22o: 付与したマイルの有効期限(日数)。null は期限なし。 */
  expires_after_days: number | null;
  /** m22o: このきっかけが来たら過去の付与を取り消す。空は取消なし。 */
  cancellation_event_types: string[];
  /** m22o: 付与の後の友だちへの通知。off なら送らない。 */
  notification: { enabled: boolean; messageTemplate: string };
}

export function publishedRuleContentFromDraft(
  draft: {
    name: string;
    eventType: string;
    source: string | null;
    amount: number;
    initialStatus: 'pending' | 'available';
    validFrom: string | null;
    validUntil: string | null;
    /** R52: 下書きの対象条件。そのまま公開版へ載せる(条件なしは null)。 */
    targetConditions?: SegmentCondition | null;
    /** m22o: 下書きの有効期限・取消・通知。そのまま公開版へ載せる。 */
    expiresAfterDays?: number | null;
    cancellationEventTypes?: string[];
    notification?: { enabled: boolean; messageTemplate: string } | null;
  },
  /** 下書きが持たない実行条件は、いまの live を引き継ぐ(消さない)。 */
  currentConditions: string | null,
): PublishedEarningRuleContent {
  const expiresAfterDays = draft.expiresAfterDays ?? null;
  const cancellations = Array.isArray(draft.cancellationEventTypes)
    ? [...new Set(draft.cancellationEventTypes.filter((item) => typeof item === 'string' && item.trim() !== ''))].slice(0, 10)
    : [];
  const notifyEnabled = draft.notification?.enabled === true
    && typeof draft.notification.messageTemplate === 'string'
    && draft.notification.messageTemplate.trim() !== '';
  return {
    name: draft.name,
    event_type: draft.eventType,
    source: draft.source,
    amount: draft.amount,
    initial_status: draft.initialStatus,
    conditions: currentConditions,
    target_conditions: draft.targetConditions ?? null,
    valid_from: draft.validFrom,
    valid_until: draft.validUntil,
    expires_after_days: Number.isInteger(expiresAfterDays) && (expiresAfterDays as number) > 0
      ? expiresAfterDays as number
      : null,
    cancellation_event_types: cancellations,
    notification: {
      enabled: notifyEnabled,
      messageTemplate: notifyEnabled ? (draft.notification as { messageTemplate: string }).messageTemplate : '',
    },
  };
}

/**
 * snapshot で固定された版を1ルール分だけ実行用の行にする。
 * version 0 は「受付時に未公開」。初公開で残した v0 があればそれを使い、
 * 無ければ live を使う(受付から初公開まで live は誰も書き換えられない)。
 * 行が無ければ null(適用しない)。
 * 停止・再開(is_active)はいまの live を見る。公開内容は変えない。
 */
export async function resolvePinnedRuleRow(
  db: D1Database,
  input: { ruleId: string; versionNumber: number },
): Promise<MileageRuleRow | null> {
  const live = await getMileageRuleById(db, input.ruleId);
  if (!live) return null;
  if (input.versionNumber <= 0) {
    const v0 = await getPublishedVersionContent(db, input.ruleId, 0);
    if (!v0) return live;
    return {
      ...live,
      name: v0.name,
      event_type: v0.event_type,
      source: v0.source,
      amount: v0.amount,
      initial_status: v0.initial_status,
      conditions: v0.conditions,
      // R52: 旧公開版の対象条件も引き継ぐ。無ければ null(条件なし)。
      target_conditions: v0.target_conditions ? JSON.stringify(v0.target_conditions) : null,
      valid_from: v0.valid_from,
      valid_until: v0.valid_until,
      // m22o: v0 は公開の仕組みができる前の live 写し。期限・取消・通知は持たない。
      expires_after_days: v0.expires_after_days ?? null,
      cancellation_event_types: v0.cancellation_event_types ?? [],
      notification: v0.notification ?? null,
    };
  }
  const content = await getPublishedVersionContent(db, input.ruleId, input.versionNumber);
  if (!content) return null;
  return {
    ...live,
    name: content.name,
    event_type: content.event_type,
    source: content.source,
    amount: content.amount,
    initial_status: content.initial_status,
    conditions: content.conditions,
    // R52: 公開版の対象条件を実行時の行へ載せる。無ければ null(条件なし)。
    target_conditions: content.target_conditions ? JSON.stringify(content.target_conditions) : null,
    valid_from: content.valid_from,
    valid_until: content.valid_until,
    // m22o: 公開版の期限・取消・通知を実行時の行へ載せる。古い公開版に
    // 項目が無いときは期限なし・取消なし・通知なしとして扱う。
    expires_after_days: content.expires_after_days ?? null,
    cancellation_event_types: content.cancellation_event_types ?? [],
    notification: content.notification ?? null,
  };
}

export async function updateMileageRule(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    eventType: string;
    source: string | null;
    amount: number;
    initialStatus: 'pending' | 'available';
    conditions: MileageRuleConditions | null;
    isActive: boolean;
    validFrom: string | null;
    validUntil: string | null;
  }>,
): Promise<MileageRuleRow | null> {
  if (updates.amount !== undefined && (!Number.isInteger(updates.amount) || updates.amount <= 0)) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.source !== undefined) { sets.push('source = ?'); values.push(updates.source); }
  if (updates.amount !== undefined) { sets.push('amount = ?'); values.push(updates.amount); }
  if (updates.initialStatus !== undefined) { sets.push('initial_status = ?'); values.push(updates.initialStatus); }
  if (updates.conditions !== undefined) {
    sets.push('conditions = ?');
    values.push(updates.conditions ? JSON.stringify(updates.conditions) : null);
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.validFrom !== undefined) { sets.push('valid_from = ?'); values.push(updates.validFrom); }
  if (updates.validUntil !== undefined) { sets.push('valid_until = ?'); values.push(updates.validUntil); }
  if (sets.length === 0) return getMileageRuleById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE mileage_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getMileageRuleById(db, id);
}

/**
 * 決めごとを履歴ごと消さないための原子削除。N-232 用。
 * 台帳(mileage_ledger)に1件でも参照があれば消さない。void の行も数える。
 * SELECTとDELETEを分けると、その間に付与履歴が作られる競合で履歴付き決めごとを
 * 消せるため、DELETE文自体に NOT EXISTS 条件を持たせて1文で実行する。
 * 戻り値は消えた件数。0なら履歴あり・存在しない・同時削除のいずれかで、呼び出し側は安全拒否する。
 */
export async function deleteMileageRule(db: D1Database, id: string): Promise<number> {
  /*
   * R296: V6 の決めごとは下書き行が mileage_rules への FK を持つので、
   * 下書きを残したまま本体を消すと外部キー違反で落ちる。先に下書きを消す。
   * 両文に履歴ガードを付けて1トランザクション(batch)で送る——下書きだけ
   * 消えて本体が残ると、一覧に出ないのに付与が動く決めごとになる。
   */
  const [, deleted] = await db.batch([
    db.prepare(
      `DELETE FROM mileage_earning_rule_drafts
        WHERE rule_id = ?
          AND NOT EXISTS (SELECT 1 FROM mileage_ledger WHERE mileage_rule_id = ?)`,
    ).bind(id, id),
    db.prepare(
      `DELETE FROM mileage_rules
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM mileage_ledger WHERE mileage_rule_id = ?)`,
    ).bind(id, id),
  ]);
  return deleted.meta?.changes ?? 0;
}

export interface ApplyMileageRulesInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  /**
   * N-231 案1: 受付時に固定した適用版の集合。null は旧来互換でそのまま live を読む。
   * 空集合 {} は「所属ルールなし」(全店共通のみ)で、旧来の持ち主不明行と同じ結果になる。
   * 版 0 は「受付時に未公開」。後の初公開で残る v0 があれば v0、無ければ live。
   */
  publishedSnapshot?: Record<string, number> | null;
}

interface MileageMultiplier {
  bps: number;
  tagId: string | null;
  tagName: string | null;
}

interface ReferralMileageBeneficiary {
  affiliateId: string;
  refCode: string;
  friendId: string;
  userId: string | null;
}

/**
 * Resolve the affiliate who actually introduced this person.
 *
 * Unlike a purchase attribution window, an introduction is permanent. We use
 * an affiliate touch around the first registration (±1 day covers OAuth where
 * the friend row is created immediately before ref_tracking), search linked
 * LINE-account rows, and exclude self-referrals by canonical users.id.
 */
async function resolveReferralMileageBeneficiary(
  db: D1Database,
  referredFriendId: string,
): Promise<ReferralMileageBeneficiary | null> {
  const row = await db
    .prepare(
      `WITH origin AS (
         SELECT user_id FROM friends WHERE id = ?
       ), referred_friends AS (
         SELECT f.id, f.user_id, f.created_at
           FROM friends f
           LEFT JOIN origin o ON 1 = 1
          WHERE f.id = ? OR (o.user_id IS NOT NULL AND f.user_id = o.user_id)
       )
       SELECT a.id AS affiliate_id, al.ref_code,
              a.friend_id AS referrer_friend_id,
              referrer.user_id AS referrer_user_id
         FROM referred_friends referred
         JOIN ref_tracking rt ON rt.friend_id = referred.id
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
         JOIN affiliates a ON a.id = al.affiliate_id
         JOIN friends referrer ON referrer.id = a.friend_id
        WHERE julianday(rt.created_at) >= julianday(referred.created_at) - 1
          AND julianday(rt.created_at) <= julianday(referred.created_at) + 1
          AND a.friend_id != referred.id
          AND (referred.user_id IS NULL OR referrer.user_id IS NULL
               OR referrer.user_id != referred.user_id)
        ORDER BY julianday(rt.created_at) DESC, rt.id DESC
        LIMIT 1`,
    )
    .bind(referredFriendId, referredFriendId)
    .first<{
      affiliate_id: string;
      ref_code: string;
      referrer_friend_id: string;
      referrer_user_id: string | null;
    }>();
  return row
    ? {
        affiliateId: row.affiliate_id,
        refCode: row.ref_code,
        friendId: row.referrer_friend_id,
        userId: row.referrer_user_id,
      }
    : null;
}

async function resolveMileageMultiplier(
  db: D1Database,
  friendId: string,
  occurredAt: string,
): Promise<MileageMultiplier> {
  const row = await db
    .prepare(
      `WITH identity AS (SELECT user_id FROM friends WHERE id = ?)
       SELECT t.mileage_multiplier_bps AS bps, t.id AS tag_id, t.name AS tag_name
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
         JOIN tags t ON t.id = ft.tag_id
         LEFT JOIN identity i ON 1 = 1
        WHERE t.mileage_multiplier_bps IS NOT NULL
          AND ft.assigned_at <= ?
          AND (f.id = ? OR (i.user_id IS NOT NULL AND f.user_id = i.user_id))
        ORDER BY t.mileage_multiplier_priority DESC, ft.assigned_at DESC, t.id ASC
        LIMIT 1`,
    )
    .bind(friendId, occurredAt, friendId)
    .first<{ bps: number; tag_id: string; tag_name: string }>();
  return row
    ? { bps: Number(row.bps), tagId: row.tag_id, tagName: row.tag_name }
    : { bps: 10000, tagId: null, tagName: null };
}

/**
 * m22o: 公開版の有効期限(日数)から、台帳へ残す有効期限の日時を作る。
 * 台帳の metadata.expiresAt は、使い道の山(mileage_grant_lots)へ
 * expires_at として写る既存の仕組み(275 の trigger)が拾う。
 * 日数が無い・壊れているときは null(期限なし)。
 */
function mileageGrantExpiresAt(occurredAt: string, days: number | null | undefined): string | null {
  if (!Number.isInteger(days) || (days as number) <= 0) return null;
  const base = Date.parse(occurredAt);
  if (Number.isNaN(base)) return null;
  return new Date(base + (days as number) * 86400_000).toISOString();
}

/** m22o: 見本の {balance} に入れる、いま使える残高。m22u R360: 期限切れは数えない。 */
async function getMileageAvailableBalance(
  db: D1Database,
  input: { userId: string | null; friendId: string },
): Promise<number> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'available' THEN amount ELSE 0 END), 0) AS balance
         FROM mileage_ledger
        WHERE program_id = 'default'
          AND ((? IS NOT NULL
                AND (beneficiary_user_id = ?
                     OR beneficiary_friend_id IN (SELECT id FROM friends WHERE user_id = ?)))
               OR (? IS NULL AND beneficiary_friend_id = ?))`,
    )
    .bind(input.userId, input.userId, input.userId, input.userId, input.friendId)
    .first<{ balance: number }>();
  const base = Number(row?.balance ?? 0);
  if (!(await dbTableExists(db, 'mileage_grant_lots'))) return base;
  // 残高の表示(残高照会)と同じく、期限切れロットの残数は使えない分として引く。
  const keys = input.userId
    ? [`user:${input.userId}`, `friend:${input.friendId}`]
    : [`friend:${input.friendId}`];
  const expired = await db.prepare(
    `SELECT COALESCE(SUM(remaining_amount), 0) AS holdback FROM mileage_grant_lots
      WHERE program_id = 'default'
        AND status = 'available' AND remaining_amount > 0
        AND expires_at IS NOT NULL AND expires_at <= ?
        AND beneficiary_key IN (${keys.map(() => '?').join(',')})`,
  ).bind(now, ...keys).first<{ holdback: number }>();
  return base - Number(expired?.holdback ?? 0);
}

/** m22o: 通知の見本の差し込み({awardedMiles}・{balance})を値で埋める。 */
function renderMileageGrantNotification(
  template: string,
  input: { awardedMiles: number; balance: number },
): string {
  return template
    .replace(/\{awardedMiles\}/g, String(input.awardedMiles))
    .replace(/\{balance\}/g, String(input.balance));
}

/**
 * m22o: 付与の後の友だちへの通知を1件だけ予約する。
 * 手動調整の通知(mileage_adjustment_notifications)と同じ表を使う。
 * 表は台帳1行に通知1行(ledger_entry_id が一意)で、送り分けは
 * 台帳の entry_type(grant/adjustment)で見る。同じ付与の再送・
 * キューの再試行では行を増やさず、送り済みなら送り直さない。
 */
async function reserveMileageGrantNotification(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    ledgerEntryId: string;
    idempotencyKey: string;
    message: string;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_adjustment_notifications
         (id, line_account_id, friend_id, ledger_entry_id, idempotency_key, message_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.lineAccountId, input.friendId, input.ledgerEntryId,
      input.idempotencyKey, input.message, now, now,
    )
    .run();
}

/**
 * m22o: ルールで決めた取消の条件で、過去の付与を取り消す。
 * 紹介成果の却下(#978 の取消の台帳)と同じ考え方: まだ取り消していない
 * 付与だけに、負の reversal を1件ずつ残す。同じアカウントの中だけ。
 *
 * 合わせる鍵は「同じルール・同じ人・同じ出どころの番号(source_event_id)」。
 * 別の予約の付与までは消さない。出どころの番号が無い行は特定できないので
 * 触らない。止めたルールでも、止める前の付与の取消は残す。
 */
async function reverseMileageGrantsForCancellation(
  db: D1Database,
  input: {
    friendId: string;
    friendUserId: string | null;
    lineAccountId: string | null;
    eventId: string;
    eventType: string;
    source: string;
    sourceEventId: string | null;
    occurredAt: string;
    pinned: Record<string, number>;
  },
): Promise<number> {
  if (!input.sourceEventId || !input.lineAccountId) return 0;
  let reversed = 0;
  for (const [ruleId, versionNumber] of Object.entries(input.pinned)) {
    const row = await resolvePinnedRuleRow(db, { ruleId, versionNumber });
    if (!row) continue;
    // 同じアカウントのルールだけ。よそのアカウントの付与に触らない。
    if (row.line_account_id !== input.lineAccountId) continue;
    const cancellations = row.cancellation_event_types ?? [];
    if (!cancellations.includes(input.eventType)) continue;
    const targets = await db
      .prepare(
        `SELECT original.*
           FROM mileage_ledger original
           LEFT JOIN mileage_ledger reversal ON reversal.reverses_entry_id = original.id
          WHERE original.program_id = 'default'
            AND original.mileage_rule_id = ?
            AND original.entry_type = 'grant'
            AND original.status = 'available'
            AND original.source_event_id = ?
            AND ((? IS NOT NULL AND original.beneficiary_user_id = ?)
                 OR (? IS NULL AND original.beneficiary_friend_id = ?))
            AND reversal.id IS NULL`,
      )
      .bind(ruleId, input.sourceEventId, input.friendUserId, input.friendUserId, input.friendUserId, input.friendId)
      .all<MileageLedgerEntry>();
    for (const grant of targets.results) {
      await postMileageEntry(db, {
        programId: grant.program_id,
        beneficiaryUserId: grant.beneficiary_user_id,
        beneficiaryFriendId: grant.beneficiary_friend_id,
        engagementEventId: input.eventId,
        mileageRuleId: ruleId,
        entryType: 'reversal',
        status: 'available',
        amount: -grant.amount,
        reason: `${row.name}の取消`,
        source: input.source,
        sourceEventId: input.sourceEventId,
        idempotencyKey: `mileage-rule-reversal:${grant.id}`,
        reversesEntryId: grant.id,
        metadata: { ruleId, eventType: input.eventType, originalEntryId: grant.id },
        occurredAt: input.occurredAt,
      });
      reversed += 1;
    }
  }
  return reversed;
}

/**
 * Normalize one product action and apply every matching mileage rule exactly
 * once. Caps are evaluated against the canonical users.id identity, so a user
 * cannot reset a daily cap merely by switching between LINE accounts.
 */
async function applyMileageRulesImmediately(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<{ event: EngagementEvent; granted: MileageLedgerEntry[] }> {
  const friend = await db
    .prepare(`SELECT id, user_id, line_account_id FROM friends WHERE id = ?`)
    .bind(input.friendId)
    .first<{ id: string; user_id: string | null; line_account_id: string | null }>();
  if (!friend) throw new Error(`Mileage friend not found: ${input.friendId}`);

  const occurredAt = input.occurredAt ?? jstNow();
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.subjectKey ? { subjectKey: input.subjectKey } : {}),
  };
  const event = await recordEngagementEvent(db, {
    idempotencyKey: `${input.source}:${input.eventType}:${input.sourceEventId}`,
    eventType: input.eventType,
    source: input.source,
    sourceEventId: input.sourceEventId,
    actorUserId: friend.user_id,
    actorFriendId: friend.id,
    metadata,
    occurredAt,
  });

  // N-231 案1: snapshot がある行は固定版を、無い行(NULL 互換)は従来どおり live を読む。
  // 全店共通(line_account_id IS NULL)は版を持たないので、どちらの場合も live を読む。
  const pinned = input.publishedSnapshot ?? null;
  let ruleRows: MileageRuleRow[];
  if (pinned === null) {
    const rulesResult = await db
      .prepare(
        `SELECT * FROM mileage_rules
          WHERE program_id = 'default'
            AND event_type = ?
            AND (source IS NULL OR source = ?)
            AND is_active = 1
            AND (line_account_id IS NULL OR line_account_id = ?)
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(input.eventType, input.source, friend.line_account_id, occurredAt, occurredAt)
      .all<MileageRuleRow>();
    ruleRows = rulesResult.results;
  } else {
    const resolved: MileageRuleRow[] = [];
    for (const [ruleId, versionNumber] of Object.entries(pinned)) {
      const row = await resolvePinnedRuleRow(db, { ruleId, versionNumber });
      if (!row) continue;
      if (row.program_id !== 'default') continue;
      if (row.event_type !== input.eventType) continue;
      if (row.source !== null && row.source !== input.source) continue;
      if (row.is_active !== 1) continue;
      // 固定したのは所属ルールだけ。全店共通は下の live 読みで拾う。
      if (row.line_account_id === null) continue;
      if (row.line_account_id !== friend.line_account_id) continue;
      if (row.valid_from !== null && row.valid_from > occurredAt) continue;
      if (row.valid_until !== null && row.valid_until < occurredAt) continue;
      resolved.push(row);
    }
    const globalsResult = await db
      .prepare(
        `SELECT * FROM mileage_rules
          WHERE program_id = 'default'
            AND event_type = ?
            AND (source IS NULL OR source = ?)
            AND is_active = 1
            AND line_account_id IS NULL
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(input.eventType, input.source, occurredAt, occurredAt)
      .all<MileageRuleRow>();
    ruleRows = [...resolved, ...globalsResult.results].sort((a, b) =>
      a.created_at < b.created_at ? -1
      : a.created_at > b.created_at ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  const identityKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  const granted: MileageLedgerEntry[] = [];
  const actorMultiplier = await resolveMileageMultiplier(db, friend.id, occurredAt);
  let referralBeneficiaryPromise: Promise<ReferralMileageBeneficiary | null> | null = null;
  const getReferralBeneficiary = () => {
    referralBeneficiaryPromise ??= resolveReferralMileageBeneficiary(db, friend.id);
    return referralBeneficiaryPromise;
  };

  if (input.eventType === 'tag_added' && input.subjectKey) {
    const tag = await db
      .prepare(
        `SELECT id, name, mileage_reward, referral_mileage_reward FROM tags WHERE id = ?`,
      )
      .bind(input.subjectKey)
      .first<{
        id: string;
        name: string;
        mileage_reward: number;
        referral_mileage_reward: number;
      }>();
    if (tag && Number(tag.mileage_reward) > 0) {
      const tagEntry = await postMileageEntry(db, {
        beneficiaryUserId: friend.user_id,
        beneficiaryFriendId: friend.id,
        engagementEventId: event.id,
        entryType: 'grant',
        status: 'available',
        amount: Number(tag.mileage_reward),
        reason: `タグ「${tag.name}」獲得`,
        source: 'tag',
        sourceEventId: input.sourceEventId,
        idempotencyKey: `tag-reward:identity:${identityKey}:tag:${tag.id}`,
        metadata: { tagId: tag.id, eventType: input.eventType },
        occurredAt,
      });
      granted.push(tagEntry);
    }
    if (tag && Number(tag.referral_mileage_reward) > 0) {
      const referrer = await getReferralBeneficiary();
      if (referrer) {
        const referrerIdentityKey = referrer.userId
          ? `user:${referrer.userId}`
          : `friend:${referrer.friendId}`;
        const referralEntry = await postMileageEntry(db, {
          beneficiaryUserId: referrer.userId,
          beneficiaryFriendId: referrer.friendId,
          engagementEventId: event.id,
          entryType: 'grant',
          status: 'available',
          amount: Number(tag.referral_mileage_reward),
          reason: `紹介した友だちがタグ「${tag.name}」を獲得`,
          source: 'tag_referral',
          sourceEventId: input.sourceEventId,
          idempotencyKey: `tag-referral:referrer:${referrerIdentityKey}:referred:${identityKey}:tag:${tag.id}`,
          metadata: {
            tagId: tag.id,
            eventType: input.eventType,
            beneficiaryType: 'referrer',
            affiliateId: referrer.affiliateId,
            refCode: referrer.refCode,
            referredFriendId: friend.id,
            referredUserId: friend.user_id,
          },
          occurredAt,
        });
        granted.push(referralEntry);
      }
    }
  }

  for (const rule of ruleRows) {
    let conditions: MileageRuleConditions = {};
    if (rule.conditions) {
      try { conditions = JSON.parse(rule.conditions) as MileageRuleConditions; } catch { conditions = {}; }
    }

    /*
     * R52: 公開版の対象条件に合わない友だちには付けない。
     * 条件が壊れて読めないとき・評価で失敗したときも付けない。
     * 「壊れているのに全員へ配る」のがいちばん困るため、閉じる側へ倒す。
     */
    if (rule.target_conditions !== undefined && rule.target_conditions !== null) {
      let eligible = false;
      try {
        const target = parseCondition(rule.target_conditions);
        eligible = target !== null && await matchesCondition(db, friend.id, target);
      } catch {
        eligible = false;
      }
      if (!eligible) continue;
    }

    const referrer = conditions.beneficiary === 'referrer'
      ? await getReferralBeneficiary()
      : null;
    if (conditions.beneficiary === 'referrer' && !referrer) continue;
    const beneficiaryFriendId = referrer?.friendId ?? friend.id;
    const beneficiaryUserId = referrer?.userId ?? friend.user_id;
    const beneficiaryIdentityKey = beneficiaryUserId
      ? `user:${beneficiaryUserId}`
      : `friend:${beneficiaryFriendId}`;
    const multiplier = conditions.beneficiary === 'referrer'
      ? await resolveMileageMultiplier(db, beneficiaryFriendId, occurredAt)
      : actorMultiplier;

    if (conditions.dailyCapActions && conditions.dailyCapActions > 0) {
      const capRow = await db
        .prepare(
          `SELECT COUNT(*) AS action_count
             FROM mileage_ledger ml
            WHERE ml.program_id = ?
              AND ml.mileage_rule_id = ?
              AND ml.entry_type = 'grant'
              AND ml.status != 'void'
              AND substr(ml.occurred_at, 1, 10) = substr(?, 1, 10)
              AND ((? IS NOT NULL AND ml.beneficiary_user_id = ?)
                   OR (? IS NULL AND ml.beneficiary_friend_id = ?))`,
        )
        .bind(
          rule.program_id,
          rule.id,
          occurredAt,
          beneficiaryUserId,
          beneficiaryUserId,
          beneficiaryUserId,
          beneficiaryFriendId,
        )
        .first<{ action_count: number }>();
      if ((capRow?.action_count ?? 0) >= conditions.dailyCapActions) continue;
    }

    const idempotencyKey = conditions.uniquePerReferredFriendPerSubject && input.subjectKey
      ? `rule:${rule.id}:referrer:${beneficiaryIdentityKey}:referred:${identityKey}:subject:${input.subjectKey}`
      : conditions.uniquePerReferredFriend
        ? `rule:${rule.id}:referrer:${beneficiaryIdentityKey}:referred:${identityKey}`
        : conditions.uniquePerSubject && input.subjectKey
          ? `rule:${rule.id}:identity:${beneficiaryIdentityKey}:subject:${input.subjectKey}`
          : conditions.uniquePerSubjectPerDay && input.subjectKey
            ? `rule:${rule.id}:identity:${beneficiaryIdentityKey}:day:${occurredAt.slice(0, 10)}:subject:${input.subjectKey}`
            : `rule:${rule.id}:event:${event.id}`;
    // m22o: 公開版の有効期限を台帳へ残す。使い道の山へ写る既存の仕組みが拾う。
    const expiresAt = mileageGrantExpiresAt(occurredAt, rule.expires_after_days ?? null);
    const entry = await postMileageEntry(db, {
      programId: rule.program_id,
      beneficiaryUserId,
      beneficiaryFriendId,
      engagementEventId: event.id,
      mileageRuleId: rule.id,
      entryType: 'grant',
      status: rule.initial_status,
      amount: conditions.ignoreMultiplier
        ? rule.amount
        : Math.max(1, Math.round((rule.amount * multiplier.bps) / 10000)),
      reason: rule.name,
      source: input.source,
      sourceEventId: input.sourceEventId,
      idempotencyKey,
      metadata: {
        ...metadata,
        ruleId: rule.id,
        eventType: input.eventType,
        baseAmount: rule.amount,
        multiplierBps: multiplier.bps,
        multiplierTagId: multiplier.tagId,
        multiplierTagName: multiplier.tagName,
        beneficiaryType: conditions.beneficiary ?? 'actor',
        ...(expiresAt ? { expiresAt } : {}),
        ...(referrer ? {
          affiliateId: referrer.affiliateId,
          refCode: referrer.refCode,
          referredFriendId: friend.id,
          referredUserId: friend.user_id,
        } : {}),
      },
      occurredAt,
    });
    granted.push(entry);
    /*
     * m22o: 公開版で「通知する」のときだけ、付与の後に友だちへ送る分を
     * 予約する。送るのは Worker の cron。OFF なら予約しない。
     */
    const notify = rule.notification;
    if (notify?.enabled && notify.messageTemplate && friend.line_account_id) {
      const balance = await getMileageAvailableBalance(db, {
        userId: beneficiaryUserId, friendId: beneficiaryFriendId,
      });
      await reserveMileageGrantNotification(db, {
        lineAccountId: friend.line_account_id,
        friendId: beneficiaryFriendId,
        ledgerEntryId: entry.id,
        idempotencyKey: `mileage-rule-grant:${entry.id}`,
        message: renderMileageGrantNotification(notify.messageTemplate, {
          awardedMiles: entry.amount, balance,
        }),
      });
    }
  }
  /*
   * m22o: 取消の条件に合うきっかけが来たら、過去の付与を取り消す。
   * 受付時に固定した公開版だけを見て、下書きは見ない。版を持たない
   * 古い行(NULL 互換)は従来どおり何もしない。既存の付与済みマイルは変えない。
   */
  if (pinned !== null) {
    await reverseMileageGrantsForCancellation(db, {
      friendId: friend.id,
      friendUserId: friend.user_id,
      lineAccountId: friend.line_account_id,
      eventId: event.id,
      eventType: input.eventType,
      source: input.source,
      sourceEventId: event.source_event_id,
      occurredAt,
      pinned,
    });
  }
  return { event, granted };
}

/**
 * Public ingestion path. Product requests only write the normalized action and
 * one small queue row; the scheduled worker projects ledger entries later.
 */
export async function applyMileageRulesForEvent(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<{ event: EngagementEvent; granted: MileageLedgerEntry[]; queued: true }> {
  const event = await enqueueMileageEvent(db, input);
  return { event, granted: [], queued: true };
}

export interface MileageQueueResult {
  claimed: number;
  processed: number;
  failed: number;
  granted: number;
}

/**
 * 付与キューの行の持ち主(=イベントの友だちが属するアカウント)が
 * マイル機能オフかをSQL内で判定する式。持ち主不明の旧行は偽になり、
 * 従来どおり進む。
 */
function mileageOwnerOffSql(eventIdColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM engagement_events ee
      JOIN friends f ON f.id = ee.actor_friend_id
     WHERE ee.id = ${eventIdColumn}
       AND ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
  )`;
}

/** Drain a bounded batch. Safe for retries and overlapping cron invocations. */
export async function processPendingMileageEvents(
  db: D1Database,
  options: { limit?: number; now?: string } = {},
): Promise<MileageQueueResult> {
  const limit = Math.min(250, Math.max(1, options.limit ?? 100));
  const now = options.now ?? jstNow();
  // 停滞回収も機能オフ中のアカウントには当てない。OFF中は status も
  // processing_started_at も updated_at も動かさず、再オンで回収する。
  await db
    .prepare(
      `UPDATE mileage_event_queue
          SET status = 'pending', processing_started_at = NULL, updated_at = ?
        WHERE status = 'processing'
          AND datetime(processing_started_at) < datetime(?, '-10 minutes')
          AND NOT ${mileageOwnerOffSql('mileage_event_queue.engagement_event_id')}`,
    )
    .bind(now, now)
    .run();

  // 機能オフ中の行は LIMIT を数える前に外す。後で弾くと、オフの古い行が
  // 先頭を占めたままON中の他アカウントが永久に回らない。
  const due = await db
    .prepare(
      `SELECT q.engagement_event_id, q.applied_published_snapshot
         FROM mileage_event_queue q
        WHERE q.status IN ('pending','failed')
          AND q.attempts < 5
          AND datetime(q.available_at) <= datetime(?)
          AND NOT ${mileageOwnerOffSql('q.engagement_event_id')}
        ORDER BY q.created_at ASC, q.engagement_event_id ASC
        LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ engagement_event_id: string; applied_published_snapshot: string | null }>();

  const result: MileageQueueResult = { claimed: 0, processed: 0, failed: 0, granted: 0 };
  for (const item of due.results) {
    // 機能オフ中はclaim(状態更新)も付与もしない。pendingのまま残し、
    // 再オンで再開する。持ち主が分からない行は従来どおり進める。
    const owner = await db
      .prepare(
        `SELECT f.line_account_id AS line_account_id
           FROM engagement_events ee LEFT JOIN friends f ON f.id = ee.actor_friend_id
          WHERE ee.id = ?`,
      )
      .bind(item.engagement_event_id)
      .first<{ line_account_id: string | null }>();
    if (owner?.line_account_id
      && !await isAccountFeatureEnabled(db, owner.line_account_id, 'mileage')) {
      continue;
    }
    const claim = await db
      .prepare(
        `UPDATE mileage_event_queue
            SET status = 'processing', attempts = attempts + 1,
                processing_started_at = ?, updated_at = ?, last_error = NULL
          WHERE engagement_event_id = ? AND status IN ('pending','failed')`,
      )
      .bind(now, now, item.engagement_event_id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    result.claimed += 1;

    try {
      const event = await db
        .prepare(`SELECT * FROM engagement_events WHERE id = ?`)
        .bind(item.engagement_event_id)
        .first<EngagementEvent>();
      if (!event?.actor_friend_id || !event.source_event_id) {
        throw new Error('Queued mileage event has no friend or source event');
      }
      let metadata: Record<string, unknown> = {};
      if (event.metadata) {
        try { metadata = JSON.parse(event.metadata) as Record<string, unknown>; } catch { metadata = {}; }
      }
      const projection = await applyMileageRulesImmediately(db, {
        eventType: event.event_type,
        source: event.source,
        sourceEventId: event.source_event_id,
        friendId: event.actor_friend_id,
        subjectKey: typeof metadata.subjectKey === 'string' ? metadata.subjectKey : null,
        metadata,
        occurredAt: event.occurred_at,
        // N-231 案1: 現在版ではなく受付時に固定した版を読む。NULL は旧来互換。
        publishedSnapshot: parsePublishedSnapshot(item.applied_published_snapshot),
      });
      result.granted += projection.granted.length;
      result.processed += 1;
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'processed', processed_at = ?, processing_started_at = NULL,
                  updated_at = ?, last_error = NULL
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, event.id)
        .run();
    } catch (error) {
      result.failed += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'failed', processing_started_at = NULL,
                  available_at = datetime(?, '+' || MIN(attempts * 5, 60) || ' minutes'),
                  updated_at = ?, last_error = ?
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, message, item.engagement_event_id)
        .run();
    }
  }
  return result;
}

const FOLLOWING_MILESTONES = [
  { eventType: 'friend_registered', days: 0, name: '友だち登録' },
  { eventType: 'friend_following_7d', days: 7, name: '継続フォロー7日' },
  { eventType: 'friend_following_30d', days: 30, name: '継続フォロー30日' },
  { eventType: 'friend_following_90d', days: 90, name: '継続フォロー90日' },
  { eventType: 'friend_following_180d', days: 180, name: '継続フォロー180日' },
  { eventType: 'friend_following_365d', days: 365, name: '継続フォロー1年' },
] as const;

export interface FollowingMileageReconcileResult {
  eventsCreated: number;
  queued: number;
}

/**
 * Materialize registration/continuous-follow milestones in bounded chunks.
 * Called on the existing 6-hour cron. Historic accounts are gradually caught
 * up without a full-table write spike; normal queue processing remains 5-minutely.
 * 機能オフ中のアカウントの節目は作らない。再オン後の新しい節目から再開する。
 */
export async function enqueueFollowingMileageMilestones(
  db: D1Database,
  options: { limitPerMilestone?: number; now?: string } = {},
): Promise<FollowingMileageReconcileResult> {
  const limit = Math.min(2000, Math.max(1, options.limitPerMilestone ?? 1000));
  const now = options.now ?? jstNow();
  const totals: FollowingMileageReconcileResult = { eventsCreated: 0, queued: 0 };

  for (const milestone of FOLLOWING_MILESTONES) {
    const anchorSql = milestone.days === 0 ? 'f.first_followed_at' : 'f.current_follow_started_at';
    const earnedAtSql = milestone.days === 0
      ? 'f.first_followed_at'
      : `datetime(f.current_follow_started_at, '+${milestone.days} days')`;
    const eventIdSql = `'loyalty:${milestone.eventType}:' || f.id || ':' || ${anchorSql}`;
    const sourceIdSql = `f.id || ':${milestone.eventType}:' || ${anchorSql}`;
    const eligibilitySql = milestone.days === 0
      ? 'f.first_followed_at IS NOT NULL'
      : `f.current_follow_started_at IS NOT NULL
         AND julianday(?) - julianday(f.current_follow_started_at) >= ${milestone.days}`;
    const insertBinds = milestone.days === 0 ? [now, limit] : [now, now, limit];

    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO engagement_events
           (id, program_id, idempotency_key, event_type, source, source_event_id,
            actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
         SELECT ${eventIdSql}, 'default',
                'line_relationship:${milestone.eventType}:' || ${sourceIdSql},
                '${milestone.eventType}', 'line_relationship', ${sourceIdSql},
                f.user_id, f.id,
                json_object('milestoneDays', ${milestone.days}, 'followStartedAt', ${anchorSql},
                            'subjectKey', ${sourceIdSql}),
                ${earnedAtSql}, ?
           FROM friends f
          WHERE f.is_following = 1
            AND ${eligibilitySql}
            AND NOT ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
            AND NOT EXISTS (
              SELECT 1 FROM engagement_events ee WHERE ee.id = ${eventIdSql}
            )
          ORDER BY ${anchorSql} ASC, f.id ASC
          LIMIT ?`,
      )
      .bind(...insertBinds)
      .run();
    totals.eventsCreated += inserted.meta?.changes ?? 0;

    const queued = await db
      .prepare(
        `INSERT OR IGNORE INTO mileage_event_queue
           (engagement_event_id, status, attempts, available_at,
            applied_published_snapshot, created_at, updated_at)
         SELECT ee.id, 'pending', 0, ?,
                (SELECT json_group_object(r.id, COALESCE(r.published_version_number, 0))
                   FROM friends f2
                   JOIN mileage_rules r ON r.line_account_id = f2.line_account_id
                  WHERE f2.id = ee.actor_friend_id),
                ?, ?
           FROM engagement_events ee
           LEFT JOIN friends f ON f.id = ee.actor_friend_id
          WHERE ee.event_type = ?
            AND ee.source = 'line_relationship'
            AND NOT ${accountFeatureOffExclusionSql('f.line_account_id', 'mileage')}
            AND NOT EXISTS (
              SELECT 1 FROM mileage_event_queue q WHERE q.engagement_event_id = ee.id
            )
          ORDER BY ee.occurred_at ASC, ee.id ASC
          LIMIT ?`,
      )
      .bind(now, now, now, milestone.eventType, limit)
      .run();
    totals.queued += queued.meta?.changes ?? 0;
  }
  return totals;
}

export interface MileageAdminMember {
  identityKey: string;
  primaryFriendId: string;
  displayName: string;
  pictureUrl: string | null;
  accountCount: number;
  accountNames: string[];
  available: number;
  pending: number;
  lifetimeEarned: number;
  actionCount: number;
  messageCount: number;
  linkClickCount: number;
  formCount: number;
  bookingCount: number;
  webinarCount: number;
  instagramCount: number;
  followingDays: number;
  unfollowCount: number;
  referralMiles: number;
  qualityReferralCount: number;
  lastActivityAt: string | null;
}

export interface MileageAdminOverview {
  summary: {
    totalMembers: number;
    totalAvailable: number;
    activeMembers30d: number;
    totalActions: number;
    queuedEvents: number;
  };
  members: MileageAdminMember[];
  pagination: { total: number; limit: number; offset: number };
}

export interface MileageAdminHistoryItem {
  id: string;
  primaryFriendId: string;
  displayName: string;
  pictureUrl: string | null;
  entryType: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  hasSourceEvent: boolean;
  sourceReferenceId: string | null;
  ruleName: string | null;
  mode: 'automatic' | 'manual';
  executedByStaffName: string | null;
  lineAccountName: string;
  /** この記録が属する LINE アカウント（メタに残っていない古い行は null）。 */
  lineAccountId: string | null;
  /** 手動調整につけた友だち通知の状態。通知のない行は null。 */
  notificationStatus: string | null;
  notificationErrorCode: string | null;
  balanceAfter: number;
  occurredAt: string;
}

export interface MileageAdminHistory {
  items: MileageAdminHistoryItem[];
  pagination: { total: number; limit: number; offset: number };
}

/** Aggregate one wallet per canonical user across all connected LINE accounts. */
export async function getMileageAdminOverview(
  db: D1Database,
  options: {
    accountId?: string | null;
    visibleAccountIds?: string[];
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<MileageAdminOverview> {
  await ensureDefaultMileageProgram(db);
  const accountId = options.accountId || null;
  const search = (options.search ?? '').trim();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const visibleAccountIds = accountId
    ? [...new Set([accountId, ...(options.visibleAccountIds ?? [])])]
    : [];
  const visiblePlaceholders = visibleAccountIds.map(() => '?').join(',');
  const walletScopeSql = accountId
    ? `AND (
         bf.line_account_id IN (${visiblePlaceholders})
         OR (
           ml.beneficiary_friend_id IS NULL
           AND ml.beneficiary_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM friends vf
              WHERE vf.user_id = ml.beneficiary_user_id
                AND vf.line_account_id IN (${visiblePlaceholders})
           )
         )
       )`
    : '';
  const activityScopeSql = accountId
    ? `AND af.line_account_id IN (${visiblePlaceholders})`
    : '';

  const ctes = `WITH profiles AS (
    SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END AS identity_key,
           MIN(f.id) AS primary_friend_id,
           COALESCE(MAX(u.display_name), MAX(f.display_name), '名前未設定') AS display_name,
           MAX(f.picture_url) AS picture_url,
           COUNT(DISTINCT f.line_account_id) AS account_count,
           GROUP_CONCAT(DISTINCT COALESCE(la.name, '未設定')) AS account_names,
           MAX(CASE
                 WHEN f.is_following = 1
                  AND f.current_follow_started_at IS NOT NULL
                  AND julianday('now', '+9 hours') > julianday(f.current_follow_started_at)
                 THEN CAST(julianday('now', '+9 hours') - julianday(f.current_follow_started_at) AS INTEGER)
                 ELSE 0
               END) AS following_days,
           SUM(COALESCE(f.unfollow_count, 0)) AS unfollow_count
      FROM friends f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN line_accounts la ON la.id = f.line_account_id
     WHERE (? IS NULL OR f.line_account_id = ?)
     GROUP BY 1
  ), wallet AS (
    SELECT CASE
             WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
             ELSE 'friend:' || ml.beneficiary_friend_id
           END AS identity_key,
           COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available,
           COALESCE(SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END), 0) AS pending,
           COALESCE(SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0 THEN ml.amount ELSE 0 END), 0) AS lifetime_earned,
           COALESCE(SUM(CASE
             WHEN ml.status = 'available'
              AND (ml.source = 'tag_referral'
                   OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
             THEN ml.amount ELSE 0 END), 0) AS referral_miles,
           COUNT(DISTINCT CASE
             WHEN ml.entry_type = 'grant'
              AND (ml.source = 'tag_referral'
                   OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
             THEN COALESCE(json_extract(ml.metadata, '$.referredUserId'),
                           json_extract(ml.metadata, '$.referredFriendId'))
             ELSE NULL END) AS quality_referral_count
      FROM mileage_ledger ml
      LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
      INNER JOIN profiles p ON p.identity_key = CASE
        WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
          THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
        ELSE 'friend:' || ml.beneficiary_friend_id
      END
     WHERE ml.program_id = 'default'
       ${walletScopeSql}
     GROUP BY 1
  ), activity AS (
    SELECT CASE
             WHEN COALESCE(ee.actor_user_id, af.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ee.actor_user_id, af.user_id)
             ELSE 'friend:' || ee.actor_friend_id
           END AS identity_key,
           COUNT(*) AS action_count,
           SUM(CASE WHEN ee.event_type = 'message_received' THEN 1 ELSE 0 END) AS message_count,
           SUM(CASE WHEN ee.event_type = 'link_clicked' THEN 1 ELSE 0 END) AS link_click_count,
           SUM(CASE WHEN ee.event_type = 'form_submitted' THEN 1 ELSE 0 END) AS form_count,
           SUM(CASE WHEN ee.event_type = 'booking_created' THEN 1 ELSE 0 END) AS booking_count,
           SUM(CASE WHEN ee.source = 'webinar' THEN 1 ELSE 0 END) AS webinar_count,
           SUM(CASE WHEN ee.source = 'instagram' THEN 1 ELSE 0 END) AS instagram_count,
           MAX(ee.occurred_at) AS last_activity_at
      FROM engagement_events ee
      LEFT JOIN friends af ON af.id = ee.actor_friend_id
      INNER JOIN profiles p ON p.identity_key = CASE
        WHEN COALESCE(ee.actor_user_id, af.user_id) IS NOT NULL
          THEN 'user:' || COALESCE(ee.actor_user_id, af.user_id)
        ELSE 'friend:' || ee.actor_friend_id
      END
     WHERE ee.program_id = 'default'
       AND ee.actor_friend_id IS NOT NULL
       ${activityScopeSql}
     GROUP BY 1
  )`;
  const scopeBinds = [
    accountId,
    accountId,
    ...(accountId ? [...visibleAccountIds, ...visibleAccountIds, ...visibleAccountIds] : []),
  ];

  const rows = await db
    .prepare(
      `${ctes}
       SELECT p.*, COALESCE(w.available, 0) AS available,
              COALESCE(w.pending, 0) AS pending,
              COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
              COALESCE(w.referral_miles, 0) AS referral_miles,
              COALESCE(w.quality_referral_count, 0) AS quality_referral_count,
              COALESCE(a.action_count, 0) AS action_count,
              COALESCE(a.message_count, 0) AS message_count,
              COALESCE(a.link_click_count, 0) AS link_click_count,
              COALESCE(a.form_count, 0) AS form_count,
              COALESCE(a.booking_count, 0) AS booking_count,
              COALESCE(a.webinar_count, 0) AS webinar_count,
              COALESCE(a.instagram_count, 0) AS instagram_count,
              a.last_activity_at,
              COUNT(*) OVER() AS filtered_count
         FROM profiles p
         LEFT JOIN wallet w ON w.identity_key = p.identity_key
         LEFT JOIN activity a ON a.identity_key = p.identity_key
        WHERE (? = '' OR p.display_name LIKE '%' || ? || '%')
        ORDER BY available DESC, action_count DESC, p.display_name ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(...scopeBinds, search, search, limit, offset)
    .all<{
      identity_key: string;
      primary_friend_id: string;
      display_name: string;
      picture_url: string | null;
      account_count: number;
      account_names: string | null;
      available: number;
      pending: number;
      lifetime_earned: number;
      referral_miles: number;
      quality_referral_count: number;
      action_count: number;
      message_count: number;
      link_click_count: number;
      form_count: number;
      booking_count: number;
      webinar_count: number;
      instagram_count: number;
      following_days: number;
      unfollow_count: number;
      last_activity_at: string | null;
      filtered_count: number;
    }>();

  const summary = await db
    .prepare(
      `${ctes}
       SELECT COUNT(*) AS total_members,
              COALESCE(SUM(COALESCE(w.available, 0)), 0) AS total_available,
              SUM(CASE WHEN datetime(a.last_activity_at) >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS active_members_30d,
              COALESCE(SUM(COALESCE(a.action_count, 0)), 0) AS total_actions
         FROM profiles p
         LEFT JOIN wallet w ON w.identity_key = p.identity_key
         LEFT JOIN activity a ON a.identity_key = p.identity_key`,
    )
    .bind(...scopeBinds)
    .first<{
      total_members: number;
      total_available: number;
      active_members_30d: number;
      total_actions: number;
    }>();
  const queueSummary = await db
    .prepare(
      `${ctes}
       SELECT COUNT(*) AS queued_events
         FROM mileage_event_queue q
         INNER JOIN engagement_events ee ON ee.id = q.engagement_event_id
         LEFT JOIN friends af ON af.id = ee.actor_friend_id
         INNER JOIN profiles p ON p.identity_key = CASE
           WHEN COALESCE(ee.actor_user_id, af.user_id) IS NOT NULL
             THEN 'user:' || COALESCE(ee.actor_user_id, af.user_id)
           ELSE 'friend:' || ee.actor_friend_id
         END
        WHERE q.status IN ('pending','processing','failed')
          AND q.attempts < 5
          ${activityScopeSql}`,
    )
    .bind(...scopeBinds, ...(accountId ? visibleAccountIds : []))
    .first<{ queued_events: number }>();

  return {
    summary: {
      totalMembers: Number(summary?.total_members ?? 0),
      totalAvailable: Number(summary?.total_available ?? 0),
      activeMembers30d: Number(summary?.active_members_30d ?? 0),
      totalActions: Number(summary?.total_actions ?? 0),
      queuedEvents: Number(queueSummary?.queued_events ?? 0),
    },
    members: rows.results.map((row) => ({
      identityKey: row.identity_key,
      primaryFriendId: row.primary_friend_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      accountCount: Number(row.account_count),
      accountNames: row.account_names ? row.account_names.split(',') : [],
      available: Number(row.available),
      pending: Number(row.pending),
      lifetimeEarned: Number(row.lifetime_earned),
      referralMiles: Number(row.referral_miles),
      qualityReferralCount: Number(row.quality_referral_count),
      actionCount: Number(row.action_count),
      messageCount: Number(row.message_count),
      linkClickCount: Number(row.link_click_count),
      formCount: Number(row.form_count),
      bookingCount: Number(row.booking_count),
      webinarCount: Number(row.webinar_count),
      instagramCount: Number(row.instagram_count),
      followingDays: Number(row.following_days),
      unfollowCount: Number(row.unfollow_count),
      lastActivityAt: row.last_activity_at,
    })),
    pagination: {
      total: Number(rows.results[0]?.filtered_count ?? 0),
      limit,
      offset,
    },
  };
}

/**
 * Return the append-only mileage ledger for people visible in one selected
 * LINE account. A verified user can have friends in several LINE accounts;
 * those ledger rows stay one wallet, but the link target always uses a friend
 * from the selected account. Unlinked friends never cross account boundaries.
 */
export async function getMileageAdminHistory(
  db: D1Database,
  options: {
    accountId: string;
    visibleAccountIds?: string[];
    search?: string;
    /**
     * V6R-CX-e: この友だちと同じ人（名寄せした複数アカウント）の履歴だけを返す。
     * 名前で探して100件から拾うと、同名が多いと本人がこぼれた。
     */
    friendId?: string;
    entryType?: MileageEntryType;
    status?: MileageEntryStatus;
    mode?: 'automatic' | 'manual';
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
): Promise<MileageAdminHistory> {
  await ensureDefaultMileageProgram(db);
  const accountId = options.accountId.trim();
  if (!accountId) throw new Error('Mileage history accountId is required');
  const search = (options.search ?? '').trim();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const visibleAccountIds = [...new Set([accountId, ...(options.visibleAccountIds ?? [])])];
  const visiblePlaceholders = visibleAccountIds.map(() => '?').join(',');

  const ctes = `WITH selected_profiles AS (
    SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END AS identity_key,
           MIN(f.id) AS primary_friend_id,
           COALESCE(MAX(u.display_name), MAX(f.display_name), '名前未設定') AS display_name,
           MAX(f.picture_url) AS picture_url,
           MAX(la.name) AS line_account_name
      FROM friends f
      LEFT JOIN users u ON u.id = f.user_id
      JOIN line_accounts la ON la.id = f.line_account_id
     WHERE f.line_account_id = ?
     GROUP BY identity_key
  ), ledger_rows AS (
    SELECT ml.*,
           CASE
             WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
             ELSE 'friend:' || ml.beneficiary_friend_id
           END AS identity_key,
           SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END) OVER (
             PARTITION BY CASE
               WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
                 THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
               ELSE 'friend:' || ml.beneficiary_friend_id END
             ORDER BY ml.occurred_at, ml.created_at, ml.id ROWS UNBOUNDED PRECEDING
           ) AS balance_after
      FROM mileage_ledger ml
      LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
     WHERE ml.program_id = 'default'
       AND (
         bf.line_account_id IN (${visiblePlaceholders})
         OR (
           ml.beneficiary_friend_id IS NULL
           AND ml.beneficiary_user_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM friends vf
              WHERE vf.user_id = ml.beneficiary_user_id
                AND vf.line_account_id IN (${visiblePlaceholders})
           )
         )
       )
  )`;
  const scopeBinds = [accountId, ...visibleAccountIds, ...visibleAccountIds];
  const where = ["(? = '' OR sp.display_name LIKE '%' || ? || '%')"];
  const filters: unknown[] = [search, search];
  if (options.friendId) {
    where.push(`sp.identity_key = (
      SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END
        FROM friends f WHERE f.id = ?
    )`);
    filters.push(options.friendId);
  }
  if (options.entryType) {
    where.push('lr.entry_type = ?');
    filters.push(options.entryType);
  }
  if (options.status) {
    where.push('lr.status = ?');
    filters.push(options.status);
  }
  if (options.mode === 'manual') {
    where.push("(lr.entry_type = 'adjustment' OR lr.source IN ('manual', 'admin_adjustment'))");
  } else if (options.mode === 'automatic') {
    where.push("NOT (lr.entry_type = 'adjustment' OR lr.source IN ('manual', 'admin_adjustment'))");
  }
  if (options.from) {
    where.push("date(lr.occurred_at, '+9 hours') >= date(?)");
    filters.push(options.from);
  }
  if (options.to) {
    where.push("date(lr.occurred_at, '+9 hours') <= date(?)");
    filters.push(options.to);
  }
  const whereSql = where.join(' AND ');

  const [rows, count] = await Promise.all([
    db
      .prepare(
        `${ctes}
         SELECT lr.id, sp.primary_friend_id, sp.display_name, sp.picture_url, sp.line_account_name,
                lr.entry_type, lr.status, lr.amount, lr.reason, lr.source,
                lr.source_event_id, mr.name AS rule_name,
                json_extract(lr.metadata, '$.sourceReferenceId') AS source_reference_id,
                json_extract(lr.metadata, '$.executedByStaffName') AS executed_by_staff_name,
                json_extract(lr.metadata, '$.lineAccountId') AS line_account_id,
                an.status AS notification_status,
                an.error_code AS notification_error_code,
                lr.occurred_at, lr.balance_after
           FROM ledger_rows lr
           INNER JOIN selected_profiles sp ON sp.identity_key = lr.identity_key
           LEFT JOIN mileage_rules mr ON mr.id = lr.mileage_rule_id
           LEFT JOIN mileage_adjustment_notifications an ON an.ledger_entry_id = lr.id
          WHERE ${whereSql}
          ORDER BY lr.occurred_at DESC, lr.created_at DESC, lr.id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(...scopeBinds, ...filters, limit, offset)
      .all<{
        id: string;
        primary_friend_id: string;
        display_name: string;
        picture_url: string | null;
        entry_type: MileageEntryType;
        status: MileageEntryStatus;
        amount: number;
        reason: string;
        source: string;
        source_event_id: string | null;
        source_reference_id: string | null;
        rule_name: string | null;
        executed_by_staff_name: string | null;
        line_account_id: string | null;
        notification_status: string | null;
        notification_error_code: string | null;
        occurred_at: string;
        line_account_name: string;
        balance_after: number;
      }>(),
    db
      .prepare(
        `${ctes}
         SELECT COUNT(*) AS total
           FROM ledger_rows lr
           INNER JOIN selected_profiles sp ON sp.identity_key = lr.identity_key
          WHERE ${whereSql}`,
      )
      .bind(...scopeBinds, ...filters)
      .first<{ total: number }>(),
  ]);

  return {
    items: rows.results.map((row) => ({
      id: row.id,
      primaryFriendId: row.primary_friend_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      entryType: row.entry_type,
      status: row.status,
      amount: Number(row.amount),
      reason: row.reason,
      source: row.source,
      hasSourceEvent: Boolean(row.source_event_id),
      sourceReferenceId: row.source_reference_id,
      ruleName: row.rule_name,
      mode: row.entry_type === 'adjustment' || row.source === 'manual' || row.source === 'admin_adjustment'
        ? 'manual'
        : 'automatic',
      executedByStaffName: row.executed_by_staff_name,
      lineAccountName: row.line_account_name,
      lineAccountId: row.line_account_id,
      notificationStatus: row.notification_status,
      notificationErrorCode: row.notification_error_code,
      balanceAfter: Number(row.balance_after ?? 0),
      occurredAt: row.occurred_at,
    })),
    pagination: { total: Number(count?.total ?? 0), limit, offset },
  };
}

interface AffiliateConversionMileageContext {
  event_id: string;
  approval_status: 'approved' | 'rejected';
  approved_at: string | null;
  created_at: string;
  subject_friend_id: string;
  subject_user_id: string | null;
  beneficiary_friend_id: string | null;
  beneficiary_user_id: string | null;
  beneficiary_line_account_id: string | null;
  offer_id: string | null;
  offer_name: string | null;
  reward_miles: number | null;
  /** m22u R356: 承認時に凍結したマイル数。NULL の行は従来どおり現在値。 */
  frozen_miles: number | null;
  mileage_program_id: string | null;
}

/**
 * Project one ASP approval decision into the generic mileage foundation.
 * Repeated calls are safe. Rejection appends compensating entries instead of
 * deleting or editing the original grants, preserving a complete audit trail.
 */
export async function syncAffiliateConversionMileage(
  db: D1Database,
  eventId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  // 付けた時点の版があれば、その版の決まりを優先する(#823)。
  // 版の表が無い古いスキーマでは、従来どおり今の案件の値を使う。
  const hasVersionTables = (await dbTableExists(db, 'affiliate_offer_versions'))
    && (await dbTableExists(db, 'affiliate_attribution_decisions'));
  const milesSelect = hasVersionTables
    ? 'COALESCE(ov.reward_miles, off.reward_miles) AS reward_miles'
    : 'off.reward_miles AS reward_miles';
  const versionJoins = hasVersionTables
    ? `LEFT JOIN affiliate_attribution_decisions dad
           ON dad.conversion_event_id = ce.id
         LEFT JOIN affiliate_offer_versions ov ON ov.id = dad.offer_version_id`
    : '';
  const context = await db
    .prepare(
      `SELECT ce.id AS event_id,
              ce.approval_status,
              ce.approved_at,
              ce.created_at,
              ce.approval_reward_miles AS frozen_miles,
              ce.friend_id AS subject_friend_id,
              subject.user_id AS subject_user_id,
              a.friend_id AS beneficiary_friend_id,
              beneficiary.user_id AS beneficiary_user_id,
              beneficiary.line_account_id AS beneficiary_line_account_id,
              off.id AS offer_id,
              off.name AS offer_name,
              ${milesSelect},
              off.mileage_program_id
         FROM conversion_events ce
         JOIN affiliates a ON a.id = ce.affiliate_id
         LEFT JOIN friends subject ON subject.id = ce.friend_id
         LEFT JOIN friends beneficiary ON beneficiary.id = a.friend_id
         LEFT JOIN affiliate_links al
           ON al.ref_code = ce.attributed_ref_code
          AND al.affiliate_id = ce.affiliate_id
         LEFT JOIN affiliate_offers off ON off.id = al.offer_id
         ${versionJoins}
        WHERE ce.id = ? AND ce.affiliate_id IS NOT NULL`,
    )
    .bind(eventId)
    .first<AffiliateConversionMileageContext>();

  if (!context) throw new Error(`Attributed conversion event not found: ${eventId}`);
  if (context.approval_status !== status) {
    throw new Error(`Conversion approval status changed while syncing mileage: ${eventId}`);
  }

  const programId = context.mileage_program_id ?? DEFAULT_MILEAGE_PROGRAM_ID;
  const decisionVersion = context.approved_at ?? `legacy-${status}`;
  const occurredAt = context.approved_at ?? context.created_at;
  const event = await recordEngagementEvent(db, {
    programId,
    idempotencyKey: `affiliate-conversion:${eventId}:${status}:${decisionVersion}`,
    eventType: status === 'approved' ? 'affiliate_conversion_approved' : 'affiliate_conversion_rejected',
    source: 'affiliate_conversion',
    sourceEventId: eventId,
    actorUserId: context.beneficiary_user_id,
    actorFriendId: context.beneficiary_friend_id,
    subjectUserId: context.subject_user_id,
    subjectFriendId: context.subject_friend_id,
    metadata: { offerId: context.offer_id, offerName: context.offer_name },
    occurredAt,
  });

  // N-238: 承認された紹介成果は「たまる決めごと」のきっかけとしても選べるよう、
  // 共通イベントキューへも乗せる。行動した側（受益者=紹介者）へルールが効く。
  // sourceEventId に決定版を含めるのは、却下→再承認を別の出来事として
  // 再度ルールに通すため（初回承認のイベントへ冪等吸収されないようにする）。
  // 成果の受益者が友だちとして解決できないイベントは、付与の相手がいないため
  // キューへ入れない。
  if (status === 'approved' && context.beneficiary_friend_id) {
    await enqueueMileageEvent(db, {
      eventType: 'affiliate_conversion_approved',
      source: 'affiliate_conversion',
      sourceEventId: `${eventId}:${decisionVersion}`,
      friendId: context.beneficiary_friend_id,
      subjectKey: eventId,
      metadata: {
        offerId: context.offer_id,
        offerName: context.offer_name,
        conversionEventId: eventId,
        decisionVersion,
      },
      occurredAt,
    });
  }

  if (status === 'approved') {
    // m22u R356: 承認時に凍結したマイル数があれば、変更後の案件設定ではなく
    // 凍結値を使う。0 の凍結も有効（0 のまま完了し、後日の再送で増えない）。
    const rewardMiles = context.frozen_miles ?? context.reward_miles ?? 0;
    if (rewardMiles <= 0) return;
    await postMileageEntry(db, {
      programId,
      beneficiaryUserId: context.beneficiary_user_id,
      beneficiaryFriendId: context.beneficiary_friend_id,
      engagementEventId: event.id,
      entryType: 'grant',
      status: 'available',
      amount: rewardMiles,
      reason: context.offer_name
        ? `${context.offer_name}の紹介成果承認`
        : '紹介成果承認',
      source: 'affiliate_conversion',
      sourceEventId: eventId,
      idempotencyKey: `affiliate-conversion-grant:${eventId}:${decisionVersion}`,
      metadata: { offerId: context.offer_id, offerName: context.offer_name },
      occurredAt,
    });
    return;
  }

  const grants = await db
    .prepare(
      `SELECT original.*
         FROM mileage_ledger original
         LEFT JOIN mileage_ledger reversal ON reversal.reverses_entry_id = original.id
        WHERE original.program_id = ?
          AND original.source = 'affiliate_conversion'
          AND original.source_event_id = ?
          AND original.entry_type = 'grant'
          AND original.status = 'available'
          AND reversal.id IS NULL`,
    )
    .bind(programId, eventId)
    .all<MileageLedgerEntry>();

  for (const grant of grants.results) {
    await postMileageEntry(db, {
      programId,
      beneficiaryUserId: grant.beneficiary_user_id,
      beneficiaryFriendId: grant.beneficiary_friend_id,
      engagementEventId: event.id,
      entryType: 'reversal',
      status: 'available',
      amount: -grant.amount,
      reason: '紹介成果の却下による取消',
      source: 'affiliate_conversion',
      sourceEventId: eventId,
      idempotencyKey: `affiliate-conversion-reversal:${grant.id}`,
      reversesEntryId: grant.id,
      metadata: { originalEntryId: grant.id },
      occurredAt,
    });
    // m22u R359: 取り消した付与の未使用分を交換対象から外す。交換の内訳は
    // ロットから選ぶため、台帳の取消だけでは取消済みロットが使われてしまう。
    // 使い切った分は交換側の予約が残り、未使用分だけを無効化する。
    // 再送では取消済みのため grants に載らず、ここも再実行されない。
    if (await dbTableExists(db, 'mileage_grant_lots')) {
      await db.prepare(
        `UPDATE mileage_grant_lots
            SET remaining_amount = 0, status = 'void'
          WHERE ledger_entry_id = ? AND status = 'available'`,
      ).bind(grant.id).run();
    }
  }
}
