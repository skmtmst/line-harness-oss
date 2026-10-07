'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAdminTheme } from '@/lib/use-admin-theme'
import ScenarioCreateV8 from '@/v8/scenarios/create'

/**
 * 対応表の `/scenarios/new`。作る①の正本は `/scenarios/mode`（specs/pages/03）。
 *
 * ★V8 のときは、この URL で作る①（`src/v8/scenarios/create.tsx`・Pencil `dnzqC`）を
 * そのまま出す（`/scenarios/mode` と同じ画面・同じ指定 `?id=`）。
 * v7 はブックマーク互換のため、今までどおり `/scenarios/mode` へ即リダイレクトする。
 * output: 'export'（静的エクスポート）構成では next/navigation の redirect() が
 * 使えないため、affiliate-offers 同様クライアント側で router.replace する。
 */
export default function ScenariosNewPage() {
  const theme = useAdminTheme()
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-faint text-sm">読み込み中…</div>}>
      {theme === 'v8' ? <ScenarioCreateV8 /> : <ScenariosNewRedirect />}
    </Suspense>
  )
}

function ScenariosNewRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id')

  useEffect(() => {
    // 最初の描画は v7 で始まり、直後に本当のテーマへ揃う。V8 なら移らない（画面をここで出す）。
    if (document.documentElement.dataset?.theme === 'v8') return
    router.replace(id ? `/scenarios/mode?id=${encodeURIComponent(id)}` : '/scenarios/mode')
  }, [router, id])

  return (
    <div className="p-8 text-center text-ink-faint text-sm">
      移動中...
    </div>
  )
}
