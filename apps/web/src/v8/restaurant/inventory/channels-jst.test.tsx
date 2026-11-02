// @vitest-environment happy-dom
import React from 'react'
import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
const calls=vi.hoisted(()=>({fetch:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}))
vi.mock('@/lib/api',async(o)=>({...await o<typeof import('@/lib/api')>(),fetchApi:calls.fetch}))
vi.mock('@/lib/restaurant-test-api',()=>({restaurantTestApi:{listIntakeAddresses:async()=>({data:[]})}}))
vi.mock('@/components/shared/date-time-field',async(o)=>({...await o<typeof import('@/components/shared/date-time-field')>(),default:({onChange,...props}:React.ComponentProps<typeof import('@/components/shared/date-time-field').default>)=><input {...props} onChange={e=>onChange(e.target.value)}/>}))
import ChannelsBoard from './channels'
afterEach(cleanup)
it('OP-R05 manual intake stores Japan local time regardless of device timezone',async()=>{
 calls.fetch.mockImplementation(async(url:string,options?:{method?:string})=>options?.method==='POST'?{success:true}:url.includes('inbound-emails')?{data:[{id:'e',receivedAt:'2026-10-20T01:00:00Z',status:'quarantined'}],total:1}:{data:[]})
 render(<ChannelsBoard accountId="a" storeId="s" date="2026-10-20" canEdit />)
 fireEvent.click(await screen.findByRole('button',{name:'手で直して取り込む'}))
 fireEvent.change(screen.getByLabelText('お客さまのお名前'),{target:{value:'人工客'}})
 fireEvent.change(screen.getByLabelText('来店の日時'),{target:{value:'2026-10-20T10:00'}})
 fireEvent.click(screen.getByRole('button',{name:'台帳へ取り込む'}))
 await waitFor(()=>expect(calls.fetch.mock.calls.some(([,o])=>o?.method==='POST')).toBe(true))
 const body=JSON.parse(calls.fetch.mock.calls.find(([,o])=>o?.method==='POST')![1].body)
 expect(body.startsAt).toBe('2026-10-20T01:00:00.000Z')
})

it('予約経路は状態の色で示し、受け取り方を省略せず示す', async () => {
 const common = {todayCount:0,lastReceivedAt:null,unreadableCount:0,receiveMethod:'email_forward',daysWithoutReceipt:0}
 calls.fetch.mockImplementation(async(url:string)=>url.includes('inbound-emails')?{data:[],total:0}:{data:[
  {...common,id:'active',code:'hotpepper',name:'経路A',status:'receiving'},
  {...common,id:'stopped',code:'retty',name:'経路B',status:'not_receiving',daysWithoutReceipt:7},
  {...common,id:'pending',code:'google',name:'経路C',status:'preparing',daysWithoutReceipt:null},
 ]})
 render(<ChannelsBoard accountId="a" storeId="s" date="2026-10-20" canEdit />)
 const rows = await screen.findAllByRole('row')
 const row = (name:string) => rows.find(item => within(item).queryByText(name))!
 for (const name of ['経路A','経路B','経路C']) expect(row(name).querySelector('[data-source]')).toBeNull()
 expect(within(row('経路C')).getByText('メール転送')).toBeTruthy()
 expect(within(row('経路C')).getByText('未設定').closest('[data-tone]')?.getAttribute('data-tone')).toBe('neutral')
 expect(within(row('経路A')).getByText('届いている').closest('[data-tone]')?.getAttribute('data-tone')).toBe('success')
 expect(within(row('経路B')).getByText('7日届いていない').closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning')
})
