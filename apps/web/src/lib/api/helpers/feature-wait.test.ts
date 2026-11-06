import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../api', () => ({ fetchApi: vi.fn() }))
import { fetchApi } from '../../api'
import { fetchHqMarkListStats, listHqMessageTemplates } from './feature-wait'

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

describe('保存検索と表示場所の保存',()=>{
  it('保存した条件を一覧へ再適用し、falseと未分類を失わない',async()=>{
    const {hqTemplateSavedViewsApi}=await import('./feature-wait')
    const filters={messageCount:'multiple' as const,hasInterpolations:false,undistributed:false,search:'予約',folderId:null}
    const input={name:'よく使う',filters,scope:'tenant' as const}
    await hqTemplateSavedViewsApi.create(input)
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/saved-views',{method:'POST',body:JSON.stringify(input)})
    await listHqMessageTemplates(filters)
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=template&kind=message&message_count=multiple&has_interpolations=false&search=%E4%BA%88%E7%B4%84&folder_id=&undistributed=false')
    await hqTemplateSavedViewsApi.update('view/id',{...input,expectedRevision:2})
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/saved-views/view%2Fid',{method:'PATCH',body:JSON.stringify({...input,expectedRevision:2})})
    await hqTemplateSavedViewsApi.archive('id',3)
    expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/saved-views/id',{method:'DELETE',body:'{"expectedRevision":3}'})
  })
  it('表示を全部外す操作もアカウントと版を指定して送る',async()=>{
    const {updateSupportMarkDisplayLocations}=await import('./feature-wait')
    await updateSupportMarkDisplayLocations('mark/id','account/id',4,[])
    expect(fetchApi).toHaveBeenLastCalledWith('/api/support-marks/mark%2Fid?lineAccountId=account%2Fid',{method:'PATCH',body:'{"expectedVersion":4,"displayLocations":[]}'})
  })
})
