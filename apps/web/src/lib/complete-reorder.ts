import type { ServerListResponse } from './use-server-list'

/** 順位を0から振り直すAPIへは、同じ範囲の全IDを送る。ページ外の位置は保つ。 */
export async function completeReorder<T extends { id: string }>(
  visibleOrder: string[],
  load: (request: { page: number; limit: number }, signal: AbortSignal) => Promise<ServerListResponse<T>>,
  maxItems = 10000,
): Promise<string[]> {
  const all: string[] = []
  const signal = AbortSignal.timeout(15000)
  let total: number | undefined
  for (let page = 1; ; page++) {
    const result = await load({ page, limit: 100 }, signal)
    if (!Number.isInteger(result.total) || result.total! < 0 || result.total! > maxItems || result.limit < 1) throw new Error('全件の順位を確認できませんでした')
    if (total !== undefined && total !== result.total) throw new Error('一覧が変わりました。読み直してください')
    total = result.total
    const ids = result.items.map(item => item.id)
    if (!ids.length && all.length < total!) throw new Error('一覧の続きを確認できませんでした')
    all.push(...ids)
    if (new Set(all).size !== all.length || all.length > total!) throw new Error('一覧が変わりました。読み直してください')
    if (all.length === total) break
    if (signal.aborted) throw new Error('全件の順位を確認できませんでした')
  }
  const visible = new Set(visibleOrder)
  if (visible.size !== visibleOrder.length || visibleOrder.some(id => !all.includes(id))) throw new Error('並べ替える対象が変わりました。読み直してください')
  let index = 0
  return all.map(id => visible.has(id) ? visibleOrder[index++] : id)
}
