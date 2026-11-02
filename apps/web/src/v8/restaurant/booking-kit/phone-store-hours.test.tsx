// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PhoneReservation from '../reservations/phone'
import PhoneReservationDrawer from '../front-desk/phone-drawer'
import { tables } from './test-data'

const api = vi.hoisted(() => ({ openingHours: vi.fn(), reservationsDay: vi.fn(), customerSearch: vi.fn(), customerHistory: vi.fn(), createReservation: vi.fn() }))
const scope = vi.hoisted(() => ({ account: 'account-a' }))
vi.mock('@/lib/restaurant-test-api', () => ({ restaurantTestApi: api }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: scope.account }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/restaurant-test/reservations', useSearchParams: () => new URLSearchParams() }))
const hours = (start: string, end: string) => Array.from({length:7}, (_, weekday) => ({weekday, periods:[{opensAt:start,closesAt:end}]}))
const aHours=hours('17:00','23:00'), bHours=hours('12:00','16:00'), cHours=hours('13:00','17:00')
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve=r }); return {promise,resolve} }
const onSave=vi.fn()
type Entry = 'page' | 'drawer'
function node(entry: Entry, account: string, store: string) {
 if (entry==='drawer') return <PhoneReservationDrawer open accountId={account} storeId={store} tables={tables} onClose={vi.fn()} onSaved={vi.fn()} />
 return <PhoneReservation storeId={store} storeName="人工店舗" tables={tables} menuItems={[]} busy={false} preset={{hold:true,date:new Date('2026-11-03T00:00:00+09:00'),time:''}} onBack={vi.fn()} onSave={onSave} />
}
const slot=(t:string)=>screen.queryByRole('button',{name:t,exact:true})
beforeEach(()=>{scope.account='account-a'; vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-02T12:00:00+09:00')); api.openingHours.mockResolvedValue({data:{hours:aHours}});api.reservationsDay.mockResolvedValue({data:{reservations:[]}});api.customerSearch.mockResolvedValue({data:[]});api.customerHistory.mockResolvedValue({data:{visitCount:0,visits:[]}}); api.createReservation.mockResolvedValue({data:{lineNotice:{sent:false}}});onSave.mockResolvedValue(false)})
afterEach(()=>{cleanup();vi.useRealTimers();vi.resetAllMocks()})
it.each<Entry>(['page','drawer'])('%s 店舗切替後の営業時間待ちでは旧時間を選択・保存できない',async entry=>{
 const slow=deferred<{data:{hours:typeof bHours}}>();api.openingHours.mockImplementation((_account:string,store:string)=>store==='store-a'?Promise.resolve({data:{hours:aHours}}):slow.promise)
 const view=render(node(entry,'account-a','store-a'))
 if(entry==='drawer'){fireEvent.change(screen.getByRole('textbox',{name:'お名前'}),{target:{value:'架空客'}});fireEvent.click(screen.getByRole('button',{name:/明日/}))}
 fireEvent.click(await screen.findByRole('button',{name:'19:00',exact:true}))
 view.rerender(node(entry,'account-a','store-b'))
 await waitFor(()=>expect(api.openingHours).toHaveBeenCalledWith('account-a','store-b'))
 expect(slot('19:00')).toBeNull()
 if(entry==='page')fireEvent.submit(document.querySelector('form')!)
 else fireEvent.click(screen.getByRole('button',{name:'予約を入れる'}))
 expect(onSave).not.toHaveBeenCalled();expect(api.createReservation).not.toHaveBeenCalled()
 await act(async()=>slow.resolve({data:{hours:bHours}}))
 await waitFor(()=>expect(slot('12:00')).not.toBeNull())
 expect(slot('19:00')).toBeNull()
 if(entry==='page') fireEvent.submit(document.querySelector('form')!)
 else expect((screen.getByRole('button',{name:'予約を入れる'}) as HTMLButtonElement).disabled).toBe(true)
 expect(onSave).not.toHaveBeenCalled();expect(api.createReservation).not.toHaveBeenCalled()
})
it.each<Entry>(['page','drawer'])('%s 遅い旧店舗応答は現在の店舗の営業時間を上書きしない',async entry=>{
 const old=deferred<{data:{hours:typeof bHours}}>();api.openingHours.mockImplementation((_account:string,store:string)=>store==='store-a'?Promise.resolve({data:{hours:aHours}}):store==='store-b'?old.promise:Promise.resolve({data:{hours:cHours}}))
 const view=render(node(entry,'account-a','store-a'))
 if(entry==='drawer')fireEvent.click(screen.getByRole('button',{name:/明日/}))
 await screen.findByRole('button',{name:'19:00',exact:true})
 view.rerender(node(entry,'account-a','store-b'));await waitFor(()=>expect(api.openingHours).toHaveBeenCalledWith('account-a','store-b'))
 view.rerender(node(entry,'account-a','store-c'));await screen.findByRole('button',{name:'13:00',exact:true})
 await act(async()=>old.resolve({data:{hours:bHours}}))
 expect(slot('13:00')).not.toBeNull();expect(slot('12:00')).toBeNull()
})
it.each<Entry>(['page','drawer'])('%s 同じ店舗IDでアカウントが変わっても旧営業時間を使わない',async entry=>{
 const slow=deferred<{data:{hours:typeof bHours}}>();api.openingHours.mockImplementation((account:string)=>account==='account-a'?Promise.resolve({data:{hours:aHours}}):slow.promise)
 const view=render(node(entry,'account-a','store-a'))
 if(entry==='drawer')fireEvent.click(screen.getByRole('button',{name:/明日/}))
 await screen.findByRole('button',{name:'19:00',exact:true})
 scope.account='account-b';view.rerender(node(entry,'account-b','store-a'))
 await waitFor(()=>expect(api.openingHours).toHaveBeenCalledWith('account-b','store-a'))
 expect(slot('19:00')).toBeNull()
 await act(async()=>slow.resolve({data:{hours:bHours}}));await screen.findByRole('button',{name:'12:00',exact:true})
})
it.each<Entry>(['page','drawer'])('%s 新店舗の予約一覧が待機中は保存できず、到着後に保存できる',async entry=>{
 const slow=deferred<{data:{reservations:[]}}>();api.reservationsDay.mockImplementation((_account:string,store:string)=>store==='store-b'?slow.promise:Promise.resolve({data:{reservations:[]}}))
 const view=render(node(entry,'account-a','store-a'))
 if(entry==='drawer'){fireEvent.change(screen.getByRole('textbox',{name:'お名前'}),{target:{value:'架空客'}});fireEvent.click(screen.getByRole('button',{name:/明日/}))}
 fireEvent.click(await screen.findByRole('button',{name:'19:00',exact:true}))
 view.rerender(node(entry,'account-a','store-b'));await waitFor(()=>expect(api.reservationsDay).toHaveBeenCalledWith('account-a','store-b',expect.any(String)))
 await screen.findByRole('button',{name:'19:00',exact:true})
 if(entry==='page')fireEvent.submit(document.querySelector('form')!)
 else expect((screen.getByRole('button',{name:'予約を入れる'}) as HTMLButtonElement).disabled).toBe(true)
 expect(onSave).not.toHaveBeenCalled();expect(api.createReservation).not.toHaveBeenCalled()
 await act(async()=>slow.resolve({data:{reservations:[]}}))
 if(entry==='page')fireEvent.submit(document.querySelector('form')!)
 else {await waitFor(()=>expect((screen.getByRole('button',{name:'予約を入れる'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'予約を入れる'}))}
 await waitFor(()=>expect(entry==='page'?onSave:api.createReservation).toHaveBeenCalledOnce())
})
it.each<Entry>(['page','drawer'])('%s 新店舗の営業時間取得に失敗すると旧時間を復活させない',async entry=>{
 api.openingHours.mockImplementation((_account:string,store:string)=>store==='store-a'?Promise.resolve({data:{hours:aHours}}):Promise.reject(new Error('synthetic')))
 const view=render(node(entry,'account-a','store-a'))
 if(entry==='drawer')fireEvent.click(screen.getByRole('button',{name:/明日/}))
 await screen.findByRole('button',{name:'19:00',exact:true});view.rerender(node(entry,'account-a','store-b'))
 await waitFor(()=>expect(api.openingHours).toHaveBeenCalledWith('account-a','store-b'))
 expect(slot('19:00')).toBeNull();expect(onSave).not.toHaveBeenCalled();expect(api.createReservation).not.toHaveBeenCalled()
})
