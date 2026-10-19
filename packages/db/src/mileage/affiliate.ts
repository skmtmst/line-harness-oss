import { dbTableExists } from '../utils.js';
import { type AffiliateConversionMileageContext, type MileageLedgerEntry } from './types.js';
import { DEFAULT_MILEAGE_PROGRAM_ID } from './program.js';
import { recordEngagementEvent, enqueueMileageEvent, postMileageEntry } from './events.js';


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
