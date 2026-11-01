import { makeupRule } from '../../features/booking/index.js';

/** 欠席実行と同じ現在の設定から、履歴の案内に必要な値だけを返す。 */
export function eventBookingMakeupView(row: Record<string, unknown>, now: number) {
  const { _makeup_rule_json: rawRule, _makeup_starts_at: startsAt, ...booking } = row;
  if (typeof rawRule !== 'string' || typeof startsAt !== 'string') return booking;
  let rule;
  try {
    rule = makeupRule(JSON.parse(rawRule));
  } catch {
    return booking;
  }
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || start < now) return booking;
  const cutoff = new Date(start - rule.cutoffHours * 3_600_000);
  const validUntil = new Date(start + rule.validDays * 86_400_000);
  if (!Number.isFinite(cutoff.getTime()) || !Number.isFinite(validUntil.getTime())) return booking;
  return {
    ...booking,
    makeup: {
      enabled: rule.enabled,
      cutoff_at: cutoff.toISOString(),
      valid_until: validUntil.toISOString(),
    },
  };
}
