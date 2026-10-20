// @vitest-environment happy-dom
import React from 'react'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
const net=vi.hoisted(()=>({fetch:vi.fn(),snapshot:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a'})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{},useHideSettingsNav:()=>{}}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}))
vi.mock('@/lib/api',async(o)=>({...await o<typeof import('@/lib/api')>(),fetchApi:net.fetch}))
vi.mock('@/lib/restaurant-test-api',()=>({restaurantTestApi:{
 reservationLink:async()=>({data:{url:'https://fixture.invalid/reserve'}}),listStores:async()=>({data:{stores:[{id:'s',name:'人工店舗'}]}}),storeContext:async()=>({data:{selectedStore:{id:'s'}}}),
 mediaLinks:async()=>({data:[]}),closeNotificationSettings:async()=>({data:{recipientMode:'responsible',membershipIds:[]}}),snapshot:net.snapshot,
}}))
import BookingMedia from './screen'
afterEach(()=>{cleanup();vi.clearAllMocks()})
it.each(['channels','members'])('booking media %s read failure is visible and retryable',async(kind)=>{
 net.fetch.mockResolvedValue({data:[]});net.snapshot.mockResolvedValue({data:{memberships:[]}})
 if(kind==='channels')net.fetch.mockRejectedValueOnce(new Error('人工取得失敗'))
 else net.snapshot.mockRejectedValueOnce(new Error('人工取得失敗'))
 render(<BookingMedia/>)
 const title=kind==='channels'?'媒体を読み込めませんでした':'知らせるスタッフを読み込めませんでした'
 const error=await screen.findByText(title)
 fireEvent.click(error.closest('[data-list-state="error"]')!.querySelector('button')!)
 await waitFor(()=>expect(screen.queryByText(title)).toBeNull())
})
