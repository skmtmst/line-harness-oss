'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Menu,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import TopBar from '@/components/shared/top-bar'
import { SIDEBAR_TOGGLE_EVENT } from '@/lib/events'
import { logoutAndGoToLogin } from '@/lib/logout'
import type { OpsMe } from '@/lib/api'
import shellStyles from '@/components/app-shell.module.css'
import nav from '@/components/layout/sidebar.module.css'
import styles from './shell.module.css'

/**
 * 運営コンソールの V8 の外枠（絵 `CyW0E` ほか運営の板一式）。
 *
 * 統括・店舗と同じ外側（左メニュー 240・上の帯 60・白い板1枚）に、
 * 運営のメニューだけを載せる。見た目は共通の左メニュー・外枠の class を
 * そのまま使い、値は変えない。認証・担当者の取得は呼び元（OpsShell）が持つ。
 */

export const OPS_MENU: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/ops/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/ops/tenants', label: '契約先アカウント', icon: Building2 },
  { href: '/ops/support', label: 'お問い合わせ', icon: LifeBuoy },
  { href: '/ops/announcements', label: 'お知らせ', icon: Megaphone },
  { href: '/ops/knowledge', label: 'ナレッジ', icon: BookOpen },
  { href: '/ops/audit', label: '監査ログ', icon: ScrollText },
]

/** 下端の入口。メンバー管理と自分の2要素認証（v7 は左下のアカウントメニューから開いていた）。 */
const OPS_FOOT: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/ops/members', label: 'メンバー管理', icon: Users },
  { href: '/ops/two-factor', label: '2要素認証', icon: ShieldCheck },
]

/** 道から画面名を引く（パンくずの最後の段）。 */
export function opsTitleForPath(pathname: string): string {
  const all = [...OPS_MENU, ...OPS_FOOT, { href: '/ops/invite', label: 'メンバーの招待' }]
  const hit = all.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  if (pathname.startsWith('/ops/tenants/detail')) return '契約先の詳細'
  return hit?.label ?? ''
}

export default function OpsShellV8({
  me,
  meError,
  onRetryMe,
  pathname,
  banner,
  children,
}: {
  me: OpsMe | null
  meError: string
  onRetryMe: () => void
  pathname: string
  /** 代理ログイン中の帯など、板の上に出すもの。 */
  banner?: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)

  // 上の帯の畳むボタン（⌘\）を受ける。共通の左メニューと同じ合図。
  useEffect(() => {
    const onToggle = () => setCollapsed((v) => !v)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
  }, [])
  useEffect(() => { setDrawer(false) }, [pathname])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const title = opsTitleForPath(pathname)

  const menu = (
    <>
      <div className={`${styles.brand} ${nav.collapseHide}`}>
        <span aria-hidden="true" className={styles.brandMark}>m</span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>musubo 運営</span>
          <span className={styles.brandSub}>musubo</span>
        </span>
      </div>
      <nav className={nav.nav} aria-label="運営メニュー">
        <div className={nav.section}>
          <p className={nav.sectionToggle}>
            <span className="min-w-0 flex-1 truncate text-left">運営</span>
          </p>
          {OPS_MENU.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={`${nav.item} ${active ? nav.active : ''}`}
              >
                <Icon aria-hidden="true" />
                <span className={`${nav.itemLabel} min-w-0 flex-1 truncate`}>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
      <div className={nav.settingsEntry}>
        {OPS_FOOT.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              title={item.label}
              aria-current={active ? 'page' : undefined}
              className={`${nav.item} ${active ? nav.active : ''}`}
            >
              <Icon aria-hidden="true" />
              <span className={`${nav.itemLabel} min-w-0 flex-1 truncate`}>{item.label}</span>
            </Link>
          )
        })}
        {!me ? (
          <p className={styles.meNote} role="status">
            {meError || '担当者を読み込んでいます'}
            {meError ? <button type="button" onClick={onRetryMe} className={styles.meRetry}>もう一度</button> : null}
          </p>
        ) : null}
      </div>
    </>
  )

  return (
    <div className={shellStyles.shell} data-design-node="CyW0E">
      <div className={styles.mobileBar}>
        <button type="button" aria-expanded={drawer} onClick={() => setDrawer(true)} className={styles.mobileButton}>
          <Menu aria-hidden="true" />
          メニュー
        </button>
        <span className={styles.mobileTitle}>{title}</span>
      </div>
      {drawer ? (
        <>
          <button type="button" aria-label="メニューを閉じる" onClick={() => setDrawer(false)} className={styles.scrim} />
          <aside aria-label="運営メニュー（開いた形）" className={styles.drawer}>
            <button type="button" aria-label="メニューを閉じる" onClick={() => setDrawer(false)} className={styles.drawerClose}>
              <X aria-hidden="true" />
            </button>
            {menu}
          </aside>
        </>
      ) : null}
      {banner}
      <div className={shellStyles.workspace}>
        <aside className={nav.desktop} data-collapsed={collapsed ? '' : undefined}>
          {menu}
        </aside>
        <div className={`${shellStyles.side} ${styles.side}`}>
          <div className="hidden xl:block v8-topbar-wrap">
            <TopBar
              title={title ? `運営 › ${title}` : '運営'}
              manualHref={null}
              accounts={[{ id: 'ops', label: '運営コンソール', mark: 'm' }]}
              selectedAccountId="ops"
              onAccountChange={() => undefined}
              roleLabel="運営"
              userName={me?.name ?? ''}
              onLogout={() => logoutAndGoToLogin('/ops/login')}
              v8Chrome
              menuCollapsed={collapsed}
            />
          </div>
          <main id="ops-main" tabIndex={-1} className={shellStyles.main}>
            <div className={shellStyles.content}>{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}

/**
 * 板の中の頭（題・説明・右の操作）と、その下の注意の帯
 * 「運営コンソール：契約先のデータを扱います。操作はすべて記録されます」。
 * v7 の上の環境帯（橙・墨）の役目をここが持つ。検証環境では帯の右に小さく出す。
 */
export function OpsHead({
  title,
  description,
  actions,
  environment,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  environment?: 'production' | 'staging'
}) {
  return (
    <div className={styles.head}>
      <div className={styles.headRow}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>{title}</h2>
          {description ? <p className={styles.headDesc}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.headActions}>{actions}</div> : null}
      </div>
      <p className={styles.caution} data-ops-env={environment}>
        <ShieldCheck aria-hidden="true" />
        <span>運営コンソール：契約先のデータを扱います。操作はすべて記録されます</span>
        {environment === 'staging' ? <span className={styles.envTag}>検証環境</span> : null}
      </p>
    </div>
  )
}
