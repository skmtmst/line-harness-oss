import { postMileageAdjustment } from './mileage.js';
import type { MileageLedgerEntry, MileageRuleRow } from './mileage.js';
import { matchesCondition, parseCondition } from './segment-conditions.js';
import { jstNow } from './utils.js';
import { MileageV6Error, type MileageEarningRuleDraft } from './mileage-admin-v6.js';

/**
 * R: 確定待ちマイルの確定・取消と、高額調整の二者承認、
 * 付与の決めごとの事前テストをまとめる。
 *
 * 台帳(mileage_ledger)は追記専用。確定は status を pending→available に
 * 進めるだけで、取消は逆向きの行を足す。どちらも理由が必須で、再送しても
 * 二重には動かない。
 */

export interface MileageAdjustmentRequestRow {
  id: string;
  line_account_id: string;
  program_id: string;
  friend_id: string;
  direction: 'increase' | 'decrease';
  amount: number;
  reason_category: string;
  reason: string;
  source_reference_id: string | null;
  expires_at: string | null;
  notify_friend: number;
  idempotency_key: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_by_staff_id: string;
  requested_by_staff_name: string;
  decided_by_staff_id: string | null;
  decided_by_staff_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  ledger_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

function requireReason(reason: unknown): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed) {
    throw new MileageV6Error('reason_required', '理由を入力してください', 400, 'reason');
  }
  return trimmed;
}

async function getScopedLedgerEntry(
  db: D1Database,
  entryId: string,
  lineAccountId: string,
): Promise<MileageLedgerEntry | null> {
  return db
    .prepare(
      `SELECT ml.* FROM mileage_ledger ml
         JOIN friends f ON f.id = ml.beneficiary_friend_id
        WHERE ml.id = ? AND f.line_account_id = ?`,
    )
    .bind(entryId, lineAccountId)
    .first<MileageLedgerEntry>();
}

/** 確定待ちの行を利用可能へ進める。確定済みへの再送はそのまま返す。 */
export async function confirmPendingMileageEntry(
  db: D1Database,
  input: {
    entryId: string;
    lineAccountId: string;
    staffId: string;
    staffName: string;
    reason: string;
    occurredAt?: string;
  },
): Promise<{ entry: MileageLedgerEntry; alreadyConfirmed: boolean }> {
  const reason = requireReason(input.reason);
  const now = input.occurredAt ?? jstNow();
  const wrote = await db
    .prepare(
      `UPDATE mileage_ledger
          SET status = 'available',
              metadata = json_set(COALESCE(metadata, '{}'),
                '$.confirmedByStaffId', ?,
                '$.confirmedByStaffName', ?,
                '$.confirmedReason', ?,
                '$.confirmedAt', ?)
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(input.staffId, input.staffName, reason, now, input.entryId)
    .run();
  const entry = await getScopedLedgerEntry(db, input.entryId, input.lineAccountId);
  if (!entry) {
    throw new MileageV6Error('mileage_entry_not_found', 'マイルの記録が見つかりません', 404);
  }
  if (wrote.meta.changes > 0) return { entry, alreadyConfirmed: false };
  if (entry.status === 'available') return { entry, alreadyConfirmed: true };
  throw new MileageV6Error(
    'mileage_entry_invalid_transition',
    '取り消された記録は確定できません',
    409,
  );
}

/**
 * 確定待ちの取消と、利用可能分の取消。
 *
 * - pending: 行自体を void にし、同じ額の逆向きの記録(status=void)を足す。
 *   残高には一度も乗っていないので、記録だけを残す。
 * - available: 元の行は更新・削除せず、逆向きの記録(status=available)を足す。
 *   残高を下回る取消は受け付けない。
 * - void: 再送とみなして既存の逆向き行を返す。
 */
export async function voidMileageLedgerEntry(
  db: D1Database,
  input: {
    entryId: string;
    lineAccountId: string;
    staffId: string;
    staffName: string;
    reason: string;
    occurredAt?: string;
  },
): Promise<{ entry: MileageLedgerEntry; reversalEntryId: string; replayed: boolean }> {
  const reason = requireReason(input.reason);
  const now = input.occurredAt ?? jstNow();
  const entry = await getScopedLedgerEntry(db, input.entryId, input.lineAccountId);
  if (!entry) {
    throw new MileageV6Error('mileage_entry_not_found', 'マイルの記録が見つかりません', 404);
  }

  const idempotencyKey = `void:${entry.id}`;
  const existingReversal = await db
    .prepare(`SELECT id FROM mileage_ledger WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<{ id: string }>();
  if (existingReversal) {
    return { entry, reversalEntryId: existingReversal.id, replayed: true };
  }

  const reversalMetadata = JSON.stringify({
    voidedByStaffId: input.staffId,
    voidedByStaffName: input.staffName,
    voidReason: reason,
    voidedAt: now,
  });
  const reversalId = crypto.randomUUID();

  if (entry.status === 'pending') {
    // 確定待ち: 行を void に進め、履歴として逆向き行(これも void)を足す。
    const marked = await db
      .prepare(
        `UPDATE mileage_ledger
            SET status = 'void',
                metadata = json_set(COALESCE(metadata, '{}'),
                  '$.voidedByStaffId', ?,
                  '$.voidedByStaffName', ?,
                  '$.voidReason', ?,
                  '$.voidedAt', ?)
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(input.staffId, input.staffName, reason, now, entry.id)
      .run();
    if (marked.meta.changes === 0) {
      throw new MileageV6Error(
        'mileage_entry_invalid_transition',
        '記録の状態が変わりました。読み直してください',
        409,
      );
    }
    await db
      .prepare(
        `INSERT OR IGNORE INTO mileage_ledger
           (id, program_id, beneficiary_user_id, beneficiary_friend_id,
            engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
            source_event_id, idempotency_key, reverses_entry_id, metadata,
            occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'reversal', 'void', ?, ?, 'admin_void',
                 NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reversalId,
        entry.program_id,
        entry.beneficiary_user_id,
        entry.beneficiary_friend_id,
        entry.engagement_event_id,
        entry.mileage_rule_id,
        -entry.amount,
        `取消: ${reason}`,
        idempotencyKey,
        entry.id,
        reversalMetadata,
        now,
        now,
      )
      .run();
    return { entry: { ...entry, status: 'void' }, reversalEntryId: reversalId, replayed: false };
  }

  if (entry.status === 'available' && entry.amount > 0) {
    // 利用可能分の取消: 元の行は残し、逆向き行を残高を守りながら足す。
    const write = await db
      .prepare(
        `WITH identity AS (
           SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?
         ), wallet AS (
           SELECT COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available
             FROM mileage_ledger ml
             LEFT JOIN identity ON 1 = 1
            WHERE ml.program_id = ?
              AND (ml.beneficiary_friend_id = (SELECT id FROM identity)
                OR ((SELECT user_id FROM identity) IS NOT NULL
                  AND (ml.beneficiary_user_id = (SELECT user_id FROM identity)
                    OR ml.beneficiary_friend_id IN (
                      SELECT linked.id FROM friends linked
                       WHERE linked.user_id = (SELECT user_id FROM identity)))))
         )
         INSERT INTO mileage_ledger
           (id, program_id, beneficiary_user_id, beneficiary_friend_id,
            engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
            source_event_id, idempotency_key, reverses_entry_id, metadata,
            occurred_at, created_at)
         SELECT ?, ?, identity.user_id, identity.id,
                ?, ?, 'reversal', 'available', ?, ?, 'admin_void',
                NULL, ?, ?,
                json_set(?, '$.balanceBefore', wallet.available,
                            '$.balanceAfter', wallet.available - ?),
                ?, ?
           FROM identity CROSS JOIN wallet
          WHERE wallet.available - ? >= 0
            AND NOT EXISTS (SELECT 1 FROM mileage_ledger WHERE idempotency_key = ?)`,
      )
      .bind(
        entry.beneficiary_friend_id,
        input.lineAccountId,
        entry.program_id,
        reversalId,
        entry.program_id,
        entry.engagement_event_id,
        entry.mileage_rule_id,
        -entry.amount,
        `取消: ${reason}`,
        idempotencyKey,
        entry.id,
        reversalMetadata,
        entry.amount,
        now,
        now,
        entry.amount,
        idempotencyKey,
      )
      .run();
    if (write.meta.changes === 0) {
      const raced = await db
        .prepare(`SELECT id FROM mileage_ledger WHERE idempotency_key = ?`)
        .bind(idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { entry, reversalEntryId: raced.id, replayed: true };
      throw new MileageV6Error(
        'insufficient_balance',
        '利用可能な残高が足りないため取消できません',
        409,
      );
    }
    return { entry, reversalEntryId: reversalId, replayed: false };
  }

  if (entry.status === 'void') {
    return { entry, reversalEntryId: '', replayed: true };
  }
  throw new MileageV6Error(
    'mileage_entry_invalid_transition',
    'この記録は取消できません',
    409,
  );
}

/* ───────── 高額調整の二者承認 ───────── */

export async function createMileageAdjustmentApprovalRequest(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    direction: 'increase' | 'decrease';
    amount: number;
    reasonCategory: string;
    reason: string;
    sourceReferenceId?: string | null;
    expiresAt?: string | null;
    notifyFriend?: boolean;
    idempotencyKey: string;
    staffId: string;
    staffName: string;
  },
): Promise<{ request: MileageAdjustmentRequestRow; replayed: boolean }> {
  const now = jstNow();
  const id = crypto.randomUUID();
  const write = await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_adjustment_approval_requests
         (id, line_account_id, friend_id, direction, amount, reason_category, reason,
          source_reference_id, expires_at, notify_friend, idempotency_key, status,
          requested_by_staff_id, requested_by_staff_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.friendId,
      input.direction,
      input.amount,
      input.reasonCategory,
      input.reason,
      input.sourceReferenceId ?? null,
      input.expiresAt ?? null,
      input.notifyFriend ? 1 : 0,
      input.idempotencyKey,
      input.staffId,
      input.staffName,
      now,
      now,
    )
    .run();
  const request = write.meta.changes > 0
    ? await getMileageAdjustmentApprovalRequest(db, id)
    : await db
        .prepare(
          `SELECT * FROM mileage_adjustment_approval_requests
            WHERE line_account_id = ? AND idempotency_key = ?`,
        )
        .bind(input.lineAccountId, input.idempotencyKey)
        .first<MileageAdjustmentRequestRow>();
  if (!request) {
    throw new MileageV6Error('approval_request_failed', '承認の依頼に失敗しました', 500);
  }
  if (write.meta.changes > 0) {
    await appendApprovalEvent(db, request.id, input.staffId, 'requested', input.reason);
  }
  return { request, replayed: write.meta.changes === 0 };
}

async function appendApprovalEvent(
  db: D1Database,
  requestId: string,
  actorStaffId: string,
  action: 'requested' | 'approved' | 'rejected' | 'cancelled',
  reason: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mileage_adjustment_approval_events
         (id, request_id, actor_staff_id, action, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), requestId, actorStaffId, action, reason, jstNow())
    .run();
}

export async function getMileageAdjustmentApprovalRequest(
  db: D1Database,
  id: string,
): Promise<MileageAdjustmentRequestRow | null> {
  return db
    .prepare(`SELECT * FROM mileage_adjustment_approval_requests WHERE id = ?`)
    .bind(id)
    .first<MileageAdjustmentRequestRow>();
}

export async function listMileageAdjustmentApprovalRequests(
  db: D1Database,
  input: { lineAccountId: string; status?: 'pending' | 'approved' | 'rejected' | 'cancelled' },
): Promise<MileageAdjustmentRequestRow[]> {
  const statusFilter = input.status ? 'AND r.status = ?' : '';
  const params: (string | number)[] = input.status
    ? [input.lineAccountId, input.status]
    : [input.lineAccountId];
  const result = await db
    .prepare(
      `SELECT r.*, f.display_name AS friend_display_name
         FROM mileage_adjustment_approval_requests r
         LEFT JOIN friends f ON f.id = r.friend_id
        WHERE r.line_account_id = ? ${statusFilter}
        ORDER BY r.created_at DESC
        LIMIT 100`,
    )
    .bind(...params)
    .all<MileageAdjustmentRequestRow & { friend_display_name: string | null }>();
  return result.results;
}

async function decideMileageAdjustmentRequest(
  db: D1Database,
  input: {
    requestId: string;
    staffId: string;
    staffName: string;
    action: 'approved' | 'rejected' | 'cancelled';
    decisionReason: string | null;
    /** 承認実行時だけ渡す。台帳への記録ID。 */
    ledgerEntryId?: string | null;
  },
): Promise<MileageAdjustmentRequestRow> {
  const now = jstNow();
  const claimed = await db
    .prepare(
      `UPDATE mileage_adjustment_approval_requests
          SET status = ?, decided_by_staff_id = ?, decided_by_staff_name = ?,
              decided_at = ?, decision_reason = ?, ledger_entry_id = ?,
              updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(
      input.action,
      input.staffId,
      input.staffName,
      now,
      input.decisionReason,
      input.ledgerEntryId ?? null,
      now,
      input.requestId,
    )
    .run();
  const request = await getMileageAdjustmentApprovalRequest(db, input.requestId);
  if (!request) {
    throw new MileageV6Error('approval_request_not_found', '承認の依頼が見つかりません', 404);
  }
  if (claimed.meta.changes === 0) {
    throw new MileageV6Error(
      'approval_request_not_pending',
      'この依頼はすでに処理されています',
      409,
    );
  }
  return request;
}

function assertDifferentApprover(
  request: MileageAdjustmentRequestRow,
  staffId: string,
): void {
  if (request.requested_by_staff_id === staffId) {
    throw new MileageV6Error(
      'approval_self_not_allowed',
      '依頼した人とは別のオーナーが承認してください',
      403,
    );
  }
}

/** 承認して調整を実行する。台帳への記録が先、依頼票の確定が後。 */
export async function approveMileageAdjustmentRequest(
  db: D1Database,
  input: {
    requestId: string;
    lineAccountId: string;
    staffId: string;
    staffName: string;
    decisionReason?: string | null;
  },
): Promise<{ request: MileageAdjustmentRequestRow; entry: MileageLedgerEntry }> {
  const request = await getMileageAdjustmentApprovalRequest(db, input.requestId);
  if (!request || request.line_account_id !== input.lineAccountId) {
    throw new MileageV6Error('approval_request_not_found', '承認の依頼が見つかりません', 404);
  }
  if (request.status !== 'pending') {
    throw new MileageV6Error('approval_request_not_pending', 'この依頼はすでに処理されています', 409);
  }
  assertDifferentApprover(request, input.staffId);

  const signedAmount = request.direction === 'decrease' ? -request.amount : request.amount;
  const result = await postMileageAdjustment(db, {
    friendId: request.friend_id,
    amount: signedAmount,
    reason: request.reason,
    reasonCategory: request.reason_category,
    sourceReferenceId: request.source_reference_id,
    idempotencyKey: request.idempotency_key,
    executedByStaffId: input.staffId,
    executedByStaffName: input.staffName,
    lineAccountId: request.line_account_id,
    expiresAt: request.expires_at,
    notifyFriend: request.notify_friend === 1,
  });

  const decided = await decideMileageAdjustmentRequest(db, {
    requestId: request.id,
    staffId: input.staffId,
    staffName: input.staffName,
    action: 'approved',
    decisionReason: input.decisionReason ?? null,
    ledgerEntryId: result.entry.id,
  });
  await appendApprovalEvent(db, request.id, input.staffId, 'approved', input.decisionReason ?? null);
  return { request: decided, entry: result.entry };
}

export async function rejectMileageAdjustmentRequest(
  db: D1Database,
  input: {
    requestId: string;
    lineAccountId: string;
    staffId: string;
    staffName: string;
    decisionReason?: string | null;
  },
): Promise<MileageAdjustmentRequestRow> {
  const request = await getMileageAdjustmentApprovalRequest(db, input.requestId);
  if (!request || request.line_account_id !== input.lineAccountId) {
    throw new MileageV6Error('approval_request_not_found', '承認の依頼が見つかりません', 404);
  }
  assertDifferentApprover(request, input.staffId);
  const decided = await decideMileageAdjustmentRequest(db, {
    requestId: request.id,
    staffId: input.staffId,
    staffName: input.staffName,
    action: 'rejected',
    decisionReason: input.decisionReason ?? null,
  });
  await appendApprovalEvent(db, request.id, input.staffId, 'rejected', input.decisionReason ?? null);
  return decided;
}

/** 依頼した本人が取り下げる。 */
export async function cancelMileageAdjustmentRequest(
  db: D1Database,
  input: { requestId: string; lineAccountId: string; staffId: string },
): Promise<MileageAdjustmentRequestRow> {
  const request = await getMileageAdjustmentApprovalRequest(db, input.requestId);
  if (!request || request.line_account_id !== input.lineAccountId) {
    throw new MileageV6Error('approval_request_not_found', '承認の依頼が見つかりません', 404);
  }
  if (request.requested_by_staff_id !== input.staffId) {
    throw new MileageV6Error(
      'approval_cancel_not_allowed',
      '依頼した人だけが取り下げられます',
      403,
    );
  }
  const decided = await decideMileageAdjustmentRequest(db, {
    requestId: request.id,
    staffId: input.staffId,
    staffName: request.requested_by_staff_name,
    action: 'cancelled',
    decisionReason: null,
  });
  await appendApprovalEvent(db, request.id, input.staffId, 'cancelled', null);
  return decided;
}

/* ───────── 付与の決めごとの事前テスト ───────── */

export interface MileageRuleTestResult {
  /** 直近30日で条件に合うイベントの件数 */
  matchedEvents: number;
  /** 対象になる友だちの人数（対象条件の絞り込み後） */
  matchedFriends: number;
  /** 付与見込みの合計（倍率は計算に入れず基礎値で見る） */
  estimatedTotalMiles: number;
  /** 1人あたりの最大付与見込み */
  maxPerFriend: number;
  /** 同じきっかけで動いている既存ルールの名前 */
  overlappingRuleNames: string[];
  /** 付与状態（すぐ使える or 確定待ち） */
  initialStatus: 'available' | 'pending';
  /** 失効がある場合の失効日の例 */
  expirationExampleAt: string | null;
}

/**
 * 決めごとの内容を実データに当てはめて見る。台帳・キューには何も書かない。
 * 直近30日のイベントを対象に、何人に・合計いくら付きそうかを返す。
 */
export async function testMileageEarningRuleDraft(
  db: D1Database,
  input: {
    lineAccountId: string;
    draft: MileageEarningRuleDraft;
    now?: string;
  },
): Promise<MileageRuleTestResult> {
  const { draft } = input;
  const now = input.now ?? new Date().toISOString();
  const since = new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1000).toISOString();

  const events = await db
    .prepare(
      `SELECT ee.actor_friend_id AS friend_id, COUNT(*) AS event_count
         FROM engagement_events ee
         JOIN friends f ON f.id = ee.actor_friend_id
        WHERE f.line_account_id = ?
          AND ee.event_type = ?
          AND (? IS NULL OR ee.source = ?)
          AND ee.occurred_at >= ?
          AND ee.occurred_at <= ?
          AND ee.actor_friend_id IS NOT NULL
        GROUP BY ee.actor_friend_id
        LIMIT 500`,
    )
    .bind(input.lineAccountId, draft.eventType, draft.source, draft.source ?? '', since, now)
    .all<{ friend_id: string; event_count: number }>();

  // 対象条件の絞り込みは1人ずつ評価する。上限500人で打ち切り、それを超える
  // 規模でも動作が重くならないようにしている。
  const parsedCondition = draft.targetConditions
    ? parseCondition(JSON.stringify(draft.targetConditions))
    : null;
  let matchedFriends = 0;
  let matchedEvents = 0;
  let maxCount = 0;
  for (const row of events.results) {
    if (parsedCondition) {
      let eligible = false;
      try {
        eligible = await matchesCondition(db, row.friend_id, parsedCondition);
      } catch {
        eligible = false;
      }
      if (!eligible) continue;
    }
    matchedFriends += 1;
    matchedEvents += row.event_count;
    if (row.event_count > maxCount) maxCount = row.event_count;
  }

  const overlapping = await db
    .prepare(
      `SELECT name FROM mileage_rules
        WHERE program_id = 'default'
          AND event_type = ?
          AND is_active = 1
          AND (line_account_id IS NULL OR line_account_id = ?)
        ORDER BY created_at ASC
        LIMIT 20`,
    )
    .bind(draft.eventType, input.lineAccountId)
    .all<{ name: string }>();

  return {
    matchedEvents,
    matchedFriends,
    estimatedTotalMiles: matchedEvents * draft.amount,
    maxPerFriend: maxCount * draft.amount,
    overlappingRuleNames: overlapping.results.map((row) => row.name),
    initialStatus: draft.initialStatus,
    expirationExampleAt: draft.expiresAfterDays
      ? new Date(Date.parse(now) + draft.expiresAfterDays * 24 * 60 * 60 * 1000).toISOString()
      : null,
  };
}
