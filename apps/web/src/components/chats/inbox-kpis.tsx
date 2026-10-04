'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type InboxStats } from '@/lib/api'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { formatDurationMinutes } from '@/lib/format-duration'
import { formatNumber } from '@/lib/format'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import Button from '@/components/shared/button'

function formatWait(minutes: number | null): string {
  if (!minutes || minutes < 1) return '待ちはありません'
  return `最長 ${formatDurationMinutes(minutes)}待ち`
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

  /*
   * 読み込み中は数の場所に骨組みを出す（#673）。
   * 「—」は「取れなかった」にも読めるので、待っている間は形だけ残す。
   */
  const value = (number: number | undefined) => (
    <DelayedSkeleton
      loading={loading}
      skeleton={<Skeleton className="h-5 w-12 align-middle" />}
    >
      {number === undefined ? '—' : `${formatNumber(number)}件`}
    </DelayedSkeleton>
  )

  return (
    <section
      data-inbox-v4="summary"
      className="border-hairline bg-canvas shadow-card flex min-h-[74px] flex-wrap items-center gap-x-6 gap-y-3 rounded-card border px-[18px] py-3 xl:flex-nowrap"
      aria-label="受信箱の対応状況"
      aria-busy={loading || undefined}
    >
      <div className="flex min-w-[270px] items-center gap-3">
        <span className="bg-status-danger-soft text-status-danger flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-pill" aria-hidden="true">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 17h.01"/></svg>
        </span>
        <div>
          <p className="text-ink text-[17px] font-bold">要返信 {value(stats?.waiting)}</p>
          <p className="text-status-warn-deep mt-0.5 text-micro font-semibold">
            <DelayedSkeleton
              loading={loading}
              skeleton={<Skeleton className="h-3.5 w-24 align-middle" />}
            >
              {formatWait(stats?.oldestWaitingMinutes ?? null)}
            </DelayedSkeleton>
          </p>
        </div>
      </div>

      <div className="bg-hairline hidden h-px w-[min(17vw,280px)] shrink-0 xl:block" />

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        {([
          ['自分が担当', value(stats?.mine)],
          ['今日の受信', value(stats?.todayInbound)],
          ['メール', value(stats?.todayByChannel?.email)],
          // INBOX-10: 数えるのは対応期限ではなく、未対応のまま1時間以上。
          ['1時間以上待ち', value(stats?.waitingOverAnHour)],
        ] as [string, ReactNode][]).map(([label, count], index) => (
          <div key={label} className="min-w-0">
            <p className={`whitespace-nowrap text-micro font-semibold ${index === 3 ? 'text-ink-secondary' : 'text-ink-faint'}`}>{label}</p>
            <p className={`mt-0.5 text-heading font-bold tabular-nums ${index === 3 ? 'text-ink-secondary' : 'text-ink'}`}>{count}</p>
          </div>
        ))}
      </div>

      <Button variant="secondary" className="text-action h-[38px] shrink-0 items-center gap-2 px-3.5 text-label whitespace-normal" href="/tags?tab=marks">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M9 4v6M15 14v6"/></svg>
        対応ルール
      </Button>
    </section>
  )
}
