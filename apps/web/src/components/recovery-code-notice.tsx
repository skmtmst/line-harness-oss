'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { readSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import Notice from '@/components/shared/notice'

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
  return <Notice className={className} tone="info" message={`回復コードの残りが${count}個です。認証アプリが使えない場合に備え、作り直してください。`} action={<Link href={pathname?.startsWith('/ops') ? '/ops/two-factor' : '/staff'}>作り直す →</Link>} />
}
