/*
 * テスト用の「アクセシブルな名前」判定（Issue #637）。
 *
 * 実ブラウザの accName 計算そのものではないが、監査対象の
 * 「ボタンに名前が付いているか」を固定するには十分な範囲を見る:
 *   1. aria-label
 *   2. ボタン内のテキスト
 *   3. 中の img[alt] / svg[aria-label] / [title]
 *   4. ボタン自身の title / aria-labelledby(参照先の文字)
 */
export function accessibleNameOf(el: Element, root: ParentNode): string {
  const aria = el.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()

  const labelledby = el.getAttribute('aria-labelledby')
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => root.querySelector('#' + CSS.escape(id))?.textContent ?? '')
      .join(' ')
      .trim()
    if (text) return text
  }

  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text) return text

  const inner =
    el.querySelector('[alt]')?.getAttribute('alt') ??
    el.querySelector('svg[aria-label]')?.getAttribute('aria-label') ??
    el.querySelector('[title]')?.getAttribute('title') ??
    el.getAttribute('title')
  return (inner ?? '').trim()
}

/** root 内の全 button のうち、名前が取れないものを返す。 */
export function buttonsWithoutAccessibleName(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll('button')).filter(
    (b) => accessibleNameOf(b, root) === '',
  )
}
