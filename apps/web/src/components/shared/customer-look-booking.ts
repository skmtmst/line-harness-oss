import {jstCalendar,jstDateOffset} from '@line-crm/shared'

/** 曜日・選択日・確認文は同じ日本時間の暦から作る。 */
export function customerBookingSample(now:Date) {
 const calendar=jstCalendar(now),weekday=calendar.getUTCDay()
 const days=Array.from({length:7},(_,index)=>{
  const date=jstDateOffset(index-weekday,now),civil=new Date(`${date}T00:00:00Z`)
  return {key:date,day:'日月火水木金土'[civil.getUTCDay()],date:civil.getUTCDate()}
 })
 const selectedDate=jstDateOffset(0,now),month=calendar.getUTCMonth()+1,time='13:00'
 const range=days.map(day=>`${Number(day.key.slice(5,7))}/${day.date}`)
 return {days,selectedDate,time,range:`${range[0]}〜${range[6]}`,summary:`${month}月${calendar.getUTCDate()}日（${'日月火水木金土'[weekday]}）${time}`}
}
