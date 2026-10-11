// @vitest-environment happy-dom
import React from 'react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import BookingHistory from '../../../../worker/src/client/salon-booking/pages/BookingHistory'
import Confirm from '../../../../worker/src/client/salon-booking/components/Confirm'
import type { MenuItem, StaffItem } from '../../../../worker/src/client/salon-booking/lib/api'
import { SalonBookingProvider } from '../../../../worker/src/client/salon-booking/lib/context'
import { mountAffiliate, unmountAffiliate } from '../../../../worker/src/client/affiliate/main'
import { initForm } from '../../../../worker/src/client/form'
const ctx={liffId:'fixture',lineUserId:'fixture-user',idToken:'fixture-token'}
const menu: MenuItem = {id:'m',name:'fixture menu',category_label:null,description:null,duration_minutes:30,buffer_after_minutes:0,base_price:1000,sort_order:0}
const staff: StaffItem = {id:'s',display_name:'fixture staff',duration_minutes:30,price:1000,role:null,profile_image_url:null,bio:null,is_designation_optional:0}
const fixtureReply=(j:unknown)=>new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}})
beforeEach(()=> {vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}});vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network access: all requests must be mocked')}))})
afterEach(()=> {unmountAffiliate();cleanup();document.body.innerHTML='';vi.unstubAllGlobals()})
it('deployed booking confirmation renders the configured intake question',()=>{
 render(<SalonBookingProvider value={ctx}><Confirm menu={{...menu,intake_question:'事前に伝えたいことは何ですか？'}} staff={staff} slot={{date:'2026-10-20',start:'10:00'}} onSubmitted={()=>{}} onBack={()=>{}} /></SalonBookingProvider>)
 expect(screen.queryByLabelText('事前に伝えたいことは何ですか？')).not.toBeNull()
})
it('deployed form renderer displays total and option availability supplied by the API',async()=>{
 document.body.innerHTML='<div id="app"></div>'
 vi.stubGlobal('liff',{getProfile:async()=>({userId:'fixture',displayName:'fixture'}),getIDToken:()=>null})
 vi.stubGlobal('fetch',vi.fn(async()=>fixtureReply({success:true,data:{id:'f',name:'fixture form',isActive:true,hideProfile:true,fields:[{name:'choice',type:'radio',label:'選択してください',options:['A','B']}],availability:{accepting:true,totalRemaining:2,oncePerFriend:true,choices:{choice:{A:{remaining:0,full:true},B:{remaining:1,full:false}}}}}})))
 await initForm('f');expect(screen.queryByText(/受付上限まで残り2件/)).not.toBeNull()
})
it('deployed affiliate wallet exposes mileage redemption',async()=>{
 const host=document.createElement('div');document.body.append(host)
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const path=new URL(String(input),'https://fixture.test').pathname
  if(path.endsWith('/affiliate/me'))return fixtureReply({affiliate:{id:'a',name:'fixture',isActive:true,code:'fixture',commissionRate:0,friendId:'fixture'},links:[]})
  if(path.endsWith('/affiliate/offers'))return fixtureReply({offers:[]})
  if(path.endsWith('/mileage/rewards'))return fixtureReply({rewards:[],availableMiles:150})
  if(path.endsWith('/affiliate/bank'))return fixtureReply({data:{bankCode:'9999',bankName:'fixture bank',branchCode:'999',branchName:'fixture branch',accountType:'ordinary',accountLast4:'0000',accountHolderName:'FIXTURE',version:1}})
  if(path.endsWith('/affiliate/statements'))return fixtureReply({data:[]})
  return fixtureReply({mileage:{programName:'fixture',available:150,pending:0,lifetimeEarned:150,spent:0},insights:{accountCount:1,rewardedActions:0,referralMiles:0,qualityReferralCount:0,lastEarnedAt:null},opportunities:[],history:[]})
 }))
 await act(async()=>mountAffiliate(host,{...ctx,lineAccessToken:'fixture-token'}))
 await screen.findByRole('heading',{name:'マイル・紹介'});await waitFor(()=>expect(screen.queryByText('読み込み中…')).toBeNull())
 expect(screen.queryByRole('button',{name:'使い道を選ぶ'})).not.toBeNull()
})
it('deployed registered affiliate exposes bank editing',async()=>{
 const host=document.createElement('div');document.body.append(host)
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const path=new URL(String(input),'https://fixture.test').pathname
  if(path.endsWith('/affiliate/me'))return fixtureReply({affiliate:{id:'a',name:'fixture',isActive:true,code:'fixture',commissionRate:0,friendId:'fixture'},links:[]})
  if(path.endsWith('/affiliate/offers'))return fixtureReply({offers:[]})
  if(path.endsWith('/mileage/rewards'))return fixtureReply({rewards:[],availableMiles:150})
  if(path.endsWith('/affiliate/bank'))return fixtureReply({data:{bankCode:'9999',bankName:'fixture bank',branchCode:'999',branchName:'fixture branch',accountType:'ordinary',accountLast4:'0000',accountHolderName:'FIXTURE',version:1}})
  if(path.endsWith('/affiliate/statements'))return fixtureReply({data:[]})
  return fixtureReply({mileage:{programName:'fixture',available:150,pending:0,lifetimeEarned:150,spent:0},insights:{accountCount:1,rewardedActions:0,referralMiles:0,qualityReferralCount:0,lastEarnedAt:null},opportunities:[],history:[]})
 }))
 await act(async()=>mountAffiliate(host,{...ctx,lineAccessToken:'fixture-token'}))
 await screen.findByRole('heading',{name:'マイル・紹介'});expect(screen.queryByRole('button',{name:'振込先を編集する'})).not.toBeNull()
})

it('deployed booking history displays the server supplied cancellation deadline', async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>fixtureReply({upcoming:[{id:'b',menu_name:'fixture menu',staff_name:'fixture staff',starts_at:'2099-10-20T01:00:00Z',duration_minutes:30,price:1000,status:'confirmed',cancel_deadline_at:'2099-10-19T01:00:00Z',lock_version:4}],past:[]})))
 render(<SalonBookingProvider value={ctx}><BookingHistory /></SalonBookingProvider>)
 await screen.findByText('fixture menu');expect(screen.queryByText(/キャンセル期限：/)).not.toBeNull()
})
it('deployed booking preserves input and the same operation key on failure and retry',async()=>{
 const posted: RequestInit[]=[]
 // createApi treats a 409 as a conflicting slot, before retrying the same request.
 vi.stubGlobal('fetch',vi.fn(async(_input: RequestInfo | URL, opts: RequestInit = {})=>{posted.push(opts);return new Response(JSON.stringify(posted.length===1?{success:false,error:'slot_conflict'}:{success:true,data:{id:'b'}}),{status:posted.length===1?409:200,headers:{'Content-Type':'application/json'}})}))
 const done=vi.fn();render(<SalonBookingProvider value={ctx}><Confirm menu={menu} staff={staff} slot={{date:'2026-10-20',start:'10:00'}} onSubmitted={done} onBack={()=>{}} /></SalonBookingProvider>)
 const {fireEvent}=await import('@testing-library/react');fireEvent.change(screen.getByRole('textbox'),{target:{value:'fixture note'}});fireEvent.click(screen.getByRole('button',{name:'予約をリクエスト'}))
 await screen.findByText(/他の方の予約と重なりました/);expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('fixture note');expect(done).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'予約をリクエスト'}));await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));expect(posted).toHaveLength(2);expect(new Headers(posted[0].headers).get('Idempotency-Key')).toBe(new Headers(posted[1].headers).get('Idempotency-Key'));expect(posted[0].body).toBe(posted[1].body)
})
