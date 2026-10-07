'use client'

/*
 * ★V8 予約枠・在庫（板 `Y8SjT2`・媒体を閉じる知らせ `Yyw6i`・予約経路の連携 `hQQlt`・競合 `qf3ky`・
 * 休業日・貸切 `UVnvR`／足す窓 `nVvXy`）。
 *
 * 板の頭 → 検証環境の帯 → タブ（時間帯ごとの在庫／予約経路の連携／休業日・貸切）→ 中身。
 * 「休業日・貸切」は絵（提案 E-10）どおり、頭が「店舗 ・ 総数」の説明と［＋臨時休業・貸切を足す］になり、検証環境の帯を出さない。
 * 「自動で合わせるルール」タブは口（F-24）が無いので出さない。
 * `?tab=channels`・`?tab=closures` で開く（押したタブも URL に残す）。動きは BEHAVIOR.md。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import RestaurantShell, { type RestaurantV8Context } from '../booking-kit/shell'
import ClosuresBoard from '../closures/closures'
import type { ClosureDialogTarget } from '../closures/closure-dialog'
import { todayIn } from '../closures/format'
import { canWriteRole } from '../dashboard/summarize'
import StockBoard from './stock'
import ChannelsBoard from './channels'
import styles from './inventory.module.css'

type InventoryTab = 'stock' | 'channels' | 'closures'

const TAB_PARAM: Record<InventoryTab, string | null> = { stock: null, channels: 'channels', closures: 'closures' }

function readTab(): InventoryTab {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value === 'channels' || value === 'closures' ? value : 'stock'
}

function InventoryTabs({ ctx, tab, onTab, dialog, onDialog }: {
  ctx: RestaurantV8Context
  tab: InventoryTab
  onTab: (tab: InventoryTab) => void
  dialog: ClosureDialogTarget | null
  onDialog: (target: ClosureDialogTarget | null) => void
}) {
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  /* 閲覧のみの人には、保存・時間帯の足し引き・発行などの押せないボタンを置かない（2026-10-06 オーナー）。 */
  const canEdit = role === null || canManageRole(role)
  const today = todayIn(ctx.store?.timezone)
  const tabs = (
    <Tabs
      className={`${styles.tabs} ${tab === 'closures' ? styles.tabsClosures : ''}`}
      label="予約枠・在庫の切り替え"
      size="compact"
      items={[
        { label: '時間帯ごとの在庫', current: tab === 'stock', onClick: () => onTab('stock') },
        { label: '予約経路の連携', current: tab === 'channels', onClick: () => onTab('channels') },
        { label: '休業日・貸切', current: tab === 'closures', onClick: () => onTab('closures') },
      ]}
    />
  )
  let body: ReactNode
  if (tab === 'stock') {
    body = <StockBoard key={ctx.selectedStoreId} ctx={ctx} canEdit={canEdit} />
  } else if (!selectedAccountId || !ctx.selectedStoreId) {
    body = <ListState kind="empty" title="店舗を選んでください" description={tab === 'channels' ? '予約経路を見たい店舗を選んでください。' : '休業日・貸切を見たい店舗を選んでください。'} />
  } else if (tab === 'channels') {
    body = <ChannelsBoard accountId={selectedAccountId} storeId={ctx.selectedStoreId} date={today} canEdit={canEdit} />
  } else {
    body = (
      <ClosuresBoard
        key={ctx.selectedStoreId}
        ctx={ctx}
        accountId={selectedAccountId}
        today={today}
        canWrite={canWriteRole(role)}
        canGoogle={role === null || canManageRole(role)}
        dialog={dialog}
        onDialog={onDialog}
      />
    )
  }
  return (
    <>
      {tabs}
      {body}
    </>
  )
}

/** 「然-NEN 本店 ・ 1つの時間帯の総数 26席（稼働中の卓 8）」。 */
function closuresDescription(ctx: RestaurantV8Context | null): string {
  if (!ctx?.store) return '日付を選んで、席の予約を閉じます。'
  const active = ctx.data.tables.filter((t) => t.store_id === ctx.selectedStoreId && t.is_active)
  const seats = active.reduce((sum, t) => sum + t.max_capacity, 0)
  return `${ctx.store.name} ・ 1つの時間帯の総数 ${seats}席（稼働中の卓 ${active.length}）`
}

export default function InventoryPage() {
  const [tab, setTab] = useState<InventoryTab>('stock')
  const [dialog, setDialog] = useState<ClosureDialogTarget | null>(null)
  const role = useStaffRole()
  /* useSearchParams は組み立て時に Suspense を求めるので、開いたあとに読む。 */
  useEffect(() => { setTab(readTab()) }, [])
  const changeTab = (next: InventoryTab) => {
    setTab(next)
    const url = new URL(window.location.href)
    const param = TAB_PARAM[next]
    if (param) url.searchParams.set('tab', param)
    else url.searchParams.delete('tab')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  const closures = tab === 'closures'
  return (
    <RestaurantShell
      storeTab="inventory"
      boardId={closures ? 'UVnvR' : 'Y8SjT2'}
      title="予約枠・在庫"
      description={closures ? closuresDescription : '時間帯ごとの総枠と、媒体・LINE・当日枠の配分を確認します。'}
      boundary={!closures}
      headSize={closures ? 'compact' : undefined}
      headAfter={closures ? (ctx, storePicker) => (
        <>
          {ctx && ctx.data.stores.length > 1 ? storePicker : null}
          {ctx?.store && canWriteRole(role) ? (
            <Button variant="primary" onClick={() => setDialog({ mode: 'add', day: todayIn(ctx.store?.timezone) })}>
              <Plus size={15} aria-hidden="true" />臨時休業・貸切を足す
            </Button>
          ) : null}
        </>
      ) : undefined}
    >
      {(ctx) => <InventoryTabs ctx={ctx} tab={tab} onTab={changeTab} dialog={dialog} onDialog={setDialog} />}
    </RestaurantShell>
  )
}
