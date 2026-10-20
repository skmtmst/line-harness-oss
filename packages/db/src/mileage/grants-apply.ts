import { resolveRankMileageMultiplier, resolveMileageMultiplier } from './multiplier.js';
import { matchesCondition, parseCondition } from '../segment-conditions.js';
import { jstNow } from '../utils.js';
import { type ReferralMileageBeneficiary, type MileageLedgerEntry, type ApplyMileageRulesInput, type EngagementEvent, type MileageRuleRow, type MileageRuleConditions } from './types.js';
import { resolvePinnedRuleRow } from './rules.js';
import { postMileageEntry, recordEngagementEvent, enqueueMileageEvent } from './events.js';
import { resolveReferralMileageBeneficiary, mileageGrantExpiresAt, getMileageAvailableBalance, reserveMileageGrantNotification, renderMileageGrantNotification, reverseMileageGrantsForCancellation } from './grants-beneficiaries.js';


/**
 * Normalize one product action and apply every matching mileage rule exactly
 * once. Caps are evaluated against the canonical users.id identity, so a user
 * cannot reset a daily cap merely by switching between LINE accounts.
 */
export async function applyMileageRulesImmediately(
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
      const rank=await resolveRankMileageMultiplier(db,friend.id,occurredAt),rankBps=Math.round((rank?.mile_multiplier??1)*10000);
      const tagEntry = await postMileageEntry(db, {
        beneficiaryUserId: friend.user_id,
        beneficiaryFriendId: friend.id,
        engagementEventId: event.id,
        entryType: 'grant',
        status: 'available',
        amount: Math.max(1,Math.round(Number(tag.mileage_reward)*rankBps/10000)),
        reason: `タグ「${tag.name}」獲得`,
        source: 'tag',
        sourceEventId: input.sourceEventId,
        idempotencyKey: `tag-reward:identity:${identityKey}:tag:${tag.id}`,
        metadata: { tagId: tag.id, eventType: input.eventType,baseAmount:Number(tag.mileage_reward),multiplierBps:rankBps,multiplierTagId:rank?.tag_id??null },
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
