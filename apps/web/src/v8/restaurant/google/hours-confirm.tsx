'use client'
import { useMemo } from 'react'
import { ArrowRight } from 'lucide-react'
import { HOURS_WEEKDAYS, type HoursWorkspace } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import { PageHeading } from '@/components/templates/page-frame'
import Notice from '@/components/shared/notice'
import type { GoogleChange, GoogleDayHours, GoogleProfileData, GoogleWeeklyHours } from '@/lib/restaurant-google-api'
import { hoursText,dateLabel } from './hours-model'
import { WEEKDAY_JA } from './format'
import { HoursServiceConfirm } from './hours-service-confirm'
import styles from './hours.module.css'

export function HoursConfirm({ data, workspace, changes, onBack, onSend, busy, disabled, lockedReason, error }: { data:GoogleProfileData;workspace:HoursWorkspace;changes:GoogleChange[];onBack:()=>void;onSend:()=>void;busy:boolean;disabled:boolean;lockedReason?:string;error:string }) {
 const rows=useMemo(()=>changes.flatMap(change=>{
  if(change.kind==='special_hours')return (change.after as GoogleDayHours[]).map(day=>({key:`${change.id}-${day.date}`,label:dateLabel(day.date,data.today.date),before:hoursText((change.before as GoogleDayHours[]).find(d=>d.date===day.date)?.periods??[]),after:day.remove?`通常 ${hoursText(day.periods)}`:day.closed?'休業':hoursText(day.periods)}))
  if(change.kind==='regular_hours')return HOURS_WEEKDAYS.filter(d=>'weekdays' in change.target&&change.target.weekdays.includes(d)).map(d=>({key:`${change.id}-${d}`,label:`毎週 ${WEEKDAY_JA[d]}曜日`,before:hoursText((change.before as GoogleWeeklyHours)[d]??[],'定休日'),after:hoursText((change.after as GoogleWeeklyHours)[d]??[],'定休日')}))
  return []
 }),[changes,data])
 const local=workspace.services.filter(s=>workspace.draft.serviceIds.includes(s.id))
 const canGoogle=changes.length>0
 return <div className={styles.content} data-design-node="Nt7Z6">
  <div className={styles.stack}><PageHeading title="変更内容を確認" titleSize="workspace" inset="none" separator="none"/><p className={styles.muted}>{data.profile.title??data.store.name}</p></div>
  {rows.length?<Card padding="default" layout="vertical" gap="normal"><h3>{changes.every(c=>c.kind==='special_hours')?`選択した${rows.length}日の営業時間`:'今回変更する営業時間'}</h3><GridTable label="営業時間の変更前と変更後" framed={false} presentation="metrics" design={{columns:'minmax(100px,1fr) minmax(0,1.5fr) 16px minmax(0,1.5fr)',gap:'var(--space-16)',rowPadding:'var(--space-16) var(--space-12)',fontSize:'var(--polish-text-body)',rowHeight:'auto',headBackground:'var(--color-table-head)'}}><GridHeadRow><GridCell role="columnheader">日付・サービス</GridCell><GridCell role="columnheader">変更前（Google）</GridCell><GridCell role="columnheader" aria-hidden="true"/><GridCell role="columnheader">変更後</GridCell></GridHeadRow>{rows.map(r=><GridRow key={r.key}><GridCell><strong>{r.label}</strong></GridCell><GridCell>{r.before}</GridCell><GridCell><ArrowRight size={15} aria-hidden="true"/></GridCell><GridCell><strong className={styles.green}>{r.after}</strong></GridCell></GridRow>)}</GridTable><p className={styles.muted}>選んでいない日付は変更しません。指定した休業日は、祝日や連休の設定より優先します。</p></Card>:null}
  <HoursServiceConfirm changes={changes} workspace={workspace} data={data}/>
  {local.length?<Card padding="default" layout="vertical" gap="normal"><h3>musubo内で使う設定</h3>{local.map(s=><div className={styles.stack} key={s.id}><strong>{s.label}</strong>{!s.googleTypeId?<p>{hoursText(s.periods)} · このサービスはmusubo内で使用します。</p>:null}{s.orderDeadline?<div className={styles.splitRow}><span>注文の受付終了</span><strong>{s.orderDeadline}</strong></div>:null}{s.menu?<div className={styles.splitRow}><span>提供するメニュー</span><strong>{s.menu}</strong></div>:null}</div>)}<p className={styles.muted}>受付終了とメニューはGoogleに送信されません。Googleに掲載できるサービスの種類は、店舗の業種によって異なります。</p></Card>:null}
  {changes.some(c=>c.reservationImpactCount>0)?<Notice tone="warn">営業時間の変更により、予約済みの時間と合わなくなる予約が{changes.reduce((n,c)=>n+c.reservationImpactCount,0)}件あります。予約内容を確認してください。</Notice>:null}
  {error?<Notice tone="danger">{error}</Notice>:null}
  {canGoogle&&!data.writeEnabled?<p className={styles.muted}>この検証環境ではGoogleへの送信が停止されています。入力した変更案は保存されています。</p>:null}
  <div className={styles.confirmFooter}><p className={styles.muted}>{canGoogle?'確認した内容をGoogleに反映します。表示が変わるまで時間がかかる場合があります。':'営業時間の設定をmusubo内に保存します。'}</p><div className={styles.actions}><Button size="compact" onClick={onBack} disabled={busy}>編集に戻る</Button><Button size="compact" variant="primary" lockedReason={lockedReason} disabled={disabled||canGoogle&&!data.writeEnabled} busy={busy} onClick={onSend}>{canGoogle?'Googleに反映する':'設定を保存する'}</Button></div></div>
 </div>
}
