'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ListState from '@/components/shared/list-state'
import MobileScreen from '@/components/mobile/mobile-screen'
import { useMobileShell } from '@/components/mobile/mobile-shell'

/** /m を開いたら、見られる最初のタブへ（書き出しなのでサーバーの転送は使わない）。 */
export default function MobileHomePage() {
  return (
    <MobileScreen title="musubo">
      <MobileHomeRedirect />
    </MobileScreen>
  )
}

function MobileHomeRedirect() {
  const router = useRouter()
  const { tabs, ready } = useMobileShell()
  const first = tabs[0]?.href ?? null
  useEffect(() => { if (first) router.replace(first) }, [first, router])
  if (ready && !first) return <ListState kind="forbidden" />
  return <ListState kind="loading" title="読み込んでいます" />
}
