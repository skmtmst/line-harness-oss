// @vitest-environment happy-dom
import { beforeEach,expect,it,vi } from 'vitest'
import { defaultRestaurantReservationForm } from '@line-crm/shared'
import { ApiError } from '../transport/errors'
const f=vi.hoisted(()=>({fetch:vi.fn()}))
vi.mock('../transport/request',()=>({fetchApi:f.fetch}))
import { followupBoardApi } from './restaurant-followup-board'
beforeEach(()=>{f.fetch.mockReset()})
it('行を読み込んでから設定と状態を読み、店とアカウントを全ての口へ渡す',async()=>{
 f.fetch.mockImplementation(async(path:string)=>({success:true,data:path.includes('review-history')?{invitations:[]}: {}}))
 await followupBoardApi.read('a&b','s/1')
 expect(f.fetch.mock.calls.map(call=>call[0])).toEqual(['/api/restaurant-test/followups/s%2F1?account_id=a%26b','/api/restaurant-test/followups/s%2F1/engines?account_id=a%26b','/api/restaurant-test/followups/s%2F1/reservation-form?account_id=a%26b','/api/restaurant-test/followups/s%2F1/review-history?account_id=a%26b'])
})
it('破損の503だけを修復の状態として読み、他の失敗を正常な設定へ置き換えない',async()=>{
 const repair={version:-1,definition:defaultRestaurantReservationForm(),repairToken:'fingerprint'}
 f.fetch.mockImplementation(async(path:string)=>{
  if(path.includes('/reservation-form'))throw new ApiError(503,'最小の項目で受け付けています','invalid_saved_form',{repair})
  return {success:true,data:path.includes('review-history')?{invitations:[]}:{}}
 })
 expect(await followupBoardApi.read('a','s')).toMatchObject({form:repair,formError:'予約フォームの設定が読めないため、最小の項目で受け付けています。直してください'})
 f.fetch.mockRejectedValue(new ApiError(503,'一時的な障害'))
 await expect(followupBoardApi.read('a','s')).rejects.toThrow('一時的な障害')
})
it('通常の保存に修復の指紋を付けず、明示的な修復では同じ指紋と版を渡す',async()=>{
 f.fetch.mockResolvedValue({success:true,data:{}})
 const definition=defaultRestaurantReservationForm()
 await followupBoardApi.saveForm('a','s',1,definition)
 expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({expectedVersion:1,definition})
 await followupBoardApi.saveForm('a','s',-1,definition,'fingerprint')
 expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toEqual({expectedVersion:-1,definition,repairToken:'fingerprint'})
})
it('テストと開始に友だちIDを渡さず、サーバーの同じ版の証明を使う',async()=>{
 f.fetch.mockResolvedValue({success:true,data:{}})
 await followupBoardApi.test('a','s','reservation_created',3)
 await followupBoardApi.start('a','s','reservation_created',3,'tested-content')
 expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({expectedTargetVersion:3})
 expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toEqual({expectedTargetVersion:3,expectedContentHash:'tested-content'})
})
