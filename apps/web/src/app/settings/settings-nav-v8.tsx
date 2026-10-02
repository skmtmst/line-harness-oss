'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { canEditTable } from './manual-links/manual-link-view'
import styles from './settings-v8.module.css'

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

type NavLink = { href: string; label: string }

const TOP_LINKS: NavLink[] = [
  { href: '/accounts', label: 'LINEアカウント' },
  { href: '/staff', label: 'ログインユーザー' },
  { href: '/getting-started', label: 'はじめの設定' },
]

const FEATURE_SUB_LINKS: NavLink[] = [
  { href: '/settings/file-scan', label: 'ファイルの検査' },
]

const TAIL_LINKS: NavLink[] = [
  { href: '/emergency', label: '運用状態' },
  { href: '/ec-commerce', label: 'EC連携' },
  { href: '/line-notifications', label: 'LINE通知' },
]

export function SettingsNavV8() {
  const pathname = usePathname()
  const showManualLinks = useManualLinkAccess()

  const item = (link: NavLink, sub = false) => {
    const active = pathname === link.href
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
          {link.label}
        </Link>
      </li>
    )
  }

  return (
    <nav className={styles.nav} aria-label="設定の中のメニュー">
      <p className={styles.navTitle}>設定の中のメニュー</p>
      <ul>
        {/* 会社とロゴは API 待ち。押せるのに違う画面へ行かないよう、開く先ができるまでリンクにしない。 */}
        <li>
          <span className={`${styles.navItem} ${styles.navStatic}`}>
            会社とロゴ
            <span className={styles.navSoon}>準備中</span>
          </span>
        </li>
        {TOP_LINKS.map((link) => item(link))}
        {item({ href: '/settings', label: '機能設定' })}
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
    <div className={styles.shell}>
      <SettingsNavV8 />
      <div className={styles.main}>
        <header>
          {back ? (
            <Link href={back.href} className={styles.back}>
              ← {back.label}
            </Link>
          ) : (
            <p className={styles.headEyebrow}>設定の中のメニュー</p>
          )}
          <h1 className={styles.headTitle}>{title}</h1>
          {description && <p className={styles.headDesc}>{description}</p>}
        </header>
        {children}
      </div>
    </div>
  )
}
