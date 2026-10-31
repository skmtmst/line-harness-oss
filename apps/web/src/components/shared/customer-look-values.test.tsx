// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {DEFAULT_CUSTOMER_LOOK,type VisitStampCard} from '@line-crm/shared'
import CustomerLookPreview from './customer-look-preview'
import styles from './customer-look-preview.module.css'
import {ApiError} from '@/lib/api'
const api=vi.hoisted(()=>({cards:vi.fn()}))
vi.mock('@/lib/visit-stamps-api',()=>({visitStampsApi:api}))
const card=(accountId:string,slots:number):VisitStampCard=>({id:accountId,name:`${accountId}のカード`,accountIds:[accountId],expectedVersion:1,version:1,active:true,settings:{mode:'visit',amountUnit:100,maxPerVisit:1,firstVisitBonus:0,expiryMonths:null,timezone:'Asia/Tokyo',multipliers:[],rankMultipliers:[],slotCount:slots,rewards:[{id:'reward',name:'特典',stamps:slots}]}})
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));api.cards.mockResolvedValue({success:true,data:[card('a',10),card('b',4)]})})
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks()})
it('予約と履歴は実際の日本時間の曜日を同じ選択日から作る',()=>{
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="検証商店" accountId="a"/> )
 expect(view.container.querySelector(`.${styles.footer} p`)?.textContent).toBe('10月6日（火）13:00')
 fireEvent.click(screen.getByRole('tab',{name:'予約の履歴'}))
 expect(screen.getByText('10月6日（火）13:00')).toBeTruthy()
})
it.each([['2026-12-31T15:00:00Z','1月1日（金）13:00'],['2028-02-28T15:00:00Z','2月29日（火）13:00']])('日本時間の年越し・うるう日も暦と一致する: %s',(at,expected)=>{
 vi.setSystemTime(new Date(at));const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="検証商店" accountId="a"/> )
 expect(view.container.querySelector(`.${styles.footer} p`)?.textContent).toBe(expected)
})
it('スタンプは同じ店の保存済み設定の10マスを読み、他店の4マスを混ぜない',async()=>{
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="検証商店" accountId="a"/> )
 expect(api.cards).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('tab',{name:'来店スタンプ'}))
 await waitFor(()=>expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(10))
 expect(view.container.textContent).toContain('aのカード');expect(view.container.textContent).not.toContain('あと2回')
 expect(api.cards).toHaveBeenCalledTimes(1)
})
it('店を替えた直後から前のカードを消し、遅い前店の応答も表示しない',async()=>{
 let finish:(value:unknown)=>void=()=>{}
 api.cards.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({success:true,data:[card('a',10),card('b',4)]})
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店A" accountId="a"/> )
 fireEvent.click(screen.getByRole('tab',{name:'来店スタンプ'}));await waitFor(()=>expect(api.cards).toHaveBeenCalledTimes(1))
 view.rerender(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店B" accountId="b"/> )
 expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(0)
 await waitFor(()=>expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(4))
 await act(async()=>finish({success:true,data:[card('a',10)]}))
 expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(4)
 expect(view.container.textContent).not.toContain('aのカード')
})
it('カード未作成と取得失敗を分け、どちらにも固定のマス数を作らない',async()=>{
 api.cards.mockResolvedValueOnce({success:true,data:[]}).mockRejectedValueOnce(new Error('failed'))
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店A" accountId="a"/> )
 fireEvent.click(screen.getByRole('tab',{name:'来店スタンプ'}))
 await screen.findByText('この店のスタンプカードはまだありません')
 expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(0)
 view.rerender(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店B" accountId="b"/> )
 await screen.findByText('スタンプカードを読み込めませんでした')
 expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(0)
})
it('旧カードは保存された特典のマス数を使い、未設定を10や5で埋めない',async()=>{
 const legacy=card('a',7);delete legacy.settings.slotCount
 api.cards.mockResolvedValueOnce({success:true,data:[legacy]}).mockResolvedValueOnce({success:true,data:[{...card('b',0),settings:{...card('b',0).settings,rewards:[]}}]})
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店A" accountId="a"/> )
 fireEvent.click(screen.getByRole('tab',{name:'来店スタンプ'}))
 await waitFor(()=>expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(7))
 view.rerender(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店B" accountId="b"/> )
 await screen.findByText('マス数が未設定です');expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(0)
})
it('403では理由を残し、再試行や偽のカードは出さない',async()=>{
 api.cards.mockRejectedValue(new ApiError(403,'forbidden'))
 const view=render(<CustomerLookPreview look={DEFAULT_CUSTOMER_LOOK} accountName="店A" accountId="a"/> )
 fireEvent.click(screen.getByRole('tab',{name:'来店スタンプ'}))
 await screen.findByText('スタンプカードを見る権限がありません')
 expect(screen.queryByRole('button',{name:'もう一度読み込む'})).toBeNull();expect(view.container.querySelectorAll('[data-stamp-slot]')).toHaveLength(0)
})
