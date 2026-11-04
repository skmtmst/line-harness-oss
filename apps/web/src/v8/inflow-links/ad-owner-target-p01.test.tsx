// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({ account:'a', owner:'b' as string | null, hold:false, cancel:vi.fn() }))
vi.mock('@/lib/line-accounts-cache',()=>({loadLineAccounts:async()=>({success:true,data:[{id:'a',name:'店A'},{id:'b',name:'店B'}]})}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>'/inflow-links/ads',useSearchParams:()=>new URLSearchParams()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:state.account,loading:false})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/staff-role',async original=>({...await original<typeof import('@/lib/staff-role')>(),useStaffRole:()=> 'owner'}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,
 adPlatforms:{...actual.api.adPlatforms,list:async()=>({success:true,data:[]})},
 entryRoutes:{...actual.api.entryRoutes,list:async()=>({success:true,data:[]})},
 adCosts:{...actual.api.adCosts,list:async()=>{if(state.hold) await new Promise(()=>{});return {success:true,data:{rows:[],platforms:[],manualEntries:[{id:'cost1',lineAccountId:state.owner,sourceLabel:'広告A',day:'2026-10-01',amountMinor:500,currency:'JPY',entryRouteId:null,cancelledAt:null,cancelReason:null,createdAt:'2026-10-01T00:00:00Z'}]}}},cancel:state.cancel}
}}})
import AdsV8 from './ads'
afterEach(()=>{cleanup();state.account='a';state.owner='b';state.hold=false;state.cancel.mockReset()})
it('店を切り替えて読み直し中は古い行を消し、古い操作でも窓を開かない',async()=>{
 const view=render(<AdsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:/広告Aの操作/}))
 const item=await screen.findByRole('menuitem',{name:'取り消す'})
 const key=Object.keys(item).find(k=>k.startsWith('__reactProps$'))!
 const old=(item as unknown as Record<string,{onClick:(event:{stopPropagation:()=>void})=>void}>)[key].onClick
 state.hold=true;state.account='b';view.rerender(<AdsV8 />)
 expect(screen.queryByText('広告A')).toBeNull()
 await act(async()=>old({stopPropagation:()=>{}}))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(state.cancel).not.toHaveBeenCalled()
})
it('広告費の取消窓に記録の所属アカウントと環境を示し、切替後の古い確認を断る',async()=>{
 const view=render(<AdsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:/広告Aの操作/}))
 fireEvent.click(await screen.findByRole('menuitem',{name:'取り消す'}))
 const dialog=await screen.findByRole('dialog')
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(await within(dialog).findByText('店B')).toBeTruthy()
 expect(within(dialog).queryByText('店A')).toBeNull()
 expect(within(dialog).getByText('環境')).toBeTruthy()
 fireEvent.change(within(dialog).getByRole('textbox'),{target:{value:'金額誤り'}})
 const button=within(dialog).getByRole('button',{name:'取り消す'})
 const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'))!
 const old=(button as unknown as Record<string,{onClick:()=>void}>)[key].onClick
 state.account='b';view.rerender(<AdsV8 />)
 state.account='a';view.rerender(<AdsV8 />)
 await act(async()=>old())
 expect(state.cancel).not.toHaveBeenCalled()
})
it('所属先が無い旧応答では選択中のアカウントを代用しない',async()=>{
 state.owner=null
 render(<AdsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:/広告Aの操作/}))
 fireEvent.click(await screen.findByRole('menuitem',{name:'取り消す'}))
 const dialog=await screen.findByRole('dialog')
 expect(within(dialog).getByText('不明')).toBeTruthy()
 expect(within(dialog).queryByText('店A')).toBeNull()
})
it('確認した広告費の記録だけを取り消す',async()=>{
 state.cancel.mockResolvedValue({success:false,error:'test'})
 render(<AdsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:/広告Aの操作/}))
 fireEvent.click(await screen.findByRole('menuitem',{name:'取り消す'}))
 const dialog=await screen.findByRole('dialog')
 fireEvent.change(within(dialog).getByRole('textbox'),{target:{value:'金額誤り'}})
 fireEvent.click(within(dialog).getByRole('button',{name:'取り消す'}))
 expect(state.cancel).toHaveBeenCalledWith('cost1','金額誤り')
})
