'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { readSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import Notice from '@/components/shared/notice'
import Button from '@/components/shared/button'

/** Authenticated counts only. The shell places this inside the white content board. */
export default function RecoveryCodeNotice({ remaining, className }: { remaining?: number | null; className?: string }) {
  const pathname = usePathname()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const update = () => setCount(remaining === undefined ? readSessionSnapshot()?.recoveryCodesRemaining ?? null : remaining)
    update(); window.addEventListener(SESSION_SNAPSHOT_CHANGED, update)
    return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, update)
  }, [pathname, remaining])
  if ((pathname === '/staff' || pathname === '/ops/two-factor') || count === null || count > 2) return null
  return <Notice className={className} tone="info" heading="回復コードが残っていません" message="認証アプリが使えない時に入れなくなる前に、作り直してください。" action={<Button href={pathname?.startsWith('/ops') ? '/ops/two-factor' : '/staff'} variant="secondary">作り直す</Button>} />
}
