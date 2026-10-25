'use client'

import { Megaphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type HqNotice } from '@/lib/api'
import { shortDateTime } from '@/lib/hq-banners'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'

/**
 * 運営からのお知らせ（★管理画面 37-7「画面のお知らせ」）。統括の管理画面の上部に出し、「読みました」で消える。
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
        <Notice key={n.id} tone="info" icon={<Megaphone aria-hidden="true" />} heading={<>
              {n.subject}
              <span className="ml-2 text-micro font-medium text-ink-faint">musubo 運営{n.sentAt ? `・${shortDateTime(n.sentAt)}` : ''}</span>
            </>} action={<Button size="field" onClick={() => void markRead(n.id)} disabled={busyId === n.id}>読みました</Button>}>
            <p className="mt-1 whitespace-pre-wrap text-caption text-ink">{n.body}</p>
        </Notice>
      ))}
    </section>
  )
}
