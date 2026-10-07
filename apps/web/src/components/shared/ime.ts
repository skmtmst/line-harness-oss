/**
 * 日本語の変換中のキーか。
 *
 * 変換を確定する Enter・候補を選ぶ上下キー・変換をやめる Esc は、入力欄の部品へ
 * そのまま届く。ここで保存・選択・閉じるを走らせると、確定のつもりの Enter で
 * 書きかけの文字が保存される。`isComposing` が無い・遅れるブラウザ（Safari の確定の
 * Enter など）は keyCode 229 で見分ける。
 */
export function isImeComposing(event: {
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}): boolean {
  return Boolean(
    event.isComposing
    || event.nativeEvent?.isComposing
    || event.keyCode === 229
    || event.nativeEvent?.keyCode === 229,
  )
}
