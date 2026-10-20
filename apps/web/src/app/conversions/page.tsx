'use client'
import { Suspense, useEffect } from 'react'
import ConversionListV8 from '@/v8/conversions/list'
import { useMergedTab } from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'



/**
 * 設計 6-1 は1画面に5タブ。並びは設計のまま、素のURLでは主役の
 * 「成果地点（CV）」を開く。
 *
 * これまでは /conversions が2タブ、その中に入れていた /affiliates が
 * さらに3タブを持つ二重構造だった。同じ ?tab= が2つの意味を持つので、
 * 「案件を開くURL」を人に送れなかった。
 */
const MERGED_TABS = [
  { key: 'affiliates', label: 'アフィリエイター' },
  { key: 'offers', label: '案件' },
  { key: 'approvals', label: '成果承認' },
  { key: 'points', label: '成果地点' },
  { key: 'report', label: 'レポート' },
  /*
    **「支払い」を戻した。** 設計 `njLGA`（16-1-C）はこのタブを持つのに、
    `MERGED_TABS` に無かったので `?tab=payment` は既定タブへ落ち、
    **画面からは「無い」ことすら分からなかった**（#739 で未実装と判定した）。
    口は #763 で入ったので、読むだけの面をつなぐ。
  */
  { key: 'payment', label: '支払い' },
]


const DEFAULT_TAB = 'points'


const AFFILIATE_TABS = new Set(['affiliates', 'offers', 'approvals', 'payment', 'report'])


function ConversionsPageHost() {
  const tab = useMergedTab(MERGED_TABS, 'tab', DEFAULT_TAB)
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const router = useRouter()

  usePageTitle('コンバージョン')
  const target = AFFILIATE_TABS.has(tab) ? `/affiliates?${params.toString()}` : null
  useEffect(() => { if (target) router.replace(target) }, [target, router])
  if (target) return <ListState kind="loading" title="成果とアフィリエイトへ移動しています" />
  // V8 fixed: , , .
  return <ConversionListV8 accountId={selectedAccountId} />
}


export default function ConversionsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ConversionsPageHost />
    </Suspense>
  )
}
