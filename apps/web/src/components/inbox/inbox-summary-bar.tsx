'use client'

import { formatDurationMinutes } from '@/lib/format-duration'

const fmt = new Intl.NumberFormat('ja-JP')

function formatOldest(min: number | null): string {
  if (min == null) return '—'
  return formatDurationMinutes(min)
}

interface Props {
  total: number
  byAccount: Array<{ accountId: string; accountName: string; count: number }>
  oldestWaitMinutes: number | null
}

export default function InboxSummaryBar({ total, byAccount, oldestWaitMinutes }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card label="未対応" value={fmt.format(total)} hint="人間の返事待ち" />
      <Card label="最古の待ち時間" value={formatOldest(oldestWaitMinutes)} hint="最も古い incoming" />
      <div className="rounded-lg bg-canvas p-4 shadow-sm ring-1 ring-hairline">
        <div className="text-xs font-medium text-ink-faint">アカウント別</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {byAccount.length === 0 ? (
            <span className="text-xs text-ink-faint">—</span>
          ) : (
            byAccount.map((a) => (
              <span
                key={a.accountId}
                className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-success"
              >
                {a.accountName} {a.count}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-canvas p-4 shadow-sm ring-1 ring-hairline">
      <div className="text-xs font-medium text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-faint">{hint}</div> : null}
    </div>
  )
}
