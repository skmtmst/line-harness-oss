'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { bookingApi, type BookingMenu, type BookingRequest } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import ConfirmDialog from '@/components/shared/confirm-dialog'

/**
 * 予約管理（設計 V2 8-1 / node EAYvf）。
 *
 * 設計は「見出し ＋ 4枚のKPI ＋ 左のメニュー棚 ＋ 検索の帯 ＋ 表 ＋ 注記 ＋ 件数と頁送り」。
 * 以前は青い帯で予約URLを見せ、状態のタブを上に並べていた。作りとしては
 * 動いていたが、設計のどこにも無い形だったので組み直した。
 *
 * 状態の絞り込みは「よく使う」の並びに移した。設計にある「変更依頼のみ」は
 * その状態そのものが bookings に無いので、実際にある状態を並べている。
 */

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'all', label: '全件' },
]

const statusBadgeColor: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
  rejected: 'bg-canvas-sunken text-ink-secondary',
  expired: 'bg-canvas-sunken text-ink-secondary',
  cancelled: 'bg-canvas-sunken text-ink-secondary',
  completed: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

const statusLabel: Record<string, string> = {
  requested: 'リクエスト',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

/** 1ページに出す件数。設計の「表示 20件」に合わせる。 */
const PAGE_SIZE = 20

function formatJpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

/** 表の日時。設計は年を出していない（08/18 14:00）。 */
function formatShort(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function formatJpTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

/** JSTでの年月（2026-08）。集計の区切りに使う。 */
function jstMonth(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7)
}

function jstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

function monthKey(offset: number): string {
  const now = new Date(Date.now() + 9 * 3600_000)
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return d.toISOString().slice(0, 7)
}

export default function BookingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [tab, setTab] = useState<string>('requested')
  /** 「今日」「今週」の絞り込み。設計の「よく使う」にある。 */
  const [range, setRange] = useState<'all' | 'today' | 'week'>('all')
  const [menuFilter, setMenuFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<BookingRequest[]>([])
  /** KPIとメニュー別の件数を出すための全件。タブとは別に取る。 */
  const [allItems, setAllItems] = useState<BookingRequest[]>([])
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // copied 状態は URL 単位で持つ。アカウント切替で shareUrl が変わると
  // 自動で「コピー済」が消えるので、A の URL をコピーしたまま B 画面で
  // 「B フォームと思い込んで送信」する事故を防ぐ。
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [decideTarget, setDecideTarget] = useState<{ id: string; action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete' } | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [decideError, setDecideError] = useState('')
  // 詳細パネルは行の実体ではなく id を保持する。承認などで再読み込みしたあとも
  // 最新の行を引き直せるので、パネルに古い状態が残らない。
  const [detailId, setDetailId] = useState<string | null>(null)

  const liffId = selectedAccount?.liffId ?? null
  // Worker `/o` は ref 解決・追跡なしで liffId を直接受けるラップ URL。
  // `liff.line.me` を直貼りすると OpenChat / IG DM 等で削除されるため、
  // LINE 内配信も SNS 配信もこの 1 本で完結させる。/o は LINE 内 UA でも
  // 「LINEで開く」ボタン経由で Universal Link → LIFF を起動する。
  const workerBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const shareUrl =
    workerBase && liffId
      ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book`
      : null
  const copied = copiedUrl !== null && copiedUrl === shareUrl

  async function copyUrl(url: string | null) {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => {
        setCopiedUrl((cur) => (cur === url ? null : cur))
      }, 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    // タブ/アカウント切り替えで先に list をクリア。fetch 失敗時に前タブの行が
    // 残ってしまい、誤って別ステータスの予約を操作してしまう事故を防ぐ。
    setItems([])
    try {
      const r = await bookingApi.listRequests(selectedAccountId, tab)
      setItems(r.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, tab])

  useEffect(() => {
    load()
  }, [load])

  // KPIとメニュー棚は、いま見ているタブに関係なく全件から出す。
  // タブを切り替えるたびに数が動くと、上の数字が何を指しているか読めない。
  useEffect(() => {
    if (!selectedAccountId) return
    let alive = true
    void (async () => {
      try {
        const [all, menuList] = await Promise.all([
          bookingApi.listRequests(selectedAccountId, 'all'),
          bookingApi.listMenus(selectedAccountId),
        ])
        if (!alive) return
        setAllItems(all.requests)
        setMenus(menuList.menus)
      } catch {
        // KPI が出ないだけで一覧は使える。ここで画面全体を止めない。
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedAccountId])

  type BookingAction = 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete'

  /**
   * 予約の状態を変える。**押す前に確認を出す。**
   *
   * ブラウザの `confirm()` / `alert()` は見た目がブラウザ任せで、設計の
   * 確認窓と違ううえ、**画像比較に写らない**（確認と失敗の絵をそもそも
   * 撮れない）。失敗は窓の中に出して、押した場所から動かさない。
   */
  async function runDecide(id: string, action: BookingAction) {
    if (!selectedAccountId) return
    setDeciding(true)
    setDecideError('')
    try {
      await bookingApi.decideRequest(selectedAccountId, id, action)
      setDecideTarget(null)
      await load()
    } catch (e) {
      setDecideError(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeciding(false)
    }
  }

  function handleDecide(id: string, action: BookingAction) {
    setDecideError('')
    setDecideTarget({ id, action })
  }

  const kpi = useMemo(() => {
    const thisMonth = monthKey(0)
    const lastMonth = monthKey(-1)
    const inThis = allItems.filter((b) => jstMonth(b.starts_at) === thisMonth)
    const inLast = allItems.filter((b) => jstMonth(b.starts_at) === lastMonth)
    const cancelled = inThis.filter(
      (b) => b.status === 'cancelled' || b.status === 'rejected' || b.status === 'no_show',
    ).length
    return {
      total: inThis.length,
      diff: inThis.length - inLast.length,
      confirmed: inThis.filter((b) => b.status === 'confirmed').length,
      cancelled,
      rate: inThis.length > 0 ? Math.round((cancelled / inThis.length) * 100) : null,
    }
  }, [allItems])

  const menuCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of allItems) counts.set(b.menu_name, (counts.get(b.menu_name) ?? 0) + 1)
    return counts
  }, [allItems])

  const filtered = useMemo(() => {
    const today = jstDay(new Date().toISOString())
    const weekAhead = jstDay(new Date(Date.now() + 6 * 86_400_000).toISOString())
    const q = query.trim()
    return items.filter((b) => {
      if (menuFilter !== 'all' && b.menu_name !== menuFilter) return false
      if (q && !(b.friend_name ?? '').includes(q)) return false
      if (range === 'today' && jstDay(b.starts_at) !== today) return false
      if (range === 'week') {
        const d = jstDay(b.starts_at)
        if (d < today || d > weekAhead) return false
      }
      return true
    })
  }, [items, menuFilter, query, range])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  // 絞り込みが変わったら1ページ目に戻す。3ページ目のまま条件を狭めると
  // 「該当なし」に見えてしまう。
  useEffect(() => {
    setPage(1)
  }, [tab, menuFilter, query, range])

  // タブ切替やアカウント切替で items が入れ替わったとき、開いていた予約が
  // 一覧から消えることがある。その場合はパネルを閉じる。
  const detail = detailId ? (items.find((b) => b.id === detailId) ?? null) : null
  useEffect(() => {
    if (detailId && !items.some((b) => b.id === detailId)) setDetailId(null)
  }, [items, detailId])

  return (
    <div>
      <div data-design="Head">
        <Header
          title="予約管理"
          description="トリミングなどの予約を管理します。友だちが自分で予約履歴を確認できるURLも発行できます。"
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            disabled
            title="操作マニュアルは準備中です"
            className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
          >
            マニュアル
          </button>
          <Link
            href="/booking/staff/shifts"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm"
          >
            受付時間を設定
          </Link>
          <Link
            href="/booking/bookings/new"
            className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium"
          >
            電話の予約を入れる
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div data-design="KPIs" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          title="今月の予約"
          value={kpi.total}
          unit="件"
          detail={`前月比 ${kpi.diff >= 0 ? '+' : ''}${kpi.diff}`}
        />
        <Kpi title="確定" value={kpi.confirmed} unit="件" detail="来店予定" />
        {/* 設計は「変更依頼 / 要対応」。bookings の状態に「変更依頼」が無いので
            承認待ちを出す。要対応であることは変わらない。 */}
        <Kpi
          title="変更依頼"
          value={allItems.filter((b) => b.status === 'requested').length}
          unit="件"
          detail="要対応"
        />
        <Kpi
          title="キャンセル"
          value={kpi.cancelled}
          unit="件"
          detail={kpi.rate === null ? '率 —' : `率 ${kpi.rate}%`}
        />
      </div>

      <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
        <aside
          data-design="Folders"
          className="bg-canvas rounded-card border-hairline h-fit shrink-0 border p-3 xl:w-56"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-ink text-xs font-semibold">メニュー</span>
            <span className="text-ink-faint text-xs">{allItems.length} 件</span>
          </div>
          <ul className="space-y-0.5">
            <li>
              <FolderRow
                label="すべて"
                count={allItems.length}
                active={menuFilter === 'all'}
                onClick={() => setMenuFilter('all')}
              />
            </li>
            {menus.map((m) => (
              <li key={m.id}>
                <FolderRow
                  label={m.name}
                  count={menuCounts.get(m.name) ?? 0}
                  active={menuFilter === m.name}
                  onClick={() => setMenuFilter(m.name)}
                />
              </li>
            ))}
          </ul>
        </aside>

        <div className="min-w-0 flex-1">
          <div
            data-design="Bar"
            className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="お客さま名で検索"
              aria-label="お客さま名で検索"
              className="border-hairline rounded-control focus:ring-accent min-w-0 flex-1 border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
            {/*
              **押しても何も起きない選び口を出さない**（`v6-common-rules` §5-5
              「動くまで描かない」）。押せない形で位置だけ見せても、いつ使える
              ようになるのか読む人には分からない。
            */}
            <span className="text-ink-faint text-xs whitespace-nowrap">表示</span>
            {/*
              **押しても何も起きない選び口を出さない**（`v6-common-rules` §5-5
              「動くまで描かない」）。押せない形で位置だけ見せても、いつ使える
              ようになるのか読む人には分からない。
            */}
            <button
              disabled
              title="保存した条件は準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm opacity-50"
            >
              保存した条件
            </button>
          </div>

          <div data-design="Saved" className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-faint text-xs">よく使う</span>
            {STATUS_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-pill px-3 py-1 text-xs font-medium transition-colors ${
                  tab === key
                    ? 'bg-accent-deep text-on-accent'
                    : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="border-hairline mx-1 h-4 border-l" />
            <button
              onClick={() => setRange(range === 'today' ? 'all' : 'today')}
              className={`rounded-pill px-3 py-1 text-xs font-medium ${
                range === 'today'
                  ? 'bg-accent-deep text-on-accent'
                  : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
              }`}
            >
              今日
            </button>
            <button
              onClick={() => setRange(range === 'week' ? 'all' : 'week')}
              className={`rounded-pill px-3 py-1 text-xs font-medium ${
                range === 'week'
                  ? 'bg-accent-deep text-on-accent'
                  : 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
              }`}
            >
              今週
            </button>
          </div>

          {!selectedAccountId ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
              サイドバーでアカウントを選択してください
            </div>
          ) : loading ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
              読み込み中…
            </div>
          ) : shown.length === 0 ? (
            <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
              該当する予約はありません
            </div>
          ) : (
            <div
              data-design="Table"
              className="bg-canvas rounded-card border-hairline overflow-hidden border"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="bg-canvas-sunken border-hairline border-b">
                      <Th>日時</Th>
                      <Th>お客さま</Th>
                      <Th>メニュー</Th>
                      <Th>担当</Th>
                      <Th>予約経路</Th>
                      <Th className="text-right">料金</Th>
                      <Th>状態</Th>
                      <Th className="text-right">操作</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shown.map((b) => (
                      <tr key={b.id} className="hover:bg-canvas-sunken">
                        <td className="px-4 py-3 text-sm whitespace-nowrap">
                          {formatShort(b.starts_at)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={`/chats?friend=${b.friend_id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {b.friend_name ?? '-'}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm">{b.menu_name}</td>
                        <td className="px-4 py-3 text-sm">{b.staff_name}</td>
                        {/* 予約はいまLINE内の予約フォームからしか入らない。
                            経路の列は bookings に無いので、実態どおり LINE と出す。 */}
                        <td className="px-4 py-3 text-sm">
                          <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs">
                            LINE
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums">
                          ¥{b.price_at_booking.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs ${statusBadgeColor[b.status] ?? 'bg-canvas-sunken'}`}
                          >
                            {statusLabel[b.status] ?? b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setDetailId(b.id)}
                              className="text-ink-secondary bg-canvas-sunken rounded-md px-3 py-1 text-xs font-medium hover:bg-gray-200"
                            >
                              詳細
                            </button>
                            <ActionButtons
                              status={b.status}
                              onAction={(a) => handleDecide(b.id, a)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div data-design="note" className="bg-canvas-sunken rounded-card mt-3 p-3">
            <p className="text-ink-secondary text-xs leading-5">
              友だち予約URLと、友だちが自分の予約履歴を見るURLをそれぞれ発行できます。予約履歴URLを配ると「自分の予約を確認したい」という問い合わせを減らせます。
            </p>
            {shareUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="友だち予約URL"
                  onFocus={(e) => e.currentTarget.select()}
                  className="border-hairline bg-canvas rounded-control min-w-0 flex-1 border px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => copyUrl(shareUrl)}
                  className="bg-accent-deep text-on-accent rounded-control px-4 py-2 text-sm font-medium"
                >
                  {copied ? 'コピー済' : 'コピー'}
                </button>
                <span className="text-ink-faint text-xs">予約履歴URLは準備中です</span>
              </div>
            ) : (
              <p className="text-warning mt-2 text-xs">
                このアカウントには LIFF ID が未設定です。
                <Link href="/accounts" className="ml-1 underline">
                  アカウント設定
                </Link>
                で LIFF ID を登録してください。
              </p>
            )}
          </div>

          <div data-design="tf" className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink-faint text-xs">全 {filtered.length} 件</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
              >
                前へ
              </button>
              <span className="text-ink-secondary px-2 text-xs tabular-nums">
                {current} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={current >= pageCount}
                className="border-hairline rounded-control border px-3 py-1 text-xs disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        </div>
      </div>

      {detail && (
        <BookingDetailPanel
          booking={detail}
          onClose={() => setDetailId(null)}
          onAction={(a) => handleDecide(detail.id, a)}
        />
      )}

      <ConfirmDialog
        open={decideTarget !== null}
        title={`この予約を「${decideTarget ? actionLabel[decideTarget.action] : ''}」にしますか？`}
        description="予約した人へ、この結果がLINEで届きます。取り消すには、もう一度状態を変える必要があります。"
        confirmLabel={decideTarget ? actionLabel[decideTarget.action] : '実行する'}
        destructive={decideTarget?.action === 'reject' || decideTarget?.action === 'cancel' || decideTarget?.action === 'no_show'}
        busy={deciding}
        error={decideError || undefined}
        onCancel={() => { setDecideTarget(null); setDecideError('') }}
        onConfirm={() => { if (decideTarget) void runDecide(decideTarget.id, decideTarget.action) }}
      />
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-ink-faint px-4 py-3 text-left text-xs font-semibold ${className}`}>
      {children}
    </th>
  )
}

function Kpi({
  title,
  value,
  unit,
  detail,
}: {
  title: string
  value: number
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{title}</p>
      <p className="text-ink mt-1 text-2xl font-semibold tabular-nums">
        {value}
        <span className="text-ink-faint ml-1 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-1 text-xs">{detail}</p>
    </div>
  )
}

function FolderRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
        active ? 'bg-accent-deep text-on-accent' : 'text-ink-secondary hover:bg-canvas-sunken'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{count}</span>
    </button>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline flex gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-ink-faint w-28 shrink-0 pt-0.5 text-xs font-medium">{label}</span>
      <div className="text-ink flex-1 text-sm break-words">{children}</div>
    </div>
  )
}

function BookingDetailPanel({
  booking: b,
  onClose,
  onAction,
}: {
  booking: BookingRequest
  onClose: () => void
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <aside className="relative h-full w-full max-w-md overflow-y-auto bg-white shadow-xl">
        <div className="border-hairline sticky top-0 flex items-center justify-between gap-3 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-ink-faint text-xs">予約の詳細</p>
            <h2 className="text-ink truncate text-base font-semibold">{b.menu_name}</h2>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-xs ${statusBadgeColor[b.status] ?? 'bg-canvas-sunken'}`}
          >
            {statusLabel[b.status] ?? b.status}
          </span>
          <button
            onClick={onClose}
            className="text-ink-faint hover:bg-canvas-sunken shrink-0 rounded-md px-2 py-1 text-sm"
          >
            閉じる
          </button>
        </div>

        <div className="px-5 py-4">
          <section className="mb-6">
            <h3 className="text-ink mb-1 text-sm font-semibold">予約内容</h3>
            <DetailRow label="日時">
              {formatJpDateTime(b.starts_at)} 〜 {formatJpTime(b.ends_at)}
            </DetailRow>
            <DetailRow label="担当">{b.staff_name}</DetailRow>
            <DetailRow label="料金">
              <span className="tabular-nums">¥{b.price_at_booking.toLocaleString()}</span>
            </DetailRow>
            <DetailRow label="予約番号">
              <span className="text-ink-secondary font-mono text-xs">{b.id}</span>
            </DetailRow>
          </section>

          <section className="mb-6">
            <h3 className="text-ink mb-1 text-sm font-semibold">お客様</h3>
            <DetailRow label="お名前">
              <Link href={`/chats?friend=${b.friend_id}`} className="text-blue-600 hover:underline">
                {b.friend_name ?? '名前未設定'}
              </Link>
            </DetailRow>
            <DetailRow label="ご要望">
              {b.customer_note ? (
                <span className="whitespace-pre-wrap">{b.customer_note}</span>
              ) : (
                <span className="text-ink-faint">記入なし</span>
              )}
            </DetailRow>
          </section>

          <section className="mb-6">
            <h3 className="text-ink mb-1 text-sm font-semibold">記録</h3>
            <DetailRow label="申込日時">{formatJpDateTime(b.requested_at)}</DetailRow>
            <DetailRow label="決定日時">
              {b.decided_at ? (
                formatJpDateTime(b.decided_at)
              ) : (
                <span className="text-ink-faint">未決定</span>
              )}
            </DetailRow>
            <DetailRow label="カレンダー">
              {b.external_event_id ? (
                <span className="text-green-700">Googleカレンダーに登録済み</span>
              ) : (
                <span className="text-ink-faint">未連携</span>
              )}
            </DetailRow>
          </section>

          <div className="border-hairline border-t pt-4">
            <p className="text-ink-faint mb-2 text-xs">
              承認するとお客様のLINEに確定のお知らせが届きます。
            </p>
            <ActionButtons status={b.status} onAction={onAction} />
            <Link
              href={`/booking/bookings/detail?id=${encodeURIComponent(b.id)}`}
              className="text-ink-secondary mt-3 inline-block text-xs underline"
            >
              予約の詳細ページを開く
            </Link>
          </div>
        </div>
      </aside>
    </div>
  )
}

function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (a: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('approve')}
          className="rounded-control bg-accent-deep text-on-accent hover:brightness-92 px-3 py-1 text-xs font-medium transition-colors"
        >
          承認
        </button>
        <button
          onClick={() => onAction('reject')}
          className="text-danger bg-danger-bg rounded-md px-3 py-1 text-xs font-medium hover:bg-red-100"
        >
          拒否
        </button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="inline-flex gap-1">
        <button
          onClick={() => onAction('complete')}
          className="rounded-md bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          完了
        </button>
        <button
          onClick={() => onAction('no_show')}
          className="rounded-md bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100"
        >
          無断
        </button>
        <button
          onClick={() => onAction('cancel')}
          className="text-ink-secondary bg-canvas-sunken rounded-md px-3 py-1 text-xs font-medium hover:bg-gray-200"
        >
          取消
        </button>
      </div>
    )
  }
  return <span className="text-ink-faint text-xs">-</span>
}
