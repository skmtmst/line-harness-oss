'use client'
import { useState } from 'react'
import type { RestaurantFollowupTiming,RestaurantFollowupTrigger } from '@line-crm/shared'
import Radio,{RadioGroup} from '@/components/shared/radio'
import { Field } from '@/components/shared/form-controls'
import NumberField from '@/components/shared/number-field'
import TimeField from '@/components/shared/time-field-v8'
import Select from '@/components/shared/select'
import { SettingsFormRow } from '@/components/shared/settings-form-card'
import { exactTiming,UNIT_MINUTES,type OffsetUnit } from './config'
import { followupTimingError } from './board-model'
import styles from './board.module.css'
function CountdownField({value,before,onChange}:{value:number;before:boolean;onChange:(value:number)=>void}){
 const initial=exactTiming(Math.abs(value),['minutes','hours','days'])
 const [unit,setUnit]=useState<OffsetUnit>(initial.unit)
 return <SettingsFormRow layout="columns"><NumberField aria-label={before?'予約までの時間':'きっかけから待つ時間'} min={before?1:0} value={Number.isFinite(value)?(before?-value:value)/UNIT_MINUTES[unit]:''} onChange={e=>onChange((before?-1:1)*e.target.valueAsNumber*UNIT_MINUTES[unit])}/><Select aria-label="時間の単位" value={unit} onChange={next=>setUnit(next as OffsetUnit)} options={[{value:'minutes',label:'分'},{value:'hours',label:'時間'},{value:'days',label:'日'}]}/></SettingsFormRow>
}
export function FollowupTimingFields({trigger,value,onChange}:{trigger:RestaurantFollowupTrigger;value:RestaurantFollowupTiming;onChange:(next:RestaurantFollowupTiming)=>void}){
 const before=['reservation_24h','reservation_2h','anniversary_before'].includes(trigger),anniversary=trigger==='anniversary_before'
 const nextDay=['post_visit','review_request'].includes(trigger)
 return <Field label="いつ送るか" required error={followupTimingError(trigger,value)}>
  <RadioGroup label="送る時期" className={styles.stack}>
   {before?<>
    <Radio name="followup-timing" checked={value.mode==='time'} onChange={()=>onChange({mode:'time',offsetDays:anniversary?-7:-1,sendAtTime:anniversary?'10:00':'18:00'})}>{anniversary?'記念日の何日前・時刻':'予約の前日など、日と時刻を決める'}</Radio>
    {!anniversary&&<Radio name="followup-timing" checked={value.mode==='countdown'} onChange={()=>onChange({mode:'countdown',offsetMinutes:-120})}>予約の何時間前に送る</Radio>}
   </>:<>
    <Radio name="followup-timing" checked={value.mode==='countdown'&&value.offsetMinutes===0} onChange={()=>onChange({mode:'countdown',offsetMinutes:0})}>すぐに送る</Radio>
    <Radio name="followup-timing" checked={value.mode==='countdown'&&value.offsetMinutes!==0} onChange={()=>onChange({mode:'countdown',offsetMinutes:trigger==='post_visit'?180:5})}>きっかけから時間を置いて送る</Radio>
    {nextDay&&<Radio name="followup-timing" checked={value.mode==='next_day'} onChange={()=>onChange({mode:'next_day',sendAtTime:'10:00'})}>退店の翌日の時刻に送る</Radio>}
   </>}
  </RadioGroup>
  {value.mode==='time'?<SettingsFormRow layout="columns"><NumberField aria-label={anniversary?'記念日の何日前':'予約の何日前'} unit="日前" min={anniversary?1:0} max={365} value={-value.offsetDays} onChange={e=>onChange({...value,offsetDays:-e.target.valueAsNumber})}/><TimeField aria-label="送る時刻" value={value.sendAtTime} onChange={sendAtTime=>onChange({...value,sendAtTime})}/></SettingsFormRow>:
   value.mode==='next_day'?<TimeField aria-label="翌日の時刻" value={value.sendAtTime} onChange={sendAtTime=>onChange({...value,sendAtTime})}/>:
   value.offsetMinutes!==0?<CountdownField before={before} value={value.offsetMinutes} onChange={offsetMinutes=>onChange({mode:'countdown',offsetMinutes})}/>:null}
 </Field>
}
