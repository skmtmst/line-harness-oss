'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import {
  AffiliatorsTab,
  ApprovalQueue,
  OffersTab,
  TAB_LABELS,
  parseTab,
  type PageTab,
} from './tabs'

/**
 * アフィリエイトの3タブ。
 *
 * 中身は tabs.tsx にある。App Router の page.tsx は default 以外を
 * export できず、成果とアフィリエイト（/conversions）側から同じタブを
 * 描けなかったため。設計 6-1 は1画面に5タブなので、そちらが親になる。
 * この画面は旧URLの行き先として残している。
 */
export default function AffiliatesPage() {
  // ?tab= で選択タブを保持（リロードで維持）。chats ページの unanswered=1 と同じく
  // useSearchParams (Suspense 要) を避け、window.location + history.replaceState で扱う。
  const [tab, setTab] = useState<PageTab>(() => {
    if (typeof window === 'undefined') return 'affiliates'
    return parseTab(new URLSearchParams(window.location.search).get('tab'))
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const urlParams = new URLSearchParams(window.location.search)
    if (tab === 'affiliates') urlParams.delete('tab')
    else urlParams.set('tab', tab)
    const qs = urlParams.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [tab])

  return (
    <div>
      <Header
        title="アフィリエイト"
        description="アフィリエイター管理・ASP 案件・成果承認"
      />

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(['affiliates', 'offers', 'approvals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'affiliates' && <AffiliatorsTab />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'approvals' && <ApprovalQueue />}
    </div>
  )
}
