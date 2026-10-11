// @vitest-environment happy-dom
import React from 'react'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
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
