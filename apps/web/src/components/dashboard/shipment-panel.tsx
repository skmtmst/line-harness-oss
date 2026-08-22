'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, type EcShipment, type EcShipmentList } from '@/lib/api'

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

const toneClass: Record<'today' | 'tomorrow' | 'later', string> = {
  today: 'bg-amber-100 text-amber-800',
  tomorrow: 'bg-blue-100 text-blue-800',
  later: 'bg-gray-100 text-gray-600',
}

function ShipmentRow({ row, today, tomorrow }: { row: EcShipment; today: string; tomorrow: string }) {
  const { label, tone } = formatShipDate(row.shipDate, today, tomorrow)
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${toneClass[tone]}`}>{label}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {row.orderNumber && (
            <span className="shrink-0 font-mono text-[11px] text-gray-400">{row.orderNumber}</span>
          )}
          <span className="truncate text-sm font-medium text-gray-900">
            {row.friendId ? (
              <Link href={`/chats?friend=${row.friendId}`} className="hover:underline">
                {row.friendName ?? '名前未設定'}
              </Link>
            ) : (
              (row.friendName ?? '名前未設定')
            )}
          </span>
        </div>
        <p className="truncate text-xs text-gray-500">
          {row.items || '商品情報なし'}
          {row.shipDateSource === 'subscription' && (
            <span className="ml-2 text-[11px] text-gray-400">定期便</span>
          )}
        </p>
      </div>
    </li>
  )
}

export type ShipmentSummary = {
  today: number
  soon: number
  later: number
}

export default function ShipmentPanel({
  onSummaryChange,
}: {
  onSummaryChange?: (summary: ShipmentSummary | null) => void
}) {
  const [data, setData] = useState<EcShipmentList | null>(null)
  const [bucket, setBucket] = useState<Bucket>('soon')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.ecCommerce
      .shipments({ limit: 10 })
      .then((r) => {
        if (cancelled) return
        if (!r.success) throw new Error(r.error)
        setData(r.data)
        onSummaryChange?.({
          today: r.data.soon.filter((row) => row.shipDate === r.data.today).length,
          soon: r.data.soonCount,
          later: r.data.laterCount,
        })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        onSummaryChange?.(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onSummaryChange])

  const rows = data ? (bucket === 'soon' ? data.soon : data.later) : []

  return (
    <div className="bg-canvas min-h-44 rounded-[18px] border-hairline border p-[18px] shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">出荷予定</h2>
        <Link href="/ec-commerce" className="text-action text-xs font-medium hover:underline">
          すべて見る →
        </Link>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-gray-500">読み込み中…</p>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
          出荷予定を読み込めませんでした。{error}
        </div>
      ) : !data || (data.soonCount === 0 && data.laterCount === 0) ? (
        <p className="py-6 text-center text-sm text-gray-500">
          出荷予定はまだありません。
          <br />
          <span className="text-xs text-gray-400">ECから注文や定期便の通知を受け取ると、ここに並びます。</span>
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
                  bucket === key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={bucket === key ? { backgroundColor: 'var(--color-accent)' } : undefined}
              >
                {label}
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                    bucket === key ? 'bg-white/25' : 'bg-white text-gray-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">この期間の出荷予定はありません</p>
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
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${toneClass[tone]}`}>
                            {label}
                          </span>
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
            <p className="mt-3 text-[11px] text-gray-400">
              直近{data.scanLimit}件のイベントから算出しています。それより前の予定は含まれません。
            </p>
          )}
        </>
      )}
    </div>
  )
}
