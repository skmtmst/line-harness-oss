'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { readSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import Notice, { useNoticeClosedToday } from '@/components/shared/notice'
import Button from '@/components/shared/button'

/** 安全の知らせを［閉じる］で隠しても、ダッシュボードと設定の画面には残す。 */
const SECURITY_NOTICE_PINNED_PATHS = new Set(['/', '/settings', '/hq/settings', '/ops', '/ops/dashboard'])
export function isSecurityNoticePinned(pathname: string | null) {
  return pathname !== null && SECURITY_NOTICE_PINNED_PATHS.has(pathname)
}

/** Authenticated counts only. The shell places this inside the white content board. */
export default function RecoveryCodeNotice({ remaining, className }: { remaining?: number | null; className?: string }) {
  const pathname = usePathname()
  const [count, setCount] = useState<number | null>(null)
  const { closed, close } = useNoticeClosedToday('recovery-codes')
  const pinned = isSecurityNoticePinned(pathname)
  useEffect(() => {
    const update = () => setCount(remaining === undefined ? readSessionSnapshot()?.recoveryCodesRemaining ?? null : remaining)
    update(); window.addEventListener(SESSION_SNAPSHOT_CHANGED, update)
    return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, update)
  }, [pathname, remaining])
  if ((pathname === '/staff' || pathname === '/ops/two-factor') || count === null || count > 2 || (closed && !pinned)) return null
  const heading = count === 0 ? '回復コードが残っていません' : `回復コードが残り少なくなっています（残り ${count} 個）`
  return <Notice className={className} tone="info" heading={heading} message="認証アプリが使えない時に入れなくなる前に、作り直してください。" action={<Button href={pathname?.startsWith('/ops') ? '/ops/two-factor' : '/staff'} variant="secondary">作り直す</Button>} onClose={pinned ? undefined : close} />
}
