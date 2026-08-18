'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { adminSessionHeaders, clearAdminSession } from '@/lib/admin-session'
import { useBrand } from '@/lib/use-brand'

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

/** サイドバーの1項目。 */
interface MenuItem {
  href: string
  label: string
  /** 24x24 の path。lucide 相当の形を手で写している。 */
  icon: string
  /** 出す数の種類（仕様 §5）。無ければバッジを出さない。 */
  badge?: 'unanswered' | 'photos' | 'unmatched'
  /** 赤で出す項目。 */
  danger?: boolean
}

interface MenuSection {
  /** 区分の見出し。null は見出しを付けない。 */
  label: string | null
  items: MenuItem[]
}

const menuSections: MenuSection[] = [
  {
    /*
     * 見出しを付けない。毎日開くものが、ここに見出し無しでひとかたまりに
     * なっている。以前は「対応」「友だち属性」と2つ見出しを挟んでいたが、
     * 項目が1〜2個の区分に見出しを付けると、行数のわりに縦が伸びる。
     */
    label: null,
    items: [
      { href: '/', label: 'ダッシュボード', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: '/chats', label: '受信箱', icon: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5', badge: 'unanswered' },
      { href: '/friends', label: '友だち', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/tags', label: '友だち属性', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
    ],
  },
  {
    label: '配信',
    items: [
      { href: '/scenarios', label: 'シナリオ配信', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { href: '/broadcasts', label: '一斉配信', icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8' },
      { href: '/reminders', label: 'リマインダ', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
      { href: '/auto-replies', label: '自動応答', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
      { href: '/friend-add-settings', label: '友だち追加時の配信', icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z' },
      { href: '/webinars', label: 'ウェビナー', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    ],
  },
  {
    /*
     * 作って置いておくもの。テンプレート・リッチメニュー・回答フォームは
     * 配信そのものではなく、配信や画面から呼ばれる材料なのでここに集める。
     * 以前はテンプレートとリッチメニューが「配信」、回答フォームが
     * 「成果と分析」にあり、同じ性格のものが3か所に散っていた。
     */
    label: 'コンテンツ',
    items: [
      { href: '/templates', label: 'テンプレート', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { href: '/rich-menus', label: 'リッチメニュー', icon: 'M4 4h6v6H4V4zm0 10h6v6H4v-6zm10-10h6v6h-6V4zm0 10h6v6h-6v-6z' },
      { href: '/form-submissions', label: '回答フォーム', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
      { href: '/contents', label: 'コンテンツ', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
    ],
  },
  {
    label: '成果と分析',
    items: [
      { href: '/conversions', label: '成果とアフィリエイト', icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' },
      { href: '/scoring', label: 'マイル', icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' },
      { href: '/inflow-links', label: '流入と計測', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
      { href: '/analytics', label: '分析', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    ],
  },
  {
    label: '自動化',
    items: [
      { href: '/automations', label: 'オートメーション', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
      { href: '/webhooks', label: '外部連携', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    ],
  },
  {
    label: '予約',
    items: [
      { href: '/booking/bookings', label: '予約管理', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { href: '/booking/menus', label: '予約設定', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/events', label: 'イベント予約', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m5-7v3m4-3v3' },
    ],
  },
  {
    label: '専用機能',
    items: [
      { href: '/nen-campaigns', label: 'NEN配信', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
      // 仕様書 §2 は /health と書いているが、/health は「BAN検知ダッシュボード」で
      // 写真審査ではない。写真審査の画面は /nen-members。
      // §3-1 が BAN検知を「運用状態」へ統合すると書いているので、そちらに合わせた。
      { href: '/nen-members', label: '写真審査', icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z', badge: 'photos' },
      { href: '/ec-commerce', label: 'EC連携', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z', badge: 'unmatched' },
    ],
  },
  {
    label: '設定',
    items: [
      { href: '/accounts', label: 'アカウント', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m5-7v3m4-3v3' },
      { href: '/staff', label: 'ログインユーザー', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
      { href: '/settings', label: '機能設定', icon: 'M4 6h16M4 12h16M4 18h7' },
      { href: '/emergency', label: '運用状態', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    ],
  },
]

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

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
  }, [])

  // 未対応件数 polling — メニュー項目にバッジを出す。5 分間隔。
  // (裏の countUnanswered は messages_log 全走査を含む重い集計なので間隔は詰めない。)
  // チャット画面での status 変更・手動返信直後は UNANSWERED_REFRESH_EVENT で
  // 即時再取得する (ポーリング待ちだと操作してもバッジが減らないと感じるため)。
  const [unansweredCount, setUnansweredCount] = useState<number>(0)
  const [pendingPhotoCount, setPendingPhotoCount] = useState<number>(0)
  // 仕様 §5 の「EC連携＝未突合の会員数」は、それを返すAPIがまだ無い。
  // overview が持つのは failed / skipped で、意味が違う。取り違えて
  // 別の数を出すより、出さないほうがよい。API ができたらここを繋ぐ。
  const unmatchedCount = 0

  // 並び順の設定。account_settings の 'sidebar.order' に、セクションの
  // ラベルを並べて持つ。設定が無ければ menuSections のままの順で出す。
  //
  // 知らないラベルは無視し、設定に無いセクションは後ろに残す。こうしないと、
  // 機能が増えたときに新しいセクションが消えてしまう。
  const [sectionOrder, setSectionOrder] = useState<string[] | null>(null)

  // 設定を読む。取れなくても既定の並びで出るので、失敗は握る。
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    void import('@/lib/api')
      .then(({ api }) => api.featureSettings.get(selectedAccountId))
      .then((res) => {
        if (!cancelled && res.success && res.data.sidebarOrder) {
          setSectionOrder(res.data.sidebarOrder)
        }
      })
      .catch(() => {
        // 並び順が取れなくても、既定の並びで使える。
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])
  const orderedSections = sectionOrder
    ? [
        ...sectionOrder
          .map((label) => menuSections.find((s) => (s.label ?? '') === label))
          .filter((s): s is (typeof menuSections)[number] => Boolean(s)),
        ...menuSections.filter((s) => !sectionOrder.includes(s.label ?? '')),
      ]
    : menuSections

  useEffect(() => {
    let cancelled = false
    // 連続操作で fetch が並走した際、遅い古いレスポンスが新しい値を上書きしない
    // ように発行順 seq でガードする。
    let seq = 0
    const fetchCount = async () => {
      const mySeq = ++seq
      try {
        const { api } = await import('@/lib/api')
        const [unanswered, nen] = await Promise.allSettled([
          api.inbox.unanswered.count(),
          api.nenMembers.overview(),
        ])
        if (cancelled || mySeq !== seq) return
        if (unanswered.status === 'fulfilled' && unanswered.value.success) {
          setUnansweredCount(unanswered.value.data.total)
        }
        // 写真審査は機能を切っている環境があるので、失敗しても他を巻き込まない。
        if (nen.status === 'fulfilled' && nen.value.success) {
          setPendingPhotoCount(nen.value.data.pendingPhotos)
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
   * どの項目に何を出すかは menuSections の `badge` が決める。
   * ここで href を見て分岐すると、行き先を変えたときにバッジだけ
   * 取り残される。
   */
  const badgeCount = (item: MenuItem) => {
    if (item.badge === 'unanswered') return unansweredCount
    if (item.badge === 'photos') return pendingPhotoCount
    if (item.badge === 'unmatched') return unmatchedCount
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
        {orderedSections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="px-3 pb-2 pt-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p>
              </div>
            )}
            {section.items.filter((item) => {
              if (item.href === '/staff' && staffRole !== 'owner') return false
              if (item.href === '/accounts' && staffRole === 'staff') return false
              return true
            }).map((item) => {
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
