'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import TopBar from '@/components/shared/top-bar'
import Notice from '@/components/shared/notice'
import { useAccount } from '@/contexts/account-context'
import { usePageChrome } from './page-chrome'
import { HQ_MENU_SECTIONS, MENU_SECTIONS, isHqShellPath } from '@/lib/menu'
import { brandInitial } from '@/components/layout/brand-initial'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { useBrand } from '@/lib/use-brand'
import { logoutAndGoToLogin } from '@/lib/logout'
import { useManualHref } from '@/lib/use-manual-href'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'
import { setDocumentTitle } from '@/lib/document-title'

/**
 * 共通トップバーを、いまの画面の値へつなぐ層。
 *
 * 見た目は `shared/top-bar.tsx`（Pencil `cBSCb`）が持つ。ここは値を集めるだけ。
 * 分けているのは、部品を1つの画面にも縛らないため（`docs/v8-design-rules.md` §5）。
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
 * タブの題だけに使う画面名（上の帯の文字は変えない）。統括のメニューと、
 * 左メニューに無い画面。上の帯の名前が無いときだけ使う。
 */
const DOCUMENT_ONLY_LABELS: Array<[string, string]> = [
  ...HQ_MENU_SECTIONS.flatMap((section) => section.items.map((item): [string, string] => [item.href, `${item.label}（統括）`])),
  ['/hq/support', 'お問い合わせ'] as [string, string],
  ['/common-actions', '共通アクション'] as [string, string],
  ['/scoring', 'スコアリング'] as [string, string],
  ['/updates', 'アップデート履歴'] as [string, string],
  ['/notifications', '通知'] as [string, string],
].sort((a, b) => b[0].length - a[0].length)

/** タブの題に使う画面名。上の帯の名前を先に、無ければ上の表から引く。 */
export function documentTitleForPath(pathname: string, shownTitle: string): string {
  if (shownTitle) return shownTitle
  for (const [href, label] of DOCUMENT_ONLY_LABELS) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return label
  }
  return ''
}

/**
 * 権限の呼び名。言葉の表（GLOSSARY.md）どおり **`owner` は「オーナー」**。
 *
 * V6 の設計（Pencil `cBSCb`）が「統括」だったが、2026-10-01 のオーナー決定で
 * 「オーナー」にそろえた。「統括」は組織と統括コンソールの名前だけに使う。
 * ただし V8 の統括の画面では、名前の下に「統括」と出す（絵 `V8-B/JKjsE`・オーナー 2026-10-07）。
 */
const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
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
  // タブの題も上の帯と同じ画面名にする（「<画面名> | musubo」）。
  useEffect(() => { setDocumentTitle(documentTitleForPath(pathname, shownTitle)) }, [pathname, shownTitle])
  const isHq = pathname === '/hq' || pathname.startsWith('/hq/')
  /*
   * ★V8 統括の外側（絵 `V8-B/JKjsE`・オーナー 2026-10-07）：統括の画面（LINEアカウントの登録も含む）では、
   * 切替の札に「統括」と統括名、名前の下に「統括」を出す。v7 は今までどおり。
   */
  const isV8 = useAdminTheme() === 'v8'
  const hqShell = isV8 && isHqShellPath(pathname)
  const [hqName, setHqName] = useState<string | null>(null)
  useEffect(() => {
    if (!hqShell) return
    let cancelled = false
    void import('@/lib/api').then(({ api }) => api.tenants.me()).then((res) => {
      if (!cancelled && res.success && res.data?.name) setHqName(res.data.name)
    }).catch(() => {
      // 取れなければ「統括」だけで出す
    })
    return () => { cancelled = true }
  }, [hqShell])
  const hqPill = hqShell ? { name: hqName ?? '統括', mark: brandInitial(hqName ?? '統括') } : null
  const roleLabel = hqShell && (staffRole === 'owner' || staffRole === 'admin') ? '統括' : (ROLE_LABELS[staffRole] ?? '')
  /* 統括の札から店を選んだら、その店へ入る（カードの「このアカウントへ入る」と同じ）。 */
  const changeAccount = (accountId: string) => {
    setSelectedAccountId(accountId)
    if (hqShell && accountId) router.push('/')
  }

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
  // 統括へ戻る口はオーナーと管理者に出す（管理者も統括を開ける。2026-10-07 オーナーの役割が管理者のため）
  const canReturnToHq = (staffRole === 'owner' || staffRole === 'admin') && !pathname.startsWith('/hq') && !hqShell
  const returnToHq = () => {
    clearSelectedAccountId()
    router.push('/hq')
  }

  const logout = () => logoutAndGoToLogin()

  /*
   * ★V8 店の画面から統括へ戻る口（絵 V8 `DIHFx/Psg7n`・オーナー 2026-10-07）。
   * 統括の権限がある人（オーナー。役割の札から統括へ戻れる人と同じ）にだけ出す。
   * 店だけの担当には出さない。
   */
  const brand = useBrand()
  const hqReturn = isV8 && canReturnToHq
    ? { companyName: brand.name ?? '統括', accountCount: accounts.length, onReturn: returnToHq }
    : null

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
    {/*
      ★V8 殻合わせ（絵 V8-B/JKjsE）：統括の画面にも切替の札を出す。
      選ぶのは状態の切替だけで、画面の移動はしない（従来どおり）。
      未選択の統括では「店舗を選択」と出る。
    */}
    <TopBar
      title={shownTitle}
      manualHref={manualHref}
      accounts={options}
      selectedAccountId={selectedAccountId ?? ''}
      onAccountChange={changeAccount}
      showAccountSwitcher={true}
      roleLabel={roleLabel}
      onRoleClick={canReturnToHq ? returnToHq : undefined}
      userName={staffName}
      onLogout={logout}
      notificationUnreadCount={notificationUnread}
      v8Chrome
      chromeVariant="shell"
      crumbs={crumbs}
      hq={hqPill}
      homeHref={hqShell ? '/hq' : '/'}
      hqReturn={hqReturn}
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
