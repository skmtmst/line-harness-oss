'use client'

/*
 * ★V8-B マイルの外枠（Pencil「★V8-B 画面の地図」の行：
 * たまる決めごと `OC0gy`・使い道 `S35pO`・友だちの残高 `CJlf4`・
 * 履歴 `oRbJi`・行動スコア `IRPw8`・状態 `zaqP9`・1152 `ZJIyl`・
 * 閲覧のみ `E2Any`）。
 *
 * v7 の一覧（page.tsx の MileagePageInner）とは別の器として持つ。
 * データの口（取得・絞り込み・ページ送り）は各タブの部品が
 * v7 と同じ口へ取りに行く。違いは置き場と見せ方。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 */
import { Suspense, useCallback, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Eye } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useAdminTheme } from '@/lib/use-admin-theme'
import ListState from '@/components/shared/list-state'
import Button from '@/components/shared/button'
import styles from './mileage-v8.module.css'
import V8EarningRulesTab from './v8-earning-rules-tab'
import V8BalancesTab from './v8-balances-tab'
import V8HistoryTab from './v8-history-tab'
import V8RewardsTab from './v8-rewards-tab'
import V8ScoreTab from './v8-score-tab'

const TABS = [
  { key: 'earning-rules', label: 'たまる決めごと', node: 'OC0gy' },
  { key: 'rewards', label: '使い道', node: 'S35pO' },
  { key: 'balances', label: '友だちの残高', node: 'CJlf4' },
  { key: 'history', label: '履歴', node: 'oRbJi' },
  { key: 'score', label: '行動スコア', node: 'IRPw8' },
] as const

export type MileageV8TabKey = (typeof TABS)[number]['key']

export function MileageV8Node({ tab }: { tab: string }): string {
  return TABS.find((item) => item.key === tab)?.node ?? 'OC0gy'
}

/*
 * 作るボタン（E2Any：閲覧のみは押せない形で残す。
 * リンクのボタンは disabled を持てないので、閲覧のみは
 * リンクなしの押せないボタンにする）。
 */
export function V8CreateButton({
  href,
  readonly,
  children,
}: {
  href: string
  readonly: boolean
  children: React.ReactNode
}) {
  if (readonly) {
    return (
      <Button variant="primary" disabled title="閲覧のみのため作れません">
        {children}
      </Button>
    )
  }
  return (
    <Button variant="primary" href={href}>
      {children}
    </Button>
  )
}

/** 板の頭（題＋説明＋右の操作）。操作はタブごとに替わる。 */
export function V8Head({ actions }: { actions?: React.ReactNode }) {
  return (
    <div className={styles.head}>
      <div className={styles.headText}>
        <h1 className={styles.headTitle}>マイル</h1>
        <p className={styles.headDescription}>行動でマイルがたまり、クーポン・特典と交換できます。</p>
      </div>
      {actions ? <div className={styles.headActions}>{actions}</div> : null}
    </div>
  )
}

function MileageV8Inner() {
  usePageTitle('マイル')
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: MileageV8TabKey = TABS.some((item) => item.key === rawTab)
    ? (rawTab as MileageV8TabKey)
    : 'earning-rules'
  const role = useStaffRole()
  /* E2Any: 変える操作は出さない。CSV・検索・絞り込み・「…」は使える。 */
  const readonly = !canManageRole(role)
  /*
   * 板の頭の右に置く操作（CSV など）。タブが持つデータが要るので、
   * タブ側が登録する。タブが替わったら空に戻す。
   */
  const [headerActions, setHeaderActions] = useState<ReactNode>(null)
  /*
   * useCallback で固定しないと、タブ側の useEffect が描画のたびに
   * 回って無限に描き直す（新しい JSX を入れる setState のため）。
   */
  const registerHeaderActions = useCallback((node: ReactNode) => setHeaderActions(node), [])
  /*
   * タブの名の横の件数（板 `OC0gy`：たまる決めごと 6・使い道 5・
   * 友だちの残高 1,284）。数は各タブの読み物のため、タブ側が読み直す
   * たびにここへ載せる。取れている間は直前を残し、読み直し中は消す。
   */
  const [tabCounts, setTabCounts] = useState<Partial<Record<MileageV8TabKey, string>>>({})
  const registerTabCount = useCallback((key: MileageV8TabKey, text: string | null) => {
    setTabCounts((current) => {
      const normalized = text ?? undefined
      if (current[key] === normalized) return current
      return { ...current, [key]: normalized }
    })
  }, [])

  return (
    <div data-design-node={MileageV8Node({ tab })} className={styles.board}>
      <V8Head actions={headerActions} />

      <nav className={styles.tabs} aria-label="マイルのタブ">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={item.key === 'earning-rules' ? '/mileage' : `/mileage?tab=${item.key}`}
            className={item.key === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={item.key === tab ? 'page' : undefined}
          >
            {item.label}
            {tabCounts[item.key] ? ` ${tabCounts[item.key]}` : null}
          </Link>
        ))}
      </nav>

      {readonly ? (
        <p className={styles.band} role="note">
          <Eye size={16} aria-hidden="true" />
          閲覧のみで見ています。変える操作は管理者に頼んでください。
        </p>
      ) : null}

      {tab === 'earning-rules' ? <V8EarningRulesTab key={tab} readonly={readonly} registerHeaderActions={registerHeaderActions} registerTabCount={registerTabCount} /> : null}
      {tab === 'rewards' ? <V8RewardsTab key={tab} readonly={readonly} registerHeaderActions={registerHeaderActions} registerTabCount={registerTabCount} /> : null}
      {tab === 'balances' ? <V8BalancesTab key={tab} readonly={readonly} registerHeaderActions={registerHeaderActions} registerTabCount={registerTabCount} /> : null}
      {tab === 'history' ? <V8HistoryTab key={tab} readonly={readonly} registerHeaderActions={registerHeaderActions} /> : null}
      {tab === 'score' ? <V8ScoreTab key={tab} readonly={readonly} registerHeaderActions={registerHeaderActions} /> : null}
    </div>
  )
}

export default function MileageV8() {
  const theme = useAdminTheme()
  if (theme !== 'v8') {
    return <ListState kind="loading" title="マイルを読み込んでいます" />
  }
  return (
    <Suspense fallback={<ListState kind="loading" title="マイルを読み込んでいます" />}>
      <MileageV8Inner />
    </Suspense>
  )
}
