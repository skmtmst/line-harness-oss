import { beforeEach,expect,test,vi } from 'vitest'
vi.mock('../../api',()=>({fetchApi:vi.fn()}))
import { fetchApi } from '../../api'
import { hqBroadcastViewsApi } from './hq-broadcast-views'
beforeEach(()=>vi.mocked(fetchApi).mockReset().mockResolvedValue({success:true,data:{}}))
test('CRUD preserves scope, date conditions and expected revision',async()=>{
  const input={name:'今月',scope:'private' as const,conditions:{from:'2026-10-01',to:'2026-10-31',status:'pending_approval' as const}}
  await hqBroadcastViewsApi.list();expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/broadcasts/saved-views',{method:'GET'})
  await hqBroadcastViewsApi.create(input);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/broadcasts/saved-views',{method:'POST',body:JSON.stringify(input)})
  await hqBroadcastViewsApi.update('v/1',{...input,expectedRevision:2});expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/broadcasts/saved-views/v%2F1',{method:'PATCH',body:JSON.stringify({...input,expectedRevision:2})})
  await hqBroadcastViewsApi.archive('v/1',3);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/broadcasts/saved-views/v%2F1',{method:'DELETE',body:JSON.stringify({expectedRevision:3})})
})
