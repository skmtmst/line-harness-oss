'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * 旧URLはV6正本へ集約する。
 *
 * ここに別のタイトル・タブ・状態を持つと、同じ紹介者機能を二重に直すことに
 * なる。画面名は共通トップバー、本文は /conversions の共通タブだけが持つ。
 *
 * `?tab=` は移転先へそのまま渡す。固定で `tab=affiliates` に落とすと、
 * `/affiliate-offers` からの `?tab=offers` が「アフィリエイター」タブへ
 * 連れて行かれてしまう。渡すのは /conversions が持つタブ名だけで、
 * 知らない値・未指定は「アフィリエイター」タブを開く
 * （/conversions の既定は成果地点なので、無指定でもそこへは落とさない）。
 *
 * output: 'export'（静的エクスポート）構成では next/navigation の
 * redirect() が使えないため、/affiliate-offers 同様クライアント側で
 * router.replace する。
 */
const CONVERSIONS_TABS = new Set([
  'affiliates',
  'offers',
  'approvals',
  'points',
  'report',
  'payment',
])

function AffiliatesRedirect() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const tab = params.get('tab')
    router.replace(`/conversions?tab=${tab && CONVERSIONS_TABS.has(tab) ? tab : 'affiliates'}`)
  }, [params, router])

  return (
    <div className="p-8 text-center text-ink-faint text-sm">
      移動中...
    </div>
  )
}

export default function AffiliatesPage() {
  return (
    // useSearchParams は静的書き出しのため Suspense の中でしか使えない。
    <Suspense>
      <AffiliatesRedirect />
    </Suspense>
  )
}
