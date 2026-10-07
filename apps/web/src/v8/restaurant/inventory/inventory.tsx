'use client'

/*
 * ★V8 予約枠・在庫（板 `Y8SjT2`・媒体を閉じる知らせ `Yyw6i`・予約経路の連携 `hQQlt`・競合 `qf3ky`）。
 *
 * 板の頭 → 検証環境の帯 → タブ（時間帯ごとの在庫／予約経路の連携）→ 中身。
 * 「自動で合わせるルール」タブは口（F-24）が無いので出さない。
 * `?tab=channels` で予約経路の連携を開く。動きは BEHAVIOR.md。
 */
import { useEffect, useState } from 'react'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import RestaurantShell, { type RestaurantV8Context } from '../booking-kit/shell'
import StockBoard from './stock'
import ChannelsBoard from './channels'
import styles from './inventory.module.css'

function InventoryTabs({ ctx }: { ctx: RestaurantV8Context }) {
  const [tab, setTab] = useState<'stock' | 'channels'>('stock')
  /* useSearchParams は組み立て時に Suspense を求めるので、開いたあとに読む。 */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'channels') setTab('channels')
  }, [])
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 閲覧のみの人には、保存・時間帯の足し引き・発行などの押せないボタンを置かない（2026-10-06 オーナー）。 */
  const canEdit = role === null || canManageRole(role)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.store?.timezone || 'Asia/Tokyo' }).format(new Date())
  return (
    <>
      <Tabs
        className={styles.tabs}
        label="予約枠・在庫の切り替え"
        items={[
          { label: '時間帯ごとの在庫', current: tab === 'stock', onClick: () => setTab('stock') },
          { label: '予約経路の連携', current: tab === 'channels', onClick: () => setTab('channels') },
        ]}
      />
      {tab === 'stock' ? (
        <StockBoard key={ctx.selectedStoreId} ctx={ctx} canEdit={canEdit} />
      ) : selectedAccountId && ctx.selectedStoreId ? (
        <ChannelsBoard accountId={selectedAccountId} storeId={ctx.selectedStoreId} date={today} canEdit={canEdit} />
      ) : (
        <ListState kind="empty" title="店舗を選んでください" description="予約経路を見たい店舗を選んでください。" />
      )}
    </>
  )
}

export default function InventoryPage() {
  return (
    <RestaurantShell storeTab="inventory" boardId="Y8SjT2" title="予約枠・在庫" description="時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。">
      {(ctx) => <InventoryTabs ctx={ctx} />}
    </RestaurantShell>
  )
}
