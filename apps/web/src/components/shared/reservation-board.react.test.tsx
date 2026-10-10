// @vitest-environment happy-dom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,createEvent,fireEvent,render,screen,waitFor} from '@testing-library/react'
import type {ReservationBoardEntry} from '@line-crm/shared'
import ReservationBoard from './reservation-board'
const entry:ReservationBoardEntry={id:'r',kind:'seats',version:4,scopeId:'s',startsAt:'2027-02-01T09:00:00Z',endsAt:'2027-02-01T11:00:00Z',status:'confirmed',customerName:'予約のお客さま',guestCount:2,resourceIds:['t1'],resourceLabel:'T1',source:'phone',courseName:null,note:null,dining:null,holdExpiresAt:null}
const resources=[{id:'t1',label:'T1',capacity:2,active:true},{id:'t2',label:'T2',capacity:2,active:true}]
afterEach(()=>{cleanup();vi.restoreAllMocks()})
describe('共通盤の操作',()=>{
 it('移動には読んだ版を送り、失敗しても元の予約を残す',async()=>{
  const move=vi.fn().mockRejectedValue(new Error('409'))
  const {container}=render(<ReservationBoard entries={[entry]} resources={resources} dates={['2027-02-01']} canWrite onOpen={()=>{}} onMove={move}/>)
  const booking=screen.getByRole('button',{name:/予約のお客さま 2名 18:00/});fireEvent.dragStart(booking)
  const track=container.querySelector('[data-resource-id="t2"]')!;vi.spyOn(track,'getBoundingClientRect').mockReturnValue({left:0,width:600} as DOMRect)
  const drop=createEvent.drop(track);Object.defineProperty(drop,'clientX',{value:100});fireEvent(track,drop);await waitFor(()=>expect(move).toHaveBeenCalledTimes(1))
  expect(move.mock.calls[0][1]).toMatchObject({kind:'seats',expectedVersion:4,tableId:'t2'})
  expect(await screen.findByText(/予約は元のまま/)).toBeTruthy();expect(screen.getByRole('button',{name:/予約のお客さま 2名 18:00/})).toBeTruthy()
 })
 it('閲覧者には変更操作を出さず、予約を読む操作を残す',()=>{
  const action=vi.fn(()=> <button>取消</button>)
  render(<ReservationBoard axis="list" entries={[entry]} resources={resources} canWrite={false} actions={action} onOpen={()=>{}}/>)
  expect(screen.queryByRole('button',{name:'取消'})).toBeNull();expect(action).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'予約のお客さま'})).toBeTruthy()
 })
 it('印刷の全ページ取得に失敗したら、途中のページを印刷しない',async()=>{
  const print=vi.spyOn(window,'print').mockImplementation(()=>{}),load=vi.fn().mockRejectedValue(new Error('network'))
  render(<ReservationBoard entries={[entry]} resources={resources} onOpen={()=>{}} loadPrintEntries={load}/>)
  fireEvent.click(screen.getByRole('button',{name:'印刷'}));expect(await screen.findByText(/印刷する予約を読み込めません/)).toBeTruthy();expect(print).not.toHaveBeenCalled()
 })
 it('印刷は読み直した全件を使い、変更のボタンを出さない',async()=>{
  let printed=''
  const print=vi.spyOn(window,'print').mockImplementation(()=>{const sheet=document.querySelector('[data-reservation-print]');printed=sheet?.textContent??document.querySelector('h2')?.parentElement?.textContent??'';expect(sheet?.parentElement).toBe(document.body);expect(sheet?.textContent).toContain('然 渋谷店');expect(sheet?.querySelector('[data-write-operation]')).toBeNull()})
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>setTimeout(()=>cb(0),0) as unknown as number)
  const second={...entry,id:'r2',customerName:'次のページのお客さま'}
  render(<ReservationBoard printContext="然 渋谷店 ／ 有効な予約" axis="list" entries={[entry]} resources={resources} canWrite actions={()=> <button>予約を取り消す</button>} onOpen={()=>{}} loadPrintEntries={async()=>[entry,second]}/>)
  fireEvent.click(screen.getByRole('button',{name:'印刷'}));await waitFor(()=>expect(print).toHaveBeenCalledTimes(1))
  expect(printed).toContain('次のページのお客さま');expect(printed).not.toContain('予約を取り消す')
 })
 it('直接来店は電話と区別し、保存元のmanualは変えない',()=>{
  render(<ReservationBoard axis="list" entries={[{...entry,source:'manual',note:'ウォークイン（予約なしの来店）'}]} resources={resources} onOpen={()=>{}}/>);expect(screen.getByText('ウォークイン')).toBeTruthy();expect(screen.queryByText('電話')).toBeNull()
 })
 it('月の切り替えでは対象月の日数を守る',()=>{
  render(<ReservationBoard axis="month" entries={[entry]} resources={resources} onOpen={()=>{}} dates={['2027-02-01']}/>)
  expect(screen.getByText('28日')).toBeTruthy();expect(screen.queryByText('31日')).toBeNull()
 })
})
