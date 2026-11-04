'use client'
import { useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronDown, ChevronRight, History, Info, Pencil, Plus, Utensils } from 'lucide-react'
import { HOURS_WEEKDAYS, upcomingHolidayGroups, hoursDateAdd, hoursDateRange } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import HoursWorkspaceFrame from '@/components/templates/hours-workspace-frame'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import Card from '@/components/shared/card'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { HoursCalendarPage } from './hours-calendar-page'
import { restaurantGoogleApi, type GoogleDayHours } from '@/lib/restaurant-google-api'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useGooglePermission } from './use-google-permission'
import { useHoursWorkspace } from './use-hours-workspace'
import { HoursEditPanel, type HoursPanel } from './hours-edit-panel'
import { HoursConfirm } from './hours-confirm'
import { dateLabel, hasHoursDraft, hoursText, workspaceDay } from './hours-model'
import { WEEKDAY_JA, errorMessage, formatShortStamp } from './format'
import styles from './hours.module.css'

export default function HoursPage({ accountId, tabs, initialMode, initialDate }: {accountId:string;tabs:ReactNode;initialMode?:string|null;initialDate?:string|null}) {
 const m=useHoursWorkspace(accountId)
 const {allowed,lockedReason,known}=useGooglePermission('manager')
 const [panel,setPanel]=useState<HoursPanel|null>(()=>initialMode?initialMode==='weekly'?{kind:'weekly'}:initialMode==='text'?{kind:'text'}:{kind:'dates',dates:initialDate?[initialDate]:[]}:null)
 const [expanded,setExpanded]=useState(false),[history,setHistory]=useState(false),[calendar,setCalendar]=useState(false),[month,setMonth]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[sent,setSent]=useState<'google'|'local'|null>(null)
 const [calendarDate,setCalendarDate]=useState('')
 const operation=useRef(false)
 const {leaveTarget,confirmLeave,cancelLeave}=useUnsavedGuard({dirty:!m.saved,busy:busy||m.saving})
 const review=async()=>{if(!allowed||operation.current)return;operation.current=true;setBusy(true);setActionError('');try{await m.review();setPanel(null);setConfirm(true);setSent(null)}catch(e){setActionError(errorMessage(e,'変更内容を確認できませんでした。入力内容は残っています。'))}finally{setBusy(false);operation.current=false}}
 const send=async()=>{if(!allowed||operation.current||!m.data)return;operation.current=true;setBusy(true);setActionError('');try{for(const change of m.changes){if(['applied','accepted'].includes(change.status))continue;await restaurantGoogleApi.sendChange(accountId,change.id)}const google=m.changes.length>0;await m.complete(google);setConfirm(false);setSent(google?'google':'local')}catch(e){setActionError(errorMessage(e,'Googleに送信できませんでした。入力した内容は残っています。'));const refreshed=await Promise.all(m.changes.map(c=>restaurantGoogleApi.change(accountId,c.id).catch(()=>null)));m.setChanges(m.changes.map((c,i)=>refreshed[i]?.change??c))}finally{setBusy(false);operation.current=false}}
 const close=()=>{void m.flush().then(()=>setPanel(null)).catch(()=>undefined)}
 const open=(value:HoursPanel)=>{setSent(null);setActionError('');setPanel(value)}
 if(m.loading)return <PageFrame kind="list"><ListState kind="loading" title="営業時間を読み込んでいます"/></PageFrame>
 if(m.error||!m.data||!m.config)return <PageFrame kind="list"><ListState kind="error" title="営業時間を表示できませんでした" description={m.error} onRetry={()=>void m.load()}/></PageFrame>
 const {data,config,workspace}=m,today=data.today.date,weekly=workspace.draft.weekly??data.profile.regularHours
 const groups=upcomingHolidayGroups(config.holidays,today)
 const day=(date:string)=>workspaceDay(date,data,workspace,config.holidays)
 const current=day(today),disabled=!allowed||data.closed||busy
 const special=[...new Map<string,GoogleDayHours>([...data.profile.specialHours,...workspace.draft.days].map(d=>[d.date,d])).values()].filter(d=>d.date>=today&&!d.remove).sort((a,b)=>a.date.localeCompare(b.date))
 const ranges:Array<{start:string;end:string;closed:boolean;periods:typeof current.periods;memo:string}>=[]
 for(const d of special){const last=ranges.at(-1),memo=workspace.notes[d.date]??'';if(last&&hoursDateAdd(last.end,1)===d.date&&last.closed===d.closed&&JSON.stringify(last.periods)===JSON.stringify(d.periods)&&last.memo===memo)last.end=d.date;else ranges.push({start:d.date,end:d.date,closed:d.closed,periods:d.periods,memo})}
 const changed=hasHoursDraft(workspace)
 return <><HoursWorkspaceFrame context={<span>{data.profile.title??data.store.name} · {data.timeZone==='Asia/Tokyo'?'日本時間':data.timeZone}</span>}><div className={styles.tabs}>{tabs}</div>
  {confirm?<HoursConfirm data={data} workspace={workspace} changes={m.changes} onBack={()=>setConfirm(false)} onSend={()=>void send()} busy={busy} disabled={disabled} lockedReason={lockedReason} error={actionError}/>:calendar?<HoursCalendarPage data={data} workspace={workspace} holidays={config.holidays} month={month||today.slice(0,7)} onMonth={setMonth} selected={calendarDate||today} onSelect={setCalendarDate} onBack={()=>setCalendar(false)} onEdit={dates=>open({kind:'dates',dates,mode:dates.length>1?'range':'dates'})} onRemove={dates=>{const pending=workspace.draft.days.filter(d=>!dates.includes(d.date));for(const date of dates)if(data.profile.specialHours.some(d=>d.date===date))pending.push({date,closed:!weekly[HOURS_WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7]].length,periods:weekly[HOURS_WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7]],remove:true});m.update({...workspace,draft:{...workspace.draft,days:pending,reviewIds:[]}})}} onReview={()=>void review()} disabled={disabled} changed={changed}/>:<div className={styles.content}>
   <PageHeading title="営業時間" titleSize="workspace" inset="none" separator="none" actions={<div className={styles.actions}><Button variant="text" size="compact" lockedReason={lockedReason} disabled={disabled} onClick={()=>open({kind:'text'})}>文章で入力</Button><Button size="compact" icon={<History size={15}/>} onClick={()=>setHistory(true)}>変更履歴</Button></div>}/>
   {known&&!allowed?<ReadOnlyNotice need="manager"/>:null}
   {data.closed?<Notice tone="warn">Google側で臨時休業または閉業になっているため、営業時間を変更できません。</Notice>:null}
   {m.saveError?<Notice tone="danger">{m.saveError}</Notice>:null}
   {actionError?<Notice tone="danger" action={<Button size="compact" onClick={()=>void review()} disabled={disabled}>もう一度確認する</Button>}>{actionError}</Notice>:null}
   <Card contentPadding="var(--space-16) var(--space-20)" layout="horizontal" gap="normal"><div className={styles.today}><span className={styles.muted}>本日 {dateLabel(today,today,Boolean(data.today.holidayName))}</span><div className={styles.todayLine}><strong className={styles.todayTitle}>{current.closed?'本日は休業':hoursText(current.periods)}</strong><span className={styles.muted}>{data.today.holidayName??(!current.periods.length?`${WEEKDAY_JA[data.today.weekday]}曜日の定休日`:'')}</span></div></div><Button size="compact" icon={<Pencil size={14}/>} disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'dates',dates:[today]})}>今日の時間を変更</Button></Card>
   <div className={styles.columns}>
    <Card contentPadding="var(--space-20)" layout="vertical" gap="normal"><div className={styles.splitRow}><h2>毎週の営業時間</h2><Button variant="text" size="compact" disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'weekly'})}>まとめて編集</Button></div>
     <div className={styles.weekList}>{HOURS_WEEKDAYS.map(w=><div className={styles.weekRow} key={w}><span>{WEEKDAY_JA[w]}曜日</span><span className={!weekly[w].length?styles.closed:undefined}>{hoursText(weekly[w],'定休日')}</span><IconButton variant="plain" size="row" aria-label={`${WEEKDAY_JA[w]}曜日を編集`} disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'weekly',weekday:w})}><Pencil size={14}/></IconButton></div>)}</div>
     <div className={styles.holidayLine}><CalendarDays size={18} aria-hidden="true"/><div><strong>祝日 {workspace.holiday.mode==='weekly'?'曜日どおりに営業':workspace.holiday.mode==='closed'?'休業':hoursText(workspace.holiday.periods)}</strong>{workspace.holiday.mode!=='weekly'?<p className={styles.muted}>{workspace.holiday.overrideClosedWeekday?'定休日でも祝日用の設定を適用':'定休日は休業'}</p>:null}</div><Button variant="text" size="compact" lockedReason={lockedReason} disabled={disabled} onClick={()=>open({kind:'holiday'})}>変更</Button></div>
    </Card>
    <div className={styles.stack}><Card contentPadding="var(--space-20)" layout="vertical" gap="normal"><div className={styles.splitRow}><h2>祝日・特定の日の営業時間</h2><Button variant="text" size="compact" disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'dates'})}>日付を指定</Button></div>
     {groups.map(group=>group.holidays.length>1?<div className={styles.holidayGroup} key={group.start}><strong>{dateLabel(group.start,today)} – {dateLabel(group.end,today,true)} · {group.dates.length}日間</strong>{group.dates.map(date=><div className={styles.specialRow} key={date}><div><strong>{dateLabel(date,today,config.holidays.some(h=>h.date===date))}</strong><p className={day(date).closed?styles.muted:styles.green}>{hoursText(day(date).periods)}</p>{config.holidays.find(h=>h.date===date)?.name?<span className={styles.muted}>{config.holidays.find(h=>h.date===date)?.name}</span>:null}</div><IconButton variant="plain" size="row" aria-label={`${dateLabel(date,today)}の時間を編集`} disabled={disabled} onClick={()=>open({kind:'dates',dates:[date]})}><ChevronRight size={15}/></IconButton></div>)}<Button variant="text" size="compact" disabled={disabled} onClick={()=>open({kind:'dates',dates:group.dates.filter(date=>!special.some(d=>d.date===date&&d.closed)),group:group.dates.map(date=>({date,name:config.holidays.find(h=>h.date===date)?.name}))})}>連休をまとめて設定</Button></div>:group.holidays.map(h=><div className={styles.specialRow} key={h.date}><div><strong>{dateLabel(h.date,today,true)} {h.name}</strong><div className={styles.specialHours}><strong className={day(h.date).closed?styles.muted:styles.green}>{hoursText(day(h.date).periods)}</strong><span className={styles.muted}>{workspace.notes[h.date]||(group.dates.length>1?`${Number(group.start.slice(5,7))}/${Number(group.start.slice(-2))}–${Number(group.end.slice(-2))}の連休`:'')}</span></div></div><IconButton variant="plain" size="row" aria-label={`${h.name}の営業時間を編集`} disabled={disabled} onClick={()=>open({kind:'dates',dates:[h.date]})}><ChevronRight size={15}/></IconButton></div>))}
     {ranges.length?<div className={styles.stack}><p className={styles.muted}>日付を指定した変更</p>{ranges.slice(0,4).map(r=><div className={styles.splitRow} key={r.start}><div><strong className={styles.rangeSummary}>{dateLabel(r.start,today)}{r.end!==r.start?` – ${dateLabel(r.end,today)}`:''} {r.memo||hoursText(r.periods)}</strong>{r.closed?<p className={styles.muted}>この期間は、祝日も休業になります。</p>:null}</div><IconButton variant="plain" size="row" aria-label={`${dateLabel(r.start,today)}の変更を編集`} disabled={disabled} onClick={()=>open({kind:'dates',dates:hoursDateRange(r.start,r.end),mode:r.start===r.end?'dates':'range'})}><Pencil size={14}/></IconButton></div>)}</div>:null}
    </Card><Button variant="text" size="compact" onClick={()=>{setMonth(today.slice(0,7));setCalendarDate(today);setCalendar(true)}}>カレンダーで営業予定を見る</Button></div>
   </div>
   <Card contentPadding="var(--space-20)" layout="vertical" gap="normal"><div className={styles.splitRow}><div className={styles.actions}><Utensils size={18}/><h2>サービス別の営業時間</h2><span className={styles.muted}>{workspace.services.length}種類</span></div><Button variant="text" size="compact" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)} icon={<ChevronDown size={15}/>}>{expanded?'閉じる':'開く'}</Button></div>
    {expanded?<div className={styles.stack}>{workspace.services.map(s=><div className={styles.serviceRow} key={s.id}><div><strong>{s.label}</strong><p className={styles.muted}>{s.sameWeekdays?'店舗と同じ営業日':s.weekdays.map(d=>WEEKDAY_JA[d]).join('・')+'曜日'}</p></div><strong>{hoursText(s.periods)}</strong><div className={styles.muted}>{s.orderDeadline?`受付終了 ${s.orderDeadline}`:''}{s.menu?<p>{s.menu}</p>:null}</div><Button size="compact" disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'service',service:s})}>編集</Button></div>)}<div><Button variant="text" size="compact" icon={<Plus size={15}/>} disabled={disabled} lockedReason={lockedReason} onClick={()=>open({kind:'service'})}>営業時間を追加</Button></div></div>:null}
   </Card>
   {sent?<Notice tone="success" heading={sent==='google'?'Googleに営業時間の変更を送信しました':'営業時間の設定を保存しました'}>{sent==='google'?'Googleの表示が変わるまで、時間がかかる場合があります。':''}</Notice>:changed?<div className={styles.updateBar}><Info size={18}/><div><strong>Googleの営業時間を更新</strong><p className={styles.muted}>変更内容を確認してから、Googleに反映できます。</p></div><Button variant="primary" size="compact" disabled={disabled||!m.saved} lockedReason={lockedReason} busy={busy} onClick={()=>void review()}>変更内容を確認</Button></div>:null}
  </div>}
  </HoursWorkspaceFrame>
  {panel?<HoursEditPanel key={JSON.stringify(panel)} panel={panel} data={data} workspace={workspace} holidays={config.holidays} serviceTypes={config.serviceTypes??[]} onDraft={m.update} onReview={()=>void review()} onClose={close} onEditDates={dates=>setPanel({kind:'dates',dates})} saving={m.saving||busy} saved={m.saved} disabled={disabled} lockedReason={lockedReason}/>:null}
  <Drawer open={history} title="営業時間の変更履歴" width="hours" headerIcon={false} heightMode="viewport" onClose={()=>setHistory(false)} footer={<Button size="compact" onClick={()=>setHistory(false)}>閉じる</Button>}><div className={styles.stackLarge}>{config.history.length?config.history.map((event,i)=><div className={styles.historyRow} key={`${event.at}-${i}`}><p className={styles.muted}>{formatShortStamp(event.at)}</p><strong>{event.summary}</strong><span className={styles.muted}>{event.staffName}</span></div>):<ListState kind="empty" title="営業時間の変更履歴はありません"/>}</div></Drawer>
  <UnsavedLeaveDialog open={leaveTarget!==null} subject="保存中の営業時間" onConfirm={confirmLeave} onCancel={cancelLeave}/>
 </>
}
