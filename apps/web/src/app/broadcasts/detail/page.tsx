'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api, type ApiBroadcast } from '@/lib/api'
import Header from '@/components/layout/header'

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  scheduled: '予約済み',
  sending: '送信中',
  sent: '送信済み',
}

function BroadcastDetailInner() {
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [insight, setInsight] = useState<{
    delivered: number | null
    uniqueImpression: number | null
    uniqueClick: number | null
    suppressedByAudienceSize: boolean
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const [detail, stats] = await Promise.all([
          api.broadcasts.get(id),
          api.analytics.broadcasts(),
        ])
        if (detail.success) setBroadcast(detail.data)
        if (stats.success) {
          const found = stats.data.find((b) => b.broadcastId === id)
          if (found) setInsight(found)
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  if (!id) {
    return (
      <div>
        <Header title="配信の詳細" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          配信が指定されていません。
          <Link href="/broadcasts" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <Header title={broadcast?.title ?? '配信の詳細'} />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/broadcasts" className="hover:underline">
          一斉配信
        </Link>
        <span className="mx-1.5">›</span>
        <span>{broadcast?.title ?? '詳細'}</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !broadcast ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          この配信は見つかりませんでした。
        </p>
      ) : (
        <div className="max-w-3xl space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">届いた数</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {insight?.delivered?.toLocaleString('ja-JP') ?? '—'}
              </p>
            </div>
            <div className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">開封</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {insight?.uniqueImpression?.toLocaleString('ja-JP') ?? '—'}
              </p>
              {insight?.suppressedByAudienceSize && (
                <p className="text-ink-faint mt-1 text-[11px]">配信先が20人未満のため取れません</p>
              )}
            </div>
            <div className="bg-canvas rounded-card border-hairline border p-4">
              <p className="text-ink-faint text-xs">クリック</p>
              <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
                {insight?.uniqueClick?.toLocaleString('ja-JP') ?? '—'}
              </p>
            </div>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-faint">状態</dt>
                <dd className="text-ink-secondary">
                  {STATUS_LABELS[broadcast.status] ?? broadcast.status}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-faint">配信先</dt>
                <dd className="text-ink-secondary">
                  {broadcast.targetType === 'all' ? 'すべての友だち' : '絞り込み'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-faint">送信日時</dt>
                <dd className="text-ink-secondary">
                  {broadcast.sentAt ? new Date(broadcast.sentAt).toLocaleString('ja-JP') : '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink-secondary mb-2 text-sm font-medium">本文</p>
            <pre className="bg-canvas-sunken text-ink-secondary overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap">
              {broadcast.messageContent}
            </pre>
          </div>

          <Link
            href="/broadcasts"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken inline-block border px-4 py-2 text-sm font-medium"
          >
            一覧へ戻る
          </Link>
        </div>
      )}
    </div>
  )
}

export default function BroadcastDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BroadcastDetailInner />
    </Suspense>
  )
}
