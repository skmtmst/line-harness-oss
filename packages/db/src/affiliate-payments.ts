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
}

/**
 * 承認済み成果から、支払い画面で安全に表示できる範囲だけを集計する。
 *
 * 支払済み台帳はまだ無いため、ここで返す金額は「未払い」ではなく
 * 「承認済みの合計」である。割合方式は成果地点の金額×紹介者の率、
 * 定額方式は成果に結びついた案件の固定額を使う。
 */
export async function getAffiliatePaymentSummaries(
  db: D1Database,
): Promise<AffiliatePaymentSummary[]> {
  const result = await db.prepare(
    `SELECT
       a.id AS affiliate_id,
       a.name AS affiliate_name,
       a.code,
       a.hold_days,
       a.payout_cycle,
       COUNT(ce.id) AS approved_conversions,
       COALESCE(SUM(
         CASE
           WHEN ce.id IS NULL THEN 0
           WHEN a.commission_rate > 0
             THEN COALESCE(cp.value, 0) * a.commission_rate / 100.0
           ELSE COALESCE(off.reward_amount, 0)
         END
       ), 0) AS approved_reward,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0
            AND ce.approved_at IS NOT NULL
            AND julianday(ce.approved_at) > julianday('now', '-' || a.hold_days || ' days')
           THEN 1 ELSE 0
         END
       ), 0) AS held_conversions,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0
            AND ce.approved_at IS NOT NULL
            AND julianday(ce.approved_at) > julianday('now', '-' || a.hold_days || ' days')
           THEN CASE
             WHEN a.commission_rate > 0
               THEN COALESCE(cp.value, 0) * a.commission_rate / 100.0
             ELSE COALESCE(off.reward_amount, 0)
           END
           ELSE 0
         END
       ), 0) AS held_reward,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(a.hold_days, 0) > 0 AND ce.id IS NOT NULL AND ce.approved_at IS NULL
           THEN 1 ELSE 0
         END
       ), 0) AS hold_status_unknown
     FROM affiliates a
     LEFT JOIN conversion_events ce
       ON (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
      AND COALESCE(ce.approval_status, 'pending') = 'approved'
     LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
     LEFT JOIN affiliate_links al
       ON al.ref_code = ce.attributed_ref_code
      AND al.affiliate_id = a.id
     LEFT JOIN affiliate_offers off ON off.id = al.offer_id
     GROUP BY a.id, a.name, a.code, a.hold_days, a.payout_cycle, a.commission_rate
     ORDER BY approved_reward DESC, a.name ASC`,
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
  }>();

  return result.results.map((row) => ({
    affiliateId: row.affiliate_id,
    affiliateName: row.affiliate_name,
    code: row.code,
    holdDays: row.hold_days,
    payoutCycle: row.payout_cycle,
    approvedConversions: row.approved_conversions,
    approvedReward: Math.round(row.approved_reward),
    heldConversions: row.held_conversions,
    heldReward: Math.round(row.held_reward),
    holdStatusUnknown: row.hold_status_unknown,
  }));
}
