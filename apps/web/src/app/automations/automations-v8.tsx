'use client'

/*
 * ★V8-B オートメーションの外枠（Pencil「★V8-B 画面の地図」の行：
 * 一覧 `LWQXd`・共通アクション `LnGNw`・動いた記録 `g98F9`・
 * 見本 `c7dxp`・状態 `S3pdQ`・1152 `En14p`・閲覧のみ `nH9L8`）。
 *
 * v7 の器（各 route の既存部品）とは別の器として持つ。
 * タブは道をまたぐ（ルール・共通アクション・動いた記録・見本）。
 * データの口は各タブの部品が v7 と同じ口へ取りに行く。
 * v7 を直す必要が出たら各 route 側も同じ判断を入れる。
 */
import { useCallback, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Eye } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import Button from '@/components/shared/button'
import styles from './automations-v8.module.css'

export type AutoV8TabKey = 'rules' | 'common-actions' | 'runs' | 'templates'

const TABS: Array<{ key: AutoV8TabKey; label: string; href: string; node: string }> = [
  { key: 'rules', label: 'ルール', href: '/automations', node: 'LWQXd' },
  { key: 'common-actions', label: '共通アクション', href: '/common-actions', node: 'LnGNw' },
  { key: 'runs', label: '動いた記録', href: '/automations/runs', node: 'g98F9' },
  { key: 'templates', label: '見本', href: '/automations?tab=templates', node: 'c7dxp' },
]

export function autoV8Node(tab: AutoV8TabKey): string {
  return TABS.find((item) => item.key === tab)?.node ?? 'LWQXd'
}

export type AutoV8Counts = {
  rules?: number | null
  commonActions?: number | null
  runs?: number | null
  templates?: number | null
}

export type AutoV8Model = {
  readonly: boolean
  canManage: boolean | null
  registerHeaderActions: (node: ReactNode) => void
}

/*
 * 作るボタン（nH9L8：閲覧のみは押せない形で残す。
 * リンクのボタンは disabled を持てないので、閲覧のみは
 * リンクなしの押せないボタンにする）。
 */
export function V8AutoCreateButton({
  href,
  readonly,
  children,
}: {
  href: string
  readonly: boolean
  children: ReactNode
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

export function V8AutoShell({
  tab,
  counts,
  render,
}: {
  tab: AutoV8TabKey
  counts: AutoV8Counts
  render: (model: AutoV8Model) => ReactNode
}) {
  usePageTitle('オートメーション')
  const canManage = useCanManageAutomations()
  /* nH9L8: 変える操作は出さない。CSV・検索・絞り込み・「…」は使える。 */
  const readonly = canManage === false
  const [actions, setActions] = useState<ReactNode>(null)
  /*
   * useCallback で固定しないと、タブ側の useEffect が描画のたびに
   * 回って無限に描き直す（新しい JSX を入れる setState のため）。
   */
  const registerHeaderActions = useCallback((node: ReactNode) => setActions(node), [])

  const countOf = (key: AutoV8TabKey) => {
    const value = key === 'rules' ? counts.rules
      : key === 'common-actions' ? counts.commonActions
        : key === 'runs' ? counts.runs
          : counts.templates
    return value === undefined || value === null ? '' : ` ${value}`
  }

  return (
    <div data-design-node={autoV8Node(tab)} className={styles.board}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.headTitle}>オートメーション</h1>
          <p className={styles.headDescription}>「○○したら△△する」を決めておくと、友だちの動きに合わせて自動で動きます。</p>
        </div>
        {actions ? <div className={styles.headActions}>{actions}</div> : null}
      </div>

      <nav className={styles.tabs} aria-label="オートメーションのタブ">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={item.key === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            aria-current={item.key === tab ? 'page' : undefined}
          >
            {item.label}
            {countOf(item.key)}
          </Link>
        ))}
      </nav>

      {readonly ? (
        <p className={styles.band} role="note">
          <Eye size={16} aria-hidden="true" />
          閲覧のみで見ています。変える操作は管理者に頼んでください。
        </p>
      ) : null}

      {render({ readonly, canManage, registerHeaderActions })}
    </div>
  )
}
