'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
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
 *
 * Issue #708（隠れ動線）: 自動で飛ばすだけでなく、行き先の名前と
 * 押せるリンクを画面に出す。読み上げ・キーボードの利用者が
 * 「どこへ行くのか」を知らずに飛ばされないようにする。
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
  const tab = params.get('tab')
  const destination = `/conversions?tab=${tab && CONVERSIONS_TABS.has(tab) ? tab : 'affiliates'}`

  useEffect(() => {
    router.replace(`/conversions?tab=${tab && CONVERSIONS_TABS.has(tab) ? tab : 'affiliates'}`)
  }, [params, router])

  return (
    <div className="p-8 text-center text-ink-faint text-sm">
      <p>成果とアフィリエイトへ移動しています…</p>
      <p className="mt-2">
        自動で移動しないときは
        <Link href={destination} className="text-action font-bold hover:underline">こちらから移動する</Link>
      </p>
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
