export type ConversionFieldIssue = { field: string; message: string }

/** 入力の誤りを知らせたあと、閉じた詳細設定も開いて該当欄へ移る。 */
export function focusConversionField(id: string): void {
  const field = document.getElementById(id)
  if (!field) return
  const disclosure = field.closest('details')
  if (disclosure) disclosure.open = true
  const control = field.matches('input, textarea, button')
    ? field
    : field.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, button')
  control?.focus()
  ;(control ?? field).scrollIntoView?.({ block: 'center' })
}
