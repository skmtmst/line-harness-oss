/**
 * 選択したリマインダを順番に削除し、失敗したIDだけを返す。
 *
 * 一括削除は途中まで成功することがある。成功済みまで再試行すると、
 * 2回目の削除で404になり、残りへ永遠に進めなくなるため分けて返す。
 */
export async function deleteReminderSelection(
  ids: readonly string[],
  remove: (id: string) => Promise<boolean>,
): Promise<string[]> {
  const failed: string[] = []
  for (const id of ids) {
    try {
      if (!(await remove(id))) failed.push(id)
    } catch {
      failed.push(id)
    }
  }
  return failed
}
