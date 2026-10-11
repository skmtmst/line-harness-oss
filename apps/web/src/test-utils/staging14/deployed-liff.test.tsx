// @vitest-environment happy-dom
import React from 'react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import { mountAffiliate, unmountAffiliate } from '../../../../worker/src/client/affiliate/main'
import { initForm } from '../../../../worker/src/client/form'
const ctx={liffId:'fixture',lineUserId:'fixture-user',idToken:'fixture-token'}
const fixtureReply=(j:unknown)=>new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}})
beforeEach(()=> {vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}});vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network access: all requests must be mocked')}))})
afterEach(()=> {unmountAffiliate();cleanup();document.body.innerHTML='';vi.unstubAllGlobals()})

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
