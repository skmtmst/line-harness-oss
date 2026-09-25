'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, type EcShipmentList } from '@/lib/api'
import Card, { CardHeader } from '@/components/shared/card'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { dashboardLocalUpdatedAt } from '@/components/dashboard/freshness'

/**
 * 出荷予定。
 *
 * ec_events.payload には商品・数量・定期便の発送予定日が入っているのに、
 * これまでどの画面にも出していなかった。出荷予定日そのものは payload に
 * 無いため、Worker 側で業務ルールから算出したものを受け取って並べる。
 * 計算は @line-crm/shared に閉じてあり、この画面は表示だけを持つ。
 */

type Bucket = 'soon' | 'later'

function formatShipDate(isoDate: string, today: string, tomorrow: string): { label: string; tone: 'today' | 'tomorrow' | 'later' } {
  if (isoDate === today) return { label: '今日', tone: 'today' }
  if (isoDate === tomorrow) return { label: '明日', tone: 'tomorrow' }
  const [, month, day] = isoDate.split('-')
  return { label: `${Number(month)}/${Number(day)}`, tone: 'later' }
}

const statusTone: Record<'today' | 'tomorrow' | 'later', StatusBadgeTone> = {
  today: 'warning',
  tomorrow: 'info',
  later: 'neutral',
}

export type ShipmentSummary = {
  today: number
  soon: number
  later: number
  /* 走査が上限に達したとき true。「今日 N件」が取りこぼしを含み得る目印。 */
  scanLimited: boolean
  scanLimit: number
}

export default function ShipmentPanel({
  accountId,
  onSummaryChange,
}: {
  /** 選択中アカウント。指定時はそのアカウントの出荷だけを数える。 */
  accountId?: string | null
  /* 失敗・0件・読込中を区別するため、状態も一緒に知らせる（IDEA-01）。 */
  onSummaryChange?: (summary: ShipmentSummary | null, state?: 'loading' | 'ready' | 'error') => void
}) {
  const [data, setData] = useState<EcShipmentList | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [bucket, setBucket] = useState<Bucket>('soon')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    /*
     * アカウント切替で前のアカウントの件数・行を残さない（IDEA-01）。
     * 上部の小カード「出荷予定」も同じ口から数えるため、先に null へ戻す。
     */
    setData(null)
    setFetchedAt(null)
    setLoading(true)
    setError(null)
    onSummaryChange?.(null, 'loading')
    /*
     * null は「アカウント未選択」。その場合は取りに行かず待機する。
     * 全アカウントの数を黙って出すと、選択中アカウントの数と取り違える。
     */
    if (accountId === null) {
      return () => { cancelled = true }
    }
    api.ecCommerce
      .shipments({ limit: 10, accountId: accountId || undefined })
      .then((r) => {
        if (cancelled) return
        if (!r.success) throw new Error(r.error)
        setData(r.data)
        setFetchedAt(new Date())
        onSummaryChange?.({
          /*
           * 「今日の出荷」は表示する10件ではなく、走査した全イベントからの
           * 集計値を使う（DASH-22）。段階配備中の旧Workerは todayCount を
           * 返さないため、その場合だけ表示中の行から数える。
           */
          today: r.data.todayCount ?? r.data.soon.filter((row) => row.shipDate === r.data.today).length,
          soon: r.data.soonCount,
          later: r.data.laterCount,
          scanLimited: r.data.scanned >= r.data.scanLimit,
          scanLimit: r.data.scanLimit,
        }, 'ready')
      })
      .catch(() => {
        if (cancelled) return
        /* 生の例外文(通信機器の応答など)を出さない。決まった文と読み直しを出す。 */
        setError('通信状況を確認して、もう一度お試しください')
        onSummaryChange?.(null, 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accountId, onSummaryChange, attempt])

  const rows = data ? (bucket === 'soon' ? data.soon : data.later) : []

  return (
    <Card overflow="hidden" className="min-h-44">
      <CardHeader
        size="roomy"
        title="出荷予定"
        /* 今日・明日以降の予定を、最後に取れた時刻と一緒に示す（IDEA-01）。 */
        meta={dashboardLocalUpdatedAt(fetchedAt) ?? undefined}
        action={<Link href="/ec-commerce" className="hover:underline">すべて見る →</Link>}
        actionTone="info"
      />
      <div className="px-[18px] pb-[18px]">
        {loading ? (
          <p className="py-6 text-center text-sm text-ink-faint">{STATE_TEXT.loading}…</p>
        ) : error ? (
          // ★V7：カード内の失敗は小さく1行だけ。赤を使わない。
          <p className="text-ink-secondary py-4 text-center text-xs" role="alert">
            出荷予定を読み込めませんでした。
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className="text-action ml-2 font-semibold hover:underline">もう一度</button>
          </p>
        ) : !data || (data.soonCount === 0 && data.laterCount === 0) ? (
          /* 0件の詳細枠は1行へ縮める（A01-05）。大きな空きは「取得中」と紛らわしい。 */
          <p className="py-4 text-center text-sm text-ink-faint">
            出荷予定はまだありません。EC通知を受け取るとここに並びます。
          </p>
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              {(
                [
                  // 設計は「今日 / 明日 / 今週 / 遅延」。いまの API は
                  // soon（今日・明日）と later しか返さないので、その2つに寄せる。
                  // 遅延を出すには出荷済みかどうかの判定が要る。
                  // docs/v025-open-questions.md に残している。
                  { key: 'soon' as const, label: '今日・明日', count: data.soonCount },
                  { key: 'later' as const, label: 'あさって以降', count: data.laterCount },
                ]
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setBucket(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    bucket === key ? 'bg-action text-on-action' : 'bg-canvas-sunken text-ink-secondary'
                  }`}
                >
                  {label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                      bucket === key ? 'bg-white/25' : 'bg-canvas text-ink-faint'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-faint">この期間の出荷予定はありません</p>
            ) : (
            /*
              設計 `出荷予定` は表。注文番号・お客様・商品・数量・出荷予定・状態の6列。
              以前は1行に詰め込んだ一覧で、同じ列を縦に読み比べられなかった。
              「今日のぶんが何件で、どれが遅れているか」を見る画面なので、
              列で揃っている方が速い。
            */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-ink-faint border-hairline border-b text-left text-xs">
                    <th className="py-2 pr-3 font-medium">注文番号</th>
                    <th className="py-2 pr-3 font-medium">お客様</th>
                    <th className="py-2 pr-3 font-medium">商品</th>
                    <th className="py-2 pr-3 text-right font-medium">数量</th>
                    <th className="py-2 pr-3 font-medium whitespace-nowrap">出荷予定</th>
                    <th className="py-2 font-medium">状態</th>
                  </tr>
                </thead>
                <tbody className="divide-hairline divide-y">
                  {rows.map((row) => {
                    const { label, tone } = formatShipDate(row.shipDate, data.today, data.tomorrow)
                    return (
                      <tr key={row.id}>
                        <td className="text-ink-faint py-2.5 pr-3 font-mono text-xs whitespace-nowrap">
                          {row.orderNumber || '—'}
                        </td>
                        <td className="text-ink py-2.5 pr-3 whitespace-nowrap">
                          {row.friendId ? (
                            <Link href={`/chats?friend=${row.friendId}`} className="hover:underline">
                              {row.friendName ?? '名前未設定'}
                            </Link>
                          ) : (
                            (row.friendName ?? '名前未設定')
                          )}
                        </td>
                        <td className="text-ink-secondary max-w-0 truncate py-2.5 pr-3">
                          {row.items || '商品情報なし'}
                        </td>
                        {/*
                          数量は ec_events.payload に入っているが、
                          出荷予定の API が返していない。列だけ出して
                          入ったら繋ぐ。docs/v025-open-questions.md に残す。
                        */}
                        <td className="text-ink-faint py-2.5 pr-3 text-right tabular-nums">
                          {row.quantity > 0 ? row.quantity.toLocaleString('ja-JP') : '—'}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <StatusBadge tone={statusTone[tone]} size="compact">{label}</StatusBadge>
                        </td>
                        <td className="text-ink-secondary py-2.5 text-xs whitespace-nowrap">
                          {row.shipDateSource === 'subscription' ? '定期便' : '注文'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            )}

            {/* 走査上限に張り付いているときだけ、取りこぼしがありうる旨を出す。 */}
            {data.scanned >= data.scanLimit && (
              <p className="text-ink-faint mt-3 text-[11px]">
                直近{data.scanLimit}件のイベントから算出しています。それより前の予定は含まれません。
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
