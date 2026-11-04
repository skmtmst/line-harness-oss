'use client'
import { ArrowRight } from 'lucide-react'
import { HOURS_WEEKDAYS, type HoursWorkspace } from '@line-crm/shared'
import Card from '@/components/shared/card'
import type { GoogleChange, GoogleProfileData } from '@/lib/restaurant-google-api'
import { hoursText } from './hours-model'
import { WEEKDAY_JA } from './format'
import styles from './hours.module.css'

export function HoursServiceConfirm({changes,workspace,data}:{changes:GoogleChange[];workspace:HoursWorkspace;data:GoogleProfileData}) {
 const change=changes.find(c=>'field' in c.target&&c.target.field==='moreHours')
 if(!change)return null
 const before=change.before as NonNullable<GoogleProfileData['profile']['moreHours']>,after=change.after as typeof before
 const ids=[...new Set([...before,...after].map(h=>h.hoursTypeId))].filter(id=>JSON.stringify(before.find(h=>h.hoursTypeId===id))!==JSON.stringify(after.find(h=>h.hoursTypeId===id)))
 return <>{ids.map(id=>{const a=after.find(h=>h.hoursTypeId===id),b=before.find(h=>h.hoursTypeId===id),service=workspace.services.find(s=>s.googleTypeId===id);const text=(hours:typeof a)=>hours?[...new Set(HOURS_WEEKDAYS.filter(d=>hours.weekly[d].length).map(d=>hoursText(hours.weekly[d])))].join(' / '):'未設定';return <Card key={id} contentPadding="var(--space-20)" layout="vertical" gap="normal"><h3>{service?.label??data.profile.moreHoursTypes?.find(t=>t.id===id)?.label??id}の営業時間</h3><span className={styles.muted}>Googleに反映する</span>{a?<p className={styles.bodyText}>提供する曜日：{HOURS_WEEKDAYS.filter(d=>a.weekly[d].length).map(d=>`${WEEKDAY_JA[d]}曜日`).join('・')}</p>:null}<div className={styles.serviceComparison}><Card surface="inset" contentPadding="var(--space-20)" layout="vertical" gap="tight"><span className={styles.muted}>変更前</span><strong className={styles.todayTitle}>{text(b)}</strong></Card><ArrowRight size={18}/><Card surface="success" contentPadding="var(--space-20)" layout="vertical" gap="tight"><span className={styles.muted}>変更後</span><strong className={`${styles.todayTitle} ${styles.green}`}>{a?text(a):'削除する'}</strong></Card></div><p className={styles.bodyText}>店舗の営業時間の範囲内で設定されています。</p></Card>})}</>
}
