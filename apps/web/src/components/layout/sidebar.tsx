'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { adminSessionHeaders, clearAdminSession } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'
import { orderedMenuSections, type MenuItem } from '@/lib/menu'
import {
  FEATURE_SETTINGS_UPDATED_EVENT,
  SIDEBAR_FEATURE_BY_HREF,
  SPECIALIZED_FEATURE_KEYS,
} from '@/lib/feature-settings'

// ─── メニュー定義 ───
//
// Pen.dev の V2 設計（`V2 1-1 ダッシュボード` のサイドバー）に合わせている。
// 区分・並び・呼び名は設計が出どころで、勝手に足したり並べ替えたりしない。
//
// 行き先（href）は実装側の都合で決まる。設計は画面の名前しか持たないので、
// 「設計の名前 → 実装のルート」の対応をここで引き受けている。
// 例: 設計の「受信箱」は実装の /chats、「友だち属性」は /tags。
//
// 設計に無い画面（重複検出、プール管理など）は、対応する画面のタブとして
// 中に入っている。サイドバーから消しても行けなくならない。

/*
 * 項目そのものは `@/lib/menu` に置いてある。機能設定と同じものを読む。
 * ここに別で並べていた頃は、メニューにしか無い項目・機能設定にしか無い
 * 項目が双方にできて、切り替えても消えない項目があった。
 */
function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { selectedAccountId } = useAccount()
  const brand = useBrand()
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [staffPermissions, setStaffPermissions] = useState<string[]>([])

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
    try { setStaffPermissions(JSON.parse(localStorage.getItem('lh_staff_permissions') || '[]')) } catch { setStaffPermissions([]) }
  }, [])

  // 未対応件数 polling — メニュー項目にバッジを出す。5 分間隔。
  // (裏の countUnanswered は messages_log 全走査を含む重い集計なので間隔は詰めない。)
  // チャット画面での status 変更・手動返信直後は UNANSWERED_REFRESH_EVENT で
  // 即時再取得する (ポーリング待ちだと操作してもバッジが減らないと感じるため)。
  const [unansweredCount, setUnansweredCount] = useState<number>(0)
  const [pendingPhotoCount, setPendingPhotoCount] = useState<number>(0)
  const [operationIssueCount, setOperationIssueCount] = useState<number>(0)
  // 仕様 §5 の「EC連携＝未突合の会員数」は、それを返すAPIがまだ無い。
  // overview が持つのは failed / skipped で、意味が違う。取り違えて
  // 別の数を出すより、出さないほうがよい。API ができたらここを繋ぐ。
  const unmatchedCount = 0

  // 並び順の設定。account_settings の 'sidebar.order' に、セクションの
  // ラベルを並べて持つ。設定が無ければ MENU_SECTIONS のままの順で出す。
  //
  // 知らないラベルは無視し、設定に無いセクションは後ろに残す。こうしないと、
  // 機能が増えたときに新しいセクションが消えてしまう。
  const [sectionOrder, setSectionOrder] = useState<string[] | null>(null)
  /** 区分の中の項目の並び。機能設定の↑↓で決めたもの。 */
  const [itemOrder, setItemOrder] = useState<Record<string, string[]> | null>(null)
  const [featureVisibility, setFeatureVisibility] = useState<Record<string, boolean>>({})
  const [specializedFeatureKeys, setSpecializedFeatureKeys] = useState<string[]>([])

  // 設定を読む。取れなくても既定の並び・表示で使えるので、失敗は握る。
  useEffect(() => {
    if (!selectedAccountId) {
      setSectionOrder(null)
      setItemOrder(null)
      setFeatureVisibility({})
      setSpecializedFeatureKeys([])
      return
    }
    let cancelled = false
    const loadSettings = () => {
      void import('@/lib/api')
        .then(({ api }) => api.featureSettings.get(selectedAccountId))
        .then((res) => {
          if (!cancelled && res.success) {
            setSectionOrder(res.data.sidebarOrder)
            setItemOrder(res.data.sidebarItemOrder)
            setFeatureVisibility(res.data.features)
            setSpecializedFeatureKeys(res.data.specializedFeatureKeys)
          }
        })
        .catch(() => {
          // 設定が取れなくても、既定の並び・表示で使える。
        })
    }
    loadSettings()
    const onSettingsUpdated = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
      if (!accountId || accountId === selectedAccountId) loadSettings()
    }
    window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, onSettingsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(FEATURE_SETTINGS_UPDATED_EVENT, onSettingsUpdated)
    }
  }, [selectedAccountId])
  // 区分の中の並びを当ててから、区分そのものの並びを当てる。
  const sections = orderedMenuSections(itemOrder)
  const orderedSections = sectionOrder
    ? [
        ...sectionOrder
          .map((label) => sections.find((s) => (s.label ?? '') === label))
          .filter((s): s is (typeof sections)[number] => Boolean(s)),
        ...sections.filter((s) => !sectionOrder.includes(s.label ?? '')),
      ]
    : sections

  const visibleSections = orderedSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.href === '/staff' && staffRole !== 'owner' && staffRole !== 'admin') return false
        if (item.href === '/accounts' && staffRole === 'staff') return false
        if (staffRole === 'staff' && !staffPermissions.includes(item.href)) return false
        const featureKey = SIDEBAR_FEATURE_BY_HREF[item.href]
        if (
          featureKey &&
          SPECIALIZED_FEATURE_KEYS.includes(featureKey) &&
          !specializedFeatureKeys.includes(featureKey)
        ) return false
        return !featureKey || featureVisibility[featureKey] !== false
      }),
    }))
    .filter((section) => section.items.length > 0)

  useEffect(() => {
    let cancelled = false
    // 連続操作で fetch が並走した際、遅い古いレスポンスが新しい値を上書きしない
    // ように発行順 seq でガードする。
    let seq = 0
    const fetchCount = async () => {
      const mySeq = ++seq
      try {
        const { api } = await import('@/lib/api')
        const [unanswered, nen, accounts] = await Promise.allSettled([
          api.inbox.unanswered.count(),
          api.nenMembers.overview(),
          api.health.accounts(),
        ])
        if (cancelled || mySeq !== seq) return
        if (unanswered.status === 'fulfilled' && unanswered.value.success) {
          setUnansweredCount(unanswered.value.data.total)
        }
        // 写真審査は機能を切っている環境があるので、失敗しても他を巻き込まない。
        if (nen.status === 'fulfilled' && nen.value.success) {
          setPendingPhotoCount(nen.value.data.pendingPhotos)
        }
        if (accounts.status === 'fulfilled' && accounts.value.success) {
          const health = await Promise.allSettled(
            accounts.value.data.map((account) => api.health.getHealth(account.id)),
          )
          if (cancelled || mySeq !== seq) return
          setOperationIssueCount(
            health.filter(
              (result) =>
                result.status === 'fulfilled' &&
                result.value.success &&
                (result.value.data.riskLevel === 'danger' || result.value.data.riskLevel === 'warning'),
            ).length,
          )
        }
      } catch {
        // サイレント失敗
      }
    }
    fetchCount()
    const id = setInterval(fetchCount, 5 * 60_000)
    const onRefresh = () => { void fetchCount() }
    window.addEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    }
  }, [])

  useEffect(() => { setIsOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  /**
   * 項目に出す数。0 のときは出さない（仕様 §5）。
   *
   * どの項目に何を出すかは MENU_SECTIONS の `badge` が決める。
   * ここで href を見て分岐すると、行き先を変えたときにバッジだけ
   * 取り残される。
   */
  const badgeCount = (item: MenuItem) => {
    if (item.badge === 'unanswered') return unansweredCount
    if (item.badge === 'photos') return pendingPhotoCount
    if (item.badge === 'unmatched') return unmatchedCount
    if (item.badge === 'operations') return operationIssueCount
    return 0
  }

  /**
   * いまの画面が、この項目のものか。
   *
   * 仕様 §4「子画面は親の項目を選択状態にする」。
   * /events/bookings を開いたら「イベント予約」が選ばれていてほしい。
   *
   * ダッシュボードだけ完全一致にする。'/' は全部の前方一致に当たるため。
   * クエリ付きの行き先はパスだけで判定する。?tab= が変わっても
   * 同じ画面にいることに変わりはない。
   */
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    const path = href.split('?')[0]
    return pathname === path || pathname.startsWith(path + '/')
  }

  /**
   * 中身は1つ。ドロワーでも常時表示でも同じものを出す。
   *
   * 幅で文字を出し分けていたのは 64px のアイコンレールがあったから。
   * レールをやめたので、出し分けも要らない。
   *
   * @param drawer ドロワーとして開いているか。先頭の見出しだけ変える
   *   （ドロワーは公式アカウントの名前、常時表示は「管理メニュー」）。
   */
  const sidebarContent = (drawer: boolean) => (
    <>
      {drawer ? (
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 px-4 pr-16">
          {brand.iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- LINE の CDN。静的アセットではない */
            <img src={brand.iconUrl} alt="" className="h-9 w-9 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-accent)' }}>然</div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-900">{brand.name ?? '然-NEN- LINE管理システム'}</p>
            <p className="mt-0.5 text-[11px] font-medium text-gray-400">管理メニュー</p>
          </div>
        </div>
      ) : (
        /* PCの先頭はアカウント切替ではなく、用途が分かる固定見出しにする。 */
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-200 px-5">
          <svg className="h-5 w-5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <p className="text-sm font-bold text-gray-900">管理メニュー</p>
        </div>
      )}

      {/* ナビゲーション */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleSections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="px-3 pb-2 pt-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p>
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item.href)
              const isDanger = 'danger' in item && item.danger
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  /*
                    いま開いている項目は、薄い緑の地に濃い緑の文字。設計も
                    この形。緑で塗りつぶして白抜きにすると、色の面積が大きく
                    なって一覧の中でそこだけ浮き、目が先にそこへ行く。
                    印は「いまここ」を示せれば足りる。
                  */
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? isDanger
                        ? 'bg-danger-bg text-danger'
                        : 'bg-accent-soft text-accent'
                      : isDanger
                        ? 'text-red-500 hover:bg-red-50'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span className="shrink-0"><NavIcon d={item.icon} /></span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {badgeCount(item) > 0 && (
                    <>
                      {/* レール幅では数字が入らないので点だけ。件数は名前と一緒に出す。 */}
                      {/* 地が薄い緑になったので、選ばれていても札の色は変えない。
                          緑ベタの上に置いていたころは白抜きにする必要があった。 */}
                      <span className="bg-amber-500 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                        {badgeCount(item) > 99 ? '99+' : badgeCount(item)}
                      </span>
                      <span className="sr-only">{badgeCount(item)} 件</span>
                    </>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* フッター */}
      <div className="border-t border-gray-200">
        {staffName && (
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
            <div className="font-medium text-gray-700">{staffName}</div>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${
              staffRole === 'owner' ? 'bg-yellow-100 text-yellow-800' :
              staffRole === 'admin' ? 'bg-blue-100 text-blue-800' :
              staffRole === 'viewer' ? 'bg-emerald-100 text-emerald-800' :
              'bg-gray-100 text-gray-600'
            }`}>
              {staffRole === 'owner' ? 'オーナー' : staffRole === 'admin' ? '管理者' : staffRole === 'viewer' ? '閲覧のみ' : 'スタッフ'}
            </span>
          </div>
        )}
        <div className="px-6 py-4">
          <button
            onClick={async () => {
              try {
                const apiUrl = process.env.NEXT_PUBLIC_API_URL
                if (apiUrl) {
                  await fetch(`${apiUrl}/api/auth/logout`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: adminSessionHeaders(),
                  })
                }
              } catch {
                // Local cleanup still logs the browser out if the network call fails.
              }
              localStorage.removeItem('lh_api_key')
              localStorage.removeItem('lh_csrf')
              localStorage.removeItem('lh_staff_name')
              localStorage.removeItem('lh_staff_role')
              localStorage.removeItem('lh_staff_permissions')
              clearAdminSession()
              window.location.href = '/login'
            }}
            className="flex w-full items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors justify-start"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>ログアウト</span>
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* モバイル: ハンバーガーヘッダー */}
      <div className="xl:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="メニュー"
        >
          <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
        {/* 名前とアイコンは公式アカウントのもの。ログイン画面と同じ扱い。 */}
        <div className="flex items-center gap-2">
          {brand.iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- LINE の CDN。静的アセットではない */
            <img src={brand.iconUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: 'var(--color-accent)' }}>然</div>
          )}
          <p className="text-sm font-bold leading-tight text-gray-900 truncate">
            {brand.name ?? '然-NEN- LINE管理システム'}
          </p>
        </div>
      </div>

      {/* オーバーレイ。ドロワーが開くのは xl 未満 */}
      {isOpen && <div className="xl:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}

      {/*
        スライドインするメニュー。

        以前は 768px 未満だけで使っていた。768〜1279px は 64px の
        アイコンレールになるが、そこでは項目名もセクション見出しも
        消えるので、初めて触る人には「メニューが無くなった」ように見える。
        レールは残したまま、その幅でもここを開けるようにした。
      */}
      <aside
        aria-label="管理メニュー"
        className={`xl:hidden fixed top-0 left-0 z-50 flex h-dvh w-[min(88vw,20rem)] flex-col border-r border-gray-200 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="absolute right-3 top-2.5 z-10">
          <button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="閉じる">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {sidebarContent(true)}
      </aside>

      {/*
        常時出すのは 1280px 以上だけ。

        768〜1279px を 64px のアイコンレールにしていたが、その幅では絵しか
        残らず、何の項目かを覚えている人しか使えない。ハンバーガーから開けば
        名前は読めるものの、閉じている間ずっと読めない帯が場所を取り続ける。
        その幅は上のハンバーガーだけにそろえる。

        中身は常に展開表示。幅で文字を出し分ける必要がなくなった。
      */}
      <aside className="hidden xl:flex w-64 bg-white border-r border-gray-200 flex-col h-screen sticky top-0">
        {sidebarContent(false)}
      </aside>
    </>
  )
}
