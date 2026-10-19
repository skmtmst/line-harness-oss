// @vitest-environment happy-dom
import React from 'react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
const f=vi.hoisted(()=>({summaries:vi.fn(),current:vi.fn()}))
vi.mock('./frame',async original=>({...await original<typeof import('./frame')>(),useAffiliateShell:()=>({readonly:false,narrow:false,accountId:'a'}),AffiliateFrame:({children,toolbar}:{children:React.ReactNode;toolbar:React.ReactNode})=><div>{toolbar}{children}</div>}))
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/affiliates',useRouter:()=>({replace:vi.fn(),push:vi.fn()})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,affiliates:{...actual.api.affiliates,settlementPreview:async()=>({success:true,data:{affiliates:[],totalAmount:0,conversionCount:0}}),paymentSummaries:f.summaries,settlementCurrent:f.current}}}})
import PaymentTab from './payment'
beforeEach(()=>{f.summaries.mockReset().mockResolvedValue({success:true,data:[]});f.current.mockReset().mockResolvedValue({success:true,data:null})})
afterEach(cleanup)
it('支払い一覧の壊れた返事を空の一覧にせず、読み直す',async()=>{
 f.summaries.mockResolvedValueOnce({success:true,data:null})
 render(<PaymentTab/>)
 await screen.findByText('支払いの集計を読み込めませんでした')
 expect(screen.queryByText('今回締められる報酬はありません')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:/もう一度/}))
 await screen.findByText('今回締められる報酬はありません')
 expect(f.summaries).toHaveBeenCalledTimes(2)
})
it.each(['summaries','current'] as const)('支払いの%s拒否を未処理なし・未締めとして扱わず読み直す',async(key)=>{
 f[key].mockRejectedValueOnce(new Error('fixture failure'))
 render(<PaymentTab/>)
 const error=await screen.findByText('支払いの集計を読み込めませんでした')
 expect(screen.queryByText('今回締められる報酬はありません')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:/もう一度/}))
 await screen.findByText('今回締められる報酬はありません')
 expect(f[key]).toHaveBeenCalledTimes(2)
 expect(screen.queryByText(error.textContent!)).toBeNull()
})
