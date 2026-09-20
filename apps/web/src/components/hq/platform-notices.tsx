'use client'

import { Megaphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type HqNotice } from '@/lib/api'
import { shortDateTime } from '@/lib/hq-banners'
import Button from '@/components/shared/button'

/**
 * 運営からのお知らせ（★V6 37-7「画面のお知らせ」）。統括の管理画面の上部に出し、「読みました」で消える。
 */
export default function PlatformNotices() {
  const [notices, setNotices] = useState<HqNotice[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.hqNotices.list()
      if (res.success) setNotices(res.data)
    } catch {
      // お知らせが読めなくても画面は出す
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const markRead = async (id: string) => {
    setBusyId(id)
    try {
      await api.hqNotices.markRead(id)
      setNotices((prev) => prev.filter((n) => n.id !== id))
    } catch {
      // 失敗しても次回の読み込みで再度出る
    } finally {
      setBusyId(null)
    }
  }

  if (notices.length === 0) return null
  return (
    <section data-design-node="EJ6sm" aria-label="運営からのお知らせ" className="mb-4 grid gap-2">
      {notices.map((n) => (
        <div key={n.id} className="flex flex-wrap items-start gap-3 rounded-card border border-accent-border bg-accent-soft px-4 py-3">
          <Megaphone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent-deep" />
          <div className="min-w-0 flex-1">
            <p className="text-label font-bold text-ink">
              {n.subject}
              <span className="ml-2 text-micro font-normal text-ink-faint">musubo 運営{n.sentAt ? `・${shortDateTime(n.sentAt)}` : ''}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-caption text-ink">{n.body}</p>
          </div>
          <Button size="field" onClick={() => void markRead(n.id)} disabled={busyId === n.id}>読みました</Button>
        </div>
      ))}
    </section>
  )
}
