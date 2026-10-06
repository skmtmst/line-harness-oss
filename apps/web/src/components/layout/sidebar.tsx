'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { SIDEBAR_TOGGLE_EVENT, UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { useBrand } from '@/lib/use-brand'
import { adminSessionHeaders } from '@/lib/admin-session'
import { restaurantTestUiEnabled } from '@/lib/environment-features'
import { HQ_MENU_SECTIONS, menuOwnerForScreen, orderedMenuSections, type MenuItem, type MenuSection } from '@/lib/menu'
import { HQ_TEMPLATE_DISTRIBUTION_ENABLED } from '@/lib/hq-template-availability'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { usePageChrome } from '@/components/shell/page-chrome'
import { defaultTitleForPath } from '@/components/shell/app-top-bar'
import SidebarIdentity from './sidebar-identity'
import { brandInitial } from './brand-initial'
import SidebarVersion from './sidebar-version'
import Notice from '@/components/shared/notice'
import HqAccountMenu from '@/components/hq/account-menu'
import {
  FEATURE_SETTINGS_UPDATED_EVENT,
  SIDEBAR_FEATURE_BY_HREF,
  SPECIALIZED_FEATURE_KEYS,
} from '@/lib/feature-settings'
import styles from './sidebar.module.css'

/* SSR では useLayoutEffect が警告になるので、描き込み前に畳み状態を
   反映するため同型のエイリアスを使う（描画後の1回分のズレを防ぐ）。 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** ★V8（夕44-A）：はじめから開く4組。ほかは見出しだけで畳む。 */
const V8_GROUPS_OPEN_BY_DEFAULT = new Set(['basic', 'delivery', 'contents', 'booking'])

/** 組の開閉を覚えるキー（ブラウザごと）。 */
const SIDEBAR_GROUPS_KEY = 'lh-sidebar-groups'

/** 左メニューのいちばん下の「設定」（夕41・部品 njl8e）。歯車は予約設定と同じ形。 */
const SETTINGS_GEAR_ICON = 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31-.826 2.37-2.37 1.04-.6 2.296-.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z'

/** 配布の受け口が無いあいだ、統括サイドバーから外す4画面。 */
const HQ_UNAVAILABLE_DISTRIBUTION_HREFS = new Set([
  '/hq/friend-attributes',
  '/hq/templates',
  '/hq/rich-menus',
  '/hq/form-submissions',
])

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
  /*
   * ★V8（夕44-A・部品 T7XSI6）：組の開閉と V2 モードの扱いにテーマが要る。
   * SSR・最初の描画は v7 の形（hydration を一致させるため）で、
   * レイアウト効果の中で本当のテーマへ揃える。
   */
  const isV8 = useAdminTheme() === 'v8'
  /*
   * V2 の友だち属性モード（移行中だけの特別な形）で組を丸ごと隠すのは
   * V8 では真似しない（MIGRATION-RISKS §1-2）。V8 では組の見出しは常に出て、
   * 中身の開閉だけが変わる。
   */
  const attrV2Mode = friendAttributesV2Mode && !isV8

  /*
   * ★V8（夕44-A）：メイン・配信・コンテンツ・予約は開いた形、それ以外は
   * 見出しだけで畳む。押すと開き、開いた状態はブラウザが覚える
   * （lh-sidebar-groups）。いまの画面の組は常に開く。
   */
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  useIsoLayoutEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_GROUPS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as unknown
        if (isBooleanRecord(parsed)) setGroupOpen(parsed)
      }
    } catch {
      // localStorage が使えないときは既定の開閉だけで動かす
    }
  }, [])
  const groupOpenByDefault = (section: MenuSection) =>
    V8_GROUPS_OPEN_BY_DEFAULT.has(section.id)
  const groupIsOpen = (section: MenuSection) =>
    groupOpen[section.id] ?? groupOpenByDefault(section)
  const toggleGroup = (section: MenuSection) => {
    setGroupOpen((current) => {
      const next = { ...current, [section.id]: !(current[section.id] ?? groupOpenByDefault(section)) }
      try {
        window.localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next))
      } catch {
        // 覚えられなくても開閉自体は動かす
      }
      return next
    })
  }

  /*
   * ★V8 外側：左メニューの畳み（幅 64・アイコンだけ）。
   * 上の帯のボタンと ⌘\ が SIDEBAR_TOGGLE_EVENT を投げ、ここで受ける。
   * 状態はブラウザに覚える（lh-sidebar-collapsed）。保存がなければ
   * 1280px 未満では畳んだ形で開く。v7 では見た目を変えないので、
   * data-collapsed が立っていても v7 の見た目は動かない。
   */
  const [collapsed, setCollapsed] = useState(false)
  const collapsedInitRef = useRef(false)
  useIsoLayoutEffect(() => {
    if (collapsedInitRef.current) return
    collapsedInitRef.current = true
    try {
      const saved = window.localStorage.getItem('lh-sidebar-collapsed')
      if (saved !== null) {
        setCollapsed(saved === '1')
      } else {
        setCollapsed(window.innerWidth < 1280)
      }
    } catch {
      // localStorage が使えないときは展開のまま
    }
  }, [])
  useEffect(() => {
    const toggle = () => {
      /* v7 では畳み機能を出さない。テーマが v7 のときは無視する。 */
      if (document.documentElement.dataset.theme !== 'v8') return
      setCollapsed((current) => {
        const next = !current
        try {
          window.localStorage.setItem('lh-sidebar-collapsed', next ? '1' : '0')
        } catch {
          // 覚えられなくても畳み自体は動かす
        }
        return next
      })
    }
    /*
     * ⌘\ / Ctrl+\ の受け口は TopBar の keydown が投げる
     * SIDEBAR_TOGGLE_EVENT に一本化する。ここでも keydown を受けると
     * 同じ押下で2回畳みが走り、開閉が元に戻る(V8-1085-KEYBOARD-01)。
     */
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, toggle)
    return () => {
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, toggle)
    }
  }, [])

  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)
  /*
   * ★V8 殻合わせ：脇の頭の会社名。契約先の名前は /api/tenants/me が返す。
   * 統括の殻のときだけ取る（ふだんの殻は選んだ店の看板で変わらない）。
   * 取れなければ null のまま「統括」で出す。
   */
  const [tenantName, setTenantName] = useState<string | null>(null)
  useEffect(() => {
    if (!isHq) return
    let cancelled = false
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    fetch(`${apiUrl}/api/tenants/me`, { credentials: 'include', headers: adminSessionHeaders() })
      .then((res) => res.json() as Promise<{ data?: { name?: string } } | null>)
      .then((tenant) => { if (!cancelled) setTenantName(tenant?.data?.name ?? null) })
      .catch(() => { if (!cancelled) setTenantName(null) })
    return () => { cancelled = true }
  }, [isHq])
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
      void Promise.all([import('@/lib/feature-visibility-cache'), import('@/lib/feature-settings-cache')])
        .then(async ([{ loadFeatureVisibility }, { loadFeatureSettings }]) => {
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
            // 機能設定画面と同じ答えを共有する。保存の合図で捨てられる。
            const settings = await loadFeatureSettings(accountId)
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
        /*
         * ★V7 C6: 統括のひな形配布（4画面）は Worker の受け口が無いあいだ
         * 「利用できません」だけのページになるため、サイドバーには出さない。
         * ページ自体は残し、配布が有効になれば再表示する。
         */
        if (isHq && !HQ_TEMPLATE_DISTRIBUTION_ENABLED && HQ_UNAVAILABLE_DISTRIBUTION_HREFS.has(item.href)) return false
        if (isHq) return true
        // 移行中のV2画面では、承認画像どおり「友だち属性」を1行だけ出す。
        // 現行 /tags 自体は消さず、通常画面のメニューにはそのまま残す。
        if (attrV2Mode && item.href === '/tags') return false
        if (attrV2Mode && item.href === '/conversions') return false
        if (attrV2Mode && item.href === '/analytics') return false
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
    .filter((section) => !attrV2Mode || !['自動化', '予約', '設定'].includes(section.label ?? ''))

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

  /*
   * スマホのメニューの焦点（★V7 修正方針 §2）。
   * 開いたら中の先頭へ、Esc で閉じ、閉じたら焦点をハンバーガーへ戻す。
   * 閉じている間は aside に inert を付け、画面外の項目へ Tab が行かないようにする
   * （以前は閉じても11項目が Tab で選べ、焦点が見えない所へ行っていた）。
   */
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true
      drawerRef.current?.querySelector<HTMLElement>('a[href], button')?.focus()
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setIsOpen(false)
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }
    if (wasOpen.current) {
      wasOpen.current = false
      if (!document.activeElement || document.activeElement === document.body || drawerRef.current?.contains(document.activeElement)) {
        menuButtonRef.current?.focus()
      }
    }
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
  const activePathname = pathname
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
   *
   * Issue #708: 宣言が複数候補を持つ画面（受付枠など）では、
   * いまの人に見えている項目のうち最初のものを選ぶ。見えている
   * 項目だけを対象にするのは、担当者専用項目（自分の勤務）が
   * 管理者のメニューには無いため。
   */
  const ownerItemId = menuOwnerForScreen(activePathname, currentSearch)
    ?.find((id) => visibleSections.some((section) => section.items.some((item) => item.id === id)))
  const hasOwnerItem = Boolean(ownerItemId)

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

  /*
   * ★V8（夕41）：左メニューのいちばん下の「設定」（歯車）は、設定の組の
   * どこかの画面を開いているとき選ばれた形にする。
   */
  const settingsActive = Boolean(
    sections.find((section) => section.id === 'settings')?.items.some((item) => isActive(item)),
  )

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
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-hairline px-4 pr-16">
          {brand.iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- LINE の CDN。静的アセットではない */
            <img src={brand.iconUrl} alt="" className="h-9 w-9 shrink-0 rounded-card object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card text-sm font-bold text-on-accent" style={{ backgroundColor: 'var(--color-accent)' }}>{brandInitial(brand.name ?? '') || 'm'}</div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">{brand.name ?? 'musubo LINE管理システム'}</p>
            <p className="mt-0.5 text-micro font-medium text-ink-faint">管理メニュー</p>
          </div>
        </div>
      ) : (
        null
      )}

      {isHq ? (
        <>
          {/* v7 の札は残す。V8 では下のロゴの段に替わる。 */}
          <div className={`px-3 pb-3 pt-4 ${styles.collapseHide} v7-only`}>
            <div className="rounded-card border border-hairline bg-canvas px-4 py-3">
              <p className="text-xs font-semibold text-accent-deep">musubo</p>
              <p className="mt-1 text-sm font-bold text-ink">統括コンソール</p>
            </div>
          </div>
          {/*
            ★V8 殻合わせ（絵 `V8-B/JKjsE`）：脇の頭は会社のロゴ（緑の四角に
            頭1字）＋会社名＋小さく musubo。会社名は契約先（/api/tenants/me）。
            取れなければ「統括」で出す。v7 は上の札のまま。
          */}
          <div className={`v8-only px-3 pb-3 pt-4 ${styles.collapseHide}`}>
            <div className="flex items-center gap-3 px-1">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-accent-deep text-lg font-bold text-canvas">
                {(tenantName ?? '統').slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lead font-bold text-ink" title={tenantName ?? undefined}>{tenantName ?? '統括'}</span>
                <span className="mt-0.5 block text-micro font-medium text-ink-faint">musubo</span>
              </span>
            </div>
          </div>
        </>
      ) : preview ? (
        <div className={`px-[13px] pb-[9px] pt-[18px] ${styles.collapseHide}`}>
          <p className="mb-[11px] text-caption font-normal text-ink-faint">現在のLINEアカウント</p>
          <div className="flex h-[66px] items-center rounded-card border border-hairline bg-canvas px-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent-soft text-body font-semibold text-accent-deep">サ</div>
            <div className="ml-3 min-w-0 flex-1">
              {/* デザイン確認用の見本。特定の利用者の名前は書かない。 */}
              <p className="truncate text-body font-semibold text-ink">サンプルアカウント</p>
              <p className="mt-0.5 truncate text-micro text-ink-faint">コミュニケーション</p>
            </div>
          </div>
        </div>
      ) : <SidebarIdentity />}

      {/* 会社名とメニューの間の線。Pencil `J33xq/pN2aM`。 */}
      <div className={styles.identityRule} />

      {/* ナビゲーション */}
      <nav className={`${styles.nav} ${preview ? 'overflow-hidden' : ''}`} data-design-node="J33xq">
        {/*
          ★V7 `x63W5x`：補助のデータ（表示可否）の失敗は、その場所の
          小さい1行で伝える。全文の「もう一度読み込む」は一覧本体の
          失敗の1枚が使う言葉なので、ここは短い「もう一度」にして
          1画面に同じ読み直しボタンを2つ出さない。
        */}
        {visibilityStatus === 'error' && selectedAccountId && (
          <Notice
            tone="warn"
            className="mx-3 mb-2"
            action={(
              <button
                type="button"
                onClick={() => setVisibilityRetry((current) => current + 1)}
                className="cursor-pointer font-bold text-action underline"
              >
                もう一度
              </button>
            )}
          >
            機能設定を読み込めませんでした。
          </Notice>
        )}
        {visibleSections.map((section) => {
          /*
           * ★V8（夕44-A）：組の見出しは押せる開閉。畳んだ組は見出しだけ
           * 残るので、組が丸ごと消えることはない。見出しの無い組（統括）は
           * 畳めない。いまいる画面の組は常に開く。アイコンだけの帯では
           * 見出し自体が無いので、畳みは効かせず全部のアイコンを出す。
           */
          const collapsible = isV8 && Boolean(section.label)
          const sectionOpen =
            !collapsible || groupIsOpen(section) || section.items.some((item) => isActive(item))
          const hideItems = isV8 && !sectionOpen && !(collapsed && !drawer)
          return (
          <div key={section.id} className={styles.section}>
            {section.label && (
              isV8 ? (
                <button
                  type="button"
                  className={styles.sectionToggle}
                  onClick={() => toggleGroup(section)}
                  aria-expanded={sectionOpen}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                  <svg
                    className={`${styles.sectionChevron} ${sectionOpen ? '' : styles.sectionChevronClosed}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              ) : (
                <div className={attrV2Mode ? 'flex h-[20px] items-center px-3' : styles.sectionHeading}>
                  <p>{section.label}</p>
                </div>
              )
            )}
            {!hideItems && section.items.map((item) => {
              const active = isActive(item)
              const isDanger = 'danger' in item && item.danger
              const visibleLabel = item.label
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // V8は多数の別画面を先読みせず、選んだ画面だけ読み込む。
                  prefetch={isV8 ? false : undefined}
                  onClick={() => setCurrentSearch(item.href.includes('?') ? `?${item.href.split('?')[1]}` : '')}
                  title={visibleLabel}
                  /*
                    いま開いている項目は、薄い緑の地に濃い緑の文字。設計も
                    この形。緑で塗りつぶして白抜きにすると、色の面積が大きく
                    なって一覧の中でそこだけ浮き、目が先にそこへ行く。
                    印は「いまここ」を示せれば足りる。
                  */
                  className={`${styles.item} ${attrV2Mode ? `${section.label ? 'h-[36px]' : 'h-[42px]'} border border-transparent text-label` : ''} ${
                    active
                      ? isDanger
                        ? `${styles.active} ${styles.danger}`
                        : attrV2Mode
                          ? `${styles.active} border-accent`
                          : styles.active
                      : isDanger
                        ? styles.danger
                        : ''
                  }`}
                >
                  <span className="shrink-0"><NavIcon d={item.icon} /></span>
                  <span className={`${styles.itemLabel} min-w-0 flex-1 truncate`}>{visibleLabel}</span>
                  {badgeCount(item) > 0 && (
                    <>
                      {/* レール幅では数字が入らないので点だけ。件数は名前と一緒に出す。 */}
                      {/* 地が薄い緑になったので、選ばれていても札の色は変えない。
                          緑ベタの上に置いていたころは白抜きにする必要があった。 */}
                      <span className={styles.badge}>
                        {badgeCount(item) > 99 ? '99+' : badgeCount(item)}
                      </span>
                      {/* 読み上げは「33件」と続け、数字と単位の間に空白を入れない（§2-6）。 */}
                      <span className="sr-only">{badgeCount(item)}件</span>
                    </>
                  )}
                </Link>
              )
            })}
          </div>
          )
        })}
      </nav>

      {/*
        ★V8（夕41・部品 njl8e）：左メニューのいちばん下、版の上に「設定」。
        オーナー・管理者にだけ出す。設定の画面ではここが選ばれた形にする。
        nav は中身が多いときだけ縦に送り、この入口と版は下端に固定される。
      */}
      {isV8 && !isHq && !preview && (staffRole === 'owner' || staffRole === 'admin') && (
        <div className={styles.settingsEntry}>
          <Link
            href="/settings"
            prefetch={false}
            title="設定"
            className={`${styles.item} ${settingsActive ? styles.active : ''}`}
          >
            <span className="shrink-0"><NavIcon d={SETTINGS_GEAR_ICON} /></span>
            <span className={`${styles.itemLabel} min-w-0 flex-1 truncate`}>設定</span>
          </Link>
        </div>
      )}
      {/*
        統括（/hq）の脇の下には歯車の入口を置かない
        （Pencil 承認 2026-10-06・`LINE-Harness-V8-B.pen` の `s6kZt/wCdWg`）。
        統括の情報の画面へは左下のアカウントの行から行く。店舗側（上の枠）はそのまま。
      */}

      {/*
        メニューの下の版の表示（★V7 監査の直し E）。いま動いている版・
        commit・配備日時と環境。取れないときは「版の情報なし」。
        移行中の見た目承認（preview）は版の取得をしない。
        統括（/hq）には出さない（同じ承認・`s6kZt/wCdWg`）。
        V8 でメニューを畳んだときは枠ごと隠す（`styles.collapseHide`）。
      */}
      {preview || isHq ? null : <div className={styles.collapseHide}><SidebarVersion /></div>}

      {/*
        名前・権限・ログアウトは、2026-08-26 に共通トップバーへ移した。
        ここに残すと二重に出る（`docs/v6-common-rules.md` §1）。
        枠だけ残すのは、下端の余白がメニューの最後の項目に食い込まないため。

        統括（/hq）だけは例外（2026-09-12、§1-2）。下端にログイン中のアカウントを置き、
        押すとメンバー管理・お問い合わせ・ログアウトのメニューが上に開く。
        正本は ★V6 36-1 `qAvlC`。中身は `components/hq/account-menu.tsx` が持つ。
      */}
      {isHq ? <div className={styles.collapseHide}><HqAccountMenu /></div> : <div className={styles.footer} />}
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
          ref={menuButtonRef}
          onClick={() => setIsOpen(!isOpen)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-control hover:bg-shell transition-colors"
          aria-label="メニュー"
          aria-expanded={isOpen}
          aria-controls="mobile-menu"
        >
          <svg className="w-6 h-6 text-ink-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
        {/* いま開いている画面の名前。取れない画面はアカウント名で埋める。
            1280px 未満では PC のトップバー（画面の唯一の <h1>）を畳むので、
            現在地を h1 で持つのはここ（#734: 390px で全画面 h1 が消えていた）。 */}
        <h1 className={styles.mobileTitle} title={mobileTitle || brand.name || undefined}>
          {mobileTitle || brand.name || 'musubo LINE管理システム'}
        </h1>
        {/* 公式アカウントの印。名前は画面名が持つので、ここはアイコンだけ。 */}
        <div className={styles.mobileBrand}>
          {brand.iconUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- LINE の CDN。静的アセットではない */
            <img src={brand.iconUrl} alt="" className="w-7 h-7 rounded-control object-cover" />
          ) : (
            <div className="w-7 h-7 rounded-control flex items-center justify-center text-on-accent font-medium text-xs" style={{ backgroundColor: 'var(--color-accent)' }}>{brandInitial(brand.name ?? '') || 'm'}</div>
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
        id="mobile-menu"
        ref={drawerRef}
        aria-label="管理メニュー"
        inert={!isOpen}
        className={`${styles.drawer} ${styles.mobileOnly} ${isOpen ? '' : styles.drawerClosed}`}
      >
        <div className="absolute right-3 top-2.5 z-10">
          <button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-control hover:bg-shell" aria-label="閉じる">
            <svg className="w-5 h-5 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <aside className={styles.desktop} data-design-node="J33xq" data-collapsed={collapsed ? '' : undefined}>
        {sidebarContent(false)}
      </aside>
    </>
  )
}
