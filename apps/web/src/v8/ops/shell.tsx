'use client'

import Link from '@/components/shared/list-navigation'
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
import { PageChromeProvider, usePageChrome } from '@/components/shell/page-chrome'
import SidebarUserMenu from '@/components/shared/sidebar-user-menu'
import SidebarVersion from '@/components/layout/sidebar-version'
import { SidebarBrand } from '@/components/layout/sidebar-identity'
import Notice from '@/components/shared/notice'
import { humanizeErrorText } from '@/components/shared/human-error-text'
import { PageHeading } from '@/components/templates/page-frame'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { SIDEBAR_TOGGLE_EVENT } from '@/lib/events'
import { logoutAndGoToLogin } from '@/lib/logout'
import type { OpsMe } from '@/lib/api'
import shellStyles from '@/components/app-shell.module.css'
import nav from '@/components/layout/sidebar.module.css'
import styles from './shell.module.css'

/**
 * 運営コンソールの V8 の外枠（絵  ほか運営の板一式）。
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

/** 下端の入口。2要素認証とログアウトは左下の本人カードから開く。 */
const OPS_FOOT: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/ops/members', label: 'メンバー管理', icon: Users },
]

/** 道から画面名を引く（パンくずの最後の段）。 */
export function opsTitleForPath(pathname: string): string {
  const all = [...OPS_MENU, ...OPS_FOOT, { href: '/ops/invite', label: 'メンバーの招待' }, { href: '/ops/two-factor', label: '2要素認証' }]
  const hit = all.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  if (pathname.startsWith('/ops/tenants/detail')) return '契約先の詳細'
  return hit?.label ?? ''
}

type OpsShellProps = {
  me: OpsMe | null
  meError: string
  onRetryMe: () => void
  pathname: string
  /** 代理ログイン中の帯など、板の上に出すもの。 */
  banner?: ReactNode
  children: ReactNode
}

/** 中の画面が usePageTitle で渡した名前（記事の題名など）を上の帯のパンくずの最後に出す。 */
export default function OpsShellV8(props: OpsShellProps) {
  return <PageChromeProvider><OpsShellFrame {...props} /></PageChromeProvider>
}

function OpsShellFrame({
  me,
  meError,
  onRetryMe,
  pathname,
  banner,
  children,
}: OpsShellProps) {
  const pageChrome = usePageChrome()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const drawerRef = useOverlayFocus<HTMLElement>(drawer, () => setDrawer(false))

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
      <SidebarBrand name="musubo 運営" mark="m" />
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
            {humanizeErrorText(meError || '担当者を読み込んでいます')}
            {meError ? <button type="button" onClick={onRetryMe} className={styles.meRetry}>もう一度</button> : null}
          </p>
        ) : null}
      </div>
      <div className={nav.collapseHide}><SidebarVersion /></div>
      <SidebarUserMenu name={me?.name || '—'} role="運営" collapsed={collapsed && !drawer} pathname={pathname} items={[
        { id: 'profile', label: 'プロフィールを編集', href: '/staff' },
        { id: 'members', label: 'メンバー管理', href: '/ops/members' },
        { id: 'two-factor', label: me?.totpEnabled ? '2要素認証（設定済み）' : '2要素認証の設定', href: '/ops/two-factor' },
        { id: 'logout', label: 'ログアウト', tone: 'danger', dividerBefore: true, onSelect: () => void logoutAndGoToLogin('/ops/login') },
      ]} />
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
          <aside ref={drawerRef} aria-label="運営メニュー（開いた形）" className={styles.drawer}>
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
              title={title ? `運営 › ${title}${pageChrome.title ? ` › ${pageChrome.title}` : ''}` : '運営'}
              manualHref={null}
              accounts={[{ id: 'ops', label: '運営コンソール', mark: 'm' }]}
              selectedAccountId="ops"
              onAccountChange={() => undefined}
              roleLabel="運営"
              accountScopeLabel="運営"
              userName={me?.name ?? ''}
              onLogout={() => logoutAndGoToLogin('/ops/login')}
              showIdentity={false}
              v8Chrome
              chromeVariant="shell"
              menuCollapsed={collapsed}
            />
          </div>
          <main id="ops-main" tabIndex={-1} className={shellStyles.main}>
            <div className={shellStyles.content} data-content-layout="ops">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}

/**
 * 板の中の頭（題・説明・右の操作）と、その下の注意の帯
 * 「運営コンソール：契約先のデータを扱います。操作はすべて記録されます」。
 * 管理画面 の上の環境帯（橙・墨）の役目をここが持つ。検証環境では帯の右に小さく出す。
 */
export function OpsHead({
  title,
  description,
  actions,
  environment,
  stats,
  band,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  environment?: 'production' | 'staging'
  stats?: ReactNode
  /** 見出しと注意帯の間に置く数の帯（絵 ：見出し→数の帯→注意帯の順）。 */
  band?: ReactNode
}) {
  return (
    <div className={styles.head}>
      <PageHeading title={title} help={description} actions={actions} inset="none" />
      {band}
      <Notice tone="warn" presentation="ops" className={styles.caution} data-ops-env={environment} icon={<ShieldCheck aria-hidden="true" />}>
        運営コンソール：契約先のデータを扱います。操作はすべて記録されます
      </Notice>
    </div>
  )
}
