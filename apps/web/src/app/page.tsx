'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { EntryRoute } from '@line-crm/shared'
import { api, type DashboardOverview } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import PendingInboxCard from '@/components/support/pending-inbox-card'
import ShipmentPanel from '@/components/dashboard/shipment-panel'
import KpiCard from '@/components/dashboard/kpi-card'
import QrDialog from '@/components/dashboard/qr-dialog'
import FriendTrendTable from '@/components/dashboard/friend-trend-table'
import {
  InboxStatusCard,
  MonthlyDeliveryCard,
  RecentResultsCard,
} from '@/components/dashboard/side-cards'

/**
 * ダッシュボード。
 *
 * 設計は Pen.dev の `V2 1-1 ダッシュボード`（node `EgKGw`）。
 * 上から Head（期間）→ 警告帯 → KPI4枚 → 出荷予定 → 2カラム → 友だち追加リンク。
 *
 * 数は `/api/dashboard/overview` から1回で取る。カードごとに叩くと
 * 「有効友だちは今朝の値、未対応は今の値」のように基準時刻がずれて、
 * 読んだ人が判断を誤る。
 */

const PERIODS = [
  { key: 'today', label: '今日' },
  { key: 'last7', label: '過去7日' },
  { key: 'last28', label: '過去28日' },
] as const

type PeriodKey = (typeof PERIODS)[number]['key']

/**
 * 次に送信枠が戻る日。LINEは毎月1日に戻す。
 *
 * JSTで数える。月末にUTCのまま出すと、日本ではまだ今月なのに
 * 翌々月の1日が出る。
 */
function nextResetLabel(): string {
  const now = new Date(Date.now() + 9 * 3600_000)
  const month = now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2
  return `${month}/1`
}

/**
 * 友だち追加リンク。
 *
 * `/auth/line` は UUID 付与・アカウント解決・PCではQRランディング表示までやる
 * 正規の流入口。公式の lin.ee 直リンクだと計測もUUID紐づけも失われるので、
 * 共有リンクは常にこれを配る。
 */
function FriendAddLinkCard() {
  const { selectedAccount } = useAccount()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [routeId, setRouteId] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.entryRoutes.list().then((res) => {
      // 止めた経路のリンクを配ると、踏んでも友だち追加にならない。
      if (!cancelled && res.success) setRoutes(res.data.filter((r) => r.isActive))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const baseLink = selectedAccount
    ? `${base}/auth/line?account=${encodeURIComponent(selectedAccount.channelId)}`
    : `${base}/auth/line`
  // 経路を選んだら、その経路の短縮リンクに差し替える。QRモーダルと同じ組み立て。
  const route = routes.find((r) => r.id === routeId)
  const link = route ? `${base}/r/${route.refCode}` : baseLink

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // クリップボードは安全なコンテキストでしか使えない。
      // 下の入力欄から手でコピーできるようにしてある。
    }
  }

  return (
    <section className="bg-canvas rounded-card border-hairline border p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-ink text-sm font-semibold">友だち追加リンク</h2>
          <p className="text-ink-faint mt-1 text-xs leading-relaxed">
            このURLから追加された友だちは、流入元を記録して計測できます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            「発行中」は札ではなく、どのリンクを出しているかの選択にした。
            経路を分けて発行しても、ここから選べないと下のURLは基本の
            ものから変わらず、分けた意味が画面に出てこない。
          */}
          <div className="border-hairline rounded-control flex items-center gap-1.5 border px-2 py-1">
            <span className="text-ink-faint shrink-0 text-[10px] font-medium">発行中</span>
            <label htmlFor="add-link-route" className="sr-only">
              発行中の追加URL
            </label>
            <select
              id="add-link-route"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              className="text-ink max-w-[180px] bg-transparent text-xs font-medium focus:outline-none"
            >
              <option value="">基本の追加URL</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <Link
            href="/inflow-links"
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-1.5 text-xs font-medium"
          >
            経路を分けて発行
          </Link>
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="友だち追加リンク"
          className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control flex-1 truncate border px-3 py-2 font-mono text-xs"
        />
        <button
          type="button"
          onClick={onCopy}
          className="text-on-accent rounded-control shrink-0 px-4 text-xs font-medium"
          style={{
            backgroundColor: copied ? 'var(--color-success)' : 'var(--color-accent)',
          }}
        >
          {copied ? 'コピーしました ✓' : 'コピー'}
        </button>
        <button
          type="button"
          onClick={() => setShowQr(true)}
          className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control shrink-0 border px-4 text-xs font-medium"
        >
          QRを表示
        </button>
      </div>

      {/* 設計 1-1-1。印刷に使う大きさを選べる形にした。
          ここで選んだ経路を持ち込む。開き直すたびに基本のURLへ戻ると、
          分けて発行した経路のQRを出すのに毎回選び直すことになる。 */}
      <QrDialog
        open={showQr}
        onClose={() => setShowQr(false)}
        accountName={selectedAccount?.displayName ?? '然-NEN- 公式'}
        accountBasicId={selectedAccount?.basicId ?? null}
        baseLink={baseLink}
        initialRouteId={routeId}
      />
    </section>
  )
}

export default function DashboardPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.dashboard.overview({
        period,
        accountId: selectedAccountId ?? undefined,
      })
      if (res.success) setData(res.data)
      else setError(res.error)
    } catch {
      setError('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [period, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const friends = data?.friends
  const quotaRemaining =
    data && data.delivery.quotaLimit !== null && data.delivery.quotaUsed !== null
      ? data.delivery.quotaLimit - data.delivery.quotaUsed
      : null

  return (
    <div>
      {/* Head — 見出しと期間 */}
      <div data-design="Head" className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-ink text-xl font-bold sm:text-2xl">ダッシュボード</h1>
          <p className="text-ink-faint mt-1 text-sm">
            {selectedAccount
              ? `${selectedAccount.displayName || selectedAccount.name} の対応と、直近の数字をまとめています。`
              : '今日の対応と、直近の数字をまとめています。'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="border-hairline rounded-control flex overflow-hidden border">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                aria-pressed={period === p.key}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p.key
                    ? 'bg-accent text-on-accent'
                    : 'text-ink-secondary hover:bg-canvas-sunken'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {loading ? '読み込み中...' : '再読み込み'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger rounded-card mb-5 border p-4 text-sm">
          {error}
        </div>
      )}

      {/*
        警告帯（設計 `Alert`）。設計は「ケアが必要な子が3頭います」の1行。

        以前はここに赤いグラデーションの大きな帯で未対応の問い合わせを
        出していた。赤い帯は「いま壊れている」の強さで、常時1〜2件ある
        問い合わせに使うと慣れてしまい、本当に見てほしいときに効かない。

        問い合わせは下の「対応が必要な受信」に移した。この帯は
        健康記録の連続検知（ケアが必要な子）に譲る。その仕組みが
        入るまでは何も出さない。docs/v025-open-questions.md §1-3。
      */}
      <div data-design="Alert" />

      {/* KPI 4枚 */}
      <div data-design="KPIs" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="有効友だち"
          value={friends?.active ?? null}
          unit="人"
          loading={loading}
          detail={friends ? `友だち総数 ${friends.total.toLocaleString('ja-JP')}人` : '読み込み中'}
          action={{ label: '一覧へ', href: '/friends' }}
        />
        <KpiCard
          title="ブロック / 非表示"
          value={friends ? friends.blockedByThem + friends.hiddenByUs + friends.blockedBoth : null}
          unit="人"
          loading={loading}
          detail={
            friends
              ? `相手から ${friends.blockedByThem} ・ 自分から ${friends.hiddenByUs} ・ 相互 ${friends.blockedBoth}`
              : '読み込み中'
          }
        />
        <KpiCard
          title="未対応"
          value={data?.inbox.unanswered ?? null}
          unit="人"
          loading={loading}
          detail={
            data ? `対応中 ${data.inbox.inProgress} ・ 対応済 ${data.inbox.resolved}` : '読み込み中'
          }
          action={{ label: '受信箱へ', href: '/chats' }}
        />
        <KpiCard
          title="今月の送信残枠"
          value={quotaRemaining}
          unit="通"
          loading={loading}
          // LINEの送信枠は毎月1日に戻る。上限だけ出すと「いつ戻るのか」が
          // 分からず、足りないときに増やすべきか待つべきか判断できない。
          detail={
            data && data.delivery.quotaLimit !== null
              ? `上限 ${data.delivery.quotaLimit.toLocaleString('ja-JP')} ・ リセット ${nextResetLabel()}`
              : 'LINE から取得できませんでした'
          }
          action={{ label: 'アップグレードする', href: '/accounts' }}
        />
      </div>

      {/* 出荷予定 — ec_events.payload から算出した予定日で並べる */}
      <div data-design="Shipment" className="mb-6">
        <ShipmentPanel />
      </div>

      {/* 2カラム — 左が広い（設計は 1095 : 460） */}
      <div data-design="Body" className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
        <PendingInboxCard />

        <section className="bg-canvas rounded-card border-hairline border">
          <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
            <h2 className="text-ink text-sm font-semibold">友だち数の推移</h2>
            <Link href="/analytics" className="text-accent text-xs hover:underline">
              さらに詳しく
            </Link>
          </div>
          <FriendTrendTable trend={data?.trend ?? []} loading={loading} />
        </section>
        </div>

        <div className="space-y-4">
          {data && <InboxStatusCard inbox={data.inbox} />}
          {data && <MonthlyDeliveryCard delivery={data.delivery} />}
          {data && <RecentResultsCard conversions={data.conversions} />}
        </div>
      </div>

      {/* Bottom — 友だち追加リンク */}
      <div data-design="Bottom">
        <FriendAddLinkCard />
      </div>

      {data && (
        <p className="text-ink-faint mt-4 text-xs">
          {new Date(data.generatedAt).toLocaleString('ja-JP')} 時点の数字です。
        </p>
      )}
    </div>
  )
}
