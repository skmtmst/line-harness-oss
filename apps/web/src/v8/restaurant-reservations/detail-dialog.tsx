'use client'
import {ReservationDining,ReservationFacts,ReservationSource,ReservationDetailsActions} from '@/components/shared/reservation-board'
import {seatBoardEntry} from '@line-crm/shared'

/*
 * ★V8-B 予約台帳「予約の詳細」の窓（板 `AjZhH`）。
 *
 * 時間×卓の箱・「次の予約」の「詳細を見る」から開く。題は「{お客さま}さん・{人数}名」、
 * 灰の箱に 日時と卓・コースと予約元・アレルギー・これまでの来店、下に 閉じる・取り消す・変更する。
 * 取り消すは確かめの窓（台帳側の CancelReservationDialog）を通し、変更するは今の変更の窓へ移る。
 * 閲覧のみ（canWrite=false）には 取り消す・変更する を置かない（閉じるだけ）。動きは BEHAVIOR.md。
 */
import { formatDate as polishFormatDate } from '@/lib/format'
import { useEffect, useState } from 'react'
import { Pencil, X } from 'lucide-react'
import {RowActions} from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import {
  restaurantTestApi,
  type RestaurantMenuItem,
  type RestaurantReservation,
  type RestaurantTable,
} from '@/lib/restaurant-test-api'
import { RsDialog } from '../restaurant/booking-kit/parts'
import { INACTIVE_STATUSES, hm, mdWeek, sourceName,maskPhone } from '../restaurant/reservations/format'
import styles from './detail-dialog.module.css'
import { formatNumber as polishFormatNumber } from '@/lib/format'
import { formatYen as polishFormatYen } from '@/lib/format'
import { emptyValue } from '@/components/shared/empty-value'

type History = { state: 'loading' } | { state: 'none' } | { state: 'error' } | { state: 'ready'; count: number; last: string | null }

/** 「10/2（金）19:00〜21:00 ・ T4（4人卓）」。卓が無ければ「未配席」。 */
export function detailWhen(item: RestaurantReservation, table: RestaurantTable | null): string {
  const seat = table ? `${table.code}（${table.max_capacity} 人卓）` : item.table_label || '未配席'
  return `${mdWeek(new Date(item.starts_at))}${hm(item.starts_at)}〜${hm(item.ends_at)} ・ ${seat}`
}

/** 「秋の鹿肉コース 8,800円 ・ Hot Pepper から」。コースが無ければ「席のみ」。 */
export function detailCourse(item: RestaurantReservation, course: RestaurantMenuItem | null): string {
  const name = item.course_name || course?.name || ''
  const price = course?.price ? ` ${polishFormatYen(course.price)}` : ''
  return `${name ? `${name}${price}` : '席のみ'} ・ ${sourceName(item.source)} から`
}

function historyText(history: History): string {
  if (history.state === 'loading') return 'これまでの来店を読んでいます…'
  if (history.state === 'none') return 'これまでの来店：連絡先が無いので数えられません'
  if (history.state === 'error') return 'これまでの来店を読めませんでした'
  if (history.count === 0) return 'これまでの来店 0 回（はじめて）'
  const last = polishFormatDate(history.last, { style: 'list-day', fallback: '' })
  return `これまでの来店 ${history.count.toLocaleString('ja-JP')} 回${last ? `・前回 ${last}` : ''}`
}

export default function ReservationDetailDialog({ reservation, accountId, tables, courses, busy, canWrite, onClose, onCancel, onRestore, onEdit, onAttendance, inline = false }: {
  onAttendance?:(id:string,action:'visited'|'depart'|'undo_departure'|'undo_visit')=>void
  inline?: boolean
  reservation: RestaurantReservation | null
  accountId: string
  tables: RestaurantTable[]
  courses: RestaurantMenuItem[]
  busy: boolean
  /** 予約を変えられる人か（閲覧のみは false）。 */
  canWrite: boolean
  onClose: () => void
  /** 取り消す：確かめの窓へ。 */
  onCancel: (id: string) => void
  /** 取消・無断の予約を有効に戻す。 */
  onRestore: (id: string) => void
  /** 変更する：今の変更の窓へ。 */
  onEdit: (id: string) => void
}) {
  const [history, setHistory] = useState<History>({ state: 'loading' })
  const id = reservation?.id ?? ''
  const storeId = reservation?.store_id ?? ''
  const phone = reservation?.customer_phone ?? ''
  const lineUid = reservation?.line_uid ?? ''

  /* これまでの来店（来店済みの数と前回）。連絡先が無い予約は数えない。遅い応答は捨てる。 */
  useEffect(() => {
    if (!id) return
    if (!phone && !lineUid) { setHistory({ state: 'none' }); return }
    let current = true
    setHistory({ state: 'loading' })
    restaurantTestApi.customerHistory(accountId, storeId, { phone: phone || undefined, lineUid: lineUid || undefined })
      .then((res) => {
        if (!current) return
        const data = res?.data
        if (!data || typeof data.visitCount !== 'number') { setHistory({ state: 'error' }); return }
        setHistory({ state: 'ready', count: data.visitCount, last: data.visits?.[0]?.starts_at ?? null })
      })
      .catch(() => { if (current) setHistory({ state: 'error' }) })
    return () => { current = false }
  }, [id, accountId, storeId, phone, lineUid])

  if (!reservation) return null
  const table = reservation.table_id ? tables.find((t) => t.id === reservation.table_id) ?? null : null
  const course = reservation.course_id ? courses.find((c) => c.id === reservation.course_id) ?? null : null
  const inactive = INACTIVE_STATUSES.includes(reservation.status)

  const attendance=canWrite&&onAttendance&&!inactive&&!reservation.hold_expires_at?<RowActions subjectName={reservation.customer_name} menuItems={reservation.departed_at?[{id:'undo-depart',label:'退店を訂正する',disabled:busy,onSelect:()=>onAttendance(reservation.id,'undo_departure')}]:['visited','seated'].includes(reservation.status)?[{id:'depart',label:'退店にする',disabled:busy,onSelect:()=>onAttendance(reservation.id,'depart')},{id:'undo-visit',label:'来店を取り消す',disabled:busy,onSelect:()=>onAttendance(reservation.id,'undo_visit')}]:[{id:'visit',label:'来店にする',disabled:busy,onSelect:()=>onAttendance(reservation.id,'visited')}]}/>:null
  const dining=<ReservationDining entry={seatBoardEntry(reservation as unknown as Record<string,unknown>)} />
  if(inline)return <Card surface="inset" contentPadding="16px" layout="vertical" gap="10px">
    <SectionHeader title="予約の詳細" actions={<Button size="inline" variant="text" aria-label="予約の詳細を閉じる" onClick={onClose}><X size={16} aria-hidden="true"/></Button>}/>
    <p className={styles.fact}>{`${mdWeek(new Date(reservation.starts_at))}${hm(reservation.starts_at)}〜${hm(reservation.ends_at)} ・ ${table?.code??'未配席'}`}</p>
    <SectionHeader size="customer" title={`${reservation.customer_name} さま`} note={<ReservationSource value={reservation.source} note={reservation.note}/>}/>
    <ReservationFacts items={[{label:'人数・コース',value:`${reservation.guest_count}名・${reservation.course_name??'席のみ'}${course?.price?` ${polishFormatYen(course.price)}`:''}`},{label:'電話',value:maskPhone(reservation.customer_phone)||'電話未登録'}]}/>
    <ReservationDining dense entry={seatBoardEntry(reservation as unknown as Record<string,unknown>)}/>
    <ReservationFacts items={[{label:'来店',value:<span title={historyText(history)}>{history.state==='ready'?`${history.count}回`:'—'}</span>}]}/>
    <ReservationDetailsActions>{attendance}{canWrite?<><Button presentation="restaurant" variant="primary" onClick={()=>onEdit(reservation.id)}>変更する</Button><Button presentation="restaurant" onClick={()=>inactive?onRestore(reservation.id):onCancel(reservation.id)}>{inactive?'予約を有効に戻す':'取り消す'}</Button></>:null}</ReservationDetailsActions>
  </Card>
  return (
    <RsDialog
      open
      title={`${reservation.customer_name}さん・${reservation.guest_count}名`}
      width={560}
      top={160}
      busy={busy}
      designNode="AjZhH"
      onCancel={onClose}
      actions={(
        <>
          {attendance}
          <Button type="button" onClick={onClose} disabled={busy}>閉じる</Button>
          {canWrite ? (
            inactive ? (
              <Button type="button" disabled={busy} onClick={() => onRestore(reservation.id)}>予約を有効に戻す</Button>
            ) : (
              <>
                <Button type="button" disabled={busy} onClick={() => onCancel(reservation.id)}>取り消す</Button>
                <Button type="button" variant="primary" disabled={busy} onClick={() => onEdit(reservation.id)}>
                  <Pencil size={15} aria-hidden="true" />変更する
                </Button>
              </>
            )
          ) : null}
        </>
      )}
    >
      {dining}
      <div className={styles.facts}>
        <p className={styles.fact}>{detailWhen(reservation, table)}</p>
        <p className={styles.fact}>{detailCourse(reservation, course)}</p>
        <p className={`${styles.fact} ${styles.allergy}`}>{`アレルギー：${reservation.allergy_note || emptyValue('none')}`}</p>
        <p className={styles.fact}>{historyText(history)}</p>
        {inactive ? <p className={styles.fact}>{reservation.status === 'no_show' ? '無断で来なかった予約です' : '取り消した予約です'}</p> : null}
      </div>
    </RsDialog>
  )
}
