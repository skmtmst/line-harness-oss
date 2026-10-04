import type { WebinarListItem, WebinarListParams, WebinarListResponse } from '@/lib/api'

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** 表示中の条件に合う全頁を取得。途中で失敗した場合は一部のCSVを返さない。 */
export async function webinarListCsv(args: {
  accountId: string
  params: WebinarListParams
  list: (accountId: string, params: WebinarListParams) => Promise<{ data: WebinarListResponse }>
  isCurrent: () => boolean
}): Promise<string | null> {
  const items: WebinarListItem[] = []
  const ids = new Set<string>()
  let expectedTotal: number | null = null
  for (let page = 1; ; page += 1) {
    const response = await args.list(args.accountId, { ...args.params, page, limit: 100 })
    if (!args.isCurrent()) return null
    const data = response.data
    if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('shape')
    if (expectedTotal !== null && data.total !== expectedTotal) throw new Error('changed')
    expectedTotal = data.total
    for (const item of data.items) {
      if (ids.has(item.id)) throw new Error('changed')
      ids.add(item.id); items.push(item)
    }
    if (items.length >= data.total) break
    if (data.items.length === 0) throw new Error('incomplete')
  }
  const rows: unknown[][] = [['ウェビナー名', '公開URLの名前', '状態', '申込人数', '視聴開始人数', '公開開始', '公開終了']]
  for (const item of items) rows.push([item.title, item.slug, item.status === 'archived' ? 'アーカイブ' : item.publicationState === 'scheduled' ? '公開予定' : item.publicationState === 'ended' ? '終了' : item.status === 'active' ? '公開中' : item.status === 'draft' ? '下書き' : 'アーカイブ', item.registrationCount, item.viewerCount, item.publicationStartsAt, item.publicationEndsAt])
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
