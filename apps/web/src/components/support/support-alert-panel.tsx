'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

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

export default function SupportAlertPanel() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [items, setItems] = useState<InboxItem[]>([])

  const load = useCallback(async () => {
    try {
      const [summaryResponse, inboxResponse] = await Promise.all([
        fetchApi<{ success: boolean; data: Summary }>('/api/support/summary'),
        fetchApi<{ success: boolean; data: { items: InboxItem[] } }>('/api/support/inbox?status=open&limit=5'),
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
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  if (!summary || summary.total === 0) return null

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 bg-gradient-to-r from-rose-600 to-orange-500 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
            <span className="absolute h-3 w-3 animate-ping rounded-full bg-white/70" />
            <span className="relative h-3 w-3 rounded-full bg-white" />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-rose-100">即時対応が必要です</p>
            <p className="text-lg font-bold">未対応のお問い合わせが {summary.total} 件あります</p>
          </div>
        </div>
        <Link href="/support" className="rounded-xl bg-white px-4 py-2 text-center text-sm font-bold text-rose-600 shadow-sm hover:bg-rose-50">
          すぐに対応する →
        </Link>
      </div>
      <div className="grid gap-0 lg:grid-cols-[210px_1fr]">
        <div className="grid grid-cols-3 border-b border-rose-100 bg-rose-50/60 p-4 lg:grid-cols-1 lg:border-b-0 lg:border-r">
          <Metric label="LINE" value={summary.line} />
          <Metric label="メール" value={summary.email} />
          <Metric label="最長待ち" value={summary.oldestWaitMinutes == null ? '—' : `${summary.oldestWaitMinutes}分`} />
        </div>
        <div className="divide-y divide-gray-100">
          {items.map((item) => (
            <Link key={item.id} href="/support" className="flex items-center gap-3 px-5 py-3 hover:bg-rose-50/40">
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.channel === 'line' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                {item.channel === 'line' ? 'LINE' : 'EMAIL'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{item.customerName}</p>
                <p className="truncate text-xs text-gray-500">{item.preview}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-rose-600">{elapsed(item.lastIncomingAt)}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="py-1 text-center lg:text-left">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-gray-900">{value}</p>
    </div>
  )
}
