import { dbTableExists, jstNow } from '../utils.js';
import { type ReferralMileageBeneficiary, type MileageLedgerEntry } from './types.js';
import { resolvePinnedRuleRow } from './rules.js';
import { postMileageEntry } from './events.js';



/**
 * Resolve the affiliate who actually introduced this person.
 *
 * Unlike a purchase attribution window, an introduction is permanent. We use
 * an affiliate touch around the first registration (±1 day covers OAuth where
 * the friend row is created immediately before ref_tracking), search linked
 * LINE-account rows, and exclude self-referrals by canonical users.id.
 */
export async function resolveReferralMileageBeneficiary(
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



/**
 * m22o: 公開版の有効期限(日数)から、台帳へ残す有効期限の日時を作る。
 * 台帳の metadata.expiresAt は、使い道の山(mileage_grant_lots)へ
 * expires_at として写る既存の仕組み(275 の trigger)が拾う。
 * 日数が無い・壊れているときは null(期限なし)。
 */
export function mileageGrantExpiresAt(occurredAt: string, days: number | null | undefined): string | null {
  if (!Number.isInteger(days) || (days as number) <= 0) return null;
  const base = Date.parse(occurredAt);
  if (Number.isNaN(base)) return null;
  return new Date(base + (days as number) * 86400_000).toISOString();
}

/** m22o: 見本の {balance} に入れる、いま使える残高。m22u R360: 期限切れは数えない。 */
export async function getMileageAvailableBalance(
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
export function renderMileageGrantNotification(
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
export async function reserveMileageGrantNotification(
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
export async function reverseMileageGrantsForCancellation(
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
            AND (reversal.id IS NULL OR reversal.idempotency_key = 'mileage-rule-reversal:' || original.id)
`,
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
        voidReversedGrantLot: true,
        metadata: { ruleId, eventType: input.eventType, originalEntryId: grant.id },
        occurredAt: input.occurredAt,
      });
      reversed += 1;
    }
  }
  return reversed;
}
