/** 時差の無い保存日時はJST。読めない値を現在時刻や0で埋めない。 */
export function lineObservationTime(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+09:00`);
}

export const LINE_WEBHOOK_SILENCE_MS = 24 * 60 * 60_000;

/** 受信しない運用は除き、受信実績がなければ作成から24時間を待つ。 */
export function lineWebhookSilence(account: {
  lastReceivedAt?: string | null;
  createdAt?: string | null;
  exempt?: boolean;
}, now = Date.now()): boolean {
  if (account.exempt) return false;
  const at = lineObservationTime(account.lastReceivedAt ?? account.createdAt);
  return Number.isFinite(at) && at < now - LINE_WEBHOOK_SILENCE_MS;
}
