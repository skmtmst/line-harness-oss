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

export default function ShipmentPanel() {
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
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = data ? (bucket === 'soon' ? data.soon : data.later) : []

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">出荷予定</h2>
        <Link href="/ec-commerce" className="text-xs font-medium text-green-700 hover:underline">
          すべて見る
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
                style={bucket === key ? { backgroundColor: '#06C755' } : undefined}
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
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <ShipmentRow key={row.id} row={row} today={data.today} tomorrow={data.tomorrow} />
              ))}
            </ul>
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
