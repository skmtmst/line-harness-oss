// @vitest-environment happy-dom
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { defaultRestaurantReservationForm } from '@line-crm/shared'
import { clearApiReadCache } from '../transport/read-cache'
import { fetchApi } from '../transport/request'
import { followupBoardApi } from './restaurant-followup-board'
beforeEach(()=>{clearApiReadCache();localStorage.setItem('lh_csrf','repair-response')})
afterEach(()=>vi.unstubAllGlobals())
it('実際の503応答から修復の指紋を読み、外部本文を表示しない',async()=>{
 const repair={version:-1,definition:defaultRestaurantReservationForm(),repairToken:'saved-fingerprint'}
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const path=String(input)
  return path.includes('/reservation-form')
   ?Response.json({success:false,code:'invalid_saved_form',error:'internal storage detail',data:{repair}},{status:503})
   :Response.json({success:true,data:path.includes('review-history')?{invitations:[]}:{}})
 }))
 const result=await followupBoardApi.read('account','store')
 expect(result.form).toEqual(repair)
 expect(result.formError).toBe('予約フォームの設定が読めないため、最小の項目で受け付けています。直してください')
 expect(result.formError).not.toContain('internal storage detail')
})
it('修復以外の503の本文と機械データは表示用へ渡さない',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:false,code:'unavailable',error:'internal storage detail',data:{repairToken:'private'}},{status:503})))
 await expect(fetchApi('/api/restaurant-test/followups/store/reservation-form')).rejects.toMatchObject({status:503,message:'API error: 503',data:undefined})
})
