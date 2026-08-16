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

type Summary = {
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

function elapsed(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}時間前` : `${Math.floor(hours / 24)}日前`
}

export default function PendingInboxCard() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])

  const load = useCallback(async () => {
    try {
      const [summaryResponse, inboxResponse] = await Promise.all([
        fetchApi<{ success: boolean; data: Summary }>('/api/support/summary'),
        fetchApi<{ success: boolean; data: { items: InboxItem[] } }>(
          '/api/support/inbox?status=open&limit=5',
        ),
      ])
      if (summaryResponse.success) setSummary(summaryResponse.data)
      if (inboxResponse.success) setItems(inboxResponse.data.items)
    } catch {
      // ダッシュボード本体は残し、次のポーリングで復旧する。
    }
  }, [])

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
    <section className="bg-canvas rounded-card border-hairline border">
      <div className="border-hairline flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-ink text-sm font-semibold">対応が必要な受信</h2>
          {summary && summary.total > 0 && (
            <span className="text-ink-faint text-xs tabular-nums">{summary.total} 件</span>
          )}
        </div>
        <Link href="/chats" className="text-accent text-xs hover:underline">
          受信箱をすべて見る
        </Link>
      </div>

      {!summary || summary.total === 0 ? (
        <p className="text-ink-faint px-5 py-8 text-center text-sm">
          返信を待っている問い合わせはありません。
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint border-hairline border-b text-left text-xs">
                  <th className="px-5 py-2 font-medium">名前</th>
                  <th className="px-3 py-2 font-medium">メッセージ</th>
                  <th className="px-5 py-2 text-right font-medium whitespace-nowrap">受信</th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-canvas-sunken">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <span
                        className={`mr-2 rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                          item.channel === 'email'
                            ? 'bg-canvas-sunken text-ink-secondary'
                            : 'bg-accent-soft text-accent'
                        }`}
                      >
                        {item.channel === 'email' ? 'メール' : 'LINE'}
                      </span>
                      <span className="text-ink font-medium">{item.customerName}</span>
                    </td>
                    <td className="text-ink-secondary max-w-0 truncate px-3 py-2.5">
                      {item.preview}
                    </td>
                    <td className="text-ink-faint px-5 py-2.5 text-right text-xs whitespace-nowrap">
                      {elapsed(item.lastIncomingAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-hairline text-ink-faint flex items-center justify-between border-t px-5 py-3 text-xs">
            <span>
              LINE {summary.line} ・ メール {summary.email}
              {summary.oldestWaitMinutes !== null && ` ・ 最長待ち ${summary.oldestWaitMinutes}分`}
            </span>
            <Link href="/chats" className="text-accent hover:underline">
              対応する →
            </Link>
          </div>
        </>
      )}
    </section>
  )
}
