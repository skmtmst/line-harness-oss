/** Normalize the two legacy formats, including when the value must be read by SQLite. */
export function storedTimestamp(value: string, mode: 'value' | 'sql' = 'value'): string {
  if (mode === 'sql') {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) throw new Error('Invalid timestamp column');
    return `(CASE WHEN substr(${value},-1) IN ('Z','z') OR substr(${value},-6,1) IN ('+','-') OR substr(${value},-5,1) IN ('+','-') THEN ${value}
      WHEN length(${value})=19 AND substr(${value},11,1)=' ' THEN substr(${value},1,10) || 'T' || substr(${value},12) || 'Z'
      WHEN length(${value})=10 THEN ${value} || 'T00:00:00+09:00'
      ELSE ${value} || '+09:00' END)`;
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return `${value.replace(' ', 'T')}Z`;
  return `${value}${value.length === 10 ? 'T00:00:00' : ''}+09:00`;
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
    : createdAt ? Date.parse(storedTimestamp(createdAt)) : NaN;
  return Number.isFinite(at) && at < now - LINE_WEBHOOK_SILENCE_MS;
}
