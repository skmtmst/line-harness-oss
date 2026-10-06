'use client'

/*
 * ★V8-B 店舗ダッシュボード（板 `CHz31`）。
 *
 * v7（restaurant-console.tsx の Dashboard）と同じ集計を、板の形で置く：
 * 数5（予約数・ご来店予定・空席率・売上予測・未返信口コミ）→ 店舗一覧
 * → 全店アクション／同期方針。数の根拠は変えない（「見せ方だけ」の移し替え）。
 */
import { useMemo, useState } from 'react'
import { Send, Store } from 'lucide-react'
import Button from '@/components/shared/button'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { formatYen } from '@/lib/format'
import type { RestaurantSnapshot } from '@/lib/restaurant-test-api'
import RestaurantShell, { Panel, PanelAside, Stat, Status } from './shell'
import styles from './shell.module.css'

function DashboardBoard({ data }: { data: RestaurantSnapshot }) {
  /* R104: 集計は今日以降の有効予約だけを見る（v7 と同じ）。 */
  const nowIso = new Date().toISOString()
  const upcoming = data.reservations.filter((r) => r.starts_at >= nowIso && !['cancelled', 'no_show'].includes(r.status))
  const guestCount = upcoming.reduce((sum, r) => sum + r.guest_count, 0)
  const totalCapacity = data.stores.reduce((sum, item) => sum + item.capacity, 0)
  const unreplied = data.reviews.filter((r) => r.reply_status === 'unreplied').length
  const priceOf = (courseId: string | null) => data.menuItems.find((m) => m.id === courseId)?.price ?? null
  const priced = upcoming.filter((r) => priceOf(r.course_id) !== null)
  const revenue = priced.reduce((sum, r) => sum + r.guest_count * (priceOf(r.course_id) || 0), 0)
  const lineIssues = data.stores.filter((item) => item.line_status === 'error').length
  const connectorIssues = data.connectors.filter((c) => ['error', 'warning'].includes(c.status)).length
  const issues = lineIssues + connectorIssues

  return (
    <>
      <div className={styles.stats}>
        <Stat label="予約数" value={`${upcoming.length}件`} note="今日以降の有効予約" help="今日以降に開始する、取消・無断キャンセルでない予約の件数です。" />
        <Stat label="ご来店予定" value={`${guestCount}名`} note="今日以降の人数合計" help="今日以降の有効予約の人数の合計です。来店済みの過去分は含みません。" />
        <Stat label="空席率" value={`${Math.max(0, Math.round((1 - guestCount / Math.max(totalCapacity, 1)) * 100))}%`} note="全店舗の概算" help="分母は全店舗の収容数の合計、分子は今日以降の有効予約の人数の合計です。時間帯ごとの空きではありません。" />
        <Stat label="売上予測" value={priced.length ? formatYen(revenue) : '—'} note={priced.length ? `コース設定 ${priced.length}件分` : 'コース設定がありません'} help="コース単価×人数の合計です。席のみ（コース未設定）の予約は含みません。固定の客単価では計算しません。" />
        <Stat label="未返信口コミ" value={`${unreplied}件`} note="Google口コミ" warning={unreplied > 0} />
      </div>
      <Panel
        title="店舗一覧"
        description="本部から全店の予約と接続状態を確認します。"
        aside={<PanelAside tone={issues ? 'warning' : 'success'}>{issues ? `${issues}件の要確認` : 'すべて正常'}</PanelAside>}
        flush
      >
        <DataTable className="rounded-none border-0">
          <thead>
            <TableHeadRow>
              <Th>店舗</Th>
              <Th>エリア</Th>
              <Th align="right">予約</Th>
              <Th align="right">予定人数</Th>
              <Th align="right">収容数</Th>
              <Th>LINE</Th>
              <Th>Google</Th>
              <Th>予約媒体</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {data.stores.map((item) => {
              const reservations = upcoming.filter((r) => r.store_id === item.id)
              const connector = data.connectors.find((c) => c.store_id === item.id && c.provider === 'restaurant_board')
              return (
                <Tr key={item.id} interactive>
                  <Td>
                    <span className={styles.cellMain} title={item.name}>{item.name}</span>
                    <p className={styles.cellSub}>{item.code}</p>
                  </Td>
                  <Td>{item.area || '—'}</Td>
                  <Td className="text-right font-semibold">{reservations.length}件</Td>
                  <Td className="text-right">{reservations.reduce((s, r) => s + r.guest_count, 0)}名</Td>
                  <Td className="text-right">{item.capacity}席</Td>
                  <Td><Status value={item.line_status} /></Td>
                  <Td><Status value={item.google_status} /></Td>
                  <Td><Status value={connector?.status || 'unconfigured'} /></Td>
                </Tr>
              )
            })}
          </tbody>
        </DataTable>
      </Panel>
      <div className={styles.halfGrid}>
        <Panel title="全店アクション" description="検証中は下書き作成まで。外部配信は行いません。">
          <div className={styles.actionRow}>
            <Button variant="secondary" disabled><Store size={15} aria-hidden />Google 一斉投稿（未接続）</Button>
            <Button variant="secondary" disabled><Send size={15} aria-hidden />LINE 一斉配信（未接続）</Button>
          </div>
        </Panel>
        <Panel title="同期方針" description="安全な検証のため固定しています。">
          <p className={styles.noteTitle}>レストランボード中心の一方向受信</p>
          <p className={styles.noteText}>取得できない媒体は個別受信口を追加します。予約台帳から外部媒体への在庫・予約更新は0件です。</p>
        </Panel>
      </div>
    </>
  )
}

export default function DashboardV8() {
  /* v7 と同じ「今日以降の有効予約」の取り方（R103/R104）。 */
  const [todayStartIso] = useState(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return day.toISOString() })
  const query = useMemo(() => ({ from: todayStartIso, status: 'pending,confirmed,seated,visited', limit: 500, offset: 0 }), [todayStartIso])
  return (
    <RestaurantShell
      boardId="CHz31"
      title="店舗ダッシュボード"
      description="全店舗の予約・空席・連携状態を、本部からまとめて確認します。"
      query={query}
    >
      {({ data }) => <DashboardBoard data={data} />}
    </RestaurantShell>
  )
}
