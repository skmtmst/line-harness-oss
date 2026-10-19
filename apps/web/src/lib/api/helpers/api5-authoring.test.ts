import {beforeEach,expect,it,vi} from 'vitest'
vi.mock('../../api',()=>({fetchApi:vi.fn()}))
import {fetchApi} from '../../api'
import {searchHqTemplateResources} from './hq-resource-search'
import {fetchHqDistributionTargets,fetchHqDistributionAccounts} from './hq-distribution-targets'
import {saveHqMessageTemplate} from './hq-message-bundles'
import {bookFromForm} from './form-booking'
beforeEach(()=>{vi.mocked(fetchApi).mockReset()})
it('選んだ店IDと検索条件を保持し、配布版の取得先を安全に組み立てる',async()=>{
 await searchHqTemplateResources({kind:'tag',q:'会員',accountIds:['a','b'],limit:30,cursor:'0'})
 const called=String(vi.mocked(fetchApi).mock.calls[0][0]);const query=new URL(called,'https://example.test').searchParams
 expect(Object.fromEntries(query)).toEqual({kind:'tag',q:'会員',accountIds:'a,b',limit:'30',cursor:'0'})
 await fetchHqDistributionAccounts();expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/accounts')
 await fetchHqDistributionTargets('id/1',['a','b']);expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/id%2F1/distribution-targets?accountIds=a%2Cb')
})
it('複数通の作成と版を確認した保存で同じ定義を渡す',async()=>{
 const definition={schemaVersion:1,template:{},media:[],messageBubbles:[{id:'first',type:'text',content:{text:'先'}},{id:'second',type:'text',content:{text:'後'}}]} as never
 await saveHqMessageTemplate({name:'案内',definition,requestId:'request'})
 expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates',{method:'POST',body:JSON.stringify({type:'template',name:'案内',definition,requestId:'request'})})
 await saveHqMessageTemplate({id:'id/1',name:'案内',definition,expectedRevision:2});expect(vi.mocked(fetchApi).mock.calls[1][0]).toBe('/api/hq/templates/id%2F1')
 expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[1][1]?.body))).toMatchObject({expectedRevision:2,definition})
})
it('フォーム予約は本人のトークンと保存済み回答を送り、店の承認設定を画面から上書きしない',async()=>{
 const formAnswer={formId:'f',blockId:'b',submissionKey:'key'}
 await bookFromForm('liff-id','id-token',formAnswer)
 expect(fetchApi).toHaveBeenCalledWith('/api/liff/booking/requests?liffId=liff-id',{method:'POST',headers:{Authorization:'Bearer id-token','Idempotency-Key':'form:key:b'},body:JSON.stringify({formAnswer})})
})
it('取得失敗を空の一覧に変えない',async()=>{
 vi.mocked(fetchApi).mockRejectedValue(new Error('取得失敗'))
 await expect(searchHqTemplateResources({kind:'coupon'})).rejects.toThrow('取得失敗')
})
