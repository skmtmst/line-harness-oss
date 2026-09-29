'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type BroadcastActivityEntry } from '@/lib/api'
import ListState from '@/components/shared/list-state'

/**
 * 記録のタブ（C-3）。誰が何をしたか。
 *
 * 作成・編集・承認の依頼・承認・差し戻し・予約・送信・停止・再送を
 * 新しい順に並べる。記録は消せない。
 */
export default function BroadcastActivity({
  broadcastId,
  formatDateTime,
}: {
  broadcastId: string
  formatDateTime: (value: string | null | undefined) => string
}) {
  const [entries, setEntries] = useState<BroadcastActivityEntry[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await api.broadcasts.activity(broadcastId, { limit: 50 })
      if (!res.success || !res.data) {
        setState('error')
        return
      }
      setEntries(res.data)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [broadcastId])

  useEffect(() => {
    void load()
  }, [load])

  if (state === 'error') {
    return <ListState kind="error" title="記録を表示できませんでした" onRetry={() => void load()} />
  }
  if (state === 'loading' || entries === null) {
    return <ListState kind="loading" title="記録を読み込んでいます" />
  }
  if (entries.length === 0) {
    return <ListState kind="empty" emptyPreset="readonly" title="記録はまだありません" />
  }

  return (
    <section aria-label="記録" className="bg-canvas rounded-card border-hairline border p-5">
      <ol className="space-y-4">
        {entries.map((entry, index) => (
          <li key={`${entry.createdAt}-${entry.action}-${index}`} className="flex gap-3">
            <span aria-hidden="true" className="bg-hairline mt-1.5 h-2 w-2 shrink-0 rounded-pill" />
            <div className="min-w-0">
              <p className="text-ink text-sm font-medium">{entry.label}</p>
              <p className="text-ink-faint mt-0.5 text-xs">
                {formatDateTime(entry.createdAt)}
                {entry.actorName ? ` ・ ${entry.actorName}` : null}
                {entry.reason ? ` ・ 理由：${entry.reason}` : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-ink-faint mt-4 text-xs">記録は消せません。取り消しは逆向きの記録として残ります。</p>
    </section>
  )
}
