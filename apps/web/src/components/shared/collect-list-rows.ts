/** 絞り込んだ一覧を全ページ読む。途中で読めなければ部分的な選択は返さない。 */
export async function collectListRows<T extends { id: string }>(total: number, load: (offset: number, limit: number) => Promise<{ items: T[]; total?: number }>): Promise<T[]> {
  const rows = new Map<string, T>()
  let target = total
  for (let offset = 0; rows.size < target; offset += 100) {
    const page = await load(offset, 100)
    if (page.total !== undefined) target = page.total
    const before = rows.size
    page.items.forEach(row => rows.set(row.id, row))
    if (rows.size < target && rows.size === before) throw new Error('全件を読み込めませんでした')
  }
  return [...rows.values()]
}

/** 総数を返さない一覧も、最後の短いページまで読む。 */
export async function collectUncountedListRows<T extends { id: string }>(limit: number, load: (offset: number, limit: number) => Promise<T[]>): Promise<T[]> {
  const rows = new Map<string, T>()
  for (let offset = 0; ; offset += limit) {
    const page = await load(offset, limit)
    const before = rows.size
    page.forEach(row => rows.set(row.id, row))
    if (page.length < limit) return [...rows.values()]
    if (rows.size === before) throw new Error('全件を読み込めませんでした')
  }
}
