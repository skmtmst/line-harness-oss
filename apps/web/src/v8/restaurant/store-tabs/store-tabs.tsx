'use client'

/*
 * ★V8 店のタブ（提案 E-1 `hKRRF` の「店のタブ」）。
 *
 * 同じ店の中の画面（ダッシュボード・予約台帳・座席・卓・予約枠・在庫）を、左メニューへ戻らずに行き来する。
 * 形は共通のタブ（Tabs）。ここは並びと行き先だけを持つ。左メニューの項目はそのまま残す。
 */
import { Tabs } from '@/components/shared/tabs'
import styles from './store-tabs.module.css'

export type StoreTabKey = 'dashboard' | 'reservations' | 'tables' | 'inventory'

export const STORE_TABS: Array<{ key: StoreTabKey; label: string; href: string }> = [
  { key: 'dashboard', label: 'ダッシュボード', href: '/restaurant-test/dashboard' },
  { key: 'reservations', label: '予約（今日・今月・一覧）', href: '/restaurant-test/reservations' },
  { key: 'tables', label: '座席・卓', href: '/restaurant-test/tables' },
  { key: 'inventory', label: '予約枠・在庫', href: '/restaurant-test/inventory' },
]

export default function StoreTabs({ current, flush = false }: {
  current: StoreTabKey
  /** 板の左右の余白を持たない器（予約台帳・座席・在庫の器 booking-kit/shell）の中に置くとき true。 */
  flush?: boolean
}) {
  return (
    <div className={flush ? undefined : styles.row} data-store-tabs="">
      <Tabs
        label="店の中の画面"
        items={STORE_TABS.map((tab) => ({ label: tab.label, href: tab.href, current: tab.key === current }))}
      />
    </div>
  )
}
