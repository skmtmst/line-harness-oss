export type ReferenceOption = { value: string; label: string }

/**
 * 保存済みの参照先が一覧から取れなくても、現在値を勝手に消さない。
 * IDそのものは画面へ出さず、「選択済み」とだけ伝えて選び直せるようにする。
 */
export function optionsWithCurrent(
  options: ReferenceOption[],
  currentValue: string,
  currentLabel: string,
  emptyLabel: string,
): ReferenceOption[] {
  const rows: ReferenceOption[] = [{ value: '', label: emptyLabel }, ...options]
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    rows.splice(1, 0, { value: currentValue, label: currentLabel })
  }
  return rows
}
