'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** 旧一覧を直接参照する既存コードにも、統括への転送を維持する。 */
export default function StoreList() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/hq')
  }, [router])

  return <p className="text-sm text-ink-faint">統括へ移動しています…</p>
}
