'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Card, { CardHeader } from '@/components/shared/card'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'

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

/**
 * 1ページに出す数。**固定にしない。**
 *
 * 5件に固定していたころ、総数5件でも2行しか出せず、**残りへ行く手段が
 * 無かった**（ページ送りも表示件数も無い）。設計（`vUXKb` / `NjK9q`）は
 * 表の右上に「表示件数」があり、下にページ送りがある。
 */
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20]
const DEFAULT_PAGE_SIZE = 5

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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const total = summary?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRow = Math.min(total, (page - 1) * pageSize + items.length)

  const load = useCallback(async () => {
    try {
      const inboxResponse = await fetchApi<{
        success: boolean
        data: { items: InboxItem[]; summary: PendingInboxSummary }
      }>(`/api/support/inbox?status=open&limit=${pageSize}&offset=${(page - 1) * pageSize}`)
      if (inboxResponse.success) {
        setSummary(inboxResponse.data.summary)
        onSummaryChange?.(inboxResponse.data.summary)
        setItems(inboxResponse.data.items)
      }
    } catch {
      // ダッシュボード本体は残し、次のポーリングで復旧する。
    }
  }, [onSummaryChange, page, pageSize])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return (
    <Card layout="vertical" overflow="hidden" className="h-fit min-w-0">
      <CardHeader
        size="roomy"
        title="対応が必要な受信"
        meta={summary && summary.total > 0 ? `${summary.total}件` : undefined}
        action={
          <span className="flex items-center gap-3">
            <span className="text-ink-secondary flex items-center gap-1.5 text-xs font-normal">
              表示件数
              <Select
                aria-label="表示件数"
                value={String(pageSize)}
                onChange={(next) => { setPageSize(Number(next)); setPage(1) }}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n}件表示` }))}
              />
            </span>
            <Link href="/chats" className="hover:underline">受信箱をすべて見る</Link>
          </span>
        }
        actionTone="info"
      />

      {!summary || summary.total === 0 ? (
        <p className="text-ink-faint flex min-h-24 items-center justify-center px-5 py-6 text-center text-sm">
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
                      <StatusBadge tone="success" size="compact">未確認</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > 0 ? (
            <nav
              className="border-hairline flex h-[50px] shrink-0 items-center justify-between gap-3 border-t px-5"
              aria-label="受信一覧のページ送り"
            >
              <span className="text-ink-secondary text-xs tabular-nums">
                {firstRow}〜{lastRow} / {total}件
              </span>
              <Pagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
                ariaLabel="受信一覧のページ送り"
              />
            </nav>
          ) : null}
        </div>
      )}
    </Card>
  )
}
