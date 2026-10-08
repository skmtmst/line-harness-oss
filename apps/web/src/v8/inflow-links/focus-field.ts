/** 入力の誤りは、その欄へ移って知らせる。 */
export function focusField(id: string) {
  const field = document.getElementById(id)
  field?.focus()
  field?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
