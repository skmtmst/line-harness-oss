/**
 * たまる決めごとの見せ方（設計 `N46cQ`）。
 *
 * 絞り込み・並び替え・CSV書き出しは各画面が V6 の口に合わせて持つ。
 * ここに残すのは、画面をまたいで使う表示の言い換えだけ。
 */

/** 未知のイベント名を内部語のまま運用者へ見せない。 */
export function ruleEventLabel(eventType: string, labels: Record<string, string>): string {
  return labels[eventType] ?? 'その他の行動'
}
