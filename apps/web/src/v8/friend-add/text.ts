/*
 * 「再追加時の制限」の選択肢と同じ言葉で出す。保存値は時間数 (0/24/168)。
 * テスト実施状態 (lastTestStatus) をここへ混ぜない(#946 N-109)。
 *
 * エディタと最終確認で**同じ変換**を使う。片方だけ固定文言にすると、
 * 設定値と確認画面の説明が食い違う。
 */
export function resendSuppressionText(hours: number | null | undefined): string {
  const value = hours ?? 24
  if (value <= 0) return '制限しない'
  if (value === 24) return '24時間に1回'
  if (value % 24 === 0) return `${value / 24}日に1回`
  return `${value}時間に1回`
}
