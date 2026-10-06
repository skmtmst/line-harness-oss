'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { canEditTable } from './manual-links/manual-link-view'
import styles from './settings-v8.module.css'
import { Rocket, MessageCircle, Layers, Users, SlidersHorizontal, Activity, ShoppingCart, Bell, type LucideIcon } from 'lucide-react'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'

/**
 * 設定の中のメニュー（★V8 `ywFJT` の左欄）。
 * 設定系の画面へ行くための2段目のメニュー。「機能設定」には
 * その配下の画面（マニュアルの正本表・ファイルの検査）を畳んで付ける。
 */

/** マニュアルの正本表は運営だけ。見える人だけに出す（表の画面でも断る）。 */
function useManualLinkAccess(): boolean {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let active = true
    void api.staff.me()
      .then((response) => {
        if (!active || !response.success) return
        setAllowed(canEditTable(response.data))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return allowed
}

type NavLink = { href: string; label: string; icon?: LucideIcon }

const TOP_LINKS: NavLink[] = [
  { href: '/getting-started', label: 'はじめの設定', icon: Rocket },
  { href: '/accounts', label: 'LINEアカウント', icon: MessageCircle },
  { href: '/pools', label: 'プール管理', icon: Layers },
  { href: '/staff', label: 'ログインユーザー', icon: Users },
]

const FEATURE_SUB_LINKS: NavLink[] = [
  { href: '/settings/file-scan', label: 'ファイルの検査' },
]

const TAIL_LINKS: NavLink[] = [
  { href: '/emergency', label: '運用状態', icon: Activity },
  { href: '/ec-commerce', label: 'EC連携', icon: ShoppingCart },
  { href: '/line-notifications', label: 'LINE通知', icon: Bell },
]

export function SettingsNavV8() {
  const pathname = usePathname()
  const showManualLinks = useManualLinkAccess()

  const item = (link: NavLink, sub = false) => {
    const active = pathname === link.href
    const Icon = link.icon
    return (
      <li key={link.href}>
        <Link
          href={link.href}
          aria-current={active ? 'page' : undefined}
          className={[
            styles.navItem,
            sub ? styles.navSub : '',
            active ? styles.navItemActive : '',
          ].filter(Boolean).join(' ')}
        >
          {Icon && <Icon size={14} aria-hidden="true" />}
          <span className="truncate" title={link.label}>{link.label}</span>
        </Link>
      </li>
    )
  }

  return (
    <nav className={styles.nav} aria-label="設定の中のメニュー">
      <p className={styles.navTitle}>設定</p>
      <ul>
        {/* 会社とロゴは API 待ち。開く先ができるまでメニューへ出さない（今の作りの形を保つ）。 */}
        {TOP_LINKS.map((link) => item(link))}
        {item({ href: '/settings', label: '機能設定', icon: SlidersHorizontal })}
        {showManualLinks && item({ href: '/settings/manual-links', label: 'マニュアルの正本表' }, true)}
        {FEATURE_SUB_LINKS.map((link) => item(link, true))}
        {TAIL_LINKS.map((link) => item(link))}
      </ul>
    </nav>
  )
}

/**
 * 設定画面の共通の器。左のメニュー欄と、見出し（←戻る or 肩書き＋題＋説明）。
 * 各設定画面は中身だけを children に渡す。
 */
export function SettingsShellV8({
  title,
  description,
  back,
  children,
}: {
  title: string
  description?: string
  /** 配下の画面から機能設定へ戻る導線。機能設定自身では付けない。 */
  back?: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      {back && <Link href={back.href} className={styles.back}>← {back.label}</Link>}
      <ReadonlyHeaderV8 title={title} description={description ?? ''} />
      <div className={styles.shell}>
        <SettingsNavV8 />
        <div className={styles.main}>{children}</div>
      </div>
    </div>
  )
}
