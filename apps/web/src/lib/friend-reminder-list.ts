import { collectListRows } from '@/components/shared/collect-list-rows'
import type { ServerListResponse } from './use-server-list'

/** 登録IDで絞ってからページを切る。最初のページだけを絞って総数を誤らせない。 */
export async function friendReminderPage<T extends { id: string }>(ids: string[], request: { page: number; limit: number }, load: (page: number, limit: number) => Promise<ServerListResponse<T>>): Promise<ServerListResponse<T>> {
  if (!ids.length) return { items: [], total: 0, limit: request.limit, sort: [] }
  const first = await load(1, 100)
  if (first.total === undefined) throw new Error('リマインダの総数を確認できませんでした')
  const all = await collectListRows(first.total, async (offset, limit) => offset === 0 ? first : load(offset / limit + 1, limit))
  const enrolled = new Set(ids)
  const matching = all.filter(row => enrolled.has(row.id))
  return { ...first, items: matching.slice((request.page - 1) * request.limit, request.page * request.limit), total: matching.length, limit: request.limit }
}
