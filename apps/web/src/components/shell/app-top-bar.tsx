'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import TopBar from '@/components/shared/top-bar'
import Notice from '@/components/shared/notice'
import { useAccount } from '@/contexts/account-context'
import { usePageChrome } from './page-chrome'
import { MENU_SECTIONS } from '@/lib/menu'
import { logoutAndGoToLogin } from '@/lib/logout'
import { useManualHref } from '@/lib/use-manual-href'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { applyAdminTheme } from '@/components/theme-preview-switch'

/**
 * 共通トップバーを、いまの画面の値へつなぐ層。
 *
 * 見た目は `shared/top-bar.tsx`（Pencil `cBSCb`）が持つ。ここは値を集めるだけ。
 * 分けているのは、部品を1つの画面にも縛らないため（`v6-common-rules.md` §5-2）。
 */

/** ルート → メニューのラベル。長いほうから当てるので、`/tags/new` は「友だち属性」になる。 */
const MENU_LABELS: Array<[string, string]> = MENU_SECTIONS
  .flatMap((section) => section.items.map((item): [string, string] => [item.href, item.label]))
  .sort((a, b) => b[0].length - a[0].length)

/** ルートから既定の画面名を引く。当たらなければ空。 */
export function defaultTitleForPath(pathname: string): string {
  for (const [href, label] of MENU_LABELS) {
    if (pathname === href) return label
    if (href !== '/' && pathname.startsWith(`${href}/`)) return label
  }
  return ''
}

/**
 * 権限の呼び名。**`owner` は「統括」**。
 *
 * 「オーナー」ではない。V6 の設計（Pencil `cBSCb`）が「統括」で、
 * 画面にもともと浮いていた「統括」ボタンは、この印へ畳んだ。
 */
const ROLE_LABELS: Record<string, string> = {
  owner: '統括',
  admin: '管理者',
  viewer: '閲覧のみ',
  staff: 'スタッフ',
}

export default function AppTopBar() {
  const pathname = usePathname() ?? '/'
  const { title, crumbs } = usePageChrome()
  const router = useRouter()
  const { accounts, selectedAccountId, setSelectedAccountId, clearSelectedAccountId, loading, error, refreshing, refreshAccounts } = useAccount()
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('')
  /*
   * ★V8 外側：ベルの未読の数。取るのは v8 のときだけ（v7 では描かない
   * ので余計な要求を出さない）。取れなくても帯は壊さない。
   * 設定画面でその場で v8 へ切り替えたときにも取れるよう、テーマ
   * 変更の合図を受ける。
   */
  const [notificationUnread, setNotificationUnread] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!selectedAccountId) return
      if (document.documentElement.dataset.theme !== 'v8') return
      try {
        const { api } = await import('@/lib/api')
        const response = await api.notifications.center.list(selectedAccountId, { limit: 1 })
        if (cancelled) return
        if (response.success) setNotificationUnread(response.data?.unreadCount ?? 0)
      } catch {
        // 数が取れなくてもベル自体は通知一覧への入口として動く
      }
    }
    void load()
    const onThemeChanged = () => { void load() }
    window.addEventListener(ADMIN_THEME_CHANGED_EVENT, onThemeChanged)
    return () => {
      cancelled = true
      window.removeEventListener(ADMIN_THEME_CHANGED_EVENT, onThemeChanged)
    }
  }, [selectedAccountId])

  // AuthGuard が保存した値を読む。ここでは取りに行かない（二重に叩かない）。
  useEffect(() => {
    try {
      setStaffName(localStorage.getItem('lh_staff_name') ?? '')
      setStaffRole(localStorage.getItem('lh_staff_role') ?? '')
    } catch {
      // localStorage が使えない環境では名前を出さない
    }
  }, [pathname])

  /*
   * 画面ごとのマニュアルは、運営が正本表（/settings/manual-links）へ
   * 画面IDでURLを登録したときだけ出す。未登録・開けない・読み取れない
   * ときはリンク自体を出さない（「押したら無い」を作らない）。
   */
  const manualHref = useManualHref(pathname)

  const shownTitle = title ?? defaultTitleForPath(pathname)
  const isHq = pathname === '/hq' || pathname.startsWith('/hq/')

  const options = useMemo(
    () => accounts.map((a) => ({ id: a.id, label: a.displayName || a.name })),
    [accounts],
  )

  /**
   * 統括の印を押したら、店舗の一覧へ戻る。
   *
   * 2026-08-26 まで、本文の右上に「統括」ボタンが浮いていた（`HqReturnButton`）。
   * バーの印と同じ言葉が2つ並ぶので、印のほうへ畳んだ。統括以外は押せない。
   * すでに統括の画面にいるときも押せない。
   */
  const canReturnToHq = staffRole === 'owner' && !pathname.startsWith('/hq')
  const returnToHq = () => {
    clearSelectedAccountId()
    router.push('/hq')
  }

  const logout = () => logoutAndGoToLogin()

  /*
   * G6 移し替え：V8 のときだけ「前の見た目に戻す」を出す。
   * 効き方は設定画面の切り替えと同じ（このブラウザに残して覚える）。
   */
  const revertTheme = useAdminTheme() === 'v8' ? () => applyAdminTheme('v7') : undefined

  /*
   * ★V8：帯の探す欄は V8 の外側から外した（オーナー決定 2026-10-01）。
   * `?q=` の受け口自体は友だち一覧が持ち続ける。
   */

  /*
   * 一覧の取得に失敗したとき、札がただ空になるだけだと「アカウントが
   * 1件も無い」ように見える（Issue #978）。失敗と再読み込みをバーの
   * 直下へ出す。統括の画面（/hq）は画面本体が同じ失敗を出すので畳む。
   */
  const accountsLoadFailed = !isHq && !loading && Boolean(error) && accounts.length === 0

  return (
    <>
    {/*
      1280px 未満では畳む。現在地はモバイルの固定ヘッダーが持つ
      （U037/U038）。TopBar 自身のクラスではなく無印の div で包む:
      部品側の display 指定（CSS Module）より utilities の hidden が
      負ける書き方を避けるため。xl は Tailwind 既定の 1280px。
      アカウント一覧の失敗帯はこの下に別で出すので、モバイルでも
      失敗だけは見える。
    */}
    {/*
      v8 では帯を 1024px から出す（畳んだ左メニューと組むため）。
      v7 はこれまでどおり 1280px から。
    */}
    <div className="hidden xl:block v8-topbar-wrap">
    <TopBar
      title={shownTitle}
      manualHref={manualHref}
      accounts={options}
      selectedAccountId={selectedAccountId ?? ''}
      onAccountChange={setSelectedAccountId}
      showAccountSwitcher={!isHq}
      roleLabel={ROLE_LABELS[staffRole] ?? ''}
      onRoleClick={canReturnToHq ? returnToHq : undefined}
      userName={staffName}
      onLogout={logout}
      onRevertTheme={revertTheme}
      notificationUnreadCount={notificationUnread}
      v8Chrome
      crumbs={crumbs}
    />
    </div>
    {accountsLoadFailed ? (
      <Notice
        tone="danger"
        action={(
          <button
            type="button"
            onClick={() => { void refreshAccounts() }}
            disabled={refreshing}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            {refreshing ? '読み込んでいます' : '再読み込み'}
          </button>
        )}
      >
        LINEアカウントの一覧を読み込めませんでした。
      </Notice>
    ) : null}
    </>
  )
}
