'use client'
import { useState } from 'react'
import { hoursDateAdd, hoursDateRange, hoursPeriodsProblem, type OpeningDate, type OpeningPeriod } from '@line-crm/shared'
import Button from '@/components/shared/button'
import CloseButton from '@/components/shared/close-button'
import DateField from '@/components/shared/date-field'
import HoursDateCalendar from '@/components/shared/hours-date-calendar'
import { Field } from '@/components/shared/form-controls'
import Radio, { RadioGroup } from '@/components/shared/radio'
import SegmentedControl from '@/components/shared/segmented'
import { TextField } from '@/components/shared/text-field'
import Notice from '@/components/shared/notice'
import Checkbox from '@/components/shared/checkbox'
import { PeriodFields } from './hours-controls'
import { dateLabel } from './hours-model'
import styles from './hours.module.css'

export type DateEditorValue = { dates: string[]; periods: OpeningPeriod[]; closed: boolean; memo: string; remove?: boolean }
export function DateEditor({ today, initialDates=[], original, initialMode='dates', onChange, groupDates, individualDates=[], disabled=false, removableDates=[], initialMemo='', initialPeriods }: { today:string;initialDates?:string[];original:(date:string)=>OpeningDate;initialMode?:'dates'|'range';onChange:(value:DateEditorValue|null)=>void;groupDates?:Array<{date:string;name?:string}>;individualDates?:string[];disabled?:boolean;removableDates?:string[];initialMemo?:string;initialPeriods?:OpeningPeriod[] }) {
 const [mode,setMode]=useState(initialMode)
 const [dates,setDates]=useState(initialDates)
 const [start,setStart]=useState(initialDates[0]??'')
 const [end,setEnd]=useState(initialDates.at(-1)??'')
 const [month,setMonth]=useState((initialDates[0]??today).slice(0,7))
 const initial=initialDates.length?original(initialDates[0]):null
 const [closed,setClosed]=useState(initialPeriods?false:initial?.closed??true)
 const [periods,setPeriods]=useState<OpeningPeriod[]>(initialPeriods??(initial?.periods.length?initial.periods:[{open:'11:00',close:'22:00'}]))
 const [memo,setMemo]=useState(initialMemo)
 const [remove,setRemove]=useState(false)
 const max=hoursDateAdd(today,366)
 const selected=mode==='range'?hoursDateRange(start,end).filter(d=>d>=today&&d<=max):dates
 const emit=(overrides:Partial<DateEditorValue>={})=>{const v={dates:selected,closed,periods,memo,remove,...overrides};onChange(v.dates.length&&(v.closed||v.remove||!hoursPeriodsProblem(v.periods))?v:null)}
 const choose=(date:string)=>{
   if(mode==='range'){if(!start||(start&&end)){setStart(date);setEnd('');onChange(null)}else{const a=date<start?date:start,b=date<start?start:date;setStart(a);setEnd(b);emit({dates:hoursDateRange(a,b)})}}
   else{const next=dates.includes(date)?dates.filter(d=>d!==date):[...dates,date].sort();setDates(next);emit({dates:next})}
 }
 return <div className={styles.stackLarge}>
  {groupDates?<><p className={styles.muted}>同じ時間を設定する日を選んでください。</p><div className={styles.stack}>{groupDates.map(d=><Checkbox key={d.date} checked={dates.includes(d.date)} disabled={disabled} onCheckedChange={()=>choose(d.date)} description={individualDates.includes(d.date)?'休業 · 個別に変更済み':d.name??'通常の営業時間'}>{dateLabel(d.date,today,Boolean(d.name))}</Checkbox>)}</div></>:<>
   <SegmentedControl size="small" equalWidth={false} aria-label="日付の選び方" value={mode} options={[{value:'dates',label:'日付を選ぶ'},{value:'range',label:'期間で選ぶ'}]} onChange={m=>{setMode(m);setDates([]);setStart('');setEnd('');onChange(null)}}/>
   {mode==='range'?<div className={styles.twoFields}><Field optional={false} label="開始日"><DateField value={start} min={today} max={max} disabled={disabled} onChange={v=>{setStart(v);setMonth(v.slice(0,7)||month);emit({dates:hoursDateRange(v,end)})}}/></Field><Field optional={false} label="終了日"><DateField value={end} min={start||today} max={max} disabled={disabled} onChange={v=>{setEnd(v);emit({dates:hoursDateRange(start,v)})}}/></Field></div>:null}
   <HoursDateCalendar month={month} onMonth={setMonth} selected={selected} onSelect={choose} min={today} max={max} disabled={disabled}/>
  </>}
  {selected.length?<><div className={styles.dateChips}>{mode==='range'?<span>{dateLabel(selected[0],today)} – {dateLabel(selected.at(-1)!,today)} · {selected.length}日間</span>:selected.map(date=><span key={date} className={styles.dateChip}>{dateLabel(date,today)}<CloseButton disabled={disabled} onClick={()=>choose(date)} aria-label={`${date}の選択を解除`}/></span>)}</div>
   <RadioGroup label="選んだ日の営業" className={styles.stack}><Radio rowHeight="comfortable" checked={closed&&!remove} disabled={disabled} name="date-hours-state" onChange={()=>{setClosed(true);setRemove(false);emit({closed:true,remove:false})}}>休業する</Radio><Radio rowHeight="comfortable" checked={!closed&&!remove} disabled={disabled} name="date-hours-state" onChange={()=>{setClosed(false);setRemove(false);emit({closed:false,remove:false})}}>営業時間を変える</Radio></RadioGroup>
   {!closed&&!remove?<PeriodFields value={periods} disabled={disabled} onChange={p=>{setPeriods(p);emit({periods:p})}}/>:null}
   {selected.every(d=>removableDates.includes(d))?<Button variant="text" size="compact" disabled={disabled} onClick={()=>{setRemove(!remove);emit({remove:!remove})}}>{remove?'通常に戻すのをやめる':'通常の営業時間に戻す'}</Button>:null}
   <Field label="メモ" optionalAppearance="parentheses"><TextField value={memo} maxLength={200} disabled={disabled} placeholder="例：年末年始の休業" onChange={e=>{setMemo(e.target.value);emit({memo:e.target.value})}}/></Field>
   <p className={styles.muted}>メモはGoogleには掲載されません。</p>
   <Notice tone="info">選んだ{selected.length}日だけ変更します。ほかの日の営業時間は変わりません。</Notice>
   {groupDates&&individualDates.some(d=>!selected.includes(d))?<p className={styles.muted}>選択していない日の個別の休業は、そのまま維持します。</p>:null}
  </>:<p className={styles.muted}>変更する日付を選んでください。離れた日付も複数選べます。</p>}
 </div>
}
