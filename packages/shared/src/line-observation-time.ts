/** SQLite UTC defaults omit the offset; retain explicit offsets unchanged. */
export function sqliteUtcTimestamp(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`;
}

/** 時差の無い保存日時はJST。読めない値を現在時刻や0で埋めない。 */
export function lineObservationTime(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`);
}

export const LINE_WEBHOOK_SILENCE_MS = 24 * 60 * 60_000;
/** A persisted connection check is evidence for at most one day. */
export const LINE_CONNECTION_CHECK_TTL_MS = 24 * 60 * 60_000;

/** 受信しない運用は除き、受信実績がなければ作成から24時間を待つ。 */
export function lineWebhookSilence(account: {
  lastReceivedAt?: string | null;
  createdAt?: string | null;
  exempt?: boolean;
}, now = Date.now()): boolean {
  if (account.exempt) return false;
  // SQLite's datetime('now') default stores UTC without a suffix on legacy rows.
  const createdAt = account.createdAt;
  const at = account.lastReceivedAt ? lineObservationTime(account.lastReceivedAt)
    : createdAt && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(createdAt)
      ? Date.parse(sqliteUtcTimestamp(createdAt))
      : lineObservationTime(createdAt);
  return Number.isFinite(at) && at < now - LINE_WEBHOOK_SILENCE_MS;
}
