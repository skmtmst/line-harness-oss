// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({ account:'a', cancel:vi.fn() }))
vi.mock('@/lib/line-accounts-cache',()=>({loadLineAccounts:async()=>({success:true,data:[{id:'a',name:'店A'},{id:'b',name:'店B'}]})}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>'/inflow-links/ads',useSearchParams:()=>new URLSearchParams()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:state.account,loading:false})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/staff-role',async original=>({...await original<typeof import('@/lib/staff-role')>(),useStaffRole:()=> 'owner'}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,
 adPlatforms:{...actual.api.adPlatforms,list:async()=>({success:true,data:[]})},
 entryRoutes:{...actual.api.entryRoutes,list:async()=>({success:true,data:[]})},
 adCosts:{...actual.api.adCosts,list:async()=>({success:true,data:{rows:[],platforms:[],manualEntries:[{id:'cost1',sourceLabel:'広告A',day:'2026-10-01',amountMinor:500,currency:'JPY',entryRouteId:null,cancelledAt:null,cancelReason:null,createdAt:'2026-10-01T00:00:00Z'}]}}),cancel:state.cancel}
}}})
import AdsV8 from './ads'
afterEach(()=>{cleanup();state.account='a';state.cancel.mockReset()})
it('広告費の取消窓に読込時のアカウントと環境を示し、切替後の古い確認を断る',async()=>{
 const view=render(<AdsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:/広告Aの操作/}))
 fireEvent.click(await screen.findByRole('menuitem',{name:'取り消す'}))
 const dialog=await screen.findByRole('dialog')
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(await within(dialog).findByText('店A')).toBeTruthy()
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
