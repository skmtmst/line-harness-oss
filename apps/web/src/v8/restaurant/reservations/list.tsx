'use client'
import type {RestaurantFloor,ReservationAxis} from '@line-crm/shared'
import {reservationBoardApi} from '@/lib/api-reservation-board'
import ReservationBoard from '@/components/shared/reservation-board'
import {useEffect,useState,type ReactNode} from 'react'
import {DetailColumns} from '@/components/templates/detail-columns'
import {useAccount} from '@/contexts/account-context'
import {allBoardPages} from '@/lib/api-reservation-board'
import {seatBoardEntry} from '@line-crm/shared'

/*
 * ★V8 予約台帳「一覧」（板 `Z3FoM`）。今週・今月もこの形で、その期間の予約を出す。
 *
 * 数5（予約・ご来店人数・LINE予約・媒体予約・未配席）→ 期間・状態の絞り込みと
 * 受信データを試す・手動予約を登録する → 予約タイムラインの表（時刻・予約元・お客さま・人数・卓・
 * コース・注意事項・状態・操作）→ ページ送り（一覧だけ）。
 */
import { Inbox, Plus } from 'lucide-react'
import KpiCard from '@/components/shared/kpi-card'
import Card from '@/components/shared/card'
import { Field } from '@/components/shared/form-controls'
import Button from '@/components/shared/button'
import Pagination from '@/components/shared/pagination'
import {RowActions} from '@/components/shared/row-actions'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api'
import { Panel, StatRow, Status } from '../booking-kit/shell'
import { toYmd,INACTIVE_STATUSES, type LedgerView, isHold, maskPhone, mdhm, sourceKind, sourceName,dayRange,weekRange,monthRange } from './format'
import styles from './reservations.module.css'
import { emptyValue } from '@/components/shared/empty-value'

export const PAGE_SIZE = 20

export const LEDGER_STATUS_OPTIONS = [
  { value: 'all', label: '状態：すべての状態' },
  { value: 'pending,confirmed,seated,visited', label: '有効のみ' },
  { value: 'cancelled,no_show', label: '取消・無断のみ' },
]

export default function ListView({ view, rows, total, tables, page, period, status, busy, canWrite, canImport, onPeriod, onStatus, onPage, onImport, onCreate, onOpen, onCancel, onRestore,day,storeId,storeName,detail,onView }: {
  onView:(view:LedgerView)=>void
  detail?:ReactNode
  storeName?:string
  day:Date;storeId:string
  view: LedgerView
  rows: RestaurantReservation[]
  /** 一覧は口の総数（ページ送りの母数）。今週・今月は表示中の数。 */
  total: number
  tables: RestaurantTable[]
  page: number
  period: string
  status: string
  busy: boolean
  canWrite: boolean
  /** 受信データの試し（媒体受信の口）は管理者だけ。 */
  canImport: boolean
  onPeriod: (value: string) => void
  onStatus: (value: string) => void
  onPage: (page: number) => void
  onImport: () => void
  onCreate: () => void
  onOpen: (id: string) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
}) {
  const [detailExpanded,setDetailExpanded]=useState(false)
  const {selectedAccountId}=useAccount()
  const [axis,setAxis]=useState<ReservationAxis>(view==='month'?'month':'list'),[floor,setFloor]=useState<RestaurantFloor>()
  useEffect(()=>{let current=true;setFloor(undefined);if(selectedAccountId&&storeId)void reservationBoardApi.floors(selectedAccountId,storeId).then(r=>{if(current)setFloor(r.data[0])}).catch(()=>{});return()=>{current=false}},[selectedAccountId,storeId])
  const range=view==='week'?weekRange(day):view==='month'?monthRange(day):{from:period==='past'?'1970-01-01T00:00:00Z':period==='future'?dayRange(new Date()).from:'1970-01-01T00:00:00Z',to:period==='past'?dayRange(new Date()).from:'2100-01-01T00:00:00Z'}
  const printEntries=selectedAccountId?()=>allBoardPages('seats',selectedAccountId,range.from,range.to,storeId).then(es=>es.filter(e=>status==='all'||status.split(',').includes(e.status))):undefined
  const live = rows.filter((item) => !INACTIVE_STATUSES.includes(item.status) && !isHold(item))
  const guests = live.reduce((sum, item) => sum + item.guest_count, 0)
  const cancelledGuests = rows.filter((item) => INACTIVE_STATUSES.includes(item.status)).reduce((sum, item) => sum + item.guest_count, 0)
  const lineCount = live.filter((item) => item.source === 'line').length
  const mediaCount = live.filter((item) => sourceKind(item.source) === 'media' || item.source === 'restaurant_board').length
  const unseated = live.filter((item) => !item.table_id).length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tableById = new Map(tables.map((table) => [table.id, table]))

  return (
    <>
      <StatRow fusion>
        <KpiCard title="予約" value={total} unit="件" detail={`表示中 ${rows.length}件`} icon={undefined} presentation="band" />
        <KpiCard title="ご来店人数" value={guests} unit="名" detail={cancelledGuests > 0 ? `取消 ${cancelledGuests}名を除く` : `表示中 ${rows.length}件`} icon={undefined} presentation="band" />
        <KpiCard title="LINE予約" value={lineCount} unit="件" detail="自社導線" icon={undefined} presentation="band" />
        <KpiCard title="媒体予約" value={mediaCount} unit="件" detail="受信した予約" icon={undefined} presentation="band" />
        <KpiCard title="未配席" value={unseated} unit="件" detail="卓の割当が必要" valueTone={unseated > 0 ? 'warning' : 'default'} icon={undefined} presentation="band" />
      </StatRow>
      <ReservationBoard printContext={`${storeName??storeId} ／ ${view==='week'?'今週':view==='month'?'今月':period==='past'?'過去の予約':period==='future'?'今後の予約':'すべての予約'} ／ ${LEDGER_STATUS_OPTIONS.find(o=>o.value===status)?.label??status}`} title="予約台帳" loadPrintEntries={printEntries} axis={axis} floor={floor} dates={[toYmd(day)]} onAxis={v=>{setAxis(v);if(v==='resource')onView('today');else if(v==='month')onView('month');else if(v==='list')onView('list')}} columns="dining" entries={rows.map(r=>seatBoardEntry(r as unknown as Record<string,unknown>))} resources={tables.map(t=>({id:t.id,label:t.code,active:!!t.is_active,capacity:t.max_capacity}))} onOpen={onOpen} actions={e=><RowActions subjectName={e.customerName} menuItems={[{id:'detail',label:'詳細を見る',onSelect:()=>onOpen(e.id)},...(INACTIVE_STATUSES.includes(e.status)?[{id:'restore',label:'予約を有効に戻す',onSelect:()=>onRestore(e.id)}]:[{id:'cancel',label:'取消',tone:'danger' as const,onSelect:()=>onCancel(e.id)}])]} />} canWrite={canWrite} busy={busy}
        toolbar={      <>
        {view === 'list' ? (
          <>
            <div className={styles.filterField}>

              <Select aria-label="期間" size="full" value={period} onChange={onPeriod} options={[
                { value: 'upcoming', label: '期間：今後の予約' },
                { value: 'all', label: '期間：すべての期間' },
                { value: 'past', label: '期間：過去の予約' },
              ]} />

            </div>
            <div className={styles.filterField}>

              <Select aria-label="状態" size="full" value={status} onChange={onStatus} options={LEDGER_STATUS_OPTIONS} />

            </div>
          </>
        ) : null}
</>} trailingToolbar={<>        <span className={styles.dateSpacer} />
        {canImport ? <Button presentation="restaurant" disabled={busy} onClick={onImport}><Inbox size={15} aria-hidden="true" />受信データを試す</Button> : null}
        {canWrite ? <Button presentation="restaurant" variant="primary" disabled={busy} onClick={onCreate}><Plus size={15} aria-hidden="true" />手動予約を登録する</Button> : null}
      </>} renderBody={body=><DetailColumns variant="restaurant-ledger" asideLabel="予約の詳細を見る" expanded={detailExpanded} onExpandedChange={setDetailExpanded} aside={detail}>
        {rows.length===0?<ListState kind="empty" title="条件に合う予約はありません。"/>:body}
        {view === 'list' && pageCount > 1 ? (
          <Pagination spacing="restaurant" page={page} pageCount={pageCount} onPageChange={onPage} ariaLabel="予約台帳のページ送り" disabled={busy} summary={`${total} 件中 ${(page - 1) * PAGE_SIZE + 1}〜${Math.min((page - 1) * PAGE_SIZE + rows.length, total)} 件`} />
        ) : null}
      <Panel fusion title="顧客カルテ" description="電話番号または LINE UID で名寄せする設計です。">
        <div className={styles.karte}>
          {live.slice(0, 3).map((item) => (
            <Card key={item.id} frame="inset" corner="segment" padding="compact" layout="vertical" className={styles.karteCard}>
              <p className={styles.karteName}>{item.customer_name}</p>
              <p className={styles.karteContact}>{item.line_uid ? 'LINE UID' : maskPhone(item.customer_phone) || emptyValue('unconfigured')}</p>
              <p className={styles.karteRecent}>{`直近：${mdhm(item.starts_at)} / ${item.guest_count}名`}</p>
            </Card>
          ))}
          {live.length === 0 ? <p className={styles.karteRecent}>表示中の予約がありません。</p> : null}
        </div>
      </Panel>
      </DetailColumns>}/>

    </>
  )
}
