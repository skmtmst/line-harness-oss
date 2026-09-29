'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { manualScreenKeyForPath } from '@/lib/manual-screen-key'

/**
 * 画面のマニュアルURLを正本表（/settings/manual-links）から引く。
 *
 * 未登録・開けない・画面IDが無いときは null を返す。受け側はリンク自体を
 * 出さないこと（「押したら無い」を作らない、トップバーと同じ決まり）。
 * 監査 R128: 画面内の「マニュアル」ボタンもこの正本表を引き、
 * /support（メールの受信箱）へ固定で飛ばさない。
 */
export function useManualHref(pathname?: string): string | null {
  const current = usePathname()
  const path = pathname ?? current
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    const screen = manualScreenKeyForPath(path)
    if (!screen) {
      setHref(null)
      return
    }
    let live = true
    api.manualLinks.lookup(screen)
      .then((res) => { if (live) setHref(res.success ? res.data.url : null) })
      .catch(() => { if (live) setHref(null) })
    return () => { live = false }
  }, [path])
  return href
}
