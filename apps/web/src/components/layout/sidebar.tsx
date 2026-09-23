'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { useBrand } from '@/lib/use-brand'
import { restaurantTestUiEnabled } from '@/lib/environment-features'
import { HQ_MENU_SECTIONS, menuOwnerForScreen, orderedMenuSections, type MenuItem } from '@/lib/menu'
import { usePageChrome } from '@/components/shell/page-chrome'
import { defaultTitleForPath } from '@/components/shell/app-top-bar'
import SidebarIdentity from './sidebar-identity'
import HqAccountMenu from '@/components/hq/account-menu'
import {
  FEATURE_SETTINGS_UPDATED_EVENT,
  SIDEBAR_FEATURE_BY_HREF,
  SPECIALIZED_FEATURE_KEYS,
} from '@/lib/feature-settings'
import styles from './sidebar.module.css'

// ─── メニュー定義 ───
//
// Pen.dev の V5正式共通メニュー（`J33xq`）に合わせている。
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
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'boolean')
}

/*
 * PERF-08: バッジ件数をアカウント単位で共有する直近値。
 * 切替・再マウントで 0 へちらつかせず、表示は直近値で復帰させてから
 * 裏で取り直す。値は表示専用で、正本は常にAPIの応答。
 */
interface SidebarCounts {
  unanswered: number
  photos: number
  operations: number
}
const sidebarCountCache = new Map<string, SidebarCounts>()

/** テスト用: 共有している直近値を捨てる。 */
export function clearSidebarCountCache(): void {
  sidebarCountCache.clear()
}

export default function Sidebar({
  friendAttributesV2Mode = false,
  preview = false,
}: {
  friendAttributesV2Mode?: boolean
  preview?: boolean
} = {}) {
  const pathname = usePathname()
  const isHq = pathname === '/hq' || pathname.startsWith('/hq/')
  const { selectedAccountId } = useAccount()
  const brand = useBrand()
  /*
   * モバイルの固定ヘッダーに出す現在地（U037）。
   * PC の上部バーと同じ「ページが渡した名前 → メニューの名前 → アカウント名」。
   * PageChromeProvider の外（/visual-qa など）では null が返るだけで落ちない。
   */
  const { title: chromeTitle } = usePageChrome()
  const mobileTitle = chromeTitle ?? defaultTitleForPath(pathname ?? '')
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [staffPermissions, setStaffPermissions] = useState<string[]>([])
  const [staffViewPermissions, setStaffViewPermissions] = useState<string[]>([])

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
    try { setStaffPermissions(JSON.parse(localStorage.getItem('lh_staff_permissions') || '[]')) } catch { setStaffPermissions([]) }
    try { setStaffViewPermissions(JSON.parse(localStorage.getItem('lh_staff_view_permissions') || '[]')) } catch { setStaffViewPermissions([]) }
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
  const [featureVisibility, setFeatureVisibility] = useState<Record<string, boolean> | null>(null)
  /** 成功した可視性read-modelのaccount。切替直後に古い表示を使わない。 */
  const [visibilityAccountId, setVisibilityAccountId] = useState<string | null>(null)
  const [visibilityStatus, setVisibilityStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [visibilityRetry, setVisibilityRetry] = useState(0)
  const [specializedFeatureKeys, setSpecializedFeatureKeys] = useState<string[]>([])
  const [currentSearch, setCurrentSearch] = useState('')

  // 同じ画面の別タブをメニューへ出す項目（コンバージョン、データ移行）が
  // あるため、pathnameだけでなくクエリも選択状態へ反映する。
  useEffect(() => {
    const sync = () => setCurrentSearch(window.location.search)
    sync()
    window.addEventListener('popstate', sync)
    /*
     * router.push/replace は popstate を出さない（popstate は戻る/進む専用）。
     * 同じパスでクエリだけ変わる画面（/accounts → /accounts?tab=migration の
     * UID移行など）でも所属の選択を即時に切り替えられるよう、history の
     * 2関数だけを薄く包んで再読する。掃除のときは必ず元へ戻す。
     */
    const originalPushState = history.pushState
    const originalReplaceState = history.replaceState
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args)
      sync()
      return result
    }
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args)
      sync()
      return result
    }
    return () => {
      window.removeEventListener('popstate', sync)
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
    }
  }, [pathname])

  // 表示可否は全roleがstaff向けread-modelから読む。未確認/失敗を「表示可」と
  // みなすと別accountの任意機能を一瞬見せるので、必須ナビ以外はfail-closedにする。
  // owner/admin表示のときだけ、管理GETから保存済みの並びを追加で読む。
  useEffect(() => {
    if (!selectedAccountId) {
      setSectionOrder(null)
      setItemOrder(null)
      setFeatureVisibility(null)
      setVisibilityAccountId(null)
      setVisibilityStatus('ready')
      setSpecializedFeatureKeys([])
      return
    }
    let cancelled = false
    const accountId = selectedAccountId
    const canManageFeatureSettings = staffRole === 'owner' || staffRole === 'admin'
    setFeatureVisibility(null)
    setVisibilityAccountId(null)
    setVisibilityStatus('loading')
    const loadSettings = () => {
      void Promise.all([import('@/lib/api'), import('@/lib/feature-visibility-cache')])
        .then(async ([{ api }, { loadFeatureVisibility }]) => {
          // 画面側の useFeatureVisibility と同じ答えを共有する（V6R-S0-b）。
          const visibility = await loadFeatureVisibility(accountId)
          const features = visibility.success ? visibility.data?.features : undefined
          if (!cancelled && isBooleanRecord(features)) {
            setSectionOrder(null)
            setItemOrder(null)
            setFeatureVisibility(features)
            setVisibilityAccountId(accountId)
            setVisibilityStatus('ready')
            setSpecializedFeatureKeys(SPECIALIZED_FEATURE_KEYS)
          } else if (!cancelled) {
            setVisibilityStatus('error')
          }
          if (!canManageFeatureSettings) return
          try {
            const settings = await api.featureSettings.get(accountId)
            if (!cancelled && settings.success) {
              setSectionOrder(settings.data.sidebarOrder)
              setItemOrder(settings.data.sidebarItemOrder)
            }
          } catch {
            // 権限降格後など管理GETが拒否されても、最小read-modelの表示可否は残す。
          }
        })
        .catch(() => {
          if (!cancelled) setVisibilityStatus('error')
        })
    }
    loadSettings()
    const onSettingsUpdated = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId
      if (!accountId || accountId === selectedAccountId) setVisibilityRetry((current) => current + 1)
    }
    window.addEventListener(FEATURE_SETTINGS_UPDATED_EVENT, onSettingsUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(FEATURE_SETTINGS_UPDATED_EVENT, onSettingsUpdated)
    }
  }, [selectedAccountId, staffRole, visibilityRetry])
  // 区分の中の並びを当ててから、区分そのものの並びを当てる。
  const currentVisibility = visibilityAccountId === selectedAccountId ? featureVisibility : null
  const storeSections = orderedMenuSections(itemOrder)
  const normalizedSectionOrder = sectionOrder?.map((label) => label === 'NEN運用' ? '専用機能' : label)
  const orderedStoreSections = normalizedSectionOrder
    ? [
        ...normalizedSectionOrder
          .map((label) => storeSections.find((s) => (s.label ?? '') === label))
          .filter((s): s is (typeof storeSections)[number] => Boolean(s)),
        ...storeSections.filter((s) => !normalizedSectionOrder.includes(s.label ?? '')),
      ]
    : storeSections
  const sections = isHq ? HQ_MENU_SECTIONS : orderedStoreSections

  const visibleSections = sections
    .filter((section) => section.id !== 'restaurant-test' || restaurantTestUiEnabled())
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (isHq) return true
        // 移行中のV2画面では、承認画像どおり「友だち属性」を1行だけ出す。
        // 現行 /tags 自体は消さず、通常画面のメニューにはそのまま残す。
        if (friendAttributesV2Mode && item.href === '/tags') return false
        if (friendAttributesV2Mode && item.href === '/conversions') return false
        if (friendAttributesV2Mode && item.href === '/analytics') return false
        if (item.href === '/staff' && staffRole !== 'owner' && staffRole !== 'admin') return false
        if (item.href === '/accounts' && staffRole === 'staff') return false
        // N-411: staff 専用項目（自分の勤務）は owner/admin には出さない。
        if (item.staffOnly && staffRole !== 'staff') return false
        // 失敗時にも必須ナビは残す。任意機能だけを権限・可視性で絞る。
        // 変えられる権限でも見えるだけ権限でも、メニューには出す（N-424）。
        const permissionKey = item.permissionKey ?? item.href
        if (staffRole === 'staff' && !item.required && !staffPermissions.includes(permissionKey) && !staffViewPermissions.includes(permissionKey)) return false
        const featureKey = SIDEBAR_FEATURE_BY_HREF[item.href]
        if (!featureKey) return true
        if (!currentVisibility || currentVisibility[featureKey] !== true) return false
        if (SPECIALIZED_FEATURE_KEYS.includes(featureKey) && !specializedFeatureKeys.includes(featureKey)) return false
        return true
      }),
    }))
    .filter((section) => section.items.length > 0)
    .filter((section) => !friendAttributesV2Mode || !['自動化', '予約', '設定'].includes(section.label ?? ''))

  /*
   * PERF-08: バッジ用の件数は「出す項目があるもの」だけを購読する。
   *
   * 写真審査（nenMembers.overview）は、写真バッジの項目がメニューに無い
   * 環境（機能OFF・権限なし）でも毎サイクル呼ばれて 403 を繰り返していた。
   * メニューに写真バッジが無いなら呼ばない。未対応・運用警告は必須購読で、
   * 写真審査は別の購読に分け、成功した分から先に反映する。
   *
   * アカウント切替や再マウントで 0 に戻ると数字がちらつくので、
   * アカウントごとの直近値をモジュールに共有しておき、表示はそれで
   * 即復帰させてから裏で取り直す。
   */
  const photosBadgeVisible = visibleSections.some(
    (section) => section.items.some((item) => item.badge === 'photos'),
  )

  useEffect(() => {
    if (!selectedAccountId) {
      setUnansweredCount(0)
      setOperationIssueCount(0)
      return
    }
    const accountId = selectedAccountId
    const cached = sidebarCountCache.get(accountId)
    setUnansweredCount(cached?.unanswered ?? 0)
    setOperationIssueCount(cached?.operations ?? 0)
    let cancelled = false
    // 連続操作で fetch が並走した際、遅い古いレスポンスが新しい値を上書きしない
    // ように発行順 seq でガードする。
    let seq = 0
    const fetchCount = async () => {
      const mySeq = ++seq
      try {
        const { api } = await import('@/lib/api')
        // 運用警告は要約APIを1回だけ呼ぶ。件数分の個別取得は呼ばない(#630)。
        // ログ本文は要らない(警告数だけ)。staff に見える分だけが返る。
        const [unanswered, summary] = await Promise.allSettled([
          api.inbox.unanswered.count(),
          api.health.summary(),
        ])
        if (cancelled || mySeq !== seq) return
        const entry = sidebarCountCache.get(accountId) ?? { unanswered: 0, photos: 0, operations: 0 }
        if (unanswered.status === 'fulfilled' && unanswered.value.success) {
          setUnansweredCount(unanswered.value.data.total)
          entry.unanswered = unanswered.value.data.total
        }
        if (summary.status === 'fulfilled' && summary.value.success) {
          const total = summary.value.data.warningCount + summary.value.data.dangerCount
          setOperationIssueCount(total)
          entry.operations = total
        }
        sidebarCountCache.set(accountId, entry)
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
  }, [selectedAccountId])

  // 写真審査の件数は、写真バッジがメニューに出ているときだけ購読する。
  // 別購読なので、権限・機能で項目が無い環境では 1回も呼ばれない。
  useEffect(() => {
    if (!selectedAccountId || !photosBadgeVisible) {
      setPendingPhotoCount(0)
      return
    }
    const accountId = selectedAccountId
    const cached = sidebarCountCache.get(accountId)
    setPendingPhotoCount(cached?.photos ?? 0)
    let cancelled = false
    let seq = 0
    const fetchPhotos = async () => {
      const mySeq = ++seq
      try {
        const { api } = await import('@/lib/api')
        const nen = await api.nenMembers.overview()
        if (cancelled || mySeq !== seq) return
        if (nen.success) {
          setPendingPhotoCount(nen.data.pendingPhotos)
          const entry = sidebarCountCache.get(accountId) ?? { unanswered: 0, photos: 0, operations: 0 }
          entry.photos = nen.data.pendingPhotos
          sidebarCountCache.set(accountId, entry)
        }
      } catch {
        // サイレント失敗
      }
    }
    fetchPhotos()
    const id = setInterval(fetchPhotos, 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [selectedAccountId, photosBadgeVisible])

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
  /*
   * 前方一致だと、片方が他方の下にある2項目で両方が光る。
   * 「共通情報」(/contents/vars) を開くと「登録メディア一覧」(/contents) も
   * 選ばれて見えていた。当たるもののうち、いちばん長いものだけを選ぶ。
   */
  // 比較専用ルートも、実際に確認する「友だち属性V2」を選択中として写す。
  const activePathname = pathname === '/visual-qa/friend-attributes-v2'
    ? '/tags-v2'
    : pathname
  const activeHref = (() => {
    let best: string | null = null
    for (const section of sections) {
      for (const item of section.items) {
        if (item.href === '/') continue
        // 統括の「店舗管理」(/hq) も完全一致にする。/hq/banners や /hq/members を
        // 開いたときに店舗管理が光ってしまうため。
        if (item.href === '/hq') {
          if (activePathname === '/hq') best = '/hq'
          continue
        }
        const path = item.href.split('?')[0]
        if (activePathname !== path && !activePathname.startsWith(path + '/')) continue
        if (best === null || path.length > best.length) best = path
      }
    }
    return best
  })()

  /*
   * #984 LAY-15: URLの置き場とメニュー上の所属が違う画面は、
   * `SCREEN_MENU_OWNER`（lib/menu.ts が正本）が選ぶ項目を光らせる。
   * UID移行 `/accounts?tab=migration` は友だちタブの1枚なので、
   * 「LINEアカウント」ではなく「友だち」が選ばれる。
   * 宣言先の項目がメニューに無いときは通常のパス一致へ戻す。
   */
  const ownerItemId = menuOwnerForScreen(activePathname, currentSearch)
  const hasOwnerItem = ownerItemId
    ? sections.some((section) => section.items.some((item) => item.id === ownerItemId))
    : false

  const isActive = (item: MenuItem) => {
    const href = item.href
    if (hasOwnerItem) return item.id === ownerItemId
    if (href === '/') return activePathname === '/'
    const [path, query = ''] = href.split('?')
    if (path !== activeHref) return false

    const siblingQueries = sections
      .flatMap((section) => section.items)
      .filter((item) => item.href.split('?')[0] === path && item.href.includes('?'))
      .map((item) => item.href.split('?')[1])
    if (query) return currentSearch === `?${query}`
    return !siblingQueries.some((siblingQuery) => currentSearch === `?${siblingQuery}`)
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
        null
      )}

      {isHq ? (
        <div className="px-3 pb-3 pt-4">
          <div className="rounded-card border border-hairline bg-canvas px-4 py-3">
            <p className="text-xs font-semibold text-accent-deep">musubo</p>
            <p className="mt-1 text-sm font-bold text-ink">統括コンソール</p>
          </div>
        </div>
      ) : preview ? (
        <div className="px-[13px] pb-[9px] pt-[18px]">
          <p className="mb-[11px] text-[12px] font-normal text-ink-faint">現在のLINEアカウント</p>
          <div className="flex h-[66px] items-center rounded-[12px] border border-hairline bg-canvas px-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-soft text-[14px] font-semibold text-accent-deep">然</div>
            <div className="ml-3 min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-ink">然-NEN- TEST</p>
              <p className="mt-0.5 truncate text-[10px] text-ink-faint">コミュニケーション</p>
            </div>
          </div>
        </div>
      ) : <SidebarIdentity />}

      {/* 会社名とメニューの間の線。Pencil `J33xq/pN2aM`。 */}
      <div className={styles.identityRule} />

      {/* ナビゲーション */}
      <nav className={`${styles.nav} ${preview ? 'overflow-hidden' : ''}`} data-design-node="J33xq">
        {visibilityStatus === 'error' && selectedAccountId && (
          <div className="mx-3 mb-2 rounded-control border border-warning bg-warning-bg px-3 py-2 text-xs text-ink-secondary">
            <p>機能設定を読み込めませんでした。</p>
            <button
              type="button"
              onClick={() => setVisibilityRetry((current) => current + 1)}
              className="mt-1 cursor-pointer font-bold text-action underline"
            >
              もう一度読み込む
            </button>
          </div>
        )}
        {visibleSections.map((section, si) => (
          <div key={si} className={styles.section}>
            {section.label && (
              <div className={friendAttributesV2Mode ? 'flex h-[20px] items-center px-3' : styles.sectionHeading}>
                <p>{section.label}</p>
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item)
              const isDanger = 'danger' in item && item.danger
              const visibleLabel = friendAttributesV2Mode && item.href === '/tags-v2'
                ? '友だち属性'
                : item.label
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setCurrentSearch(item.href.includes('?') ? `?${item.href.split('?')[1]}` : '')}
                  title={visibleLabel}
                  /*
                    いま開いている項目は、薄い緑の地に濃い緑の文字。設計も
                    この形。緑で塗りつぶして白抜きにすると、色の面積が大きく
                    なって一覧の中でそこだけ浮き、目が先にそこへ行く。
                    印は「いまここ」を示せれば足りる。
                  */
                  className={`${styles.item} ${friendAttributesV2Mode ? `${section.label ? 'h-[36px]' : 'h-[42px]'} border border-transparent text-[13px]` : ''} ${
                    active
                      ? isDanger
                        ? `${styles.active} ${styles.danger}`
                        : friendAttributesV2Mode
                          ? `${styles.active} border-accent`
                          : styles.active
                      : isDanger
                        ? styles.danger
                        : ''
                  }`}
                >
                  <span className="shrink-0"><NavIcon d={item.icon} /></span>
                  <span className="min-w-0 flex-1 truncate">{visibleLabel}</span>
                  {badgeCount(item) > 0 && (
                    <>
                      {/* レール幅では数字が入らないので点だけ。件数は名前と一緒に出す。 */}
                      {/* 地が薄い緑になったので、選ばれていても札の色は変えない。
                          緑ベタの上に置いていたころは白抜きにする必要があった。 */}
                      <span className={styles.badge}>
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

      {/*
        名前・権限・ログアウトは、2026-08-26 に共通トップバーへ移した。
        ここに残すと二重に出る（`docs/v6-common-rules.md` §1）。
        枠だけ残すのは、下端の余白がメニューの最後の項目に食い込まないため。

        統括（/hq）だけは例外（2026-09-12、§1-2）。下端にログイン中のアカウントを置き、
        押すとメンバー管理・お問い合わせ・ログアウトのメニューが上に開く。
        正本は ★V6 36-1 `qAvlC`。中身は `components/hq/account-menu.tsx` が持つ。
      */}
      {isHq ? <HqAccountMenu /> : <div className={styles.footer} />}
    </>
  )

  return (
    <>
      {/*
        モバイル: ハンバーガーヘッダー。
        1280px 未満では PC の上部バー（画面名・アカウント切替）を畳み、
        現在地はここへ出す（U037）。2本のヘッダーを同時に占有させない。
      */}
      <div className={`${styles.mobileHeader} ${styles.mobileOnly}`}>
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
        {/* いま開いている画面の名前。取れない画面はアカウント名で埋める。 */}
        <p className={styles.mobileTitle} title={mobileTitle || brand.name || undefined}>
          {mobileTitle || brand.name || '然-NEN- LINE管理システム'}
        </p>
        {/* 公式アカウントの印。名前は画面名が持つので、ここはアイコンだけ。 */}
        <div className={styles.mobileBrand}>
          {brand.iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- LINE の CDN。静的アセットではない */
            <img src={brand.iconUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: 'var(--color-accent)' }}>然</div>
          )}
        </div>
      </div>

      {/* オーバーレイ。ドロワーが開くのは xl 未満 */}
      {isOpen && <div className={`${styles.scrim} ${styles.mobileOnly}`} onClick={() => setIsOpen(false)} />}

      {/*
        スライドインするメニュー。

        以前は 768px 未満だけで使っていた。768〜1279px は 64px の
        アイコンレールになるが、そこでは項目名もセクション見出しも
        消えるので、初めて触る人には「メニューが無くなった」ように見える。
        レールは残したまま、その幅でもここを開けるようにした。
      */}
      <aside
        aria-label="管理メニュー"
        className={`${styles.drawer} ${styles.mobileOnly} ${isOpen ? '' : styles.drawerClosed}`}
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
      <aside className={styles.desktop} data-design-node="J33xq">
        {sidebarContent(false)}
      </aside>
    </>
  )
}
