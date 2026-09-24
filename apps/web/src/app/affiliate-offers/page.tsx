'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AFFILIATE_OFFERS_DESTINATION } from './destination'

/**
 * 旧「案件・承認」ページ。機能は /conversions?tab=offers に統合された。
 * ブックマーク互換のため、このページは即リダイレクトする薄いページとして残す。
 * output: 'export'（静的エクスポート）構成では next/navigation の redirect() が
 * 使えないため、chats ページ同様クライアント側で router.replace する。
 *
 * Issue #708（隠れ動線）:
 * 以前は /affiliates?tab=offers を経由する二段飛ばしで、途中の画面にも
 * 行き先が出なかった。正規ルート（`AFFILIATE_OFFERS_DESTINATION`）へ
 * 直接送り、行き先の名前と押せるリンクを画面に出す。
 */
export default function AffiliateOffersRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(AFFILIATE_OFFERS_DESTINATION)
  }, [router])

  return (
    <div className="p-8 text-center text-ink-faint text-sm">
      <p>案件（成果とアフィリエイト）へ移動しています…</p>
      <p className="mt-2">
        自動で移動しないときは
        <Link href={AFFILIATE_OFFERS_DESTINATION} className="text-action font-bold hover:underline">こちらから移動する</Link>
      </p>
    </div>
  )
}
