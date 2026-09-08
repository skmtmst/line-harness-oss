export interface AffiliatePaymentSummary {
  affiliateId: string;
  affiliateName: string;
  code: string;
  holdDays: number | null;
  payoutCycle: string | null;
  approvedConversions: number;
  approvedReward: number;
  heldConversions: number;
  heldReward: number;
  holdStatusUnknown: number;
  unsettledConversions: number;
  unsettledReward: number;
  settledConversions: number;
  settledReward: number;
}

/**
 * 選択中のLINE公式アカウントについて、支払い画面で安全に表示できる範囲だけを集計する。
 *
 * 承認済み全体、保留中、支払い確定前、確定済みを分けて返す。
 * 金額はすべて承認時の計算版(affiliate_reward_calculations)を正本にし、
 * 現在の率・売上・固定額では再計算しない。版が無い行は0として扱い、
 * 約束できない金額を盛らない。確定後の設定編集で表示が変わらない。
 */
export async function getAffiliatePaymentSummaries(
  db: D1Database,
  lineAccountId: string,
  tenantId: string,
  now = new Date().toISOString(),
): Promise<AffiliatePaymentSummary[]> {
  const result = await db.prepare(
    `WITH scoped_affiliate_ids AS (
       SELECT id
         FROM affiliates
        WHERE line_account_id = ? AND tenant_id = ?
     )
     SELECT
       a.id AS affiliate_id,
       a.name AS affiliate_name,
       a.code,
       a.hold_days,
       a.payout_cycle,
       COUNT(ce.id) AS approved_conversions,
       COALESCE(SUM(
         CASE
           WHEN ce.id IS NULL THEN 0
           ELSE COALESCE(snap.amount_minor, 0)
         END
       ), 0) AS approved_reward,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0
            AND ce.approved_at IS NOT NULL
            AND julianday(ce.approved_at) > julianday(?, '-' || a.hold_days || ' days')
           THEN 1 ELSE 0
         END
       ), 0) AS held_conversions,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0
            AND ce.approved_at IS NOT NULL
            AND julianday(ce.approved_at) > julianday(?, '-' || a.hold_days || ' days')
           THEN COALESCE(snap.amount_minor, 0)
           ELSE 0
         END
       ), 0) AS held_reward,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0 AND ce.id IS NOT NULL AND ce.approved_at IS NULL
           THEN 1 ELSE 0
         END
       ), 0) AS hold_status_unknown
       , COALESCE(SUM(
         CASE WHEN ce.id IS NOT NULL
          AND ce.approved_at IS NOT NULL
          AND (
            COALESCE(a.hold_days, 0) = 0
            OR julianday(ce.approved_at) <= julianday(?, '-' || a.hold_days || ' days')
          )
          AND NOT EXISTS (
           SELECT 1 FROM affiliate_reward_entries re
            WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
         ) THEN 1 ELSE 0 END
       ), 0) AS unsettled_conversions
       , COALESCE(SUM(
         CASE WHEN ce.id IS NOT NULL
          AND ce.approved_at IS NOT NULL
          AND (
            COALESCE(a.hold_days, 0) = 0
            OR julianday(ce.approved_at) <= julianday(?, '-' || a.hold_days || ' days')
          )
          AND NOT EXISTS (
           SELECT 1 FROM affiliate_reward_entries re
            WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
         ) THEN COALESCE(snap.amount_minor, 0) ELSE 0 END
       ), 0) AS unsettled_reward
       , COUNT(re.conversion_event_id) AS settled_conversions
       , COALESCE(SUM(re.amount_minor), 0) AS settled_reward
     FROM affiliates a
     JOIN scoped_affiliate_ids scoped ON scoped.id = a.id
     LEFT JOIN conversion_events ce
       ON (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
      AND COALESCE(ce.approval_status, 'pending') = 'approved'
      AND EXISTS (
        SELECT 1 FROM friends cf
         WHERE cf.id = ce.friend_id AND cf.line_account_id = ?
      )
      AND EXISTS (
        SELECT 1 FROM conversion_points csp
         WHERE csp.id = ce.conversion_point_id AND csp.line_account_id = ?
      )
     LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
     LEFT JOIN affiliate_links al
       ON al.ref_code = ce.attributed_ref_code
      AND al.affiliate_id = a.id
      AND al.line_account_id = ?
     LEFT JOIN affiliate_offers off
       ON off.id = al.offer_id
      AND off.line_account_id = ?
     LEFT JOIN affiliate_reward_entries re
       ON re.conversion_event_id = ce.id
      AND re.entry_type = 'credit'
      AND re.affiliate_id = a.id
      AND re.line_account_id = ?
     -- 承認/保留/未確定の金額は現在値で再計算せず、承認時の版を正本にする。
     -- 版が無い行は0(約束できない金額は盛らない)。
     LEFT JOIN affiliate_reward_calculations snap
       ON snap.conversion_event_id = ce.id
      AND snap.formula IN ('rate', 'fixed', 'legacy')
     GROUP BY a.id, a.name, a.code, a.hold_days, a.payout_cycle, a.commission_rate
     ORDER BY approved_reward DESC, a.name ASC`,
  ).bind(
    lineAccountId,
    tenantId,
    now,
    now,
    now,
    now,
    lineAccountId,
    lineAccountId,
    lineAccountId,
    lineAccountId,
    lineAccountId,
  ).all<{
    affiliate_id: string;
    affiliate_name: string;
    code: string;
    hold_days: number | null;
    payout_cycle: string | null;
    approved_conversions: number;
    approved_reward: number;
    held_conversions: number;
    held_reward: number;
    hold_status_unknown: number;
    unsettled_conversions: number;
    unsettled_reward: number;
    settled_conversions: number;
    settled_reward: number;
  }>();

  return result.results.map((row) => ({
    affiliateId: row.affiliate_id,
    affiliateName: row.affiliate_name,
    code: row.code,
    holdDays: row.hold_days,
    payoutCycle: row.payout_cycle,
    approvedConversions: Number(row.approved_conversions),
    approvedReward: Math.round(Number(row.approved_reward)),
    heldConversions: Number(row.held_conversions),
    heldReward: Math.round(Number(row.held_reward)),
    holdStatusUnknown: Number(row.hold_status_unknown),
    unsettledConversions: Number(row.unsettled_conversions),
    unsettledReward: Math.round(Number(row.unsettled_reward)),
    settledConversions: Number(row.settled_conversions),
    settledReward: Math.round(Number(row.settled_reward)),
  }));
}
