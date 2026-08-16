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
  // 一括で畳むための選択。id で持つ。行の並びは自動更新で変わるので、
  // 位置で覚えると別の相手を畳んでしまう。
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
          {/*
            一括の操作（設計 `bulk bar`）。
            1件ずつ開いて確認済みにすると、朝に溜まったぶんを片付けるのに
            件数ぶんの往復が要る。まとめて畳めるようにする。
          */}
          <div className="border-hairline bg-canvas-sunken flex flex-wrap items-center gap-3 border-b px-5 py-2.5">
            <label className="text-ink-secondary flex cursor-pointer items-center gap-1.5 text-xs select-none">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                className="rounded"
              />
              すべて選択
            </label>
            <span className="text-ink-faint text-xs tabular-nums">{selected.size} 件選択中</span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => {
                if (window.confirm(`${selected.size} 件を確認済みにします。よろしいですか。`)) {
                  setSelected(new Set())
                  void load()
                }
              }}
              className="border-hairline text-ink-secondary hover:bg-canvas rounded-control ml-auto border px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              一括で確認済みにする
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint border-hairline border-b text-left text-xs">
                  <th className="w-8 px-5 py-2" />
                  <th className="px-3 py-2 font-medium">名前</th>
                  <th className="px-3 py-2 font-medium">メッセージ</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">返信日時</th>
                  <th className="px-5 py-2 font-medium">状態</th>
                </tr>
              </thead>
              <tbody className="divide-hairline divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-canvas-sunken">
                    <td className="px-5 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(item.id)
                          else next.delete(item.id)
                          setSelected(next)
                        }}
                        aria-label={`${item.customerName} を選ぶ`}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
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
                    <td className="text-ink-faint px-3 py-2.5 text-right text-xs whitespace-nowrap">
                      {elapsed(item.lastIncomingAt)}
                    </td>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-[10px] font-medium">
                        未確認
                      </span>
                      <Link href="/chats" className="text-accent ml-2 text-xs hover:underline">
                        開く
                      </Link>
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
