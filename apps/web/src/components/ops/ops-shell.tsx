'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Building2,
  ChevronsUpDown,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { api, type OpsMe } from '@/lib/api'
import Button from '@/components/shared/button'
import { adminSessionHeaders, captureAdminSessionHandoff } from '@/lib/admin-session'
import { logoutAndGoToLogin } from '@/lib/logout'
import OpsEnvBar from './ops-env-bar'
import ImpersonationBar from './impersonation-bar'
import TopBar from '@/components/shared/top-bar'

/**
 * 運営コンソールの外枠。★V6 37 系。
 *
 * 統括・店舗の共通メニュー（`J33xq`）は使わない。運営専用のサイドメニュー
 * （`jIZP0`）と環境帯（`OGkIw`）を持つ。メンバー管理はサイドメニューに置かず、
 * 左下のアカウントメニュー（37-9）から開く。
 */

const MENU: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/ops/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/ops/tenants', label: '契約先アカウント', icon: Building2 },
  { href: '/ops/support', label: 'お問い合わせ', icon: LifeBuoy },
  { href: '/ops/announcements', label: 'お知らせ', icon: Megaphone },
  { href: '/ops/knowledge', label: 'ナレッジ', icon: BookOpen },
  { href: '/ops/audit', label: '監査ログ', icon: ScrollText },
]

const OpsPageTitleContext = createContext<(title: string) => void>(() => {})
export function useOpsPageTitle(title: string) {
  const setTitle = useContext(OpsPageTitleContext)
  useEffect(() => { setTitle(title); return () => setTitle('') }, [setTitle, title])
}

export default function OpsShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<OpsMe | null>(null)
  const [checked, setChecked] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const [pageTitle, setPageTitle] = useState('')

  /*
   * 狭い画面のメニューは開閉式。画面を移ったら閉じ、開いている間は
   * Escape と背面のスクロール停止に対応する。
   */
  useEffect(() => { setNavOpen(false) }, [pathname])
  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [navOpen])

  const load = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    try {
      try { localStorage.removeItem('lh_api_key') } catch { /* private-mode fallback uses the session handoff */ }
      const handoffToken = captureAdminSessionHandoff()
      const res = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders(handoffToken) })
      if (!res.ok) {
        if (res.status === 401) { router.replace('/ops/login'); return }
        throw new Error('運営コンソールのログイン状態を確認できませんでした')
      }
      const body = await res.json() as { success?: boolean; data?: { platformAdmin?: boolean; platformAdminState?: string | null }; csrfToken?: string }
      if (!body.success || !body.data) throw new Error('運営コンソールのログイン状態を確認できませんでした')
      if (body.csrfToken) {
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch { /* Bearer session remains usable */ }
      }
      if (!body.data.platformAdmin) {
        // 招待を受けて 2要素認証待ちの人は、設定画面へ（★V6 37-10-B）
        router.replace(body.data.platformAdminState === 'awaiting_totp' ? '/ops/two-factor' : '/ops/login?error=not_platform_admin')
        return
      }
      const meRes = await api.ops.me()
      if (!meRes.success) throw new Error(meRes.error)
      setMe(meRes.data)
      setLoadError('')
      setChecked(true)
    } catch (caught) {
      // 認証済みなのに後続APIが失敗した場合までログインへ戻すと、原因を隠したまま
      // ログイン画面とのループになる。401 だけを上で戻し、それ以外は画面に残す。
      setLoadError(caught instanceof Error ? caught.message : '運営コンソールを読み込めませんでした')
      setChecked(true)
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  if (!checked) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-canvas-sunken">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-hairline border-t-accent-deep" />
      </div>
    )
  }

  if (loadError || !me) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-canvas-sunken px-4">
        <div className="w-full max-w-md rounded-card border border-hairline bg-canvas p-6 text-center shadow-sm">
          <p role="alert" className="text-label font-bold text-status-danger">{loadError || '運営コンソールを読み込めませんでした'}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onClick={() => { setChecked(false); setLoadError(''); void load() }}>もう一度試す</Button>
            <Button onClick={() => void logoutAndGoToLogin('/ops/login')}>ログインへ戻る</Button>
          </div>
        </div>
      </div>
    )
  }

  // V6 csVox: environment strip belongs to the content column, not above
  // the sidebar. Existing authentication and account-menu behavior is unchanged.
  if (pathname === '/ops/knowledge' || pathname === '/ops/support') return (
    <OpsPageTitleContext.Provider value={setPageTitle}>
    <div className="flex min-h-svh bg-shell" data-design-node="jIZP0" data-knowledge-shell>
      <OpsSidebar me={me} pathname={pathname} open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="min-w-0 flex-1">
        <OpsEnvBar />
        {me.impersonation ? <ImpersonationBar initial={me.impersonation} onChange={() => void load()} /> : null}
        <div className="flex h-12 items-center border-b border-hairline bg-canvas px-4 xl:hidden">
          <button type="button" aria-expanded={navOpen} onClick={() => setNavOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-label font-bold text-ink hover:bg-canvas-sunken">
            <Menu aria-hidden="true" className="h-5 w-5" />メニュー
          </button>
        </div>
        <TopBar title={pathname === '/ops/knowledge' ? 'ナレッジ' : pageTitle || 'お問い合わせ'} accounts={[]} selectedAccountId="" onAccountChange={() => {}} showAccountSwitcher={false}
          roleLabel="運営" userName={me.name} onLogout={() => logoutAndGoToLogin('/ops/login')} />
        <div className="px-10 pb-8 pt-3.5">{children}</div>
      </main>
    </div>
    </OpsPageTitleContext.Provider>
  )

  return (
    <div className="flex min-h-svh flex-col bg-canvas-sunken" data-design-node="jIZP0">
      <OpsEnvBar />
      {me.impersonation ? <ImpersonationBar initial={me.impersonation} onChange={() => void load()} /> : null}
      <div className="flex flex-1">
        <OpsSidebar me={me} pathname={pathname} open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="min-w-0 flex-1">
          {/*
           * 1280px未満ではナビを常設しない。256pxの帯が残ると本文が潰れて
           * 検索や操作が画面外へ出る（U094）。開く操作だけ本文の上に置く。
           */}
          <div className="flex h-12 items-center border-b border-hairline bg-canvas px-4 xl:hidden">
            <button
              type="button"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 text-label font-bold text-ink hover:bg-canvas-sunken"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
              メニュー
            </button>
          </div>
          <div className="mx-auto max-w-screen-2xl px-4 pb-8 pt-4 xl:px-10">{children}</div>
        </main>
      </div>
    </div>
  )
}

function OpsSidebar({ me, pathname, open, onClose }: { me: OpsMe; pathname: string; open: boolean; onClose: () => void }) {
  return (
    <>
      {/* 狭い画面でメニューを開いたときの暗幕。押すと閉じる。 */}
      {open ? (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={onClose}
          className="fixed inset-0 z-40 cursor-default bg-ink/40 xl:hidden"
        />
      ) : null}
      <aside
        aria-label="運営メニュー"
        className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-64 shrink-0 flex-col overflow-y-auto border-r border-hairline bg-canvas shadow-xl xl:static xl:z-auto xl:flex xl:shadow-none`}
      >
      <div className="flex items-center gap-3 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-deep text-lg font-bold text-on-accent">m</span>
        <div className="min-w-0">
          <p className="truncate text-label font-bold text-ink">musubo</p>
          <p className="truncate text-nano text-ink-faint">運営コンソール</p>
        </div>
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={onClose}
          className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-secondary hover:bg-canvas-sunken xl:hidden"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <div className="h-px bg-hairline" />
      <nav className="flex-1 px-3 pt-3">
        <p className="px-3 pb-1 pt-2 text-nano font-semibold text-ink-faint">運営</p>
        <ul className="flex flex-col gap-0.5">
          {MENU.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 rounded-md px-3 text-label ${active ? 'bg-accent-soft font-bold text-accent-deep' : 'font-semibold text-ink hover:bg-canvas-sunken'}`}
                >
                  <Icon aria-hidden="true" className={`h-4.5 w-4.5 ${active ? 'text-accent-deep' : 'text-ink-secondary'}`} />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="h-px bg-hairline" />
      <OpsAccountMenu me={me} />
      </aside>
    </>
  )
}

/** 左下のログイン中アカウント。押すと上にメニューが開く（★V6 37-9 `pxiUt`）。 */
function OpsAccountMenu({ me }: { me: OpsMe }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = me.name.trim().charAt(0) || 'M'

  return (
    <div ref={rootRef} className="relative px-3 py-3">
      {open ? (
        <div
          role="menu"
          data-design-node="RmC2T"
          className="absolute bottom-full left-3 z-20 mb-2 w-60 rounded-md border border-hairline bg-canvas py-2 shadow-lg"
        >
          <div className="px-3.5 pb-2.5 pt-1.5">
            <p className="text-label font-bold text-ink">{me.name}</p>
            {me.email ? <p className="text-nano text-ink-faint">{me.email}</p> : null}
            <p className="mt-1 flex items-center gap-1.5">
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-nano font-bold text-accent-deep">運営マスター</span>
              <span className="text-nano text-ink-faint">{me.totpEnabled ? '2要素認証 設定済み' : '2要素認証 未設定'}</span>
            </p>
          </div>
          <div className="h-px bg-divider-soft" />
          <MenuLink href="/staff" icon={UserRound}>プロフィールを編集</MenuLink>
          <MenuLink href="/ops/members" icon={Users} highlight>メンバー管理</MenuLink>
          <MenuLink href="/ops/two-factor" icon={ShieldCheck}>{me.totpEnabled ? '2要素認証（設定済み）' : '2要素認証の設定'}</MenuLink>
          <div className="h-px bg-divider-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void logoutAndGoToLogin('/ops/login')}
            className="flex h-10 w-full items-center gap-2.5 px-3.5 text-label font-bold text-status-danger hover:bg-status-danger-soft"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            ログアウト
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left hover:bg-canvas-sunken"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-label font-bold text-on-accent">{initial}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-bold text-ink">{me.name}</span>
          <span className="mt-0.5 inline-block rounded-full bg-accent-soft px-1.5 text-nano font-bold text-accent-deep">運営マスター</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 text-ink-faint" />
      </button>
    </div>
  )
}

function MenuLink({ href, icon: Icon, highlight, children }: { href: string; icon: typeof UserRound; highlight?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={`flex h-10 items-center gap-2.5 px-3.5 text-label ${highlight ? 'bg-accent-soft font-bold text-accent-deep' : 'font-semibold text-ink hover:bg-canvas-sunken'}`}
    >
      <Icon aria-hidden="true" className={`h-4 w-4 ${highlight ? 'text-accent-deep' : 'text-ink-secondary'}`} />
      {children}
    </Link>
  )
}
