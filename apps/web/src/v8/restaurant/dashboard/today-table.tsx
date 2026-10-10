'use client'
import ReservationBoard from '@/components/shared/reservation-board'
import { allBoardPages, reservationBoardApi } from '@/lib/api-reservation-board';
import { useAccount } from '@/contexts/account-context';
import { dayRange, toYmd } from '../reservations/format';
import { seatBoardEntry, type RestaurantFloor, type ReservationAxis } from '@line-crm/shared';

import { FolderDotName } from '@/components/shared/folder-dot';
import { formatDate as polishFormatDate } from '@/lib/format';
import { Check, ArrowRight } from 'lucide-react';
import { useListNavigationRouter as useRouter } from '@/components/shared/list-navigation';

import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SectionHeader from '@/components/shared/section-header'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions';
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table';
import { useEffect, useState } from 'react';
import Card from '@/components/shared/card'
import type { RestaurantReservation, RestaurantTable } from '@/lib/restaurant-test-api';
import { pad2 } from '../front-desk/slots';
import { isWalkIn } from '../front-desk/walk-in';
import { sourceName } from '../reservations/format';
import { canMarkVisited, visitState } from './summarize';
import styles from './dashboard.module.css'
import TruncatedText from '@/components/shared/truncated-text'

/*
 * 「今日のお店」の今日の予約の表（E-1 `今日の予約`）。
 * 列：時刻・名前・人数・卓・経路・状態・来店。予約中の行に［✓ 来店］（来店の印の口）と「…」。
 * 閲覧のみには［来店］と「…」の変える操作を置かない。
 */

function hm(iso: string): string {
  return polishFormatDate(iso, { style: 'time' })
}

export function routeLabel(r: Pick<RestaurantReservation, 'source' | 'note'>): string {
  return isWalkIn(r) ? 'ウォークイン' : sourceName(r.source)
}

export function TodayTable({ rows,storeName, tables=[],canWrite, busyId, onVisited, onUndo, onDeparture }: {
  storeName?:string
  tables?:RestaurantTable[]
  rows: RestaurantReservation[] | null
  canWrite: boolean
  busyId: string
  onVisited: (id: string) => void
  onDeparture?: (id:string,undo:boolean)=>void
  onUndo: (id: string) => void
}) {
  const {selectedAccountId}=useAccount()
  const range=dayRange(new Date())
  const [axis,setAxis]=useState<ReservationAxis>('list'),[floor,setFloor]=useState<RestaurantFloor>()
  const storeId=rows?.[0]?.store_id??tables[0]?.store_id
  useEffect(()=>{let active=true;setFloor(undefined);if(selectedAccountId&&storeId)void reservationBoardApi.floors(selectedAccountId,storeId).then(r=>{if(active&&Array.isArray(r.data))setFloor(r.data[0])}).catch(()=>{});return ()=>{active=false}},[selectedAccountId,storeId])
  const router = useRouter()
  const list = (rows ?? [])
    .filter((r) => r.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  return (
    <Card frame="inset" overflow="hidden" className={styles.today}>
      {rows === null ? (
        <ListState kind="loading" />
      ) : list.length === 0 ? (
        <ListState kind="empty" title="今日の予約はまだありません" description={canWrite ? '電話予約・ウォークインから入れられます。' : undefined} />
      ) : (
        <ReservationBoard printContext={`${storeName??rows?.[0]?.store_name??storeId??'今日のお店'} ／ 取消を除く今日の予約`} loadPrintEntries={selectedAccountId?()=>allBoardPages('seats',selectedAccountId,range.from,range.to,rows?.[0]?.store_id).then(es=>es.filter(e=>e.status!=='cancelled')):undefined} toolbar={<SectionHeader
        title="今日の予約"
        help="取消を除く今日の予約です。来店したお客さまは［来店］を押すと来店済みになります。30秒ごとに読み直します。"
        helpLabel="今日の予約の説明"
        note={`${list.length}件を表示`}
      />} trailingToolbar={<Button presentation="restaurant" href="/restaurant-test/reservations"><ArrowRight size={16}/>予約台帳で見る</Button>} columns="today" menus={e=><RowActions subjectName={e.customerName} menuItems={[...(canWrite&&onDeparture&&['visited','seated'].includes(e.status)?[{id:'depart',label:e.departedAt?'退店を訂正する':'退店にする',disabled:busyId===e.id,onSelect:()=>onDeparture(e.id,!!e.departedAt)}]:[]),{id:'detail',label:'詳細を見る',onSelect:()=>router.push(`/restaurant-test/reservations?id=${encodeURIComponent(e.id)}`)}]}/>} renderBody={body=>body} axis={axis} onAxis={setAxis} floor={floor} dates={[toYmd(new Date())]} entries={list.map(r=>seatBoardEntry(r as unknown as Record<string,unknown>))} resources={tables.map(t=>({id:t.id,label:t.code,active:!!t.is_active,capacity:t.max_capacity}))} onOpen={id=>router.push(`/restaurant-test/reservations?id=${encodeURIComponent(id)}`)} canWrite={canWrite}
          actions={e=>canWrite?(canMarkVisited(list.find(r=>r.id===e.id)!)?<Button presentation="restaurant" aria-label={`${e.customerName}さんを来店にする`} disabled={busyId===e.id} onClick={()=>onVisited(e.id)}><Check size={16} aria-hidden/>来店</Button>:!e.departedAt&&['visited','seated'].includes(e.status)?<Button presentation="restaurant" size="inline" aria-label={`${e.customerName}さんの来店の印を取り消す`} onClick={()=>onUndo(e.id)} disabled={busyId===e.id}>取り消す</Button>:null):null}/>

      )}
    </Card>
  )
}
