import {beforeEach,expect,test,vi} from 'vitest'
const fetchApi=vi.hoisted(()=>vi.fn())
vi.mock('../../api',async original=>({...await original<typeof import('../../api')>(),fetchApi}))
import {fetchHqDistributionTargets} from './hq-distribution-targets'
import {searchHqTemplateResources} from './hq-resource-search'
import {hqCatalogTemplatesApi} from './hq-catalog-templates'
import {liffNotificationPreferencesApi} from './liff-notification-preferences'
beforeEach(()=>fetchApi.mockReset().mockResolvedValue({success:true,data:{}}))
test('確認前の版と名前検索は選んだ店・検索文字を失わずに送る',async()=>{
 await fetchHqDistributionTargets('menu/1',['a','b'])
 expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/menu%2F1/distribution-targets?accountIds=a%2Cb')
 await searchHqTemplateResources({kind:'coupon',q:'10% &会員',accountIds:['a'],limit:5,cursor:'10'})
 const path=fetchApi.mock.calls[1][0] as string,query=new URL(`https://worker.test${path}`).searchParams
 expect(query.get('q')).toBe('10% &会員');expect(query.get('accountIds')).toBe('a');expect(query.get('cursor')).toBe('10')
})
test('景品の版・在庫0・配布確認の選択を保持し、失敗は呼び出し側へ返す',async()=>{
 const definition={schemaVersion:1 as const,settings:{name:'お礼',rewardKind:'coupon' as const,requiredMiles:10,stockLimit:0}}
 await hqCatalogTemplatesApi.update('reward/1',{name:'景品',definition,expectedRevision:3})
 expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/reward%2F1',{method:'PATCH',body:JSON.stringify({name:'景品',definition,expectedRevision:3})})
 fetchApi.mockRejectedValueOnce(new Error('競合'))
 await expect(hqCatalogTemplatesApi.preflight('reward/1',['a'])).rejects.toThrow('競合')
})
test('本人トークンをURLへ入れず、停止・再開の版を明示する',async()=>{
 await liffNotificationPreferencesApi.update('a','token-fixture','marketing',false,4)
 const [path,options]=fetchApi.mock.calls[0] as [string,RequestInit]
 expect(path).toBe('/api/liff/notification-preferences/marketing?lineAccountId=a')
 expect(options.headers).toEqual({Authorization:'Bearer token-fixture'})
 expect(JSON.parse(String(options.body))).toEqual({enabled:false,expectedVersion:4})
 expect(path).not.toContain('token-fixture')
})
