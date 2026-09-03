// 共通基盤 §6-2: 外部APIは初回後に1分・5分・30分の最大3回だけ再試行する。
const DELIVERY_RETRY_DELAYS_MINUTES = [1, 5, 30] as const;

/** 完了した試行回数から、次の共通再試行時刻を返す。打ち切り後は null。 */
export function nextDeliveryRetryAt(now: Date, completedAttemptCount: number): Date | null {
  const delayMinutes = DELIVERY_RETRY_DELAYS_MINUTES[completedAttemptCount - 1];
  if (delayMinutes === undefined) return null;
  return new Date(now.getTime() + delayMinutes * 60_000);
}
