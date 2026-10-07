'use client'

/*
 * ★V8 店舗ダッシュボード（Pencil `CHz31`）。
 *
 * 数5（予約数・ご来店予定・空席率・売上予測・未返信口コミ）→ 店舗一覧
 * → 全店アクション／同期方針。数の根拠は今の画面と同じ（見せ方だけの移し替え）。
 * 動きは BEHAVIOR.md。
 */
import { useMemo, useState } from 'react'
import { Send, Store } from 'lucide-react'
import Button from '@/components/shared/button'
import { formatYen } from '@/lib/format'
import type { RestaurantSnapshot } from '@/lib/restaurant-test-api'
import RestaurantFrame from '../common-a/frame'
import { HalfGrid, Panel, PanelAside, Stat, StatRow, Status } from '../common-a/parts'
import styles from './stores.module.css'


export function DashboardBoard({ data }: { data: RestaurantSnapshot }) {
  /* 集計は今日以降の有効予約だけを見る（今の画面と同じ R104）。 */
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
      <StatRow>
        <Stat label="予約数" value={`${upcoming.length}件`} note="今日以降の有効予約" help="今日以降に開始する、取消・無断キャンセルでない予約の件数です。" />
        <Stat label="ご来店予定" value={`${guestCount}名`} note="今日以降の人数合計" help="今日以降の有効予約の人数の合計です。来店済みの過去分は含みません。" />
        <Stat label="空席率" value={`${Math.max(0, Math.round((1 - guestCount / Math.max(totalCapacity, 1)) * 100))}%`} note="全店舗の概算" help="分母は全店舗の収容数の合計、分子は今日以降の有効予約の人数の合計です。時間帯ごとの空きではありません。" />
        <Stat label="売上予測" value={priced.length ? formatYen(revenue) : '—'} note={priced.length ? `コース設定 ${priced.length}件分` : 'コース設定がありません'} help="コース単価×人数の合計です。席のみ（コース未設定）の予約は含みません。固定の客単価では計算しません。" />
        <Stat label="未返信口コミ" value={`${unreplied}件`} note="Google口コミ" warning={unreplied > 0} />
      </StatRow>
      <Panel
        title="店舗一覧"
        description="本部から全店の予約と接続状態を確認します。"
        aside={<PanelAside tone={issues ? 'warning' : 'success'}>{issues ? `${issues}件の要確認` : 'すべて正常'}</PanelAside>}
        flush
      >
        <div role="table" aria-label="店舗一覧" className={styles.table}>
          <div role="row" className={styles.headRow}>
            {/* 絵の列幅：店舗は残り・エリア100・予約64・予定人数80・収容数72・状態90×3。 */}
            <span role="columnheader" className={`${styles.cell} ${styles.colStore}`}>店舗</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colArea}`}>エリア</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colCount} ${styles.num}`}>予約</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colGuests} ${styles.num}`}>予定人数</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colCapacity} ${styles.num}`}>収容数</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colState}`}>LINE</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colState}`}>Google</span>
            <span role="columnheader" className={`${styles.cell} ${styles.colState}`}>予約媒体</span>
          </div>
          {data.stores.map((item) => {
            const reservations = upcoming.filter((r) => r.store_id === item.id)
            const connector = data.connectors.find((c) => c.store_id === item.id && c.provider === 'restaurant_board')
            return (
              <div key={item.id} role="row" className={styles.row}>
                <span role="cell" className={`${styles.cell} ${styles.colStore}`}>
                  <span className={styles.storeName} title={item.name}>{item.name}</span>
                  <span className={styles.storeCode}>{item.code}</span>
                </span>
                <span role="cell" className={`${styles.cell} ${styles.colArea}`}>{item.area || '—'}</span>
                <span role="cell" className={`${styles.cell} ${styles.colCount} ${styles.num}`}>{`${reservations.length}件`}</span>
                <span role="cell" className={`${styles.cell} ${styles.colGuests} ${styles.num}`}>{`${reservations.reduce((s, r) => s + r.guest_count, 0)}名`}</span>
                <span role="cell" className={`${styles.cell} ${styles.colCapacity} ${styles.num}`}>{`${item.capacity}席`}</span>
                <span role="cell" className={`${styles.cell} ${styles.colState}`}><Status value={item.line_status} /></span>
                <span role="cell" className={`${styles.cell} ${styles.colState}`}><Status value={item.google_status} /></span>
                <span role="cell" className={`${styles.cell} ${styles.colState}`}><Status value={connector?.status || 'unconfigured'} /></span>
              </div>
            )
          })}
        </div>
      </Panel>
      <HalfGrid>
        <Panel title="全店アクション" description="検証中は下書き作成まで。外部配信は行いません。" >
          <div className={styles.actionBody}>
          <Button variant="secondary" disabled className={styles.actionButton}><Store aria-hidden className={styles.actionIcon} />Google 一斉投稿（未接続）</Button>
          <Button variant="secondary" disabled className={styles.actionButton}><Send aria-hidden className={styles.actionIcon} />LINE 一斉配信（未接続）</Button>
          </div>
        </Panel>
        <Panel title="同期方針" description="安全な検証のため固定しています。" >
          <div className={styles.noteBody}>
          <p className={styles.noteTitle}>レストランボード中心の一方向受信</p>
          <p className={styles.noteText}>取得できない媒体は個別受信口を追加します。予約台帳から外部媒体への在庫・予約更新は0件です。</p>
          </div>
        </Panel>
      </HalfGrid>
    </>
  )
}

export default function StoresDashboardV8() {
  /* 今の画面と同じ「今日以降の有効予約」の取り方（R103/R104）。 */
  const [todayStartIso] = useState(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return day.toISOString() })
  const query = useMemo(() => ({ from: todayStartIso, status: 'pending,confirmed,seated,visited', limit: 500, offset: 0 }), [todayStartIso])
  return (
    <RestaurantFrame
      boardId="CHz31"
      title="店舗ダッシュボード"
      description="全店舗の予約・空席・連携状態を、本部からまとめて確認します。"
      query={query}
    >
      {({ data }) => <DashboardBoard data={data} />}
    </RestaurantFrame>
  )
}
