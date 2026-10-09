/** 管理画面の見本と同じ料金表記。お問い合わせを無料にしない。 */
export function bookingPriceText(amount: number, mode?: 'fixed' | 'free' | 'inquiry'): string {
  if (mode === 'inquiry') return 'お問い合わせ';
  if (mode === 'free' || (mode === undefined && amount === 0)) return '無料';
  return `¥${amount.toLocaleString('ja-JP')}`;
}
