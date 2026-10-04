import { describe, expect, it, vi } from 'vitest'
import { webinarListCsv } from './list-csv'
import type { WebinarListItem } from '@/lib/api'
const item = (id: string, title: string) => ({ id, title, slug: id, status: 'draft' }) as WebinarListItem

describe('条件に合う全ウェビナーのCSV', () => {
  it('全頁に検索とフォルダを渡し、引用と計算式を安全に書き出す', async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: { items: [item('1', '=1+1')], total: 2 } }).mockResolvedValueOnce({ data: { items: [item('2', '名前,"引用"')], total: 2 } })
    const csv = await webinarListCsv({ accountId: 'a', params: { q: '相談', folder: 'f', status: 'draft', sort: 'name' }, list, isCurrent: () => true })
    expect(list).toHaveBeenLastCalledWith('a', { q: '相談', folder: 'f', status: 'draft', sort: 'name', page: 2, limit: 100 })
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"名前,""引用"""')
    expect(csv?.startsWith('\uFEFF')).toBe(true)
  })
  it('途中の失敗は一部だけのCSVにせず、条件の切り替え後は取得結果を捨てる', async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: { items: [item('1', '最初')], total: 2 } }).mockRejectedValueOnce(new Error('network'))
    await expect(webinarListCsv({ accountId: 'a', params: {}, list, isCurrent: () => true })).rejects.toThrow('network')
    list.mockResolvedValueOnce({ data: { items: [item('1', '前のアカウント')], total: 1 } })
    await expect(webinarListCsv({ accountId: 'a', params: {}, list, isCurrent: () => false })).resolves.toBeNull()
  })
  it('アーカイブ済みの条件と状態をCSVへ引き継ぐ', async () => {
    const archived = { ...item('old', '旧版'), status: 'archived', publicationState: 'ended', registrationCount: 12 } as WebinarListItem
    const list = vi.fn().mockResolvedValue({ data: { items: [archived], total: 1 } })
    const csv = await webinarListCsv({ accountId: 'a', params: { status: 'archived' }, list, isCurrent: () => true })
    expect(list).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'archived' }))
    expect(csv).toContain('"アーカイブ","12"')
  })
})
