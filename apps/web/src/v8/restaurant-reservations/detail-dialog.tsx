'use client'

/*
 * ★V8-B 予約台帳「予約の詳細」の窓（板 `AjZhH`）。
 *
 * 時間×卓の箱・「次の予約」の「詳細を見る」から開く。題は「{お客さま}さん・{人数}名」、
 * 灰の箱に 日時と卓・コースと予約元・アレルギー・これまでの来店、下に 閉じる・取り消す・変更する。
 * 取り消すは確かめの窓（台帳側の CancelReservationDialog）を通し、変更するは今の変更の窓へ移る。
 * 閲覧のみ（canWrite=false）には 取り消す・変更する を置かない（閉じるだけ）。動きは BEHAVIOR.md。
 */
import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import Button from '@/components/shared/button'
import {
  restaurantTestApi,
  type RestaurantMenuItem,
  type RestaurantReservation,
  type RestaurantTable,
} from '@/lib/restaurant-test-api'
import { RsDialog } from '../restaurant/booking-kit/parts'
import { INACTIVE_STATUSES, hm, mdWeek, sourceName } from '../restaurant/reservations/format'
import styles from './detail-dialog.module.css'

type History = { state: 'loading' } | { state: 'none' } | { state: 'error' } | { state: 'ready'; count: number; last: string | null }

/** 「10/2（金）19:00〜21:00 ・ T4（4人卓）」。卓が無ければ「未配席」。 */
export function detailWhen(item: RestaurantReservation, table: RestaurantTable | null): string {
  const seat = table ? `${table.code}（${table.max_capacity}人卓）` : item.table_label || '未配席'
  return `${mdWeek(new Date(item.starts_at))}${hm(item.starts_at)}〜${hm(item.ends_at)} ・ ${seat}`
}

/** 「秋の鹿肉コース 8,800円 ・ Hot Pepper から」。コースが無ければ「席のみ」。 */
export function detailCourse(item: RestaurantReservation, course: RestaurantMenuItem | null): string {
  const name = item.course_name || course?.name || ''
  const price = course?.price ? ` ${course.price.toLocaleString('ja-JP')}円` : ''
  return `${name ? `${name}${price}` : '席のみ'} ・ ${sourceName(item.source)} から`
}

function historyText(history: History): string {
  if (history.state === 'loading') return 'これまでの来店を読んでいます…'
  if (history.state === 'none') return 'これまでの来店：連絡先が無いので数えられません'
  if (history.state === 'error') return 'これまでの来店を読めませんでした'
  if (history.count === 0) return 'これまでの来店 0回（はじめて）'
  const last = history.last ? new Date(history.last) : null
  const lastText = last && !Number.isNaN(last.getTime()) ? `・前回 ${last.getMonth() + 1}/${last.getDate()}` : ''
  return `これまでの来店 ${history.count}回${lastText}`
}

export default function ReservationDetailDialog({ reservation, accountId, tables, courses, busy, canWrite, onClose, onCancel, onRestore, onEdit }: {
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
      <div className={styles.facts}>
        <p className={styles.fact}>{detailWhen(reservation, table)}</p>
        <p className={styles.fact}>{detailCourse(reservation, course)}</p>
        <p className={`${styles.fact} ${styles.allergy}`}>{`アレルギー：${reservation.allergy_note || 'なし'}`}</p>
        <p className={styles.fact}>{historyText(history)}</p>
        {inactive ? <p className={styles.fact}>{reservation.status === 'no_show' ? '無断で来なかった予約です' : '取り消した予約です'}</p> : null}
      </div>
    </RsDialog>
  )
}
