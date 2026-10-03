'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 対応表の `/scenarios/new`。作る①の正本は `/scenarios/mode`（specs/pages/03）。
 * ブックマーク互換のため、このページは即リダイレクトする薄いページとして置く。
 * output: 'export'（静的エクスポート）構成では next/navigation の redirect() が
 * 使えないため、affiliate-offers 同様クライアント側で router.replace する。
 */
export default function ScenariosNewRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/scenarios/mode')
  }, [router])

  return (
    <div className="p-8 text-center text-ink-faint text-sm">
      移動中...
    </div>
  )
}
