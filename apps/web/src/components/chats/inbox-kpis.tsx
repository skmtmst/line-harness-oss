'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, type InboxStats } from '@/lib/api'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'

function formatWait(minutes: number | null): string {
  if (!minutes || minutes < 1) return '待ちはありません'
  if (minutes < 60) return `最長 ${minutes}分待ち`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `最長 ${hours}時間${rest ? `${rest}分` : ''}待ち`
}

/** Pen.dev V4「対応状況バー」。数字は既存の集計APIだけを使う。 */
export default function InboxKpis() {
  const [stats, setStats] = useState<InboxStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await api.chatStats.get()
      if (res.success) setStats(res.data)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onRefresh = () => void load()
    window.addEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
  }, [load])

  const value = (number: number | undefined) => loading || number === undefined ? '—' : `${number.toLocaleString('ja-JP')}件`

  return (
    <section
      data-inbox-v4="summary"
      className="border-[#E5E7EB] bg-canvas shadow-[1px_1px_2px_rgba(29,29,31,0.13)] flex min-h-[74px] flex-wrap items-center gap-x-6 gap-y-3 rounded-[10px] border px-[18px] py-3 xl:flex-nowrap"
      aria-label="受信箱の対応状況"
    >
      <div className="flex min-w-[270px] items-center gap-3">
        <span className="bg-[#FFF1F2] text-[#E5484D] flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/></svg>
        </span>
        <div>
          <p className="text-[#1F2937] text-[17px] font-bold">要返信 {value(stats?.waiting)}</p>
          <p className="text-[#B45309] mt-0.5 text-[11px] font-semibold">{formatWait(stats?.oldestWaitingMinutes ?? null)}</p>
        </div>
      </div>

      <div className="bg-[#E5E7EB] hidden h-px w-[min(17vw,280px)] shrink-0 xl:block" />

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        {[
          ['自分が担当', value(stats?.mine)],
          ['今日の受信', value(stats?.todayInbound)],
          ['メール', value(stats?.todayByChannel?.email)],
          ['期限超過', value(stats?.waitingOverAnHour)],
        ].map(([label, count], index) => (
          <div key={label} className="min-w-0">
            <p className={`text-[11px] font-semibold ${index === 3 ? 'text-[#334155]' : 'text-[#667085]'}`}>{label}</p>
            <p className={`mt-0.5 text-[18px] font-bold tabular-nums ${index === 3 ? 'text-[#334155]' : 'text-[#1F2937]'}`}>{count}</p>
          </div>
        ))}
      </div>

      <Link href="/tags?tab=marks" className="border-[#E5E7EB] text-[#2563EB] inline-flex h-[38px] shrink-0 items-center gap-2 rounded-lg border bg-canvas px-3.5 text-[13px] font-semibold hover:bg-[#F7F8F6]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M9 4v6M15 14v6"/></svg>
        対応ルール
      </Link>
    </section>
  )
}
