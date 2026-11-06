/** 円の割合計算。請求側と同じく、掛け算の後で1円未満を切り捨てる。 */
export function yenPercent(price: number, percent: number): number {
  return Math.floor(price * percent / 100);
}

/** 半角の¥と3桁区切り。未取得・無効値を0円と表示しない。 */
export function formatYen(value: number | null | undefined, fallback = '—'): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return `¥${Math.floor(value).toLocaleString('ja-JP')}`;
}
