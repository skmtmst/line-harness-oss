

/**
 * 予約時刻の入力をUTCのISO8601('Z')へ正規化する。
 * '+09:00'などオフセット付きのまま保存すると、due判定の文字列比較で
 * 順序が崩れるため、書き込み境界で必ずここを通す。
 */
export function normalizeScheduledAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error('scheduled_at must be an ISO 8601 datetime');
  }
  return new Date(time).toISOString();
}
