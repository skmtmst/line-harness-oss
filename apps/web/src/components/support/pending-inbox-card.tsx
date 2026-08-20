'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

/**
 * 対応が必要な受信（設計 `V2 1-1 ダッシュボード` の `card 対応が必要な受信`）。
 *
 * 以前は画面上部に赤いグラデーションの帯として出していた（SupportAlertPanel）。
 * 設計では左カラムのカードで、名前・メッセージ・返信日時の表になっている。
 * 上部の帯は「ケアが必要な子」に譲る。
 *
 * 帯からカードに変えたのは見た目の都合ではない。赤い帯は「いま何かが
 * 壊れている」という強さで、常時1件2件ある問い合わせに使うと慣れてしまう。
 * 一覧として置けば、件数と中身を同じ重さで読める。
 */

export type PendingInboxSummary = {
  total: number
  line: number
  email: number
  emailUnread: number
  oldestWaitMinutes: number | null
}

type InboxItem = {
  id: string
  channel: 'line' | 'email'
  customerName: string
  preview: string
  lastIncomingAt: string
}

export function inboxItemHref(item: Pick<InboxItem, 'channel' | 'id'>): string {
  const rawId = item.id.replace(/^(line|email):/, '')
  return item.channel === 'email'
    ? `/chats?channel=email&thread=${encodeURIComponent(rawId)}`
    : `/chats?friend=${encodeURIComponent(rawId)}&unanswered=1`
}

const PAGE_SIZE = 5

function elapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`
}

export default function PendingInboxCard({
  onSummaryChange,
}: {
  onSummaryChange?: (summary: PendingInboxSummary | null) => void
}) {
  const [summary, setSummary] = useState<PendingInboxSummary | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil((summary?.total ?? 0) / PAGE_SIZE))

  const load = useCallback(async () => {
    try {
      const [summaryResponse, inboxResponse] = await Promise.all([
        fetchApi<{ success: boolean; data: PendingInboxSummary }>('/api/support/summary'),
        fetchApi<{ success: boolean; data: { items: InboxItem[] } }>(
          `/api/support/inbox?status=open&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
        ),
      ])
      if (summaryResponse.success) {
        setSummary(summaryResponse.data)
        onSummaryChange?.(summaryResponse.data)
      }
      if (inboxResponse.success) setItems(inboxResponse.data.items)
    } catch {
      // ダッシュボード本体は残し、次のポーリングで復旧する。
    }
  }, [onSummaryChange, page])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 5_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return (
    <section className="bg-canvas rounded-[18px] border-hairline flex h-[440px] min-w-0 flex-col overflow-hidden border shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <div className="border-hairline flex h-[50px] shrink-0 items-center justify-between border-b px-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-ink text-sm font-semibold">対応が必要な受信</h2>
          {summary && summary.total > 0 && (
            <span className="text-success text-xs font-medium tabular-nums">{summary.total}件</span>
          )}
        </div>
        <Link href="/chats" className="text-action text-xs hover:underline">
          受信箱をすべて見る
        </Link>
      </div>

      {!summary || summary.total === 0 ? (
        <p className="text-ink-faint flex flex-1 items-center justify-center px-5 text-center text-sm">
          返信を待っている問い合わせはありません。
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-ink-faint border-hairline h-[34px] border-b text-left text-xs">
                  <th className="w-[36%] px-5 font-medium">お名前</th>
                  <th className="w-[40%] px-3 font-medium">内容</th>
                  <th className="w-[14%] px-3 text-right font-medium whitespace-nowrap">待ち時間</th>
                  <th className="w-[10%] px-5 font-medium">状態</th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="h-[61px] hover:bg-canvas-sunken">
                    <td className="overflow-hidden px-5 py-2.5 whitespace-nowrap">
                      <span
                        className={`mr-2 rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                          item.channel === 'email'
                            ? 'bg-canvas-sunken text-ink-secondary'
                            : 'bg-accent-soft text-accent'
                        }`}
                      >
                        {item.channel === 'email' ? 'メール' : 'LINE'}
                      </span>
                      <Link
                        href={inboxItemHref(item)}
                        className="text-ink font-medium hover:text-action hover:underline focus-visible:text-action focus-visible:underline"
                        title={`${item.customerName}の受信箱を開く`}
                      >
                        {item.customerName}
                      </Link>
                    </td>
                    <td className="text-ink-secondary truncate px-3 py-2.5" title={item.preview}>
                      {item.preview}
                    </td>
                    <td className="text-ink-faint px-3 py-2.5 text-right text-xs whitespace-nowrap">
                      {elapsed(item.lastIncomingAt)}
                    </td>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-[10px] font-medium">
                        未確認
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <nav
              className="border-hairline flex h-[50px] shrink-0 items-center justify-end gap-2 border-t px-5"
              aria-label="受信一覧のページ送り"
            >
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="border-hairline text-ink hover:bg-canvas-sunken rounded-control min-h-8 border px-3 text-xs disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="前のページ"
              >
                前へ
              </button>
              <span className="text-ink-secondary min-w-16 text-center text-xs tabular-nums">
                {page} / {pageCount}ページ
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                disabled={page === pageCount}
                className="border-hairline text-ink hover:bg-canvas-sunken rounded-control min-h-8 border px-3 text-xs disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="次のページ"
              >
                次へ
              </button>
            </nav>
          ) : null}
        </div>
      )}
    </section>
  )
}
