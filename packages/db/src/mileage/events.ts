import { dbTableExists, jstNow } from '../utils.js';
import { type RecordEngagementEventInput, type EngagementEvent, type EnqueueMileageEventInput, type PostMileageEntryInput, type MileageLedgerEntry } from './types.js';
import { DEFAULT_MILEAGE_PROGRAM_ID, ensureBuiltInProgram, getAccountRuleVersionMap } from './program.js';


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
  const statement = db.prepare(
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
    );
  if (input.voidReversedGrantLot && input.reversesEntryId && input.entryType === 'reversal' && input.amount < 0
    && await dbTableExists(db, 'mileage_grant_lots')) {
    await db.batch([statement, db.prepare(
      `UPDATE mileage_grant_lots SET remaining_amount = 0, status = 'void'
        WHERE ledger_entry_id = ? AND status = 'available'
          AND EXISTS (SELECT 1 FROM mileage_ledger
            WHERE program_id = ? AND idempotency_key = ? AND reverses_entry_id = ?)`
    ).bind(input.reversesEntryId, programId, input.idempotencyKey, input.reversesEntryId)]);
  } else {
    await statement.run();
  }


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
