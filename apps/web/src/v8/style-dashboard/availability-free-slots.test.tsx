// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { StyleSchedule, StyleSnapshot } from '@line-crm/shared'
import { toToday } from './adapter'
import { WeekCalendar } from './calendar'
const day='2026-10-21', from=`${day}T00:00:00+09:00`, to=`${day}T23:59:00+09:00`
const snapshot:StyleSnapshot={style:'lesson',asOf:from,from,to,timeZone:'Asia/Tokyo',dateBasis:'visit',range:'week',metrics:{},previous:{},items:[],newBookings:[],resultId:'qa'}
const slot=(hour:number,remaining:number|null)=>({columnId:'staff',menuId:'lesson',date:day,startsAt:`${day}T${hour}:00:00+09:00`,endsAt:`${day}T${hour+1}:00:00+09:00`,remaining})
const schedule:StyleSchedule={style:'lesson',asOf:from,from,to,timeZone:'Asia/Tokyo',range:'week',display:'calendar',calendarView:'week',columns:[{id:'staff',kind:'staff',name:'担当'}],entries:[{id:'class:full',kind:'class',classId:'lesson',columnIds:['staff'],startsAt:`${day}T10:00:00+09:00`,endsAt:`${day}T11:00:00+09:00`,title:'満席の回',booking:null}],days:[{date:day,entryIds:['class:full'],bookings:1,people:1}],closures:[],availability:{status:'available',reason:null,resources:[],slots:[{...slot(10,0),entryId:'class:full'},slot(11,null),slot(12,2)],closedDates:[]}}
const now=new Date(`${day}T09:00:00+09:00`)
afterEach(cleanup)
it('実APIの満席0を空きにせず、無制限nullと正の残りを日・週・面談の同じ判断で保つ',()=>{
 const today=toToday('lesson',snapshot,schedule,day,'week',now)
 expect(today.week!.free.map(s=>s.start)).toEqual(['11:00','12:00'])
 expect(today.board!.free.map(s=>s.start)).toEqual(['11:00'])
 expect(today.board!.columns[0].next).toBe('次の空き 11:00')
 expect(today.rows[0]).toMatchObject({id:'class:full',remaining:0,vacancy:'×'})
 expect(today.week!.entries.map(e=>e.id)).toEqual(['class:full'])
 const consult=toToday('consult',{...snapshot,style:'consult'},{...schedule,style:'consult'},day,'week',now)
 expect(consult.side.find(card=>card.id==='free')?.rows[0].value).toBe('11:00〜13:00')
})
it.each(['unconfigured','unavailable'] as const)('APIが%sの時は古い枠が残っても空きと案内せず、予約の本体は残す',status=>{
 const result=toToday('lesson',snapshot,{...schedule,availability:{...schedule.availability,status}},day,'week',now)
 expect(result.week!.free).toEqual([]);expect(result.board!.free).toEqual([])
 expect(result.board!.columns[0].next).toBe('空きなし');expect(result.week!.entries.map(e=>e.id)).toEqual(['class:full'])
})
it('週の満席回は詳細を開けるまま、満席時間の作成ボタンは出さず、閲覧のみでは空き操作を出さない',()=>{
 const week=toToday('lesson',snapshot,schedule,day,'week',now).week!, open=vi.fn(), create=vi.fn()
 const view=render(<WeekCalendar week={week} canWrite onOpen={open} onSlot={create} onMove={()=>{}}/>)
 expect(screen.queryByRole('button',{name:`${day} 10:00に予約を入れる`})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'10:00〜11:00 満席の回'}));expect(open).toHaveBeenCalledWith('class:full')
 fireEvent.click(screen.getByRole('button',{name:`${day} 11:00に予約を入れる`}));expect(create).toHaveBeenCalledWith(day,'11:00')
 view.rerender(<WeekCalendar week={week} canWrite={false} onOpen={open} onSlot={create} onMove={()=>{}}/>)
 expect(screen.queryByRole('button',{name:/に予約を入れる/})).toBeNull();expect(screen.getByRole('button',{name:'10:00〜11:00 満席の回'})).toBeTruthy()
})
