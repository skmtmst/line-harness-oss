// @vitest-environment happy-dom
import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import TodayView from './today'
import {reservation,tables} from '../booking-kit/test-data'
const floor={id:'floor',storeId:'store-1',name:'1階',width:600,height:400,version:1,outline:[],fixtures:[],tables:tables.map((t,i)=>({id:t.id,x:i*90,y:0,width:80,height:64,rotation:0,shape:'rectangle'}))}
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'account-1'})}))
vi.mock('./use-ledger-floor',()=>({useLedgerFloor:()=>({floor,error:null,reload:vi.fn()})}))
const booking=reservation('unassigned',{customer_name:'未配席のお客さま',table_id:null,starts_at:'2026-10-31T12:00:00Z',ends_at:'2026-10-31T14:00:00Z'})
const props={rows:[booking] as never,later:[],tables,day:new Date('2026-10-31T00:00:00+09:00'),isToday:false,busy:false,canWrite:false,source:'all',onSource:vi.fn(),onDay:vi.fn(),onAdd:vi.fn(),onOpen:vi.fn(),onDetail:vi.fn(),onReload:vi.fn(),storeId:'store-1',onView:vi.fn()}
afterEach(()=>{cleanup();vi.clearAllMocks()})
it.each([{list:[]},{list:tables.map(t=>({...t,is_active:0}))}])('卓が未設定・全卓停止でも未配席予約を開ける',({list})=>{
 const open=vi.fn();render(<TodayView {...props} tables={list} onDetail={open}/>)
 const board=document.querySelector('[data-reservation-board]')! as HTMLElement
 const unassigned=within(board).getByRole('region',{name:'未配席の予約'})
 expect(unassigned.previousElementSibling?.textContent).toBe('未配席')
 fireEvent.click(within(unassigned).getByRole('button',{name:'未配席のお客さま・21:00〜23:00・2名'}))
 expect(open).toHaveBeenCalledWith('unassigned')
 expect(screen.queryByText('利用できる卓がありません')).toBeNull()
})
it('時間の卓は卓番の自然順で並び、結合グループが分かる',()=>{
 const list=[{...tables[2],floor_y:0},{...tables[0],floor_y:10},{...tables[1],floor_y:20}]
 const {container}=render(<TodayView {...props} tables={list}/>)
 expect([...container.querySelectorAll('[data-resource-id]')].map(e=>e.getAttribute('data-resource-id'))).toEqual(['t1','t2','t3'])
 expect(container.querySelector('[data-resource-id="t2"]')?.previousElementSibling?.getAttribute('title')).toContain('結合 A')
})
it('座席表でも未配席を残し、使っていない停止卓を描かない',()=>{
 const {container}=render(<TodayView {...props}/>)
 fireEvent.click(screen.getByRole('button',{name:'座席表'}))
 const board=container.querySelector('[data-reservation-board]')! as HTMLElement
 const unassigned=within(board).getByRole('region',{name:'未配席の予約'})
 expect(unassigned.previousElementSibling?.textContent).toBe('未配席')
 fireEvent.click(within(unassigned).getByRole('button',{name:'未配席のお客さま・21:00〜23:00・2名'}))
 expect(props.onDetail).toHaveBeenCalledWith('unassigned')
 expect(within(board).queryByRole('button',{name:/pb/})).toBeNull()
})

it('結合予約の2卓目だけが停止中でも、列と図から外さない',()=>{
 const joined={...booking,table_id:'t1',table_ids_json:JSON.stringify(['t1','t2'])}
 const list=tables.map(t=>({...t,is_active:t.id==='t2'?0:t.is_active}))
 const {container}=render(<TodayView {...props} rows={[joined] as never} tables={list}/>)
 expect(container.querySelector('[data-resource-id="t2"]')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'座席表'}))
 expect(screen.getByRole('button',{name:/T2.*停止中/})).toBeTruthy()
})
it('21時から23時までの予約は終端まで描き、22時で切らない',()=>{
 const row={...booking,table_id:'t1'}
 const {container}=render(<TodayView {...props} rows={[row] as never}/>)
 const track=container.querySelector('[data-resource-id="t1"]')! as HTMLElement
 const button=within(track).getByRole('button',{name:/未配席のお客さま/})
 const box=button.parentElement!
 expect(button.textContent).toContain('21:00〜23:00')
 expect(screen.getByText('23:00',{exact:true})).toBeTruthy()
 expect(parseFloat(box.style.left)+parseFloat(box.style.width)).toBeCloseTo(100)
})

it.each([10,11])('昼の%d時からの予約でも終端を出し、直前の文字を詰めない',hour=>{
 const row={...booking,table_id:'t1',starts_at:`2026-10-31T${String(hour).padStart(2,'0')}:00:00+09:00`}
 render(<TodayView {...props} rows={[row] as never}/>)
 const ruler=screen.getByRole('group',{name:'時間の目盛り'})
 expect(within(ruler).getByText('23:00')).toBeTruthy()
 expect(within(ruler).getByText(`${hour}:00`)).toBeTruthy()
 expect(within(ruler).queryByText('22:00')).toBeNull()
})

it('当日の数は開始日で数え、退店済みは未配席に数えない',()=>{
 const prior={...booking,id:'prior',starts_at:'2026-10-30T14:00:00Z',ends_at:'2026-10-30T16:00:00Z'}
 const completed={...booking,id:'departed',customer_name:'退店済み',departed_at:'2026-10-31T13:00:00Z'}
 const current={...booking,id:'current',customer_name:'当日の予約'}
 const linked={...booking,id:'linked',customer_name:'結合済み',table_ids_json:JSON.stringify(['t1'])}
 const {container}=render(<TodayView {...props} rows={[prior,completed,current,linked] as never}/>)
 const labels=[...container.querySelectorAll('[data-kpi-label]')]
 const card=(label:string)=>labels.find(node=>node.textContent?.trim()===label)?.closest('[data-kpi-presentation]')
 expect(card('選んだ日の予約')?.textContent).toContain('3件')
 expect(card('今日の予約')).toBeUndefined()
 expect(card('未配席')?.textContent).toContain('1件')
})

it('今日を開いている時は今日の予約と表示する',()=>{
 const {container}=render(<TodayView {...props} isToday />)
 expect([...container.querySelectorAll('[data-kpi-label]')].some(node=>node.textContent?.trim()==='今日の予約')).toBe(true)
})
