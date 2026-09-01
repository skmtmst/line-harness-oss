interface AffiliateRewardInput {
  /** Percentage points, for example 10 means 10%. Zero means offer-fixed payout. */
  commissionRate: number
  totalRevenue: number
  confirmedFixedReward: number
}

/**
 * V6 has two mutually exclusive payout modes.
 *
 * A positive commission rate means percentage payout. Otherwise, the fixed
 * reward already calculated from approved conversions and offer reward amounts
 * is authoritative. Keeping this decision in one helper prevents fixed-reward
 * affiliates from appearing as ¥0 merely because their percentage is 0%.
 */
export function calculateAffiliateReward({
  commissionRate,
  totalRevenue,
  confirmedFixedReward,
}: AffiliateRewardInput): number {
  if (commissionRate > 0) {
    return (totalRevenue * commissionRate) / 100
  }
  return confirmedFixedReward
}
