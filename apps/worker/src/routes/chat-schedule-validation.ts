import { normalizeScheduledAt } from '@line-crm/db';


// ========== 送信予約(N-025) ==========

// 予約時刻は「いまより先」だけを受け付ける。画面のdatetime-localはJSTで
// 入力されるが、保存はUTCへ正規化するため境界ずれは起きない。
export function validateScheduledAt(raw: unknown): { ok: true; scheduledAt: string } | { ok: false } {
  if (typeof raw !== 'string' || !raw) return { ok: false };
  let scheduledAt: string;
  try {
    scheduledAt = normalizeScheduledAt(raw);
  } catch {
    return { ok: false };
  }
  if (Date.parse(scheduledAt) <= Date.now()) return { ok: false };
  return { ok: true, scheduledAt };
}
