'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 旧URLはV6正本へ集約する。
 *
 * ここに別のタイトル・タブ・状態を持つと、同じ紹介者機能を二重に直すことに
 * なる。画面名は共通トップバー、本文は /conversions の共通タブだけが持つ。
 */
export default function AffiliatesPage() {
  const router = useRouter()

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    const target = tab === 'offers' || tab === 'approvals' || tab === 'payment'
      ? tab
      : 'affiliates'
    router.replace(`/conversions?tab=${target}`)
  }, [router])

  return <div className="p-8 text-center text-sm text-ink-faint">移動中...</div>
}
