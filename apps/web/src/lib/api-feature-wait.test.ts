import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./api', () => ({ fetchApi: vi.fn() }))
import { fetchApi } from './api'
import { fetchHqMarkListStats, listHqMessageTemplates } from './api-feature-wait'

describe('機能待ちの一覧へつなぐAPI', () => {
  beforeEach(() => vi.mocked(fetchApi).mockReset())
  it('1通/複数通・差し込みのfalseもWorkerへ渡す', async () => {
    await listHqMessageTemplates({ messageCount: 'single', hasInterpolations: false })
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=template&kind=message&message_count=single&has_interpolations=false')
    await listHqMessageTemplates({ messageCount: 'multiple', hasInterpolations: true })
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=template&kind=message&message_count=multiple&has_interpolations=true')
    await listHqMessageTemplates()
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=template&kind=message')
  })
  it('対応状況と変更の集計を失わず返し、失敗を0へ変えない', async () => {
    const result = { success: true, data: [], stats: { markChanges: { count: 9 } } }
    vi.mocked(fetchApi).mockResolvedValueOnce(result)
    expect(await fetchHqMarkListStats()).toBe(result)
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=mark')
    vi.mocked(fetchApi).mockRejectedValueOnce(new Error('取得失敗'))
    await expect(fetchHqMarkListStats()).rejects.toThrow('取得失敗')
  })
})
